import asyncio
import ipaddress
import json
import time
from typing import Any

import httpx
from fastapi import HTTPException

from backend.app.config import settings

# SSE may not close the TCP connection after [DONE]; idle timeout avoids hanging reads.
STREAM_CHUNK_IDLE_SEC = 15.0
STREAM_MAX_READ_SEC = 120.0
STREAM_MAX_ATTEMPTS = 3
STREAM_RETRY_ERRORS = frozenset({"ReadError", "ConnectError", "ConnectTimeout"})


def _json_request_body(payload: dict[str, Any]) -> bytes:
    """Serialize like curl: UTF-8 literals, not \\uXXXX escapes (F5 iRule json_unescape lacks \\u support)."""
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _host_allowed(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    if not (addr.is_private or addr.is_loopback):
        return False
    for network in settings.allowed_private_networks:
        if addr in ipaddress.ip_network(network, strict=False):
            return True
    return False


def validate_target(host: str, port: int) -> None:
    if port < 1 or port > 65535:
        raise HTTPException(status_code=400, detail="Invalid port")
    if not _host_allowed(host):
        raise HTTPException(
            status_code=403,
            detail=f"Host '{host}' is not allowed. Only private/loopback addresses are permitted.",
        )


def _format_http_error(exc: BaseException) -> str:
    name = type(exc).__name__
    detail = str(exc).strip()
    return f"http_error: {name}" + (f": {detail}" if detail else "")


async def _consume_sse_stream(response: httpx.Response) -> dict[str, Any]:
    """Read SSE until [DONE] or idle/max duration; partial chunks still count as success."""
    chunk_count = 0
    done_seen = False
    read_error: str | None = None
    deadline = time.perf_counter() + STREAM_MAX_READ_SEC
    line_iter = response.aiter_lines().__aiter__()

    try:
        while time.perf_counter() < deadline:
            idle_left = min(STREAM_CHUNK_IDLE_SEC, deadline - time.perf_counter())
            if idle_left <= 0:
                break
            try:
                line = await asyncio.wait_for(line_iter.__anext__(), timeout=idle_left)
            except asyncio.TimeoutError:
                break
            except StopAsyncIteration:
                break

            if not line:
                continue
            if line.startswith("data:"):
                chunk_count += 1
                data = line[5:].strip()
                if data == "[DONE]":
                    done_seen = True
                    break
    except httpx.HTTPError as exc:
        read_error = _format_http_error(exc)

    return {
        "stream": True,
        "chunk_count": chunk_count,
        "done_seen": done_seen,
        "read_error": read_error,
    }


def _is_chat_completion_json(body: dict[str, Any]) -> bool:
    return body.get("object") == "chat.completion" and isinstance(body.get("choices"), list)


def _is_guardrail_block_body(body: dict[str, Any]) -> bool:
    if not _is_chat_completion_json(body):
        return False
    choices = body.get("choices") or []
    if not choices:
        return False
    msg = choices[0].get("message") if isinstance(choices[0], dict) else {}
    content = str((msg or {}).get("content") or "")
    rid = str(body.get("id") or "")
    return (
        "F5 AI Guardrail" in content
        or "Request Rejected" in content
        or rid.startswith("chatcmpl-error")
    )


def _stream_request_succeeded(status_code: int, body: dict[str, Any]) -> bool:
    if status_code != 200:
        return False
    if _is_guardrail_block_body(body) or _is_chat_completion_json(body):
        return True
    if body.get("done_seen"):
        return True
    return int(body.get("chunk_count") or 0) > 0


def _is_retryable_stream_error(result: dict[str, Any]) -> bool:
    if result.get("error") is None:
        return False
    err = str(result.get("error") or "")
    if not err.startswith("http_error:"):
        return False
    return any(name in err for name in STREAM_RETRY_ERRORS)


async def _proxy_stream_once(
    client: httpx.AsyncClient,
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> dict[str, Any]:
    started = time.perf_counter()
    request = client.build_request(
        "POST", url, content=_json_request_body(payload), headers=headers
    )
    response: httpx.Response | None = None
    try:
        response = await client.send(request, stream=True)
    except httpx.HTTPError as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "status_code": 0,
            "headers": {},
            "body": None,
            "elapsed_ms": elapsed_ms,
            "error": _format_http_error(exc),
            "stream": True,
        }

    status_code = response.status_code
    content_type = response.headers.get("content-type") or ""

    try:
        if "text/event-stream" in content_type:
            body = await _consume_sse_stream(response)
        else:
            raw = await response.aread()
            try:
                parsed: Any = json.loads(raw)
            except Exception:
                parsed = {"raw": raw.decode(errors="replace")}
            body = parsed if isinstance(parsed, dict) else {"body": parsed}
            # JSON completion (e.g. guardrail block) is not an SSE summary — do not tag stream on body

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        ok = _stream_request_succeeded(status_code, body if isinstance(body, dict) else {})
        error = None
        if not ok:
            read_err = body.get("read_error") if isinstance(body, dict) else None
            error = read_err or f"http_error: empty_stream status={status_code}"
        return {
            "status_code": status_code,
            "headers": dict(response.headers),
            "body": body,
            "elapsed_ms": elapsed_ms,
            "error": error,
            "stream": True,
            "sent_payload": payload,
        }
    finally:
        if response is not None:
            await response.aclose()


async def _proxy_stream(
    client: httpx.AsyncClient,
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> dict[str, Any]:
    last: dict[str, Any] | None = None
    for attempt in range(STREAM_MAX_ATTEMPTS):
        result = await _proxy_stream_once(client, url, payload, headers)
        if not _is_retryable_stream_error(result):
            return result
        last = result
        if attempt + 1 < STREAM_MAX_ATTEMPTS:
            await asyncio.sleep(0.2 * (attempt + 1))
    return last or {
        "status_code": 0,
        "headers": {},
        "body": None,
        "elapsed_ms": 0,
        "error": "http_error: stream_retries_exhausted",
        "stream": True,
    }


async def proxy_chat_completions(
    host: str,
    port: int,
    payload: dict[str, Any],
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    validate_target(host, port)
    url = f"http://{host}:{port}/v1/chat/completions"
    headers = {"Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    started = time.perf_counter()

    if payload.get("stream"):
        timeout = httpx.Timeout(
            connect=settings.connect_timeout,
            read=STREAM_MAX_READ_SEC,
            write=settings.read_timeout,
            pool=settings.connect_timeout,
        )
    else:
        timeout = httpx.Timeout(
            connect=settings.connect_timeout,
            read=settings.read_timeout,
            write=settings.read_timeout,
            pool=settings.connect_timeout,
        )

    stream_limits = httpx.Limits(max_keepalive_connections=0)
    try:
        async with httpx.AsyncClient(timeout=timeout, limits=stream_limits) as client:
            if payload.get("stream"):
                return await _proxy_stream(client, url, payload, headers)

            response = await client.post(
                url, content=_json_request_body(payload), headers=headers
            )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        body: Any
        try:
            body = response.json()
        except Exception:
            body = {"raw": response.text}
        return {
            "status_code": response.status_code,
            "headers": dict(response.headers),
            "body": body,
            "elapsed_ms": elapsed_ms,
            "error": None,
            "stream": False,
            "sent_payload": payload,
        }
    except httpx.ConnectError as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "status_code": 0,
            "headers": {},
            "body": None,
            "elapsed_ms": elapsed_ms,
            "error": f"connection_failed: {exc}",
        }
    except httpx.TimeoutException as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "status_code": 0,
            "headers": {},
            "body": None,
            "elapsed_ms": elapsed_ms,
            "error": f"timeout: {type(exc).__name__}: {exc}".strip(": "),
        }
    except httpx.HTTPError as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "status_code": 0,
            "headers": {},
            "body": None,
            "elapsed_ms": elapsed_ms,
            "error": _format_http_error(exc),
        }

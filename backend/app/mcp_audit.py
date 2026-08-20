"""Build and forward MCP audit events (simulates F5 iRule output when F5 is not in path)."""

from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone
from typing import Any

import httpx

SCHEMA_VERSION = "mcp_v1"


def _utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_trace_id() -> str:
    return f"mcp-{int(time.time() * 1000)}-{random.randint(10000, 99999)}"


def classify_message_type(method: str | None, body: dict[str, Any]) -> str:
    if not method:
        if body.get("error"):
            return "response.error"
        if body.get("result") is not None:
            return "response.client_to_server"
        return "unknown"
    mapping = {
        "initialize": "lifecycle.initialize",
        "server/discover": "lifecycle.discover",
        "notifications/initialized": "lifecycle.initialized",
        "tools/list": "discovery.tools_list",
        "tools/call": "tool.call",
        "prompts/list": "discovery.prompts_list",
        "prompts/get": "prompts.get",
        "resources/list": "discovery.resources_list",
        "resources/read": "resources.read",
        "sampling/createMessage": "sampling.response",
        "elicitation/create": "elicitation.response",
        "ping": "control.ping",
    }
    return mapping.get(method, f"other.{method}")


def build_audit_event(
    *,
    event_type: str,
    trace_id: str,
    mcp_session_id: str,
    agent_identity: str,
    tenant_id: str,
    client_ip: str,
    message_type: str,
    latency_ms: float,
    status: str = "success",
    tool_name: str = "",
    jsonrpc_id: str = "",
    params_summary: str = "",
    error_info: str = "",
    http_method: str = "POST",
    pool_member: str = "direct:9001",
    sse_sampling_count: int = 0,
    sse_elicitation_count: int = 0,
    sse_event_count: int = 0,
    mcp_protocol_version: str = "2025-11-25",
) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "event_type": event_type,
        "event_time": _utc_iso(),
        "trace_id": trace_id,
        "mcp_session_id": mcp_session_id or "new",
        "agent_identity": agent_identity or "unknown",
        "tenant_id": tenant_id or "default",
        "client_ip": client_ip,
        "message_type": message_type,
        "tool_name": tool_name,
        "jsonrpc_id": str(jsonrpc_id) if jsonrpc_id != "" else "",
        "params_summary": params_summary,
        "latency_ms": round(latency_ms, 2),
        "status": status,
        "error_info": error_info,
        "mcp_protocol_version": mcp_protocol_version or "2025-11-25",
        "http_method": http_method,
        "pool_member": pool_member,
        "sse_event_count": sse_event_count,
        "sse_sampling_count": sse_sampling_count,
        "sse_elicitation_count": sse_elicitation_count,
    }


def params_summary_for_request(body: dict[str, Any]) -> str:
    method = body.get("method")
    params = body.get("params") or {}
    if method == "tools/call":
        name = params.get("name", "")
        args = json.dumps(params.get("arguments") or {}, ensure_ascii=False)
        return f"tool={name},args={args[:400]}"
    if method == "prompts/get":
        return f"name={params.get('name', '')}"
    if method == "resources/read":
        return f"uri={params.get('uri', '')}"
    if method == "initialize":
        return "capabilities={sampling,elicitation}"
    return ""


async def post_audit_events(
    adapter_url: str,
    events: list[dict[str, Any]],
    *,
    timeout: float = 5.0,
    log_failures: bool = True,
) -> list[dict[str, Any]]:
    if not events or not adapter_url:
        return []
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        for event in events:
            try:
                resp = await client.post(adapter_url, json=event)
                if resp.status_code == 422:
                    detail = resp.text
                    results.append(
                        {"accepted": False, "trace_id": event.get("trace_id"), "detail": detail}
                    )
                    if log_failures:
                        print(
                            f"[mcp_audit] adapter 422 trace_id={event.get('trace_id')}: {detail[:200]}",
                            flush=True,
                        )
                elif resp.status_code >= 400:
                    results.append(
                        {
                            "accepted": False,
                            "trace_id": event.get("trace_id"),
                            "status_code": resp.status_code,
                            "detail": resp.text[:200],
                        }
                    )
                    if log_failures:
                        print(
                            f"[mcp_audit] adapter HTTP {resp.status_code} "
                            f"trace_id={event.get('trace_id')} url={adapter_url}",
                            flush=True,
                        )
                else:
                    payload = resp.json()
                    results.append(payload)
                    if log_failures and not payload.get("accepted", True):
                        reason = payload.get("reason") or payload.get("detail") or payload
                        print(
                            f"[mcp_audit] adapter rejected trace_id={event.get('trace_id')} "
                            f"reason={reason}",
                            flush=True,
                        )
            except Exception as exc:  # noqa: BLE001
                results.append(
                    {"accepted": False, "trace_id": event.get("trace_id"), "error": str(exc)}
                )
                if log_failures:
                    print(
                        f"[mcp_audit] POST failed trace_id={event.get('trace_id')} "
                        f"url={adapter_url}: {exc}",
                        flush=True,
                    )
    return results

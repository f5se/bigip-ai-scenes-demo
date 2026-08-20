"""MCP tools control demo runner: Tier1 Server ACL + Tier2 Tool ACL checks."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

import httpx

from backend.app.config import MCP_CONTROL_DEMO
from backend.app.mcp_protocol import attach_request_meta, is_stateless, mcp_name_for_payload


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_json(segment: str) -> dict[str, Any]:
    pad = "=" * (-len(segment) % 4)
    raw = base64.urlsafe_b64decode(segment + pad)
    data = json.loads(raw.decode("utf-8"))
    return data if isinstance(data, dict) else {}


def decode_jwt_claims(token: str) -> dict[str, Any]:
    """Decode JWT payload for demo display only (no signature verify)."""
    parts = token.split(".")
    if len(parts) < 2:
        return {}
    try:
        return _b64url_json(parts[1])
    except Exception:
        return {}


def mint_demo_jwt(*, sub: str, mcp_groups: str, mcp_role: str, secret: str, ttl_sec: int = 3600) -> str:
    """HS256 JWT for demo_local mode (iRule decodes payload; signature optional)."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": sub,
        "mcp_groups": mcp_groups,
        "mcp_role": mcp_role,
        "iat": now,
        "exp": now + ttl_sec,
        "iss": "mcp-tools-control-demo",
    }
    h = _b64url(json.dumps(header, separators=(",", ":")).encode())
    p = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    sig = _b64url(
        hmac.new(secret.encode("utf-8"), f"{h}.{p}".encode("ascii"), hashlib.sha256).digest()
    )
    return f"{h}.{p}.{sig}"


def _agent_by_id(agent_id: str, profile: dict[str, Any]) -> dict[str, Any]:
    agents = profile["agent_identities"]
    assert isinstance(agents, list)
    for a in agents:
        assert isinstance(a, dict)
        if a.get("id") == agent_id:
            return a
    raise KeyError(f"Unknown agent_id: {agent_id}")


def _is_allowed_status(status_code: int) -> bool:
    return status_code == 200


class McpControlRunner:
    def __init__(self, agent_id: str, target_server_id: str, profile: dict[str, Any] | None = None):
        self.profile = profile or MCP_CONTROL_DEMO
        self.agent = _agent_by_id(agent_id, self.profile)
        self.target_server_id = target_server_id
        vs = self.profile["default_vs"]
        assert isinstance(vs, dict)
        self.vs_host = str(vs["host"])
        self.vs_port = int(vs["port"])
        self.vs_url = f"http://{self.vs_host}:{self.vs_port}/mcp"
        self.token_url = str(self.profile.get("oauth_token_url") or "")
        self.token_mode = str(self.profile.get("token_mode") or "demo_local")
        self.protocol_version = str(self.profile.get("protocol_version") or "2025-11-25")

    async def fetch_jwt(self) -> dict[str, Any]:
        if self.token_mode == "apm_ropc":
            return await self._fetch_jwt_ropc()
        return self._fetch_jwt_demo_local()

    def _fetch_jwt_demo_local(self) -> dict[str, Any]:
        secret = os.environ.get(
            "MCP_CONTROL_CLIENT_SECRET",
            "4e5260b7ef7d1e7d593b36cc99d4acc9bf0c2e2fe963005056b3ac5958cd696a",
        )
        groups = str(self.agent.get("mcp_groups") or "")
        role = str(self.agent.get("mcp_role") or self.agent["id"])
        token = mint_demo_jwt(
            sub=str(self.agent.get("localdb_username") or self.agent["id"]),
            mcp_groups=groups,
            mcp_role=role,
            secret=secret,
        )
        return {
            "access_token": token,
            "token_type": "Bearer",
            "expires_in": 3600,
            "token_source": "demo_local",
        }

    async def _fetch_jwt_ropc(self) -> dict[str, Any]:
        password_env = str(self.agent.get("password_env") or "")
        password = os.environ.get(password_env, "")
        client_secret = os.environ.get(
            str(self.profile.get("client_secret_env") or "MCP_CONTROL_CLIENT_SECRET"),
            "",
        )
        if not password:
            raise RuntimeError(f"Missing env {password_env} for agent {self.agent['id']}")
        if not client_secret:
            raise RuntimeError("Missing env MCP_CONTROL_CLIENT_SECRET")

        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.post(
                self.token_url,
                data={
                    "grant_type": "password",
                    "username": str(self.agent["localdb_username"]),
                    "password": password,
                    "client_id": str(self.profile["client_id"]),
                    "client_secret": client_secret,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if resp.status_code >= 400:
                preview = resp.text[:300]
                raise httpx.HTTPStatusError(
                    f"OAuth token request failed: {resp.status_code} {preview}",
                    request=resp.request,
                    response=resp,
                )
            data = resp.json()
            if not isinstance(data, dict):
                raise RuntimeError("OAuth token response is not a JSON object")
            data["token_source"] = "apm_ropc"
            return data

    async def call_gateway(
        self,
        access_token: str,
        payload: dict[str, Any],
        *,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        payload = attach_request_meta(
            payload,
            protocol_version=self.protocol_version,
            client_info={"name": str(self.agent["id"]), "version": "1.0.0"},
        )
        headers = self._build_gateway_headers(
            access_token, session_id=session_id, payload=payload
        )

        # tools/call can trigger server-initiated sampling/elicitation. Handle them
        # by posting JSON-RPC result messages back to the same MCP session.
        if payload.get("method") == "tools/call":
            result = await self._call_gateway_tools_bidirectional(headers=headers, payload=payload)
            return await self._maybe_mrtr_retry(access_token, payload, result, session_id=session_id)

        timeout = httpx.Timeout(connect=8.0, read=8.0, write=8.0, pool=8.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            # tools/call may return SSE and keep the stream open; only capture a bounded preview.
            async with client.stream("POST", self.vs_url, json=payload, headers=headers) as resp:
                content_type = (resp.headers.get("content-type") or "").lower()
                max_preview_bytes = 1200
                preview = bytearray()
                try:
                    async for chunk in resp.aiter_bytes():
                        if not chunk:
                            continue
                        remain = max_preview_bytes - len(preview)
                        if remain <= 0:
                            break
                        preview.extend(chunk[:remain])
                        if len(preview) >= max_preview_bytes:
                            break
                        # For SSE, break early once a terminal marker is observed.
                        if "text/event-stream" in content_type:
                            text = preview.decode("utf-8", errors="replace")
                            if "[DONE]" in text or '"error"' in text:
                                break
                except httpx.ReadTimeout:
                    # Return what we already captured; caller only needs a preview.
                    pass

                body = preview.decode("utf-8", errors="replace")
                new_sid = resp.headers.get("Mcp-Session-Id") or resp.headers.get("mcp-session-id")
                return {
                    "status_code": resp.status_code,
                    "allowed": _is_allowed_status(resp.status_code),
                    "location": resp.headers.get("location"),
                    "content_type": resp.headers.get("content-type"),
                    "mcp_session_id": new_sid,
                    "body_preview": body[:1200],
                }

    def _build_gateway_headers(
        self,
        access_token: str,
        *,
        session_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "X-Mcp-Target-Server": self.target_server_id,
            "X-Agent-Identity": str(self.agent["id"]),
            "X-Tenant-Id": "mcp-tools-control-demo",
            "Clientless-Mode": "1",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": self.protocol_version,
        }
        if is_stateless(self.protocol_version) and payload:
            headers["Mcp-Method"] = str(payload.get("method") or "unknown")
            name = mcp_name_for_payload(payload)
            if name:
                headers["Mcp-Name"] = name
        elif session_id:
            headers["Mcp-Session-Id"] = session_id
        return headers

    @staticmethod
    def _auto_sampling_result() -> dict[str, Any]:
        return {
            "role": "assistant",
            "content": {
                "type": "text",
                "text": "[demo-client] 已自动应答 sampling，请继续返回工具执行结果。",
            },
            "model": "demo-mcp-client",
            "stopReason": "endTurn",
        }

    @staticmethod
    def _auto_elicitation_result(params: dict[str, Any]) -> dict[str, Any]:
        schema = params.get("requestedSchema") or {}
        props = schema.get("properties") or {}
        filled: dict[str, Any] = {}
        for key, prop in props.items():
            if not isinstance(prop, dict):
                continue
            if prop.get("type") == "boolean":
                filled[key] = prop.get("default", True)
            elif isinstance(prop.get("enum"), list) and prop["enum"]:
                filled[key] = prop["enum"][0]
            else:
                filled[key] = prop.get("default", "auto")
        return {"action": "accept", "content": filled}

    async def _post_mcp_result(
        self,
        *,
        headers: dict[str, str],
        result_payload: dict[str, Any],
    ) -> None:
        timeout = httpx.Timeout(connect=6.0, read=8.0, write=6.0, pool=6.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            await client.post(self.vs_url, json=result_payload, headers=headers)

    async def _call_gateway_tools_bidirectional(
        self,
        *,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        timeout = httpx.Timeout(connect=8.0, read=20.0, write=8.0, pool=8.0)
        original_id = payload.get("id")
        sampling_count = 0
        elicitation_count = 0
        final_seen = False

        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            async with client.stream("POST", self.vs_url, json=payload, headers=headers) as resp:
                new_sid = resp.headers.get("Mcp-Session-Id") or resp.headers.get("mcp-session-id")
                if new_sid:
                    headers = {**headers, "Mcp-Session-Id": new_sid}
                preview_lines: list[str] = []

                try:
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("event:") or line.startswith("data:"):
                            preview_lines.append(line)
                        if not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if not raw:
                            continue
                        msg = json.loads(raw)
                        method = msg.get("method")
                        if method == "sampling/createMessage":
                            sampling_count += 1
                            await self._post_mcp_result(
                                headers=headers,
                                result_payload={
                                    "jsonrpc": "2.0",
                                    "id": msg.get("id"),
                                    "result": self._auto_sampling_result(),
                                },
                            )
                            continue
                        if method == "elicitation/create":
                            elicitation_count += 1
                            await self._post_mcp_result(
                                headers=headers,
                                result_payload={
                                    "jsonrpc": "2.0",
                                    "id": msg.get("id"),
                                    "result": self._auto_elicitation_result(msg.get("params") or {}),
                                },
                            )
                            continue
                        if msg.get("id") == original_id and ("result" in msg or "error" in msg):
                            final_seen = True
                            break
                        if len("\n".join(preview_lines)) > 1200:
                            break
                except httpx.ReadTimeout:
                    # Safeguard timeout. Return collected preview instead of hanging.
                    pass

                body_preview = "\n".join(preview_lines)[:1200]
                if sampling_count or elicitation_count:
                    body_preview = (
                        f"[auto-reply] sampling={sampling_count}, elicitation={elicitation_count}\n"
                        f"{body_preview}"
                    )[:1200]

                return {
                    "status_code": resp.status_code,
                    "allowed": _is_allowed_status(resp.status_code),
                    "location": resp.headers.get("location"),
                    "content_type": resp.headers.get("content-type"),
                    "mcp_session_id": new_sid,
                    "body_preview": body_preview,
                    "mcp_auto_replied": bool(sampling_count or elicitation_count),
                    "mcp_final_seen": final_seen,
                }

    def _apm_route(self, gateway_result: dict[str, Any], target_server_id: str) -> dict[str, Any] | None:
        mcp_allowed = bool(gateway_result.get("allowed"))
        if mcp_allowed:
            pool = str(
                self.profile.get(f"pool_{target_server_id}")
                or f"pool_mcp_ctl_{target_server_id}"
            )
            return {
                "ending": "Allow",
                "pool": pool,
                "pool_role": "authorized",
            }
        if gateway_result.get("status_code") is not None:
            return {
                "ending": "Allow",
                "pool": str(self.profile.get("pool_deny") or "pool_mcp_ctl_deny"),
                "pool_role": "fail_close",
            }
        return None

    async def run(
        self,
        *,
        scenario: str = "tier1",
        tool_name: str | None = None,
    ) -> dict[str, Any]:
        token_info = await self.fetch_jwt()
        access_token = str(token_info.get("access_token") or "")
        claims = decode_jwt_claims(access_token) if access_token else {}
        mcp_groups = claims.get("mcp_groups", claims.get("groups"))

        init_payload: dict[str, Any]
        if is_stateless(self.protocol_version):
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "server/discover",
                "params": {},
            }
        else:
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": self.protocol_version,
                    "capabilities": {},
                    "clientInfo": {"name": str(self.agent["id"]), "version": "1.0.0"},
                },
            }
        init_result = await self.call_gateway(access_token, init_payload)

        gateway_result = init_result
        executed_tool = None
        if scenario == "tier2" and init_result.get("status_code") == 200 and tool_name:
            executed_tool = tool_name
            tool_args: dict[str, Any]
            if tool_name == "query_alert":
                tool_args = {"severity": "critical", "time_range": "1h", "service": "payments"}
            elif tool_name == "restart_service":
                tool_args = {"service_name": "web", "environment": "prod", "instance_id": "auto"}
            else:
                tool_args = {}
            tool_payload = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": tool_args},
            }
            gateway_result = await self.call_gateway(
                access_token,
                tool_payload,
                session_id=(
                    None
                    if is_stateless(self.protocol_version)
                    else str(init_result.get("mcp_session_id") or "")
                ),
            )

        mcp_allowed = bool(gateway_result.get("allowed"))
        return {
            "agent": self.agent["id"],
            "agent_label": self.agent.get("label"),
            "target_server": self.target_server_id,
            "scenario": scenario,
            "tool_name": executed_tool,
            "token_obtained": bool(access_token),
            "token_mode": self.token_mode,
            "token_source": token_info.get("token_source"),
            "token_summary": {
                "mcp_groups": mcp_groups,
                "mcp_role": claims.get("mcp_role"),
                "expires_in": token_info.get("expires_in"),
                "token_type": token_info.get("token_type"),
                "claim_keys": sorted(claims.keys()),
            },
            "init_result": init_result,
            "gateway_result": gateway_result,
            "decision": "allow" if mcp_allowed else "deny",
            "apm_route": self._apm_route(gateway_result, self.target_server_id),
            "vs": {"host": self.vs_host, "port": self.vs_port},
        }

    async def _maybe_mrtr_retry(
        self,
        access_token: str,
        original: dict[str, Any],
        result: dict[str, Any],
        *,
        session_id: str | None,
    ) -> dict[str, Any]:
        if not is_stateless(self.protocol_version):
            return result
        preview = str(result.get("body_preview") or "")
        if "input_required" not in preview:
            return result
        try:
            start = preview.find("{")
            data = json.loads(preview[start:]) if start >= 0 else {}
        except json.JSONDecodeError:
            return result
        inner = data.get("result") if isinstance(data, dict) else None
        if not isinstance(inner, dict) or inner.get("resultType") != "input_required":
            return result
        responses: list[dict[str, Any]] = []
        for req in inner.get("inputRequests") or []:
            if not isinstance(req, dict):
                continue
            method = req.get("method")
            if method == "sampling/createMessage":
                responses.append({"id": req.get("id"), "result": self._auto_sampling_result()})
            elif method == "elicitation/create":
                responses.append(
                    {
                        "id": req.get("id"),
                        "result": self._auto_elicitation_result(req.get("params") or {}),
                    }
                )
        params = dict(original.get("params") or {})
        params["inputResponses"] = responses
        retry = {
            "jsonrpc": "2.0",
            "id": int(original.get("id") or 2) + 10,
            "method": original.get("method"),
            "params": params,
        }
        return await self.call_gateway(access_token, retry, session_id=session_id)

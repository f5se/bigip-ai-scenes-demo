"""MCP protocol profiles for 2025-11-25 (legacy) vs 2026-07-28 (stateless).

Old demo paths MUST keep PROTOCOL_LEGACY as default. New demo menus opt into
PROTOCOL_2026 via an explicit profile — never by mutating the legacy runners.
"""

from __future__ import annotations

from typing import Any

PROTOCOL_LEGACY = "2025-11-25"
PROTOCOL_2026 = "2026-07-28"

META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion"
META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo"
META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities"


def is_stateless(protocol_version: str | None) -> bool:
    return (protocol_version or "") == PROTOCOL_2026


def mcp_name_for_payload(payload: dict[str, Any]) -> str:
    method = str(payload.get("method") or "")
    params = payload.get("params") or {}
    if not isinstance(params, dict):
        return ""
    if method in ("tools/call", "prompts/get", "prompts/list"):
        return str(params.get("name") or "")
    if method == "resources/read":
        return str(params.get("uri") or "")
    return ""


def request_meta(*, protocol_version: str, client_info: dict[str, str]) -> dict[str, Any]:
    return {
        META_PROTOCOL_VERSION: protocol_version,
        META_CLIENT_INFO: {
            "name": client_info.get("name", "demo-client"),
            "version": client_info.get("version", "1.0.0"),
        },
        META_CLIENT_CAPABILITIES: {
            "sampling": {},
            "elicitation": {"form": {}, "url": {}},
        },
    }


def attach_request_meta(
    payload: dict[str, Any],
    *,
    protocol_version: str,
    client_info: dict[str, str],
) -> dict[str, Any]:
    """Put protocol identity into params._meta (2026-07-28 self-describing requests)."""
    if not is_stateless(protocol_version):
        return payload
    out = dict(payload)
    params = dict(out.get("params") or {})
    params["_meta"] = request_meta(protocol_version=protocol_version, client_info=client_info)
    out["params"] = params
    return out


def http_headers(
    *,
    protocol_version: str,
    agent_identity: str,
    tenant_id: str,
    payload: dict[str, Any] | None = None,
    session_id: str | None = None,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": protocol_version,
        "X-Agent-Identity": agent_identity,
        "X-Tenant-Id": tenant_id,
    }
    payload = payload or {}
    if is_stateless(protocol_version):
        method = str(payload.get("method") or "")
        headers["Mcp-Method"] = method or "unknown"
        name = mcp_name_for_payload(payload)
        if name:
            headers["Mcp-Name"] = name
    elif session_id:
        headers["Mcp-Session-Id"] = session_id
    if extra:
        headers.update({k: v for k, v in extra.items() if v})
    return headers


def list_cache_fields() -> dict[str, Any]:
    return {"ttlMs": 60_000, "cacheScope": "server"}


def input_required_result(msg_id: Any, requests: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "result": {
            "resultType": "input_required",
            "inputRequests": requests,
        },
    }


def wire_examples() -> dict[str, Any]:
    """Static HTTP/JSON examples used by docs and the demo UI."""
    return {
        "legacy_tools_call": {
            "http": (
                "POST /mcp HTTP/1.1\n"
                "MCP-Protocol-Version: 2025-11-25\n"
                "Mcp-Session-Id: <from initialize>\n"
                "Content-Type: application/json\n"
                "Accept: application/json, text/event-stream"
            ),
            "json": {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "query_alert",
                    "arguments": {"severity": "critical", "time_range": "1h"},
                },
            },
        },
        "v2026_tools_call": {
            "http": (
                "POST /mcp HTTP/1.1\n"
                "MCP-Protocol-Version: 2026-07-28\n"
                "Mcp-Method: tools/call\n"
                "Mcp-Name: query_alert\n"
                "Content-Type: application/json\n"
                "Accept: application/json, text/event-stream"
            ),
            "json": {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "query_alert",
                    "arguments": {"severity": "critical", "time_range": "1h"},
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientInfo": {
                            "name": "monitoring-agent",
                            "version": "1.0.0",
                        },
                    },
                },
            },
        },
        "legacy_initialize": {
            "http": "POST /mcp → method=initialize → response header Mcp-Session-Id",
            "json": {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {"sampling": {}, "elicitation": {"form": {}, "url": {}}},
                    "clientInfo": {"name": "monitoring-agent", "version": "1.0.0"},
                },
            },
        },
        "v2026_discover": {
            "http": "POST /mcp\nMCP-Protocol-Version: 2026-07-28\nMcp-Method: server/discover",
            "json": {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "server/discover",
                "params": {
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientInfo": {
                            "name": "monitoring-agent",
                            "version": "1.0.0",
                        },
                    }
                },
            },
        },
        "legacy_sampling_sse": {
            "http": (
                "HTTP/1.1 200 OK\n"
                "Content-Type: text/event-stream\n"
                "Mcp-Session-Id: <session>\n\n"
                "event: message\n"
                "data: {\"jsonrpc\":\"2.0\",\"id\":1001,\"method\":\"sampling/createMessage\",...}"
            ),
            "json": {
                "jsonrpc": "2.0",
                "id": 1001,
                "method": "sampling/createMessage",
                "params": {"messages": [{"role": "user", "content": {"type": "text", "text": "summarize"}}]},
            },
        },
        "v2026_input_required": {
            "http": "HTTP/1.1 200 OK\nContent-Type: application/json\n(no Mcp-Session-Id)",
            "json": {
                "jsonrpc": "2.0",
                "id": 2,
                "result": {
                    "resultType": "input_required",
                    "inputRequests": [
                        {"id": "sampling-1", "type": "sampling", "params": {"messages": []}}
                    ],
                },
            },
        },
        "v2026_input_responses": {
            "http": (
                "POST /mcp HTTP/1.1\n"
                "MCP-Protocol-Version: 2026-07-28\n"
                "Mcp-Method: tools/call\n"
                "Mcp-Name: query_alert"
            ),
            "json": {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "query_alert",
                    "arguments": {"severity": "critical", "time_range": "1h"},
                    "inputResponses": [
                        {
                            "id": "sampling-1",
                            "result": {
                                "role": "assistant",
                                "content": {"type": "text", "text": "[demo-client] auto sampling"},
                            },
                        }
                    ],
                },
            },
        },
        "legacy_session_delete": {
            "http": "DELETE /mcp HTTP/1.1\nMCP-Protocol-Version: 2025-11-25\nMcp-Session-Id: <session>",
            "json": None,
        },
        "spec_links": {
            "spec": "https://modelcontextprotocol.io/specification/2026-07-28",
            "blog": "https://blog.modelcontextprotocol.io/posts/2026-07-28/",
            "legacy_spec": "https://modelcontextprotocol.io/specification/2025-11-25",
            "streamable_http": "https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http",
            "mrtr": "https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr",
        },
    }

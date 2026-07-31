"""MCP audit event models and validation."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

ACCEPTED_MCP_EVENT_TYPES = frozenset(
    {
        "mcp_request_completed",
        "mcp_sse_sampling_request",
        "mcp_sse_elicitation_request",
        "mcp_session_created",
        "mcp_session_terminated",
        "mcp_error",
    }
)

ACCEPTED_MCP_SCHEMA_VERSIONS = frozenset({"mcp_v1"})


class McpLogEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: str
    event_type: str
    event_time: str
    trace_id: str
    mcp_session_id: str
    agent_identity: str
    tenant_id: str
    client_ip: str
    message_type: str
    latency_ms: float = 0
    status: str = "success"
    tool_name: str = ""
    jsonrpc_id: str = ""
    params_summary: str = ""
    error_info: str = ""
    mcp_role: str = ""
    deny_reason: str = ""
    mcp_protocol_version: str = ""
    http_method: str = "POST"
    pool_member: str = ""
    sse_event_count: int = 0
    sse_sampling_count: int = 0
    sse_elicitation_count: int = 0


class McpEventsBatch(BaseModel):
    events: list[McpLogEvent] = Field(min_length=1)

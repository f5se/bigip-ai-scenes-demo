"""Prometheus metrics for MCP audit events."""

from __future__ import annotations

from typing import Any

from prometheus_client import Counter, Gauge, Histogram

MCP_LABELS = ("tool_name", "agent_identity", "tenant_id", "status", "message_type")

MCP_TOOL_CALLS_TOTAL = Counter(
    "mcp_tool_calls_total",
    "Total MCP tool invocations.",
    MCP_LABELS,
)
MCP_TOOL_CALL_LATENCY_MS = Histogram(
    "mcp_tool_call_latency_ms",
    "MCP tool call latency in milliseconds.",
    ("tool_name", "agent_identity", "tenant_id"),
    buckets=(50, 100, 250, 500, 1000, 2500, 5000, 10000),
)
MCP_TOOL_CALL_ERRORS_TOTAL = Counter(
    "mcp_tool_call_errors_total",
    "MCP tool call errors.",
    ("tool_name", "agent_identity", "tenant_id", "error_type"),
)
MCP_SESSIONS_TOTAL = Counter(
    "mcp_sessions_total",
    "MCP sessions created.",
    ("agent_identity", "tenant_id"),
)
MCP_SESSIONS_ACTIVE = Gauge(
    "mcp_sessions_active",
    "Active MCP sessions (best-effort).",
    ("agent_identity", "tenant_id"),
)
MCP_SAMPLING_REQUESTS_TOTAL = Counter(
    "mcp_sampling_requests_total",
    "Server-initiated sampling requests observed.",
    ("agent_identity", "tool_name", "tenant_id"),
)
MCP_ELICITATION_REQUESTS_TOTAL = Counter(
    "mcp_elicitation_requests_total",
    "Server-initiated elicitation requests observed.",
    ("agent_identity", "tool_name", "tenant_id", "mode"),
)
MCP_MESSAGES_TOTAL = Counter(
    "mcp_messages_total",
    "MCP messages by type.",
    ("message_type", "agent_identity", "tenant_id"),
)
MCP_DISCOVERY_OPERATIONS_TOTAL = Counter(
    "mcp_discovery_operations_total",
    "MCP discovery operations.",
    ("operation_type", "agent_identity", "tenant_id"),
)
MCP_RESOURCE_READS_TOTAL = Counter(
    "mcp_resource_reads_total",
    "MCP resource read operations.",
    ("resource_uri", "agent_identity", "tenant_id"),
)
MCP_ERRORS_TOTAL = Counter(
    "mcp_errors_total",
    "MCP errors by message type.",
    ("message_type", "tool_name", "agent_identity", "tenant_id"),
)
MCP_RBAC_DENIALS_TOTAL = Counter(
    "mcp_rbac_denials_total",
    "MCP RBAC / policy denials inferred from audit events.",
    ("agent_identity", "mcp_role", "deny_reason", "tool_name", "tenant_id", "message_type"),
)
MCP_EVENTS_PARSE_FAILURES = Counter(
    "mcp_adapter_parse_failures_total",
    "MCP events dropped due to parse/validation errors.",
    ("reason",),
)
MCP_DUPLICATE_DROPS_TOTAL = Counter(
    "mcp_adapter_duplicate_drops_total",
    "MCP events dropped due to duplicate trace_id.",
)


def _label(value: Any, default: str = "unknown") -> str:
    text = str(value or "").strip()
    return text or default


def record_mcp_event(payload: dict[str, Any]) -> None:
    event_type = payload.get("event_type", "")
    message_type = _label(payload.get("message_type"))
    agent = _label(payload.get("agent_identity"))
    tenant = _label(payload.get("tenant_id"), "default")
    tool = _label(payload.get("tool_name"), "-")
    status = _label(payload.get("status"), "success")
    latency = float(payload.get("latency_ms") or 0)

    MCP_MESSAGES_TOTAL.labels(message_type, agent, tenant).inc()

    if event_type == "mcp_sse_sampling_request":
        MCP_SAMPLING_REQUESTS_TOTAL.labels(agent, tool if tool != "-" else "unknown", tenant).inc()
        return

    if event_type == "mcp_sse_elicitation_request":
        mode = "form"
        if "mode=url" in str(payload.get("params_summary", "")):
            mode = "url"
        MCP_ELICITATION_REQUESTS_TOTAL.labels(
            agent, tool if tool != "-" else "unknown", tenant, mode
        ).inc()
        return

    if event_type == "mcp_session_created":
        MCP_SESSIONS_TOTAL.labels(agent, tenant).inc()
        MCP_SESSIONS_ACTIVE.labels(agent, tenant).inc()
        return

    if event_type == "mcp_session_terminated":
        MCP_SESSIONS_ACTIVE.labels(agent, tenant).dec()
        return

    if event_type != "mcp_request_completed":
        return

    if message_type == "lifecycle.initialize":
        MCP_SESSIONS_TOTAL.labels(agent, tenant).inc()
        MCP_SESSIONS_ACTIVE.labels(agent, tenant).inc()
    elif message_type == "lifecycle.session_terminate":
        MCP_SESSIONS_ACTIVE.labels(agent, tenant).dec()

    if message_type.startswith("discovery."):
        op = message_type.replace("discovery.", "")
        MCP_DISCOVERY_OPERATIONS_TOTAL.labels(op, agent, tenant).inc()

    if message_type == "resources.read":
        uri = "unknown"
        summary = str(payload.get("params_summary", ""))
        if summary.startswith("uri="):
            uri = summary[4:].split(",")[0] or "unknown"
        MCP_RESOURCE_READS_TOTAL.labels(uri, agent, tenant).inc()

    if message_type == "tool.call":
        tool_label = tool if tool not in ("-", "") else "unknown"
        MCP_TOOL_CALLS_TOTAL.labels(tool_label, agent, tenant, status, message_type).inc()
        if latency > 0:
            MCP_TOOL_CALL_LATENCY_MS.labels(tool_label, agent, tenant).observe(latency)
        if status == "error":
            err = _label(payload.get("error_info"), "unknown")
            MCP_TOOL_CALL_ERRORS_TOTAL.labels(tool_label, agent, tenant, err[:64]).inc()

    if status == "error":
        MCP_ERRORS_TOTAL.labels(message_type, tool if tool != "-" else "unknown", agent, tenant).inc()
        deny_reason = str(payload.get("deny_reason") or "").strip()
        if deny_reason:
            role = _label(payload.get("mcp_role"), "-")
            MCP_RBAC_DENIALS_TOTAL.labels(
                agent,
                role,
                deny_reason,
                tool if tool != "-" else "unknown",
                tenant,
                message_type,
            ).inc()

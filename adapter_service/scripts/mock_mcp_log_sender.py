#!/usr/bin/env python3
"""Send mock MCP audit events to Adapter /api/mcp-events for Grafana/metrics testing."""

from __future__ import annotations

import argparse
import random
import time
from datetime import datetime, timezone

import httpx

TOOLS = ["query_alert", "get_service_status", "restart_service", "query_logs", "create_incident"]
AGENTS = ["monitoring-agent", "change-agent", "analysis-agent"]
TENANTS = ["ops-team", "dev-team"]


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _trace_id() -> str:
    return f"mcp-{int(time.time() * 1000)}-{random.randint(10000, 99999)}"


def tool_call_event() -> dict:
    tool = random.choice(TOOLS)
    agent = random.choice(AGENTS)
    tenant = random.choice(TENANTS)
    status = random.choices(["success", "error"], weights=[92, 8])[0]
    return {
        "schema_version": "mcp_v1",
        "event_type": "mcp_request_completed",
        "event_time": _ts(),
        "trace_id": _trace_id(),
        "mcp_session_id": f"mock-session-{random.randint(1, 9999)}",
        "agent_identity": agent,
        "tenant_id": tenant,
        "client_ip": "10.10.1.50",
        "message_type": "tool.call",
        "tool_name": tool,
        "jsonrpc_id": str(random.randint(1, 20)),
        "params_summary": f"tool={tool}",
        "latency_ms": round(random.uniform(50, 2500), 2),
        "status": status,
        "error_info": "timeout" if status == "error" else "",
        "mcp_protocol_version": "2025-11-25",
        "http_method": "POST",
        "pool_member": "172.16.30.130:9001",
        "sse_event_count": random.randint(1, 5),
        "sse_sampling_count": 1 if tool == "query_alert" and random.random() < 0.6 else 0,
        "sse_elicitation_count": 1 if tool == "restart_service" and random.random() < 0.7 else 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Mock MCP audit log sender")
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:8090/api/mcp-events",
        help="Adapter MCP events endpoint",
    )
    parser.add_argument("--count", type=int, default=50, help="Number of events")
    parser.add_argument("--rate", type=float, default=0, help="Target rate (events/s), 0=as fast as possible")
    args = parser.parse_args()

    interval = 1.0 / args.rate if args.rate > 0 else 0
    ok = 0
    with httpx.Client(timeout=5.0) as client:
        for i in range(args.count):
            event = tool_call_event()
            if event["sse_sampling_count"]:
                sampling = dict(event)
                sampling["event_type"] = "mcp_sse_sampling_request"
                sampling["trace_id"] = _trace_id()
                sampling["latency_ms"] = 0
                client.post(args.url, json=sampling)
            resp = client.post(args.url, json=event)
            if resp.status_code == 200 and resp.json().get("accepted"):
                ok += 1
            if interval:
                time.sleep(interval)
            elif i % 10 == 0:
                print(f"sent {i + 1}/{args.count} accepted={ok}")

    print(f"done: {ok}/{args.count} accepted")


if __name__ == "__main__":
    main()

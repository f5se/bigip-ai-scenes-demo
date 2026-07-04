from __future__ import annotations

import asyncio
import json
import random
from typing import Any

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "query_alert",
        "description": "查询IT系统告警信息，支持按严重级别和时间范围过滤",
        "inputSchema": {
            "type": "object",
            "properties": {
                "severity": {"type": "string", "enum": ["critical", "warning", "info"]},
                "time_range": {"type": "string", "description": "如 1h、24h、7d"},
                "service": {"type": "string"},
            },
            "required": ["severity"],
        },
    },
    {
        "name": "get_service_status",
        "description": "获取指定服务的健康状态、实例数量和性能指标",
        "inputSchema": {
            "type": "object",
            "properties": {
                "service_name": {"type": "string"},
                "environment": {"type": "string", "enum": ["prod", "staging", "test"]},
            },
            "required": ["service_name"],
        },
    },
    {
        "name": "restart_service",
        "description": "重启指定服务实例（执行前会请求用户确认）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "service_name": {"type": "string"},
                "environment": {"type": "string", "enum": ["prod", "staging", "test"]},
                "instance_id": {"type": "string", "description": "填 auto 自动选择"},
            },
            "required": ["service_name", "environment"],
        },
    },
    {
        "name": "query_logs",
        "description": "查询应用日志，支持关键词与级别筛选",
        "inputSchema": {
            "type": "object",
            "properties": {
                "service": {"type": "string"},
                "level": {"type": "string", "enum": ["ERROR", "WARN", "INFO", "DEBUG"]},
                "keywords": {"type": "string"},
                "time_range": {"type": "string"},
            },
            "required": ["service", "level"],
        },
    },
    {
        "name": "scale_deployment",
        "description": "对 Kubernetes Deployment 弹性扩缩容",
        "inputSchema": {
            "type": "object",
            "properties": {
                "deployment_name": {"type": "string"},
                "replicas": {"type": "integer", "minimum": 0, "maximum": 50},
                "namespace": {"type": "string", "default": "default"},
            },
            "required": ["deployment_name", "replicas"],
        },
    },
    {
        "name": "create_incident",
        "description": "在 ITSM 中创建故障工单",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "severity": {"type": "string", "enum": ["P1", "P2", "P3", "P4"]},
                "description": {"type": "string"},
                "assignee": {"type": "string"},
            },
            "required": ["title", "severity", "description"],
        },
    },
]

TOOL_LATENCY_MS: dict[str, tuple[int, int]] = {
    "query_alert": (80, 300),
    "get_service_status": (50, 150),
    "restart_service": (800, 2000),
    "query_logs": (200, 600),
    "scale_deployment": (500, 1500),
    "create_incident": (100, 400),
}


async def execute_tool(name: str, arguments: dict[str, Any]) -> str:
    lo, hi = TOOL_LATENCY_MS.get(name, (50, 200))
    await asyncio.sleep(random.uniform(lo, hi) / 1000.0)

    if name == "query_alert":
        severity = arguments.get("severity", "critical")
        alerts = {
            "critical": [
                {
                    "id": "ALT-001",
                    "service": "payment-api",
                    "message": "数据库连接池耗尽",
                    "count": 47,
                },
                {
                    "id": "ALT-002",
                    "service": "order-service",
                    "message": "响应时间 P99 超过 5s",
                    "count": 12,
                },
            ],
            "warning": [
                {"id": "ALT-010", "service": "user-service", "message": "磁盘>80%", "count": 3}
            ],
        }.get(severity, [])
        return json.dumps({"severity": severity, "alerts": alerts}, ensure_ascii=False)

    if name == "get_service_status":
        svc = arguments.get("service_name", "payment-api")
        data = {
            "payment-api": {
                "status": "degraded",
                "instances": {"total": 4, "healthy": 2},
                "response_time_p99_ms": 4823,
            },
            "order-service": {
                "status": "healthy",
                "instances": {"total": 6, "healthy": 6},
                "response_time_p99_ms": 120,
            },
        }.get(svc, {"status": "unknown", "instances": {"total": 0, "healthy": 0}})
        return json.dumps({"service": svc, **data}, ensure_ascii=False)

    if name == "restart_service":
        payload = {
            "status": "success",
            "instance_id": "payment-api-7d9f4b-xhk2p",
            "duration_ms": 8432,
            "new_status": "running",
            "environment": arguments.get("environment", "test"),
        }
        return json.dumps(payload, ensure_ascii=False)

    if name == "query_logs":
        entries = [
            {"ts": "2026-07-03T09:55:01Z", "level": "ERROR", "msg": "Connection timeout"},
            {"ts": "2026-07-03T09:55:03Z", "level": "ERROR", "msg": "Retry exhausted"},
        ]
        return json.dumps({"entries": entries, "total": len(entries)}, ensure_ascii=False)

    if name == "scale_deployment":
        replicas = arguments.get("replicas", 1)
        return json.dumps(
            {
                "deployment": arguments.get("deployment_name", "payment-api"),
                "replicas_before": 4,
                "replicas_after": replicas,
                "status": "Scaling",
            },
            ensure_ascii=False,
        )

    if name == "create_incident":
        return json.dumps(
            {
                "incident_id": "INC-20260703-0042",
                "created_at": "2026-07-03T10:00:00Z",
                "status": "Open",
                "title": arguments.get("title", ""),
            },
            ensure_ascii=False,
        )

    raise ValueError(f"Unknown tool: {name}")

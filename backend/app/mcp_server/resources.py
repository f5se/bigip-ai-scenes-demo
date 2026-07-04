from __future__ import annotations

import json
from typing import Any

RESOURCE_DEFINITIONS: list[dict[str, Any]] = [
    {
        "uri": "ops://metrics/cpu-usage",
        "name": "CPU 使用率",
        "description": "所有主机 CPU 使用率",
        "mimeType": "application/json",
    },
    {
        "uri": "ops://metrics/memory-usage",
        "name": "内存使用",
        "description": "集群内存使用情况",
        "mimeType": "application/json",
    },
    {
        "uri": "ops://config/service-registry",
        "name": "服务注册表",
        "description": "服务注册与发现配置",
        "mimeType": "application/json",
    },
]

_RESOURCE_DATA: dict[str, Any] = {
    "ops://metrics/cpu-usage": {
        "hosts": [
            {"host": "db-prod-01", "cpu": 87.3},
            {"host": "app-prod-02", "cpu": 42.1},
        ]
    },
    "ops://metrics/memory-usage": {
        "hosts": [
            {"host": "db-prod-01", "memory_pct": 76.5},
            {"host": "app-prod-02", "memory_pct": 58.2},
        ]
    },
    "ops://config/service-registry": {
        "services": [
            {"name": "payment-api", "instances": 4},
            {"name": "order-service", "instances": 6},
        ]
    },
}


def read_resource(uri: str) -> list[dict[str, Any]]:
    data = _RESOURCE_DATA.get(uri)
    if data is None:
        raise ValueError(f"Unknown resource: {uri}")
    return [
        {
            "uri": uri,
            "mimeType": "application/json",
            "text": json.dumps(data, ensure_ascii=False),
        }
    ]

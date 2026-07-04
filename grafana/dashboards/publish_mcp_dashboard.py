#!/usr/bin/env python3
"""Build and publish MCP Tools Insight Grafana dashboard via API."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

GRAFANA_URL = os.environ.get("GRAFANA_URL", "http://172.16.40.122:3001")
GRAFANA_USER = os.environ.get("GRAFANA_USER", "admin")
GRAFANA_PASSWORD = os.environ.get("GRAFANA_PASSWORD", "")
PROM_DS_UID = os.environ.get("GRAFANA_PROM_DS_UID", "dfp3flzrl70n4d")
DASHBOARD_UID = "mcp-tools-insight"

FILTER = 'tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", tool_name=~"$tool_name"'
TOOL_FILTER = f"mcp_tool_calls_total{{{FILTER}}}"
TOOL_FILTER_SUCCESS = f'mcp_tool_calls_total{{{FILTER}, status="success"}}'
LATENCY_FILTER = FILTER


def ds() -> dict:
    return {"type": "prometheus", "uid": PROM_DS_UID}


def prom_target(
    expr: str,
    legend: str = "",
    instant: bool = False,
    fmt: str | None = None,
) -> dict:
    target = {
        "datasource": ds(),
        "expr": expr,
        "legendFormat": legend,
        "refId": "A",
        "instant": instant,
        "range": not instant,
    }
    if fmt:
        target["format"] = fmt
    return target


def template_var(name: str, query: str, label: str) -> dict:
    return {
        "name": name,
        "type": "query",
        "datasource": ds(),
        "query": {"query": query, "refId": "A"},
        "includeAll": True,
        "allValue": ".*",
        "multi": True,
        "label": label,
        "current": {"selected": True, "text": ["All"], "value": ["$__all"]},
    }


def row_panel(title: str, y: int) -> dict:
    return {
        "type": "row",
        "title": title,
        "gridPos": {"h": 1, "w": 24, "x": 0, "y": y},
        "collapsed": False,
        "panels": [],
        "id": None,
    }


def stat_panel(
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 4,
    unit: str = "short",
    thresholds: list | None = None,
) -> dict:
    return {
        "type": "stat",
        "title": title,
        "gridPos": {"h": 4, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, instant=True)],
        "options": {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "auto",
            "textMode": "auto",
            "colorMode": "value",
            "graphMode": "area",
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "decimals": 2 if unit == "percent" else 0,
                "thresholds": {
                    "mode": "absolute",
                    "steps": thresholds
                    or [{"color": "green", "value": None}, {"color": "red", "value": 80}],
                },
            },
            "overrides": [],
        },
    }


def gauge_panel(title: str, expr: str, x: int, y: int, w: int = 4) -> dict:
    p = stat_panel(title, expr, x, y, w, unit="percent")
    p["type"] = "gauge"
    p["options"] = {
        "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        "orientation": "auto",
        "showThresholdLabels": False,
        "showThresholdMarkers": True,
    }
    p["fieldConfig"]["defaults"]["min"] = 0
    p["fieldConfig"]["defaults"]["max"] = 100
    p["fieldConfig"]["defaults"]["thresholds"] = {
        "mode": "absolute",
        "steps": [
            {"color": "red", "value": None},
            {"color": "yellow", "value": 90},
            {"color": "green", "value": 98},
        ],
    }
    return p


def timeseries_panel(
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 12,
    h: int = 8,
    legend: str = "{{tool_name}}",
    unit: str = "ops",
    stacking: str = "none",
) -> dict:
    return {
        "type": "timeseries",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, legend)],
        "options": {
            "legend": {"displayMode": "table", "placement": "bottom", "calcs": ["lastNotNull", "max"]},
            "tooltip": {"mode": "multi", "sort": "desc"},
        },
        "fieldConfig": {
            "defaults": {
                "unit": unit,
                "custom": {
                    "drawStyle": "line",
                    "lineInterpolation": "smooth",
                    "fillOpacity": 15,
                    "stacking": {"mode": stacking},
                },
            },
            "overrides": [],
        },
    }


def pie_panel(title: str, expr: str, x: int, y: int, w: int = 8, h: int = 8, legend: str = "{{agent_identity}}") -> dict:
    return {
        "type": "piechart",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, legend, instant=True)],
        "options": {
            "legend": {"displayMode": "table", "placement": "right", "values": ["value", "percent"]},
            "pieType": "donut",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
        },
    }


def bargauge_panel(title: str, expr: str, x: int, y: int, w: int = 12, h: int = 8, legend: str = "{{tool_name}}") -> dict:
    return {
        "type": "bargauge",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, legend, instant=True)],
        "options": {
            "displayMode": "gradient",
            "orientation": "horizontal",
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "showUnfilled": True,
        },
        "fieldConfig": {"defaults": {"unit": "ms"}, "overrides": []},
    }


def table_panel(title: str, expr: str, x: int, y: int, w: int = 24, h: int = 8) -> dict:
    return {
        "type": "table",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, instant=True, fmt="table")],
        "options": {
            "showHeader": True,
            "sortBy": [{"displayName": "调用量", "desc": True}],
            "footer": {"show": True, "reducer": ["sum"], "countRows": False},
        },
        "fieldConfig": {
            "defaults": {"custom": {"align": "auto", "filterable": True}},
            "overrides": [
                {
                    "matcher": {"id": "byName", "options": "调用量"},
                    "properties": [{"id": "custom.width", "value": 120}],
                },
            ],
        },
        "transformations": [
            {
                "id": "organize",
                "options": {
                    "excludeByName": {"Time": True},
                    "renameByName": {"Value": "调用量", "Value #A": "调用量"},
                    "indexByName": {
                        "tool_name": 0,
                        "agent_identity": 1,
                        "tenant_id": 2,
                        "调用量": 3,
                        "Value": 3,
                        "Value #A": 3,
                    },
                },
            },
        ],
    }


def heatmap_panel(
    title: str,
    expr: str,
    x: int,
    y: int,
    w: int = 12,
    h: int = 8,
    legend: str = "{{tool_name}}",
    calculate: bool = True,
) -> dict:
    return {
        "type": "heatmap",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, legend)],
        "options": {
            "calculate": calculate,
            "calculation": {
                "xBuckets": {"mode": "size", "value": "1m"},
            },
            "cellGap": 1,
            "color": {"mode": "scheme", "scheme": "Spectral", "steps": 64},
            "yAxis": {"axisPlacement": "left", "decimals": 0},
            "tooltip": {"show": True, "yHistogram": False},
        },
        "fieldConfig": {"defaults": {"unit": "ms"}, "overrides": []},
    }


def build_dashboard() -> dict:
    y = 0
    panels: list[dict] = []

    panels.append(row_panel("总览 Overview", y))
    y += 1
    panels.extend(
        [
            stat_panel("工具调用总数", f"sum({TOOL_FILTER})", 0, y, 4, "short"),
            gauge_panel(
                "工具调用成功率",
                f"sum(rate({TOOL_FILTER_SUCCESS}[5m])) / sum(rate({TOOL_FILTER}[5m])) * 100",
                4,
                y,
                4,
            ),
            stat_panel(
                "活跃 MCP 会话",
                'sum(mcp_sessions_active{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"})',
                8,
                y,
                4,
            ),
            stat_panel(
                "P95 工具延迟",
                f"histogram_quantile(0.95, sum(rate(mcp_tool_call_latency_ms_bucket{{{FILTER}}}[5m])) by (le))",
                12,
                y,
                4,
                "ms",
            ),
            stat_panel(
                "MCP 消息总数",
                'sum(mcp_messages_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"})',
                16,
                y,
                4,
            ),
            stat_panel(
                "重复 trace 丢弃",
                "sum(mcp_adapter_duplicate_drops_total)",
                20,
                y,
                4,
                "short",
                [{"color": "green", "value": None}, {"color": "orange", "value": 1}],
            ),
        ]
    )
    y += 4

    panels.append(row_panel("工具调用 Tool Calls", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "各工具调用速率 (req/s)",
                f"sum by (tool_name) (rate({TOOL_FILTER}[1m]))",
                0,
                y,
                12,
                8,
                "{{tool_name}}",
                "reqps",
            ),
            timeseries_panel(
                "各工具成功率 (%)",
                f"sum by (tool_name) (rate({TOOL_FILTER_SUCCESS}[5m])) / sum by (tool_name) (rate({TOOL_FILTER}[5m])) * 100",
                12,
                y,
                12,
                8,
                "{{tool_name}}",
                "percent",
            ),
            bargauge_panel(
                "各工具 P95 延迟 (ms)",
                f"histogram_quantile(0.95, sum by (tool_name, le) (rate(mcp_tool_call_latency_ms_bucket{{{FILTER}}}[5m])))",
                0,
                y + 8,
                12,
                8,
            ),
            timeseries_panel(
                "各工具 P95 延迟趋势",
                f"histogram_quantile(0.95, sum by (tool_name, le) (rate(mcp_tool_call_latency_ms_bucket{{{LATENCY_FILTER}}}[5m])))",
                12,
                y + 8,
                12,
                8,
                "{{tool_name}}",
                "ms",
            ),
            table_panel(
                "工具 × Agent 调用量",
                f"sum by (tool_name, agent_identity, tenant_id) ({TOOL_FILTER})",
                0,
                y + 16,
                24,
                8,
            ),
        ]
    )
    y += 24

    panels.append(row_panel("Agent / Tenant 维度", y))
    y += 1
    panels.extend(
        [
            pie_panel(
                "按 Agent 分布",
                f"sum by (agent_identity) ({TOOL_FILTER})",
                0,
                y,
                8,
                8,
                "{{agent_identity}}",
            ),
            pie_panel(
                "按 Tenant 分布",
                f"sum by (tenant_id) ({TOOL_FILTER})",
                8,
                y,
                8,
                8,
                "{{tenant_id}}",
            ),
            timeseries_panel(
                "Agent 调用趋势",
                f"sum by (agent_identity) (rate({TOOL_FILTER}[1m]))",
                16,
                y,
                8,
                8,
                "{{agent_identity}}",
                "reqps",
            ),
        ]
    )
    y += 8

    panels.append(row_panel("MCP 消息类型与生命周期", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "消息类型速率 (initialize / tools_list / tool.call / sampling …)",
                'sum by (message_type) (rate(mcp_messages_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"}[1m]))',
                0,
                y,
                16,
                8,
                "{{message_type}}",
                "reqps",
                "normal",
            ),
            stat_panel(
                "Discovery 操作",
                'sum(mcp_discovery_operations_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"})',
                16,
                y,
                4,
            ),
            stat_panel(
                "Resource 读取",
                'sum(mcp_resource_reads_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"})',
                20,
                y,
                4,
            ),
            timeseries_panel(
                "Discovery 操作趋势",
                'sum by (operation_type) (rate(mcp_discovery_operations_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"}[1m]))',
                0,
                y + 8,
                12,
                6,
                "{{operation_type}}",
                "reqps",
            ),
            timeseries_panel(
                "Resource 读取趋势",
                'sum by (resource_uri) (rate(mcp_resource_reads_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"}[1m]))',
                12,
                y + 8,
                12,
                6,
                "{{resource_uri}}",
                "reqps",
            ),
        ]
    )
    y += 14

    panels.append(row_panel("Sampling / Elicitation（Server→Client 反向请求）", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "Sampling 请求速率",
                'sum by (agent_identity, tool_name) (rate(mcp_sampling_requests_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", tool_name=~"$tool_name"}[1m]))',
                0,
                y,
                12,
                8,
                "{{agent_identity}} / {{tool_name}}",
                "reqps",
            ),
            timeseries_panel(
                "Elicitation 请求速率（按 mode）",
                'sum by (agent_identity, mode) (rate(mcp_elicitation_requests_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", tool_name=~"$tool_name"}[1m]))',
                12,
                y,
                12,
                8,
                "{{agent_identity}} / {{mode}}",
                "reqps",
            ),
            stat_panel(
                "Sampling 累计",
                'sum(mcp_sampling_requests_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", tool_name=~"$tool_name"})',
                0,
                y + 8,
                6,
            ),
            stat_panel(
                "Elicitation 累计",
                'sum(mcp_elicitation_requests_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", tool_name=~"$tool_name"})',
                6,
                y + 8,
                6,
            ),
        ]
    )
    y += 12

    panels.append(row_panel("会话 Sessions", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "新会话创建速率",
                'sum by (agent_identity, tenant_id) (rate(mcp_sessions_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"}[1m]))',
                0,
                y,
                12,
                8,
                "{{agent_identity}} / {{tenant_id}}",
                "reqps",
            ),
            timeseries_panel(
                "活跃会话数趋势",
                'sum by (agent_identity, tenant_id) (mcp_sessions_active{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"})',
                12,
                y,
                12,
                8,
                "{{agent_identity}}",
                "short",
            ),
        ]
    )
    y += 8

    panels.append(row_panel("错误与 Adapter 健康", y))
    y += 1
    panels.extend(
        [
            pie_panel(
                "错误按 message_type",
                'sum by (message_type) (mcp_errors_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", tool_name=~"$tool_name"})',
                0,
                y,
                8,
                8,
                "{{message_type}}",
            ),
            timeseries_panel(
                "错误速率趋势",
                'sum by (message_type) (rate(mcp_errors_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"}[1m]))',
                8,
                y,
                8,
                8,
                "{{message_type}}",
                "reqps",
            ),
            timeseries_panel(
                "工具调用错误 (mcp_tool_call_errors_total)",
                'sum by (tool_name, error_type) (rate(mcp_tool_call_errors_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", tool_name=~"$tool_name"}[1m]))',
                16,
                y,
                8,
                8,
                "{{tool_name}} / {{error_type}}",
                "reqps",
            ),
            stat_panel(
                "解析失败事件",
                "sum(mcp_adapter_parse_failures_total)",
                0,
                y + 8,
                6,
                "short",
                [{"color": "green", "value": None}, {"color": "red", "value": 1}],
            ),
        ]
    )

    return {
        "dashboard": {
            "id": None,
            "uid": DASHBOARD_UID,
            "title": "MCP Tools 调用洞察",
            "description": "F5 MCP Tools Insight — 工具调用、Agent/Tenant、Sampling/Elicitation、会话与错误率",
            "tags": ["mcp", "f5", "insight", "tools"],
            "timezone": "browser",
            "schemaVersion": 39,
            "version": 1,
            "refresh": "10s",
            "time": {"from": "now-1h", "to": "now"},
            "graphTooltip": 1,
            "links": [
                {"title": "F5 BIG-IP LLM 可观测洞察", "url": "/d/f5-bigip-llm-v2", "type": "link", "icon": "external link"},
                {"title": "LLM Subagent 路由洞察", "url": "/d/llm-subagent-routing-v2", "type": "link", "icon": "external link"},
            ],
            "templating": {
                "list": [
                    {
                        "name": "datasource",
                        "type": "datasource",
                        "query": "prometheus",
                        "hide": 2,
                    },
                    template_var(
                        "tenant_id",
                        "label_values(mcp_tool_calls_total, tenant_id)",
                        "Tenant",
                    ),
                    template_var(
                        "agent_identity",
                        'label_values(mcp_tool_calls_total{tenant_id=~"$tenant_id"}, agent_identity)',
                        "Agent",
                    ),
                    template_var(
                        "tool_name",
                        'label_values(mcp_tool_calls_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"}, tool_name)',
                        "Tool",
                    ),
                ]
            },
            "annotations": {"list": []},
            "panels": panels,
        },
        "folderId": 0,
        "overwrite": True,
    }


def publish(payload: dict, password: str) -> dict:
    import base64

    url = f"{GRAFANA_URL.rstrip('/')}/api/dashboards/db"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    token = base64.b64encode(f"{GRAFANA_USER}:{password}".encode()).decode()
    req.add_header("Authorization", f"Basic {token}")

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        raise SystemExit(f"Grafana API error {exc.code}: {body}") from exc


def main() -> None:
    password = GRAFANA_PASSWORD or (sys.argv[1] if len(sys.argv) > 1 else "")
    if not password:
        print("Set GRAFANA_PASSWORD env or pass password as argv[1]", file=sys.stderr)
        sys.exit(1)

    payload = build_dashboard()
    out_path = os.path.join(os.path.dirname(__file__), "mcp-tools-insight.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Wrote {out_path}")

    result = publish(payload, password)
    print(json.dumps(result, indent=2))
    print(f"\nDashboard URL: {GRAFANA_URL}/d/{DASHBOARD_UID}/mcp-tools-调用洞察")


if __name__ == "__main__":
    main()

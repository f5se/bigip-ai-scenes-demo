#!/usr/bin/env python3
"""MCP Insight V2026-07-28 Grafana dashboard.

Same layout as the legacy MCP Tools Insight dashboard. A dedicated top row
calls out 2026-07-28 protocol differences; remaining rows reuse the same
mcp_* tool/RBAC/session/error views.
Does not modify the legacy dashboard (uid mcp-tools-insight).
"""

from __future__ import annotations

import json
import os
import sys

from grafana_lib import (
    GRAFANA_PASSWORD,
    GRAFANA_URL,
    bargauge_panel,
    gauge_panel,
    pie_panel,
    publish,
    row_panel,
    stat_panel,
    table_panel,
    template_var,
    timeseries_panel,
    ds,
    prom_target,
)

DASHBOARD_UID = "mcp-tools-insight-v2026-07-28"

FILTER = 'tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", tool_name=~"$tool_name"'
TOOL_FILTER = f"mcp_tool_calls_total{{{FILTER}}}"
TOOL_FILTER_SUCCESS = f'mcp_tool_calls_total{{{FILTER}, status="success"}}'
LATENCY_FILTER = FILTER
RBAC_FILTER = (
    'tenant_id=~"$tenant_id", agent_identity=~"$agent_identity", '
    'mcp_role=~"$mcp_role", tool_name=~"$tool_name"'
)
RBAC_DENIALS = f"mcp_rbac_denials_total{{{RBAC_FILTER}}}"
PROTO_FILTER = (
    'protocol_version=~"$protocol_version", tenant_id=~"$tenant_id", '
    'agent_identity=~"$agent_identity"'
)
PROTO = f"mcp_protocol_requests_total{{{PROTO_FILTER}}}"

DIFF_MARKDOWN = """**本行只列 2026-07-28 与旧协议（2025-11-25）的差异。下面各行与旧看板「MCP Tools 调用洞察」同一套看图方式。**

| 点 | 旧协议看板 / `:9000` | 本看板 / `:9020` `:9021` |
|----|----------------------|--------------------------|
| 会话 | `Mcp-Session-Id` + `initialize` | **无 session**，入口为 `server/discover` |
| 工具名（管控） | JSON `params.name` | **优先 HTTP 头 `Mcp-Name`**，空则回退 JSON |
| 中途输入 | SSE 反向 `sampling/createMessage` / `elicitation/create` | **MRTR**：`resultType=input_required` + 客户端 `inputResponses` |
| 粘滞 | Tools VS 挂 MCP Persistence | **`persist none`** |
| 协议标签 | 无 `protocol_version` | `mcp_protocol_requests_total{protocol_version="2026-07-28"}` |

下方工具调用 / RBAC / Sampling / 会话 / 错误 **指标名与旧看板相同**（`mcp_tool_calls_total` 等）。顶部本行用 `mcp_protocol_requests_total` 按协议版本拆开。
"""


def markdown_panel(title: str, content: str, x: int, y: int, w: int = 8, h: int = 8) -> dict:
    return {
        "type": "text",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "options": {"mode": "markdown", "content": content},
    }


def rbac_table_panel(title: str, expr: str, x: int, y: int, w: int = 12, h: int = 8) -> dict:
    return {
        "type": "table",
        "title": title,
        "gridPos": {"h": h, "w": w, "x": x, "y": y},
        "datasource": ds(),
        "targets": [prom_target(expr, instant=True, fmt="table")],
        "options": {"showHeader": True},
        "fieldConfig": {
            "defaults": {"custom": {"align": "auto", "filterable": True}},
            "overrides": [],
        },
        "transformations": [
            {"id": "labelsToFields", "options": {"mode": "columns"}},
            {
                "id": "organize",
                "options": {
                    "excludeByName": {"Time": True, "__name__": True},
                    "renameByName": {
                        "agent_identity": "Agent",
                        "mcp_role": "Role",
                        "deny_reason": "Deny Reason",
                        "tool_name": "Tool",
                        "message_type": "Message Type",
                        "Value": "Count",
                        "Value #A": "Count",
                    },
                },
            },
        ],
    }


def proto_var() -> dict:
    var = template_var(
        "protocol_version",
        "label_values(mcp_protocol_requests_total, protocol_version)",
        "Protocol",
    )
    var["includeAll"] = True
    var["allValue"] = ".*"
    var["multi"] = True
    var["current"] = {
        "selected": True,
        "text": ["2026-07-28"],
        "value": ["2026-07-28"],
    }
    return var


def build_dashboard() -> dict:
    y = 0
    panels: list[dict] = []

    panels.append(row_panel("2026-07-28 协议差异（仅本行与旧看板不同）", y))
    y += 1
    panels.extend(
        [
            markdown_panel("差异说明", DIFF_MARKDOWN, 0, y, 8, 10),
            stat_panel(
                "本协议请求总数",
                f"sum({PROTO})",
                8,
                y,
                4,
            ),
            stat_panel(
                "协议握手次数（server/discover）",
                f'sum(mcp_protocol_requests_total{{{PROTO_FILTER}, message_type=~"lifecycle.discover|lifecycle.initialize"}})',
                12,
                y,
                4,
            ),
            stat_panel(
                "tool.call（含 MRTR 续传）",
                f'sum(mcp_protocol_requests_total{{{PROTO_FILTER}, message_type="tool.call"}})',
                16,
                y,
                4,
            ),
            stat_panel(
                "失败 / 拒绝",
                f'sum(mcp_protocol_requests_total{{{PROTO_FILTER}, status="error"}})',
                20,
                y,
                4,
                "short",
                [{"color": "green", "value": None}, {"color": "orange", "value": 1}],
            ),
            timeseries_panel(
                "按协议版本速率",
                f"sum by (protocol_version) (rate({PROTO}[1m]))",
                8,
                y + 4,
                8,
                6,
                "{{protocol_version}}",
                "reqps",
            ),
            pie_panel(
                "按 pool member (server_target)",
                f"sum by (server_target) ({PROTO})",
                16,
                y + 4,
                8,
                6,
                "{{server_target}}",
            ),
        ]
    )
    y += 10

    # --- same as legacy dashboard from here ---
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
                "{{tool_name}}",
                "ms",
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

    panels.append(row_panel("RBAC 访问控制拒绝（按 Role）", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "RBAC 拒绝趋势 (agent / role / reason)",
                f"sum by (agent_identity, mcp_role, deny_reason) (rate({RBAC_DENIALS}[1m]))",
                0,
                y,
                12,
                8,
                "{{agent_identity}} / {{mcp_role}} / {{deny_reason}}",
                "reqps",
            ),
            rbac_table_panel(
                "RBAC 拒绝明细（按 agent / role）",
                f"sum by (agent_identity, mcp_role, deny_reason, tool_name, message_type) ({RBAC_DENIALS})",
                12,
                y,
                12,
                8,
            ),
            pie_panel(
                "拒绝原因分布 (deny_reason)",
                f"sum by (deny_reason) ({RBAC_DENIALS})",
                0,
                y + 8,
                8,
                8,
                "{{deny_reason}}",
            ),
            pie_panel(
                "拒绝按 Role 分布",
                f"sum by (mcp_role) ({RBAC_DENIALS})",
                8,
                y + 8,
                8,
                8,
                "{{mcp_role}}",
            ),
            stat_panel(
                "RBAC 拒绝总数",
                f"sum({RBAC_DENIALS})",
                16,
                y + 8,
                8,
                "short",
                [{"color": "green", "value": None}, {"color": "orange", "value": 1}],
            ),
        ]
    )
    y += 16

    panels.append(row_panel("MCP 消息类型与生命周期", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "消息类型速率（2026 常见 lifecycle.discover / tool.call）",
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
                "能力列表次数（tools/prompts/resources list）",
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
                "能力列表趋势（tools/prompts/resources list）",
                'sum by (operation_type) (rate(mcp_discovery_operations_total{tenant_id=~"$tenant_id", agent_identity=~"$agent_identity"}[1m]))',
                0,
                y + 8,
                12,
                6,
                "{{operation_type}}",
                "reqps",
            ),
            timeseries_panel(
                "按协议的 message_type（差异指标）",
                f"sum by (message_type, protocol_version) (rate({PROTO}[1m]))",
                12,
                y + 8,
                12,
                6,
                "{{protocol_version}} / {{message_type}}",
                "reqps",
            ),
        ]
    )
    y += 14

    panels.append(
        row_panel(
            "Sampling / Elicitation（2026：语义仍在，线上改为 MRTR，不再走 SSE 反向请求）",
            y,
        )
    )
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
            markdown_panel(
                "2026 Sampling 怎么看",
                "旧协议：SSE 上出现 `sampling/createMessage`，计入本行 Sampling 指标。\n\n"
                "新协议：**同一业务**（如 `query_alert`）改为 tools/call 返回 `input_required`，"
                "客户端再 POST `inputResponses`。审计可能记在 tool.call 而非 SSE sampling。"
                "请同时看上方「本协议请求 / tool.call」与 Demo 消息流里的 **MRTR** 标记。",
                12,
                y + 8,
                12,
                4,
            ),
        ]
    )
    y += 12

    panels.append(row_panel("会话 Sessions（2026 无 Mcp-Session-Id，此行多为 0 或 discover 计数）", y))
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
            "title": "MCP Insight V2026-07-28",
            "description": (
                "与「MCP Tools 调用洞察」同布局：工具调用、Agent/Role RBAC、Sampling、会话、错误。"
                "顶部单独列出 2026-07-28 协议差异（无 session / Header 工具名 / MRTR）。"
            ),
            "tags": ["mcp", "f5", "insight", "tools", "rbac", "2026-07-28"],
            "timezone": "browser",
            "schemaVersion": 39,
            "version": 3,
            "refresh": "10s",
            "time": {"from": "now-1h", "to": "now"},
            "graphTooltip": 1,
            "links": [
                {
                    "title": "旧看板 MCP Tools 调用洞察",
                    "url": "/d/mcp-tools-insight",
                    "type": "link",
                    "icon": "dashboard",
                },
                {
                    "title": "F5 BIG-IP LLM 可观测洞察",
                    "url": "/d/f5-bigip-llm-v2",
                    "type": "link",
                    "icon": "external link",
                },
            ],
            "templating": {
                "list": [
                    {
                        "name": "datasource",
                        "type": "datasource",
                        "query": "prometheus",
                        "hide": 2,
                    },
                    proto_var(),
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
                        "mcp_role",
                        'label_values(mcp_rbac_denials_total{tenant_id=~"$tenant_id"}, mcp_role)',
                        "Role",
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


def main() -> None:
    payload = build_dashboard()
    out_path = os.path.join(os.path.dirname(__file__), "mcp-tools-insight-v2026-07-28.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Wrote {out_path}")
    password = GRAFANA_PASSWORD or (sys.argv[1] if len(sys.argv) > 1 else "")
    if password:
        result = publish(payload, password)
        print(json.dumps(result, indent=2))
        print(f"\nDashboard URL: {GRAFANA_URL}/d/{DASHBOARD_UID}")
    else:
        print("JSON written only (set GRAFANA_PASSWORD to publish).")


if __name__ == "__main__":
    main()

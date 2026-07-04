#!/usr/bin/env python3
"""Build and publish Scene 2 LLM Observability + Subagent Routing Grafana dashboards."""

from __future__ import annotations

import json
import os
import sys

from grafana_lib import (
    GRAFANA_PASSWORD,
    GRAFANA_URL,
    UNIT_YUAN,
    bargauge_panel,
    dashboard_shell,
    gauge_panel,
    pie_panel,
    publish,
    row_panel,
    stat_panel,
    table_panel,
    template_var,
    timeseries_panel,
)

ROUTER_UID = "f5-bigip-llm-v2"
SUBAGENT_UID = "llm-subagent-routing-v2"

# Classic Model Router VS — agent 固定为 "-"
ROUTER_BASE = 'agent="-"'
RF = f'{ROUTER_BASE}, model=~"$model", pool=~"$pool", member=~"$member", price_version=~"$price_version"'
REQ = f"llm_requests_total{{{RF}}}"
REQ_ERR = f'llm_requests_total{{{RF}, status_class=~"4xx|5xx"}}'
RETRY = f"llm_retry_requests_total{{{RF}}}"
FALLBACK = f"llm_fallback_requests_total{{{RF}}}"
PROMPT = f"llm_prompt_tokens_total{{{RF}}}"
COMPLETION = f"llm_completion_tokens_total{{{RF}}}"
TOTAL_TOK = f"llm_total_tokens_total{{{RF}}}"
CACHE_READ = f"llm_cache_read_tokens_total{{{RF}}}"
CACHE_WRITE = f"llm_cache_write_tokens_total{{{RF}}}"
COST = f'llm_cost_total{{cost_type="total", currency="Yuan", {RF}}}'
COST_INPUT = f'llm_cost_total{{cost_type="input", currency="Yuan", {RF}}}'
COST_OUTPUT = f'llm_cost_total{{cost_type="output", currency="Yuan", {RF}}}'
COST_CACHE = f'llm_cost_total{{cost_type="cache", currency="Yuan", {RF}}}'
LAT_BUCKET = f"llm_latency_ms_bucket{{{RF}}}"
TTFB_BUCKET = f"llm_upstream_ttfb_ms_bucket{{{RF}}}"
TTFT_BUCKET = f"llm_ttft_ms_bucket{{{RF}}}"

# Subagent VS — agent != "-"
SF = (
    'agent!="-", agent=~"$agent", model=~"$model", pool=~"$pool", '
    'member=~"$member", identity_source=~"$identity_source", price_version=~"$price_version"'
)
SREQ = f"llm_requests_total{{{SF}}}"
SREQ_ERR = f'llm_requests_total{{{SF}, status_class=~"4xx|5xx"}}'
SRETRY = f"llm_retry_requests_total{{{SF}}}"
SFALLBACK = f"llm_fallback_requests_total{{{SF}}}"
SPROMPT = f"llm_prompt_tokens_total{{{SF}}}"
SCOMPLETION = f"llm_completion_tokens_total{{{SF}}}"
STOTAL_TOK = f"llm_total_tokens_total{{{SF}}}"
SCOST = f'llm_cost_total{{cost_type="total", currency="Yuan", {SF}}}'
SCOST_INPUT = f'llm_cost_total{{cost_type="input", currency="Yuan", {SF}}}'
SCOST_OUTPUT = f'llm_cost_total{{cost_type="output", currency="Yuan", {SF}}}'
SCOST_CACHE = f'llm_cost_total{{cost_type="cache", currency="Yuan", {SF}}}'
SLAT_BUCKET = f"llm_latency_ms_bucket{{{SF}}}"
STTFB_BUCKET = f"llm_upstream_ttfb_ms_bucket{{{SF}}}"
STTFT_BUCKET = f"llm_ttft_ms_bucket{{{SF}}}"


def build_router_dashboard() -> dict:
    y = 0
    panels: list[dict] = []

    panels.append(row_panel("总览 Overview — 场景二 Model Router VS", y))
    y += 1
    panels.extend(
        [
            stat_panel("总请求 RPS", f"sum(rate({REQ}[1m]))", 0, y, 3, "reqps"),
            gauge_panel(
                "HTTP 错误率",
                f"sum(rate({REQ_ERR}[5m])) / sum(rate({REQ}[5m])) * 100",
                3,
                y,
                3,
            ),
            gauge_panel(
                "Retry 率",
                f"sum(rate({RETRY}[5m])) / sum(rate({REQ}[5m])) * 100",
                6,
                y,
                3,
            ),
            gauge_panel(
                "Fallback 率",
                f"sum(rate({FALLBACK}[5m])) / sum(rate({REQ}[5m])) * 100",
                9,
                y,
                3,
            ),
            stat_panel("Token 吞吐", f"sum(rate({TOTAL_TOK}[1m]))", 12, y, 3, "tps"),
            stat_panel("费用速率 (Yuan/s)", f"sum(rate({COST}[1m]))", 15, y, 3, UNIT_YUAN),
            stat_panel(
                "时间段总费用 (Yuan)",
                f"sum(increase({COST}[$__range]))",
                18,
                y,
                3,
                UNIT_YUAN,
                decimals=2,
            ),
            stat_panel(
                "网关 E2E P95",
                f"histogram_quantile(0.95, sum(rate({LAT_BUCKET}[5m])) by (le))",
                21,
                y,
                3,
                "ms",
            ),
        ]
    )
    y += 4

    panels.append(row_panel("Token 用量与费用 Tokens & Cost", y))
    y += 1
    panels.extend(
        [
            stat_panel(
                "时间段总费用 (Yuan)",
                f"sum(increase({COST}[$__range]))",
                0,
                y,
                6,
                UNIT_YUAN,
                decimals=2,
            ),
            stat_panel(
                "时间段输入费用 (Yuan)",
                f"sum(increase({COST_INPUT}[$__range]))",
                6,
                y,
                6,
                UNIT_YUAN,
                decimals=2,
            ),
            stat_panel(
                "时间段输出费用 (Yuan)",
                f"sum(increase({COST_OUTPUT}[$__range]))",
                12,
                y,
                6,
                UNIT_YUAN,
                decimals=2,
            ),
            stat_panel(
                "时间段缓存费用 (Yuan)",
                f"sum(increase({COST_CACHE}[$__range]))",
                18,
                y,
                6,
                UNIT_YUAN,
                decimals=2,
            ),
            timeseries_panel("输入 Token 吞吐 (tokens/s)", f"sum(rate({PROMPT}[1m]))", 0, y + 4, 8, 7, unit="tps"),
            timeseries_panel("输出 Token 吞吐 (tokens/s)", f"sum(rate({COMPLETION}[1m]))", 8, y + 4, 8, 7, unit="tps"),
            timeseries_panel("总 Token 吞吐 (tokens/s)", f"sum(rate({TOTAL_TOK}[1m]))", 16, y + 4, 8, 7, unit="tps"),
            timeseries_panel(
                "缓存 Token 吞吐",
                f"sum(rate({CACHE_READ}[1m]))",
                0,
                y + 11,
                12,
                7,
                "cache_read",
                "tps",
            ),
            timeseries_panel(
                "缓存写入 Token 吞吐",
                f"sum(rate({CACHE_WRITE}[1m]))",
                12,
                y + 11,
                12,
                7,
                "cache_write",
                "tps",
            ),
            timeseries_panel("总费用速率 (Yuan/s)", f"sum(rate({COST}[1m]))", 0, y + 18, 8, 7, unit=UNIT_YUAN),
            timeseries_panel(
                "按模型费用速率 (Yuan/s)",
                f"sum by (model) (rate({COST}[1m]))",
                8,
                y + 18,
                8,
                7,
                "{{model}}",
                UNIT_YUAN,
            ),
            pie_panel(
                "时间段累计费用（按模型, Yuan）",
                f"sum by (model) (increase({COST}[$__range]))",
                16,
                y + 18,
                8,
                7,
                unit=UNIT_YUAN,
                decimals=2,
            ),
            timeseries_panel(
                "输入费用速率 (Yuan/s)",
                f"sum(rate({COST_INPUT}[1m]))",
                0,
                y + 25,
                12,
                7,
                "input",
                UNIT_YUAN,
            ),
            timeseries_panel(
                "输出费用速率 (Yuan/s)",
                f"sum(rate({COST_OUTPUT}[1m]))",
                12,
                y + 25,
                12,
                7,
                "output",
                UNIT_YUAN,
            ),
        ]
    )
    y += 32

    panels.append(row_panel("模型与路由 Models & Routing", y))
    y += 1
    panels.extend(
        [
            timeseries_panel("总 RPS", f"sum(rate({REQ}[1m]))", 0, y, 8, 8, unit="reqps"),
            timeseries_panel(
                "按模型 RPS",
                f"sum by (model) (rate({REQ}[1m]))",
                8,
                y,
                8,
                8,
                "{{model}}",
            ),
            timeseries_panel(
                "按 Pool RPS",
                f"sum by (pool) (rate({REQ}[1m]))",
                16,
                y,
                8,
                8,
                "{{pool}}",
                stacking="normal",
            ),
            timeseries_panel(
                "按 Member RPS",
                f"sum by (member) (rate({REQ}[1m]))",
                0,
                y + 8,
                12,
                8,
                "{{member}}",
            ),
            pie_panel(
                "HTTP 状态码分布",
                f"sum by (status_class) (rate({REQ}[5m]))",
                12,
                y + 8,
                6,
                8,
                "{{status_class}}",
            ),
            pie_panel(
                "请求分布（按 Pool）",
                f"sum by (pool) (rate({REQ}[5m]))",
                18,
                y + 8,
                6,
                8,
                "{{pool}}",
            ),
            timeseries_panel(
                "按模型错误率 (%)",
                f"sum by (model) (rate({REQ_ERR}[5m])) / sum by (model) (rate({REQ}[5m])) * 100",
                0,
                y + 16,
                24,
                8,
                "{{model}}",
                "percent",
            ),
        ]
    )
    y += 24

    panels.append(row_panel("延迟 Latency — E2E / TTFB / TTFT", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "网关 E2E 延迟 P95 (ms)",
                f"histogram_quantile(0.95, sum by (le) (rate({LAT_BUCKET}[5m])))",
                0,
                y,
                8,
                8,
                "p95",
                "ms",
            ),
            timeseries_panel(
                "E2E P95 按模型",
                f"histogram_quantile(0.95, sum by (model, le) (rate({LAT_BUCKET}[5m])))",
                8,
                y,
                8,
                8,
                "{{model}}",
                "ms",
            ),
            timeseries_panel(
                "上游 TTFB P95 — 非流式 (ms)",
                f"histogram_quantile(0.95, sum by (le) (rate({TTFB_BUCKET}[5m])))",
                16,
                y,
                8,
                8,
                "p95",
                "ms",
            ),
            timeseries_panel(
                "TTFB P95 按模型",
                f"histogram_quantile(0.95, sum by (model, le) (rate({TTFB_BUCKET}[5m])))",
                0,
                y + 8,
                12,
                8,
                "{{model}}",
                "ms",
            ),
            timeseries_panel(
                "TTFT P95 — 流式 SSE (ms)",
                f"histogram_quantile(0.95, sum by (le) (rate({TTFT_BUCKET}[5m])))",
                12,
                y + 8,
                12,
                8,
                "p95",
                "ms",
            ),
            timeseries_panel(
                "TTFT P95 按模型",
                f"histogram_quantile(0.95, sum by (model, le) (rate({TTFT_BUCKET}[5m])))",
                0,
                y + 16,
                24,
                8,
                "{{model}}",
                "ms",
            ),
        ]
    )
    y += 24

    panels.append(row_panel("Retry / Fallback / Usage 解析", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "Retry RPS 按模型",
                f"sum by (model) (rate({RETRY}[5m]))",
                0,
                y,
                12,
                8,
                "{{model}}",
            ),
            timeseries_panel(
                "Fallback RPS 按模型",
                f"sum by (model) (rate({FALLBACK}[5m]))",
                12,
                y,
                12,
                8,
                "{{model}}",
            ),
            gauge_panel(
                "Usage 解析失败率",
                f"sum(rate(llm_usage_parse_failures_total{{{RF}}}[5m])) / sum(rate({REQ}[5m])) * 100",
                0,
                y + 8,
                6,
            ),
            stat_panel(
                "Usage 解析失败速率",
                f"sum(rate(llm_usage_parse_failures_total{{{RF}}}[5m]))",
                6,
                y + 8,
                6,
                "ops",
            ),
            bargauge_panel(
                "Retry 次数（时间范围）",
                f"sum by (model) (increase({RETRY}[$__range]))",
                12,
                y + 8,
                12,
                8,
            ),
        ]
    )
    y += 16

    panels.append(row_panel("Adapter 健康", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "解析失败速率（按原因）",
                "sum by (reason) (rate(adapter_parse_failures_total[5m]))",
                0,
                y,
                12,
                8,
                "{{reason}}",
            ),
            timeseries_panel(
                "重复 request_id 丢弃速率",
                "rate(adapter_duplicate_drops_total[5m])",
                12,
                y,
                12,
                8,
                "drops",
            ),
        ]
    )

    variables = [
        template_var("model", f'label_values(llm_requests_total{{{ROUTER_BASE}}}, model)', "Model"),
        template_var(
            "pool",
            f'label_values(llm_requests_total{{{ROUTER_BASE}, model=~"$model"}}, pool)',
            "Pool",
        ),
        template_var(
            "member",
            f'label_values(llm_requests_total{{{ROUTER_BASE}, model=~"$model", pool=~"$pool"}}, member)',
            "Member",
        ),
        template_var(
            "price_version",
            f'label_values(llm_requests_total{{{ROUTER_BASE}}}, price_version)',
            "Price Ver",
        ),
    ]

    links = [
        {"title": "LLM Subagent 路由洞察", "url": f"/d/{SUBAGENT_UID}", "type": "link", "icon": "external link"},
        {"title": "MCP Tools 洞察", "url": "/d/mcp-tools-insight", "type": "link", "icon": "external link"},
        {"title": "旧版 F5 BIG-IP LLM", "url": "/d/admzgfh/f5-big-ip-llm", "type": "link", "icon": "doc"},
    ]

    return dashboard_shell(
        ROUTER_UID,
        "F5 BIG-IP LLM 可观测洞察",
        "场景二 Observability — Model Router VS：Token/费用、模型路由、延迟(TTFB/TTFT/E2E)、Retry/Fallback、Adapter 健康",
        ["f5", "llm", "observability", "scene2", "router"],
        panels,
        variables,
        links,
    )


def build_subagent_dashboard() -> dict:
    y = 0
    panels: list[dict] = []

    panels.append(row_panel("总览 Overview — Agent/Subagent Based Routing", y))
    y += 1
    panels.extend(
        [
            stat_panel("Subagent 总 RPS", f"sum(rate({SREQ}[1m]))", 0, y, 3, "reqps"),
            gauge_panel(
                "HTTP 错误率",
                f"sum(rate({SREQ_ERR}[5m])) / sum(rate({SREQ}[5m])) * 100",
                3,
                y,
                3,
            ),
            stat_panel("活跃 Agent 数", f"count(sum by (agent) ({SREQ}))", 6, y, 3, "short"),
            gauge_panel(
                "Retry 率",
                f"sum(rate({SRETRY}[5m])) / sum(rate({SREQ}[5m])) * 100",
                9,
                y,
                3,
            ),
            stat_panel("Token 吞吐", f"sum(rate({STOTAL_TOK}[1m]))", 12, y, 3, "tps"),
            stat_panel("费用速率 (Yuan/s)", f"sum(rate({SCOST}[1m]))", 15, y, 3, UNIT_YUAN),
            stat_panel(
                "时间段总费用 (Yuan)",
                f"sum(increase({SCOST}[$__range]))",
                18,
                y,
                3,
                UNIT_YUAN,
                decimals=2,
            ),
            stat_panel(
                "Subagent 事件速率",
                f"sum(rate(llm_subagent_requests_total{{{SF}}}[1m]))",
                21,
                y,
                3,
                "reqps",
            ),
        ]
    )
    y += 4

    panels.append(row_panel("Token 用量与费用 Tokens & Cost", y))
    y += 1
    panels.extend(
        [
            stat_panel(
                "时间段总费用 (Yuan)",
                f"sum(increase({SCOST}[$__range]))",
                0,
                y,
                6,
                UNIT_YUAN,
                decimals=2,
            ),
            stat_panel(
                "时间段输入费用 (Yuan)",
                f"sum(increase({SCOST_INPUT}[$__range]))",
                6,
                y,
                6,
                UNIT_YUAN,
                decimals=2,
            ),
            stat_panel(
                "时间段输出费用 (Yuan)",
                f"sum(increase({SCOST_OUTPUT}[$__range]))",
                12,
                y,
                6,
                UNIT_YUAN,
                decimals=2,
            ),
            stat_panel(
                "时间段缓存费用 (Yuan)",
                f"sum(increase({SCOST_CACHE}[$__range]))",
                18,
                y,
                6,
                UNIT_YUAN,
                decimals=2,
            ),
            timeseries_panel(
                "Token 吞吐按 Agent",
                f"sum by (agent) (rate({STOTAL_TOK}[1m]))",
                0,
                y + 4,
                8,
                8,
                "{{agent}}",
                "tps",
            ),
            timeseries_panel(
                "Prompt Token/s 按 Agent",
                f"sum by (agent) (rate({SPROMPT}[1m]))",
                8,
                y + 4,
                8,
                8,
                "{{agent}}",
                "tps",
            ),
            timeseries_panel(
                "Completion Token/s 按 Agent",
                f"sum by (agent) (rate({SCOMPLETION}[1m]))",
                16,
                y + 4,
                8,
                8,
                "{{agent}}",
                "tps",
            ),
            timeseries_panel(
                "费用速率按 Agent (Yuan/s)",
                f"sum by (agent) (rate({SCOST}[1m]))",
                0,
                y + 12,
                12,
                8,
                "{{agent}}",
                UNIT_YUAN,
            ),
            bargauge_panel(
                "时间段费用按 Agent×model (Yuan)",
                f"sum by (agent, model) (increase({SCOST}[$__range]))",
                12,
                y + 12,
                12,
                8,
                "{{agent}} / {{model}}",
                UNIT_YUAN,
                decimals=2,
            ),
            pie_panel(
                "时间段累计费用（按 Agent, Yuan）",
                f"sum by (agent) (increase({SCOST}[$__range]))",
                0,
                y + 20,
                12,
                8,
                "{{agent}}",
                UNIT_YUAN,
                decimals=2,
            ),
            pie_panel(
                "时间段累计费用（按 model, Yuan）",
                f"sum by (model) (increase({SCOST}[$__range]))",
                12,
                y + 20,
                12,
                8,
                "{{model}}",
                UNIT_YUAN,
                decimals=2,
            ),
        ]
    )
    y += 28

    panels.append(row_panel("Agent 流量 Agent Traffic", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "各 Agent 请求速率",
                f"sum by (agent) (rate({SREQ}[1m]))",
                0,
                y,
                12,
                8,
                "{{agent}}",
            ),
            timeseries_panel(
                "Agent RPS 堆叠",
                f"sum by (agent) (rate({SREQ}[1m]))",
                12,
                y,
                12,
                8,
                "{{agent}}",
                stacking="normal",
            ),
            timeseries_panel(
                "Agent → Pool 分布",
                f"sum by (agent, pool) (rate({SREQ}[5m]))",
                0,
                y + 8,
                24,
                8,
                "{{agent}} / {{pool}}",
                stacking="normal",
            ),
        ]
    )
    y += 16

    panels.append(row_panel("路由与身份 Routing & Identity", y))
    y += 1
    panels.extend(
        [
            pie_panel(
                "身份识别方式 (identity_source)",
                f"sum by (identity_source) (rate({SREQ}[5m]))",
                0,
                y,
                8,
                8,
                "{{identity_source}}",
            ),
            timeseries_panel(
                "identity_source 请求速率",
                f"sum by (identity_source) (rate({SREQ}[1m]))",
                8,
                y,
                8,
                8,
                "{{identity_source}}",
            ),
            bargauge_panel(
                "Agent × 后端模型 调用量",
                f"sum by (agent, model) (increase({SREQ}[$__range]))",
                16,
                y,
                8,
                8,
                "{{agent}} → {{model}}",
            ),
            table_panel(
                "Agent × Pool × Model 明细",
                f"sum by (agent, pool, model) (increase({SREQ}[$__range]))",
                0,
                y + 8,
                24,
                8,
                ["agent", "pool", "model", "数值"],
            ),
        ]
    )
    y += 16

    panels.append(row_panel("延迟 Latency — TTFB / TTFT / E2E", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "TTFB P95 按 Agent (非流式)",
                f"histogram_quantile(0.95, sum by (agent, le) (rate({STTFB_BUCKET}[5m])))",
                0,
                y,
                12,
                8,
                "{{agent}}",
                "ms",
            ),
            timeseries_panel(
                "TTFB P95 按后端 model",
                f"histogram_quantile(0.95, sum by (model, le) (rate({STTFB_BUCKET}[5m])))",
                12,
                y,
                12,
                8,
                "{{model}}",
                "ms",
            ),
            timeseries_panel(
                "TTFT P95 按 Agent (流式)",
                f"histogram_quantile(0.95, sum by (agent, le) (rate({STTFT_BUCKET}[5m])))",
                0,
                y + 8,
                12,
                8,
                "{{agent}}",
                "ms",
            ),
            timeseries_panel(
                "网关 E2E P95 按 Agent",
                f"histogram_quantile(0.95, sum by (agent, le) (rate({SLAT_BUCKET}[5m])))",
                12,
                y + 8,
                12,
                8,
                "{{agent}}",
                "ms",
            ),
        ]
    )
    y += 16

    panels.append(row_panel("可靠性 Reliability", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "错误率按 Agent (%)",
                f"sum by (agent) (rate({SREQ_ERR}[5m])) / sum by (agent) (rate({SREQ}[5m])) * 100",
                0,
                y,
                12,
                8,
                "{{agent}}",
                "percent",
            ),
            timeseries_panel(
                "Retry RPS 按 Agent",
                f"sum by (agent) (rate({SRETRY}[5m]))",
                12,
                y,
                12,
                8,
                "{{agent}}",
            ),
            timeseries_panel(
                "Fallback RPS 按 Agent",
                f"sum by (agent) (rate({SFALLBACK}[5m]))",
                0,
                y + 8,
                12,
                8,
                "{{agent}}",
            ),
            pie_panel(
                "HTTP 状态码分布",
                f"sum by (status_class) (rate({SREQ}[5m]))",
                12,
                y + 8,
                6,
                8,
                "{{status_class}}",
            ),
            gauge_panel(
                "Usage 解析失败率",
                f"sum(rate(llm_usage_parse_failures_total{{{SF}}}[5m])) / sum(rate({SREQ}[5m])) * 100",
                18,
                y + 8,
                6,
            ),
        ]
    )
    y += 16

    panels.append(row_panel("Adapter 健康", y))
    y += 1
    panels.extend(
        [
            timeseries_panel(
                "解析失败速率（按原因）",
                "sum by (reason) (rate(adapter_parse_failures_total[5m]))",
                0,
                y,
                12,
                8,
                "{{reason}}",
            ),
            stat_panel(
                "Subagent 镜像计数",
                f"sum(llm_subagent_requests_total{{{SF}}})",
                12,
                y,
                6,
                4,
            ),
            stat_panel(
                "重复 trace 丢弃",
                "sum(adapter_duplicate_drops_total)",
                18,
                y,
                6,
                4,
            ),
        ]
    )

    variables = [
        template_var("agent", 'label_values(llm_requests_total{agent!="-"}, agent)', "Agent"),
        template_var(
            "model",
            'label_values(llm_requests_total{agent!="-", agent=~"$agent"}, model)',
            "Backend Model",
        ),
        template_var(
            "pool",
            'label_values(llm_requests_total{agent!="-", agent=~"$agent"}, pool)',
            "Pool",
        ),
        template_var(
            "member",
            'label_values(llm_requests_total{agent!="-", agent=~"$agent", pool=~"$pool"}, member)',
            "Member",
        ),
        template_var(
            "identity_source",
            'label_values(llm_requests_total{agent!="-", agent=~"$agent"}, identity_source)',
            "Identity Source",
        ),
        template_var(
            "price_version",
            'label_values(llm_requests_total{agent!="-", agent=~"$agent"}, price_version)',
            "Price Ver",
        ),
    ]

    links = [
        {"title": "F5 BIG-IP LLM 可观测洞察", "url": f"/d/{ROUTER_UID}", "type": "link", "icon": "external link"},
        {"title": "MCP Tools 洞察", "url": "/d/mcp-tools-insight", "type": "link", "icon": "external link"},
        {"title": "旧版 LLM Subagent", "url": "/d/admfw6v/llm-subagent", "type": "link", "icon": "doc"},
    ]

    return dashboard_shell(
        SUBAGENT_UID,
        "LLM Subagent 路由洞察",
        "Agent/Subagent Based Routing — superviser/planner/coder/tester/scanner 路由、身份识别、Pool/Model 映射、延迟与费用",
        ["f5", "llm", "subagent", "routing", "agent"],
        panels,
        variables,
        links,
    )


def main() -> None:
    password = GRAFANA_PASSWORD or (sys.argv[1] if len(sys.argv) > 1 else "")
    if not password:
        print("Set GRAFANA_PASSWORD env or pass password as argv[1]", file=sys.stderr)
        sys.exit(1)

    out_dir = os.path.dirname(__file__)
    dashboards = [
        ("f5-bigip-llm-v2.json", build_router_dashboard(), ROUTER_UID),
        ("llm-subagent-routing-v2.json", build_subagent_dashboard(), SUBAGENT_UID),
    ]

    for filename, payload, uid in dashboards:
        path = os.path.join(out_dir, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"Wrote {path}")

        result = publish(payload, password)
        print(json.dumps(result, indent=2))
        print(f"Dashboard URL: {GRAFANA_URL}/d/{uid}\n")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Compare MCP audit events: F5 (iRule/iRuleLX) vs Demo Runner (mcp_audit.build_audit_event).

Usage (from repo root):
  PYTHONPATH=. python backend/scripts/compare_audit_f5_vs_runner.py \\
    --f5-source /path/to/adapter-terminal.log \\
    --scenario tools_list

F5 log lines are parsed from [adapter][mcp_event_debug] JSON blocks.
Runner events are captured in-process (no POST to Adapter required).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Repo root on sys.path when invoked as script
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from adapter_service.mcp_events import McpLogEvent  # noqa: E402
from backend.app.mcp_audit import build_audit_event  # noqa: E402
import backend.app.mcp_client_runner as runner_mod  # noqa: E402

CANONICAL_FIELDS: tuple[str, ...] = (
    "schema_version",
    "event_type",
    "event_time",
    "trace_id",
    "mcp_session_id",
    "agent_identity",
    "tenant_id",
    "client_ip",
    "message_type",
    "latency_ms",
    "status",
    "tool_name",
    "jsonrpc_id",
    "params_summary",
    "error_info",
    "mcp_protocol_version",
    "http_method",
    "pool_member",
    "sse_event_count",
    "sse_sampling_count",
    "sse_elicitation_count",
)

# Values differ by design between paths; still reported but not counted as failures.
VOLATILE_FIELDS: frozenset[str] = frozenset(
    {
        "trace_id",
        "event_time",
        "latency_ms",
        "client_ip",
        "pool_member",
        "mcp_session_id",
    }
)

KNOWN_SEMANTIC_DIFFS: frozenset[str] = frozenset(
    {
        # Runner uses status=accepted for HTTP 202 notification ack
        "status",
        # Runner fills initialize summary; F5 iRule leaves empty unless tools/call
        "params_summary",
    }
)
DEBUG_BLOCK_START = re.compile(r"\[adapter\]\[mcp_event_debug\] POST /api/mcp-events body:")


def parse_f5_events_from_log(text: str) -> list[dict[str, Any]]:
    """Extract JSON bodies printed by ADAPTER_MCP_EVENT_DEBUG from a log file."""
    events: list[dict[str, Any]] = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        if DEBUG_BLOCK_START.search(lines[i]):
            i += 1
            while i < len(lines) and lines[i].strip() == "":
                i += 1
            if i >= len(lines):
                break
            buf: list[str] = []
            depth = 0
            while i < len(lines):
                line = lines[i]
                if line.startswith("INFO:") and depth == 0:
                    break
                buf.append(line)
                depth += line.count("{") - line.count("}")
                i += 1
                if depth <= 0 and buf:
                    break
            raw = "\n".join(buf).strip()
            if raw:
                try:
                    events.append(json.loads(raw))
                except json.JSONDecodeError as exc:
                    raise ValueError(f"Failed to parse F5 debug JSON block:\n{raw[:200]}") from exc
            continue
        i += 1
    return events


def validate_schema(event: dict[str, Any], label: str) -> list[str]:
    issues: list[str] = []
    try:
        McpLogEvent.model_validate(event)
    except Exception as exc:  # noqa: BLE001
        issues.append(f"{label}: Pydantic validation failed: {exc}")

    for key in CANONICAL_FIELDS:
        if key not in event:
            issues.append(f"{label}: missing canonical field '{key}'")
    extra = set(event.keys()) - set(CANONICAL_FIELDS)
    if extra:
        issues.append(f"{label}: extra fields {sorted(extra)}")
    return issues


def event_signature(ev: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(ev.get("event_type", "")),
        str(ev.get("message_type", "")),
        str(ev.get("jsonrpc_id", "")),
    )


def pair_events(
    f5_events: list[dict[str, Any]],
    runner_events: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], dict[str, Any], str]]:
    """Pair by signature; fall back to positional order for unmatched rows."""
    pairs: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    used_runner: set[int] = set()

    for f5_ev in f5_events:
        sig = event_signature(f5_ev)
        idx = next(
            (i for i, r in enumerate(runner_events) if i not in used_runner and event_signature(r) == sig),
            None,
        )
        if idx is not None:
            used_runner.add(idx)
            pairs.append((f5_ev, runner_events[idx], "signature"))
        else:
            pairs.append((f5_ev, {}, "f5_only"))

    for i, r in enumerate(runner_events):
        if i not in used_runner:
            pairs.append(({}, r, "runner_only"))

    if len(f5_events) == len(runner_events) and any(p[2] != "signature" for p in pairs):
        # Retry pure positional pairing when counts match but signatures diverge
        pairs = [
            (f5_events[i], runner_events[i], "positional")
            for i in range(len(f5_events))
        ]
    return pairs


@dataclass
class FieldDiff:
    field: str
    f5_value: Any
    runner_value: Any
    category: str  # volatile | semantic | mismatch


@dataclass
class CompareReport:
    f5_count: int = 0
    runner_count: int = 0
    schema_issues: list[str] = field(default_factory=list)
    field_diffs: list[FieldDiff] = field(default_factory=list)
    pairing: list[str] = field(default_factory=list)

    @property
    def format_ok(self) -> bool:
        return not self.schema_issues

    @property
    def semantic_mismatches(self) -> list[FieldDiff]:
        return [d for d in self.field_diffs if d.category == "mismatch"]

    @property
    def known_semantic_diffs(self) -> list[FieldDiff]:
        return [d for d in self.field_diffs if d.field in KNOWN_SEMANTIC_DIFFS and d.category != "volatile"]


def compare_event_pair(
    f5_ev: dict[str, Any],
    runner_ev: dict[str, Any],
) -> list[FieldDiff]:
    diffs: list[FieldDiff] = []
    for key in CANONICAL_FIELDS:
        fv = f5_ev.get(key)
        rv = runner_ev.get(key)
        if fv == rv:
            continue
        if key in VOLATILE_FIELDS:
            diffs.append(FieldDiff(key, fv, rv, "volatile"))
        elif key in KNOWN_SEMANTIC_DIFFS:
            diffs.append(FieldDiff(key, fv, rv, "semantic"))
        else:
            diffs.append(FieldDiff(key, fv, rv, "mismatch"))
    return diffs


def build_reference_event() -> dict[str, Any]:
    """Golden reference from build_audit_event (Runner canonical builder)."""
    return build_audit_event(
        event_type="mcp_request_completed",
        trace_id="mcp-ref-1",
        mcp_session_id="sess",
        agent_identity="monitoring-agent",
        tenant_id="ops-team",
        client_ip="127.0.0.1",
        message_type="lifecycle.initialize",
        latency_ms=12.34,
        jsonrpc_id="1",
    )


async def capture_runner_events(
    *,
    scenario: str,
    mcp_url: str,
    agent: str,
    tenant: str,
) -> list[dict[str, Any]]:
    captured: list[dict[str, Any]] = []

    async def _capture_post(adapter_url: str, events: list[dict[str, Any]], **_kw: Any) -> list[dict[str, Any]]:
        captured.extend(events)
        return [{"accepted": True, "trace_id": e.get("trace_id")} for e in events]

    import backend.app.mcp_audit as mcp_audit_mod  # noqa: F401

    original_post = runner_mod.post_audit_events
    runner_mod.post_audit_events = _capture_post  # type: ignore[assignment]
    try:
        runner = runner_mod.MCPClientRunner(
            mcp_url,
            agent,
            tenant,
            client_ip="127.0.0.1",
            adapter_events_url="http://capture.local/api/mcp-events",
            emit_audit=True,
            pool_member="direct:9001",
        )
        await runner.run_scenario(scenario)
    finally:
        runner_mod.post_audit_events = original_post

    return captured


def analyze(
    f5_events: list[dict[str, Any]],
    runner_events: list[dict[str, Any]],
) -> CompareReport:
    report = CompareReport(f5_count=len(f5_events), runner_count=len(runner_events))

    for i, ev in enumerate(f5_events):
        report.schema_issues.extend(validate_schema(ev, f"F5[{i}]"))
    for i, ev in enumerate(runner_events):
        report.schema_issues.extend(validate_schema(ev, f"Runner[{i}]"))

    ref = build_reference_event()
    report.schema_issues.extend(validate_schema(ref, "Reference(build_audit_event)"))

    f5_keys = set(f5_events[0].keys()) if f5_events else set()
    runner_keys = set(runner_events[0].keys()) if runner_events else set()
    if f5_keys and runner_keys and f5_keys != runner_keys:
        report.schema_issues.append(
            f"Top-level key sets differ: F5={sorted(f5_keys)} Runner={sorted(runner_keys)}"
        )

    pairs = pair_events(f5_events, runner_events)
    for f5_ev, runner_ev, how in pairs:
        if not f5_ev or not runner_ev:
            side = "F5 only" if f5_ev else "Runner only"
            report.pairing.append(f"{side}: {event_signature(f5_ev or runner_ev)} ({how})")
            continue
        sig = event_signature(f5_ev)
        report.pairing.append(f"paired ({how}): {sig}")
        report.field_diffs.extend(compare_event_pair(f5_ev, runner_ev))

    return report


def print_report(report: CompareReport) -> None:
    print("=" * 72)
    print("MCP Audit 格式与内容对比报告")
    print("=" * 72)
    print(f"F5 事件数: {report.f5_count}  |  Runner 事件数: {report.runner_count}")
    print()

    print("## 1. 格式（Schema）")
    if report.format_ok:
        print("✓ 两侧事件均通过 McpLogEvent 校验，字段集合一致。")
    else:
        print("✗ 格式问题：")
        for issue in report.schema_issues:
            print(f"  - {issue}")
    print()

    print("## 2. 事件配对")
    for line in report.pairing:
        print(f"  - {line}")
    print()

    volatile = [d for d in report.field_diffs if d.category == "volatile"]
    semantic = [d for d in report.field_diffs if d.category == "semantic"]
    mismatches = report.semantic_mismatches

    print("## 3. 字段差异（按配对）")
    if not report.field_diffs:
        print("✓ 除动态字段外，内容完全一致。")
    else:
        if volatile:
            print(f"  动态字段（预期不同，共 {len(volatile)} 处）：trace_id / event_time / latency_ms / client_ip / pool_member / mcp_session_id")
        if semantic:
            print(f"  已知语义差异（共 {len(semantic)} 处）：")
            for d in semantic:
                print(f"    · {d.field}: F5={d.f5_value!r}  Runner={d.runner_value!r}")
        if mismatches:
            print(f"  ✗ 意外内容差异（共 {len(mismatches)} 处）：")
            for d in mismatches:
                print(f"    · {d.field}: F5={d.f5_value!r}  Runner={d.runner_value!r}")
    print()

    print("## 4. 结论")
    if not report.format_ok:
        print("格式：不一致 — 需修复字段或 Adapter 模型。")
    else:
        print("格式：一致 — 均符合 mcp_v1 / McpLogEvent。")

    if mismatches:
        print(f"内容：存在 {len(mismatches)} 处意外差异（见上）。")
    elif semantic:
        print("内容：仅有已知的 Runner/F5 语义差异（如 status、params_summary）。")
    else:
        print("内容：语义匹配（动态字段已排除）。")
    print("=" * 72)


async def main_async(args: argparse.Namespace) -> int:
    f5_text = Path(args.f5_source).read_text(encoding="utf-8", errors="replace")
    f5_events = parse_f5_events_from_log(f5_text)
    if not f5_events:
        print(f"No F5 events found in {args.f5_source}", file=sys.stderr)
        return 2

    runner_events = await capture_runner_events(
        scenario=args.scenario,
        mcp_url=args.mcp_url,
        agent=args.agent,
        tenant=args.tenant,
    )
    if not runner_events:
        print("Runner produced no audit events (is MCP server up?)", file=sys.stderr)
        return 2

    if args.dump_json:
        out = {
            "f5_events": f5_events,
            "runner_events": runner_events,
        }
        Path(args.dump_json).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Wrote {args.dump_json}")

    report = analyze(f5_events, runner_events)
    print_report(report)

    if not report.format_ok:
        return 1
    if report.semantic_mismatches:
        return 1
    return 0


def main() -> None:
    default_f5_log = _REPO_ROOT / ".cursor/projects/Users-j-lin-Documents-CloudDisk-F5-SA-F5AI-BIG-IP-AI-llm-router-demo-App/terminals/6.txt"
    parser = argparse.ArgumentParser(description="Compare F5 vs Runner MCP audit events")
    parser.add_argument(
        "--f5-source",
        default=str(default_f5_log),
        help="Adapter debug log file containing [adapter][mcp_event_debug] blocks",
    )
    parser.add_argument("--scenario", default="tools_list", help="Runner scenario id")
    parser.add_argument("--mcp-url", default="http://127.0.0.1:9001", help="Direct MCP server URL")
    parser.add_argument("--agent", default="monitoring-agent")
    parser.add_argument("--tenant", default="ops-team")
    parser.add_argument("--dump-json", help="Write captured events to JSON file")
    args = parser.parse_args()

    if not Path(args.f5_source).is_file():
        print(f"F5 log not found: {args.f5_source}", file=sys.stderr)
        sys.exit(2)

    raise SystemExit(asyncio.run(main_async(args)))


if __name__ == "__main__":
    main()

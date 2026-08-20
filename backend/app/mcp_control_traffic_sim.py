"""Background simulator that intentionally triggers Tier1/Tier2 MCP denials for Grafana RBAC panels."""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from backend.app.mcp_control_runner import McpControlRunner
from backend.app.config import MCP_CONTROL_DEMO_V2026

MIN_GAP_SEC = 2.0
MAX_GAP_SEC = 6.0

# Expected-deny cases only — used to feed mcp_rbac_denials_total in Grafana.
DENY_CASES: list[dict[str, Any]] = [
    {
        "id": "t1_cross_domain_ops_finance",
        "scenario": "tier1",
        "agent_id": "ops-admin-agent",
        "target_server_id": "finance",
        "tool_name": None,
        "expected_deny_reason": "tier1_server_acl",
        "weight": 2,
    },
    {
        "id": "t1_guest_ops",
        "scenario": "tier1",
        "agent_id": "guest-agent",
        "target_server_id": "ops",
        "tool_name": None,
        "expected_deny_reason": "tier1_server_acl",
        "weight": 2,
    },
    {
        "id": "t1_finance_ops",
        "scenario": "tier1",
        "agent_id": "finance-agent",
        "target_server_id": "ops",
        "tool_name": None,
        "expected_deny_reason": "tier1_server_acl",
        "weight": 2,
    },
    {
        "id": "t1_guest_finance",
        "scenario": "tier1",
        "agent_id": "guest-agent",
        "target_server_id": "finance",
        "tool_name": None,
        "expected_deny_reason": "tier1_server_acl",
        "weight": 1,
    },
    {
        "id": "t2_readonly_restart",
        "scenario": "tier2",
        "agent_id": "ops-readonly-agent",
        "target_server_id": "ops",
        "tool_name": "restart_service",
        "expected_deny_reason": "tier2_tool_acl",
        "weight": 3,
    },
]


def _utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


@dataclass
class McpControlTrafficStats:
    requests: int = 0
    denied: int = 0
    unexpected_allow: int = 0
    failed: int = 0
    by_case: dict[str, int] = field(default_factory=dict)
    last_error: str | None = None
    last_case_id: str | None = None
    last_agent: str | None = None
    last_target: str | None = None
    last_tool: str | None = None
    last_decision: str | None = None
    last_http_status: int | None = None
    recent: list[dict[str, Any]] = field(default_factory=list)

    def record(
        self,
        case: dict[str, Any],
        *,
        decision: str,
        http_status: int | None,
        error: str | None = None,
    ) -> None:
        case_id = str(case["id"])
        self.requests += 1
        self.by_case[case_id] = self.by_case.get(case_id, 0) + 1
        self.last_case_id = case_id
        self.last_agent = str(case["agent_id"])
        self.last_target = str(case["target_server_id"])
        self.last_tool = case.get("tool_name")
        self.last_decision = decision
        self.last_http_status = http_status
        self.last_error = error

        if error and decision not in ("deny", "allow"):
            self.failed += 1
        elif decision == "deny":
            self.denied += 1
        elif decision == "allow":
            self.unexpected_allow += 1
        else:
            self.failed += 1

        self.recent.insert(
            0,
            {
                "case_id": case_id,
                "agent_id": case["agent_id"],
                "target_server_id": case["target_server_id"],
                "tool_name": case.get("tool_name"),
                "scenario": case["scenario"],
                "expected_deny_reason": case.get("expected_deny_reason"),
                "decision": decision,
                "http_status": http_status,
                "error": error,
                "at": _utc_iso(time.time()),
            },
        )
        if len(self.recent) > 12:
            self.recent = self.recent[:12]


class McpControlTrafficSimulator:
    def __init__(self, profile: dict[str, Any] | None = None) -> None:
        from backend.app.config import MCP_CONTROL_DEMO

        self.profile = profile or MCP_CONTROL_DEMO
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self.running = False
        self.duration_minutes: int = 10
        self.started_at: float | None = None
        self.ends_at: float | None = None
        self.stats = McpControlTrafficStats()
        self._stop_event = asyncio.Event()

    async def start(self, duration_minutes: int) -> dict[str, Any]:
        if duration_minutes < 1 or duration_minutes > 180:
            raise HTTPException(
                status_code=400,
                detail="duration_minutes must be between 1 and 180",
            )

        async with self._lock:
            if self.running:
                raise HTTPException(
                    status_code=409,
                    detail={"message": "mcp_control_traffic_sim_already_running"},
                )
            self.running = True
            self.duration_minutes = duration_minutes
            self.started_at = time.time()
            self.ends_at = self.started_at + duration_minutes * 60
            self.stats = McpControlTrafficStats()
            self._stop_event.clear()
            self._task = asyncio.create_task(self._run_loop())

        return self.status()

    async def stop(self) -> dict[str, Any]:
        async with self._lock:
            if not self.running:
                return self.status()
            self._stop_event.set()
            task = self._task
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        async with self._lock:
            self.running = False
            self._task = None
        return self.status()

    def status(self) -> dict[str, Any]:
        now = time.time()
        elapsed = int(now - self.started_at) if self.started_at else 0
        remaining = (
            max(0, int(self.ends_at - now)) if self.ends_at and self.running else 0
        )
        s = self.stats
        return {
            "running": self.running,
            "duration_minutes": self.duration_minutes,
            "started_at": _utc_iso(self.started_at) if self.started_at else None,
            "ends_at": _utc_iso(self.ends_at) if self.ends_at else None,
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining,
            "cases": [
                {
                    "id": c["id"],
                    "scenario": c["scenario"],
                    "agent_id": c["agent_id"],
                    "target_server_id": c["target_server_id"],
                    "tool_name": c.get("tool_name"),
                    "expected_deny_reason": c.get("expected_deny_reason"),
                }
                for c in DENY_CASES
            ],
            "stats": {
                "requests": s.requests,
                "denied": s.denied,
                "unexpected_allow": s.unexpected_allow,
                "failed": s.failed,
                "by_case": dict(s.by_case),
                "last_error": s.last_error,
                "last_case_id": s.last_case_id,
                "last_agent": s.last_agent,
                "last_target": s.last_target,
                "last_tool": s.last_tool,
                "last_decision": s.last_decision,
                "last_http_status": s.last_http_status,
                "recent": list(s.recent),
            },
        }

    def _pick_case(self) -> dict[str, Any]:
        weights = [int(c.get("weight") or 1) for c in DENY_CASES]
        return random.choices(DENY_CASES, weights=weights, k=1)[0]

    async def _run_one(self, case: dict[str, Any]) -> None:
        runner = McpControlRunner(
            str(case["agent_id"]), str(case["target_server_id"]), self.profile
        )
        tool_name = case.get("tool_name")
        try:
            result = await runner.run(
                scenario=str(case["scenario"]),
                tool_name=str(tool_name) if tool_name else None,
            )
            decision = str(result.get("decision") or "unknown")
            gw = result.get("gateway_result") or result.get("init_result") or {}
            http_status = None
            if isinstance(gw, dict):
                raw = gw.get("status_code")
                http_status = int(raw) if raw is not None else None
            async with self._lock:
                self.stats.record(
                    case,
                    decision=decision,
                    http_status=http_status,
                    error=str(result.get("error") or "") or None,
                )
        except Exception as exc:  # noqa: BLE001
            async with self._lock:
                self.stats.record(
                    case,
                    decision="error",
                    http_status=None,
                    error=str(exc),
                )

    async def _run_loop(self) -> None:
        try:
            assert self.ends_at is not None
            while not self._stop_event.is_set() and time.time() < self.ends_at:
                case = self._pick_case()
                await self._run_one(case)
                delay = random.uniform(MIN_GAP_SEC, MAX_GAP_SEC)
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
                    break
                except asyncio.TimeoutError:
                    pass
        finally:
            async with self._lock:
                self.running = False
                self._task = None


mcp_control_traffic_simulator = McpControlTrafficSimulator()
mcp_control_traffic_simulator_v2026 = McpControlTrafficSimulator(MCP_CONTROL_DEMO_V2026)

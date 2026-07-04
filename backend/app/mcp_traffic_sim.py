"""Background continuous MCP session simulator for MCP Tools Insight demo."""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from backend.app.config import MCP_INSIGHT_DEMO
from backend.app.mcp_client_runner import MCPClientRunner
from backend.app.proxy import validate_target

MIN_GAP_SEC = 1.0
MAX_GAP_SEC = 4.0


def _utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


def _scenario_pool() -> tuple[list[str], list[int]]:
    """Prefer shorter scenarios so Grafana gets diverse tenant/agent/tool dimensions faster."""
    scenarios = MCP_INSIGHT_DEMO.get("scenarios") or []
    ids: list[str] = []
    weights: list[int] = []
    for item in scenarios:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("id", ""))
        if not sid:
            continue
        ids.append(sid)
        weights.append(1 if sid == "full" else 3)
    if not ids:
        ids = ["tools_list", "tool_call_alert", "tool_call_restart"]
        weights = [3, 3, 3]
    return ids, weights


@dataclass
class McpTrafficStats:
    sessions: int = 0
    success: int = 0
    failed: int = 0
    tool_calls: int = 0
    sampling: int = 0
    elicitation: int = 0
    last_error: str | None = None
    last_agent: str | None = None
    last_tenant: str | None = None
    last_scenario: str | None = None
    recent_errors: list[dict[str, Any]] = field(default_factory=list)

    def record_success(
        self,
        agent: str,
        tenant: str,
        scenario: str,
        stats: dict[str, Any],
    ) -> None:
        self.sessions += 1
        self.success += 1
        self.last_agent = agent
        self.last_tenant = tenant
        self.last_scenario = scenario
        self.last_error = None
        self.tool_calls += int(stats.get("tool_calls") or 0)
        self.sampling += int(stats.get("sampling") or 0)
        self.elicitation += int(stats.get("elicitation") or 0)

    def record_error(self, agent: str, tenant: str, scenario: str, error: str) -> None:
        self.sessions += 1
        self.failed += 1
        self.last_agent = agent
        self.last_tenant = tenant
        self.last_scenario = scenario
        self.last_error = error
        self.recent_errors.insert(
            0,
            {
                "agent": agent,
                "tenant": tenant,
                "scenario": scenario,
                "error": error,
                "at": _utc_iso(time.time()),
            },
        )
        if len(self.recent_errors) > 8:
            self.recent_errors = self.recent_errors[:8]


class McpTrafficSimulator:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self.running = False
        self.target_host: str = ""
        self.target_port: int = 9001
        self.duration_minutes: int = 10
        self.emit_audit: bool = True
        self.adapter_url: str | None = None
        self.agents: list[str] = []
        self.tenants: list[str] = []
        self.scenario_ids: list[str] = []
        self.scenario_weights: list[int] = []
        self.started_at: float | None = None
        self.ends_at: float | None = None
        self.stats = McpTrafficStats()
        self._stop_event = asyncio.Event()

    async def start(
        self,
        host: str,
        port: int,
        duration_minutes: int,
        *,
        emit_audit: bool,
        adapter_url: str | None,
    ) -> dict[str, Any]:
        validate_target(host, port)
        if duration_minutes < 1 or duration_minutes > 180:
            raise HTTPException(
                status_code=400,
                detail="duration_minutes must be between 1 and 180",
            )

        agents_cfg = MCP_INSIGHT_DEMO.get("agent_options") or []
        tenants_cfg = MCP_INSIGHT_DEMO.get("tenant_options") or []
        agents = [str(a["id"]) for a in agents_cfg if isinstance(a, dict) and a.get("id")]
        tenants = [str(t["id"]) for t in tenants_cfg if isinstance(t, dict) and t.get("id")]
        if not agents or not tenants:
            raise HTTPException(status_code=500, detail="MCP insight agent/tenant options not configured")

        scenario_ids, scenario_weights = _scenario_pool()

        async with self._lock:
            if self.running:
                raise HTTPException(
                    status_code=409,
                    detail={"message": "mcp_traffic_sim_already_running"},
                )

            self.running = True
            self.target_host = host
            self.target_port = port
            self.duration_minutes = duration_minutes
            self.emit_audit = emit_audit
            self.adapter_url = adapter_url
            self.agents = agents
            self.tenants = tenants
            self.scenario_ids = scenario_ids
            self.scenario_weights = scenario_weights
            self.started_at = time.time()
            self.ends_at = self.started_at + duration_minutes * 60
            self.stats = McpTrafficStats()
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
            "target": {"host": self.target_host, "port": self.target_port},
            "duration_minutes": self.duration_minutes,
            "emit_audit": self.emit_audit,
            "started_at": _utc_iso(self.started_at) if self.started_at else None,
            "ends_at": _utc_iso(self.ends_at) if self.ends_at else None,
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining,
            "stats": {
                "sessions": s.sessions,
                "success": s.success,
                "failed": s.failed,
                "tool_calls": s.tool_calls,
                "sampling": s.sampling,
                "elicitation": s.elicitation,
                "last_error": s.last_error,
                "last_agent": s.last_agent,
                "last_tenant": s.last_tenant,
                "last_scenario": s.last_scenario,
                "recent_errors": list(s.recent_errors),
            },
        }

    def _make_runner(self, agent: str, tenant: str) -> MCPClientRunner:
        pool_member = f"{self.target_host}:{self.target_port}"
        scheme = "http"
        target_url = f"{scheme}://{self.target_host}:{self.target_port}/mcp"
        return MCPClientRunner(
            target_url,
            agent,
            tenant,
            adapter_events_url=self.adapter_url if self.emit_audit else None,
            emit_audit=self.emit_audit,
            pool_member=pool_member,
        )

    async def _run_loop(self) -> None:
        try:
            assert self.ends_at is not None
            while not self._stop_event.is_set() and time.time() < self.ends_at:
                agent = random.choice(self.agents)
                tenant = random.choice(self.tenants)
                scenario = random.choices(
                    self.scenario_ids, weights=self.scenario_weights, k=1
                )[0]
                runner = self._make_runner(agent, tenant)
                try:
                    result = await runner.run_scenario(scenario)
                    stats = result.get("stats") or {}
                    async with self._lock:
                        self.stats.record_success(agent, tenant, scenario, stats)
                except Exception as exc:  # noqa: BLE001
                    async with self._lock:
                        self.stats.record_error(agent, tenant, scenario, str(exc))

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


mcp_traffic_simulator = McpTrafficSimulator()

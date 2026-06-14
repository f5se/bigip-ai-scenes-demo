"""Background continuous traffic simulator for Agent/Subagent routing demo."""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from backend.app.agent_demo import (
    BASE_IDENTITY_MODES,
    IdentityMode,
    IdentityModeSelector,
    all_agent_ids,
    resolve_agent_mode_map,
    run_single_agent_request,
)
from backend.app.config import AGENT_ROUTING
from backend.app.proxy import validate_target

MIN_INTERVAL_SEC = 0.3
MAX_INTERVAL_SEC = 1.5


def _utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


@dataclass
class AgentTrafficStats:
    sent: int = 0
    success: int = 0
    non_200: int = 0
    timeout: int = 0
    connection_failed: int = 0
    other_errors: int = 0
    last_error: str | None = None
    last_status_code: int | None = None
    last_agent_id: str | None = None
    last_identity_mode: str | None = None
    recent_errors: list[dict[str, Any]] = field(default_factory=list)

    def record(
        self,
        agent_id: str,
        identity_mode: str,
        status_code: int,
        error: str | None,
    ) -> None:
        self.sent += 1
        self.last_agent_id = agent_id
        self.last_identity_mode = identity_mode
        self.last_status_code = status_code
        self.last_error = error

        if error:
            if error.startswith("timeout"):
                self.timeout += 1
            elif error.startswith("connection_failed"):
                self.connection_failed += 1
            else:
                self.other_errors += 1
            self._push_recent(agent_id, identity_mode, status_code, error)
            return

        if status_code == 200:
            self.success += 1
        else:
            self.non_200 += 1
            msg = f"http_{status_code}"
            self.last_error = msg
            self._push_recent(agent_id, identity_mode, status_code, msg)

    def _push_recent(
        self,
        agent_id: str,
        identity_mode: str,
        status_code: int,
        error: str,
    ) -> None:
        self.recent_errors.insert(
            0,
            {
                "agent_id": agent_id,
                "identity_mode": identity_mode,
                "status_code": status_code,
                "error": error,
                "at": _utc_iso(time.time()),
            },
        )
        if len(self.recent_errors) > 8:
            self.recent_errors = self.recent_errors[:8]


class AgentTrafficSimulator:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self.running = False
        self.target_host: str = ""
        self.target_port: int = 8000
        self.duration_minutes: int = 10
        self.user_prompt: str = ""
        self.identity_mode: IdentityModeSelector = "header"
        self.agent_identity_modes: dict[str, IdentityMode] = {}
        self.agents: list[dict[str, Any]] = []
        self.started_at: float | None = None
        self.ends_at: float | None = None
        self.stats = AgentTrafficStats()
        self._stop_event = asyncio.Event()

    async def start(
        self,
        host: str,
        port: int,
        duration_minutes: int,
        user_prompt: str,
        identity_mode: IdentityModeSelector,
    ) -> dict[str, Any]:
        validate_target(host, port)
        if identity_mode not in (*BASE_IDENTITY_MODES, "random"):
            raise HTTPException(
                status_code=400,
                detail="identity_mode must be header, system_name, model_field, or random",
            )
        if duration_minutes < 1 or duration_minutes > 180:
            raise HTTPException(
                status_code=400,
                detail="duration_minutes must be between 1 and 180",
            )
        if not user_prompt.strip():
            raise HTTPException(status_code=400, detail="user_prompt is required")

        async with self._lock:
            if self.running:
                raise HTTPException(
                    status_code=409,
                    detail={"message": "agent_traffic_sim_already_running"},
                )

            agents = list(AGENT_ROUTING["agents"])  # type: ignore[arg-type]
            ids = all_agent_ids()
            mode_map, _ = resolve_agent_mode_map(
                identity_mode, ids, session_ids=ids
            )

            self.running = True
            self.target_host = host
            self.target_port = port
            self.duration_minutes = duration_minutes
            self.user_prompt = user_prompt.strip()
            self.identity_mode = identity_mode
            self.agent_identity_modes = mode_map
            self.agents = agents
            self.started_at = time.time()
            self.ends_at = self.started_at + duration_minutes * 60
            self.stats = AgentTrafficStats()
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
            "user_prompt": self.user_prompt,
            "identity_mode": self.identity_mode,
            "agent_identity_modes": dict(self.agent_identity_modes),
            "started_at": _utc_iso(self.started_at) if self.started_at else None,
            "ends_at": _utc_iso(self.ends_at) if self.ends_at else None,
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining,
            "stats": {
                "sent": s.sent,
                "success": s.success,
                "non_200": s.non_200,
                "timeout": s.timeout,
                "connection_failed": s.connection_failed,
                "other_errors": s.other_errors,
                "error_total": s.non_200
                + s.timeout
                + s.connection_failed
                + s.other_errors,
                "last_error": s.last_error,
                "last_status_code": s.last_status_code,
                "last_agent_id": s.last_agent_id,
                "last_identity_mode": s.last_identity_mode,
                "recent_errors": list(s.recent_errors),
            },
        }

    async def _run_loop(self) -> None:
        try:
            assert self.ends_at is not None
            while not self._stop_event.is_set() and time.time() < self.ends_at:
                agent = random.choice(self.agents)
                agent_id = str(agent["id"])
                mode = self.agent_identity_modes[agent_id]
                result = await run_single_agent_request(
                    self.target_host,
                    self.target_port,
                    agent,
                    mode,
                    self.user_prompt,
                )
                proxy = result.get("proxy") or {}
                async with self._lock:
                    self.stats.record(
                        agent_id,
                        mode,
                        int(proxy.get("status_code") or 0),
                        proxy.get("error"),
                    )
                delay = random.uniform(MIN_INTERVAL_SEC, MAX_INTERVAL_SEC)
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
                    break
                except asyncio.TimeoutError:
                    pass
        finally:
            async with self._lock:
                self.running = False
                self._task = None


agent_traffic_simulator = AgentTrafficSimulator()

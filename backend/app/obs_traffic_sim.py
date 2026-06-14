"""Background traffic simulator for Observability sub-scenes (shared singleton)."""

from __future__ import annotations

import asyncio
import random
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from backend.app.config import MODEL_OPTIONS
from backend.app.proxy import proxy_chat_completions, validate_target

MIN_INTERVAL_SEC = 0.01
MAX_INTERVAL_SEC = 1.0
DEFAULT_CONCURRENCY = 5
MAX_CONCURRENCY = 10
STREAM_MODE_NON_STREAM = "non_stream"
STREAM_MODE_STREAM = "stream"
STREAM_MODE_MIXED = "mixed"
STREAM_MODES = frozenset(
    {STREAM_MODE_NON_STREAM, STREAM_MODE_STREAM, STREAM_MODE_MIXED}
)


def _pick_stream_models(models: list[str]) -> set[str]:
    """Randomly assign ~half of models to stream=true for one simulation run."""
    shuffled = list(models)
    random.shuffle(shuffled)
    stream_count = max(1, len(shuffled) // 2) if len(shuffled) > 1 else 0
    return set(shuffled[:stream_count])


def _resolve_stream_models(mode: str, models: list[str]) -> set[str]:
    if mode == STREAM_MODE_STREAM:
        return set(models)
    if mode == STREAM_MODE_MIXED:
        return _pick_stream_models(models)
    return set()


def _utc_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


@dataclass
class ObsTrafficStats:
    sent: int = 0
    success: int = 0
    non_200: int = 0
    timeout: int = 0
    connection_failed: int = 0
    other_errors: int = 0
    last_error: str | None = None
    last_status_code: int | None = None
    last_model: str | None = None
    recent_errors: list[dict[str, Any]] = field(default_factory=list)

    def record(self, model: str, status_code: int, error: str | None) -> None:
        self.sent += 1
        self.last_model = model
        self.last_status_code = status_code
        self.last_error = error

        if error:
            if error.startswith("timeout"):
                self.timeout += 1
            elif error.startswith("connection_failed"):
                self.connection_failed += 1
            else:
                self.other_errors += 1
            self._push_recent(model, status_code, error)
            return

        if status_code == 200:
            self.success += 1
        else:
            self.non_200 += 1
            msg = f"http_{status_code}"
            self.last_error = msg
            self._push_recent(model, status_code, msg)

    def _push_recent(self, model: str, status_code: int, error: str) -> None:
        self.recent_errors.insert(
            0,
            {
                "model": model,
                "status_code": status_code,
                "error": error,
                "at": _utc_iso(time.time()),
            },
        )
        if len(self.recent_errors) > 8:
            self.recent_errors = self.recent_errors[:8]


class ObsTrafficSimulator:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        self.running = False
        self.started_from: str | None = None
        self.target_host: str = ""
        self.target_port: int = 8000
        self.duration_minutes: int = 10
        self.concurrency: int = DEFAULT_CONCURRENCY
        self.started_at: float | None = None
        self.ends_at: float | None = None
        self.stats = ObsTrafficStats()
        self.stream_mode: str = STREAM_MODE_MIXED
        self.stream_models: set[str] = set()
        self._stop_event = asyncio.Event()

    async def start(
        self,
        host: str,
        port: int,
        duration_minutes: int,
        started_from: str,
        concurrency: int = DEFAULT_CONCURRENCY,
        stream_mode: str = STREAM_MODE_MIXED,
    ) -> dict[str, Any]:
        validate_target(host, port)
        if stream_mode not in STREAM_MODES:
            raise HTTPException(
                status_code=400,
                detail=f"stream_mode must be one of: {', '.join(sorted(STREAM_MODES))}",
            )
        if duration_minutes < 1 or duration_minutes > 180:
            raise HTTPException(status_code=400, detail="duration_minutes must be between 1 and 180")
        if concurrency < 1 or concurrency > MAX_CONCURRENCY:
            raise HTTPException(
                status_code=400,
                detail=f"concurrency must be between 1 and {MAX_CONCURRENCY}",
            )

        async with self._lock:
            if self.running:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "traffic_sim_already_running",
                        "started_from": self.started_from,
                    },
                )

            self.running = True
            self.started_from = started_from
            self.target_host = host
            self.target_port = port
            self.duration_minutes = duration_minutes
            self.concurrency = concurrency
            self.stream_mode = stream_mode
            self.started_at = time.time()
            self.ends_at = self.started_at + duration_minutes * 60
            self.stats = ObsTrafficStats()
            self.stream_models = _resolve_stream_models(stream_mode, MODEL_OPTIONS)
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
        remaining = max(0, int(self.ends_at - now)) if self.ends_at and self.running else 0
        s = self.stats
        return {
            "running": self.running,
            "started_from": self.started_from,
            "target": {"host": self.target_host, "port": self.target_port},
            "duration_minutes": self.duration_minutes,
            "concurrency": self.concurrency,
            "started_at": _utc_iso(self.started_at) if self.started_at else None,
            "ends_at": _utc_iso(self.ends_at) if self.ends_at else None,
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining,
            "models": list(MODEL_OPTIONS),
            "stream_mode": self.stream_mode,
            "stream_models": sorted(self.stream_models),
            "stream_model_count": len(self.stream_models),
            "stats": {
                "sent": s.sent,
                "success": s.success,
                "non_200": s.non_200,
                "timeout": s.timeout,
                "connection_failed": s.connection_failed,
                "other_errors": s.other_errors,
                "error_total": s.non_200 + s.timeout + s.connection_failed + s.other_errors,
                "last_error": s.last_error,
                "last_status_code": s.last_status_code,
                "last_model": s.last_model,
                "recent_errors": list(s.recent_errors),
            },
        }

    async def _worker_loop(self) -> None:
        assert self.ends_at is not None
        while not self._stop_event.is_set() and time.time() < self.ends_at:
            model = random.choice(MODEL_OPTIONS)
            use_stream = model in self.stream_models
            payload: dict[str, Any] = {
                "model": model,
                "messages": [{"role": "user", "content": "observability traffic simulation"}],
            }
            if use_stream:
                payload["stream"] = True
            result = await proxy_chat_completions(self.target_host, self.target_port, payload)
            async with self._lock:
                self.stats.record(
                    model,
                    int(result.get("status_code") or 0),
                    result.get("error"),
                )
            delay = random.uniform(MIN_INTERVAL_SEC, MAX_INTERVAL_SEC)
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=delay)
                break
            except asyncio.TimeoutError:
                pass

    async def _run_loop(self) -> None:
        try:
            workers = [asyncio.create_task(self._worker_loop()) for _ in range(self.concurrency)]
            await asyncio.gather(*workers, return_exceptions=True)
        finally:
            async with self._lock:
                self.running = False
                self._task = None


obs_traffic_simulator = ObsTrafficSimulator()

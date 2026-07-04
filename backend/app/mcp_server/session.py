from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SessionState:
    session_id: str
    created_at: float = field(default_factory=time.time)
    pending: dict[Any, asyncio.Future[Any]] = field(default_factory=dict)

    async def wait_for(self, msg_id: Any, timeout: float = 30.0) -> Any:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[Any] = loop.create_future()
        self.pending[msg_id] = fut
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self.pending.pop(msg_id, None)

    def resolve(self, msg_id: Any, result: Any) -> bool:
        fut = self.pending.get(msg_id)
        if fut is None or fut.done():
            return False
        fut.set_result(result)
        return True


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}

    def create(self) -> SessionState:
        sid = secrets.token_urlsafe(24)
        state = SessionState(session_id=sid)
        self._sessions[sid] = state
        return state

    def get(self, session_id: str | None) -> SessionState | None:
        if not session_id:
            return None
        return self._sessions.get(session_id)

    def delete(self, session_id: str | None) -> None:
        if session_id:
            self._sessions.pop(session_id, None)

    @property
    def count(self) -> int:
        return len(self._sessions)


sessions = SessionStore()

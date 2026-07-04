"""MCP Client runner for demo — drives full or partial MCP sessions."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

import httpx

from backend.app.mcp_audit import (
    build_audit_event,
    classify_message_type,
    new_trace_id,
    params_summary_for_request,
    post_audit_events,
)

EventCallback = Callable[[dict[str, Any]], Awaitable[None] | None]


def _utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class MCPClientRunner:
    def __init__(
        self,
        target_url: str,
        agent_identity: str,
        tenant: str,
        *,
        client_ip: str = "127.0.0.1",
        adapter_events_url: str | None = None,
        emit_audit: bool = True,
        pool_member: str = "direct:9001",
    ) -> None:
        self.url = target_url.rstrip("/")
        if not self.url.endswith("/mcp"):
            self.url = f"{self.url}/mcp"
        self.agent_identity = agent_identity
        self.tenant = tenant
        self.client_ip = client_ip
        self.adapter_events_url = adapter_events_url
        self.emit_audit = emit_audit
        self.pool_member = pool_member
        self.session_id: str | None = None
        self.protocol_version = "2025-11-25"
        self.msg_counter = 0
        self.events: list[dict[str, Any]] = []
        self._on_event: EventCallback | None = None
        self._audit_buffer: list[dict[str, Any]] = []
        self._audit_results: list[dict[str, Any]] = []
        self._stats = {
            "tool_calls": 0,
            "sampling": 0,
            "elicitation": 0,
            "messages": 0,
            "duration_ms": 0,
        }
        self._session_start = 0.0

    def set_event_callback(self, cb: EventCallback | None) -> None:
        self._on_event = cb

    def next_id(self) -> int:
        self.msg_counter += 1
        return self.msg_counter

    def build_headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": self.protocol_version,
            "X-Agent-Identity": self.agent_identity,
            "X-Tenant-Id": self.tenant,
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        return headers

    async def _emit(self, event: dict[str, Any]) -> None:
        self.events.append(event)
        if self._on_event:
            result = self._on_event(event)
            if result is not None:
                await result

    async def _record(
        self,
        direction: str,
        msg: dict[str, Any],
        *,
        phase: str = "operation",
        summary: str | None = None,
        highlight: str | None = None,
    ) -> None:
        method = msg.get("method")
        await self._emit(
            {
                "ts": _utc_iso(),
                "direction": direction,
                "phase": phase,
                "method": method or ("response" if "result" in msg else "notification"),
                "summary": summary or self._summarize_msg(msg),
                "jsonrpc_id": msg.get("id"),
                "highlight": highlight,
                "msg": msg,
            }
        )

    @staticmethod
    def _summarize_msg(msg: dict[str, Any]) -> str:
        method = msg.get("method")
        if method == "tools/call":
            params = msg.get("params") or {}
            return f"tools/call({params.get('name', '')})"
        if method:
            return method
        if msg.get("error"):
            return f"error: {msg['error'].get('message', '')}"
        return "response"

    def _queue_audit(
        self,
        *,
        event_type: str,
        trace_id: str,
        message_type: str,
        latency_ms: float,
        body: dict[str, Any],
        status: str = "success",
        error_info: str = "",
        sse_sampling: int = 0,
        sse_elicitation: int = 0,
        sse_events: int = 0,
    ) -> None:
        if not self.emit_audit:
            return
        tool_name = ""
        if body.get("method") == "tools/call":
            tool_name = (body.get("params") or {}).get("name", "")
        self._audit_buffer.append(
            build_audit_event(
                event_type=event_type,
                trace_id=trace_id,
                mcp_session_id=self.session_id or "new",
                agent_identity=self.agent_identity,
                tenant_id=self.tenant,
                client_ip=self.client_ip,
                message_type=message_type,
                latency_ms=latency_ms,
                status=status,
                tool_name=tool_name,
                jsonrpc_id=str(body.get("id", "")),
                params_summary=params_summary_for_request(body),
                error_info=error_info,
                pool_member=self.pool_member,
                sse_sampling_count=sse_sampling,
                sse_elicitation_count=sse_elicitation,
                sse_event_count=sse_events,
            )
        )

    async def _emit_audit_progress(self) -> None:
        if not self._on_event:
            return
        accepted = sum(1 for r in self._audit_results if r.get("accepted"))
        total = len(self._audit_results)
        await self._on_event(
            {
                "type": "audit_progress",
                "accepted": accepted,
                "total": total,
                "failed": total - accepted,
                "adapter_url": self.adapter_events_url,
            }
        )

    async def flush_audit(self) -> list[dict[str, Any]]:
        if not self.adapter_events_url or not self._audit_buffer:
            self._audit_buffer.clear()
            return []
        events = list(self._audit_buffer)
        self._audit_buffer.clear()
        results = await post_audit_events(self.adapter_events_url, events)
        self._audit_results.extend(results)
        await self._emit_audit_progress()
        return results

    async def post(self, payload: dict[str, Any]) -> Any:
        trace_id = new_trace_id()
        t0 = time.perf_counter()
        sse_sampling = 0
        sse_elicitation = 0
        sse_events = 0
        status = "success"
        error_info = ""

        await self._record("client→server", payload, phase=self._phase_for(payload))

        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                self.url,
                content=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers=self.build_headers(),
                timeout=60.0,
            ) as resp:
                if "mcp-session-id" in {k.lower() for k in resp.headers}:
                    for k, v in resp.headers.items():
                        if k.lower() == "mcp-session-id":
                            self.session_id = v
                            break

                if resp.status_code == 202:
                    latency = (time.perf_counter() - t0) * 1000
                    self._queue_audit(
                        event_type="mcp_request_completed",
                        trace_id=trace_id,
                        message_type=classify_message_type(payload.get("method"), payload),
                        latency_ms=latency,
                        body=payload,
                        status="accepted",
                    )
                    await self.flush_audit()
                    return None

                content_type = resp.headers.get("content-type", "")
                if content_type.startswith("text/event-stream"):
                    final = await self._process_sse_stream(resp, payload.get("id"), trace_id)
                    latency = (time.perf_counter() - t0) * 1000
                    self._queue_audit(
                        event_type="mcp_request_completed",
                        trace_id=trace_id,
                        message_type=classify_message_type(payload.get("method"), payload),
                        latency_ms=latency,
                        body=payload,
                        status=status,
                        error_info=error_info,
                        sse_sampling=sse_sampling,
                        sse_elicitation=sse_elicitation,
                        sse_events=sse_events,
                    )
                    await self.flush_audit()
                    return final

                body = await resp.aread()
                try:
                    data = json.loads(body)
                except json.JSONDecodeError:
                    data = {"raw": body.decode("utf-8", errors="replace")}
                latency = (time.perf_counter() - t0) * 1000
                self._queue_audit(
                    event_type="mcp_request_completed",
                    trace_id=trace_id,
                    message_type=classify_message_type(payload.get("method"), payload),
                    latency_ms=latency,
                    body=payload,
                )
                await self.flush_audit()
                return data

    def _phase_for(self, payload: dict[str, Any]) -> str:
        method = payload.get("method")
        if method == "initialize":
            return "lifecycle"
        if method in ("tools/list", "prompts/list", "resources/list"):
            return "discovery"
        return "operation"

    async def _process_sse_stream(
        self,
        resp: httpx.Response,
        original_request_id: Any,
        parent_trace_id: str,
    ) -> Any:
        final_result = None
        sse_count = 0
        sampling_count = 0
        elicitation_count = 0

        async for line in resp.aiter_lines():
            if not line.startswith("data:"):
                continue
            raw = line[5:].strip()
            if not raw:
                continue
            msg = json.loads(raw)
            sse_count += 1
            method = msg.get("method")

            if method == "sampling/createMessage":
                sampling_count += 1
                await self._record("server→client", msg, highlight="sampling")
                if self.emit_audit:
                    self._audit_buffer.append(
                        build_audit_event(
                            event_type="mcp_sse_sampling_request",
                            trace_id=f"{parent_trace_id}-sampling",
                            mcp_session_id=self.session_id or "new",
                            agent_identity=self.agent_identity,
                            tenant_id=self.tenant,
                            client_ip=self.client_ip,
                            message_type="server.sampling_request",
                            latency_ms=0,
                            tool_name=(msg.get("params") or {}).get("name", ""),
                            jsonrpc_id=str(msg.get("id", "")),
                            params_summary="server→client,sampling/createMessage",
                            pool_member=self.pool_member,
                            sse_sampling_count=1,
                            sse_event_count=sse_count,
                        )
                    )
                    await self.flush_audit()
                self._stats["sampling"] += 1
                await self.post(
                    {
                        "jsonrpc": "2.0",
                        "id": msg["id"],
                        "result": {
                            "role": "assistant",
                            "content": {
                                "type": "text",
                                "text": "[模拟AI分析] 建议优先处理 CPU/内存异常，重启相关实例并在 15 分钟内确认恢复。",
                            },
                            "model": "mock-llm-v1",
                            "stopReason": "endTurn",
                        },
                    }
                )
                continue

            if method == "elicitation/create":
                elicitation_count += 1
                await self._record("server→client", msg, highlight="elicitation", summary="elicitation/create")
                if self.emit_audit:
                    self._audit_buffer.append(
                        build_audit_event(
                            event_type="mcp_sse_elicitation_request",
                            trace_id=f"{parent_trace_id}-elicitation",
                            mcp_session_id=self.session_id or "new",
                            agent_identity=self.agent_identity,
                            tenant_id=self.tenant,
                            client_ip=self.client_ip,
                            message_type="server.elicitation_request",
                            latency_ms=0,
                            params_summary="server→client,elicitation/create",
                            pool_member=self.pool_member,
                            sse_elicitation_count=1,
                            sse_event_count=sse_count,
                        )
                    )
                    await self.flush_audit()
                self._stats["elicitation"] += 1
                await self.post(
                    {
                        "jsonrpc": "2.0",
                        "id": msg["id"],
                        "result": {
                            "action": "accept",
                            "content": self._auto_fill_elicitation(msg.get("params") or {}),
                        },
                    }
                )
                continue

            if method == "notifications/message":
                await self._record("server→client", msg, highlight="logging")
                continue

            await self._record("server→client", msg)

            if msg.get("id") == original_request_id:
                final_result = msg.get("result")
                if msg.get("error"):
                    final_result = msg

        self._stats["messages"] += sse_count
        return final_result

    def _auto_fill_elicitation(self, params: dict[str, Any]) -> dict[str, Any]:
        schema = params.get("requestedSchema") or {}
        props = schema.get("properties") or {}
        result: dict[str, Any] = {}
        for key, prop in props.items():
            if prop.get("type") == "boolean":
                result[key] = prop.get("default", True)
            elif "enum" in prop:
                result[key] = prop["enum"][0]
            else:
                result[key] = prop.get("default", "auto-filled")
        return result

    async def post_delete(self) -> None:
        trace_id = new_trace_id()
        t0 = time.perf_counter()
        async with httpx.AsyncClient() as client:
            await client.delete(self.url, headers=self.build_headers(), timeout=30.0)
        latency = (time.perf_counter() - t0) * 1000
        self._queue_audit(
            event_type="mcp_session_terminated",
            trace_id=trace_id,
            message_type="lifecycle.session_terminate",
            latency_ms=latency,
            body={"method": "DELETE"},
        )
        await self.flush_audit()
        await self._emit(
            {
                "ts": _utc_iso(),
                "direction": "client→server",
                "phase": "lifecycle",
                "method": "DELETE",
                "summary": "session close",
                "msg": {
                    "http_method": "DELETE",
                    "url": self.url,
                    "headers": {
                        "Mcp-Session-Id": self.session_id,
                        "MCP-Protocol-Version": self.protocol_version,
                    },
                },
            }
        )

    def _client_info(self) -> dict[str, str]:
        """MCP initialize clientInfo — reflects selected Agent / Tenant in the demo UI."""
        return {
            "name": self.agent_identity,
            "title": f"tenant={self.tenant}",
            "version": "1.0.0",
        }

    async def ensure_session(self) -> None:
        if self.session_id:
            return
        await self.post(
            {
                "jsonrpc": "2.0",
                "id": self.next_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {"sampling": {}, "elicitation": {"form": {}, "url": {}}},
                    "clientInfo": self._client_info(),
                },
            }
        )
        await self.post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    async def run_full_session(self) -> dict[str, Any]:
        return await self.run_scenario("full")

    async def run_scenario(self, scenario_id: str) -> dict[str, Any]:
        self._session_start = time.perf_counter()
        self.events.clear()
        self._audit_results.clear()
        self._stats = {"tool_calls": 0, "sampling": 0, "elicitation": 0, "messages": 0, "duration_ms": 0}

        if scenario_id == "full":
            await self._run_full_flow()
        elif scenario_id == "lifecycle":
            await self.ensure_session()
            await self.post_delete()
        elif scenario_id == "tools_list":
            await self.ensure_session()
            await self.post({"jsonrpc": "2.0", "id": self.next_id(), "method": "tools/list"})
        elif scenario_id == "tool_call_alert":
            await self.ensure_session()
            await self._tool_call(
                "query_alert", {"severity": "critical", "time_range": "1h"}
            )
        elif scenario_id == "tool_call_restart":
            await self.ensure_session()
            await self._tool_call(
                "restart_service",
                {"service_name": "payment-api", "environment": "test", "instance_id": "auto"},
            )
        elif scenario_id == "prompts_get":
            await self.ensure_session()
            await self.post(
                {
                    "jsonrpc": "2.0",
                    "id": self.next_id(),
                    "method": "prompts/get",
                    "params": {
                        "name": "incident_analysis",
                        "arguments": {"incident_id": "INC-20260703-001"},
                    },
                }
            )
        elif scenario_id == "resources_read":
            await self.ensure_session()
            await self.post(
                {
                    "jsonrpc": "2.0",
                    "id": self.next_id(),
                    "method": "resources/read",
                    "params": {"uri": "ops://metrics/cpu-usage"},
                }
            )
        else:
            raise ValueError(f"Unknown scenario: {scenario_id}")

        await self.flush_audit()
        self._stats["duration_ms"] = int((time.perf_counter() - self._session_start) * 1000)
        accepted = sum(1 for r in self._audit_results if r.get("accepted"))
        failed = len(self._audit_results) - accepted
        audit_summary: dict[str, Any] = {
            "total": len(self._audit_results),
            "accepted": accepted,
            "failed": failed,
            "source": "runner" if self.emit_audit else "f5",
        }
        if self.emit_audit:
            audit_summary["adapter_url"] = self.adapter_events_url
        return {
            "stats": dict(self._stats),
            "events": self.events,
            "audit_results": self._audit_results if self.emit_audit else [],
            "audit_summary": audit_summary,
            "session_id": self.session_id,
        }

    async def _tool_call(self, name: str, arguments: dict[str, Any]) -> None:
        self._stats["tool_calls"] += 1
        await self.post(
            {
                "jsonrpc": "2.0",
                "id": self.next_id(),
                "method": "tools/call",
                "params": {"name": name, "arguments": arguments},
            }
        )

    async def _run_full_flow(self) -> None:
        await self.ensure_session()
        await self.post({"jsonrpc": "2.0", "id": self.next_id(), "method": "tools/list"})
        await self.post({"jsonrpc": "2.0", "id": self.next_id(), "method": "prompts/list"})
        await self.post({"jsonrpc": "2.0", "id": self.next_id(), "method": "resources/list"})
        await self._tool_call("query_alert", {"severity": "critical", "time_range": "1h"})
        await self._tool_call(
            "get_service_status", {"service_name": "payment-api", "environment": "prod"}
        )
        await self.post(
            {
                "jsonrpc": "2.0",
                "id": self.next_id(),
                "method": "prompts/get",
                "params": {
                    "name": "incident_analysis",
                    "arguments": {"incident_id": "INC-20260703-001"},
                },
            }
        )
        await self.post(
            {
                "jsonrpc": "2.0",
                "id": self.next_id(),
                "method": "resources/read",
                "params": {"uri": "ops://metrics/cpu-usage"},
            }
        )
        await self._tool_call(
            "restart_service",
            {"service_name": "payment-api", "environment": "test", "instance_id": "auto"},
        )
        await self._tool_call(
            "create_incident",
            {
                "title": "payment-api 性能降级",
                "severity": "P2",
                "description": "CPU>90% 持续 30 分钟",
                "assignee": "ops-team",
            },
        )
        await self.post_delete()

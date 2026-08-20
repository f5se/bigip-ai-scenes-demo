"""FastAPI routes for MCP Tools Insight demo."""

from __future__ import annotations

import json
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.app.config import MCP_INSIGHT_DEMO, MCP_INSIGHT_DEMO_V2026
from backend.app.mcp_client_runner import MCPClientRunner
from backend.app.mcp_traffic_sim import mcp_traffic_simulator, mcp_traffic_simulator_v2026
from backend.app.proxy import validate_target

router = APIRouter(tags=["mcp-insight"])


class McpTarget(BaseModel):
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=9001, ge=1, le=65535)
    use_tls: bool = False


class McpRunRequest(BaseModel):
    target: McpTarget | None = None
    agent: str = "monitoring-agent"
    tenant: str = "ops-team"
    scenario: str = "full"
    emit_audit: bool | None = None
    adapter_url: str | None = None


class McpTrafficStartRequest(BaseModel):
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=9001, ge=1, le=65535)
    duration_minutes: int = Field(default=10, ge=1, le=180)
    emit_audit: bool | None = None
    adapter_url: str | None = None


def _target_url(target: McpTarget) -> str:
    scheme = "https" if target.use_tls else "http"
    return f"{scheme}://{target.host}:{target.port}/mcp"


def _default_target(profile: dict[str, Any]) -> McpTarget:
    vs = profile["default_vs"]
    assert isinstance(vs, dict)
    return McpTarget(host=str(vs["host"]), port=int(vs["port"]))


def _adapter_url(profile: dict[str, Any], override: str | None = None) -> str:
    if override:
        return override
    return str(profile.get("adapter_events_url", "http://127.0.0.1:8090/api/mcp-events"))


def _default_emit_audit(profile: dict[str, Any]) -> bool:
    """True = Demo Runner simulates F5 and POSTs Adapter; False = F5 iRule sends logs."""
    return bool(profile.get("emit_audit_without_f5", True))


def _resolve_emit_audit(profile: dict[str, Any], explicit: bool | None) -> bool:
    """F5 mode (emit_audit_without_f5=False) always disables Runner POST, even if client sends true."""
    if not _default_emit_audit(profile):
        return False
    if explicit is not None:
        return explicit
    return True


def _audit_delivery_mode(profile: dict[str, Any]) -> str:
    return "runner" if _default_emit_audit(profile) else "f5"


def _protocol_version(profile: dict[str, Any]) -> str:
    return str(profile.get("protocol_version", "2025-11-25"))


def _make_runner(
    target: McpTarget,
    agent: str,
    tenant: str,
    profile: dict[str, Any],
    *,
    emit_audit: bool,
    adapter_url: str | None,
) -> MCPClientRunner:
    validate_target(target.host, target.port)
    pool_member = f"{target.host}:{target.port}"
    return MCPClientRunner(
        _target_url(target),
        agent,
        tenant,
        adapter_events_url=_adapter_url(profile, adapter_url) if emit_audit else None,
        emit_audit=emit_audit,
        pool_member=pool_member,
        protocol_version=_protocol_version(profile),
    )


@router.get("/api/demo/mcp-insight/config")
async def mcp_insight_config() -> dict[str, Any]:
    payload = dict(MCP_INSIGHT_DEMO)
    payload["audit_delivery"] = _audit_delivery_mode(MCP_INSIGHT_DEMO)
    return payload


@router.get("/api/demo/mcp-insight-v2026/config")
async def mcp_insight_config_v2026() -> dict[str, Any]:
    payload = dict(MCP_INSIGHT_DEMO_V2026)
    payload["audit_delivery"] = _audit_delivery_mode(MCP_INSIGHT_DEMO_V2026)
    return payload


@router.get("/api/demo/mcp-insight-v2026/wire-examples")
async def mcp_insight_wire_examples_v2026() -> dict[str, Any]:
    from backend.app.mcp_protocol import wire_examples

    return wire_examples()


@router.get("/api/demo/mcp-insight/health")
async def mcp_insight_health(
    target_host: str = Query(default="127.0.0.1"),
    target_port: int = Query(default=9001, ge=1, le=65535),
) -> dict[str, Any]:
    validate_target(target_host, target_port)
    mcp_ok = False
    adapter_ok = False
    mcp_detail: str | None = None
    adapter_detail: str | None = None

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            mcp_resp = await client.get(f"http://{target_host}:{target_port}/health")
            mcp_ok = mcp_resp.status_code == 200
            if mcp_ok:
                mcp_detail = str(mcp_resp.json())
    except Exception as exc:  # noqa: BLE001
        mcp_detail = str(exc)

    adapter_base = _adapter_url(MCP_INSIGHT_DEMO).replace("/api/mcp-events", "")
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            a_resp = await client.get(f"{adapter_base}/health")
            adapter_ok = a_resp.status_code == 200
    except Exception as exc:  # noqa: BLE001
        adapter_detail = str(exc)

    return {
        "mcp_server": {"ok": mcp_ok, "target": f"{target_host}:{target_port}", "detail": mcp_detail},
        "adapter": {"ok": adapter_ok, "url": adapter_base, "detail": adapter_detail},
    }


@router.get("/api/demo/mcp-insight-v2026/health")
async def mcp_insight_health_v2026(
    target_host: str = Query(default="127.0.0.1"),
    target_port: int = Query(default=9020, ge=1, le=65535),
) -> dict[str, Any]:
    validate_target(target_host, target_port)
    return await mcp_insight_health(target_host=target_host, target_port=target_port)


@router.post("/api/demo/mcp-insight/run")
async def mcp_insight_run(req: McpRunRequest) -> dict[str, Any]:
    target = req.target or _default_target(MCP_INSIGHT_DEMO)
    emit_audit = _resolve_emit_audit(MCP_INSIGHT_DEMO, req.emit_audit)
    runner = _make_runner(
        target,
        req.agent,
        req.tenant,
        MCP_INSIGHT_DEMO,
        emit_audit=emit_audit,
        adapter_url=req.adapter_url,
    )
    try:
        return await runner.run_scenario(req.scenario)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"MCP request failed: {exc}") from exc


@router.post("/api/demo/mcp-insight-v2026/run")
async def mcp_insight_run_v2026(req: McpRunRequest) -> dict[str, Any]:
    target = req.target or _default_target(MCP_INSIGHT_DEMO_V2026)
    emit_audit = _resolve_emit_audit(MCP_INSIGHT_DEMO_V2026, req.emit_audit)
    runner = _make_runner(
        target,
        req.agent,
        req.tenant,
        MCP_INSIGHT_DEMO_V2026,
        emit_audit=emit_audit,
        adapter_url=req.adapter_url,
    )
    try:
        return await runner.run_scenario(req.scenario)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"MCP request failed: {exc}") from exc


@router.get("/api/demo/mcp-insight/run-stream")
async def mcp_insight_run_stream(
    agent: str = Query(default="monitoring-agent"),
    tenant: str = Query(default="ops-team"),
    scenario: str = Query(default="full"),
    host: str = Query(default="127.0.0.1"),
    port: int = Query(default=9001, ge=1, le=65535),
    emit_audit: bool | None = Query(default=None),
    adapter_url: str | None = Query(default=None),
) -> StreamingResponse:
    import asyncio

    target = McpTarget(host=host, port=port)
    effective_emit_audit = _resolve_emit_audit(MCP_INSIGHT_DEMO, emit_audit)
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def event_generator():
        runner = _make_runner(
            target,
            agent,
            tenant,
            MCP_INSIGHT_DEMO,
            emit_audit=effective_emit_audit,
            adapter_url=adapter_url,
        )

        async def on_event(event: dict[str, Any]) -> None:
            if event.get("type") == "audit_progress":
                await queue.put(
                    f"event: audit\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                )
                return
            await queue.put(f"data: {json.dumps(event, ensure_ascii=False)}\n\n")

        runner.set_event_callback(on_event)

        async def run_session() -> None:
            try:
                result = await runner.run_scenario(scenario)
                complete_payload = {
                    "stats": result.get("stats"),
                    "audit_summary": result.get("audit_summary"),
                    "audit_delivery": _audit_delivery_mode(MCP_INSIGHT_DEMO),
                    "session_id": result.get("session_id"),
                }
                await queue.put(
                    f"event: complete\ndata: {json.dumps(complete_payload, ensure_ascii=False)}\n\n"
                )
            except Exception as exc:  # noqa: BLE001
                await queue.put(
                    f"event: error\ndata: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n"
                )
            finally:
                await queue.put(None)

        task = asyncio.create_task(run_session())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            await task

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/api/demo/mcp-insight-v2026/run-stream")
async def mcp_insight_run_stream_v2026(
    agent: str = Query(default="monitoring-agent"),
    tenant: str = Query(default="ops-team"),
    scenario: str = Query(default="full"),
    host: str = Query(default="127.0.0.1"),
    port: int = Query(default=9020, ge=1, le=65535),
    emit_audit: bool | None = Query(default=None),
    adapter_url: str | None = Query(default=None),
) -> StreamingResponse:
    import asyncio

    target = McpTarget(host=host, port=port)
    effective_emit_audit = _resolve_emit_audit(MCP_INSIGHT_DEMO_V2026, emit_audit)
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def event_generator():
        runner = _make_runner(
            target,
            agent,
            tenant,
            MCP_INSIGHT_DEMO_V2026,
            emit_audit=effective_emit_audit,
            adapter_url=adapter_url,
        )

        async def on_event(event: dict[str, Any]) -> None:
            if event.get("type") == "audit_progress":
                await queue.put(
                    f"event: audit\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                )
                return
            await queue.put(f"data: {json.dumps(event, ensure_ascii=False)}\n\n")

        runner.set_event_callback(on_event)

        async def run_session() -> None:
            try:
                result = await runner.run_scenario(scenario)
                complete_payload = {
                    "stats": result.get("stats"),
                    "audit_summary": result.get("audit_summary"),
                    "audit_delivery": _audit_delivery_mode(MCP_INSIGHT_DEMO_V2026),
                    "session_id": result.get("session_id"),
                }
                await queue.put(
                    f"event: complete\ndata: {json.dumps(complete_payload, ensure_ascii=False)}\n\n"
                )
            except Exception as exc:  # noqa: BLE001
                await queue.put(
                    f"event: error\ndata: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n"
                )
            finally:
                await queue.put(None)

        task = asyncio.create_task(run_session())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            await task

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/api/demo/mcp-insight/traffic/status")
async def mcp_insight_traffic_status() -> dict[str, Any]:
    return mcp_traffic_simulator.status()


@router.post("/api/demo/mcp-insight/traffic/start")
async def mcp_insight_traffic_start(req: McpTrafficStartRequest) -> dict[str, Any]:
    try:
        validate_target(req.host, req.port)
    except HTTPException:
        raise
    emit_audit = _resolve_emit_audit(MCP_INSIGHT_DEMO, req.emit_audit)
    try:
        return await mcp_traffic_simulator.start(
            req.host,
            req.port,
            req.duration_minutes,
            emit_audit=emit_audit,
            adapter_url=_adapter_url(MCP_INSIGHT_DEMO, req.adapter_url) if emit_audit else None,
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail=exc.detail) from exc
        raise


@router.get("/api/demo/mcp-insight-v2026/traffic/status")
async def mcp_insight_traffic_status_v2026() -> dict[str, Any]:
    return mcp_traffic_simulator_v2026.status()


@router.post("/api/demo/mcp-insight-v2026/traffic/start")
async def mcp_insight_traffic_start_v2026(req: McpTrafficStartRequest) -> dict[str, Any]:
    try:
        validate_target(req.host, req.port)
    except HTTPException:
        raise
    emit_audit = _resolve_emit_audit(MCP_INSIGHT_DEMO_V2026, req.emit_audit)
    try:
        return await mcp_traffic_simulator_v2026.start(
            req.host,
            req.port,
            req.duration_minutes,
            emit_audit=emit_audit,
            adapter_url=_adapter_url(MCP_INSIGHT_DEMO_V2026, req.adapter_url) if emit_audit else None,
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail=exc.detail) from exc
        raise


@router.post("/api/demo/mcp-insight-v2026/traffic/stop")
async def mcp_insight_traffic_stop_v2026() -> dict[str, Any]:
    return await mcp_traffic_simulator_v2026.stop()


@router.post("/api/demo/mcp-insight/traffic/stop")
async def mcp_insight_traffic_stop() -> dict[str, Any]:
    return await mcp_traffic_simulator.stop()

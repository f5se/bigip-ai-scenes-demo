"""FastAPI routes for MCP Tools Control (Tier 1 / Tier 2) demo."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.config import MCP_CONTROL_DEMO
from backend.app.mcp_control_runner import McpControlRunner
from backend.app.mcp_control_traffic_sim import mcp_control_traffic_simulator
from backend.app.proxy import validate_target

router = APIRouter(tags=["mcp-control"])


class McpControlRunRequest(BaseModel):
    agent_id: str = Field(default="ops-admin-agent")
    target_server_id: str = Field(default="ops")
    scenario: str = Field(default="tier1")
    tool_name: str | None = Field(default=None)


class McpControlTrafficStartRequest(BaseModel):
    duration_minutes: int = Field(default=10, ge=1, le=180)


def _public_config() -> dict[str, Any]:
    agents = MCP_CONTROL_DEMO.get("agent_identities", [])
    assert isinstance(agents, list)
    return {
        "agent_identities": [
            {"id": a["id"], "label": a["label"]}
            for a in agents
            if isinstance(a, dict)
        ],
        "target_servers": MCP_CONTROL_DEMO.get("target_servers", []),
        "default_vs": MCP_CONTROL_DEMO.get("default_vs"),
        "oauth_token_url": MCP_CONTROL_DEMO.get("oauth_token_url"),
        "token_mode": MCP_CONTROL_DEMO.get("token_mode"),
        "client_id": MCP_CONTROL_DEMO.get("client_id"),
        "matrix_hint": {
            "ops-admin-agent": ["ops"],
            "ops-readonly-agent": ["ops"],
            "finance-agent": ["finance"],
            "guest-agent": [],
        },
    }


@router.get("/api/demo/mcp-tools-control/config")
async def mcp_control_config() -> dict[str, Any]:
    return _public_config()


@router.post("/api/demo/mcp-tools-control/run")
async def mcp_control_run(req: McpControlRunRequest) -> dict[str, Any]:
    try:
        runner = McpControlRunner(req.agent_id, req.target_server_id)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        return await runner.run(scenario=req.scenario, tool_name=req.tool_name)
    except httpx.HTTPStatusError as exc:
        return {
            "agent": req.agent_id,
            "target_server": req.target_server_id,
            "token_obtained": False,
            "decision": "deny",
            "error": f"OAuth token request failed: {exc.response.status_code}",
            "error_body": exc.response.text[:400],
            "gateway_result": None,
        }
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Upstream request failed: {exc}",
        ) from exc


@router.get("/api/demo/mcp-tools-control/health")
async def mcp_control_health() -> dict[str, Any]:
    vs = MCP_CONTROL_DEMO.get("default_vs", {})
    assert isinstance(vs, dict)
    vs_host = str(vs.get("host", "127.0.0.1"))
    vs_port = int(vs.get("port", 9010))
    validate_target(vs_host, vs_port)

    backends = MCP_CONTROL_DEMO.get("backend_servers", [])
    assert isinstance(backends, list)

    result: dict[str, Any] = {
        "vs": {"host": vs_host, "port": vs_port, "ok": False, "detail": None},
        "backends": {},
        "oauth_token_url": MCP_CONTROL_DEMO.get("oauth_token_url"),
    }

    async with httpx.AsyncClient(timeout=3.0, follow_redirects=False) as client:
        try:
            # VS without JWT may deny; connectivity OK if we get any HTTP response
            vs_resp = await client.get(f"http://{vs_host}:{vs_port}/")
            result["vs"]["ok"] = True
            result["vs"]["detail"] = f"HTTP {vs_resp.status_code}"
        except Exception as exc:
            result["vs"]["detail"] = str(exc)

        for b in backends:
            if not isinstance(b, dict):
                continue
            bid = str(b.get("id", "unknown"))
            host = str(b.get("host", "127.0.0.1"))
            port = int(b.get("port", 9001))
            try:
                validate_target(host, port)
                r = await client.get(f"http://{host}:{port}/health")
                result["backends"][bid] = {
                    "ok": r.status_code == 200,
                    "target": f"{host}:{port}",
                    "detail": r.text[:120],
                }
            except Exception as exc:
                result["backends"][bid] = {
                    "ok": False,
                    "target": f"{host}:{port}",
                    "detail": str(exc),
                }

    return result


@router.get("/api/demo/mcp-tools-control/traffic/status")
async def mcp_control_traffic_status() -> dict[str, Any]:
    return mcp_control_traffic_simulator.status()


@router.post("/api/demo/mcp-tools-control/traffic/start")
async def mcp_control_traffic_start(req: McpControlTrafficStartRequest) -> dict[str, Any]:
    try:
        return await mcp_control_traffic_simulator.start(req.duration_minutes)
    except HTTPException as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail=exc.detail) from exc
        raise


@router.post("/api/demo/mcp-tools-control/traffic/stop")
async def mcp_control_traffic_stop() -> dict[str, Any]:
    return await mcp_control_traffic_simulator.stop()

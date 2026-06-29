from pathlib import Path
from typing import Any
import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.app.agent_demo import BASE_IDENTITY_MODES, run_agent_routing_demo
from backend.app.agent_traffic_sim import agent_traffic_simulator
from backend.app.config import (
    AGENT_ROUTING,
    CONTEXT_SIZE_RULE,
    DEMO_CASES,
    MODEL_OPTIONS,
    MODEL_POOL_MAP,
    RETRY_FALLBACK_RULE,
    SYSTEM_PROMPT,
    TBLB_DEMO_DEFAULT_ITERATIONS,
    TBLB_DEMO_POOLS,
    settings,
)
from backend.app.context_demo import run_multiturn_context_demo, run_single_context_demo
from backend.app.context_size import (
    build_multiturn_crossing,
    build_single_user_messages,
    calc_messages_bytes,
    resolve_expected_route,
)
from backend.app.demo import run_model_routing_demo
from backend.app.proxy import proxy_chat_completions, validate_target
from backend.app.obs_traffic_sim import obs_traffic_simulator
from backend.app.tblb_scheduler import fetch_scheduler_pool_status, trigger_members_load
from backend.app.retry_fallback_demo import (
    enable_demo_guard_member,
    get_demo_guard_member_status,
    get_retry_status_counter,
    prepare_tcp_reselect,
    run_retry_status_demo,
    run_tcp_force_fallback_demo,
    run_tcp_reselect_demo,
)
from backend.app.max_tokens_demo import (
    DEFAULT_USER_MESSAGE,
    build_max_tokens_payload,
    get_max_tokens_config,
    resolve_max_tokens_policy,
)
from backend.app.model_allowlist_demo import get_model_allowlist_config, resolve_model_policy
from backend.app.system_prompt import (
    DEMO_MODEL,
    SYSTEM_PROMPT_PRESETS,
    analyze_response,
    build_client_payload,
    preview_wrap,
)
from backend.app.auth import install_auth
from backend.app.grafana_login import build_grafana_open_redirect
from backend.app.runtime_config import get_grafana_url, grafana_auto_login_enabled

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = ROOT / "frontend" / "dist"

app = FastAPI(title="F5 LLM Router Demo", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

install_auth(app)


class Target(BaseModel):
    host: str = Field(default=settings.default_vs_host)
    port: int = Field(default=settings.default_vs_port, ge=1, le=65535)


class ProxyRequest(BaseModel):
    target: Target
    payload: dict[str, Any]
    extra_headers: dict[str, str] | None = None


class MaxTokensRunRequest(BaseModel):
    target: Target
    max_tokens: int = Field(gt=0)
    user_content: str | None = None


class DemoRunRequest(BaseModel):
    target: Target
    cases: list[str] | str = "all"
    interval_ms: int | None = None


class AgentRoutingRunRequest(BaseModel):
    target: Target
    identity_mode: str = Field(
        description="header | system_name | model_field | random",
    )
    user_prompt: str = Field(min_length=1, max_length=4000)
    agents: list[str] | None = None
    interval_ms: int | None = None
    agent_identity_modes: dict[str, str] | None = None


class AgentTrafficStartRequest(BaseModel):
    target: Target
    identity_mode: str = Field(
        description="header | system_name | model_field | random",
    )
    user_prompt: str = Field(min_length=1, max_length=4000)
    duration_minutes: int = Field(default=10, ge=1, le=180)


class ContextSizeCalcRequest(BaseModel):
    target_messages_bytes: int = Field(ge=0, le=2_000_000)
    messages: list[dict[str, Any]] | None = None


class ContextSingleDemoRequest(BaseModel):
    target: Target
    target_messages_bytes: int = Field(ge=0, le=2_000_000)


class ContextMultiturnDemoRequest(BaseModel):
    target: Target


class RetryFallbackDemoRequest(BaseModel):
    target: Target


class TblbMemberRef(BaseModel):
    ip: str
    port: int = Field(ge=1, le=65535)


class TblbTriggerLoadRequest(BaseModel):
    members: list[TblbMemberRef]
    path: str | None = None


class ObsTrafficStartRequest(BaseModel):
    target: Target
    duration_minutes: int = Field(default=10, ge=1, le=180)
    concurrency: int = Field(default=5, ge=1, le=10)
    started_from: str = Field(description="obsTokens or obsMetrics")
    stream_mode: str = Field(
        default="mixed",
        description="non_stream | stream | mixed (random ~half models use stream)",
    )


class SystemPromptPreviewRequest(BaseModel):
    system_content: str = Field(min_length=1, max_length=8000)
    user_content: str = Field(min_length=1, max_length=4000)
    model: str = Field(default=DEMO_MODEL, min_length=1, max_length=128)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config/defaults")
async def config_defaults() -> dict[str, Any]:
    return {
        "default_vs": {
            "host": settings.default_vs_host,
            "port": settings.default_vs_port,
        },
        "model_pool_map": MODEL_POOL_MAP,
        "model_options": MODEL_OPTIONS,
        "demo_cases": DEMO_CASES,
        "demo_interval_ms": settings.demo_interval_ms,
    }


@app.get("/api/config/observability")
async def config_observability() -> dict[str, str | bool]:
    return {
        "grafana_url": get_grafana_url(),
        "grafana_auto_login": grafana_auto_login_enabled(),
    }


@app.get("/api/grafana/open")
async def grafana_open():
    return await build_grafana_open_redirect()


@app.post("/api/proxy/chat/completions")
async def proxy_chat(req: ProxyRequest) -> dict[str, Any]:
    try:
        validate_target(req.target.host, req.target.port)
    except HTTPException:
        raise
    return await proxy_chat_completions(
        req.target.host,
        req.target.port,
        req.payload,
        req.extra_headers,
    )


@app.get("/api/config/context-routing")
async def config_context_routing() -> dict[str, Any]:
    plan = build_multiturn_crossing(CONTEXT_SIZE_RULE)
    return {
        "default_vs": {
            "host": settings.default_vs_host,
            "port": settings.default_vs_port,
        },
        "rule": CONTEXT_SIZE_RULE,
        "presets": [
            {"label": "4k", "bytes": 4 * 1024},
            {"label": "5k-128", "bytes": 5 * 1024 - 128},
            {"label": "5k", "bytes": 5 * 1024},
            {"label": "5k+128", "bytes": 5 * 1024 + 128},
            {"label": "6k", "bytes": 6 * 1024},
        ],
        "multiturn_preview": {
            "under_bytes": plan["under"]["messages_bytes"],
            "over_bytes": plan["over"]["messages_bytes"],
            "under_turns": plan["under"]["turns"],
            "over_turns": plan["over"]["turns"],
            "dialogue_rounds": plan["under"].get("dialogue_rounds"),
        },
        "timeline": plan.get("timeline", []),
    }


@app.post("/api/demo/context-routing/calc")
async def context_routing_calc(req: ContextSizeCalcRequest) -> dict[str, Any]:
    if req.messages is not None:
        size = calc_messages_bytes(req.messages)
        messages = req.messages
    else:
        messages, size = build_single_user_messages(req.target_messages_bytes)
    route = resolve_expected_route(size, CONTEXT_SIZE_RULE)
    return {
        "messages": messages,
        "messages_bytes": size,
        "target_messages_bytes": req.target_messages_bytes,
        "route": route,
    }


@app.post("/api/demo/context-routing/single")
async def context_routing_single(req: ContextSingleDemoRequest) -> dict[str, Any]:
    try:
        validate_target(req.target.host, req.target.port)
    except HTTPException:
        raise
    return await run_single_context_demo(
        req.target.host, req.target.port, req.target_messages_bytes
    )


@app.post("/api/demo/context-routing/multiturn")
async def context_routing_multiturn(req: ContextMultiturnDemoRequest) -> dict[str, Any]:
    try:
        validate_target(req.target.host, req.target.port)
    except HTTPException:
        raise
    return await run_multiturn_context_demo(req.target.host, req.target.port)


@app.get("/api/config/agent-routing")
async def config_agent_routing() -> dict[str, Any]:
    return AGENT_ROUTING


@app.post("/api/demo/agent-routing/run")
async def demo_agent_routing(req: AgentRoutingRunRequest) -> dict[str, Any]:
    allowed = (*BASE_IDENTITY_MODES, "random")
    if req.identity_mode not in allowed:
        raise HTTPException(
            status_code=400,
            detail="identity_mode must be header, system_name, model_field, or random",
        )
    if req.agent_identity_modes:
        for mode in req.agent_identity_modes.values():
            if mode not in BASE_IDENTITY_MODES:
                raise HTTPException(
                    status_code=400,
                    detail="agent_identity_modes values must be header, system_name, or model_field",
                )
    try:
        validate_target(req.target.host, req.target.port)
    except HTTPException:
        raise
    results, mode_map, effective = await run_agent_routing_demo(
        req.target.host,
        req.target.port,
        req.identity_mode,  # type: ignore[arg-type]
        req.user_prompt,
        req.agents,
        req.interval_ms,
        req.agent_identity_modes,  # type: ignore[arg-type]
    )
    return {
        "results": results,
        "identity_mode": effective,
        "agent_identity_modes": mode_map,
    }


@app.get("/api/demo/agent-routing/traffic/status")
async def agent_routing_traffic_status() -> dict[str, Any]:
    return agent_traffic_simulator.status()


@app.post("/api/demo/agent-routing/traffic/start")
async def agent_routing_traffic_start(req: AgentTrafficStartRequest) -> dict[str, Any]:
    try:
        validate_target(req.target.host, req.target.port)
    except HTTPException:
        raise
    try:
        return await agent_traffic_simulator.start(
            req.target.host,
            req.target.port,
            req.duration_minutes,
            req.user_prompt,
            req.identity_mode,  # type: ignore[arg-type]
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail=exc.detail) from exc
        raise


@app.post("/api/demo/agent-routing/traffic/stop")
async def agent_routing_traffic_stop() -> dict[str, Any]:
    return await agent_traffic_simulator.stop()


@app.post("/api/demo/model-routing/run")
async def demo_model_routing(req: DemoRunRequest) -> dict[str, Any]:
    try:
        validate_target(req.target.host, req.target.port)
    except HTTPException:
        raise
    results = await run_model_routing_demo(
        req.target.host,
        req.target.port,
        req.cases,
        req.interval_ms,
    )
    return {"results": results}


@app.get("/api/config/tblb")
async def config_tblb() -> dict[str, Any]:
    return {
        "default_vs": {
            "host": settings.default_vs_host,
            "port": settings.default_vs_port,
        },
        "default_scheduler": {
            "host": settings.tblb_scheduler_host,
            "port": settings.tblb_scheduler_port,
        },
        "scheduler_partition": settings.f5_mgmt_partition,
        "tblb_demo_interval_ms": settings.tblb_demo_interval_ms,
        "tblb_trigger_path": settings.tblb_trigger_path,
        "tblb_trigger_wait_sec": settings.tblb_trigger_wait_sec,
        "default_iterations": TBLB_DEMO_DEFAULT_ITERATIONS,
        "pools": TBLB_DEMO_POOLS,
    }


@app.get("/api/demo/tblb/scheduler/pool-status")
async def tblb_scheduler_pool_status(
    pool_name: str,
    host: str = settings.tblb_scheduler_host,
    port: int = settings.tblb_scheduler_port,
    partition: str = settings.f5_mgmt_partition,
) -> dict[str, Any]:
    try:
        validate_target(host, port)
    except HTTPException:
        raise
    if not pool_name or "/" in pool_name:
        raise HTTPException(status_code=400, detail="invalid pool_name")
    return await fetch_scheduler_pool_status(host, port, pool_name, partition)


@app.post("/api/demo/tblb/trigger-member-load")
async def tblb_trigger_member_load(req: TblbTriggerLoadRequest) -> dict[str, Any]:
    if not req.members:
        raise HTTPException(status_code=400, detail="no_members")
    try:
        results = await trigger_members_load(
            [m.model_dump() for m in req.members],
            req.path,
        )
    except HTTPException:
        raise
    return {
        "results": results,
        "wait_seconds": settings.tblb_trigger_wait_sec,
        "path": req.path or settings.tblb_trigger_path,
    }


@app.get("/api/config/retry-fallback")
async def config_retry_fallback() -> dict[str, Any]:
    return {
        "default_vs": {
            "host": settings.default_vs_host,
            "port": settings.default_vs_port,
        },
        "rule": RETRY_FALLBACK_RULE,
        "f5_mgmt": {
            "host": settings.f5_mgmt_host,
            "partition": settings.f5_mgmt_partition,
            "verify_tls": settings.f5_mgmt_verify_tls,
        },
    }


@app.post("/api/demo/retry-fallback/status-retry")
async def demo_retry_status(req: RetryFallbackDemoRequest) -> dict[str, Any]:
    validate_target(req.target.host, req.target.port)
    return await run_retry_status_demo(req.target.host, req.target.port)


@app.get("/api/demo/retry-fallback/status-counter")
async def demo_retry_status_counter() -> dict[str, Any]:
    return await get_retry_status_counter()


@app.post("/api/demo/retry-fallback/tcp-reselect/prepare")
async def demo_tcp_reselect_prepare() -> dict[str, Any]:
    return await prepare_tcp_reselect()


@app.post("/api/demo/retry-fallback/tcp-reselect")
async def demo_tcp_reselect(req: RetryFallbackDemoRequest) -> dict[str, Any]:
    validate_target(req.target.host, req.target.port)
    return await run_tcp_reselect_demo(req.target.host, req.target.port)


@app.post("/api/demo/retry-fallback/tcp-force-fallback")
async def demo_tcp_force_fallback(req: RetryFallbackDemoRequest) -> dict[str, Any]:
    validate_target(req.target.host, req.target.port)
    return await run_tcp_force_fallback_demo(req.target.host, req.target.port)


@app.get("/api/demo/pool-member/guard/status")
async def pool_member_guard_status() -> dict[str, Any]:
    try:
        return await get_demo_guard_member_status()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/demo/pool-member/guard/enable")
async def pool_member_guard_enable() -> dict[str, Any]:
    try:
        return await enable_demo_guard_member()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/demo/observability/traffic/status")
async def observability_traffic_status() -> dict[str, Any]:
    return obs_traffic_simulator.status()


@app.post("/api/demo/observability/traffic/start")
async def observability_traffic_start(req: ObsTrafficStartRequest) -> dict[str, Any]:
    if req.started_from not in ("obsTokens", "obsMetrics"):
        raise HTTPException(status_code=400, detail="started_from must be obsTokens or obsMetrics")
    try:
        validate_target(req.target.host, req.target.port)
    except HTTPException:
        raise
    try:
        return await obs_traffic_simulator.start(
            req.target.host,
            req.target.port,
            req.duration_minutes,
            req.started_from,
            req.concurrency,
            req.stream_mode,
        )
    except HTTPException as exc:
        if exc.status_code == 409:
            raise HTTPException(status_code=409, detail=exc.detail) from exc
        raise


@app.post("/api/demo/observability/traffic/stop")
async def observability_traffic_stop() -> dict[str, Any]:
    return await obs_traffic_simulator.stop()


@app.get("/api/demo/system-prompt/config")
async def system_prompt_config() -> dict[str, Any]:
    default_vs = SYSTEM_PROMPT["default_vs"]
    nonce = SYSTEM_PROMPT["nonce"]
    assert isinstance(default_vs, dict)
    assert isinstance(nonce, str)
    return {
        "default_vs": default_vs,
        "demo_model": SYSTEM_PROMPT["demo_model"],
        "nonce": nonce,
        "mock_llm_port": SYSTEM_PROMPT["mock_llm_port"],
        "presets": SYSTEM_PROMPT_PRESETS,
        "tags": {
            "outer": f"system_instruction_{nonce}",
            "admin": f"admin_prompts_{nonce}",
            "user": f"user_prompts_{nonce}",
            "guardrails": f"final_guardrails_{nonce}",
        },
    }


@app.post("/api/demo/system-prompt/preview")
async def system_prompt_preview(req: SystemPromptPreviewRequest) -> dict[str, Any]:
    return preview_wrap(
        system_content=req.system_content,
        user_content=req.user_content,
        model=req.model,
    )


@app.post("/api/demo/system-prompt/analyze")
async def system_prompt_analyze(body: dict[str, Any]) -> dict[str, Any]:
    from backend.app.system_prompt import extract_assistant_content

    content = extract_assistant_content(body.get("body"))
    return analyze_response(content)


@app.get("/api/demo/model-allowlist/config")
async def model_allowlist_config() -> dict[str, Any]:
    return get_model_allowlist_config()


@app.get("/api/demo/model-allowlist/policy")
async def model_allowlist_policy(model: str) -> dict[str, Any]:
    return resolve_model_policy(model)


@app.get("/api/demo/max-tokens/config")
async def max_tokens_config() -> dict[str, Any]:
    return get_max_tokens_config()


@app.get("/api/demo/max-tokens/policy")
async def max_tokens_policy(max_tokens: int) -> dict[str, Any]:
    return resolve_max_tokens_policy(max_tokens)


@app.post("/api/demo/max-tokens/run")
async def max_tokens_run(req: MaxTokensRunRequest) -> dict[str, Any]:
    try:
        validate_target(req.target.host, req.target.port)
    except HTTPException:
        raise
    payload = build_max_tokens_payload(
        max_tokens=req.max_tokens,
        user_content=req.user_content or DEFAULT_USER_MESSAGE,
    )
    result = await proxy_chat_completions(
        req.target.host,
        req.target.port,
        payload,
    )
    result["policy"] = resolve_max_tokens_policy(req.max_tokens)
    return result


if FRONTEND_DIST.is_dir():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    _index_html_template: str | None = None

    def _get_index_html_template() -> str:
        global _index_html_template
        if _index_html_template is None:
            _index_html_template = (FRONTEND_DIST / "index.html").read_text(encoding="utf-8")
        return _index_html_template

    def _spa_index_response() -> HTMLResponse:
        raw = _get_index_html_template()
        payload = json.dumps(
            {
                "grafana_url": get_grafana_url(),
                "grafana_auto_login": grafana_auto_login_enabled(),
            },
            ensure_ascii=False,
        )
        script = f"<script>window.__LLM_DEMO_RUNTIME__={payload}</script>"
        html = raw.replace("</head>", f"{script}</head>", 1) if "</head>" in raw else f"{script}{raw}"
        return HTMLResponse(html)

    @app.get("/")
    async def spa_root():
        return _spa_index_response()

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        if full_path.startswith("api") or full_path == "assets":
            raise HTTPException(status_code=404)
        candidate = FRONTEND_DIST / full_path
        if candidate.is_file():
            return FileResponse(candidate)
        return _spa_index_response()

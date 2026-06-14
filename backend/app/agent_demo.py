import random
from typing import Any, Literal

from backend.app.config import AGENT_ROUTING
from backend.app.proxy import proxy_chat_completions

IdentityMode = Literal["header", "system_name", "model_field"]
IdentityModeSelector = IdentityMode | Literal["random"]

BASE_IDENTITY_MODES: tuple[IdentityMode, ...] = ("header", "system_name", "model_field")


def pick_random_agent_modes(agent_ids: list[str]) -> dict[str, IdentityMode]:
    """Assign each agent a random identity mode; fixed for one test session."""
    return {aid: random.choice(BASE_IDENTITY_MODES) for aid in agent_ids}


def all_agent_ids() -> list[str]:
    agents = list(AGENT_ROUTING["agents"])  # type: ignore[arg-type]
    return [str(a["id"]) for a in agents]


def resolve_agent_mode_map(
    mode: IdentityModeSelector,
    agent_ids: list[str],
    preset: dict[str, IdentityMode] | None = None,
    *,
    session_ids: list[str] | None = None,
) -> tuple[dict[str, IdentityMode], IdentityModeSelector]:
    if mode != "random":
        return ({aid: mode for aid in agent_ids}, mode)

    scope = session_ids or agent_ids
    result: dict[str, IdentityMode] = {}
    if preset:
        for aid in scope:
            if aid in preset:
                result[aid] = preset[aid]
    for aid in scope:
        if aid not in result:
            result[aid] = random.choice(BASE_IDENTITY_MODES)
    return (result, "random")

AGENT_HEADER = "x-Agent-Identity"
ENTERPRISE_MODEL = "EnterpriseAgentModel"


def _agent_content(identity: str, user_prompt: str) -> tuple[str, str]:
    """Return (system_content, user_content) tailored per sub-agent role."""
    prompts: dict[str, tuple[str, str]] = {
        "superviser": (
            "You are the supervisor agent. Decompose the user goal and coordinate sub-agents.",
            f"Plan and coordinate development: {user_prompt}",
        ),
        "planner": (
            "You are the planner agent. Produce architecture and task breakdown.",
            f"Create a product plan for: {user_prompt}",
        ),
        "coder": (
            "You are the coding agent. Implement features according to the plan.",
            f"Write code for: {user_prompt}",
        ),
        "tester": (
            "You are the testing agent. Design integration and test cases.",
            f"Design tests for: {user_prompt}",
        ),
        "scanner": (
            "You are the security scanner agent. Review code for vulnerabilities.",
            f"Scan code security for: {user_prompt}",
        ),
    }
    return prompts.get(
        identity,
        (f"You are agent {identity}.", user_prompt),
    )


def build_agent_payload(
    identity: str,
    mode: IdentityMode,
    user_prompt: str,
) -> tuple[dict[str, Any], dict[str, str]]:
    system_content, user_content = _agent_content(identity, user_prompt)
    extra_headers: dict[str, str] = {}

    if mode == "header":
        extra_headers[AGENT_HEADER] = identity
        payload = {
            "model": ENTERPRISE_MODEL,
            "messages": [{"role": "user", "content": user_content}],
        }
    elif mode == "system_name":
        payload = {
            "model": ENTERPRISE_MODEL,
            "messages": [
                {
                    "role": "system",
                    "name": identity,
                    "content": system_content,
                },
                {"role": "user", "content": user_content},
            ],
        }
    else:
        payload = {
            "model": identity,
            "messages": [{"role": "user", "content": user_content}],
        }

    return payload, extra_headers


async def run_single_agent_request(
    host: str,
    port: int,
    agent: dict[str, Any],
    mode: IdentityMode,
    user_prompt: str,
) -> dict[str, Any]:
    identity = agent["id"]
    payload, extra_headers = build_agent_payload(identity, mode, user_prompt)
    proxy_result = await proxy_chat_completions(
        host, port, payload, extra_headers or None
    )
    request_model = str(payload.get("model", identity))
    return {
        "agent_id": identity,
        "label_key": agent.get("label_key", ""),
        "label": agent.get("label", identity),
        "identity_mode": mode,
        "request_model": request_model,
        "expected_pool": agent["expected_pool"],
        "expected_model": agent.get("expected_model"),
        "model_rewrite_expected": agent.get("model_rewrite_expected", False),
        "expected_status": 200,
        "proxy": proxy_result,
        "payload_preview": {
            "model": payload.get("model"),
            "header": extra_headers.get(AGENT_HEADER),
            "system_name": next(
                (
                    m.get("name")
                    for m in payload.get("messages", [])
                    if m.get("role") == "system"
                ),
                None,
            ),
        },
    }


async def run_agent_routing_demo(
    host: str,
    port: int,
    mode: IdentityModeSelector,
    user_prompt: str,
    agent_ids: list[str] | None = None,
    interval_ms: int | None = None,
    agent_mode_map: dict[str, IdentityMode] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, IdentityMode], IdentityModeSelector]:
    import asyncio

    from backend.app.config import settings

    agents = list(AGENT_ROUTING["agents"])  # type: ignore[arg-type]
    if agent_ids:
        id_set = set(agent_ids)
        agents = [a for a in agents if a["id"] in id_set]
    ids = [str(a["id"]) for a in agents]
    session_ids = all_agent_ids() if mode == "random" else ids
    mode_map, effective_selector = resolve_agent_mode_map(
        mode, ids, agent_mode_map, session_ids=session_ids
    )
    delay = (interval_ms or settings.demo_interval_ms) / 1000.0
    results: list[dict[str, Any]] = []

    for index, agent in enumerate(agents):
        if index > 0:
            await asyncio.sleep(delay)
        identity = str(agent["id"])
        effective_mode = mode_map.get(identity)
        if effective_mode is None:
            effective_mode = random.choice(BASE_IDENTITY_MODES)
            mode_map[identity] = effective_mode
        result = await run_single_agent_request(
            host, port, agent, effective_mode, user_prompt
        )
        results.append(result)

    return results, mode_map, effective_selector

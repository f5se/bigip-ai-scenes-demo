from typing import Any

from backend.app.config import CONTEXT_SIZE_RULE
from backend.app.context_size import (
    build_multiturn_crossing,
    build_single_user_messages,
    calc_messages_bytes,
    resolve_expected_route,
)
from backend.app.proxy import proxy_chat_completions


async def proxy_context_payload(
    host: str,
    port: int,
    messages: list[dict[str, str]],
    model: str | None = None,
) -> dict[str, Any]:
    model_name = model or str(CONTEXT_SIZE_RULE["model"])
    messages_bytes = calc_messages_bytes(messages)
    route = resolve_expected_route(messages_bytes, CONTEXT_SIZE_RULE)
    payload = {"model": model_name, "messages": messages}
    proxy_result = await proxy_chat_completions(host, port, payload)
    return {
        "model": model_name,
        "messages_bytes": messages_bytes,
        "message_count": len(messages),
        "route": route,
        "proxy": proxy_result,
    }


async def run_single_context_demo(
    host: str,
    port: int,
    target_messages_bytes: int,
) -> dict[str, Any]:
    messages, actual_bytes = build_single_user_messages(target_messages_bytes)
    route = resolve_expected_route(actual_bytes, CONTEXT_SIZE_RULE)
    payload = {"model": CONTEXT_SIZE_RULE["model"], "messages": messages}
    proxy_result = await proxy_chat_completions(host, port, payload)
    content_len = len(messages[0]["content"]) if messages else 0
    return {
        "kind": "single",
        "content_chars": content_len,
        "messages_bytes": actual_bytes,
        "target_messages_bytes": target_messages_bytes,
        "route": route,
        "proxy": proxy_result,
    }


async def run_multiturn_context_demo(host: str, port: int) -> dict[str, Any]:
    plan = build_multiturn_crossing(CONTEXT_SIZE_RULE)
    under_proxy = await proxy_context_payload(
        host, port, plan["under"]["messages"], str(plan["model"])
    )
    over_proxy = await proxy_context_payload(
        host, port, plan["over"]["messages"], str(plan["model"])
    )
    return {
        "kind": "multiturn",
        "threshold_bytes": plan["threshold_bytes"],
        "scenario_title_key": plan.get("scenario_title_key"),
        "timeline": plan.get("timeline", []),
        "under": {
            "label_key": plan["under"]["label_key"],
            "turns": plan["under"]["turns"],
            "dialogue_rounds": plan["under"].get("dialogue_rounds"),
            "trigger": plan["under"].get("trigger"),
            "conversation_preview": plan["under"].get("conversation_preview"),
            "timeline": plan["under"].get("timeline"),
            **under_proxy,
        },
        "over": {
            "label_key": plan["over"]["label_key"],
            "turns": plan["over"]["turns"],
            "dialogue_rounds": plan["over"].get("dialogue_rounds"),
            "trigger": plan["over"].get("trigger"),
            "conversation_preview": plan["over"].get("conversation_preview"),
            "timeline": plan["over"].get("timeline"),
            **over_proxy,
        },
    }

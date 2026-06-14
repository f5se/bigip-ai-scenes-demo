from __future__ import annotations

from typing import Any

from backend.app.config import MAX_TOKENS_DEMO

DEFAULT_USER_MESSAGE = "请用一句话介绍你自己。"


def build_max_tokens_payload(
    *,
    max_tokens: int,
    model: str | None = None,
    user_content: str = DEFAULT_USER_MESSAGE,
) -> dict[str, object]:
    """Canonical OpenAI chat payload — max_tokens must be present for iRule Layer 0 check."""
    return {
        "model": model or str(MAX_TOKENS_DEMO["demo_model"]),
        "max_tokens": int(max_tokens),
        "messages": [{"role": "user", "content": user_content}],
    }


def resolve_max_tokens_policy(max_tokens: int) -> dict[str, Any]:
    limit = int(MAX_TOKENS_DEMO["max_tokens_limit"])
    if max_tokens > limit:
        return {
            "max_tokens": max_tokens,
            "max_tokens_limit": limit,
            "action": "block",
            "reason": "exceeds_limit",
        }
    return {
        "max_tokens": max_tokens,
        "max_tokens_limit": limit,
        "action": "allow",
        "reason": "within_limit",
    }


def get_max_tokens_config() -> dict[str, Any]:
    default_vs = MAX_TOKENS_DEMO["default_vs"]
    assert isinstance(default_vs, dict)
    return {
        "default_vs": default_vs,
        "demo_model": MAX_TOKENS_DEMO["demo_model"],
        "max_tokens_limit": MAX_TOKENS_DEMO["max_tokens_limit"],
        "irule_layer": MAX_TOKENS_DEMO["irule_layer"],
        "vs_note": MAX_TOKENS_DEMO["vs_note"],
        "presets": MAX_TOKENS_DEMO["presets"],
    }

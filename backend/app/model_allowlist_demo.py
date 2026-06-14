from __future__ import annotations

from typing import Any

from backend.app.config import MODEL_ALLOWLIST_DEMO


def _records_map() -> dict[str, str]:
    records = MODEL_ALLOWLIST_DEMO.get("records", [])
    if not isinstance(records, list):
        return {}
    out: dict[str, str] = {}
    for item in records:
        if isinstance(item, dict):
            model = item.get("model")
            action = item.get("action")
            if isinstance(model, str) and isinstance(action, str):
                out[model] = action
    return out


def resolve_model_policy(model: str) -> dict[str, Any]:
    records = _records_map()
    default_action = str(MODEL_ALLOWLIST_DEMO.get("default_action", "block"))
    if model in records:
        return {
            "model": model,
            "action": records[model],
            "source": "datagroup",
            "datagroup": MODEL_ALLOWLIST_DEMO.get("datagroup"),
        }
    return {
        "model": model,
        "action": default_action,
        "source": "default",
        "datagroup": MODEL_ALLOWLIST_DEMO.get("datagroup"),
    }


def get_model_allowlist_config() -> dict[str, Any]:
    default_vs = MODEL_ALLOWLIST_DEMO["default_vs"]
    assert isinstance(default_vs, dict)
    return {
        "default_vs": default_vs,
        "datagroup": MODEL_ALLOWLIST_DEMO["datagroup"],
        "default_action": MODEL_ALLOWLIST_DEMO["default_action"],
        "records": MODEL_ALLOWLIST_DEMO["records"],
        "allowed_model": MODEL_ALLOWLIST_DEMO["allowed_model"],
        "allowed_models": MODEL_ALLOWLIST_DEMO.get("allowed_models", []),
        "irule_layer": MODEL_ALLOWLIST_DEMO["irule_layer"],
        "vs_note": MODEL_ALLOWLIST_DEMO["vs_note"],
    }

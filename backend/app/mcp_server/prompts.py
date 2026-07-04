from __future__ import annotations

from typing import Any

PROMPT_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "incident_analysis",
        "description": "故障分析提示词模板",
        "arguments": [
            {"name": "incident_id", "required": True},
            {"name": "service_name", "required": False},
        ],
    },
    {
        "name": "change_review",
        "description": "变更评审提示词模板",
        "arguments": [
            {"name": "change_id", "required": True},
            {"name": "risk_level", "required": False},
        ],
    },
]


def get_prompt(name: str, arguments: dict[str, Any]) -> list[dict[str, Any]]:
    incident_id = arguments.get("incident_id", "INC-UNKNOWN")
    service = arguments.get("service_name", "payment-api")
    change_id = arguments.get("change_id", "CHG-UNKNOWN")
    risk = arguments.get("risk_level", "medium")

    if name == "incident_analysis":
        text = (
            f"请分析以下事件：{incident_id}，关联服务 {service}。"
            "当前状态 Critical，请给出根因假设与处置步骤。"
        )
    elif name == "change_review":
        text = f"请评审变更 {change_id}，风险等级 {risk}，列出回滚方案与验证项。"
    else:
        raise ValueError(f"Unknown prompt: {name}")

    return [{"role": "user", "content": {"type": "text", "text": text}}]

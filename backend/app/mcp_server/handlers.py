from __future__ import annotations

import json
from typing import Any

SERVER_INFO = {"name": "IT-Ops-MCP-Server", "version": "1.0.0"}
SERVER_CAPABILITIES = {
    "tools": {"listChanged": True},
    "prompts": {"listChanged": True},
    "resources": {"subscribe": True, "listChanged": True},
    "logging": {},
}
PROTOCOL_VERSION = "2025-11-25"


def sse_message(payload: dict[str, Any]) -> str:
    return f"event: message\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def json_rpc_result(msg_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def json_rpc_error(msg_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def build_elicitation_request(msg_id: int, tool_name: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "method": "elicitation/create",
        "params": {
            "mode": "form",
            "message": f"请确认变更操作：{tool_name}",
            "requestedSchema": {
                "type": "object",
                "properties": {
                    "confirm_scope": {
                        "type": "string",
                        "title": "执行范围",
                        "enum": ["仅测试环境", "测试+预生产", "全量生产"],
                    },
                    "notify_oncall": {"type": "boolean", "title": "通知 On-Call", "default": True},
                },
                "required": ["confirm_scope"],
            },
        },
    }


def build_sampling_request(msg_id: int, context: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "method": "sampling/createMessage",
        "params": {
            "messages": [{"role": "user", "content": {"type": "text", "text": context}}],
            "modelPreferences": {
                "hints": [{"name": "claude-3-sonnet"}],
                "intelligencePriority": 0.8,
            },
            "systemPrompt": "你是一个专业的 IT 运维助手。",
            "maxTokens": 500,
        },
    }


def build_log_notification(level: str, logger: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "method": "notifications/message",
        "params": {"level": level, "logger": logger, "data": data},
    }


def build_tool_result(msg_id: Any, text: str, is_error: bool = False) -> dict[str, Any]:
    return json_rpc_result(
        msg_id,
        {
            "content": [{"type": "text", "text": text}],
            "isError": is_error,
        },
    )

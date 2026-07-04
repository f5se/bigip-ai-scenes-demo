from __future__ import annotations

import asyncio
import itertools
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from backend.app.mcp_server.handlers import (
    PROTOCOL_VERSION,
    SERVER_CAPABILITIES,
    SERVER_INFO,
    build_elicitation_request,
    build_log_notification,
    build_sampling_request,
    build_tool_result,
    json_rpc_error,
    json_rpc_result,
    sse_message,
)
from backend.app.mcp_server.prompts import PROMPT_DEFINITIONS, get_prompt
from backend.app.mcp_server.resources import RESOURCE_DEFINITIONS, read_resource
from backend.app.mcp_server.session import SessionState, sessions
from backend.app.mcp_server.tools import TOOL_DEFINITIONS, execute_tool

app = FastAPI(title="IT-Ops MCP Server", version="1.0.0")

_id_counter = itertools.count(1000)


def _next_server_id() -> int:
    return next(_id_counter)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "sessions": sessions.count}


def _session_from_request(request: Request) -> SessionState | None:
    return sessions.get(request.headers.get("Mcp-Session-Id"))


@app.post("/mcp")
async def mcp_post(request: Request) -> Response:
    body = await request.json()
    session = _session_from_request(request)
    method = body.get("method")
    msg_id = body.get("id")

    # Client response to server-initiated sampling/elicitation (no method, has result)
    if method is None and "result" in body and session is not None:
        resolved = session.resolve(msg_id, body.get("result"))
        if resolved:
            return Response(status_code=202)
        return JSONResponse(json_rpc_error(msg_id, -32600, "Unknown request id"), status_code=400)

    if method == "initialize":
        state = sessions.create()
        result = json_rpc_result(
            msg_id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": SERVER_CAPABILITIES,
                "serverInfo": SERVER_INFO,
            },
        )
        return StreamingResponse(
            iter([sse_message(result)]),
            media_type="text/event-stream",
            headers={"Mcp-Session-Id": state.session_id},
        )

    if method == "notifications/initialized":
        return Response(status_code=202)

    if session is None:
        return JSONResponse(
            json_rpc_error(msg_id, -32000, "Missing or invalid Mcp-Session-Id"),
            status_code=400,
        )

    if method == "tools/list":
        return _sse_json(json_rpc_result(msg_id, {"tools": TOOL_DEFINITIONS}))

    if method == "prompts/list":
        return _sse_json(json_rpc_result(msg_id, {"prompts": PROMPT_DEFINITIONS}))

    if method == "resources/list":
        return _sse_json(json_rpc_result(msg_id, {"resources": RESOURCE_DEFINITIONS}))

    if method == "prompts/get":
        params = body.get("params") or {}
        try:
            messages = get_prompt(params.get("name", ""), params.get("arguments") or {})
        except ValueError as exc:
            return _sse_json(json_rpc_error(msg_id, -32602, str(exc)))
        return _sse_json(json_rpc_result(msg_id, {"messages": messages}))

    if method == "resources/read":
        uri = (body.get("params") or {}).get("uri", "")
        try:
            contents = read_resource(uri)
        except ValueError as exc:
            return _sse_json(json_rpc_error(msg_id, -32602, str(exc)))
        return _sse_json(json_rpc_result(msg_id, {"contents": contents}))

    if method == "tools/call":
        return StreamingResponse(
            _tools_call_stream(body, session),
            media_type="text/event-stream",
            headers={"Mcp-Session-Id": session.session_id},
        )

    if method == "ping":
        return _sse_json(json_rpc_result(msg_id, {}))

    return JSONResponse(json_rpc_error(msg_id, -32601, f"Method not found: {method}"), status_code=400)


def _sse_json(payload: dict[str, Any]) -> StreamingResponse:
    return StreamingResponse(
        iter([sse_message(payload)]),
        media_type="text/event-stream",
    )


async def _tools_call_stream(body: dict[str, Any], session: SessionState):
    msg_id = body.get("id")
    params = body.get("params") or {}
    tool_name = params.get("name", "")
    args = params.get("arguments") or {}

    try:
        if tool_name == "restart_service":
            elic_id = _next_server_id()
            yield sse_message(build_elicitation_request(elic_id, tool_name))
            elic_result = await session.wait_for(elic_id)
            if elic_result.get("action") != "accept":
                yield sse_message(build_tool_result(msg_id, "用户拒绝变更操作", is_error=True))
                return

        tool_text = await execute_tool(tool_name, args)

        if tool_name == "query_alert":
            sampling_id = _next_server_id()
            yield sse_message(
                build_sampling_request(
                    sampling_id,
                    f"根据以下告警数据提供处置建议：\n{tool_text}",
                )
            )
            sampling_result = await session.wait_for(sampling_id)
            ai_text = (sampling_result.get("content") or {}).get("text", "")
            if ai_text:
                tool_text = f"{tool_text}\n\n[AI分析建议]: {ai_text}"

        yield sse_message(
            build_log_notification(
                "info",
                "tool-executor",
                {"message": f"工具 {tool_name} 执行完成", "tool": tool_name},
            )
        )
        yield sse_message(build_tool_result(msg_id, tool_text))

    except ValueError as exc:
        yield sse_message(build_tool_result(msg_id, str(exc), is_error=True))
    except asyncio.TimeoutError:
        yield sse_message(
            build_tool_result(msg_id, "等待 Client 响应超时（sampling/elicitation）", is_error=True)
        )


@app.delete("/mcp")
async def mcp_delete(request: Request) -> Response:
    sid = request.headers.get("Mcp-Session-Id")
    sessions.delete(sid)
    return Response(status_code=200)


@app.get("/mcp")
async def mcp_get(request: Request) -> Response:
    session = _session_from_request(request)
    if session is None:
        return JSONResponse({"error": "Missing Mcp-Session-Id"}, status_code=400)

    async def keepalive():
        yield ": keepalive\n\n"
        while True:
            await asyncio.sleep(30)
            yield ": ping\n\n"

    return StreamingResponse(keepalive(), media_type="text/event-stream")

"""Context size routing helpers (aligned with iRuleLX calcContextSize)."""

from __future__ import annotations

import json
from typing import Any

# Realistic enterprise chat script: F5 LLM gateway troubleshooting session
_WORK_SESSION_TURNS: list[dict[str, str]] = [
    {
        "user": (
            "你好，我在 BIG-IP 上部署了 LLM 推理网关 VS，客户端走 OpenAI 兼容 API。"
            "想确认一下 Virtual Server 上除了 pool 之外还必须挂哪些 Profile？"
        ),
        "assistant": (
            "需要同时挂载 **HTTP Profile** 和 **ILX Profile**。\n"
            "HTTP Profile 让 TMM 以 HTTP 事务模式解析请求，iRuleLX 才能收到 requestStart / "
            "requestComplete；ILX Profile 把流量交给 Node.js 插件处理。"
            "如果只挂 TCP 或缺少 HTTP，插件拿不到 JSON body 里的 model 字段。"
        ),
    },
    {
        "user": (
            "这是我现在 VS 上的配置摘要：\n"
            "• VS: vs_llm_inference_gateway 172.16.30.122:8000\n"
            "• Profiles: http (clientside), llm_router_ilx_profile\n"
            "• Default pool: pool_llm_default\n"
            "Data Group llm_model_pool_map 里 deepseek-chat 已指向 pool_deepseek-chat。"
            "这样是否可以开始测 model 路由？"
        ),
        "assistant": (
            "Profile 组合是正确的。建议先用 curl 发一条最小请求验证：\n"
            '`POST /v1/chat/completions`，body 里 `"model":"deepseek-chat"`。\n'
            "然后在 BIG-IP 上 `tail -f /var/log/ltm | grep llm_router` 看路由日志，"
            "确认 pool 与 modelRewrite 是否符合 Data Group。"
        ),
    },
    {
        "user": (
            "测试通过了。下一步要在同一个 VS 上启用 **Context Size 路由**：\n"
            "当 messages 上下文超过 5k 字节时，自动切到 pool_deepseek_v4，"
            "并把 model 改成 deepseek-v4-flash。请帮我 review 这条 DG 值是否合理：\n"
            "/Common/pool_deepseek-chat,deepseek-chat,Size|5k|pool_deepseek_v4|deepseek-v4-flash"
        ),
        "assistant": (
            "这条 value 是 **类型 4** 配置：field1=小上下文 Pool，field2=改写后的 model，"
            "field3=Size|5k|大上下文 Pool|大模型名。\n"
            "插件会对 `messages` 数组做 JSON.stringify 后算 UTF-8 字节数；"
            "≤5120 走 pool_deepseek-chat，>5120 走 pool_deepseek_v4 并注入 deepseek-v4-flash。"
            "注意 5k = 5×1024 = 5120 字节，不是 5000。"
        ),
    },
    {
        "user": (
            "业务方反馈：他们在 IDE 里连续多轮追问，前几轮正常，某一轮突然变慢。"
            "怀疑是上下文变长后没有命中大模型池。能否说明一下连续对话时 "
            "F5 是**每次请求独立**算 context size，还是会累积历史？"
        ),
        "assistant": (
            "每次 HTTP 请求都是独立的：客户端若在 body 里带上**完整对话历史** "
            "(messages 数组含多轮 user/assistant)，则 calcContextSize 统计的是**本轮请求里 "
            "整个 messages 序列化后的长度**，等价于会话-so-far 的上下文体积。\n"
            "因此随着多轮问答，messages 会越来越长，某一次请求可能从 ≤5k 跨到 >5k，"
            "从而触发大上下文 Pool——这正是你要演示的场景。"
        ),
    },
    {
        "user": (
            "明白了。我准备在演示里模拟真实工单场景。第 5 轮我会贴上 iRuleLX 最近 30 行日志，"
            "以及一段重复的 pool 成员健康检查输出，方便你一起看重试与超时是否相关。"
        ),
        "assistant": (
            "可以。贴日志时尽量保留时间戳与 pool 名称，便于对照插件里 lbSelect 的目标。"
            "若日志中出现 `contextSize=xxxx > threshold=5120`，就说明该轮请求已走大上下文分支。"
        ),
    },
]

_LOG_EXCERPT_TEMPLATE = """
--- BIG-IP LTM 摘录 (模拟工单附件) ---
[llm_router] LLM route: model="deepseek-chat" client=10.24.8.15 pool="/Common/pool_deepseek-chat"
[llm_router] extractModel: regex → "deepseek-chat"
[llm_router] contextSize=4980 threshold=5120 → small context branch
... (中间省略多行健康检查与重试记录) ...
{repeat}
""".strip()


def calc_messages_bytes(messages: list[dict[str, Any]]) -> int:
    """UTF-8 byte length of JSON.stringify(messages) — same as plugin."""
    return len(json.dumps(messages, ensure_ascii=False).encode("utf-8"))


def resolve_expected_route(messages_bytes: int, rule: dict[str, Any]) -> dict[str, Any]:
    threshold = int(rule["threshold_bytes"])
    if messages_bytes > threshold:
        return {
            "tier": "large",
            "expected_pool": rule["large_pool"],
            "expected_model": rule["large_model"],
            "over_threshold": True,
        }
    return {
        "tier": "small",
        "expected_pool": rule["small_pool"],
        "expected_model": rule["small_model"],
        "over_threshold": False,
    }


def _preview_text(text: str, max_len: int = 120) -> str:
    one_line = " ".join(text.split())
    if len(one_line) <= max_len:
        return one_line
    return one_line[: max_len - 1] + "…"


def _append_timeline_step(
    timeline: list[dict[str, Any]],
    *,
    step: int,
    role: str,
    content: str,
    messages: list[dict[str, str]],
) -> None:
    timeline.append(
        {
            "step": step,
            "role": role,
            "preview": _preview_text(content),
            "cumulative_bytes": calc_messages_bytes(messages),
            "message_count": len(messages),
        }
    )


def build_single_user_messages(target_messages_bytes: int) -> tuple[list[dict[str, str]], int]:
    """Build one user message so messages[] JSON size is close to target."""
    target = max(0, target_messages_bytes)
    content = ""
    messages = [{"role": "user", "content": content}]
    size = calc_messages_bytes(messages)
    if size >= target:
        return messages, size

    low, high = 0, max(target * 2, 4096)
    best_content = ""
    while low <= high:
        mid = (low + high) // 2
        trial = "X" * mid
        trial_messages = [{"role": "user", "content": trial}]
        trial_size = calc_messages_bytes(trial_messages)
        if trial_size <= target:
            best_content = trial
            low = mid + 1
        else:
            high = mid - 1

    messages = [{"role": "user", "content": best_content}]
    return messages, calc_messages_bytes(messages)


def _build_work_session_messages(threshold: int) -> tuple[
    list[dict[str, str]] | None,
    int,
    list[dict[str, str]] | None,
    int,
    list[dict[str, Any]],
    int,
]:
    """
    Simulate a continuous work chat: system prompt + multi-turn Q&A,
    ending with user pasting a large log excerpt that pushes context over threshold.
    """
    messages: list[dict[str, str]] = [
        {
            "role": "system",
            "content": (
                "你是 F5 企业 LLM 网关排障助手，熟悉 iRuleLX、Data Group 与 OpenAI 兼容 API。"
                "回答请简洁、可执行。"
            ),
        }
    ]
    timeline: list[dict[str, Any]] = []
    step = 0

    _append_timeline_step(
        timeline,
        step=step,
        role="system",
        content=messages[0]["content"],
        messages=messages,
    )
    step += 1

    under_messages: list[dict[str, str]] | None = None
    under_bytes = 0
    over_messages: list[dict[str, str]] | None = None
    over_bytes = 0
    dialogue_rounds = 0

    for turn in _WORK_SESSION_TURNS:
        dialogue_rounds += 1
        user_content = turn["user"]
        messages.append({"role": "user", "content": user_content})
        _append_timeline_step(
            timeline, step=step, role="user", content=user_content, messages=messages
        )
        step += 1

        size = calc_messages_bytes(messages)
        if size <= threshold:
            under_messages = [m.copy() for m in messages]
            under_bytes = size

        asst_content = turn["assistant"]
        messages.append({"role": "assistant", "content": asst_content})
        _append_timeline_step(
            timeline,
            step=step,
            role="assistant",
            content=asst_content,
            messages=messages,
        )
        step += 1

        size = calc_messages_bytes(messages)
        if size <= threshold:
            under_messages = [m.copy() for m in messages]
            under_bytes = size
        elif over_messages is None:
            over_messages = [m.copy() for m in messages]
            over_bytes = size

    # Final turn: user pastes incident log (common in real tickets) → crosses 5k
    if over_messages is None or calc_messages_bytes(over_messages) <= threshold:
        repeat_block = (
            "[health] member 172.16.40.122:8005 UP — pool_deepseek-chat\n"
            "[health] monitor /Common/tcp 200 OK\n"
        ) * 28
        log_body = _LOG_EXCERPT_TEMPLATE.format(repeat=repeat_block)
        final_user = (
            "第 6 轮：我把今晚完整的网关日志和健康检查贴上来，请分析是否在某一轮之后 "
            "context 超过 5k 并切换到了 pool_deepseek_v4。\n\n"
            f"{log_body}"
        )
        messages.append({"role": "user", "content": final_user})
        _append_timeline_step(
            timeline, step=step, role="user", content=final_user, messages=messages
        )
        step += 1
        dialogue_rounds += 1

        if calc_messages_bytes(messages) <= threshold:
            under_messages = [m.copy() for m in messages]
            under_bytes = calc_messages_bytes(under_messages)

        # Typical path: still under until assistant reply would be added;
        # for routing demo we send request *before* next assistant — user message is enough
        over_messages = [m.copy() for m in messages]
        over_bytes = calc_messages_bytes(over_messages)

    if under_messages is None:
        under_messages = [{"role": "user", "content": "ping"}]
        under_bytes = calc_messages_bytes(under_messages)

    return under_messages, under_bytes, over_messages, over_bytes, timeline, dialogue_rounds


def build_multiturn_crossing(rule: dict[str, Any]) -> dict[str, Any]:
    threshold = int(rule["threshold_bytes"])
    model = str(rule["model"])
    under_messages, under_bytes, over_messages, over_bytes, timeline, rounds = (
        _build_work_session_messages(threshold)
    )

    under_count = len(under_messages) if under_messages else 0
    over_count = len(over_messages) if over_messages else 0

    def _snapshot(
        label_key: str,
        msgs: list[dict[str, str]],
        nbytes: int,
        turns: int,
        trigger: str,
    ) -> dict[str, Any]:
        return {
            "label_key": label_key,
            "messages": msgs,
            "messages_bytes": nbytes,
            "message_count": len(msgs),
            "route": resolve_expected_route(nbytes, rule),
            "turns": turns,
            "dialogue_rounds": rounds,
            "trigger": trigger,
            "conversation_preview": [
                {"role": m["role"], "preview": _preview_text(m["content"], 160)}
                for m in msgs[-6:]
            ],
            "timeline": timeline,
        }

    return {
        "model": model,
        "threshold_bytes": threshold,
        "scenario_title_key": "contextSize.workScenarioTitle",
        "timeline": timeline,
        "under": _snapshot(
            "contextSize.underThreshold",
            under_messages or [],
            under_bytes,
            under_count,
            "contextSize.triggerUnder",
        ),
        "over": _snapshot(
            "contextSize.overThreshold",
            over_messages or [],
            over_bytes,
            over_count,
            "contextSize.triggerOver",
        ),
    }

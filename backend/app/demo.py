import asyncio
from typing import Any

from backend.app.config import DEMO_CASES, settings
from backend.app.proxy import proxy_chat_completions


def _cases_by_ids(case_ids: list[str] | str) -> list[dict]:
    if case_ids == "all" or case_ids == ["all"]:
        return DEMO_CASES
    id_set = set(case_ids)
    return [c for c in DEMO_CASES if c["case_id"] in id_set]


async def run_model_routing_demo(
    host: str,
    port: int,
    case_ids: list[str] | str,
    interval_ms: int | None = None,
) -> list[dict[str, Any]]:
    cases = _cases_by_ids(case_ids)
    if not cases:
        return []
    delay = (interval_ms or settings.demo_interval_ms) / 1000.0
    results: list[dict[str, Any]] = []
    for index, case in enumerate(cases):
        if index > 0:
            await asyncio.sleep(delay)
        payload = {
            "model": case["model"],
            "messages": [{"role": "user", "content": "hello"}],
        }
        proxy_result = await proxy_chat_completions(host, port, payload)
        results.append(
            {
                "case_id": case["case_id"],
                "model": case["model"],
                "label": case.get("label", case["model"]),
                "label_key": case["label_key"],
                "expected_pool": case["expected_pool"],
                "expected_status": case["expected_status"],
                "proxy": proxy_result,
            }
        )
    return results

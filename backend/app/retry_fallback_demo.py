from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

from backend.app.config import RETRY_FALLBACK_RULE, settings
from backend.app.proxy import proxy_chat_completions


@dataclass(frozen=True)
class MemberRef:
    pool: str
    node: str
    port: int


class F5IControl:
    def __init__(self) -> None:
        self.host = settings.f5_mgmt_host
        self.username = settings.f5_mgmt_username
        self.password = settings.f5_mgmt_password
        self.partition = settings.f5_mgmt_partition
        self.verify_tls = settings.f5_mgmt_verify_tls

    def _pool_name(self, full_path: str) -> str:
        return full_path.split("/")[-1]

    def _member_id(self, node: str, port: int) -> str:
        return f"~{self.partition}~{node}:{port}"

    def _pool_id(self, pool: str) -> str:
        return f"~{self.partition}~{self._pool_name(pool)}"

    def _member_url(self, ref: MemberRef) -> str:
        pool_id = self._pool_id(ref.pool)
        member_id = self._member_id(ref.node, ref.port)
        return f"https://{self.host}/mgmt/tm/ltm/pool/{pool_id}/members/{member_id}"

    def _member_stats_url(self, ref: MemberRef) -> str:
        return f"{self._member_url(ref)}/stats"

    def _members_url(self, pool: str) -> str:
        pool_id = self._pool_id(pool)
        return f"https://{self.host}/mgmt/tm/ltm/pool/{pool_id}/members"

    async def _request(
        self, method: str, url: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        timeout = httpx.Timeout(connect=3.0, read=8.0, write=8.0, pool=3.0)
        async with httpx.AsyncClient(
            timeout=timeout,
            verify=self.verify_tls,
            auth=(self.username, self.password),
        ) as client:
            resp = await client.request(method, url, json=payload)
        body: dict[str, Any] | None = None
        try:
            data = resp.json()
            if isinstance(data, dict):
                body = data
        except Exception:
            body = None
        if resp.status_code >= 400:
            detail = body.get("message") if isinstance(body, dict) else resp.text
            raise RuntimeError(f"F5 iControl error {resp.status_code}: {detail}")
        return body or {}

    async def list_members(self, pool: str) -> list[dict[str, Any]]:
        body = await self._request("GET", self._members_url(pool))
        items = body.get("items", []) if isinstance(body, dict) else []
        members: list[dict[str, Any]] = []
        for raw in items:
            if not isinstance(raw, dict):
                continue
            members.append(
                {
                    "name": raw.get("name"),
                    "address": raw.get("address"),
                    "state": raw.get("state"),
                    "session": raw.get("session"),
                    "fullPath": raw.get("fullPath"),
                }
            )
        return members

    async def set_member_enabled(self, ref: MemberRef, enabled: bool) -> dict[str, Any]:
        payload = (
            {"session": "user-enabled", "state": "user-up"}
            if enabled
            else {"session": "user-disabled", "state": "user-down"}
        )
        body = await self._request("PATCH", self._member_url(ref), payload)
        return {
            "name": body.get("name"),
            "state": body.get("state"),
            "session": body.get("session"),
            "fullPath": body.get("fullPath"),
        }

    async def get_member_stats(self, ref: MemberRef) -> dict[str, Any]:
        body = await self._request("GET", self._member_stats_url(ref))
        entries = body.get("entries", {}) if isinstance(body, dict) else {}
        return _extract_member_request_stats(entries)


def _headers_lower(headers: dict[str, str]) -> dict[str, str]:
    return {str(k).lower(): str(v) for k, v in headers.items()}


def _extract_error_message(body: Any) -> str:
    if not isinstance(body, dict):
        return ""
    err = body.get("error")
    if not isinstance(err, dict):
        return ""
    msg = err.get("message")
    return str(msg) if msg is not None else ""


def _hit_default_pool(body: Any) -> bool:
    """Response served by pool_llm_default (model_mismatch mentions default_model)."""
    return "default_model" in _extract_error_message(body)


TCP_RESELECT_STABILITY_WAIT_S = 3


def _member_was_offline(member: dict[str, Any] | None) -> bool:
    if not member:
        return True
    session = str(member.get("session", "")).lower()
    state = str(member.get("state", "")).lower()
    if session in ("user-disabled", "disabled"):
        return True
    if state in ("user-down", "down", "offline", "forced-offline"):
        return True
    return False


def _find_member(members: list[dict[str, Any]], port: int) -> dict[str, Any] | None:
    return next((m for m in members if str(m.get("name", "")).endswith(f":{port}")), None)


def _find_paths_with_key(obj: Any, key: str, parent: str = "") -> list[str]:
    paths: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{parent}.{k}" if parent else str(k)
            if k == key:
                paths.append(path)
            paths.extend(_find_paths_with_key(v, key, path))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            path = f"{parent}[{i}]"
            paths.extend(_find_paths_with_key(item, key, path))
    return paths


def _body_debug_summary(proxy: dict[str, Any]) -> dict[str, Any]:
    body = proxy.get("body")
    port = _extract_server_port(body)
    paths = _find_paths_with_key(body, "server_port") if body is not None else []
    top_keys: list[str] = []
    model_val: Any = None
    if isinstance(body, dict):
        top_keys = list(body.keys())[:25]
        model_val = body.get("model")
    preview = ""
    if body is not None:
        try:
            preview = json.dumps(body, ensure_ascii=False)[:800]
        except Exception:
            preview = str(body)[:800]
    return {
        "status_code": proxy.get("status_code"),
        "elapsed_ms": proxy.get("elapsed_ms"),
        "error": proxy.get("error"),
        "server_port_extracted": port,
        "server_port_paths": paths,
        "body_has_server_port_key": len(paths) > 0,
        "body_top_keys": top_keys,
        "body_model": model_val,
        "body_preview": preview,
    }


def _extract_server_port(body: Any) -> int | None:
    def walk(obj: Any) -> int | None:
        if isinstance(obj, dict):
            if "server_port" in obj:
                value = obj.get("server_port")
                if isinstance(value, int):
                    return value
                if isinstance(value, str) and value.isdigit():
                    return int(value)
            for v in obj.values():
                found = walk(v)
                if found is not None:
                    return found
            return None
        if isinstance(obj, list):
            for item in obj:
                found = walk(item)
                if found is not None:
                    return found
        return None

    value = walk(body)
    if value is not None:
        return value
    return None


def _bool_result(proxy: dict[str, Any], expected: int) -> bool:
    return proxy.get("error") is None and proxy.get("status_code") == expected


def _member_from_rule(pool_key: str, member_key: str) -> MemberRef:
    pool = str(RETRY_FALLBACK_RULE[pool_key])
    member = RETRY_FALLBACK_RULE[member_key]
    if not isinstance(member, dict):
        raise RuntimeError("invalid retry fallback member rule")
    return MemberRef(pool=pool, node=str(member["node"]), port=int(member["port"]))


def _iter_nested_numbers(obj: Any, parent: str = "") -> list[tuple[str, int]]:
    rows: list[tuple[str, int]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = f"{parent}.{k}" if parent else str(k)
            rows.extend(_iter_nested_numbers(v, key))
        return rows
    if isinstance(obj, list):
        for i, item in enumerate(obj):
            key = f"{parent}[{i}]"
            rows.extend(_iter_nested_numbers(item, key))
        return rows
    if isinstance(obj, (int, float)):
        rows.append((parent.lower(), int(obj)))
        return rows
    if isinstance(obj, str):
        stripped = obj.strip()
        if stripped.isdigit():
            rows.append((parent.lower(), int(stripped)))
    return rows


def _extract_member_request_stats(entries: dict[str, Any]) -> dict[str, Any]:
    numeric = _iter_nested_numbers(entries)
    counters: dict[str, int] = {
        key: value for key, value in numeric if "request" in key and key
    }
    preferred_keys = [
        key
        for key in counters
        if "totrequests" in key or ("request" in key and "total" in key)
    ]
    primary_key = preferred_keys[0] if preferred_keys else (next(iter(counters), None))
    selected = counters.get(primary_key) if primary_key else None
    return {
        "total_requests": selected,
        "primary_key": primary_key,
        "request_keys": list(counters.keys())[:12],
        "request_counters": dict(list(counters.items())[:20]),
    }


def _pick_best_counter_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_map = before.get("request_counters", {})
    after_map = after.get("request_counters", {})
    if not isinstance(before_map, dict) or not isinstance(after_map, dict):
        return {"key": None, "before": before.get("total_requests"), "after": after.get("total_requests")}

    candidate_keys = set(before_map) | set(after_map)
    best_key: str | None = None
    best_delta: int | None = None
    for key in candidate_keys:
        bv = before_map.get(key)
        av = after_map.get(key)
        if not isinstance(bv, int) or not isinstance(av, int):
            continue
        delta = av - bv
        if best_delta is None or delta > best_delta:
            best_delta = delta
            best_key = key

    if best_key is not None:
        return {
            "key": best_key,
            "before": before_map.get(best_key),
            "after": after_map.get(best_key),
        }
    return {"key": None, "before": before.get("total_requests"), "after": after.get("total_requests")}


async def run_retry_status_demo(vs_host: str, vs_port: int) -> dict[str, Any]:
    ctl = F5IControl()
    retry_model = str(RETRY_FALLBACK_RULE["retry_model"])
    test_member = _member_from_rule("retry_primary_pool", "retry_test_member")

    await ctl.set_member_enabled(test_member, True)
    before_stats = await ctl.get_member_stats(test_member)

    proxy = await proxy_chat_completions(
        vs_host,
        vs_port,
        {"model": retry_model, "messages": [{"role": "user", "content": "hello"}]},
    )
    # F5 stats may lag behind the request response; sample a few times and pick max.
    after_stats = await ctl.get_member_stats(test_member)
    after_samples: list[dict[str, Any]] = [after_stats]
    for _ in range(3):
        await asyncio.sleep(0.35)
        sample = await ctl.get_member_stats(test_member)
        after_samples.append(sample)

    def _sample_value(sample: dict[str, Any]) -> int:
        v = sample.get("total_requests")
        return v if isinstance(v, int) else -1

    after_stats = max(after_samples, key=_sample_value)

    headers = _headers_lower(proxy.get("headers", {}))
    msg = _extract_error_message(proxy.get("body"))
    fallback_to_default = "default_model" in msg
    terminal_retry = headers.get("x-llm-retry-terminal") == "1"
    picked = _pick_best_counter_delta(before_stats, after_stats)
    before_req = picked.get("before")
    after_req = picked.get("after")
    req_delta = (
        int(after_req) - int(before_req)
        if isinstance(before_req, int) and isinstance(after_req, int)
        else None
    )
    return {
        "kind": "status-retry",
        "retry_model": retry_model,
        "primary_pool": RETRY_FALLBACK_RULE["retry_primary_pool"],
        "fallback_pool": RETRY_FALLBACK_RULE["retry_fallback_pool"],
        "member": f"{test_member.node}:{test_member.port}",
        "member_stats": {
            "before": before_stats,
            "after": after_stats,
            "after_samples": after_samples,
            "compared_key": picked.get("key"),
            "delta_requests": req_delta,
        },
        "proxy": proxy,
        "result": {
            "fallback_to_default": fallback_to_default,
            "terminal_retry": terminal_retry,
            "all_members_unavailable": "all pool members unavailable" in msg.lower(),
            "retry_observed": isinstance(req_delta, int) and req_delta > 0,
            "as_expected": _bool_result(proxy, 200)
            and (fallback_to_default or terminal_retry)
            and (req_delta is None or req_delta > 0),
        },
    }


async def get_retry_status_counter() -> dict[str, Any]:
    ctl = F5IControl()
    test_member = _member_from_rule("retry_primary_pool", "retry_test_member")
    await ctl.set_member_enabled(test_member, True)
    stats = await ctl.get_member_stats(test_member)
    return {
        "member": f"{test_member.node}:{test_member.port}",
        "stats": stats,
    }


async def prepare_tcp_reselect() -> dict[str, Any]:
    """Enable pool members; if 8005 was offline, caller should wait before sampling."""
    ctl = F5IControl()
    tcp_pool = str(RETRY_FALLBACK_RULE["tcp_pool"])
    tcp_good = _member_from_rule("tcp_pool", "tcp_good_member")
    tcp_bad = _member_from_rule("tcp_pool", "tcp_bad_member")
    default_good = _member_from_rule("retry_fallback_pool", "default_member")

    before_members = await ctl.list_members(tcp_pool)
    good_before = _find_member(before_members, tcp_good.port)
    was_offline = _member_was_offline(good_before)

    await ctl.set_member_enabled(tcp_bad, True)
    await ctl.set_member_enabled(tcp_good, True)
    await ctl.set_member_enabled(default_good, True)

    after_members = await ctl.list_members(tcp_pool)
    good_after = _find_member(after_members, tcp_good.port)

    wait_s = TCP_RESELECT_STABILITY_WAIT_S if was_offline else 0
    return {
        "kind": "tcp-reselect-prepare",
        "member": f"{tcp_good.node}:{tcp_good.port}",
        "member_recovered": was_offline,
        "stability_wait_seconds": wait_s,
        "member_before": good_before,
        "member_after": good_after,
    }


async def run_tcp_reselect_demo(vs_host: str, vs_port: int) -> dict[str, Any]:
    ctl = F5IControl()
    tcp_pool = str(RETRY_FALLBACK_RULE["tcp_pool"])
    fallback_pool = str(RETRY_FALLBACK_RULE["retry_fallback_pool"])
    tcp_good = _member_from_rule("tcp_pool", "tcp_good_member")
    tcp_bad = _member_from_rule("tcp_pool", "tcp_bad_member")
    default_good = _member_from_rule("retry_fallback_pool", "default_member")
    expected_port = tcp_good.port

    await ctl.set_member_enabled(tcp_bad, True)
    await ctl.set_member_enabled(tcp_good, True)
    await ctl.set_member_enabled(default_good, True)

    before_tcp = await ctl.list_members(tcp_pool)
    before_default = await ctl.list_members(fallback_pool)

    attempts: list[dict[str, Any]] = []
    for attempt_i in range(3):
        res = await proxy_chat_completions(
            vs_host,
            vs_port,
            {"model": "deepseek-chat", "messages": [{"role": "user", "content": "hello"}]},
        )
        body = res.get("body")
        body_dbg = _body_debug_summary(res)
        attempts.append(
            {
                "attempt": attempt_i + 1,
                "status_code": res.get("status_code"),
                "error": res.get("error"),
                "server_port": body_dbg.get("server_port_extracted"),
                "routed_to_default_pool": _hit_default_pool(body),
                "message": _extract_error_message(body),
                **body_dbg,
            }
        )

    ports = [a.get("server_port") for a in attempts]
    missing = [i + 1 for i, a in enumerate(attempts) if a.get("server_port") is None]

    return {
        "kind": "tcp-reselect",
        "pool": tcp_pool,
        "fallback_pool": fallback_pool,
        "before": {
            "tcp_pool_members": before_tcp,
            "default_pool_members": before_default,
        },
        "attempts": attempts,
        "result": {
            "expected_server_port": expected_port,
            "all_requests_on_expected_port": len(attempts) > 0
            and all(a.get("server_port") == expected_port for a in attempts),
            "missing_port_attempts": missing,
            "observed_ports": ports,
        },
    }


async def run_tcp_force_fallback_demo(vs_host: str, vs_port: int) -> dict[str, Any]:
    t0 = time.perf_counter()
    ctl = F5IControl()
    tcp_pool = str(RETRY_FALLBACK_RULE["tcp_pool"])
    fallback_pool = str(RETRY_FALLBACK_RULE["retry_fallback_pool"])
    tcp_good = _member_from_rule("tcp_pool", "tcp_good_member")
    default_good = _member_from_rule("retry_fallback_pool", "default_member")
    debug_steps: list[dict[str, Any]] = []

    def step(name: str, detail: str, extra: dict[str, Any] | None = None) -> None:
        row: dict[str, Any] = {
            "at_ms": int((time.perf_counter() - t0) * 1000),
            "step": name,
            "detail": detail,
        }
        if extra:
            row.update(extra)
        debug_steps.append(row)

    step("start", "tcp-force-fallback demo begin")
    enabled_default = await ctl.set_member_enabled(default_good, True)
    step("enable_default", f"enable {default_good.node}:{default_good.port}", enabled_default)
    disabled_good = await ctl.set_member_enabled(tcp_good, False)
    step(
        "force_offline_tcp_good",
        f"force offline {tcp_good.node}:{tcp_good.port}",
        disabled_good,
    )

    after_change_tcp = await ctl.list_members(tcp_pool)
    after_change_default = await ctl.list_members(fallback_pool)
    step("members_after_offline", "pool snapshot after force offline", {"tcp_pool": after_change_tcp})

    proxy = await proxy_chat_completions(
        vs_host,
        vs_port,
        {"model": "deepseek-chat", "messages": [{"role": "user", "content": "hello"}]},
    )
    body_dbg = _body_debug_summary(proxy)
    step("request", "fallback probe request", body_dbg)

    headers = _headers_lower(proxy.get("headers", {}))
    msg = _extract_error_message(proxy.get("body"))
    fallback_by_default_model = "default_model" in msg
    fallback_by_terminal = headers.get("x-llm-retry-terminal") == "1"
    return {
        "kind": "tcp-force-fallback",
        "pool": tcp_pool,
        "forced_offline_member": f"{tcp_good.node}:{tcp_good.port}",
        "after": {
            "tcp_pool_members": after_change_tcp,
            "default_pool_members": after_change_default,
        },
        "proxy": proxy,
        "debug": {
            "steps": debug_steps,
            "body_analysis": body_dbg,
            "hint": "执行本测试后请再跑 reselect；reselect 会自动 enable 8005 并轮询等待",
        },
        "result": {
            "fallback_to_default": fallback_by_default_model,
            "terminal_retry": fallback_by_terminal,
            "all_members_unavailable": "all pool members unavailable" in msg.lower(),
            "as_expected": proxy.get("status_code") == 200
            and (fallback_by_default_model or fallback_by_terminal),
        },
    }


def _demo_guard_member_ref() -> MemberRef:
    return _member_from_rule("tcp_pool", "tcp_good_member")


async def get_demo_guard_member_status() -> dict[str, Any]:
    """Check whether pool_deepseek-chat ubuntu-ai:8005 is disabled on F5."""
    ctl = F5IControl()
    ref = _demo_guard_member_ref()
    members = await ctl.list_members(ref.pool)
    member = _find_member(members, ref.port)
    disabled = _member_was_offline(member)
    return {
        "pool": ref.pool,
        "pool_short": ctl._pool_name(ref.pool),
        "member": f"{ref.node}:{ref.port}",
        "disabled": disabled,
        "found": member is not None,
        "state": member.get("state") if member else None,
        "session": member.get("session") if member else None,
    }


async def enable_demo_guard_member() -> dict[str, Any]:
    """Enable pool_deepseek-chat ubuntu-ai:8005 for demo testing."""
    ctl = F5IControl()
    ref = _demo_guard_member_ref()
    updated = await ctl.set_member_enabled(ref, True)
    return {
        "pool": ref.pool,
        "pool_short": ctl._pool_name(ref.pool),
        "member": f"{ref.node}:{ref.port}",
        "enabled": True,
        "state": updated.get("state"),
        "session": updated.get("session"),
    }


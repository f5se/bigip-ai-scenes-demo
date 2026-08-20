"""Demo App login + scene-usage audit (JSONL + GeoIP).

Records login/logout/failed-login and route-level scene enter/leave/heartbeat.
Does NOT record API latency or login-to-first-action delays.
"""

from __future__ import annotations

import ipaddress
import json
import os
import statistics
import threading
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Body, HTTPException, Query, Request
from pydantic import BaseModel, Field

try:
    import geoip2.database
except ImportError:  # pragma: no cover
    geoip2 = None  # type: ignore

ROOT = Path(__file__).resolve().parents[2]
USAGE_DIR = Path(os.environ.get("DEMO_USAGE_DIR", str(ROOT / "data" / "demo_usage")))
LOGIN_EVENTS_FILE = USAGE_DIR / "login_events.jsonl"
SCENE_EVENTS_FILE = USAGE_DIR / "scene_visits.jsonl"
GEOIP_DB_FILE = Path(
    os.environ.get("GEOIP_DB_FILE", str(ROOT / "static" / "ip" / "GeoLite2-City.mmdb"))
)

APP_TZ = timezone(timedelta(hours=8))
FILE_LOCK = threading.Lock()
GEOIP_LOOKUP_CACHE: Dict[str, str] = {}

KNOWN_SCENE_PATHS: Dict[str, Tuple[str, Optional[str]]] = {
    "/": ("home", None),
    "/scene/llm-router": ("llm-router", None),
    "/scene/llm-router/model-routing": ("llm-router", "model-routing"),
    "/scene/llm-router/context-routing": ("llm-router", "context-routing"),
    "/scene/llm-router/agent-routing": ("llm-router", "agent-routing"),
    "/scene/llm-router/retry-fallback": ("llm-router", "retry-fallback"),
    "/scene/observability": ("observability", None),
    "/scene/observability/tokens": ("observability", "tokens"),
    "/scene/observability/metrics": ("observability", "metrics"),
    "/scene/observability/mcp-tools-insight": ("observability", "mcp-tools-insight"),
    "/scene/observability/mcp-tools-insight-v2026-07-28": ("observability", "mcp-tools-insight-v2026-07-28"),
    "/scene/traffic-mgmt": ("traffic-mgmt", None),
    "/scene/traffic-mgmt/tblb": ("traffic-mgmt", "tblb"),
    "/scene/traffic-mgmt/model-allowlist": ("traffic-mgmt", "model-allowlist"),
    "/scene/traffic-mgmt/max-tokens-limit": ("traffic-mgmt", "max-tokens-limit"),
    "/scene/traffic-mgmt/mcp-tools-control": ("traffic-mgmt", "mcp-tools-control"),
    "/scene/traffic-mgmt/mcp-tools-control-v2026-07-28": ("traffic-mgmt", "mcp-tools-control-v2026-07-28"),
    "/scene/security": ("security", None),
    "/scene/security/system-prompt": ("security", "system-prompt"),
    "/scene/security/guardrails": ("security", "guardrails"),
    "/admin/usage": ("admin", "usage"),
}

router = APIRouter(tags=["demo-usage"])


class UsageEventIn(BaseModel):
    event: str = Field(..., description="scene_enter | scene_leave | scene_heartbeat")
    path: str = Field(default="/")
    scene_id: str | None = None
    sub_feature_id: str | None = None
    dwell_ms: int | None = Field(default=None, ge=0)
    elapsed_ms: int | None = Field(default=None, ge=0)
    client_ts: str | None = None


def _ensure_usage_dir() -> None:
    USAGE_DIR.mkdir(parents=True, exist_ok=True)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_utc_iso(raw: str) -> Optional[datetime]:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _parse_range_bound(raw: str, *, end_of_day: bool = False) -> Optional[datetime]:
    """Parse ISO datetime or YYYY-MM-DD (interpreted in APP_TZ as day start/end)."""
    text = str(raw or "").strip()
    if not text:
        return None
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        try:
            day = datetime.strptime(text, "%Y-%m-%d").date()
            if end_of_day:
                local = datetime(day.year, day.month, day.day, 23, 59, 59, tzinfo=APP_TZ)
            else:
                local = datetime(day.year, day.month, day.day, 0, 0, 0, tzinfo=APP_TZ)
            return local.astimezone(timezone.utc)
        except Exception:
            return None
    return _parse_utc_iso(text)


def resolve_city_by_ip(ip_raw: str) -> str:
    ip_text = str(ip_raw or "").strip()
    if not ip_text:
        return "Unknown"
    if ip_text in GEOIP_LOOKUP_CACHE:
        return GEOIP_LOOKUP_CACHE[ip_text]
    try:
        ip_obj = ipaddress.ip_address(ip_text)
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local:
            city_name = "Local Network"
            GEOIP_LOOKUP_CACHE[ip_text] = city_name
            return city_name
    except Exception:
        GEOIP_LOOKUP_CACHE[ip_text] = "Unknown"
        return "Unknown"
    if geoip2 is None or not GEOIP_DB_FILE.is_file():
        GEOIP_LOOKUP_CACHE[ip_text] = "Unknown"
        return "Unknown"
    try:
        with geoip2.database.Reader(str(GEOIP_DB_FILE)) as reader:
            city_resp = reader.city(ip_text)
        city_name = (
            (city_resp.city.names or {}).get("zh-CN")
            or city_resp.city.name
            or ""
        )
        if not str(city_name).strip() and city_resp.subdivisions:
            city_name = (
                (city_resp.subdivisions[0].names or {}).get("zh-CN")
                or city_resp.subdivisions[0].name
                or ""
            )
        if not str(city_name).strip():
            city_name = (
                (city_resp.country.names or {}).get("zh-CN")
                or city_resp.country.name
                or "Unknown"
            )
        city_name = str(city_name).strip() or "Unknown"
    except Exception:
        city_name = "Unknown"
    GEOIP_LOOKUP_CACHE[ip_text] = city_name
    return city_name


def _append_jsonl(path: Path, record: dict) -> None:
    _ensure_usage_dir()
    line = json.dumps(record, ensure_ascii=False) + "\n"
    with FILE_LOCK:
        with open(path, "a", encoding="utf-8") as f:
            f.write(line)
            f.flush()


def append_login_event(
    *,
    event: str,
    username: str,
    client_ip: str,
    session_id: str = "",
    reason: str = "",
    user_agent: str = "",
) -> None:
    rec: Dict[str, Any] = {
        "event": event,
        "ts": _utc_now_iso(),
        "username": username or "unknown",
        "client_ip": client_ip or "unknown",
        "session_id": session_id or "",
    }
    if reason:
        rec["reason"] = reason
    if user_agent:
        rec["user_agent"] = user_agent[:240]
    _append_jsonl(LOGIN_EVENTS_FILE, rec)


def _normalize_path(path: str) -> str:
    text = str(path or "/").strip() or "/"
    if not text.startswith("/"):
        text = "/" + text
    if len(text) > 1 and text.endswith("/"):
        text = text.rstrip("/")
    # legacy redirects
    if text == "/scene/traffic-mgmt/mcp-tools-insight":
        text = "/scene/observability/mcp-tools-insight"
    if text == "/scene/traffic-mgmt/mcp-gateway":
        text = "/scene/observability/mcp-tools-insight"
    return text


def resolve_scene_ids(path: str, scene_id: str | None, sub_feature_id: str | None) -> Tuple[str, Optional[str], str]:
    norm = _normalize_path(path)
    mapped = KNOWN_SCENE_PATHS.get(norm)
    if mapped:
        return mapped[0], mapped[1], norm
    sid = (scene_id or "").strip() or "unknown"
    sub = (sub_feature_id or "").strip() or None
    return sid, sub, norm


def append_scene_event(
    *,
    event: str,
    username: str,
    session_id: str,
    client_ip: str,
    path: str,
    scene_id: str | None = None,
    sub_feature_id: str | None = None,
    dwell_ms: int | None = None,
    elapsed_ms: int | None = None,
    client_ts: str | None = None,
) -> dict:
    sid, sub, norm = resolve_scene_ids(path, scene_id, sub_feature_id)
    rec: Dict[str, Any] = {
        "event": event,
        "ts": _utc_now_iso(),
        "username": username or "unknown",
        "session_id": session_id or "",
        "client_ip": client_ip or "unknown",
        "path": norm,
        "scene_id": sid,
        "sub_feature_id": sub,
    }
    if dwell_ms is not None:
        rec["dwell_ms"] = int(dwell_ms)
    if elapsed_ms is not None:
        rec["elapsed_ms"] = int(elapsed_ms)
    if client_ts:
        rec["client_ts"] = client_ts
    _append_jsonl(SCENE_EVENTS_FILE, rec)
    return rec


def _read_jsonl(path: Path) -> Tuple[List[dict], int]:
    if not path.is_file():
        return [], 0
    rows: List[dict] = []
    invalid = 0
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except Exception:
                invalid += 1
                continue
            if isinstance(item, dict):
                rows.append(item)
            else:
                invalid += 1
    return rows, invalid


def _percentile(sorted_vals: List[float], p: float) -> Optional[float]:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return round(sorted_vals[0], 2)
    k = (len(sorted_vals) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_vals) - 1)
    if f == c:
        return round(sorted_vals[f], 2)
    return round(sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f), 2)


def _dwell_stats(values_ms: List[float]) -> dict:
    if not values_ms:
        return {"count": 0, "avg_ms": None, "median_ms": None, "p90_ms": None, "total_ms": 0}
    vals = sorted(values_ms)
    return {
        "count": len(vals),
        "avg_ms": round(statistics.fmean(vals), 1),
        "median_ms": _percentile(vals, 0.5),
        "p90_ms": _percentile(vals, 0.9),
        "total_ms": round(sum(vals), 1),
    }


def _empty_stats(
    range_key: str,
    start: str,
    end: str,
    *,
    filter_username: str = "",
    available_users: Optional[List[str]] = None,
) -> dict:
    return {
        "timezone": "UTC+08:00",
        "range": range_key,
        "start": start,
        "end": end,
        "filter_username": filter_username or "",
        "available_users": list(available_users or []),
        "geoip_available": GEOIP_DB_FILE.is_file() and geoip2 is not None,
        "logins": {
            "total": 0,
            "unique_users": 0,
            "failed_total": 0,
            "by_user": [],
            "by_city": [],
            "daily_trend": [],
            "hour_distribution": [{"hour": h, "count": 0} for h in range(24)],
            "recent": [],
            "failed_recent": [],
            "failed_by_user": [],
        },
        "scenes": {
            "total_enters": 0,
            "heat": [],
            "dwell": [],
            "daily_trend": [],
            "by_user": [],
        },
        "invalid_lines": 0,
    }


def build_usage_stats(
    *,
    range_key: str = "7d",
    include_admin: bool = True,
    start: Optional[str] = None,
    end: Optional[str] = None,
    username: Optional[str] = None,
) -> dict:
    now_local = datetime.now(APP_TZ)
    selected = str(range_key or "7d").strip().lower()
    start_dt: Optional[datetime] = None
    end_dt: Optional[datetime] = None

    if selected == "7d":
        start_dt = (now_local - timedelta(days=7)).astimezone(timezone.utc)
        end_dt = now_local.astimezone(timezone.utc)
    elif selected == "30d":
        start_dt = (now_local - timedelta(days=30)).astimezone(timezone.utc)
        end_dt = now_local.astimezone(timezone.utc)
    elif selected == "90d":
        start_dt = (now_local - timedelta(days=90)).astimezone(timezone.utc)
        end_dt = now_local.astimezone(timezone.utc)
    elif selected == "custom":
        start_dt = _parse_range_bound(start or "", end_of_day=False)
        end_dt = _parse_range_bound(end or "", end_of_day=True)
        if not start_dt or not end_dt:
            raise HTTPException(status_code=400, detail="custom range requires valid start and end")
        if end_dt < start_dt:
            raise HTTPException(status_code=400, detail="end must be later than start")
    else:
        raise HTTPException(status_code=400, detail="range must be one of: 7d, 30d, 90d, custom")

    assert start_dt and end_dt
    filter_username = str(username or "").strip()
    login_rows, login_invalid = _read_jsonl(LOGIN_EVENTS_FILE)
    scene_rows, scene_invalid = _read_jsonl(SCENE_EVENTS_FILE)
    invalid_lines = login_invalid + scene_invalid

    login_ok_all: List[dict] = []
    login_fail_all: List[dict] = []
    for item in login_rows:
        ts = _parse_utc_iso(str(item.get("ts") or ""))
        if not ts or ts < start_dt or ts > end_dt:
            continue
        uname = str(item.get("username") or "unknown")
        if (not include_admin) and uname.strip().lower() == "admin":
            continue
        enriched = {**item, "_ts": ts, "username": uname}
        ev = str(item.get("event") or "")
        if ev == "login":
            login_ok_all.append(enriched)
        elif ev == "login_failed":
            login_fail_all.append(enriched)

    scene_all: List[dict] = []
    for item in scene_rows:
        ts = _parse_utc_iso(str(item.get("ts") or ""))
        if not ts or ts < start_dt or ts > end_dt:
            continue
        uname = str(item.get("username") or "unknown")
        if (not include_admin) and uname.strip().lower() == "admin":
            continue
        scene_all.append({**item, "_ts": ts, "username": uname})

    # Dropdown: only accounts with at least one successful login in range.
    success_users = {
        str(r["username"])
        for r in login_ok_all
        if str(r.get("username") or "").strip()
    }
    available_users = sorted(success_users, key=lambda x: x.lower())

    # Failed-login investigation always uses the full failed set in range
    # (not narrowed by the success-user filter).
    failed_recent: List[dict] = []
    failed_user_agg: Dict[str, dict] = {}
    for rec in sorted(login_fail_all, key=lambda x: x["_ts"], reverse=True):
        uname = rec["username"]
        ip = str(rec.get("client_ip") or "unknown")
        city = resolve_city_by_ip(ip)
        local = rec["_ts"].astimezone(APP_TZ)
        reason = str(rec.get("reason") or "unknown")
        row = {
            "ts": local.isoformat(),
            "username": uname,
            "client_ip": ip,
            "city": city,
            "reason": reason,
        }
        if len(failed_recent) < 80:
            failed_recent.append(row)
        agg = failed_user_agg.get(uname)
        if agg is None:
            failed_user_agg[uname] = {
                "username": uname,
                "count": 1,
                "last_ts": row["ts"],
                "last_ip": ip,
                "last_city": city,
                "reasons": {reason: 1},
            }
        else:
            agg["count"] += 1
            agg["reasons"][reason] = int(agg["reasons"].get(reason, 0)) + 1

    failed_by_user = []
    for uname, agg in sorted(
        failed_user_agg.items(),
        key=lambda x: (-int(x[1]["count"]), x[0].lower()),
    ):
        reasons = [
            {"reason": r, "count": c}
            for r, c in sorted(agg["reasons"].items(), key=lambda x: (-x[1], x[0]))
        ]
        failed_by_user.append(
            {
                "username": agg["username"],
                "count": agg["count"],
                "last_ts": agg["last_ts"],
                "last_ip": agg["last_ip"],
                "last_city": agg["last_city"],
                "reasons": reasons,
                "never_succeeded": uname not in success_users,
            }
        )

    if not login_ok_all and not login_fail_all and not scene_all:
        empty = _empty_stats(
            selected,
            start_dt.isoformat(),
            end_dt.isoformat(),
            filter_username=filter_username,
            available_users=available_users,
        )
        empty["logins"]["failed_total"] = len(login_fail_all)
        empty["logins"]["failed_recent"] = failed_recent
        empty["logins"]["failed_by_user"] = failed_by_user
        return empty

    # Success-user filter applies to successful logins + scene analytics only.
    if filter_username and filter_username in success_users:
        login_ok = [r for r in login_ok_all if r["username"] == filter_username]
        login_fail = [r for r in login_fail_all if r["username"] == filter_username]
        filtered_scene = [r for r in scene_all if r["username"] == filter_username]
    else:
        filter_username = filter_username if filter_username in success_users else ""
        login_ok = login_ok_all
        login_fail = login_fail_all
        filtered_scene = scene_all

    user_counts: Dict[str, int] = defaultdict(int)
    city_counts: Dict[str, int] = defaultdict(int)
    day_counts: Dict[str, int] = defaultdict(int)
    hour_login = [0] * 24
    recent_logins: List[dict] = []

    for rec in login_ok:
        uname = rec["username"]
        user_counts[uname] += 1
        ip = str(rec.get("client_ip") or "unknown")
        city = resolve_city_by_ip(ip)
        city_counts[city] += 1
        local = rec["_ts"].astimezone(APP_TZ)
        day_counts[local.strftime("%Y-%m-%d")] += 1
        hour_login[local.hour] += 1
        recent_logins.append(
            {
                "ts": local.isoformat(),
                "username": uname,
                "client_ip": ip,
                "city": city,
                "session_id": str(rec.get("session_id") or ""),
            }
        )

    recent_logins.sort(key=lambda x: x["ts"], reverse=True)
    recent_logins = recent_logins[:50]

    # Group by session: walk chronologically, open enter -> leave/heartbeat
    open_visits: Dict[str, dict] = {}
    completed: List[dict] = []
    enter_counts: Dict[str, int] = defaultdict(int)
    enter_by_user: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    scene_day_counts: Dict[str, int] = defaultdict(int)

    def visit_key(session_id: str, path: str) -> str:
        return f"{session_id}|{path}"

    for rec in sorted(filtered_scene, key=lambda x: x["_ts"]):
        path = _normalize_path(str(rec.get("path") or "/"))
        scene_id = str(rec.get("scene_id") or "unknown")
        sub = rec.get("sub_feature_id")
        sub_s = str(sub) if sub else None
        label = f"{scene_id}/{sub_s}" if sub_s else scene_id
        sid = str(rec.get("session_id") or "")
        ev = str(rec.get("event") or "")
        key = visit_key(sid, path)
        local = rec["_ts"].astimezone(APP_TZ)
        uname = rec["username"]

        if ev == "scene_enter":
            open_visits[key] = {
                "username": uname,
                "path": path,
                "scene_id": scene_id,
                "sub_feature_id": sub_s,
                "label": label,
                "enter_ts": rec["_ts"],
                "max_elapsed_ms": 0,
            }
            enter_counts[label] += 1
            enter_by_user[uname][label] += 1
            scene_day_counts[local.strftime("%Y-%m-%d")] += 1
        elif ev == "scene_heartbeat":
            cur = open_visits.get(key)
            if cur is not None:
                try:
                    elapsed = int(rec.get("elapsed_ms") or 0)
                except (TypeError, ValueError):
                    elapsed = 0
                cur["max_elapsed_ms"] = max(int(cur.get("max_elapsed_ms") or 0), elapsed)
        elif ev == "scene_leave":
            cur = open_visits.pop(key, None)
            try:
                dwell = int(rec.get("dwell_ms") or 0)
            except (TypeError, ValueError):
                dwell = 0
            if cur is not None:
                dwell = max(dwell, int(cur.get("max_elapsed_ms") or 0))
                completed.append({**cur, "dwell_ms": dwell})
            else:
                completed.append(
                    {
                        "username": uname,
                        "path": path,
                        "scene_id": scene_id,
                        "sub_feature_id": sub_s,
                        "label": label,
                        "enter_ts": rec["_ts"],
                        "dwell_ms": dwell,
                    }
                )

    # Open visits without leave: use heartbeat elapsed if any
    for cur in open_visits.values():
        elapsed = int(cur.get("max_elapsed_ms") or 0)
        if elapsed > 0:
            completed.append({**cur, "dwell_ms": elapsed})

    dwell_by_label: Dict[str, List[float]] = defaultdict(list)
    dwell_by_user: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
    for item in completed:
        label = str(item["label"])
        dwell_ms = float(item.get("dwell_ms") or 0)
        dwell_by_label[label].append(dwell_ms)
        dwell_by_user[str(item.get("username") or "unknown")][label].append(dwell_ms)

    heat = [
        {
            "label": label,
            "scene_id": label.split("/", 1)[0],
            "sub_feature_id": label.split("/", 1)[1] if "/" in label else None,
            "enters": count,
        }
        for label, count in sorted(enter_counts.items(), key=lambda x: (-x[1], x[0]))
    ]

    dwell_rows = []
    for label, vals in sorted(dwell_by_label.items(), key=lambda x: (-sum(x[1]), x[0])):
        st = _dwell_stats(vals)
        dwell_rows.append(
            {
                "label": label,
                "scene_id": label.split("/", 1)[0],
                "sub_feature_id": label.split("/", 1)[1] if "/" in label else None,
                **st,
            }
        )

    by_user_rows: List[dict] = []
    users_for_scene = sorted(
        set(list(enter_by_user.keys()) + list(dwell_by_user.keys())),
        key=lambda x: x.lower(),
    )
    for uname in users_for_scene:
        u_enters = enter_by_user.get(uname) or {}
        u_dwell = dwell_by_user.get(uname) or {}
        u_heat = [
            {
                "label": label,
                "scene_id": label.split("/", 1)[0],
                "sub_feature_id": label.split("/", 1)[1] if "/" in label else None,
                "enters": count,
            }
            for label, count in sorted(u_enters.items(), key=lambda x: (-x[1], x[0]))
        ]
        u_dwell_rows = []
        for label, vals in sorted(u_dwell.items(), key=lambda x: (-(sum(x[1]) / max(len(x[1]), 1)), x[0])):
            st = _dwell_stats(vals)
            u_dwell_rows.append(
                {
                    "label": label,
                    "scene_id": label.split("/", 1)[0],
                    "sub_feature_id": label.split("/", 1)[1] if "/" in label else None,
                    **st,
                }
            )
        by_user_rows.append(
            {
                "username": uname,
                "total_enters": sum(u_enters.values()),
                "heat": u_heat,
                "dwell": u_dwell_rows,
            }
        )
    by_user_rows.sort(key=lambda x: (-int(x["total_enters"]), str(x["username"]).lower()))

    return {
        "timezone": "UTC+08:00",
        "range": selected,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "filter_username": filter_username,
        "available_users": available_users,
        "geoip_available": GEOIP_DB_FILE.is_file() and geoip2 is not None,
        "logins": {
            "total": len(login_ok),
            "unique_users": len(user_counts),
            "failed_total": len(login_fail_all),
            "by_user": [
                {"username": k, "count": v}
                for k, v in sorted(user_counts.items(), key=lambda x: (-x[1], x[0].lower()))
            ],
            "by_city": [
                {"city": k, "count": v}
                for k, v in sorted(city_counts.items(), key=lambda x: (-x[1], x[0]))
            ],
            "daily_trend": [
                {"date": d, "count": c} for d, c in sorted(day_counts.items(), key=lambda x: x[0])
            ],
            "hour_distribution": [{"hour": h, "count": c} for h, c in enumerate(hour_login)],
            "recent": recent_logins,
            "failed_recent": failed_recent,
            "failed_by_user": failed_by_user,
        },
        "scenes": {
            "total_enters": sum(enter_counts.values()),
            "heat": heat,
            "dwell": dwell_rows,
            "daily_trend": [
                {"date": d, "count": c}
                for d, c in sorted(scene_day_counts.items(), key=lambda x: x[0])
            ],
            "by_user": by_user_rows,
        },
        "invalid_lines": invalid_lines,
    }


def _require_admin(request: Request) -> str:
    username = getattr(request.state, "username", None)
    if not username:
        raise HTTPException(status_code=401, detail="unauthorized")
    if str(username).strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return str(username)


@router.post("/api/demo/usage")
async def post_demo_usage(request: Request, payload: UsageEventIn | dict = Body(...)):
    username = getattr(request.state, "username", None)
    session_id = getattr(request.state, "session_id", "") or ""
    if not username:
        raise HTTPException(status_code=401, detail="unauthorized")

    if isinstance(payload, dict):
        try:
            data = UsageEventIn.model_validate(payload)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"invalid payload: {exc}") from exc
    else:
        data = payload

    event = str(data.event or "").strip()
    if event not in {"scene_enter", "scene_leave", "scene_heartbeat"}:
        raise HTTPException(status_code=400, detail="unsupported event")

    from backend.app.auth import _client_ip

    return append_scene_event(
        event=event,
        username=str(username),
        session_id=str(session_id),
        client_ip=_client_ip(request),
        path=data.path,
        scene_id=data.scene_id,
        sub_feature_id=data.sub_feature_id,
        dwell_ms=data.dwell_ms,
        elapsed_ms=data.elapsed_ms,
        client_ts=data.client_ts,
    )


@router.get("/api/demo/usage/stats")
async def get_demo_usage_stats(
    request: Request,
    range_key: str = Query("7d", alias="range"),
    include_admin: bool = Query(True),
    start: Optional[str] = None,
    end: Optional[str] = None,
    username: Optional[str] = Query(None, description="Filter stats to one username; empty = all"),
):
    _require_admin(request)
    return build_usage_stats(
        range_key=range_key,
        include_admin=include_admin,
        start=start,
        end=end,
        username=username,
    )

"""Session-based authentication aligned with Guard-test settings.json schema."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import quote

from fastapi import Body, FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.responses import Response

ROOT = Path(__file__).resolve().parents[2]
SETTINGS_FILE = Path(os.environ.get("SETTINGS_FILE", str(ROOT / "settings.json")))
SETTINGS_EXAMPLE = ROOT / "settings_example.json"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"

SESSION_COOKIE_NAME = "llm_demo_session"
SESSION_IDLE_TIMEOUT_SECONDS = 20 * 60
LOGIN_FAIL_LIMIT = 5
LOGIN_LOCK_SECONDS = 300

PUBLIC_PATHS = {"/login", "/api/login", "/api/health"}
PUBLIC_PREFIXES = ("/static/",)

SESSIONS_LOCK = threading.Lock()
LOGIN_GUARD_LOCK = threading.Lock()
SETTINGS_LOCK = threading.Lock()
SESSIONS: Dict[str, dict] = {}
LOGIN_ATTEMPTS: Dict[str, dict] = {}

_COOKIE_SECURE = os.environ.get("AUTH_COOKIE_SECURE", "false").lower() == "true"


def _to_int(val: Any, default: int, min_v: int, max_v: int) -> int:
    try:
        n = int(val)
        return max(min_v, min(max_v, n))
    except (TypeError, ValueError):
        return default


def _pbkdf2_hash_password(password: str, salt: str, iterations: int) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return base64.urlsafe_b64encode(dk).decode("ascii").rstrip("=")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algo, iter_s, salt, digest = str(password_hash or "").split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iter_s)
        expected = _pbkdf2_hash_password(password, salt, iterations)
        return hmac.compare_digest(expected, digest)
    except Exception:
        return False


def make_hash_entry(username: str, password: str, *, iterations: int = 120000) -> dict:
    salt = base64.urlsafe_b64encode(secrets.token_bytes(12)).decode("ascii").rstrip("=")
    return {
        "username": username,
        "password_hash": f"pbkdf2_sha256${iterations}${salt}${_pbkdf2_hash_password(password, salt, iterations)}",
        "enabled": True,
    }


def default_structured_settings() -> dict:
    return {
        "auth": {
            "users": [make_hash_entry("admin", "admin123456")],
            "session_ttl_seconds": 86400,
        },
        "global_settings": {},
        "user_settings": {},
    }


def normalize_structured_settings(loaded: Optional[dict]) -> dict:
    baseline = default_structured_settings()
    if not isinstance(loaded, dict):
        return baseline

    auth = loaded.get("auth") if isinstance(loaded.get("auth"), dict) else {}
    global_settings = loaded.get("global_settings") if isinstance(loaded.get("global_settings"), dict) else {}
    user_settings = loaded.get("user_settings") if isinstance(loaded.get("user_settings"), dict) else {}

    users = auth.get("users")
    if not isinstance(users, list) or not users:
        users = baseline["auth"]["users"]

    return {
        "auth": {
            "users": users,
            "session_ttl_seconds": _to_int(auth.get("session_ttl_seconds", 86400), 86400, 300, 604800),
        },
        "global_settings": global_settings,
        "user_settings": user_settings,
    }


def _atomic_write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def load_structured_settings() -> dict:
    if not SETTINGS_FILE.exists():
        with SETTINGS_LOCK:
            if not SETTINGS_FILE.exists():
                if SETTINGS_EXAMPLE.exists():
                    shutil.copy(SETTINGS_EXAMPLE, SETTINGS_FILE)
                else:
                    _atomic_write_json(SETTINGS_FILE, default_structured_settings())
    with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
        loaded = json.load(f)
    return normalize_structured_settings(loaded)


def get_enabled_users(structured: dict) -> Dict[str, dict]:
    users_map: Dict[str, dict] = {}
    users = structured.get("auth", {}).get("users", [])
    if not isinstance(users, list):
        return users_map
    for item in users:
        if not isinstance(item, dict):
            continue
        username = str(item.get("username") or "").strip()
        if not username or item.get("enabled", True) is False:
            continue
        users_map[username] = item
    return users_map


def create_session(username: str, ttl_seconds: int, client_ip: str) -> str:
    sid = secrets.token_urlsafe(24)
    now = time.time()
    with SESSIONS_LOCK:
        SESSIONS[sid] = {
            "username": username,
            "created_at": now,
            "last_seen": now,
            "expires_at": now + ttl_seconds,
            "client_ip": client_ip or "unknown",
        }
    return sid


def get_current_session(request: Request) -> Optional[dict]:
    sid = request.cookies.get(SESSION_COOKIE_NAME)
    if not sid:
        return None
    with SESSIONS_LOCK:
        sess = SESSIONS.get(sid)
        if not sess:
            return None
        now = time.time()
        if now > sess["expires_at"]:
            del SESSIONS[sid]
            return None
        if (now - sess["last_seen"]) > SESSION_IDLE_TIMEOUT_SECONDS:
            del SESSIONS[sid]
            return None
        structured = load_structured_settings()
        if sess["username"] not in get_enabled_users(structured):
            del SESSIONS[sid]
            return None
        sess["last_seen"] = now
        return {"session_id": sid, **sess}


def _client_ip(request: Request) -> str:
    xff = (request.headers.get("x-forwarded-for") or "").strip()
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    xrip = (request.headers.get("x-real-ip") or "").strip()
    if xrip:
        return xrip
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _login_client_key(request: Request, username: str) -> str:
    ua = (request.headers.get("user-agent") or "").strip().lower()
    ip = _client_ip(request)
    return f"{username.lower()}|{ip}|{ua}"


def _check_login_lock(client_key: str) -> int:
    now = time.time()
    with LOGIN_GUARD_LOCK:
        rec = LOGIN_ATTEMPTS.get(client_key)
        if not rec:
            return 0
        lock_until = float(rec.get("lock_until", 0))
        if lock_until > now:
            return int(lock_until - now)
        if lock_until and lock_until <= now:
            LOGIN_ATTEMPTS.pop(client_key, None)
        return 0


def _register_login_failure(client_key: str) -> bool:
    locked_now = False
    now = time.time()
    with LOGIN_GUARD_LOCK:
        rec = LOGIN_ATTEMPTS.get(client_key) or {"count": 0, "first_ts": now, "lock_until": 0}
        lock_until = float(rec.get("lock_until", 0))
        if lock_until > now:
            LOGIN_ATTEMPTS[client_key] = rec
            return False
        first_ts = float(rec.get("first_ts", now))
        if now - first_ts > LOGIN_LOCK_SECONDS:
            rec = {"count": 0, "first_ts": now, "lock_until": 0}
        rec["count"] = int(rec.get("count", 0)) + 1
        if rec["count"] >= LOGIN_FAIL_LIMIT:
            rec["lock_until"] = now + LOGIN_LOCK_SECONDS
            rec["count"] = 0
            rec["first_ts"] = now
            locked_now = True
        LOGIN_ATTEMPTS[client_key] = rec
    return locked_now


def _clear_login_failure(client_key: str) -> None:
    with LOGIN_GUARD_LOCK:
        LOGIN_ATTEMPTS.pop(client_key, None)


def safe_return_to(raw: Optional[str]) -> str:
    if not raw:
        return "/"
    text = str(raw).strip()
    if not text.startswith("/") or text.startswith("//") or "://" in text:
        return "/"
    return text


def _set_session_cookie(response: Response, sid: str, ttl: int) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=sid,
        httponly=True,
        samesite="lax",
        secure=_COOKIE_SECURE,
        max_age=ttl,
    )


def _delete_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        samesite="lax",
        secure=_COOKIE_SECURE,
    )


def _login_redirect_url(request: Request) -> str:
    path = request.url.path or "/"
    query = request.url.query
    target = path if not query else f"{path}?{query}"
    return f"/login?return_to={quote(target, safe='')}"


def require_user(request: Request) -> str:
    if getattr(request.state, "username", None):
        return request.state.username
    sess = get_current_session(request)
    if not sess:
        raise HTTPException(status_code=401, detail="unauthorized")
    request.state.session_id = sess["session_id"]
    request.state.username = sess["username"]
    return sess["username"]


def install_auth(app: FastAPI) -> None:
    if STATIC_DIR.is_dir():
        app.mount("/static", StaticFiles(directory=STATIC_DIR), name="auth_static")

    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

    @app.middleware("http")
    async def auth_guard(request: Request, call_next):
        path = request.url.path
        if path in PUBLIC_PATHS or any(path.startswith(p) for p in PUBLIC_PREFIXES):
            return await call_next(request)

        session = get_current_session(request)
        if not session:
            if path.startswith("/api/"):
                return JSONResponse({"detail": "unauthorized"}, status_code=401)
            return RedirectResponse(url=_login_redirect_url(request), status_code=status.HTTP_302_FOUND)

        request.state.session_id = session["session_id"]
        request.state.username = session["username"]
        return await call_next(request)

    @app.get("/login", response_class=HTMLResponse)
    async def login_page(request: Request):
        if get_current_session(request):
            return RedirectResponse(url=safe_return_to(request.query_params.get("return_to")), status_code=302)
        return templates.TemplateResponse(
            "login.html",
            {
                "request": request,
                "return_to": safe_return_to(request.query_params.get("return_to")),
            },
        )

    @app.post("/api/login")
    async def api_login(request: Request, payload: dict = Body(default=None)):
        username = str((payload or {}).get("username") or "").strip()
        password = str((payload or {}).get("password") or "")
        return_to = safe_return_to((payload or {}).get("return_to"))
        if not username or not password:
            raise HTTPException(status_code=400, detail="username and password are required")

        client_key = _login_client_key(request, username)
        remain = _check_login_lock(client_key)
        if remain > 0:
            raise HTTPException(status_code=429, detail=f"too many failed attempts, retry after {remain}s")

        structured = load_structured_settings()
        users = get_enabled_users(structured)
        user_item = users.get(username)
        if not user_item or not verify_password(password, user_item.get("password_hash", "")):
            if _register_login_failure(client_key):
                raise HTTPException(status_code=429, detail=f"too many failed attempts, retry after {LOGIN_LOCK_SECONDS}s")
            raise HTTPException(status_code=401, detail="invalid username or password")

        _clear_login_failure(client_key)
        ttl = _to_int(structured.get("auth", {}).get("session_ttl_seconds", 86400), 86400, 300, 604800)
        sid = create_session(username, ttl, _client_ip(request))
        resp = JSONResponse({"status": "ok", "username": username, "redirect_url": return_to})
        _set_session_cookie(resp, sid, ttl)
        return resp

    @app.post("/api/logout")
    async def api_logout(request: Request):
        sid = request.cookies.get(SESSION_COOKIE_NAME)
        if sid:
            with SESSIONS_LOCK:
                SESSIONS.pop(sid, None)
        resp = JSONResponse({"status": "ok"})
        _delete_session_cookie(resp)
        return resp

    @app.get("/api/auth/me")
    async def api_auth_me(request: Request):
        username = require_user(request)
        return {"username": username}

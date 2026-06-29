"""Runtime config for values that may live in gitignored config.py."""

from __future__ import annotations

import os
from urllib.parse import urlparse

DEFAULT_GRAFANA_URL = "http://localhost:3001"


def _settings_attr(name: str, default: str = "") -> str:
    try:
        from backend.app.config import settings

        value = getattr(settings, name, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if value is not None and not isinstance(value, str):
            return str(value)
    except Exception:
        pass
    return default


def get_grafana_url() -> str:
    value = _settings_attr("grafana_url")
    if value:
        return value.rstrip("/")
    env_value = os.environ.get("LLM_DEMO_GRAFANA_URL", "").strip()
    if env_value:
        return env_value.rstrip("/")
    return DEFAULT_GRAFANA_URL


def get_grafana_target() -> tuple[str, str, str]:
    """Return (origin, redirect_url, redirect_path) from configured Grafana URL."""
    configured = get_grafana_url()
    parsed = urlparse(configured)
    if not parsed.scheme or not parsed.netloc:
        base = DEFAULT_GRAFANA_URL
        return base, base, "/"

    origin = f"{parsed.scheme}://{parsed.netloc}"
    redirect_path = parsed.path or "/"
    if parsed.query:
        redirect_url = f"{origin}{redirect_path}?{parsed.query}"
    else:
        redirect_url = f"{origin}{redirect_path}" if redirect_path != "/" else origin
    return origin, redirect_url, redirect_path


def get_grafana_username() -> str:
    value = _settings_attr("grafana_username")
    if value:
        return value
    return os.environ.get("LLM_DEMO_GRAFANA_USERNAME", "").strip()


def get_grafana_password() -> str:
    value = _settings_attr("grafana_password")
    if value:
        return value
    return os.environ.get("LLM_DEMO_GRAFANA_PASSWORD", "").strip()


def get_grafana_verify_tls() -> bool:
    try:
        from backend.app.config import settings

        return bool(getattr(settings, "grafana_verify_tls", True))
    except Exception:
        pass
    raw = os.environ.get("LLM_DEMO_GRAFANA_VERIFY_TLS", "true").strip().lower()
    return raw not in ("0", "false", "no", "off")


def grafana_auto_login_enabled() -> bool:
    return bool(get_grafana_username() and get_grafana_password())

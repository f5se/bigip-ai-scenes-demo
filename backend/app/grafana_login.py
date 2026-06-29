"""Grafana session bootstrap via Login API."""

from __future__ import annotations

from urllib.parse import urlparse

import httpx
from starlette.responses import RedirectResponse

from backend.app.runtime_config import (
    get_grafana_password,
    get_grafana_url,
    get_grafana_username,
    get_grafana_verify_tls,
    grafana_auto_login_enabled,
)


async def _post_login(
    client: httpx.AsyncClient,
    url: str,
    username: str,
    password: str,
    *,
    as_json: bool,
) -> httpx.Response:
    if as_json:
        return await client.post(url, json={"user": username, "password": password})
    return await client.post(url, data={"user": username, "password": password})


async def _grafana_login(
    base_url: str,
    username: str,
    password: str,
    *,
    verify_tls: bool,
) -> httpx.Response | None:
    async with httpx.AsyncClient(timeout=10.0, verify=verify_tls, follow_redirects=False) as client:
        for path in ("/login", "/api/login"):
            login_url = f"{base_url}{path}"
            for as_json in (True, False):
                try:
                    resp = await _post_login(client, login_url, username, password, as_json=as_json)
                except httpx.HTTPError:
                    continue
                if resp.status_code in (200, 302) and resp.cookies:
                    return resp
    return None


def _apply_grafana_cookies(
    redirect: RedirectResponse,
    login_resp: httpx.Response,
    grafana_url: str,
) -> None:
    parsed = urlparse(grafana_url)
    domain = parsed.hostname
    if not domain:
        return

    secure = parsed.scheme == "https"
    for name, value in login_resp.cookies.items():
        redirect.set_cookie(
            key=name,
            value=value,
            domain=domain,
            path="/",
            httponly=True,
            secure=secure,
            samesite="lax",
        )


async def build_grafana_open_redirect() -> RedirectResponse:
    grafana_url = get_grafana_url()
    redirect = RedirectResponse(url=f"{grafana_url}/", status_code=302)

    if not grafana_auto_login_enabled():
        return redirect

    login_resp = await _grafana_login(
        grafana_url,
        get_grafana_username(),
        get_grafana_password(),
        verify_tls=get_grafana_verify_tls(),
    )
    if login_resp is not None:
        _apply_grafana_cookies(redirect, login_resp, grafana_url)
    return redirect

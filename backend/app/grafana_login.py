"""Grafana session bootstrap: server-side login + browser form fallback."""

from __future__ import annotations

import html
import logging
import re

import httpx
from starlette.responses import HTMLResponse, RedirectResponse, Response

from backend.app.runtime_config import (
    get_grafana_password,
    get_grafana_target,
    get_grafana_username,
    get_grafana_verify_tls,
    grafana_auto_login_enabled,
)

logger = logging.getLogger(__name__)


async def _post_login(
    client: httpx.AsyncClient,
    url: str,
    origin: str,
    username: str,
    password: str,
    *,
    as_json: bool,
    redirect_path: str,
) -> httpx.Response:
    if as_json:
        payload: dict[str, str] = {"user": username, "password": password}
        if redirect_path and redirect_path != "/":
            payload["redirectUrl"] = redirect_path
        return await client.post(
            url,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Origin": origin,
                "Referer": f"{origin}/login",
            },
        )
    data = {"user": username, "password": password}
    if redirect_path and redirect_path != "/":
        data["redirectTo"] = redirect_path
    return await client.post(url, data=data)


async def _grafana_login(
    origin: str,
    username: str,
    password: str,
    *,
    verify_tls: bool,
    redirect_path: str,
) -> httpx.Response | None:
    async with httpx.AsyncClient(timeout=15.0, verify=verify_tls, follow_redirects=False) as client:
        # Grafana 9+ prefers JSON on /login; /api/login is legacy/basic-auth oriented.
        attempts: list[tuple[str, bool]] = [
            ("/login", True),
            ("/login", False),
            ("/api/login", True),
        ]
        for path, as_json in attempts:
            login_url = f"{origin}{path}"
            try:
                resp = await _post_login(
                    client,
                    login_url,
                    origin,
                    username,
                    password,
                    as_json=as_json,
                    redirect_path=redirect_path,
                )
            except httpx.HTTPError as exc:
                logger.warning("Grafana login request failed (%s): %s", login_url, exc)
                continue

            body_preview = (resp.text or "")[:160]
            if resp.status_code in (200, 302) and resp.cookies:
                logger.info(
                    "Grafana login succeeded via %s (status=%s, cookies=%s)",
                    login_url,
                    resp.status_code,
                    list(resp.cookies.keys()),
                )
                return resp

            logger.warning(
                "Grafana login rejected via %s (status=%s, cookies=%s, body=%s)",
                login_url,
                resp.status_code,
                list(resp.cookies.keys()),
                body_preview,
            )
    return None


async def _fetch_login_page(origin: str, *, verify_tls: bool) -> httpx.Response | None:
    try:
        async with httpx.AsyncClient(timeout=15.0, verify=verify_tls, follow_redirects=True) as client:
            return await client.get(f"{origin}/login")
    except httpx.HTTPError as exc:
        logger.warning("Failed to fetch Grafana login page: %s", exc)
        return None


def _extract_csrf_token(login_page: httpx.Response) -> str:
    csrf = login_page.cookies.get("grafana_csrf", "")
    if csrf:
        return csrf
    match = re.search(r'name="csrfToken"\s+value="([^"]+)"', login_page.text)
    return match.group(1) if match else ""


def _apply_grafana_cookies(
    response: Response,
    source: httpx.Response,
    origin: str,
) -> None:
    host = httpx.URL(origin).host
    secure = origin.startswith("https://")
    for name, value in source.cookies.items():
        response.set_cookie(
            key=name,
            value=value,
            domain=host,
            path="/",
            httponly=True,
            secure=secure,
            samesite="lax",
        )


def _build_browser_login_html(
    *,
    origin: str,
    username: str,
    password: str,
    redirect_path: str,
    csrf_token: str,
) -> str:
    action = html.escape(f"{origin}/login", quote=True)
    fields = [
        f'<input type="hidden" name="user" value="{html.escape(username, quote=True)}" />',
        f'<input type="hidden" name="password" value="{html.escape(password, quote=True)}" />',
    ]
    if redirect_path and redirect_path != "/":
        fields.append(
            f'<input type="hidden" name="redirectTo" value="{html.escape(redirect_path, quote=True)}" />'
        )
    if csrf_token:
        fields.append(
            f'<input type="hidden" name="csrfToken" value="{html.escape(csrf_token, quote=True)}" />'
        )
    body = "\n".join(fields)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Opening Grafana…</title>
</head>
<body>
  <p style="font-family:system-ui,sans-serif;color:#64748b">Signing in to Grafana…</p>
  <form id="grafana-login" method="POST" action="{action}">
    {body}
  </form>
  <script>document.getElementById("grafana-login").submit();</script>
</body>
</html>"""


async def build_grafana_open_response() -> Response:
    origin, redirect_url, redirect_path = get_grafana_target()

    if not grafana_auto_login_enabled():
        logger.info("Grafana auto-login disabled (missing username/password); redirecting to %s", redirect_url)
        return RedirectResponse(url=redirect_url, status_code=302)

    username = get_grafana_username()
    password = get_grafana_password()
    verify_tls = get_grafana_verify_tls()

    login_resp = await _grafana_login(
        origin,
        username,
        password,
        verify_tls=verify_tls,
        redirect_path=redirect_path,
    )
    if login_resp is not None and login_resp.cookies:
        redirect = RedirectResponse(url=redirect_url, status_code=302)
        _apply_grafana_cookies(redirect, login_resp, origin)
        logger.info("Grafana auto-login via server-side session; redirecting to %s", redirect_url)
        return redirect

    logger.warning(
        "Grafana server-side login failed for origin=%s; trying browser form POST fallback",
        origin,
    )
    login_page = await _fetch_login_page(origin, verify_tls=verify_tls)
    csrf_token = _extract_csrf_token(login_page) if login_page else ""

    html_body = _build_browser_login_html(
        origin=origin,
        username=username,
        password=password,
        redirect_path=redirect_path,
        csrf_token=csrf_token,
    )
    response = HTMLResponse(content=html_body)
    if login_page is not None:
        _apply_grafana_cookies(response, login_page, origin)
    return response

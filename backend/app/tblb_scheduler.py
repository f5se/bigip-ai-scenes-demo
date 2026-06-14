import asyncio
from typing import Any

import httpx
from fastapi import HTTPException

from backend.app.config import settings
from backend.app.proxy import validate_target


async def fetch_scheduler_pool_status(
    host: str,
    port: int,
    pool_name: str,
    partition: str = "Common",
) -> dict[str, Any]:
    url = f"http://{host}:{port}/pools/{pool_name}/{partition}/status"
    timeout = httpx.Timeout(
        connect=settings.connect_timeout,
        read=settings.connect_timeout,
        write=settings.connect_timeout,
        pool=settings.connect_timeout,
    )
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"scheduler_http_{exc.response.status_code}",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"scheduler_unreachable: {type(exc).__name__}",
        ) from exc

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="scheduler_invalid_response")

    members = data.get("members")
    if not isinstance(members, list):
        raise HTTPException(status_code=502, detail="scheduler_missing_members")

    return data


async def _trigger_one_member(
    client: httpx.AsyncClient,
    ip: str,
    port: int,
    path: str,
) -> dict[str, Any]:
    validate_target(ip, port)
    url = f"http://{ip}:{port}{path}"
    entry: dict[str, Any] = {"ip": ip, "port": port, "url": url, "ok": False}
    try:
        response = await client.post(url)
        entry["status_code"] = response.status_code
        entry["ok"] = response.is_success
    except httpx.RequestError as exc:
        entry["error"] = type(exc).__name__
    return entry


async def trigger_members_load(
    members: list[dict[str, Any]],
    path: str | None = None,
) -> list[dict[str, Any]]:
    trigger_path = path or settings.tblb_trigger_path
    if not members:
        return []

    timeout = httpx.Timeout(
        connect=settings.connect_timeout,
        read=settings.connect_timeout,
        write=settings.connect_timeout,
        pool=settings.connect_timeout,
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        tasks = [
            _trigger_one_member(
                client,
                str(member.get("ip", "")),
                int(member.get("port", 0)),
                trigger_path,
            )
            for member in members
            if member.get("ip") and member.get("port")
        ]
        return list(await asyncio.gather(*tasks))

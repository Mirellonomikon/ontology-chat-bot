import logging
from typing import Any

import httpx
from fastapi import HTTPException

logger = logging.getLogger("chatbot.kg_client")


async def kg_request(method: str, url: str, *, timeout: float = 15.0, **kwargs: Any) -> dict:
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.request(method, url, timeout=timeout, **kwargs)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            logger.error("KG service returned error %d: %s", exc.response.status_code, exc.response.text)
            raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
        except httpx.HTTPError as exc:
            logger.error("KG service unreachable: %s", exc)
            raise HTTPException(status_code=502, detail=f"KG service unreachable: {exc}")


async def kg_get(url: str, params: dict[str, Any] | None = None, *, timeout: float = 15.0) -> dict:
    return await kg_request("GET", url, params=params, timeout=timeout)


_FILE_PASSTHROUGH_HEADERS = ("content-type", "content-disposition", "x-triple-count")


async def kg_get_file(url: str, *, timeout: float = 60.0) -> tuple[bytes, dict[str, str]]:
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(url, timeout=timeout)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error("KG service returned error %d: %s", exc.response.status_code, exc.response.text)
            raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text)
        except httpx.HTTPError as exc:
            logger.error("KG service unreachable: %s", exc)
            raise HTTPException(status_code=502, detail=f"KG service unreachable: {exc}")

    headers = {k: resp.headers[k] for k in _FILE_PASSTHROUGH_HEADERS if k in resp.headers}
    return resp.content, headers

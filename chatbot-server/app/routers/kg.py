from fastapi import APIRouter, Depends, Query, Response

from app.config import Settings, get_settings
from app.kg_client import kg_get, kg_get_file

router = APIRouter()


@router.get("/graph", summary="Get graph visualization data")
async def get_graph(
    mode: str = Query("schema", pattern="^(schema|instances|full)$"),
    dataset: str | None = Query(None),
    group_by: str | None = Query(None),
    settings: Settings = Depends(get_settings),
) -> dict:
    params = {"mode": mode}
    if dataset:
        params["dataset"] = dataset
    if group_by:
        params["group_by"] = group_by
    return await kg_get(f"{settings.kg_service_url}/graph", params)


@router.get("/export/ttl", summary="Download all datasets as a ZIP of TTL files")
async def export_all_ttl(settings: Settings = Depends(get_settings)) -> Response:
    content, headers = await kg_get_file(f"{settings.kg_service_url}/export/ttl")
    return Response(content=content, headers=headers)


@router.get("/export/ttl/{dataset_name}", summary="Download one dataset as a TTL file")
async def export_dataset_ttl(
    dataset_name: str,
    settings: Settings = Depends(get_settings),
) -> Response:
    content, headers = await kg_get_file(f"{settings.kg_service_url}/export/ttl/{dataset_name}")
    return Response(content=content, headers=headers)

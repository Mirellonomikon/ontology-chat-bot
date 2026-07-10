import io
import json
import logging
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.config import Settings, get_settings
from app.kg_client import kg_get, kg_request
from app.models import ProviderName
from app.ontology_induction import induce_ontology
from app.providers import get_provider

router = APIRouter()
logger = logging.getLogger("chatbot.ingest")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
_TABULAR_SKIP = {".ttl", ".turtle"}


@router.get("/schema", summary="Fetch knowledge graph schema")
async def get_schema(settings: Settings = Depends(get_settings)) -> dict:
    return await kg_get(f"{settings.kg_service_url}/schema", timeout=5.0)


@router.delete("/datasets/{dataset_name}", summary="Delete a dataset from the knowledge graph")
async def delete_dataset(
    dataset_name: str,
    settings: Settings = Depends(get_settings),
) -> dict:
    logger.info("Deleting dataset from KG: %s", dataset_name)
    return await kg_request(
        "DELETE", f"{settings.kg_service_url}/datasets/{dataset_name}", timeout=10.0
    )


def _read_dataframe(content: bytes, filename: str) -> pd.DataFrame:
    name = filename.lower()
    buf = io.BytesIO(content)
    if name.endswith((".xlsx", ".xls")):
        return pd.read_excel(buf)
    if name.endswith(".json"):
        return pd.read_json(buf)
    if name.endswith(".tsv"):
        return pd.read_csv(buf, sep="\t")
    if name.endswith(".parquet"):
        return pd.read_parquet(buf)
    return pd.read_csv(buf)


async def _induce_proposal(
    content: bytes, filename: str, provider: str, model: str, settings: Settings
) -> str | None:
    try:
        df = _read_dataframe(content, filename)
        df = df.dropna(axis=1, how="all")
        if df.empty:
            return None
        try:
            schema = await kg_get(f"{settings.kg_service_url}/schema", timeout=5.0)
            existing_classes = [
                c for c in schema.get("classes", [])
                if c.get("uri") not in ("ex:Record", "ex:Dataset")
            ]
        except Exception:
            existing_classes = []
        prov = get_provider(ProviderName(provider), settings)
        proposal = await induce_ontology(
            prov, model, df, Path(filename).stem, existing_classes,
            max_tokens=settings.induction_max_tokens,
        )
        return json.dumps(proposal) if proposal else None
    except Exception as exc:
        logger.warning("Ontology induction skipped for '%s' (%s)", filename, exc)
        return None


@router.post("/upload", summary="Upload a file to the knowledge graph")
async def upload_file(
    file: UploadFile = File(...),
    provider: str | None = Form(None),
    model: str | None = Form(None),
    settings: Settings = Depends(get_settings),
) -> dict:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 50 MB.")
    content_type = file.content_type or "application/octet-stream"
    filename = file.filename or "upload.csv"
    ext = Path(filename).suffix.lower()

    proposal_json: str | None = None
    if settings.enable_llm_induction and provider and model and ext not in _TABULAR_SKIP:
        proposal_json = await _induce_proposal(content, filename, provider, model, settings)

    logger.info(
        "Forwarding upload to KG service: %s (%d bytes, proposal=%s)",
        filename, len(content), bool(proposal_json),
    )
    result = await kg_request(
        "POST",
        f"{settings.kg_service_url}/ingest",
        files={"file": (filename, content, content_type)},
        data={"proposal": proposal_json} if proposal_json else None,
        timeout=120.0,
    )
    logger.info(
        "KG ingest response: %d rows, %d triples stored",
        result.get("rows", 0), result.get("triples_stored", 0),
    )
    return result

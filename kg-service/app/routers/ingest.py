import io
import json
import logging
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pyoxigraph
from fastapi import APIRouter, File, Form, HTTPException, UploadFile

import app.config as cfg
from app.config import sanitize
from app.models import Triple
from app.routers.rdf import build_quad
from app.rules import materialize as materialize_rules
from app.semantics import bootstrap_schema, enrich_dataset, relink_datasets

router = APIRouter()
logger = logging.getLogger("kg.ingest")

MAX_UPLOAD_BYTES = 50 * 1024 * 1024




def _literal(val: Any) -> tuple[str, str | None]:
    if isinstance(val, (bool, np.bool_)):
        return ("true" if val else "false", f"{cfg.XSD}boolean")
    if isinstance(val, (int, np.integer)):
        return (str(val), f"{cfg.XSD}integer")
    if isinstance(val, (float, np.floating)):
        return (str(val), f"{cfg.XSD}decimal")
    return (str(val), None)


def _read_file(content: bytes, filename: str) -> pd.DataFrame:
    name = filename.lower()
    buf = io.BytesIO(content)
    if name.endswith(".csv"):
        return pd.read_csv(buf)
    if name.endswith((".xlsx", ".xls")):
        return pd.read_excel(buf)
    if name.endswith(".json"):
        return pd.read_json(buf)
    if name.endswith(".tsv"):
        return pd.read_csv(buf, sep="\t")
    if name.endswith(".parquet"):
        return pd.read_parquet(buf)
    return pd.read_csv(buf)


def _df_to_triples(df: pd.DataFrame, dataset_name: str) -> list[Triple]:
    EX = cfg.EX
    triples: list[Triple] = []
    ds_uri = f"{EX}{sanitize(dataset_name)}"

    triples.append(Triple(subject=ds_uri, predicate=f"{EX}type", object=f"{EX}Dataset", object_is_literal=False))
    triples.append(Triple(subject=ds_uri, predicate=f"{EX}fileName", object=dataset_name))
    for col in df.columns:
        triples.append(Triple(subject=ds_uri, predicate=f"{EX}hasColumn", object=str(col)))

    for _, row in df.iterrows():
        rec_uri = f"{EX}record_{uuid.uuid4().hex}"
        triples.append(Triple(subject=ds_uri, predicate=f"{EX}hasRecord", object=rec_uri, object_is_literal=False))
        triples.append(Triple(subject=rec_uri, predicate=f"{EX}type", object=f"{EX}Record", object_is_literal=False))
        for col, val in row.items():
            if not isinstance(val, str) and pd.isna(val):
                continue
            obj, xsd_type = _literal(val)
            triples.append(Triple(
                subject=rec_uri,
                predicate=f"{EX}{sanitize(str(col))}",
                object=obj,
                datatype=xsd_type,
            ))

    return triples


def _ingest_ttl(content: bytes, filename: str, dataset_name: str) -> dict:
    EX = cfg.EX
    before = len(cfg.store)
    cfg.store.load(io.BytesIO(content), pyoxigraph.RdfFormat.TURTLE, base_iri=EX)
    added = len(cfg.store) - before
    if added == 0:
        raise HTTPException(
            status_code=422,
            detail="The TTL file contains no new triples (it may be empty or already imported).",
        )
    ds_uri = f"{EX}{sanitize(dataset_name)}"
    self_describing = bool(cfg.store.query(f"ASK {{ <{ds_uri}> <{EX}type> <{EX}Dataset> }}"))
    if not self_describing:
        for t in [
            Triple(subject=ds_uri, predicate=f"{EX}type", object=f"{EX}Dataset", object_is_literal=False),
            Triple(subject=ds_uri, predicate=f"{EX}fileName", object=filename),
        ]:
            cfg.store.add(build_quad(t))
    return {"file": filename, "dataset": dataset_name, "triples_stored": added}




@router.post("/ingest", tags=["ingest"])
async def ingest_file(
    file: UploadFile = File(...),
    proposal: str | None = Form(None),
) -> dict:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 50 MB.")
    filename = file.filename or "upload.csv"
    ext = Path(filename).suffix.lower() or ".csv"

    logger.info("Ingesting file: %s (%d bytes, format=%s)", filename, len(content), ext)

    if ext in {".ttl", ".turtle"}:
        try:
            result = _ingest_ttl(content, filename, Path(filename).stem)
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Failed to parse TTL '%s': %s", filename, exc)
            raise HTTPException(status_code=422, detail=f"Failed to parse '{filename}': {exc}")
        logger.info("Stored %d TTL triples for '%s' (store size: %d)", result["triples_stored"], result["dataset"], len(cfg.store))
        return result

    try:
        df = _read_file(content, filename)
    except Exception as exc:
        logger.error("Failed to parse '%s': %s", filename, exc)
        raise HTTPException(status_code=422, detail=f"Failed to parse '{filename}': {exc}")

    if df.empty:
        raise HTTPException(status_code=422, detail="The uploaded file contains no data.")

    df = df.dropna(axis=1, how="all")
    logger.info("Parsed %d rows, %d columns from %s", len(df), len(df.columns), filename)

    dataset_name = Path(filename).stem
    triples = _df_to_triples(df, dataset_name)

    added = 0
    for t in triples:
        try:
            cfg.store.add(build_quad(t))
            added += 1
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid triple: {exc}")

    logger.info("Stored %d triples for dataset '%s' (total store size: %d)", added, dataset_name, len(cfg.store))

    proposal_obj = None
    if proposal:
        try:
            proposal_obj = json.loads(proposal)
        except Exception as exc:
            logger.warning("Ignoring malformed ontology proposal: %s", exc)

    bootstrap_schema(cfg.store)
    ds_uri = f"{cfg.EX}{sanitize(dataset_name)}"
    semantics = enrich_dataset(cfg.store, df, dataset_name, ds_uri, proposal_obj)
    relink = relink_datasets(cfg.store)
    rules = materialize_rules(cfg.store)

    return {
        "file": filename,
        "dataset": dataset_name,
        "rows": len(df),
        "columns": list(df.columns),
        "triples_stored": added,
        "semantics": semantics,
        "relink": relink,
        "rules": rules,
    }

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.config as cfg
from app.routers import ingest, rdf

cfg.setup_logging()

_cors_raw = os.getenv("CORS_ORIGINS", "http://localhost:8000").strip()
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]

_is_dev = cfg.APP_ENV.lower() == "development"

app = FastAPI(
    title="KG Service",
    version="1.0.0",
    docs_url="/docs" if _is_dev else None,
    redoc_url="/redoc" if _is_dev else None,
    openapi_url="/openapi.json" if _is_dev else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rdf.router)
app.include_router(ingest.router)


@app.get("/health", tags=["health"])
def health() -> dict:
    return {"status": "ok", "triple_count": len(cfg.store)}

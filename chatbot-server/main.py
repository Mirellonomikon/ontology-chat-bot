from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings, setup_logging
from app.db import init_db
from app.exceptions import ProviderError
from app.routers import chat
from app.routers import history as history_router
from app.routers import ingest as ingest_router
from app.routers import kg as kg_router
from app.routers import models as models_router
from app.routers import providers as providers_router
from app.routers import settings as settings_router

settings = get_settings()
setup_logging(settings.log_level)

_is_dev = settings.app_env.lower() == "development"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description=(
        "Multi-provider AI chatbot API supporting LM Studio and OpenRouter."
    ),
    lifespan=lifespan,
    docs_url="/docs" if _is_dev else None,
    redoc_url="/redoc" if _is_dev else None,
    openapi_url="/openapi.json" if _is_dev else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response


app.add_middleware(SecurityHeadersMiddleware)


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": str(exc)},
    )


app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(models_router.router, prefix="/models", tags=["models"])
app.include_router(providers_router.router, prefix="/providers", tags=["providers"])
app.include_router(history_router.router, prefix="/history", tags=["history"])
app.include_router(settings_router.router, prefix="/settings", tags=["settings"])
app.include_router(ingest_router.router, prefix="/ingest", tags=["ingest"])
app.include_router(kg_router.router, prefix="/kg", tags=["kg"])


@app.get("/health", tags=["health"], summary="Health check")
async def health_check() -> dict:
    return {"status": "ok", "version": settings.app_version}


# Serves the built chatbot-ui frontend (chatbot-ui/dist copied here at Docker
# build time) same-origin. Registered last so it only catches paths no API
# router above matched; absent in local dev, where the UI runs via Vite instead.
_dist = Path(__file__).parent / "static"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")

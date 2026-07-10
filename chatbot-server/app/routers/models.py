import logging

from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.models import ModelInfo, ModelsResponse, ProviderName
from app.providers import get_provider, provider_configured

router = APIRouter()
logger = logging.getLogger("chatbot.models")


@router.get("/", response_model=ModelsResponse, summary="List all available models")
async def list_all_models(
    settings: Settings = Depends(get_settings),
) -> ModelsResponse:
    models: list[ModelInfo] = []
    for provider_name in ProviderName:
        if not provider_configured(provider_name, settings)[0]:
            continue
        try:
            provider = get_provider(provider_name, settings)
            ids = await provider.list_models()
            models.extend(ModelInfo(id=m, provider=provider_name.value) for m in ids)
        except Exception as exc:
            logger.warning("Skipping provider %s — list_models failed: %s", provider_name.value, exc)
    return ModelsResponse(models=models)


@router.get(
    "/{provider_name}",
    response_model=ModelsResponse,
    summary="List models for a specific provider",
)
async def list_provider_models(
    provider_name: ProviderName,
    settings: Settings = Depends(get_settings),
) -> ModelsResponse:
    provider = get_provider(provider_name, settings)
    ids = await provider.list_models()
    models = [ModelInfo(id=m, provider=provider_name.value) for m in ids]
    return ModelsResponse(models=models)

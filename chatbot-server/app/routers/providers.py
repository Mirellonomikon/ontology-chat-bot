from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.models import ProviderName, ProviderStatus, ProvidersResponse
from app.providers import provider_configured

router = APIRouter()


@router.get("/", response_model=ProvidersResponse, summary="List configured providers")
async def list_providers(
    settings: Settings = Depends(get_settings),
) -> ProvidersResponse:
    statuses: list[ProviderStatus] = []
    for name in ProviderName:
        configured, reason = provider_configured(name, settings)
        statuses.append(
            ProviderStatus(name=name.value, configured=configured, reason=reason)
        )
    return ProvidersResponse(providers=statuses)

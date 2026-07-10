from dotenv import set_key

from fastapi import APIRouter, Depends

from app.config import ENV_FILE, HARO_SYSTEM_PROMPT, Settings, clear_settings_cache, get_settings
from app.models import ProviderKeyStatus, ProviderName, SettingsResponse, SystemPromptResponse, UpdateSettingsRequest
from app.providers import provider_configured

router = APIRouter()


def _mask(value: str) -> str:
    if not value:
        return ""
    visible = value[:6]
    return f"{visible}••••••"


def _provider_statuses(settings: Settings) -> list[ProviderKeyStatus]:
    return [
        ProviderKeyStatus(
            name=ProviderName.OPENROUTER.value,
            key_set=provider_configured(ProviderName.OPENROUTER, settings)[0],
            key_hint=_mask(settings.openrouter_api_key),
        ),
        ProviderKeyStatus(
            name=ProviderName.GEMINI.value,
            key_set=provider_configured(ProviderName.GEMINI, settings)[0],
            key_hint=_mask(settings.gemini_api_key),
        ),
    ]


@router.get("/", response_model=SettingsResponse, summary="Get provider key status")
async def get_provider_settings(
    settings: Settings = Depends(get_settings),
) -> SettingsResponse:
    return SettingsResponse(providers=_provider_statuses(settings))


@router.put("/", response_model=SettingsResponse, summary="Update provider keys")
async def update_provider_settings(
    body: UpdateSettingsRequest,
) -> SettingsResponse:
    env_path = str(ENV_FILE)

    if body.openrouter_api_key is not None and body.openrouter_api_key.strip():
        set_key(env_path, "OPENROUTER_API_KEY", body.openrouter_api_key.strip())

    if body.gemini_api_key is not None and body.gemini_api_key.strip():
        set_key(env_path, "GEMINI_API_KEY", body.gemini_api_key.strip())

    clear_settings_cache()
    fresh = get_settings()

    return SettingsResponse(providers=_provider_statuses(fresh))


@router.get("/system-prompt", response_model=SystemPromptResponse, summary="Get the Haro system prompt")
async def get_system_prompt() -> SystemPromptResponse:
    return SystemPromptResponse(text=HARO_SYSTEM_PROMPT)

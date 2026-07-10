from app.config import Settings
from app.models import ProviderName
from app.providers.base import BaseProvider
from app.providers.gemini_provider import GeminiProvider
from app.providers.lmstudio_provider import LMStudioProvider
from app.providers.openrouter_provider import OpenRouterProvider


def get_provider(name: ProviderName, settings: Settings) -> BaseProvider:
    match name:
        case ProviderName.LMSTUDIO:
            return LMStudioProvider(settings)
        case ProviderName.OPENROUTER:
            return OpenRouterProvider(settings)
        case ProviderName.GEMINI:
            return GeminiProvider(settings)
        case _:
            raise ValueError(f"Unknown provider: {name}")


def provider_configured(
    name: ProviderName, settings: Settings
) -> tuple[bool, str | None]:
    match name:
        case ProviderName.OPENROUTER:
            ok = bool(settings.openrouter_api_key)
            return ok, None if ok else "OPENROUTER_API_KEY is not set"
        case ProviderName.GEMINI:
            ok = bool(settings.gemini_api_key)
            return ok, None if ok else "GEMINI_API_KEY is not set"
        case _:
            return True, None

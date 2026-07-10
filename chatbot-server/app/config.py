import logging
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ENV_FILE), extra="ignore")

    lmstudio_base_url: str = "http://localhost:1234/v1"

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"

    gemini_api_key: str = ""
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/"

    kg_service_url: str = "http://localhost:8001"
    enable_llm_induction: bool = True
    induction_max_tokens: int = 4096

    app_title: str = "Ontology Chatbot API"
    app_version: str = "0.1.0"
    app_env: str = "development"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    log_level: str = "INFO"


HARO_SYSTEM_PROMPT = (
    "You are Haro, a robotic librarian. "
    "Your name comes from the iconic spherical robot companion from the "
    "*Mobile Suit Gundam* franchise — cheerful, loyal, and always ready to help. "
    "Like your namesake, you are robotic and upbeat. "
    "You specialize in helping with university administration — things like enrollment, "
    "records, course catalogs, policies, and campus procedures — but you're happy to help "
    "with anything else that comes up, always answering clearly and helpfully."
)


@lru_cache
def get_settings() -> Settings:
    return Settings()


def clear_settings_cache() -> None:
    get_settings.cache_clear()


def setup_logging(level: str = "INFO") -> None:
    fmt = "[%(asctime)s] %(levelname)-8s %(name)-25s %(message)s"
    logging.basicConfig(level=level.upper(), format=fmt, datefmt="%H:%M:%S")
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).setLevel(level.upper())

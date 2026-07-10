from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class ProviderName(str, Enum):
    LMSTUDIO = "lmstudio"
    OPENROUTER = "openrouter"
    GEMINI = "gemini"


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(..., max_length=100_000)


class ChatRequest(BaseModel):
    provider: ProviderName
    model: str
    messages: list[ChatMessage]
    stream: bool = False
    use_kg: bool = False
    max_tokens: int | None = Field(default=None, ge=1, le=32_768)
    context_length: int | None = Field(default=None, ge=512, le=131_072)


class ChatResponse(BaseModel):
    content: str
    provider: str
    model: str
    usage: dict[str, int] | None = None


class ModelInfo(BaseModel):
    id: str
    provider: str


class ModelsResponse(BaseModel):
    models: list[ModelInfo]


class ProviderStatus(BaseModel):
    name: str
    configured: bool
    reason: str | None = None


class ProvidersResponse(BaseModel):
    providers: list[ProviderStatus]



class ChatSummary(BaseModel):
    id: str
    title: str
    model: str
    provider: str
    created_at: str
    updated_at: str


class ChatDetail(ChatSummary):
    messages: list[ChatMessage]


class CreateChatRequest(BaseModel):
    title: str = "New Chat"
    model: str
    provider: str


class UpdateChatRequest(BaseModel):
    title: str | None = None
    model: str | None = None
    provider: str | None = None
    messages: list[ChatMessage] | None = None



class ProviderKeyStatus(BaseModel):
    name: str
    key_set: bool
    key_hint: str


class SettingsResponse(BaseModel):
    providers: list[ProviderKeyStatus]


class UpdateSettingsRequest(BaseModel):
    openrouter_api_key: str | None = None
    gemini_api_key: str | None = None


class SystemPromptResponse(BaseModel):
    text: str

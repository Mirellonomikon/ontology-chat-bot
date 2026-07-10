from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from app.models import ChatMessage, ChatResponse


class BaseProvider(ABC):

    @abstractmethod
    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int | None = None,
    ) -> ChatResponse:
        pass

    @abstractmethod
    def stream_chat(
        self,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        pass

    @abstractmethod
    async def list_models(self) -> list[str]:
        pass

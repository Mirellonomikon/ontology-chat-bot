import logging
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from app.config import Settings
from app.exceptions import ProviderError
from app.models import ChatMessage, ChatResponse
from app.providers.base import BaseProvider

logger = logging.getLogger("chatbot.lmstudio")


class LMStudioProvider(BaseProvider):

    def __init__(self, settings: Settings) -> None:
        self._client = AsyncOpenAI(
            api_key="lm-studio",
            base_url=settings.lmstudio_base_url,
        )

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int | None = None,
    ) -> ChatResponse:
        logger.info("LM Studio → model=%s messages=%d", model, len(messages))
        try:
            response = await self._client.chat.completions.create(
                model=model,
                messages=[m.model_dump() for m in messages],
                **({"max_tokens": max_tokens} if max_tokens is not None else {}),
            )
            usage = None
            if response.usage:
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                }
                logger.debug(
                    "LM Studio ← prompt=%d completion=%d total=%d tokens",
                    response.usage.prompt_tokens,
                    response.usage.completion_tokens,
                    response.usage.total_tokens,
                )
            return ChatResponse(
                content=response.choices[0].message.content or "",
                provider="lmstudio",
                model=model,
                usage=usage,
            )
        except Exception as exc:
            logger.error("LM Studio error: %s", exc)
            raise ProviderError(f"LM Studio error: {exc}") from exc

    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        logger.info("LM Studio stream → model=%s messages=%d", model, len(messages))
        try:
            stream = await self._client.chat.completions.create(
                model=model,
                messages=[m.model_dump() for m in messages],
                stream=True,
                **({"max_tokens": max_tokens} if max_tokens is not None else {}),
            )
            async for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
            logger.debug("LM Studio stream complete")
        except Exception as exc:
            logger.error("LM Studio streaming error: %s", exc)
            raise ProviderError(f"LM Studio streaming error: {exc}") from exc

    async def list_models(self) -> list[str]:
        try:
            response = await self._client.models.list()
            return [m.id for m in response.data]
        except Exception as exc:
            raise ProviderError(f"Failed to list LM Studio models: {exc}") from exc

import logging
import re
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from app.config import Settings
from app.exceptions import ProviderError
from app.models import ChatMessage, ChatResponse
from app.providers.base import BaseProvider

logger = logging.getLogger("chatbot.gemini")

_SKIP_KEYWORDS = ("embed", "tts", "image", "robotics", "veo", "lyria")

_THINK_OPEN = "<thought>"
_THINK_CLOSE = "</thought>"


def _strip_thinking(content: str) -> str:
    return re.sub(r"<thought>.*?</thought>", "", content, flags=re.DOTALL).strip()


async def _stream_strip_thinking(raw: AsyncIterator[str]) -> AsyncIterator[str]:
    buffer = ""
    in_thinking = False

    async for token in raw:
        buffer += token

        while True:
            if in_thinking:
                pos = buffer.find(_THINK_CLOSE)
                if pos == -1:
                    keep = len(_THINK_CLOSE) - 1
                    buffer = buffer[-keep:] if len(buffer) > keep else buffer
                    break
                buffer = buffer[pos + len(_THINK_CLOSE):]
                in_thinking = False
            else:
                pos = buffer.find(_THINK_OPEN)
                if pos == -1:
                    keep = 0
                    for i in range(len(_THINK_OPEN) - 1, 0, -1):
                        if buffer.endswith(_THINK_OPEN[:i]):
                            keep = i
                            break
                    safe = buffer[:-keep] if keep else buffer
                    buffer = buffer[-keep:] if keep else ""
                    if safe:
                        yield safe
                    break
                if pos:
                    yield buffer[:pos]
                buffer = buffer[pos + len(_THINK_OPEN):]
                in_thinking = True

    if buffer and not in_thinking:
        yield buffer


class GeminiProvider(BaseProvider):

    def __init__(self, settings: Settings) -> None:
        self._client = AsyncOpenAI(
            api_key=settings.gemini_api_key,
            base_url=settings.gemini_base_url,
        )

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int | None = None,
    ) -> ChatResponse:
        logger.info("Gemini → model=%s messages=%d", model, len(messages))
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
                    "Gemini ← prompt=%d completion=%d total=%d tokens",
                    response.usage.prompt_tokens,
                    response.usage.completion_tokens,
                    response.usage.total_tokens,
                )
            content = _strip_thinking(response.choices[0].message.content or "")
            return ChatResponse(
                content=content,
                provider="gemini",
                model=model,
                usage=usage,
            )
        except Exception as exc:
            logger.error("Gemini error: %s", exc)
            raise ProviderError(f"Gemini error: {exc}") from exc

    async def stream_chat(
        self,
        model: str,
        messages: list[ChatMessage],
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        logger.info("Gemini stream → model=%s messages=%d", model, len(messages))
        try:
            stream = await self._client.chat.completions.create(
                model=model,
                messages=[m.model_dump() for m in messages],
                stream=True,
                **({"max_tokens": max_tokens} if max_tokens is not None else {}),
            )

            async def _raw() -> AsyncIterator[str]:
                async for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content

            async for token in _stream_strip_thinking(_raw()):
                yield token

            logger.debug("Gemini stream complete")
        except Exception as exc:
            logger.error("Gemini streaming error: %s", exc)
            raise ProviderError(f"Gemini streaming error: {exc}") from exc

    async def list_models(self) -> list[str]:
        try:
            response = await self._client.models.list()
            return [
                m.id for m in response.data
                if not any(kw in m.id for kw in _SKIP_KEYWORDS)
            ]
        except Exception as exc:
            raise ProviderError(f"Failed to list Gemini models: {exc}") from exc

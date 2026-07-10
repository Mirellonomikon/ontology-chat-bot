import logging

import numpy as np
from openai import OpenAI

import app.config as cfg

logger = logging.getLogger("kg.embeddings")

_client: OpenAI | None = None
_MAX_BATCH = 256


def is_enabled() -> bool:
    return cfg.ENABLE_EMBEDDING_LINKING


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(
            base_url=cfg.EMBEDDING_BASE_URL,
            api_key=cfg.EMBEDDING_API_KEY or "not-needed",
        )
    return _client


def embed(texts: list[str]) -> np.ndarray | None:
    if not texts:
        return None
    try:
        client = _get_client()
        vectors: list[list[float]] = []
        for i in range(0, len(texts), _MAX_BATCH):
            batch = texts[i : i + _MAX_BATCH]
            resp = client.embeddings.create(model=cfg.EMBEDDING_MODEL, input=batch)
            vectors.extend(d.embedding for d in resp.data)
        arr = np.asarray(vectors, dtype=np.float32)
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return arr / norms
    except Exception as exc:
        logger.warning(
            "Embedding endpoint unavailable (%s) — falling back to exact matching", exc
        )
        return None


def match_values(sources: list[str], targets: list[str], threshold: float) -> dict[str, str]:
    if not sources or not targets:
        return {}
    vectors = embed(sources + targets)
    if vectors is None:
        return {}
    src, tgt = vectors[: len(sources)], vectors[len(sources) :]
    sims = src @ tgt.T
    best_idx = sims.argmax(axis=1)
    best_score = sims.max(axis=1)
    matches: dict[str, str] = {}
    for i, source in enumerate(sources):
        if best_score[i] >= threshold:
            matches[source] = targets[int(best_idx[i])]
    if matches:
        logger.info("Embedding resolver matched %d/%d values", len(matches), len(sources))
    return matches

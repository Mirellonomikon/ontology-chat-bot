import json
import logging
import re
from collections.abc import AsyncGenerator, AsyncIterator

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.exceptions import ProviderError
from app.models import ChatMessage, ChatRequest, ChatResponse
from app.providers import get_provider

router = APIRouter()
logger = logging.getLogger("chatbot.chat")

EX = "http://chatbot.kg/data#"

_SPARQL_GEN_SYSTEM = (
    "You are a SPARQL query generator. "
    "Given a schema description and a user question, produce a valid SPARQL SELECT query. "
    "Return ONLY the raw SPARQL query — no markdown code fences, no explanation."
)




def _extract_sparql(text: str) -> str:
    text = re.sub(r"```(?:sparql|SPARQL)?", "", text, flags=re.IGNORECASE)
    text = text.replace("```", "").strip()
    text = re.sub(r'\b(SELECT|DISTINCT)\s*(?=\?)', r'\1 ', text, flags=re.IGNORECASE)
    return text


async def _get_schema(kg_service_url: str) -> dict:
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{kg_service_url}/schema", timeout=5.0)
            resp.raise_for_status()
            schema = resp.json()
            logger.debug(
                "KG schema: %d records, %d predicates",
                schema.get("record_count", 0),
                len(schema.get("predicates", [])),
            )
            return schema
        except Exception:
            logger.debug("KG schema fetch failed — treating store as empty")
            return {"predicates": [], "datasets": [], "record_count": 0}


async def _run_sparql(kg_service_url: str, query: str) -> list[dict]:
    logger.debug("SPARQL query:\n%s", query)
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{kg_service_url}/sparql",
                json={"query": query},
                timeout=10.0,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("type") == "solutions":
                rows = data.get("results", [])
                logger.debug("SPARQL results: %d rows", len(rows))
                return rows
            logger.debug("SPARQL returned non-solutions type: %s", data.get("type"))
            return []
        except Exception as exc:
            logger.debug("SPARQL execution failed: %s", exc)
            return []


_INTERNAL_PREDS = {f"{EX}type", f"{EX}hasRecord", f"{EX}hasColumn", f"{EX}fileName"}


def _build_sparql_prompt(question: str, schema: dict) -> str:
    predicates = schema.get("predicates", [])
    datasets = schema.get("datasets", [])
    record_count = schema.get("record_count", 0)
    sample_values: dict[str, list[str]] = schema.get("sample_values", {})
    classes: list[dict] = schema.get("classes", [])
    object_properties: list[dict] = schema.get("object_properties", [])

    short_preds = [p.replace(EX, "ex:") for p in predicates]
    short_datasets = [d.replace(EX, "ex:") for d in datasets]

    schema_lines = [
        f"Namespace: ex: = <{EX}>",
        "Standard prefixes: rdf:, rdfs: (use rdf:type and rdfs:label).",
        f"Available datasets: {', '.join(short_datasets) or 'none'}",
        f"Total records in graph: {record_count}",
        "Predicates present in the graph:",
        *[f"  - {p}" for p in short_preds],
        "",
        "Data model:",
        "  Each dataset (ex:Dataset) links to records (ex:Record) via ex:hasRecord.",
        "  Each record's column values are stored as literals under the column predicate.",
        "  Numeric values are typed as xsd:integer or xsd:decimal.",
        "  ex:type is used for the Dataset/Record type assertions.",
    ]

    if classes or object_properties:
        schema_lines += ["", "Semantic layer (use this to JOIN across datasets):"]
        schema_lines.append(
            "  Every record is ALSO a typed individual: it has rdf:type ex:<Class> and"
            " an rdfs:label naming it. Query by type, e.g. '?x rdf:type ex:Course'."
        )
        if classes:
            schema_lines.append("  Entity classes (record types):")
            for c in classes:
                lbl = f" ({c['label']})" if c.get("label") else ""
                sub = f" — subclass of {c['subclass_of']}" if c.get("subclass_of") else ""
                schema_lines.append(f"    - {c['uri']}{lbl}{sub}")
            schema_lines.append(
                "  Subclass types are materialized: an individual of a subclass also has"
                " rdf:type of every superclass, so you may query the superclass directly."
            )
        if object_properties:
            schema_lines.append(
                "  Object properties link records to other records (forward) with a"
                " matching inverse. Follow them instead of matching literals:"
            )
            for p in object_properties:
                dom = p.get("domain") or "?"
                rng = p.get("range") or "?"
                traits = [t for t in ("transitive", "symmetric") if p.get(t)]
                trait_str = f" [{', '.join(traits)}]" if traits else ""
                schema_lines.append(f"    - {p['uri']}: {dom} → {rng}{trait_str}")
        schema_lines += [
            "  These edges make cross-dataset questions a graph traversal, NOT a string"
            " match. Example: '?course ex:taughtBy ?prof . ?prof ex:office_hours_time ?h'.",
            "  Transitive relations are PRE-MATERIALIZED: the full closure is already stored,"
            " so a plain pattern also returns indirect links — e.g. every (direct and indirect)"
            " prerequisite is just '?c ex:prereqOf ?needed' (a '+' property path still works too).",
        ]

    data_samples = [
        (p.replace(EX, "ex:"), vals)
        for p, vals in sample_values.items()
        if p not in _INTERNAL_PREDS and vals
    ]
    if data_samples:
        schema_lines.append("")
        schema_lines.append(
            "Sample values per predicate (shows exact stored format/casing — "
            "not exhaustive, different records may use different casing):"
        )
        for short_p, vals in data_samples:
            schema_lines.append(f"  {short_p} → {', '.join(repr(v) for v in vals)}")

    schema_lines += [
        "",
        f"User question: {question}",
        "",
        "Write a SPARQL SELECT query (declare the prefixes you use:"
        " 'PREFIX ex: <http://chatbot.kg/data#>',"
        " 'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',"
        " 'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>')"
        " that retrieves the data needed to answer this question."
        " Use LIMIT 150 to avoid huge result sets.",
        "",
        "Rules:",
        "- Always include a space after PREFIX (e.g. 'PREFIX ex:' not 'PREFIXex:').",
        "- Always write a space between SELECT and the first variable:"
        " 'SELECT ?var1 ?var2', never 'SELECT?var1'.",
        "- Every variable in triple patterns MUST start with '?'."
        " Never write a bare word like 'record' in subject or object position — always write '?record'.",
        "- Always SELECT every variable used in FILTER or pattern conditions —"
        " especially entity names, codes, and labels — alongside the specific answer variable."
        " Never omit an identifying field from SELECT just because you filtered on it.",
        "- NEVER write a literal directly as a triple object. Always bind the value to a"
        " variable first, then FILTER:"
        " write '?r ex:pred ?val . FILTER(CONTAINS(LCASE(str(?val)), LCASE(\"term\")))'"
        " NOT '?r ex:pred \"term\"'. This is mandatory — stored values may use any casing.",
        "- Only add WHERE conditions for predicates the user explicitly asked about."
        " Do NOT add extra filters (e.g. session_type, category) that the user did not mention —"
        " each extra condition is an AND that can eliminate all matching rows.",
        "- Use OPTIONAL for any secondary fields you retrieve but did not filter on:"
        " 'OPTIONAL { ?r ex:session_type ?type }' so missing properties do not exclude rows.",
    ]

    return "\n".join(schema_lines)


async def _kg_pipeline(
    question: str,
    provider,
    model: str,
    kg_service_url: str,
) -> list[dict]:
    schema = await _get_schema(kg_service_url)
    if not schema.get("record_count"):
        logger.debug("KG store is empty — skipping pipeline")
        return []

    logger.info("KG pipeline: %d records in store, generating SPARQL", schema["record_count"])
    sparql_prompt = _build_sparql_prompt(question, schema)
    sparql_messages = [
        ChatMessage(role="system", content=_SPARQL_GEN_SYSTEM),
        ChatMessage(role="user", content=sparql_prompt),
    ]
    try:
        sparql_resp = await provider.chat(model, sparql_messages)
        sparql_query = _extract_sparql(sparql_resp.content)
    except Exception as exc:
        logger.debug("SPARQL generation failed: %s", exc)
        return []

    results = await _run_sparql(kg_service_url, sparql_query)
    logger.info("KG pipeline complete: %d result rows", len(results))
    return results


def _inject_kg_context(messages: list[ChatMessage], kg_results: list[dict]) -> list[ChatMessage]:
    results_json = json.dumps(kg_results, ensure_ascii=False, indent=2)

    last_user_idx = next(
        (len(messages) - 1 - i for i, m in enumerate(reversed(messages)) if m.role == "user"),
        None,
    )
    if last_user_idx is None:
        return list(messages)

    original = messages[last_user_idx]
    augmented_content = (
        f"{original.content}\n\n"
        "----- Knowledge graph results -----\n"
        "The data below was retrieved from the knowledge graph to answer the question "
        "above. It is the authoritative source of truth: base your answer on it, quote "
        "the specific values it contains, and do not contradict it or substitute a "
        "guess.\n"
        f"{results_json}"
    )

    augmented = list(messages)
    augmented[last_user_idx] = ChatMessage(role=original.role, content=augmented_content)
    return augmented




def _truncate_to_context(
    messages: list[ChatMessage], context_length: int, max_tokens: int
) -> list[ChatMessage]:
    system_msgs = [m for m in messages if m.role == "system"]
    conv_msgs = [m for m in messages if m.role != "system"]
    system_tokens = sum(len(m.content) // 4 for m in system_msgs)
    budget = context_length - max_tokens - system_tokens
    if budget <= 0:
        last_user = next((m for m in reversed(conv_msgs) if m.role == "user"), None)
        logger.debug(
            "Context budget exhausted (budget=%d) — keeping only last user message", budget
        )
        return system_msgs + ([last_user] if last_user else [])
    kept: list[ChatMessage] = []
    tokens_used = 0
    for msg in reversed(conv_msgs):
        cost = len(msg.content) // 4 + 4
        if tokens_used + cost > budget and kept:
            break
        kept.insert(0, msg)
        tokens_used += cost
    logger.debug(
        "Context truncation: %d → %d conversation messages (budget=%d tokens, used=%d)",
        len(conv_msgs), len(kept), budget, tokens_used,
    )
    return system_msgs + kept




async def _stream_generator(token_stream: AsyncIterator[str]) -> AsyncGenerator[str, None]:
    try:
        async for token in token_stream:
            yield json.dumps({"token": token}) + "\n"
        yield json.dumps({"done": True}) + "\n"
    except ProviderError as exc:
        logger.error("Stream error: %s", exc)
        yield json.dumps({"error": str(exc)}) + "\n"
    except Exception:
        logger.exception("Stream unexpected error")
        yield json.dumps({"error": "An unexpected error occurred"}) + "\n"




@router.post("/", response_model=ChatResponse, summary="Send a chat message")
async def chat(
    request: ChatRequest,
    settings: Settings = Depends(get_settings),
):
    logger.info(
        "Chat request: provider=%s model=%s messages=%d use_kg=%s stream=%s",
        request.provider, request.model, len(request.messages), request.use_kg, request.stream,
    )
    provider = get_provider(request.provider, settings)
    messages_to_send = list(request.messages)

    if request.use_kg:
        last_user = next(
            (m.content for m in reversed(request.messages) if m.role == "user"), ""
        )
        if last_user:
            kg_results = await _kg_pipeline(
                last_user, provider, request.model, settings.kg_service_url
            )
            if kg_results:
                logger.info("KG: injecting %d result rows into context", len(kg_results))
                messages_to_send = _inject_kg_context(messages_to_send, kg_results)
            else:
                logger.debug("KG: pipeline returned no results, continuing without injection")

    if request.context_length is not None:
        messages_to_send = _truncate_to_context(
            messages_to_send,
            request.context_length,
            request.max_tokens or 2048,
        )

    if request.stream:
        token_stream = provider.stream_chat(request.model, messages_to_send, request.max_tokens)
        return StreamingResponse(
            _stream_generator(token_stream),
            media_type="application/x-ndjson",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
            },
        )

    return await provider.chat(request.model, messages_to_send, request.max_tokens)

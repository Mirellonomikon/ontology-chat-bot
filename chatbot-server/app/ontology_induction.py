import json
import logging
import re

import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.models import ChatMessage
from app.providers.base import BaseProvider

logger = logging.getLogger("chatbot.induction")

_SAMPLE_ROWS = 20

_SYSTEM_PROMPT = (
    "You are an ontology engineer. Given a tabular dataset's columns and a sample of "
    "its rows, infer a small, sensible ontology. Return ONLY a raw JSON object — no "
    "markdown code fences, no commentary."
)


class ProposedRelation(BaseModel):
    column: str
    name: str
    target_class: str
    inverse_name: str | None = None
    transitive: bool = False
    symmetric: bool = False


class OntologyProposal(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    class_: str = Field(alias="class")
    subclass_of: str | None = None
    identifier_column: str | None = None
    label_column: str | None = None
    relations: list[ProposedRelation] = Field(default_factory=list)


def build_induction_prompt(
    dataset_name: str, df: pd.DataFrame, existing_classes: list[dict]
) -> str:
    columns = "\n".join(f"- {col}: {df[col].dtype}" for col in df.columns)
    sample_json = df.head(_SAMPLE_ROWS).to_json(orient="records")

    if existing_classes:
        existing = "\n".join(
            f"- {c.get('label') or c.get('uri')}" for c in existing_classes if c
        )
    else:
        existing = "none"

    return (
        f"Dataset name: {dataset_name}\n\n"
        f"Columns (name: dtype):\n{columns}\n\n"
        f"Sample rows (JSON):\n{sample_json}\n\n"
        f"Existing classes already in the knowledge graph (you may reference these as "
        f"relation targets or as a superclass):\n{existing}\n\n"
        "Respond with ONLY a JSON object of this exact shape:\n"
        "{\n"
        '  "class": "<PascalCase singular class name for one record>",\n'
        '  "subclass_of": "<an existing class this is a kind of, or null>",\n'
        '  "identifier_column": "<column that uniquely identifies a record, or null>",\n'
        '  "label_column": "<most human-readable naming column, or null>",\n'
        '  "relations": [\n'
        "    {\n"
        '      "column": "<a column whose values reference OTHER entities>",\n'
        '      "name": "<verb-like forward relation, e.g. taughtBy, prerequisiteOf>",\n'
        '      "target_class": "<this class (self-reference) or one of the existing classes>",\n'
        '      "inverse_name": "<reverse relation name, e.g. teaches>",\n'
        '      "transitive": false,\n'
        '      "symmetric": false\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- Only add a relation for columns that REFERENCE other entities (foreign keys / "
        "cross-references), never for plain attributes (numbers, dates, free text, categories).\n"
        "- target_class MUST be either this dataset's own class name or one of the existing "
        "classes listed above; if a column references nothing represented by a class, omit it.\n"
        "- Set \"transitive\": true only for self-referential hierarchical chains "
        "(prerequisites, parent, manager); \"symmetric\": true only for mutual relations "
        "(sibling, spouse).\n"
        "- Use camelCase relation names and a singular PascalCase class name. Prefer fewer "
        "relations when unsure; return an empty \"relations\" array if none apply."
    )


def parse_proposal(text: str) -> OntologyProposal | None:
    cleaned = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).replace("```", "").strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        logger.debug("Induction: no JSON object found in model output")
        return None
    try:
        data = json.loads(cleaned[start : end + 1])
        return OntologyProposal.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.debug("Induction: proposal did not validate (%s)", exc)
        return None


async def induce_ontology(
    provider: BaseProvider,
    model: str,
    df: pd.DataFrame,
    dataset_name: str,
    existing_classes: list[dict],
    max_tokens: int = 1024,
) -> dict | None:
    prompt = build_induction_prompt(dataset_name, df, existing_classes)
    messages = [
        ChatMessage(role="system", content=_SYSTEM_PROMPT),
        ChatMessage(role="user", content=prompt),
    ]
    try:
        resp = await provider.chat(model, messages, max_tokens=max_tokens)
    except Exception as exc:
        logger.warning("Ontology induction request failed (%s)", exc)
        return None

    proposal = parse_proposal(resp.content)
    if proposal is None:
        return None
    logger.info(
        "Induced ontology for '%s': class=%s, %d relation(s)",
        dataset_name, proposal.class_, len(proposal.relations),
    )
    return proposal.model_dump(by_alias=True)

from pydantic import BaseModel


class Triple(BaseModel):
    subject: str
    predicate: str
    object: str
    object_is_literal: bool = True
    datatype: str | None = None


class TriplesRequest(BaseModel):
    triples: list[Triple]


class SparqlRequest(BaseModel):
    query: str

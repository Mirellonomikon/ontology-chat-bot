import logging

import pyoxigraph

import app.config as cfg
from app.config import EX, RDF, RDFS

logger = logging.getLogger("kg.rules")

_PREFIXES = (
    f"PREFIX ex: <{EX}>\n"
    f"PREFIX rdf: <{RDF}>\n"
    f"PREFIX rdfs: <{RDFS}>\n"
)
_MAX_ITERS = 20


def _update(store: pyoxigraph.Store, body: str) -> None:
    store.update(_PREFIXES + body)


def _props_with(store: pyoxigraph.Store, characteristic: str) -> list[str]:
    res = store.query(
        _PREFIXES
        + f"SELECT ?p WHERE {{ ?p <{cfg.RULE_CHARACTERISTIC}> <{characteristic}> }}"
    )
    out: list[str] = []
    if isinstance(res, pyoxigraph.QuerySolutions):
        var = res.variables[0]
        for sol in res:
            term = sol[var]
            if term is not None:
                out.append(term.value)
    return out


def _close_symmetric(store: pyoxigraph.Store) -> None:
    for p in _props_with(store, cfg.SYMMETRIC):
        _update(
            store,
            f"INSERT {{ ?b <{p}> ?a }} WHERE {{ ?a <{p}> ?b ."
            f" FILTER NOT EXISTS {{ ?b <{p}> ?a }} }}",
        )


def _close_transitive(store: pyoxigraph.Store) -> None:
    for p in _props_with(store, cfg.TRANSITIVE):
        for _ in range(_MAX_ITERS):
            before = len(store)
            _update(
                store,
                f"INSERT {{ ?a <{p}> ?c }} WHERE {{ ?a <{p}> ?b . ?b <{p}> ?c ."
                f" FILTER(?a != ?c) . FILTER NOT EXISTS {{ ?a <{p}> ?c }} }}",
            )
            if len(store) == before:
                break


def materialize(store: pyoxigraph.Store) -> dict:
    if not cfg.ENABLE_RULE_MATERIALIZATION:
        return {"enabled": False, "materialized": 0}

    before = len(store)

    _update(
        store,
        "INSERT { ?x rdf:type ?super } WHERE {"
        " ?x rdf:type ?sub . ?sub rdfs:subClassOf+ ?super ."
        " FILTER NOT EXISTS { ?x rdf:type ?super } }",
    )

    _update(
        store,
        "INSERT { ?y rdf:type ?C } WHERE {"
        " ?p rdfs:range ?C . ?x ?p ?y . FILTER(isIRI(?y)) ."
        " FILTER NOT EXISTS { ?y rdf:type ?C } }",
    )
    _update(
        store,
        "INSERT { ?x rdf:type ?C } WHERE {"
        " ?p rdfs:domain ?C . ?x ?p ?y ."
        " FILTER NOT EXISTS { ?x rdf:type ?C } }",
    )

    _close_symmetric(store)
    _close_transitive(store)

    added = len(store) - before
    logger.info("Rule materialization added %d triples (store size now %d)", added, len(store))
    return {"enabled": True, "materialized": added}

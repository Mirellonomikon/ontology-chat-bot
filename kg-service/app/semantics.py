import logging
import re

import pandas as pd
import pyoxigraph

import app.config as cfg
from app import embeddings
from app.config import EX, RDF, RDFS, XSD, sanitize
from app.models import Triple
from app.routers.rdf import build_quad

logger = logging.getLogger("kg.semantics")

CONTAINMENT_MIN = 0.5
MIN_SHARED = 3
MIN_CARDINALITY = 3
PK_RATIO = 0.9

_RDF_TYPE = f"{RDF}type"
_RDFS_CLASS = f"{RDFS}Class"
_RDFS_PROPERTY = f"{RDF}Property"
_RDFS_LABEL = f"{RDFS}label"
_RDFS_DOMAIN = f"{RDFS}domain"
_RDFS_RANGE = f"{RDFS}range"
_RDFS_SUBCLASSOF = f"{RDFS}subClassOf"
_IDENTIFIER_PROP = cfg.IDENTIFIER_PROP

_KEY_NAME_HINTS = ("id", "code", "key", "name", "title", "label")
_TOKEN_SPLIT = re.compile(r"[,;\s]+")




def _add_iri(store: pyoxigraph.Store, s: str, p: str, o: str) -> None:
    store.add(build_quad(Triple(subject=s, predicate=p, object=o, object_is_literal=False)))


def _add_label(store: pyoxigraph.Store, s: str, text: str) -> None:
    store.add(build_quad(Triple(subject=s, predicate=_RDFS_LABEL, object=text)))


def _select(store: pyoxigraph.Store, query: str) -> list[dict]:
    results = store.query(query)
    if not isinstance(results, pyoxigraph.QuerySolutions):
        return []
    vars_ = results.variables
    rows = []
    for sol in results:
        row = {}
        for v in vars_:
            term = sol[v]
            row[v.value] = term.value if term is not None else None
        rows.append(row)
    return rows




def _pascal_case(name: str) -> str:
    parts = [p for p in re.split(r"[^a-zA-Z0-9]+", str(name)) if p]
    return "".join(p[:1].upper() + p[1:] for p in parts) or "Thing"


def _humanize(name: str) -> str:
    parts = [p for p in re.split(r"[^a-zA-Z0-9]+", str(name)) if p]
    return " ".join(p[:1].upper() + p[1:] for p in parts) or "Thing"


def _class_uri(dataset_name: str) -> tuple[str, str]:
    return f"{EX}{_pascal_case(dataset_name)}", _humanize(dataset_name)


def _tokenize(value: str) -> set[str]:
    return {t.strip() for t in _TOKEN_SPLIT.split(value) if t.strip()}




def bootstrap_schema(store: pyoxigraph.Store) -> None:
    for cls, label in ((f"{EX}Dataset", "Dataset"), (f"{EX}Record", "Record")):
        _add_iri(store, cls, _RDF_TYPE, _RDFS_CLASS)
        _add_label(store, cls, label)




def _string_columns(df: pd.DataFrame) -> list[str]:
    cols = []
    for col in df.columns:
        s = df[col]
        if pd.api.types.is_numeric_dtype(s) or pd.api.types.is_bool_dtype(s):
            continue
        if pd.api.types.is_datetime64_any_dtype(s):
            continue
        cols.append(col)
    return cols


def _choose_key_column(df: pd.DataFrame, string_cols: list[str]) -> tuple[str | None, float]:
    n = len(df)
    best: str | None = None
    best_score = -1.0
    best_ratio = 0.0
    for col in string_cols:
        distinct = df[col].dropna().nunique()
        ratio = distinct / n if n else 0.0
        name = str(col).lower()
        bonus = 0.5 if any(h in name for h in _KEY_NAME_HINTS) else 0.0
        score = ratio + bonus
        if score > best_score:
            best, best_score, best_ratio = col, score, ratio
    return best, best_ratio




def _build_pk_index(store: pyoxigraph.Store) -> dict[str, dict[str, list[str]]]:
    rows = _select(
        store,
        f"SELECT ?cls ?r ?label WHERE {{"
        f"  ?cls <{_IDENTIFIER_PROP}> ?kp ."
        f"  ?r <{_RDF_TYPE}> ?cls ."
        f"  ?r <{_RDFS_LABEL}> ?label ."
        f"}}",
    )
    index: dict[str, dict[str, list[str]]] = {}
    for row in rows:
        cls, r, label = row.get("cls"), row.get("r"), row.get("label")
        if cls and r and label:
            index.setdefault(cls, {}).setdefault(label, []).append(r)
    return index




def _read_rec_props(store: pyoxigraph.Store, ds_uri: str) -> dict[str, dict[str, str]]:
    rows = _select(
        store,
        f"SELECT ?r ?p ?o WHERE {{"
        f"  <{ds_uri}> <{EX}hasRecord> ?r . ?r ?p ?o . FILTER(isLiteral(?o))"
        f"}}",
    )
    rec_props: dict[str, dict[str, str]] = {}
    for row in rows:
        r, p, o = row.get("r"), row.get("p"), row.get("o")
        if r and p and o is not None:
            rec_props.setdefault(r, {})[p] = o
    return rec_props


def enrich_dataset(
    store: pyoxigraph.Store,
    df: pd.DataFrame,
    dataset_name: str,
    ds_uri: str,
    proposal: dict | None = None,
) -> dict:
    rec_props = _read_rec_props(store, ds_uri)

    if proposal:
        try:
            return _apply_proposal(store, df, dataset_name, ds_uri, proposal, rec_props)
        except Exception as exc:
            logger.warning(
                "LLM proposal enrichment for '%s' failed (%s) — using heuristics",
                dataset_name, exc,
            )

    return _enrich_heuristic(store, df, dataset_name, ds_uri, rec_props)




def _existing_link_pairs(store: pyoxigraph.Store) -> set[tuple[str, str]]:
    rows = _select(
        store, f"SELECT ?d ?r WHERE {{ ?p <{_RDFS_DOMAIN}> ?d . ?p <{_RDFS_RANGE}> ?r }}"
    )
    return {(row["d"], row["r"]) for row in rows if row.get("d") and row.get("r")}


def _dataset_leaf_classes(store: pyoxigraph.Store) -> dict[str, str]:
    rows = _select(
        store,
        f"SELECT DISTINCT ?ds ?cls WHERE {{"
        f"  ?ds <{EX}hasRecord> ?r . ?r <{_RDF_TYPE}> ?cls . ?cls <{_RDF_TYPE}> <{_RDFS_CLASS}> ."
        f"  FILTER(?cls != <{EX}Record> && ?cls != <{EX}Dataset>)"
        f"}}",
    )
    sc_rows = _select(store, f"SELECT ?sub ?sup WHERE {{ ?sub <{_RDFS_SUBCLASSOF}> ?sup }}")
    subs_of: dict[str, set[str]] = {}
    for row in sc_rows:
        sub, sup = row.get("sub"), row.get("sup")
        if sub and sup:
            subs_of.setdefault(sup, set()).add(sub)

    ds_classes: dict[str, set[str]] = {}
    for row in rows:
        ds, cls = row.get("ds"), row.get("cls")
        if ds and cls:
            ds_classes.setdefault(ds, set()).add(cls)

    leaf: dict[str, str] = {}
    for ds, classes in ds_classes.items():
        leaves = [c for c in classes if not (subs_of.get(c, set()) & classes)]
        if leaves:
            leaf[ds] = min(leaves)
    return leaf


def _string_rec_props(store: pyoxigraph.Store, ds_uri: str) -> dict[str, dict[str, str]]:
    rows = _select(
        store,
        f"SELECT ?r ?p ?o WHERE {{"
        f"  <{ds_uri}> <{EX}hasRecord> ?r . ?r ?p ?o ."
        f"  FILTER(isLiteral(?o) && datatype(?o) = <{XSD}string>)"
        f"}}",
    )
    rec_props: dict[str, dict[str, str]] = {}
    for row in rows:
        r, p, o = row.get("r"), row.get("p"), row.get("o")
        if r and p and o is not None and p != _RDFS_LABEL:
            rec_props.setdefault(r, {})[p] = o
    return rec_props


def _column_local_names(rec_props: dict[str, dict[str, str]]) -> list[str]:
    preds: set[str] = set()
    for props in rec_props.values():
        preds.update(props)
    return [p[len(EX):] for p in preds if p.startswith(EX)]


def relink_datasets(store: pyoxigraph.Store) -> dict:
    pk_index = _build_pk_index(store)
    if not pk_index:
        return {"datasets_scanned": 0, "links_added": 0}

    skip_pairs = _existing_link_pairs(store)
    scanned = 0
    total = 0
    for ds_uri, cls_uri in _dataset_leaf_classes(store).items():
        rec_props = _string_rec_props(store, ds_uri)
        if not rec_props:
            continue
        cols = _column_local_names(rec_props)
        added, _ = _link_columns(store, cls_uri, rec_props, cols, pk_index, skip_pairs)
        scanned += 1
        total += added

    if total:
        logger.info(
            "Re-link pass: added %d cross-dataset edge(s) across %d dataset(s)", total, scanned
        )
    return {"datasets_scanned": scanned, "links_added": total}


def _enrich_heuristic(
    store: pyoxigraph.Store,
    df: pd.DataFrame,
    dataset_name: str,
    ds_uri: str,
    rec_props: dict[str, dict[str, str]],
) -> dict:
    cls_uri, cls_label = _class_uri(dataset_name)
    _add_iri(store, cls_uri, _RDF_TYPE, _RDFS_CLASS)
    _add_label(store, cls_uri, cls_label)

    string_cols = _string_columns(df)
    key_col, key_ratio = _choose_key_column(df, string_cols)
    key_pred = f"{EX}{sanitize(str(key_col))}" if key_col else None

    for rec, props in rec_props.items():
        _add_iri(store, rec, _RDF_TYPE, cls_uri)
        if key_pred and key_pred in props:
            _add_label(store, rec, props[key_pred])

    distinct_keys = df[key_col].dropna().nunique() if key_col else 0
    if key_pred and key_ratio >= PK_RATIO and distinct_keys >= MIN_SHARED:
        _add_iri(store, cls_uri, _IDENTIFIER_PROP, key_pred)

    pk_index = _build_pk_index(store)
    links_added, properties = _link_columns(store, cls_uri, rec_props, string_cols, pk_index)

    summary = {
        "method": "heuristic",
        "class": cls_label,
        "class_uri": cls_uri,
        "subclass_of": None,
        "entities_typed": len(rec_props),
        "links_added": links_added,
        "properties": properties,
    }
    logger.info(
        "Semantic enrichment (heuristic) for '%s': class=%s, %d records typed, %d links via %s",
        dataset_name, cls_label, len(rec_props), links_added, properties or "—",
    )
    return summary


def _best_target_class(
    col_values: set[str], pk_index: dict[str, dict[str, list[str]]]
) -> str | None:
    best_cls: str | None = None
    best_containment = 0.0
    for cls, key_map in pk_index.items():
        keys = key_map.keys()
        shared = sum(
            1 for v in col_values if v in keys or (_tokenize(v) & key_map.keys())
        )
        if shared < MIN_SHARED:
            continue
        containment = shared / len(col_values)
        if containment > best_containment:
            best_cls, best_containment = cls, containment
    return best_cls if best_containment >= CONTAINMENT_MIN else None


def _link_column(
    store: pyoxigraph.Store,
    col: str,
    col_pred: str,
    cls_uri: str,
    target_cls: str,
    rec_props: dict[str, dict[str, str]],
    key_map: dict[str, list[str]],
) -> int:
    local = sanitize(str(col))
    fwd = f"{EX}{local}_ref"
    inv = f"{EX}{local}_of"
    added = 0
    pending: list[tuple[str, str]] = []

    for rec, props in rec_props.items():
        value = props.get(col_pred)
        if not value:
            continue
        targets = [value] if value in key_map else [t for t in _tokenize(value) if t in key_map]
        for tok in targets:
            for trec in key_map.get(tok, []):
                if trec != rec:
                    pending.append((rec, trec))

    if not pending:
        return 0

    _add_iri(store, fwd, _RDF_TYPE, _RDFS_PROPERTY)
    _add_iri(store, fwd, _RDFS_DOMAIN, cls_uri)
    _add_iri(store, fwd, _RDFS_RANGE, target_cls)
    _add_label(store, fwd, str(col))
    _add_iri(store, inv, _RDF_TYPE, _RDFS_PROPERTY)
    _add_iri(store, inv, _RDFS_DOMAIN, target_cls)
    _add_iri(store, inv, _RDFS_RANGE, cls_uri)
    _add_label(store, inv, f"{col} of")
    _add_iri(store, inv, cfg.RULE_CHARACTERISTIC, cfg.INVERSE)

    for src, dst in pending:
        _add_iri(store, src, fwd, dst)
        _add_iri(store, dst, inv, src)
        added += 2

    return added


def _link_columns(
    store: pyoxigraph.Store,
    cls_uri: str,
    rec_props: dict[str, dict[str, str]],
    string_cols: list[str],
    pk_index: dict[str, dict[str, list[str]]],
    skip_pairs: set[tuple[str, str]] | None = None,
) -> tuple[int, list[str]]:
    links_added = 0
    properties: list[str] = []
    for col in string_cols:
        col_pred = f"{EX}{sanitize(str(col))}"
        col_values = {
            props[col_pred] for props in rec_props.values() if props.get(col_pred)
        }
        if len(col_values) < MIN_CARDINALITY:
            continue

        target_cls = _best_target_class(col_values, pk_index)
        if not target_cls:
            continue
        if skip_pairs is not None and (cls_uri, target_cls) in skip_pairs:
            continue

        added = _link_column(
            store, col, col_pred, cls_uri, target_cls, rec_props, pk_index[target_cls]
        )
        if added:
            links_added += added
            properties.append(f"ex:{sanitize(str(col))}_ref")
    return links_added, properties




def _declare_property(
    store: pyoxigraph.Store, prop_uri: str, domain: str | None, rng: str | None, label: str
) -> None:
    _add_iri(store, prop_uri, _RDF_TYPE, _RDFS_PROPERTY)
    if domain:
        _add_iri(store, prop_uri, _RDFS_DOMAIN, domain)
    if rng:
        _add_iri(store, prop_uri, _RDFS_RANGE, rng)
    if label:
        _add_label(store, prop_uri, label)


def _class_label_index(store: pyoxigraph.Store, cls_uri: str) -> dict[str, list[str]]:
    rows = _select(
        store,
        f"SELECT ?r ?label WHERE {{ ?r <{_RDF_TYPE}> <{cls_uri}> . ?r <{_RDFS_LABEL}> ?label }}",
    )
    index: dict[str, list[str]] = {}
    for row in rows:
        r, label = row.get("r"), row.get("label")
        if r and label:
            index.setdefault(label, []).append(r)
    return index


def _link_relation(
    store: pyoxigraph.Store,
    col_pred: str,
    target_cls: str,
    fwd: str,
    inv: str,
    rec_props: dict[str, dict[str, str]],
) -> int:
    target_index = _class_label_index(store, target_cls)
    if not target_index:
        logger.warning(
            "Relation %s -> %s has no labelled individuals of %s yet — 0 links added "
            "(target dataset not ingested, or its class name doesn't match)",
            col_pred, target_cls, target_cls,
        )
        return 0

    rec_tokens: dict[str, list[str]] = {}
    unresolved: set[str] = set()
    for rec, props in rec_props.items():
        value = props.get(col_pred)
        if not value:
            continue
        if value in target_index:
            rec_tokens[rec] = [value]
            continue
        token_hits = [t for t in _tokenize(value) if t in target_index]
        if token_hits:
            rec_tokens[rec] = token_hits
            continue
        rec_tokens[rec] = [value]
        unresolved.add(value)

    resolved: dict[str, str] = {}
    if unresolved and embeddings.is_enabled():
        resolved = embeddings.match_values(
            sorted(unresolved), list(target_index.keys()), cfg.EMBED_MATCH_THRESHOLD
        )

    pending: list[tuple[str, str]] = []
    for rec, tokens in rec_tokens.items():
        for tok in tokens:
            label = tok if tok in target_index else resolved.get(tok)
            if not label:
                continue
            for trec in target_index.get(label, []):
                if trec != rec:
                    pending.append((rec, trec))

    if not pending:
        return 0

    added = 0
    for src, dst in pending:
        _add_iri(store, src, fwd, dst)
        _add_iri(store, dst, inv, src)
        added += 2
    return added


def _apply_proposal(
    store: pyoxigraph.Store,
    df: pd.DataFrame,
    dataset_name: str,
    ds_uri: str,
    proposal: dict,
    rec_props: dict[str, dict[str, str]],
) -> dict:
    cls_name = str(proposal.get("class") or dataset_name)
    cls_uri = f"{EX}{_pascal_case(cls_name)}"
    _add_iri(store, cls_uri, _RDF_TYPE, _RDFS_CLASS)
    _add_label(store, cls_uri, cls_name)

    super_name = proposal.get("subclass_of")
    super_short = None
    super_pascal = _pascal_case(str(super_name)) if super_name else ""
    if super_name and super_pascal not in ("Record", "Dataset", _pascal_case(cls_name)):
        super_uri = f"{EX}{super_pascal}"
        _add_iri(store, super_uri, _RDF_TYPE, _RDFS_CLASS)
        _add_label(store, super_uri, str(super_name))
        _add_iri(store, cls_uri, _RDFS_SUBCLASSOF, super_uri)
        super_short = f"ex:{super_pascal}"

    label_col = proposal.get("label_column")
    id_col = proposal.get("identifier_column") or label_col
    label_pred = f"{EX}{sanitize(str(label_col))}" if label_col else None
    id_pred = f"{EX}{sanitize(str(id_col))}" if id_col else None

    for rec, props in rec_props.items():
        _add_iri(store, rec, _RDF_TYPE, cls_uri)
        if label_pred and props.get(label_pred):
            _add_label(store, rec, props[label_pred])
        elif id_pred and props.get(id_pred):
            _add_label(store, rec, props[id_pred])

    if id_col is not None and id_col in df.columns:
        n = len(df)
        distinct = df[id_col].dropna().nunique()
        ratio = distinct / n if n else 0.0
        if id_pred and ratio >= PK_RATIO and distinct >= MIN_SHARED:
            _add_iri(store, cls_uri, _IDENTIFIER_PROP, id_pred)

    links_added = 0
    properties: list[str] = []
    for rel in proposal.get("relations") or []:
        col = rel.get("column")
        name = rel.get("name")
        target = rel.get("target_class")
        if not (col and name and target):
            continue
        col_pred = f"{EX}{sanitize(str(col))}"
        fwd_local = sanitize(str(name))
        inv_local = sanitize(str(rel.get("inverse_name") or f"{name}_of"))
        fwd = f"{EX}{fwd_local}"
        inv = f"{EX}{inv_local}"
        target_uri = f"{EX}{_pascal_case(str(target))}"

        _declare_property(store, fwd, cls_uri, target_uri, str(name))
        _declare_property(store, inv, target_uri, cls_uri, str(rel.get("inverse_name") or f"{name} of"))
        _add_iri(store, inv, cfg.RULE_CHARACTERISTIC, cfg.INVERSE)
        if rel.get("transitive"):
            _add_iri(store, fwd, cfg.RULE_CHARACTERISTIC, cfg.TRANSITIVE)
        if rel.get("symmetric"):
            _add_iri(store, fwd, cfg.RULE_CHARACTERISTIC, cfg.SYMMETRIC)

        added = _link_relation(store, col_pred, target_uri, fwd, inv, rec_props)
        if added:
            links_added += added
        properties.append(f"ex:{fwd_local}")

    summary = {
        "method": "llm",
        "class": cls_name,
        "class_uri": cls_uri,
        "subclass_of": super_short,
        "entities_typed": len(rec_props),
        "links_added": links_added,
        "properties": properties,
    }
    logger.info(
        "Semantic enrichment (LLM) for '%s': class=%s%s, %d records typed, %d links via %s",
        dataset_name, cls_name,
        f" ⊂ {super_short}" if super_short else "",
        len(rec_props), links_added, properties or "—",
    )
    return summary

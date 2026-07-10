import io
import logging
import zipfile
from typing import Any

import pyoxigraph
from fastapi import APIRouter, HTTPException, Response

import app.config as cfg
from app.config import EX, RDF, RDFS, XSD, sanitize
from app.models import SparqlRequest, Triple, TriplesRequest

router = APIRouter()
logger = logging.getLogger("kg.rdf")

_SPARQL_PREFIXES = (
    f"PREFIX ex: <{EX}>\n"
    f"PREFIX xsd: <{XSD}>\n"
    f"PREFIX rdf: <{RDF}>\n"
    f"PREFIX rdfs: <{RDFS}>\n"
)




def _node_value(node: Any) -> str:
    if node is None:
        return ""
    if isinstance(node, (pyoxigraph.NamedNode, pyoxigraph.Literal, pyoxigraph.BlankNode)):
        return node.value
    return str(node)


def _ds_name(uri: str) -> str:
    return uri[len(EX):] if uri.startswith(EX) else uri


def build_quad(t: Triple) -> pyoxigraph.Quad:
    subj = pyoxigraph.NamedNode(t.subject)
    pred = pyoxigraph.NamedNode(t.predicate)
    if t.object_is_literal:
        obj = (
            pyoxigraph.Literal(t.object, datatype=pyoxigraph.NamedNode(t.datatype))
            if t.datatype
            else pyoxigraph.Literal(t.object)
        )
    else:
        obj = pyoxigraph.NamedNode(t.object)
    return pyoxigraph.Quad(subj, pred, obj)


def _solutions_to_rows(results: "pyoxigraph.QuerySolutions") -> list[dict]:
    vars_ = results.variables
    return [
        {v.value: (_node_value(sol[v]) if sol[v] is not None else None) for v in vars_}
        for sol in results
    ]


def _run_select(query: str) -> list[dict]:
    results = cfg.store.query(query)
    if not isinstance(results, pyoxigraph.QuerySolutions):
        return []
    return _solutions_to_rows(results)


def _serialize_dataset_ttl(ds_uri: str, dataset_name: str) -> tuple[bytes, int]:
    data_construct = (
        f"{_SPARQL_PREFIXES}"
        "CONSTRUCT { ?s ?p ?o }\n"
        "WHERE {\n"
        f"  {{ BIND(<{ds_uri}> AS ?s) . ?s ?p ?o }}\n"
        "  UNION\n"
        f"  {{ <{ds_uri}> ex:hasRecord ?s . ?s ?p ?o }}\n"
        "}"
    )
    entity_construct = (
        f"{_SPARQL_PREFIXES}"
        "CONSTRUCT { ?o ?ep ?ev }\n"
        "WHERE {\n"
        f"  <{ds_uri}> ex:hasRecord ?r . ?r ?p ?o . FILTER(isIRI(?o)) .\n"
        "  ?o ?ep ?ev . FILTER(?ep IN (rdf:type, rdfs:label))\n"
        "}"
    )
    schema_construct = (
        f"{_SPARQL_PREFIXES}"
        "CONSTRUCT { ?t ?tp ?tv }\n"
        "WHERE {\n"
        "  ?t rdf:type ?meta . FILTER(?meta IN (rdfs:Class, rdf:Property)) . ?t ?tp ?tv\n"
        "}"
    )

    merged: dict[str, "pyoxigraph.Triple"] = {}
    try:
        for construct in (data_construct, entity_construct, schema_construct):
            for t in cfg.store.query(construct):
                merged[str(t)] = t
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"SPARQL CONSTRUCT error: {exc}")

    triples = list(merged.values())
    buf = io.BytesIO()
    pyoxigraph.serialize(
        triples, buf, "text/turtle",
        prefixes={"ex": EX, "xsd": XSD, "rdf": RDF, "rdfs": RDFS},
    )
    logger.info("Serialized %d triples for '%s'", len(triples), dataset_name)
    return buf.getvalue(), len(triples)




@router.post("/triples", tags=["triples"])
def add_triples(req: TriplesRequest) -> dict:
    added = 0
    for t in req.triples:
        try:
            cfg.store.add(build_quad(t))
            added += 1
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid triple: {exc}")
    return {"stored": added, "total": len(cfg.store)}


@router.delete("/triples", tags=["triples"])
def clear_store() -> dict:
    logger.debug("Clearing entire RDF store")
    cfg.store.clear()
    return {"cleared": True}


def _prune_orphaned_schema() -> None:
    prune = (
        f"{_SPARQL_PREFIXES}"
        f"DELETE {{ ?c ?cp ?cv }} WHERE {{"
        f"  ?c rdf:type rdfs:Class ."
        f"  FILTER (?c NOT IN (ex:Dataset, ex:Record)) ."
        f"  FILTER NOT EXISTS {{ ?r rdf:type ?c }} ."
        f"  ?c ?cp ?cv"
        f"}} ;\n"
        f"DELETE {{ ?p ?pp ?pv }} WHERE {{"
        f"  ?p rdf:type rdf:Property . FILTER NOT EXISTS {{ ?s ?p ?o }} ."
        f"  ?p ?pp ?pv"
        f"}}"
    )
    cfg.store.update(prune)


@router.delete("/datasets/{dataset_name}", tags=["datasets"])
def delete_dataset(dataset_name: str) -> dict:
    ds_uri = f"{EX}{dataset_name}"
    update = (
        f"{_SPARQL_PREFIXES}"
        f"DELETE {{ ?r ?p ?o }} WHERE {{ <{ds_uri}> ex:hasRecord ?r . ?r ?p ?o . }} ;\n"
        f"DELETE {{ <{ds_uri}> ?p ?o }} WHERE {{ <{ds_uri}> ?p ?o . }}"
    )
    try:
        cfg.store.update(update)
        _prune_orphaned_schema()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"SPARQL update error: {exc}")
    logger.info("Deleted dataset '%s'", dataset_name)
    return {"deleted": dataset_name}




@router.post("/sparql", tags=["sparql"])
def run_sparql(req: SparqlRequest) -> dict:
    logger.debug("SPARQL query received:\n%s", req.query)
    try:
        results = cfg.store.query(req.query)
    except Exception as exc:
        logger.debug("SPARQL execution error: %s", exc)
        raise HTTPException(status_code=400, detail=f"SPARQL error: {exc}")

    if isinstance(results, pyoxigraph.QuerySolutions):
        var_names = [v.value for v in results.variables]
        rows = _solutions_to_rows(results)
        logger.debug("SPARQL solutions: %d rows", len(rows))
        return {"type": "solutions", "variables": var_names, "results": rows}

    if isinstance(results, bool):
        return {"type": "ask", "results": results}

    triples_out = [
        {
            "subject": _node_value(t.subject),
            "predicate": _node_value(t.predicate),
            "object": _node_value(t.object),
        }
        for t in results
    ]
    logger.debug("SPARQL triples: %d", len(triples_out))
    return {"type": "triples", "results": triples_out}


@router.get("/schema", tags=["schema"])
def get_schema() -> dict:
    try:
        pred_rows = _run_select("SELECT DISTINCT ?p WHERE { ?s ?p ?o } ORDER BY ?p")
        predicates = [r["p"] for r in pred_rows if r.get("p")]

        ds_rows = _run_select(f"SELECT ?d WHERE {{ ?d <{EX}type> <{EX}Dataset> }}")
        datasets = [r["d"] for r in ds_rows if r.get("d")]

        count_rows = _run_select(
            f"SELECT (COUNT(?r) AS ?count) WHERE {{ ?r <{EX}type> <{EX}Record> }}"
        )
        record_count = int(count_rows[0]["count"]) if count_rows and count_rows[0].get("count") else 0

        sample_rows = _run_select(
            "SELECT ?p ?v WHERE { ?s ?p ?v . FILTER(isLiteral(?v)) } LIMIT 500"
        )
        samples: dict[str, list[str]] = {}
        for row in sample_rows:
            p, v = row.get("p"), row.get("v")
            if p and v:
                bucket = samples.setdefault(p, [])
                if len(bucket) < 5 and v not in bucket:
                    bucket.append(v)

        class_rows = _run_select(
            f"SELECT ?c ?l ?sc WHERE {{ ?c <{RDF}type> <{RDFS}Class> ."
            f" OPTIONAL {{ ?c <{RDFS}label> ?l }}"
            f" OPTIONAL {{ ?c <{RDFS}subClassOf> ?sc }} }} ORDER BY ?c"
        )
        classes = [
            {
                "uri": r["c"].replace(EX, "ex:"),
                "label": r.get("l"),
                "subclass_of": (r.get("sc") or "").replace(EX, "ex:") or None,
            }
            for r in class_rows if r.get("c")
        ]

        prop_rows = _run_select(
            f"SELECT ?p ?d ?r ?l ?ch WHERE {{ ?p <{RDF}type> <{RDF}Property> ."
            f" OPTIONAL {{ ?p <{RDFS}domain> ?d }}"
            f" OPTIONAL {{ ?p <{RDFS}range> ?r }}"
            f" OPTIONAL {{ ?p <{RDFS}label> ?l }}"
            f" OPTIONAL {{ ?p <{cfg.RULE_CHARACTERISTIC}> ?ch }} }} ORDER BY ?p"
        )
        props_map: dict[str, dict] = {}
        for r in prop_rows:
            uri = r.get("p")
            if not uri:
                continue
            short = uri.replace(EX, "ex:")
            entry = props_map.setdefault(
                short,
                {
                    "uri": short,
                    "domain": (r.get("d") or "").replace(EX, "ex:") or None,
                    "range": (r.get("r") or "").replace(EX, "ex:") or None,
                    "label": r.get("l"),
                    "transitive": False,
                    "symmetric": False,
                },
            )
            ch = r.get("ch")
            if ch == cfg.TRANSITIVE:
                entry["transitive"] = True
            elif ch == cfg.SYMMETRIC:
                entry["symmetric"] = True
        object_properties = list(props_map.values())

        logger.info(
            "Schema: %d predicates, %d datasets, %d records, %d classes, %d object properties",
            len(predicates), len(datasets), record_count, len(classes), len(object_properties),
        )
        return {
            "predicates": predicates,
            "datasets": datasets,
            "record_count": record_count,
            "sample_values": samples,
            "classes": classes,
            "object_properties": object_properties,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))




_INSTANCE_CAP = 400

_INFRA_CLASSES = frozenset({f"{EX}Dataset", f"{EX}Record"})


def _canon_value(v: str) -> tuple[str, str]:
    display = " ".join(v.split())
    return display, display.casefold()


@router.get("/graph", tags=["graph"])
def get_graph(
    mode: str = "schema",
    dataset: str | None = None,
    group_by: str | None = None,
) -> dict:
    if mode == "instances":
        return _graph_instances(dataset, group_by)
    return _graph_schema()


def _graph_schema() -> dict:
    nodes: list[dict] = []
    links: list[dict] = []
    seen_ids: set[str] = set()

    def add_node(id_: str, name: str, type_: str, **extra: Any) -> None:
        if id_ not in seen_ids:
            seen_ids.add(id_)
            nodes.append({"id": id_, "name": name, "type": type_, **extra})

    for row in _run_select(
        f"SELECT ?d ?f WHERE {{ ?d <{EX}type> <{EX}Dataset> . ?d <{EX}fileName> ?f }}"
    ):
        d_uri, fname = row.get("d", ""), row.get("f", "")
        if d_uri:
            add_node(d_uri, fname or _ds_name(d_uri), "dataset")

    for row in _run_select(
        f"SELECT ?cls ?l WHERE {{"
        f"  ?cls <{RDF}type> <{RDFS}Class> . OPTIONAL {{ ?cls <{RDFS}label> ?l }}"
        f"}}"
    ):
        cls = row.get("cls", "")
        if cls and cls not in _INFRA_CLASSES:
            add_node(cls, row.get("l") or _ds_name(cls), "class")

    for row in _run_select(
        f"SELECT ?d ?col WHERE {{ ?d <{EX}type> <{EX}Dataset> . ?d <{EX}hasColumn> ?col }}"
    ):
        d_uri, col = row.get("d", ""), row.get("col", "")
        if not d_uri or not col:
            continue
        pred_id = f"{EX}{sanitize(col)}"
        add_node(pred_id, col, "predicate")
        links.append({"source": d_uri, "target": pred_id, "label": "hasColumn"})

    for row in _run_select(
        f"SELECT DISTINCT ?d ?cls WHERE {{"
        f"  ?d <{EX}type> <{EX}Dataset> . ?d <{EX}hasRecord> ?r . ?r <{RDF}type> ?cls ."
        f"  ?cls <{RDF}type> <{RDFS}Class>"
        f"}}"
    ):
        d_uri, cls = row.get("d", ""), row.get("cls", "")
        if d_uri in seen_ids and cls in seen_ids:
            links.append({"source": d_uri, "target": cls, "label": "materializes", "type": "materializes"})

    for row in _run_select(
        f"SELECT ?sub ?sup WHERE {{ ?sub <{RDFS}subClassOf> ?sup }}"
    ):
        sub, sup = row.get("sub", ""), row.get("sup", "")
        if not sub or not sup or sub in _INFRA_CLASSES or sup in _INFRA_CLASSES:
            continue
        add_node(sub, _ds_name(sub), "class")
        add_node(sup, _ds_name(sup), "class")
        links.append({"source": sub, "target": sup, "label": "subClassOf", "type": "subClassOf"})

    rel_seen: set[tuple[str, str, str]] = set()
    for row in _run_select(
        f"SELECT ?p ?dom ?rng ?l WHERE {{"
        f"  ?p <{RDF}type> <{RDF}Property> ."
        f"  ?p <{RDFS}domain> ?dom . ?p <{RDFS}range> ?rng ."
        f"  OPTIONAL {{ ?p <{RDFS}label> ?l }}"
        f"  FILTER NOT EXISTS {{ ?p <{cfg.RULE_CHARACTERISTIC}> <{cfg.INVERSE}> }}"
        f"}}"
    ):
        dom, rng = row.get("dom", ""), row.get("rng", "")
        if not dom or not rng or dom in _INFRA_CLASSES or rng in _INFRA_CLASSES:
            continue
        add_node(dom, _ds_name(dom), "class")
        add_node(rng, _ds_name(rng), "class")
        label = row.get("l") or _ds_name(row.get("p", ""))
        key = (dom, rng, label)
        if key in rel_seen:
            continue
        rel_seen.add(key)
        links.append({"source": dom, "target": rng, "label": label, "relation": True})

    logger.info("Graph[schema]: %d nodes, %d links", len(nodes), len(links))
    return {"nodes": nodes, "links": links, "mode": "schema", "truncated": False}


def _graph_instances(dataset: str | None, group_by: str | None) -> dict:
    if not dataset:
        raise HTTPException(status_code=400, detail="instances mode requires a 'dataset' parameter")
    ds_uri = f"{EX}{dataset}"

    def _as_int(v: Any) -> int:
        try:
            return int(v)
        except (TypeError, ValueError):
            return 0

    total_rows = _run_select(
        f"SELECT (COUNT(?r) AS ?n) WHERE {{ <{ds_uri}> <{EX}hasRecord> ?r }}"
    )
    total = _as_int(total_rows[0].get("n")) if total_rows else 0

    col_keys: dict[str, set[str]] = {}
    for row in _run_select(
        f"SELECT ?p ?o WHERE {{"
        f"  <{ds_uri}> <{EX}hasRecord> ?r . ?r ?p ?o ."
        f"  FILTER(isLiteral(?o) && datatype(?o) = <{XSD}string> && ?p != <{RDFS}label>)"
        f"}}"
    ):
        p, o = row.get("p", ""), row.get("o", "")
        if not p.startswith(EX) or not o:
            continue
        _, key = _canon_value(o)
        if key:
            col_keys.setdefault(p, set()).add(key)
    columns = [{"name": _ds_name(p), "distinct": len(keys)} for p, keys in col_keys.items()]
    columns.sort(key=lambda c: c["distinct"], reverse=True)

    if total == 0:
        return {"nodes": [], "links": [], "mode": "instances", "truncated": False,
                "total": 0, "columns": columns, "groupBy": []}

    valid = {c["name"] for c in columns}
    requested = [c.strip() for c in group_by.split(",")] if group_by else []
    selected = [c for c in requested if c in valid]
    if not selected:
        eligible = sorted(
            (c for c in columns if 1 < c["distinct"] < total),
            key=lambda c: c["distinct"],
        )
        selected = [c["name"] for c in eligible[:3]]

    nodes: list[dict] = []
    links: list[dict] = []
    seen_ids: set[str] = set()

    def add_node(id_: str, name: str, type_: str, **extra: Any) -> None:
        if id_ not in seen_ids:
            seen_ids.add(id_)
            nodes.append({"id": id_, "name": name, "type": type_, **extra})

    inst_rows = _run_select(
        f"SELECT ?r ?l WHERE {{ <{ds_uri}> <{EX}hasRecord> ?r . OPTIONAL {{ ?r <{RDFS}label> ?l }} }}"
        f" ORDER BY ?r LIMIT {_INSTANCE_CAP}"
    )
    instance_ids = {row["r"] for row in inst_rows if row.get("r")}

    col_label: dict[str, str] = {}
    for row in _run_select(f"SELECT ?col WHERE {{ <{ds_uri}> <{EX}hasColumn> ?col }}"):
        col = row.get("col")
        if col:
            col_label[f"{EX}{sanitize(col)}"] = col
    rec_props: dict[str, list[list[str]]] = {}
    for row in _run_select(
        f"SELECT ?r ?p ?v WHERE {{"
        f"  <{ds_uri}> <{EX}hasRecord> ?r . ?r ?p ?v ."
        f"  FILTER(isLiteral(?v) && ?p != <{RDFS}label>)"
        f"}}"
    ):
        r, p, v = row.get("r", ""), row.get("p", ""), row.get("v", "")
        if r not in instance_ids or not p or not v:
            continue
        rec_props.setdefault(r, []).append([col_label.get(p, _ds_name(p)), v])

    for row in inst_rows:
        r = row.get("r", "")
        if r:
            add_node(r, row.get("l") or _ds_name(r), "instance", props=rec_props.get(r, []))

    for col in selected:
        col_uri = f"{EX}{col}"
        for row in _run_select(
            f"SELECT ?r ?v WHERE {{"
            f"  <{ds_uri}> <{EX}hasRecord> ?r . ?r <{col_uri}> ?v . FILTER(isLiteral(?v))"
            f"}} ORDER BY ?v"
        ):
            r, v = row.get("r", ""), row.get("v", "")
            if r not in instance_ids or not v:
                continue
            display, key = _canon_value(v)
            if not key:
                continue
            hub_id = f"value::{col}::{key}"
            add_node(hub_id, display, "value", column=col)
            links.append({"source": r, "target": hub_id, "label": col, "type": "hasValue"})

    truncated = total > len(instance_ids)
    logger.info(
        "Graph[instances]: dataset=%s, %d nodes, %d links, groupBy=%s, truncated=%s",
        dataset, len(nodes), len(links), selected, truncated,
    )
    return {
        "nodes": nodes, "links": links, "mode": "instances",
        "truncated": truncated, "total": total, "columns": columns, "groupBy": selected,
    }




@router.get("/export/ttl", tags=["export"])
def export_all_ttl() -> Response:
    ds_rows = _run_select(f"SELECT ?d WHERE {{ ?d <{EX}type> <{EX}Dataset> }}")
    names = [_ds_name(row["d"]) for row in ds_rows if row.get("d")]
    if not names:
        raise HTTPException(status_code=404, detail="No datasets to export.")

    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in names:
            data, count = _serialize_dataset_ttl(f"{EX}{name}", name)
            zf.writestr(f"{name}.ttl", data)
    logger.info("Bundled %d datasets into ttl_exports.zip", len(names))

    return Response(
        content=zip_buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="ttl_exports.zip"'},
    )


@router.get("/export/ttl/{dataset_name}", tags=["export"])
def export_single_ttl(dataset_name: str) -> Response:
    data, count = _serialize_dataset_ttl(f"{EX}{dataset_name}", dataset_name)
    if count == 0:
        raise HTTPException(status_code=404, detail=f"Dataset '{dataset_name}' not found or empty.")
    filename = f"{sanitize(dataset_name)}.ttl"
    return Response(
        content=data,
        media_type="text/turtle",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Triple-Count": str(count),
        },
    )

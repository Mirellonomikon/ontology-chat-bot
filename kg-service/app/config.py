import logging
import os
import re
from pathlib import Path

import pyoxigraph
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

APP_ENV: str = os.getenv("APP_ENV", "development")
LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()

EX = "http://chatbot.kg/data#"
XSD = "http://www.w3.org/2001/XMLSchema#"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
RDFS = "http://www.w3.org/2000/01/rdf-schema#"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


EMBEDDING_BASE_URL: str = os.getenv("EMBEDDING_BASE_URL", "http://localhost:1234/v1").strip()
EMBEDDING_API_KEY: str = os.getenv("EMBEDDING_API_KEY", "lm-studio").strip()
EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "nomic-embed-text-v1.5").strip()
EMBED_MATCH_THRESHOLD: float = float(os.getenv("EMBED_MATCH_THRESHOLD", "0.7"))
ENABLE_EMBEDDING_LINKING: bool = _env_bool("ENABLE_EMBEDDING_LINKING", True)

ENABLE_RULE_MATERIALIZATION: bool = _env_bool("ENABLE_RULE_MATERIALIZATION", True)

IDENTIFIER_PROP = f"{EX}identifierProperty"
RULE_CHARACTERISTIC = f"{EX}ruleCharacteristic"
TRANSITIVE = f"{EX}Transitive"
SYMMETRIC = f"{EX}Symmetric"
INVERSE = f"{EX}Inverse"


def sanitize(s: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]", "_", str(s).strip())
    if cleaned and cleaned[0].isdigit():
        cleaned = "_" + cleaned
    return cleaned or "_empty"


store: pyoxigraph.Store = pyoxigraph.Store()


def setup_logging() -> None:
    fmt = "[%(asctime)s] %(levelname)-8s %(name)-25s %(message)s"
    logging.basicConfig(level=LOG_LEVEL, format=fmt, datefmt="%H:%M:%S")
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).setLevel(LOG_LEVEL)

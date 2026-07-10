import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "chats.db"


@contextmanager
def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                client_id TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL,
                model TEXT NOT NULL,
                provider TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                position INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chats_client_id ON chats(client_id);
        """)
        cols = [row[1] for row in conn.execute("PRAGMA table_info(chats)").fetchall()]
        if "client_id" not in cols:
            conn.execute("ALTER TABLE chats ADD COLUMN client_id TEXT NOT NULL DEFAULT ''")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_chats_client_id ON chats(client_id)")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_all_chats(client_id: str) -> list[dict]:
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM chats WHERE client_id = ? ORDER BY updated_at DESC",
            (client_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def create_chat(title: str, model: str, provider: str, client_id: str) -> dict:
    chat_id = str(uuid.uuid4())
    now = _now()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO chats (id, client_id, title, model, provider, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (chat_id, client_id, title, model, provider, now, now),
        )
    return {
        "id": chat_id,
        "client_id": client_id,
        "title": title,
        "model": model,
        "provider": provider,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }


def get_chat(chat_id: str, client_id: str) -> dict | None:
    with _get_conn() as conn:
        chat = conn.execute(
            "SELECT * FROM chats WHERE id = ? AND client_id = ?", (chat_id, client_id)
        ).fetchone()
        if not chat:
            return None
        msgs = conn.execute(
            "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY position",
            (chat_id,),
        ).fetchall()
        result = dict(chat)
        result["messages"] = [{"role": m["role"], "content": m["content"]} for m in msgs]
        return result


def update_chat(
    chat_id: str,
    client_id: str,
    messages: list[dict] | None = None,
    title: str | None = None,
    model: str | None = None,
    provider: str | None = None,
) -> dict | None:
    with _get_conn() as conn:
        chat = conn.execute(
            "SELECT * FROM chats WHERE id = ? AND client_id = ?", (chat_id, client_id)
        ).fetchone()
        if not chat:
            return None

        fields: list[str] = []
        params: list = []

        if title is not None:
            fields.append("title = ?")
            params.append(title)
        if model is not None:
            fields.append("model = ?")
            params.append(model)
        if provider is not None:
            fields.append("provider = ?")
            params.append(provider)

        now = _now()
        fields.append("updated_at = ?")
        params.append(now)
        params.extend([chat_id, client_id])

        conn.execute(
            f"UPDATE chats SET {', '.join(fields)} WHERE id = ? AND client_id = ?",
            params,
        )

        if messages is not None:
            conn.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
            for i, msg in enumerate(messages):
                conn.execute(
                    "INSERT INTO messages (chat_id, role, content, position) VALUES (?, ?, ?, ?)",
                    (chat_id, msg["role"], msg["content"], i),
                )

        updated = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
        msgs = conn.execute(
            "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY position",
            (chat_id,),
        ).fetchall()
        result = dict(updated)
        result["messages"] = [{"role": m["role"], "content": m["content"]} for m in msgs]
        return result


def delete_chat(chat_id: str, client_id: str) -> bool:
    with _get_conn() as conn:
        cur = conn.execute(
            "DELETE FROM chats WHERE id = ? AND client_id = ?", (chat_id, client_id)
        )
        return cur.rowcount > 0

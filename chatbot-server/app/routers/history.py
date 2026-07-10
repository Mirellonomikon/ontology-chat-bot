from fastapi import APIRouter, Header, HTTPException

from app.db import create_chat, delete_chat, get_all_chats, get_chat, update_chat
from app.models import (
    ChatDetail,
    ChatSummary,
    CreateChatRequest,
    UpdateChatRequest,
)

router = APIRouter()

_MISSING_ID = HTTPException(status_code=400, detail="X-Client-ID header is required")


def _require_client(x_client_id: str | None) -> str:
    if not x_client_id or not x_client_id.strip():
        raise _MISSING_ID
    return x_client_id.strip()


@router.get("/", response_model=list[ChatSummary], summary="List all chats")
def list_chats(x_client_id: str | None = Header(default=None)) -> list[dict]:
    client_id = _require_client(x_client_id)
    return get_all_chats(client_id)


@router.post("/", response_model=ChatDetail, status_code=201, summary="Create a new chat")
def create_chat_endpoint(
    req: CreateChatRequest,
    x_client_id: str | None = Header(default=None),
) -> dict:
    client_id = _require_client(x_client_id)
    return create_chat(req.title, req.model, req.provider, client_id)


@router.get("/{chat_id}", response_model=ChatDetail, summary="Get a chat with messages")
def get_chat_endpoint(
    chat_id: str,
    x_client_id: str | None = Header(default=None),
) -> dict:
    client_id = _require_client(x_client_id)
    chat = get_chat(chat_id, client_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


@router.put("/{chat_id}", response_model=ChatDetail, summary="Update a chat")
def update_chat_endpoint(
    chat_id: str,
    req: UpdateChatRequest,
    x_client_id: str | None = Header(default=None),
) -> dict:
    client_id = _require_client(x_client_id)
    messages = (
        [{"role": m.role, "content": m.content} for m in req.messages]
        if req.messages is not None
        else None
    )
    chat = update_chat(chat_id, client_id, messages, req.title, req.model, req.provider)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


@router.delete("/{chat_id}", summary="Delete a chat")
def delete_chat_endpoint(
    chat_id: str,
    x_client_id: str | None = Header(default=None),
) -> dict:
    client_id = _require_client(x_client_id)
    if not delete_chat(chat_id, client_id):
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"success": True}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createChat,
  deleteChat,
  getChat,
  getChats,
  updateChat,
} from '../api/client';

export function useChats() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  // Tracks the most recently created chat so App.jsx can skip the DB-reload
  // for it (messages are already in local state right after creation).
  const [justCreatedId, setJustCreatedId] = useState(null);
  const creatingRef = useRef(false);

  // Load all chats on mount and open the most recent one
  useEffect(() => {
    getChats()
      .then((data) => {
        setChats(data);
        if (data.length > 0) {
          setActiveChatId(data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  /**
   * Called the first time a message is sent in a new chat session.
   * Creates the chat record and returns it (including id).
   */
  const startChat = useCallback(async (firstMessage, model, provider) => {
    if (creatingRef.current) return null;
    creatingRef.current = true;
    try {
      const title = firstMessage.trim().slice(0, 40) || 'New Chat';
      const chat = await createChat({ title, model, provider });
      setJustCreatedId(chat.id);
      setChats((prev) => [chat, ...prev]);
      setActiveChatId(chat.id);
      return chat;
    } catch {
      return null;
    } finally {
      creatingRef.current = false;
    }
  }, []);

  /**
   * Persist the full message list for the active chat.
   */
  const persistMessages = useCallback(async (chatId, messages, model, provider) => {
    if (!chatId) return;
    try {
      const updated = await updateChat(chatId, { messages, model, provider });
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId ? { ...c, updated_at: updated.updated_at, title: updated.title } : c,
        ),
      );
    } catch {
      // non-critical; swallow silently
    }
  }, []);

  /**
   * Mark a chat as active. The App-level effect keyed on activeChatId handles
   * loading its messages, so this avoids an extra fetch on selection.
   */
  const openChat = useCallback((id) => setActiveChatId(id), []);

  /**
   * Load a chat by id (returns messages + model string "provider::model").
   */
  const selectChat = useCallback(async (id) => {
    try {
      const chat = await getChat(id);
      setActiveChatId(id);
      return chat;
    } catch {
      return null;
    }
  }, []);

  /**
   * Delete a chat and fall back to the next available one.
   */
  const removeChat = useCallback(
    async (id) => {
      try {
        await deleteChat(id);
      } catch {
        // continue regardless
      }
      setChats((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (activeChatId === id) {
          setActiveChatId(remaining.length > 0 ? remaining[0].id : null);
        }
        return remaining;
      });
    },
    [activeChatId],
  );

  /** Reset to a fresh empty chat (no active chat). */
  const newChat = useCallback(() => {
    setActiveChatId(null);
    setJustCreatedId(null);
  }, []);

  return {
    chats,
    activeChatId,
    justCreatedId,
    startChat,
    persistMessages,
    openChat,
    selectChat,
    removeChat,
    newChat,
  };
}

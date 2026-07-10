const STORAGE_KEY = "chatbot-client-id";

/**
 * Returns the persistent anonymous client ID for this browser.
 * Generates and stores a new UUID on first call.
 */
export function getClientId() {
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

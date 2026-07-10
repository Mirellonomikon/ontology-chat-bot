const BASE_URL = '';

export async function fetchProviders() {
  const res = await fetch(`${BASE_URL}/providers/`);
  if (!res.ok) throw new Error(`Failed to fetch providers: ${res.statusText}`);
  return res.json();
}

export async function fetchModels() {
  const res = await fetch(`${BASE_URL}/models/`);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.statusText}`);
  return res.json();
}

export async function* streamChat({ provider, model, messages, useKg = false, maxTokens = null, contextLength = null }) {
  const res = await fetch(`${BASE_URL}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      model,
      messages,
      stream: true,
      use_kg: useKg,
      ...(maxTokens != null && { max_tokens: maxTokens }),
      ...(contextLength != null && { context_length: contextLength }),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.done) return;
        if (parsed.token) yield parsed.token;
      } catch {
        // ignore malformed lines
      }
    }
  }
}

// Chat history CRUD — all calls include X-Client-ID to scope history per browser

import { getClientId } from '../utils/clientId';

function historyHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'X-Client-ID': getClientId(), ...extra };
}

export async function getChats() {
  const res = await fetch(`${BASE_URL}/history/`, {
    headers: historyHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch chats: ${res.statusText}`);
  return res.json();
}

export async function createChat({ title, model, provider }) {
  const res = await fetch(`${BASE_URL}/history/`, {
    method: 'POST',
    headers: historyHeaders(),
    body: JSON.stringify({ title, model, provider }),
  });
  if (!res.ok) throw new Error(`Failed to create chat: ${res.statusText}`);
  return res.json();
}

export async function getChat(id) {
  const res = await fetch(`${BASE_URL}/history/${id}`, {
    headers: historyHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to fetch chat: ${res.statusText}`);
  return res.json();
}

export async function updateChat(id, data) {
  const res = await fetch(`${BASE_URL}/history/${id}`, {
    method: 'PUT',
    headers: historyHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to update chat: ${res.statusText}`);
  return res.json();
}

export async function deleteChat(id) {
  const res = await fetch(`${BASE_URL}/history/${id}`, {
    method: 'DELETE',
    headers: historyHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to delete chat: ${res.statusText}`);
  return res.json();
}

// Provider settings

export async function getProviderSettings() {
  const res = await fetch(`${BASE_URL}/settings/`);
  if (!res.ok) throw new Error(`Failed to fetch settings: ${res.statusText}`);
  return res.json();
}

export async function getSystemPrompt() {
  const res = await fetch(`${BASE_URL}/settings/system-prompt`);
  if (!res.ok) throw new Error(`Failed to fetch system prompt: ${res.statusText}`);
  return res.json(); // { text: "..." }
}

export async function saveProviderSettings(payload) {
  const res = await fetch(`${BASE_URL}/settings/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

// Knowledge-graph file upload, dataset management, graph visualization, and TTL export

export async function getKgSchema() {
  const res = await fetch(`${BASE_URL}/ingest/schema`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

export async function deleteKgDataset(datasetName) {
  const res = await fetch(`${BASE_URL}/ingest/datasets/${encodeURIComponent(datasetName)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

export async function uploadKnowledgeFile(file, provider = null, model = null) {
  const formData = new FormData();
  formData.append('file', file);
  // Selected model drives LLM ontology induction on the server (tabular files only).
  if (provider) formData.append('provider', provider);
  if (model) formData.append('model', model);
  const res = await fetch(`${BASE_URL}/ingest/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

// mode: 'schema' (classes/hierarchy/relations) or 'instances' (records + value hubs).
// For 'instances', pass a dataset local-name and optionally an array of group-by columns.
export async function getKgGraph({ mode = 'schema', dataset, groupBy } = {}) {
  const params = new URLSearchParams({ mode });
  if (dataset) params.set('dataset', dataset);
  if (groupBy && groupBy.length) params.set('group_by', groupBy.join(','));
  const res = await fetch(`${BASE_URL}/kg/graph?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

// Pull the filename out of a Content-Disposition header, falling back to a default.
function filenameFromResponse(res, fallback) {
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : fallback;
}

// Save a Blob to the browser's Downloads folder via a synthetic anchor click.
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Downloads a single dataset as a .ttl file, or all datasets bundled as a .zip,
// straight to the browser's Downloads folder. Returns the downloaded filename.
export async function exportKgTtl(datasetName = null) {
  const url = datasetName
    ? `${BASE_URL}/kg/export/ttl/${encodeURIComponent(datasetName)}`
    : `${BASE_URL}/kg/export/ttl`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  const blob = await res.blob();
  const filename = filenameFromResponse(
    res,
    datasetName ? `${datasetName}.ttl` : 'ttl_exports.zip'
  );
  saveBlob(blob, filename);
  return { filename };
}

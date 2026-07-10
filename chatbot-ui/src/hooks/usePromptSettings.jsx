import { createContext, useCallback, useContext, useState } from 'react';

const STORAGE_KEY = 'haro-prompt-settings';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

const PromptSettingsContext = createContext(null);

export function PromptSettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    const stored = load();
    return {
      customEnabled: stored.customEnabled ?? false,
      customText: stored.customText ?? '',
      haroEnabled: stored.haroEnabled ?? true,
      maxTokens: stored.maxTokens ?? 2048,
      contextLength: stored.contextLength ?? 8192,
    };
  });

  const update = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      save(next);
      return next;
    });
  }, []);

  const setCustomEnabled = useCallback((v) => update({ customEnabled: v }), [update]);
  const setCustomText = useCallback((v) => update({ customText: v }), [update]);
  const setHaroEnabled = useCallback((v) => update({ haroEnabled: v }), [update]);
  const setMaxTokens = useCallback((v) => update({ maxTokens: v }), [update]);
  const setContextLength = useCallback((v) => update({ contextLength: v }), [update]);

  const value = {
    customEnabled: settings.customEnabled,
    customText: settings.customText,
    haroEnabled: settings.haroEnabled,
    maxTokens: settings.maxTokens,
    contextLength: settings.contextLength,
    setCustomEnabled,
    setCustomText,
    setHaroEnabled,
    setMaxTokens,
    setContextLength,
  };

  return (
    <PromptSettingsContext.Provider value={value}>
      {children}
    </PromptSettingsContext.Provider>
  );
}

// Co-located with its provider (same pattern as ui/color-mode.jsx).
// eslint-disable-next-line react-refresh/only-export-components
export function usePromptSettings() {
  const ctx = useContext(PromptSettingsContext);
  if (!ctx) {
    throw new Error('usePromptSettings must be used within a PromptSettingsProvider');
  }
  return ctx;
}

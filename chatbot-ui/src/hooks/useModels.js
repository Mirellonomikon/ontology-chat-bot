import { useEffect, useState } from 'react';
import { fetchModels } from '../api/client';

export function useModels() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Backend skips unavailable providers, so all returned models are usable
        const data = await fetchModels();
        if (!cancelled) setModels(data.models);
      } catch {
        // models list stays empty; App shows "No model selected"
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { models, loading };
}

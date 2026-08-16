import { useCallback, useEffect, useState } from "react";
import type { EnvStatus, Settings, Visualization } from "@shared/types";

/** Live list of all visualizations, kept in sync via the change channel. */
export function useVisualizations(): {
  items: Visualization[] | null;
  refresh: () => void;
} {
  const [items, setItems] = useState<Visualization[] | null>(null);

  const refresh = useCallback(() => {
    window.api.visualizations.list().then(setItems);
  }, []);

  useEffect(() => {
    refresh();
    const off = window.api.visualizations.onChanged((viz) => {
      setItems((prev) => {
        const list = prev ? [...prev] : [];
        const idx = list.findIndex((v) => v.id === viz.id);
        if (idx >= 0) list[idx] = viz;
        else list.unshift(viz);
        return list.sort((a, b) => b.createdAt - a.createdAt);
      });
    });
    return off;
  }, [refresh]);

  return { items, refresh };
}

/** Live single visualization. Returns undefined while loading, null if missing. */
export function useVisualization(id: string): Visualization | null | undefined {
  const [viz, setViz] = useState<Visualization | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    window.api.visualizations.get(id).then((v) => {
      if (active) setViz(v);
    });
    const off = window.api.visualizations.onChanged((incoming) => {
      if (incoming.id === id) setViz(incoming);
    });
    return () => {
      active = false;
      off();
    };
  }, [id]);

  return viz;
}

export function useSettings(): {
  settings: Settings | null;
  save: (patch: Partial<Settings>) => Promise<void>;
} {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    window.api.settings.get().then(setSettings);
  }, []);

  const save = useCallback(async (patch: Partial<Settings>) => {
    const next = await window.api.settings.set(patch);
    setSettings(next);
  }, []);

  return { settings, save };
}

export function useEnvStatus(): {
  env: EnvStatus | null;
  loading: boolean;
  recheck: () => void;
} {
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const recheck = useCallback(() => {
    setLoading(true);
    window.api.env
      .check()
      .then(setEnv)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    recheck();
  }, [recheck]);

  return { env, loading, recheck };
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchDefaults,
  fetchObsTrafficStatus,
  startObsTrafficSim,
  stopObsTrafficSim,
  type ObsTrafficScene,
  type ObsTrafficStatus,
  type ObsTrafficStreamMode,
  type Target,
} from "@/api/client";

type ObsTrafficSimContextValue = {
  status: ObsTrafficStatus | null;
  defaultTarget: Target;
  loading: boolean;
  actionError: string | null;
  refresh: () => Promise<void>;
  start: (
    pageKey: ObsTrafficScene,
    target: Target,
    durationMinutes: number,
    concurrency: number,
    streamMode: ObsTrafficStreamMode
  ) => Promise<void>;
  stop: () => Promise<void>;
};

const ObsTrafficSimContext = createContext<ObsTrafficSimContextValue | null>(null);

const EMPTY_STATUS: ObsTrafficStatus = {
  running: false,
  started_from: null,
  target: { host: "172.16.30.122", port: 8000 },
  duration_minutes: 10,
  concurrency: 5,
  stream_mode: "mixed",
  stream_models: [],
  stream_model_count: 0,
  started_at: null,
  ends_at: null,
  elapsed_seconds: 0,
  remaining_seconds: 0,
  models: [],
  stats: {
    sent: 0,
    success: 0,
    non_200: 0,
    timeout: 0,
    connection_failed: 0,
    other_errors: 0,
    error_total: 0,
    last_error: null,
    last_status_code: null,
    last_model: null,
    recent_errors: [],
  },
};

export function ObsTrafficSimProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ObsTrafficStatus | null>(null);
  const [defaultTarget, setDefaultTarget] = useState<Target>({
    host: "172.16.30.122",
    port: 8000,
  });
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchObsTrafficStatus();
      setStatus(s);
    } catch {
      setStatus((prev) => prev ?? EMPTY_STATUS);
    }
  }, []);

  useEffect(() => {
    fetchDefaults()
      .then((c) => setDefaultTarget(c.default_vs))
      .catch(() => undefined);
    refresh();
  }, [refresh]);

  useEffect(() => {
    const ms = status?.running ? 1000 : 5000;
    const id = window.setInterval(() => {
      refresh();
    }, ms);
    return () => window.clearInterval(id);
  }, [status?.running, refresh]);

  const start = useCallback(
    async (
      pageKey: ObsTrafficScene,
      target: Target,
      durationMinutes: number,
      concurrency: number,
      streamMode: ObsTrafficStreamMode
    ) => {
      setLoading(true);
      setActionError(null);
      try {
        const s = await startObsTrafficSim(
          target,
          durationMinutes,
          concurrency,
          pageKey,
          streamMode
        );
        setStatus(s);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const startedFrom = (e as Error & { startedFrom?: string }).startedFrom;
        if (msg === "traffic_sim_already_running" && startedFrom) {
          setActionError(`already_running:${startedFrom}`);
        } else {
          setActionError(msg);
        }
        await refresh();
      } finally {
        setLoading(false);
      }
    },
    [refresh]
  );

  const stop = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const s = await stopObsTrafficSim();
      setStatus(s);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      defaultTarget,
      loading,
      actionError,
      refresh,
      start,
      stop,
    }),
    [status, defaultTarget, loading, actionError, refresh, start, stop]
  );

  return (
    <ObsTrafficSimContext.Provider value={value}>{children}</ObsTrafficSimContext.Provider>
  );
}

export function useObsTrafficSim() {
  const ctx = useContext(ObsTrafficSimContext);
  if (!ctx) {
    throw new Error("useObsTrafficSim must be used within ObsTrafficSimProvider");
  }
  return ctx;
}

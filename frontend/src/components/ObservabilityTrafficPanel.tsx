import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ObsTrafficScene, ObsTrafficStreamMode, Target } from "@/api/client";
import { useObsTrafficSim } from "@/context/ObsTrafficSimContext";

type Props = {
  pageKey: ObsTrafficScene;
};

export function ObservabilityTrafficPanel({ pageKey }: Props) {
  const { t } = useTranslation();
  const { status, defaultTarget, loading, actionError, start, stop } = useObsTrafficSim();
  const [target, setTarget] = useState<Target>(defaultTarget);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [concurrency, setConcurrency] = useState(5);
  const [streamMode, setStreamMode] = useState<ObsTrafficStreamMode>("mixed");

  useEffect(() => {
    setTarget(defaultTarget);
  }, [defaultTarget]);

  const running = status?.running ?? false;
  const startedFrom = status?.started_from;
  const lockedByOther = running && startedFrom !== pageKey;
  const stats = status?.stats;

  const sceneLabel = (key: string | null | undefined) => {
    if (key === "obsTokens") return t("nav.obsTokens");
    if (key === "obsMetrics") return t("nav.obsMetrics");
    return key ?? "";
  };

  const streamModeLabel = (mode: ObsTrafficStreamMode) =>
    t(`scenes.obsTraffic.streamMode.${mode}`);

  const activeStreamMode = (status?.stream_mode ?? streamMode) as ObsTrafficStreamMode;

  return (
    <div className="rounded-lg border border-violet-700/40 bg-slate-900/60 p-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-violet-300">{t("scenes.obsTraffic.title")}</p>
        <p className="mt-1 text-xs text-slate-400">{t("scenes.obsTraffic.subtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="mb-1 block text-xs text-slate-500">{t("demo.host")}</label>
          <input
            className="input-field font-mono"
            value={target.host}
            onChange={(e) => setTarget((t) => ({ ...t, host: e.target.value }))}
            disabled={running}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">{t("demo.port")}</label>
          <input
            className="input-field font-mono"
            type="number"
            value={target.port}
            onChange={(e) =>
              setTarget((t) => ({ ...t, port: parseInt(e.target.value, 10) || 8000 }))
            }
            disabled={running}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">
            {t("scenes.obsTraffic.durationMinutes")}
          </label>
          <input
            className="input-field"
            type="number"
            min={1}
            max={180}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 10)}
            disabled={running}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">
            {t("scenes.obsTraffic.concurrency")}
          </label>
          <input
            className="input-field"
            type="number"
            min={1}
            max={10}
            value={concurrency}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10) || 5;
              setConcurrency(Math.min(10, Math.max(1, n)));
            }}
            disabled={running}
          />
        </div>
        <div className="col-span-2 md:col-span-3 lg:col-span-2">
          <label className="mb-1 block text-xs text-slate-500">
            {t("scenes.obsTraffic.streamModeLabel")}
          </label>
          <select
            className="input-field w-full"
            value={running ? activeStreamMode : streamMode}
            onChange={(e) => setStreamMode(e.target.value as ObsTrafficStreamMode)}
            disabled={running}
          >
            <option value="non_stream">{streamModeLabel("non_stream")}</option>
            <option value="stream">{streamModeLabel("stream")}</option>
            <option value="mixed">{streamModeLabel("mixed")}</option>
          </select>
        </div>
        <div className="flex items-end col-span-2 md:col-span-1 lg:col-span-1">
          {running ? (
            <button
              type="button"
              className="btn-stop w-full"
              onClick={() => stop()}
              disabled={loading}
            >
              {t("scenes.obsTraffic.stop")}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => start(pageKey, target, durationMinutes, concurrency, streamMode)}
              disabled={loading}
            >
              {t("scenes.obsTraffic.start")}
            </button>
          )}
        </div>
      </div>

      {running && lockedByOther && (
        <p className="text-xs text-cyan-400">
          {t("scenes.obsTraffic.runningInOther", { scene: sceneLabel(startedFrom) })}
        </p>
      )}

      {actionError && (
        <p className="text-xs text-rose-400">
          {actionError.startsWith("already_running:")
            ? t("scenes.obsTraffic.lockedByOther", {
                scene: sceneLabel(actionError.split(":")[1]),
              })
            : actionError}
        </p>
      )}

      {(running || (stats && stats.sent > 0)) && (
        <div className="space-y-2 rounded-md border border-slate-700/80 bg-slate-950/50 p-3 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
            <span>
              {t("scenes.obsTraffic.sent")}: <strong>{stats?.sent ?? 0}</strong>
            </span>
            <span className="text-emerald-400">
              200: <strong>{stats?.success ?? 0}</strong>
            </span>
            <span className="text-rose-400">
              {t("scenes.obsTraffic.errors")}: <strong>{stats?.error_total ?? 0}</strong>
              {stats && stats.error_total > 0 && (
                <span className="text-slate-500">
                  {" "}
                  (4xx/5xx {stats.non_200}, {t("demo.timeout")} {stats.timeout},{" "}
                  {t("demo.connectionFailed")} {stats.connection_failed})
                </span>
              )}
            </span>
            {running && status && (
              <>
                <span className="text-cyan-400">
                  {t("scenes.obsTraffic.remaining")}: {status.remaining_seconds}s
                </span>
                <span className="text-violet-300">
                  {t("scenes.obsTraffic.concurrency")}: {status.concurrency}
                </span>
                <span className="text-violet-300">
                  {t("scenes.obsTraffic.streamModeActive")}:{" "}
                  {streamModeLabel(activeStreamMode)}
                  {activeStreamMode === "mixed" && status.stream_model_count > 0 && (
                    <span className="text-slate-500">
                      {" "}
                      ({status.stream_model_count}/{status.models.length})
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
          {stats?.last_error && (
            <p className="text-rose-300/90">
              {t("scenes.obsTraffic.lastError")}: [{stats.last_model}] HTTP{" "}
              {stats.last_status_code ?? "—"} — {stats.last_error}
            </p>
          )}
          {stats && stats.recent_errors.length > 0 && (
            <ul className="max-h-28 overflow-y-auto space-y-1 text-slate-500">
              {stats.recent_errors.map((err, i) => (
                <li key={`${err.at}-${i}`} className="font-mono text-[11px]">
                  {err.at} · {err.model} · {err.status_code} · {err.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrafanaConfig } from "@/utils/grafana";
import {
  fetchMcpInsightConfig,
  fetchMcpInsightHealth,
  fetchMcpTrafficStatus,
  startMcpTrafficSim,
  stopMcpTrafficSim,
  type McpInsightConfig,
  type McpStreamEvent,
  type McpTrafficStatus,
} from "@/api/client";
import { McpMessageTimeline } from "./McpMessageTimeline";
import { McpProtocolDiffPanel } from "./McpProtocolDiffPanel";

const PREFIX = "scenes.mcpToolsInsight";

type McpInsightDemoProps = {
  i18nPrefix?: string;
  apiBasePath?: string;
  streamPath?: string;
  protocolVersionLabel?: string;
  showProtocolDiff?: boolean;
};

export function McpInsightDemo({
  i18nPrefix = PREFIX,
  apiBasePath,
  streamPath,
  protocolVersionLabel,
  showProtocolDiff = false,
}: McpInsightDemoProps) {
  const { t } = useTranslation();
  const { openUrl: grafanaUrl, baseUrl: grafanaBaseUrl } = useGrafanaConfig();
  const [config, setConfig] = useState<McpInsightConfig | null>(null);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(9001);
  const [agent, setAgent] = useState("monitoring-agent");
  const [tenant, setTenant] = useState("ops-team");
  const [scenario, setScenario] = useState("full");
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<McpStreamEvent[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [auditSummary, setAuditSummary] = useState<{
    total: number;
    accepted: number;
    failed: number;
    adapter_url?: string;
  } | null>(null);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [trafficStatus, setTrafficStatus] = useState<McpTrafficStatus | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);

  const trafficRunning = trafficStatus?.running ?? false;
  const busy = running || trafficRunning;

  const optionLabel = useCallback(
    (group: "agents" | "tenants" | "scenarios", id: string) =>
      t(`${i18nPrefix}.${group}.${id}`, { defaultValue: id }),
    [t, i18nPrefix]
  );

  useEffect(() => {
    fetchMcpInsightConfig(apiBasePath)
      .then((c) => {
        setConfig(c);
        const vs = c.default_vs as { host: string; port: number };
        setHost(vs.host);
        setPort(vs.port);
      })
      .catch((e) => setError(String(e)));
  }, [apiBasePath]);

  const checkHealth = useCallback(async () => {
    try {
      const h = await fetchMcpInsightHealth(host, port, apiBasePath);
      const mcp = h.mcp_server.ok
        ? t(`${i18nPrefix}.healthMcpOk`)
        : t(`${i18nPrefix}.healthMcpDown`);
      const ad = h.adapter.ok
        ? t(`${i18nPrefix}.healthAdapterOk`)
        : t(`${i18nPrefix}.healthAdapterDown`);
      setHealth(`${mcp} · ${ad}`);
    } catch {
      setHealth(t(`${i18nPrefix}.healthCheckFailed`));
    }
  }, [host, port, t, apiBasePath, i18nPrefix]);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  const refreshTrafficStatus = useCallback(async () => {
    try {
      const s = await fetchMcpTrafficStatus(apiBasePath);
      setTrafficStatus(s);
    } catch {
      setTrafficStatus((prev) => prev ?? null);
    }
  }, [apiBasePath]);

  useEffect(() => {
    void refreshTrafficStatus();
  }, [refreshTrafficStatus]);

  useEffect(() => {
    const ms = trafficRunning ? 1000 : 5000;
    const id = window.setInterval(() => void refreshTrafficStatus(), ms);
    return () => window.clearInterval(id);
  }, [trafficRunning, refreshTrafficStatus]);

  const startContinuous = useCallback(async () => {
    setTrafficLoading(true);
    setTrafficError(null);
    const runnerEmitAudit = config?.emit_audit_without_f5 === true;
    try {
      const s = await startMcpTrafficSim(
        { host, port },
        durationMinutes,
        runnerEmitAudit ? true : undefined,
        apiBasePath
      );
      setTrafficStatus(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTrafficError(
        msg === "mcp_traffic_sim_already_running"
          ? t(`${i18nPrefix}.continuous.alreadyRunning`)
          : msg
      );
      await refreshTrafficStatus();
    } finally {
      setTrafficLoading(false);
    }
  }, [config, host, port, durationMinutes, refreshTrafficStatus, t, apiBasePath, i18nPrefix]);

  const stopContinuous = useCallback(async () => {
    setTrafficLoading(true);
    setTrafficError(null);
    try {
      const s = await stopMcpTrafficSim(apiBasePath);
      setTrafficStatus(s);
      void checkHealth();
    } catch (e) {
      setTrafficError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrafficLoading(false);
    }
  }, [checkHealth, apiBasePath]);

  const runStream = useCallback(
  async (scenarioId: string) => {
    if (!config) {
      setError(t(`${i18nPrefix}.configLoading`));
      return;
    }

    setRunning(true);
    setError(null);
    setEvents([]);
    setStats(null);
    setAuditSummary(null);
    setSessionComplete(false);
    setScenario(scenarioId);

    const runnerEmitAudit = config.emit_audit_without_f5 === true;
    const f5Mode = config.audit_delivery === "f5" || !runnerEmitAudit;

    const params = new URLSearchParams({
      agent,
      tenant,
      scenario: scenarioId,
      host,
      port: String(port),
    });
    if (runnerEmitAudit) {
      params.set("emit_audit", "true");
    }

    const streamEndpoint = streamPath ?? `${apiBasePath ?? "/api/demo/mcp-insight"}/run-stream`;
    const es = new EventSource(`${streamEndpoint}?${params.toString()}`);

    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as McpStreamEvent;
        setEvents((prev) => [...prev, ev]);
      } catch {
        /* ignore */
      }
    };

    es.addEventListener("audit", (e) => {
      if (f5Mode) return;
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          accepted?: number;
          total?: number;
          failed?: number;
          adapter_url?: string;
        };
        setAuditSummary({
          accepted: data.accepted ?? 0,
          total: data.total ?? 0,
          failed: data.failed ?? 0,
          adapter_url: data.adapter_url,
        });
      } catch {
        /* ignore */
      }
    });

    es.addEventListener("complete", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          stats?: Record<string, unknown>;
          audit_delivery?: "f5" | "runner";
          audit_summary?: {
            total: number;
            accepted: number;
            failed: number;
            adapter_url?: string;
            source?: string;
          };
        };
        setStats(data.stats ?? null);
        const delivery = data.audit_delivery ?? (f5Mode ? "f5" : "runner");
        if (delivery === "runner" && data.audit_summary?.source !== "f5") {
          setAuditSummary(data.audit_summary ?? null);
        }
      } catch {
        /* ignore */
      }
      setSessionComplete(true);
      es.close();
      setRunning(false);
      void checkHealth();
    });

    es.addEventListener("error", (e) => {
      if (es.readyState === EventSource.CLOSED) return;
      try {
        const data = JSON.parse((e as MessageEvent).data) as { error?: string };
        setError(data.error ?? t(`${i18nPrefix}.streamError`, { host, port }));
      } catch {
        setError(t(`${i18nPrefix}.streamError`, { host, port }));
      }
      es.close();
      setSessionComplete(true);
      setRunning(false);
    });
  },
  [agent, tenant, host, port, checkHealth, config, t, i18nPrefix, apiBasePath, streamPath]);

  const f5AuditMode =
    config?.audit_delivery === "f5" || config?.emit_audit_without_f5 === false;
  const adapterUrl =
    auditSummary?.adapter_url ??
    (config?.adapter_events_url as string | undefined) ??
    "http://127.0.0.1:8090/api/mcp-events";
  const showAuditPanel =
    !f5AuditMode && (running || sessionComplete || auditSummary !== null);

  const scenarios = (config?.scenarios as { id: string; label: string }[]) ?? [];
  const grafanaHref =
    showProtocolDiff && config?.grafana_dashboard_uid
      ? `${grafanaBaseUrl}/d/${config.grafana_dashboard_uid}`
      : grafanaUrl;

  return (
    <div className="space-y-4">
      {showProtocolDiff ? (
        <McpProtocolDiffPanel
          i18nPrefix={i18nPrefix}
          protocolVersionLabel={protocolVersionLabel}
        />
      ) : null}
      {error ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-slate-400">
          {t(`${i18nPrefix}.labels.agent`)}
          <select
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            disabled={busy}
          >
            {((config?.agent_options as { id: string; label: string }[]) ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {optionLabel("agents", a.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          {t(`${i18nPrefix}.labels.tenant`)}
          <select
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            disabled={busy}
          >
            {((config?.tenant_options as { id: string; label: string }[]) ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {optionLabel("tenants", a.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          {t(`${i18nPrefix}.labels.mcpHost`)}
          <input
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block text-xs text-slate-400">
          {t(`${i18nPrefix}.labels.port`)}
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            disabled={busy}
          />
        </label>
      </div>

      {health ? <p className="text-xs text-slate-500">{health}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !config}
          onClick={() => void runStream("full")}
          className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {t(`${i18nPrefix}.runFull`)}
        </button>
      </div>

      <div className="rounded-lg border border-cyan-700/40 bg-slate-950/60 p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-cyan-300">
            {t(`${i18nPrefix}.continuous.title`)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {t(`${i18nPrefix}.continuous.subtitle`)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[120px] text-xs text-slate-400">
            {t(`${i18nPrefix}.continuous.durationMinutes`)}
            <input
              type="number"
              min={1}
              max={180}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 10)}
              disabled={busy}
            />
          </label>
          {trafficRunning ? (
            <button
              type="button"
              onClick={() => void stopContinuous()}
              disabled={trafficLoading}
              className="rounded-md border border-rose-500/60 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            >
              {t(`${i18nPrefix}.continuous.stop`)}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void startContinuous()}
              disabled={busy || !config || trafficLoading}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {t(`${i18nPrefix}.continuous.start`)}
            </button>
          )}
          <a
            href={grafanaHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md border border-cyan-500/60 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/20"
          >
            {t(`${i18nPrefix}.openGrafana`)}
          </a>
        </div>
        {trafficRunning && trafficStatus?.stats ? (
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">
            <span>
              {t(`${i18nPrefix}.continuous.sessions`)}:{" "}
              {trafficStatus.stats.sessions}
            </span>
            <span>
              {t(`${i18nPrefix}.continuous.toolCalls`)}:{" "}
              {trafficStatus.stats.tool_calls}
            </span>
            <span>
              {t(`${i18nPrefix}.continuous.remaining`)}:{" "}
              {trafficStatus.remaining_seconds}s
            </span>
            {trafficStatus.stats.last_agent ? (
              <span className="truncate font-mono">
                {trafficStatus.stats.last_agent} / {trafficStatus.stats.last_tenant} ·{" "}
                {trafficStatus.stats.last_scenario}
              </span>
            ) : null}
          </div>
        ) : null}
        {trafficError ? <p className="text-xs text-rose-400">{trafficError}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {scenarios
          .filter((s) => s.id !== "full")
          .map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={busy || !config}
              onClick={() => void runStream(s.id)}
              className={`rounded border px-2 py-1 text-xs ${
                scenario === s.id
                  ? "border-cyan-500 bg-cyan-500/20 text-cyan-200"
                  : "border-slate-600 text-slate-400 hover:border-slate-500"
              }`}
            >
              {optionLabel("scenarios", s.id)}
            </button>
          ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <McpMessageTimeline
          events={events}
          running={running}
          showMrtrLabels={showProtocolDiff}
        />
        <div className="rounded-lg border border-cyan-800/40 bg-slate-950/60 p-3 text-sm">
          <p className="mb-2 font-medium text-cyan-300">
            {t(`${i18nPrefix}.statsTitle`)}
          </p>
          {stats ? (
            <ul className="space-y-1 font-mono text-xs text-slate-300">
              <li>tool_calls: {String(stats.tool_calls ?? 0)}</li>
              <li>sampling: {String(stats.sampling ?? 0)}</li>
              <li>elicitation: {String(stats.elicitation ?? 0)}</li>
              <li>duration_ms: {String(stats.duration_ms ?? 0)}</li>
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              {t(`${i18nPrefix}.statsEmpty`)}
            </p>
          )}
          {showAuditPanel ? (
            <div
              className={`mt-3 rounded border px-2 py-1.5 text-xs ${
                running
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                  : auditSummary && auditSummary.failed > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                    : auditSummary && auditSummary.total > 0
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-600/40 bg-slate-800/40 text-slate-300"
              }`}
            >
              <p className="font-medium">
                {t(`${i18nPrefix}.auditTitle`)}
              </p>
              {running && !auditSummary ? (
                <p className="mt-1 font-mono animate-pulse">
                  {t(`${i18nPrefix}.auditPosting`)}
                </p>
              ) : auditSummary ? (
                <p className="mt-1 font-mono">
                  {auditSummary.accepted}/{auditSummary.total}{" "}
                  {t(`${i18nPrefix}.auditDelivered`)}
                  {auditSummary.failed > 0
                    ? ` · ${auditSummary.failed} ${t(`${i18nPrefix}.auditFailed`)}`
                    : ""}
                </p>
              ) : sessionComplete ? (
                <p className="mt-1 font-mono text-slate-400">
                  {t(`${i18nPrefix}.auditNone`)}
                </p>
              ) : null}
              <p className="mt-1 truncate text-[10px] opacity-80">{adapterUrl}</p>
              {auditSummary && auditSummary.failed > 0 ? (
                <p className="mt-1 text-[10px] opacity-90">
                  {t(`${i18nPrefix}.auditFailedHint`)}
                </p>
              ) : null}
            </div>
          ) : null}
          {!f5AuditMode ? (
            <p className="mt-4 text-xs text-slate-500">
              {t(`${i18nPrefix}.auditHint`)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

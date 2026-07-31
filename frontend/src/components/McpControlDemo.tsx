import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrafanaConfig } from "@/utils/grafana";
import {
  fetchMcpControlConfig,
  fetchMcpControlHealth,
  fetchMcpControlTrafficStatus,
  runMcpControl,
  startMcpControlTrafficSim,
  stopMcpControlTrafficSim,
  type McpControlConfig,
  type McpControlRunResult,
  type McpControlTrafficStatus,
} from "@/api/client";
import { McpControlResultTimeline } from "./McpControlResultTimeline";

const PREFIX = "scenes.mcpToolsControl";

type DemoTab = "tier1" | "tier2" | "sim";
type RunParams = {
  agentId: string;
  targetServerId: string;
  activeTab: "tier1" | "tier2";
  toolName: string;
};

export function McpControlDemo() {
  const { t } = useTranslation();
  const { openUrl: grafanaUrl, baseUrl: grafanaBaseUrl } = useGrafanaConfig();
  const [config, setConfig] = useState<McpControlConfig | null>(null);
  const [activeTab, setActiveTab] = useState<DemoTab>("tier1");
  const [agentId, setAgentId] = useState("ops-admin-agent");
  const [targetServerId, setTargetServerId] = useState("ops");
  const [toolName, setToolName] = useState("query_alert");
  const [result, setResult] = useState<McpControlRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [trafficStatus, setTrafficStatus] = useState<McpControlTrafficStatus | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);

  const trafficRunning = trafficStatus?.running ?? false;
  const isSimTab = activeTab === "sim";

  const toolOptions = useMemo(
    () => [
      { id: "query_alert", label: t(`${PREFIX}.tools.queryAlert`) },
      { id: "restart_service", label: t(`${PREFIX}.tools.restartService`) },
    ],
    [t]
  );

  const denyScenes = useMemo(
    () => [
      {
        id: "t1_cross_domain_ops_finance",
        label: t(`${PREFIX}.sim.cases.t1CrossDomainOpsFinance`),
      },
      {
        id: "t1_guest_ops",
        label: t(`${PREFIX}.sim.cases.t1GuestOps`),
      },
      {
        id: "t1_finance_ops",
        label: t(`${PREFIX}.sim.cases.t1FinanceOps`),
      },
      {
        id: "t1_guest_finance",
        label: t(`${PREFIX}.sim.cases.t1GuestFinance`),
      },
      {
        id: "t2_readonly_restart",
        label: t(`${PREFIX}.sim.cases.t2ReadonlyRestart`),
      },
    ],
    [t]
  );

  useEffect(() => {
    fetchMcpControlConfig()
      .then((c) => {
        setConfig(c);
        if (c.agent_identities[0]) setAgentId(c.agent_identities[0].id);
        if (c.target_servers[0]) setTargetServerId(c.target_servers[0].id);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const h = await fetchMcpControlHealth();
      const vs = h.vs.ok
        ? t(`${PREFIX}.health.vsOk`, { detail: h.vs.detail ?? "" })
        : t(`${PREFIX}.health.vsDown`, { detail: h.vs.detail ?? "" });
      const backends = Object.entries(h.backends)
        .map(([id, b]) =>
          b.ok
            ? t(`${PREFIX}.health.backendOk`, { id, target: b.target })
            : t(`${PREFIX}.health.backendDown`, { id, target: b.target })
        )
        .join(" · ");
      setHealth(`${vs}${backends ? ` · ${backends}` : ""}`);
    } catch {
      setHealth(t(`${PREFIX}.health.checkFailed`));
    }
  }, [t]);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  const refreshTrafficStatus = useCallback(async () => {
    try {
      const s = await fetchMcpControlTrafficStatus();
      setTrafficStatus(s);
    } catch {
      setTrafficStatus((prev) => prev ?? null);
    }
  }, []);

  useEffect(() => {
    void refreshTrafficStatus();
  }, [refreshTrafficStatus]);

  useEffect(() => {
    const ms = trafficRunning ? 1000 : 5000;
    const id = window.setInterval(() => void refreshTrafficStatus(), ms);
    return () => window.clearInterval(id);
  }, [trafficRunning, refreshTrafficStatus]);

  const runOnce = useCallback(
    async (params: RunParams) => {
      setRunning(true);
      setError(null);
      setResult(null);
      try {
        const r = await runMcpControl({
          agent_id: params.agentId,
          target_server_id: params.targetServerId,
          scenario: params.activeTab,
          ...(params.activeTab === "tier2" ? { tool_name: params.toolName } : {}),
        });
        setResult(r);
      } catch (e) {
        setError(String(e));
      } finally {
        setRunning(false);
        void checkHealth();
      }
    },
    [checkHealth]
  );

  const quickCases = useMemo(() => {
    if (activeTab === "tier1") {
      return [
        {
          id: "t1-allow-ops",
          label: t(`${PREFIX}.quick.t1AllowOps`),
          agentId: "ops-admin-agent",
          targetServerId: "ops",
          toolName: "query_alert",
        },
        {
          id: "t1-deny-cross-domain",
          label: t(`${PREFIX}.quick.t1DenyCrossDomain`),
          agentId: "ops-admin-agent",
          targetServerId: "finance",
          toolName: "query_alert",
        },
        {
          id: "t1-deny-no-group",
          label: t(`${PREFIX}.quick.t1DenyNoGroup`),
          agentId: "guest-agent",
          targetServerId: "ops",
          toolName: "query_alert",
        },
      ];
    }
    if (activeTab === "tier2") {
      return [
        {
          id: "t2-allow-read-tool",
          label: t(`${PREFIX}.quick.t2AllowReadonlyTool`),
          agentId: "ops-readonly-agent",
          targetServerId: "ops",
          toolName: "query_alert",
        },
        {
          id: "t2-deny-write-tool",
          label: t(`${PREFIX}.quick.t2DenyPrivilegedTool`),
          agentId: "ops-readonly-agent",
          targetServerId: "ops",
          toolName: "restart_service",
        },
        {
          id: "t2-allow-admin-tool",
          label: t(`${PREFIX}.quick.t2AllowAdminTool`),
          agentId: "ops-admin-agent",
          targetServerId: "ops",
          toolName: "restart_service",
        },
      ];
    }
    return [];
  }, [activeTab, t]);

  const runQuickCase = useCallback(
    (preset: { agentId: string; targetServerId: string; toolName: string }) => {
      if (activeTab !== "tier1" && activeTab !== "tier2") return;
      setAgentId(preset.agentId);
      setTargetServerId(preset.targetServerId);
      setToolName(preset.toolName);
      void runOnce({
        agentId: preset.agentId,
        targetServerId: preset.targetServerId,
        activeTab,
        toolName: preset.toolName,
      });
    },
    [activeTab, runOnce]
  );

  const startContinuous = useCallback(async () => {
    setTrafficLoading(true);
    setTrafficError(null);
    try {
      const s = await startMcpControlTrafficSim(durationMinutes);
      setTrafficStatus(s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTrafficError(
        msg === "mcp_control_traffic_sim_already_running"
          ? t(`${PREFIX}.sim.alreadyRunning`)
          : msg
      );
      await refreshTrafficStatus();
    } finally {
      setTrafficLoading(false);
    }
  }, [durationMinutes, refreshTrafficStatus, t]);

  const stopContinuous = useCallback(async () => {
    setTrafficLoading(true);
    setTrafficError(null);
    try {
      const s = await stopMcpControlTrafficSim();
      setTrafficStatus(s);
      void checkHealth();
    } catch (e) {
      setTrafficError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrafficLoading(false);
    }
  }, [checkHealth]);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <p className="text-xs text-amber-200/80">{t(`${PREFIX}.identityNote`)}</p>

      <div className="inline-flex flex-wrap rounded-md border border-slate-700 p-1">
        <button
          type="button"
          onClick={() => setActiveTab("tier1")}
          className={`rounded px-3 py-1.5 text-xs ${
            activeTab === "tier1" ? "bg-cyan-600 text-white" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          {t(`${PREFIX}.tabs.tier1`)}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("tier2")}
          className={`rounded px-3 py-1.5 text-xs ${
            activeTab === "tier2" ? "bg-cyan-600 text-white" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          {t(`${PREFIX}.tabs.tier2`)}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("sim")}
          className={`rounded px-3 py-1.5 text-xs ${
            activeTab === "sim" ? "bg-cyan-600 text-white" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          {t(`${PREFIX}.tabs.sim`)}
        </button>
      </div>

      {isSimTab ? (
        <div className="space-y-4 rounded-lg border border-violet-700/40 bg-slate-950/60 p-4">
          <div>
            <p className="text-sm font-medium text-violet-300">{t(`${PREFIX}.sim.title`)}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              {t(`${PREFIX}.sim.intro`)}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-300">{t(`${PREFIX}.sim.casesTitle`)}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-400">
              {denyScenes.map((c) => (
                <li key={c.id}>{c.label}</li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[120px] text-xs text-slate-400">
              {t(`${PREFIX}.sim.durationMinutes`)}
              <input
                type="number"
                min={1}
                max={180}
                className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 10)}
                disabled={trafficRunning || trafficLoading}
              />
            </label>
            {trafficRunning ? (
              <button
                type="button"
                onClick={() => void stopContinuous()}
                disabled={trafficLoading}
                className="rounded-md border border-rose-500/60 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
              >
                {t(`${PREFIX}.sim.stop`)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void startContinuous()}
                disabled={!config || trafficLoading}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {t(`${PREFIX}.sim.start`)}
              </button>
            )}
            <a
              href={grafanaUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-cyan-500/60 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/20"
            >
              {t(`${PREFIX}.sim.openGrafana`)}
            </a>
          </div>
          <p className="text-xs text-slate-500">
            {t(`${PREFIX}.sim.linkHint`, { url: grafanaBaseUrl })}
          </p>

          {trafficStatus?.stats ? (
            <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">
              <span>
                {t(`${PREFIX}.sim.requests`)}: {trafficStatus.stats.requests}
              </span>
              <span>
                {t(`${PREFIX}.sim.denied`)}: {trafficStatus.stats.denied}
              </span>
              <span>
                {t(`${PREFIX}.sim.remaining`)}: {trafficStatus.remaining_seconds}s
              </span>
              {trafficStatus.stats.last_case_id ? (
                <span className="truncate font-mono">
                  {trafficStatus.stats.last_agent} → {trafficStatus.stats.last_target}
                  {trafficStatus.stats.last_tool ? ` / ${trafficStatus.stats.last_tool}` : ""} ·{" "}
                  {trafficStatus.stats.last_decision}
                  {trafficStatus.stats.last_http_status != null
                    ? ` (${trafficStatus.stats.last_http_status})`
                    : ""}
                </span>
              ) : null}
            </div>
          ) : null}

          {trafficStatus?.stats?.recent?.length ? (
            <div className="overflow-x-auto rounded border border-slate-700/70">
              <table className="min-w-full text-left text-xs text-slate-400">
                <thead className="bg-slate-900/80 text-slate-300">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">{t(`${PREFIX}.sim.table.time`)}</th>
                    <th className="px-2 py-1.5 font-medium">{t(`${PREFIX}.sim.table.case`)}</th>
                    <th className="px-2 py-1.5 font-medium">{t(`${PREFIX}.sim.table.decision`)}</th>
                    <th className="px-2 py-1.5 font-medium">{t(`${PREFIX}.sim.table.status`)}</th>
                  </tr>
                </thead>
                <tbody>
                  {trafficStatus.stats.recent.slice(0, 8).map((row, idx) => (
                    <tr key={`${row.at}-${idx}`} className="border-t border-slate-800">
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{row.at}</td>
                      <td className="px-2 py-1 font-mono">
                        {row.agent_id} → {row.target_server_id}
                        {row.tool_name ? ` / ${row.tool_name}` : ""}
                      </td>
                      <td className="px-2 py-1">{row.decision}</td>
                      <td className="px-2 py-1">{row.http_status ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {trafficError ? <p className="text-xs text-rose-400">{trafficError}</p> : null}
          {health ? <p className="text-xs text-slate-500">{health}</p> : null}
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs text-slate-400">
              {t(`${PREFIX}.labels.agent`)}
              <select
                className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                disabled={running || trafficRunning}
              >
                {(config?.agent_identities ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {t(`${PREFIX}.agents.${a.id}`, { defaultValue: a.label })}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-400">
              {t(`${PREFIX}.labels.target`)}
              <select
                className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                value={targetServerId}
                onChange={(e) => setTargetServerId(e.target.value)}
                disabled={running || trafficRunning}
              >
                {(config?.target_servers ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {t(`${PREFIX}.targets.${s.id}`, { defaultValue: s.label })}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {activeTab === "tier2" ? (
            <label className="block text-xs text-slate-400">
              {t(`${PREFIX}.labels.tool`)}
              <select
                className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
                disabled={running || trafficRunning}
              >
                {toolOptions.map((tool) => (
                  <option key={tool.id} value={tool.id}>
                    {tool.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {config?.default_vs ? (
            <p className="font-mono text-xs text-slate-500">
              VS {config.default_vs.host}:{config.default_vs.port}
              {config.token_mode ? ` · token_mode=${config.token_mode}` : ""}
              {config.oauth_token_url ? ` · Token ${config.oauth_token_url}` : ""}
            </p>
          ) : null}
          {health ? <p className="text-xs text-slate-500">{health}</p> : null}

          <div className="space-y-2 rounded border border-slate-700/70 bg-slate-900/40 p-2">
            <p className="text-xs text-slate-300">{t(`${PREFIX}.labels.quickTests`)}</p>
            <div className="flex flex-wrap gap-2">
              {quickCases.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={running || trafficRunning}
                  onClick={() => runQuickCase(preset)}
                  className="rounded border border-slate-600 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={running || trafficRunning || !config}
              onClick={() =>
                void runOnce({
                  agentId,
                  targetServerId,
                  activeTab,
                  toolName,
                })
              }
              className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {running ? t(`${PREFIX}.running`) : t(`${PREFIX}.runOnce`)}
            </button>
          </div>

          {result ? <McpControlResultTimeline result={result} /> : null}
        </>
      )}
    </div>
  );
}

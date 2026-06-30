import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrafanaConfig } from "@/utils/grafana";
import {
  fetchAgentRoutingConfig,
  fetchAgentTrafficStatus,
  runAgentRoutingDemo,
  startAgentTrafficSim,
  stopAgentTrafficSim,
  type AgentDemoResult,
  type AgentIdentityMode,
  type AgentIdentityModeSelector,
  type AgentRoutingConfig,
  type AgentTrafficStatus,
  type Target,
} from "@/api/client";
import { AgentResultCard } from "./AgentResultCard";

type NodeState = "idle" | "active" | "success" | "error";
type CardState = "pending" | "active" | "success" | "error";

const BASE_MODES: AgentIdentityMode[] = ["header", "system_name", "model_field"];
const MODE_OPTIONS: AgentIdentityModeSelector[] = [...BASE_MODES, "random"];

function poolShort(path: string): string {
  return path.replace("/Common/", "");
}

function pickRandomAgentModes(agentIds: string[]): Record<string, AgentIdentityMode> {
  const map: Record<string, AgentIdentityMode> = {};
  for (const id of agentIds) {
    map[id] = BASE_MODES[Math.floor(Math.random() * BASE_MODES.length)];
  }
  return map;
}

function hasAgentModeMap(map: Record<string, AgentIdentityMode> | null): boolean {
  return map != null && Object.keys(map).length > 0;
}

export function AgentRoutingDemo() {
  const { t } = useTranslation();
  const { openUrl: grafanaOpenUrl, baseUrl: grafanaBaseUrl } = useGrafanaConfig();
  const [config, setConfig] = useState<AgentRoutingConfig | null>(null);
  const [target, setTarget] = useState<Target>({ host: "172.16.30.121", port: 8000 });
  const [userPrompt, setUserPrompt] = useState("");
  const [identityMode, setIdentityMode] = useState<AgentIdentityModeSelector>("header");
  const [agentModeMap, setAgentModeMap] = useState<Record<string, AgentIdentityMode> | null>(
    null
  );
  const [running, setRunning] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [results, setResults] = useState<AgentDemoResult[]>([]);
  const [cardStates, setCardStates] = useState<CardState[]>([]);
  const [agentNodeStates, setAgentNodeStates] = useState<Record<string, NodeState>>({});
  const [poolNodeStates, setPoolNodeStates] = useState<Record<string, NodeState>>({});
  const [vsActive, setVsActive] = useState(false);
  const [flowAgentId, setFlowAgentId] = useState<string | null>(null);

  const [durationMinutes, setDurationMinutes] = useState(10);
  const [trafficStatus, setTrafficStatus] = useState<AgentTrafficStatus | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficError, setTrafficError] = useState<string | null>(null);

  const trafficRunning = trafficStatus?.running ?? false;
  const busy = running || trafficRunning;

  useEffect(() => {
    fetchAgentRoutingConfig()
      .then((c) => {
        setConfig(c);
        setTarget(c.default_vs);
        setUserPrompt(c.default_user_prompt);
        const idleAgents: Record<string, NodeState> = {};
        const idlePools: Record<string, NodeState> = {};
        for (const a of c.agents) {
          idleAgents[a.id] = "idle";
          idlePools[poolShort(a.expected_pool)] = "idle";
        }
        setAgentNodeStates(idleAgents);
        setPoolNodeStates(idlePools);
        setCardStates(c.agents.map(() => "pending" as CardState));
      })
      .catch(() => setGlobalError(t("agentRouting.loadFailed")));
  }, [t]);

  const refreshTrafficStatus = useCallback(async () => {
    try {
      const s = await fetchAgentTrafficStatus();
      setTrafficStatus(s);
      if (s.running && hasAgentModeMap(s.agent_identity_modes)) {
        setAgentModeMap(s.agent_identity_modes);
        if (s.identity_mode) {
          setIdentityMode(s.identity_mode);
        }
      }
    } catch {
      setTrafficStatus((prev) => prev ?? null);
    }
  }, []);

  useEffect(() => {
    refreshTrafficStatus();
  }, [refreshTrafficStatus]);

  useEffect(() => {
    const ms = trafficRunning ? 1000 : 5000;
    const id = window.setInterval(refreshTrafficStatus, ms);
    return () => window.clearInterval(id);
  }, [trafficRunning, refreshTrafficStatus]);

  const agents = config?.agents ?? [];

  const agentPoolRows = useMemo(
    () =>
      agents.map((a) => ({
        agentId: a.id,
        pool: poolShort(a.expected_pool),
      })),
    [agents]
  );

  const resetVisual = useCallback(() => {
    if (!config) return;
    const idleAgents: Record<string, NodeState> = {};
    const idlePools: Record<string, NodeState> = {};
    for (const a of config.agents) {
      idleAgents[a.id] = "idle";
      idlePools[poolShort(a.expected_pool)] = "idle";
    }
    setAgentNodeStates(idleAgents);
    setPoolNodeStates(idlePools);
    setVsActive(false);
    setFlowAgentId(null);
    setCardStates(config.agents.map(() => "pending"));
    setResults([]);
  }, [config]);

  const resolveModeMapForSession = useCallback((): Record<string, AgentIdentityMode> | undefined => {
    if (!config) return undefined;
    if (identityMode !== "random") return undefined;
    if (hasAgentModeMap(agentModeMap)) return agentModeMap!;
    const map = pickRandomAgentModes(config.agents.map((a) => a.id));
    setAgentModeMap(map);
    return map;
  }, [config, identityMode, agentModeMap]);

  const runWorkflow = useCallback(async () => {
    if (!config || !userPrompt.trim()) return;
    setRunning(true);
    setGlobalError(null);
    resetVisual();

    const modeMap = resolveModeMapForSession();

    try {
      for (let i = 0; i < config.agents.length; i++) {
        const agent = config.agents[i];
        setCardStates((prev) => {
          const next = [...prev];
          next[i] = "active";
          return next;
        });
        setAgentNodeStates((prev) => ({ ...prev, [agent.id]: "active" }));
        setVsActive(true);
        setFlowAgentId(agent.id);

        const partial = await runAgentRoutingDemo(
          target,
          identityMode,
          userPrompt.trim(),
          [agent.id],
          0,
          modeMap
        );
        if (hasAgentModeMap(partial.agent_identity_modes)) {
          setAgentModeMap(partial.agent_identity_modes);
        }
        const item = partial.results[0];
        if (!item) continue;

        setResults((prev) => [...prev, item]);
        const ok = item.proxy.error === null && item.proxy.status_code === 200;
        const poolKey = poolShort(agent.expected_pool);

        setAgentNodeStates((prev) => ({
          ...prev,
          [agent.id]: ok ? "success" : "error",
        }));
        setPoolNodeStates((prev) => ({
          ...prev,
          [poolKey]: ok ? "success" : "error",
        }));
        setCardStates((prev) => {
          const next = [...prev];
          next[i] = ok ? "success" : "error";
          return next;
        });

        await new Promise((r) => setTimeout(r, config.demo_interval_ms));
        setFlowAgentId(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(
        msg.includes("not allowed") || msg.includes("403")
          ? t("demo.forbiddenHost")
          : msg || t("demo.connectionFailed")
      );
    } finally {
      setVsActive(false);
      setFlowAgentId(null);
      setRunning(false);
    }
  }, [config, userPrompt, target, identityMode, resetVisual, resolveModeMapForSession, t]);

  const startContinuous = useCallback(async () => {
    if (!userPrompt.trim()) return;
    setTrafficLoading(true);
    setTrafficError(null);
    if (identityMode === "random") {
      setAgentModeMap(null);
      resolveModeMapForSession();
    }
    try {
      const s = await startAgentTrafficSim(
        target,
        identityMode,
        userPrompt.trim(),
        durationMinutes
      );
      setTrafficStatus(s);
      if (s.agent_identity_modes) {
        setAgentModeMap(s.agent_identity_modes);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTrafficError(
        msg.includes("not allowed") || msg.includes("403")
          ? t("demo.forbiddenHost")
          : msg === "agent_traffic_sim_already_running"
            ? t("agentRouting.continuous.alreadyRunning")
            : msg || t("demo.connectionFailed")
      );
      await refreshTrafficStatus();
    } finally {
      setTrafficLoading(false);
    }
  }, [
    userPrompt,
    target,
    identityMode,
    durationMinutes,
    resolveModeMapForSession,
    refreshTrafficStatus,
    t,
  ]);

  const stopContinuous = useCallback(async () => {
    setTrafficLoading(true);
    setTrafficError(null);
    try {
      const s = await stopAgentTrafficSim();
      setTrafficStatus(s);
    } catch (e) {
      setTrafficError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrafficLoading(false);
    }
  }, []);

  const onIdentityModeChange = (mode: AgentIdentityModeSelector) => {
    setIdentityMode(mode);
    if (mode !== "random") {
      setAgentModeMap(null);
    }
  };

  const trafficStats = trafficStatus?.stats;

  const nodeClass = (state: NodeState, kind: "agent" | "pool" | "vs") => {
    if (state === "active") {
      return kind === "agent"
        ? "agent-node-breathe border-cyan-400 bg-cyan-950/50 text-cyan-100 shadow-cyan-500/30"
        : "border-cyan-400 bg-cyan-950/40 text-cyan-200 animate-pulse";
    }
    if (state === "success") {
      return "border-emerald-500/60 bg-emerald-950/40 text-emerald-200";
    }
    if (state === "error") {
      return "border-red-500/50 bg-red-950/30 text-red-300";
    }
    return "border-slate-600/80 bg-slate-900/50 text-slate-400";
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              {t("agentRouting.userPrompt")}
            </label>
            <textarea
              className="input-field min-h-[72px] resize-y"
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              disabled={busy}
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
              {t("agentRouting.identityMode")}
            </p>
            <div className="space-y-2">
              {MODE_OPTIONS.map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    identityMode === mode
                      ? "border-cyan-500/50 bg-cyan-950/30 text-cyan-100"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  <input
                    type="radio"
                    name="identityMode"
                    className="mt-1"
                    checked={identityMode === mode}
                    onChange={() => onIdentityModeChange(mode)}
                    disabled={busy}
                  />
                  <span>
                    <span className="font-medium">{t(`agentRouting.modes.${mode}`)}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {t(`agentRouting.modes.${mode}Hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {identityMode === "random" && hasAgentModeMap(agentModeMap) && (
              <ul className="mt-2 space-y-1 rounded-lg border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
                <li className="font-medium text-slate-300">
                  {t("agentRouting.perAgentModeTitle")}
                </li>
                {agents.map((a) => (
                  <li key={a.id} className="font-mono">
                    {a.id} → {t(`agentRouting.modes.${agentModeMap?.[a.id] ?? "header"}`)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">{t("demo.host")}</label>
              <input
                className="input-field font-mono"
                value={target.host}
                onChange={(e) => setTarget((x) => ({ ...x, host: e.target.value }))}
                disabled={busy}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">{t("demo.port")}</label>
              <input
                className="input-field font-mono"
                type="number"
                value={target.port}
                onChange={(e) =>
                  setTarget((x) => ({ ...x, port: parseInt(e.target.value, 10) || 8000 }))
                }
                disabled={busy}
              />
            </div>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={runWorkflow}
            disabled={busy || !config || !userPrompt.trim()}
          >
            {running ? t("agentRouting.running") : t("agentRouting.startDev")}
          </button>
          {globalError && <p className="text-sm text-red-400">{globalError}</p>}

          <div className="rounded-lg border border-violet-700/40 bg-slate-900/60 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium text-violet-300">
                {t("agentRouting.continuous.title")}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {t("agentRouting.continuous.subtitle")}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[120px]">
                <label className="mb-1 block text-xs text-slate-500">
                  {t("agentRouting.continuous.durationMinutes")}
                </label>
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  max={180}
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 10)}
                  disabled={busy}
                />
              </div>
              {trafficRunning ? (
                <button
                  type="button"
                  className="btn-stop"
                  onClick={stopContinuous}
                  disabled={trafficLoading}
                >
                  {t("agentRouting.continuous.stop")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={startContinuous}
                  disabled={busy || !userPrompt.trim() || trafficLoading}
                >
                  {t("agentRouting.continuous.start")}
                </button>
              )}
              <a
                href={grafanaOpenUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/20"
              >
                {t("agentRouting.continuous.openGrafana")}
              </a>
            </div>
            <p className="text-xs text-slate-400">
              {t("agentRouting.continuous.linkHint", { url: grafanaBaseUrl })}
            </p>
            {trafficRunning && trafficStats && (
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">
                <span>
                  {t("agentRouting.continuous.sent")}: {trafficStats.sent}
                </span>
                <span>
                  {t("agentRouting.continuous.errors")}: {trafficStats.error_total}
                </span>
                <span>
                  {t("agentRouting.continuous.remaining")}:{" "}
                  {trafficStatus?.remaining_seconds ?? 0}s
                </span>
                {trafficStats.last_agent_id && (
                  <span className="font-mono truncate">
                    {t("agentRouting.continuous.lastAgent")}: {trafficStats.last_agent_id}
                  </span>
                )}
              </div>
            )}
            {trafficError && <p className="text-xs text-rose-400">{trafficError}</p>}
          </div>
        </div>

        <div className="glass-card overflow-hidden p-4">
          <p className="mb-3 text-xs font-semibold uppercase text-cyan-400/90">
            {t("agentRouting.topologyTitle")}
          </p>
          <div className="relative grid grid-cols-[1fr_auto_1fr] items-stretch gap-2 min-h-[320px]">
            <div className="flex flex-col justify-between gap-2 py-1">
              {agentPoolRows.map(({ agentId }) => (
                <div
                  key={agentId}
                  className={`relative rounded-lg border px-2 py-2 text-center text-xs transition-all duration-300 ${nodeClass(
                    agentNodeStates[agentId] ?? "idle",
                    "agent"
                  )}`}
                >
                  {t(`agentRouting.agents.${agentId}`)}
                </div>
              ))}
            </div>

            <div className="relative flex w-32 flex-col justify-between gap-2 py-1">
              {agentPoolRows.map(({ agentId, pool }) => (
                <div key={`link-${agentId}`} className="relative z-0 flex h-12 items-center">
                  <div
                    className={`h-px w-full border-t border-dashed transition-colors duration-300 ${
                      flowAgentId === agentId || agentNodeStates[agentId] === "active"
                        ? "border-cyan-400"
                        : "border-slate-600"
                    }`}
                  />
                  {flowAgentId === agentId && (
                    <span className="agent-flow-dot absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-lg shadow-cyan-400/80" />
                  )}
                  <div
                    className={`pointer-events-none absolute right-0 top-1/2 h-px w-8 -translate-y-1/2 border-t border-dashed ${
                      poolNodeStates[pool] === "success" || flowAgentId === agentId
                        ? "border-emerald-500/70"
                        : "border-slate-600"
                    }`}
                  />
                </div>
              ))}
              <div
                className={`pointer-events-none absolute left-1/2 top-1/2 z-10 w-[92%] -translate-x-1/2 -translate-y-1/2 rounded-lg border px-2 py-3 text-center text-xs font-semibold shadow-lg transition-all duration-300 ${nodeClass(
                  vsActive || trafficRunning ? "active" : "idle",
                  "vs"
                )}`}
              >
                F5 VS
                <div className="mt-1 font-mono text-[10px] font-normal text-slate-400">
                  {target.host}:{target.port}
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between gap-2 py-1">
              {agentPoolRows.map(({ pool }) => (
                <div
                  key={pool}
                  className={`rounded-lg border px-2 py-2 text-center text-xs transition-all duration-300 ${nodeClass(
                    poolNodeStates[pool] ?? "idle",
                    "pool"
                  )}`}
                >
                  {pool}
                  {poolNodeStates[pool] === "success" && (
                    <span className="mt-1 block text-[10px] text-emerald-400/90">
                      {t("agentRouting.poolHit")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">{t("agentRouting.topologyHint")}</p>
        </div>
      </div>

      {agents.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a, i) => {
            const result = results.find((r) => r.agent_id === a.id);
            const effectiveMode =
              result?.identity_mode ??
              agentModeMap?.[a.id] ??
              (identityMode === "random" ? "header" : identityMode);
            const placeholder: AgentDemoResult = {
              agent_id: a.id,
              label_key: a.label_key,
              label: a.id,
              identity_mode: effectiveMode,
              request_model: config?.enterprise_model ?? "",
              expected_pool: a.expected_pool,
              expected_model: a.expected_model,
              expected_status: 200,
              proxy: {
                status_code: 0,
                headers: {},
                body: null,
                elapsed_ms: 0,
                error: null,
              },
            };
            return (
              <AgentResultCard
                key={a.id}
                result={result ?? placeholder}
                state={cardStates[i] ?? "pending"}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

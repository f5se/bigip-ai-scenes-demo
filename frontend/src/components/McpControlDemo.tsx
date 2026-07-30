import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchMcpControlConfig,
  fetchMcpControlHealth,
  runMcpControl,
  type McpControlConfig,
  type McpControlRunResult,
} from "@/api/client";
import { McpControlResultTimeline } from "./McpControlResultTimeline";

const PREFIX = "scenes.mcpToolsControl";

type DemoTab = "tier1" | "tier2";
type RunParams = {
  agentId: string;
  targetServerId: string;
  activeTab: DemoTab;
  toolName: string;
};

export function McpControlDemo() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<McpControlConfig | null>(null);
  const [activeTab, setActiveTab] = useState<DemoTab>("tier1");
  const [agentId, setAgentId] = useState("ops-admin-agent");
  const [targetServerId, setTargetServerId] = useState("ops");
  const [toolName, setToolName] = useState("query_alert");
  const [result, setResult] = useState<McpControlRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);

  const toolOptions = useMemo(
    () => [
      { id: "query_alert", label: t(`${PREFIX}.tools.queryAlert`) },
      { id: "restart_service", label: t(`${PREFIX}.tools.restartService`) },
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

  const runOnce = useCallback(async (params: RunParams) => {
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
  }, [checkHealth]);

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
  }, [activeTab, t]);

  const runQuickCase = useCallback(
    (preset: { agentId: string; targetServerId: string; toolName: string }) => {
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

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <p className="text-xs text-amber-200/80">{t(`${PREFIX}.identityNote`)}</p>

      <div className="inline-flex rounded-md border border-slate-700 p-1">
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
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-xs text-slate-400">
          {t(`${PREFIX}.labels.agent`)}
          <select
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={running}
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
            disabled={running}
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
            disabled={running}
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
              disabled={running}
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
          disabled={running || !config}
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
    </div>
  );
}

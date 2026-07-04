import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGrafanaConfig } from "@/utils/grafana";
import {
  fetchMcpInsightConfig,
  fetchMcpInsightHealth,
  type McpInsightConfig,
  type McpStreamEvent,
} from "@/api/client";
import { McpMessageTimeline } from "./McpMessageTimeline";

export function McpInsightDemo() {
  const { t } = useTranslation();
  const { openUrl: grafanaUrl } = useGrafanaConfig();
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

  useEffect(() => {
    fetchMcpInsightConfig()
      .then((c) => {
        setConfig(c);
        const vs = c.default_vs as { host: string; port: number };
        setHost(vs.host);
        setPort(vs.port);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const h = await fetchMcpInsightHealth(host, port);
      const mcp = h.mcp_server.ok ? "MCP OK" : "MCP down";
      const ad = h.adapter.ok ? "Adapter OK" : "Adapter down";
      setHealth(`${mcp} · ${ad}`);
    } catch {
      setHealth("health check failed");
    }
  }, [host, port]);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  const runStream = useCallback(
  async (scenarioId: string) => {
    if (!config) {
      setError("配置加载中，请稍候再运行");
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

    const es = new EventSource(`/api/demo/mcp-insight/run-stream?${params.toString()}`);

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
        setError(data.error ?? "stream error");
      } catch {
        setError("MCP session failed — is MCP Server running on " + host + ":" + port + "?");
      }
      es.close();
      setSessionComplete(true);
      setRunning(false);
    });
  },
  [agent, tenant, host, port, checkHealth, config]);

  const f5AuditMode =
    config?.audit_delivery === "f5" || config?.emit_audit_without_f5 === false;
  const adapterUrl =
    auditSummary?.adapter_url ??
    (config?.adapter_events_url as string | undefined) ??
    "http://127.0.0.1:8090/api/mcp-events";
  const showAuditPanel =
    !f5AuditMode && (running || sessionComplete || auditSummary !== null);

  const scenarios = (config?.scenarios as { id: string; label: string }[]) ?? [];

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-slate-400">
          Agent
          <select
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            disabled={running}
          >
            {((config?.agent_options as { id: string; label: string }[]) ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          Tenant
          <select
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={tenant}
            onChange={(e) => setTenant(e.target.value)}
            disabled={running}
          >
            {((config?.tenant_options as { id: string; label: string }[]) ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          MCP Host
          <input
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={running}
          />
        </label>
        <label className="block text-xs text-slate-400">
          Port
          <input
            type="number"
            className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm"
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
            disabled={running}
          />
        </label>
      </div>

      {health ? <p className="text-xs text-slate-500">{health}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={running || !config}
          onClick={() => void runStream("full")}
          className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {t("scenes.mcpToolsInsight.runFull", { defaultValue: "▶ 运行完整 MCP 会话" })}
        </button>
        <a
          href={grafanaUrl}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-cyan-500/60 px-4 py-2 text-sm text-cyan-300 hover:bg-cyan-500/10"
        >
          {t("scenes.mcpToolsInsight.openGrafana", { defaultValue: "📊 Grafana" })}
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        {scenarios
          .filter((s) => s.id !== "full")
          .map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={running || !config}
              onClick={() => void runStream(s.id)}
              className={`rounded border px-2 py-1 text-xs ${
                scenario === s.id
                  ? "border-cyan-500 bg-cyan-500/20 text-cyan-200"
                  : "border-slate-600 text-slate-400 hover:border-slate-500"
              }`}
            >
              {s.label}
            </button>
          ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <McpMessageTimeline events={events} running={running} />
        <div className="rounded-lg border border-cyan-800/40 bg-slate-950/60 p-3 text-sm">
          <p className="mb-2 font-medium text-cyan-300">
            {t("scenes.mcpToolsInsight.statsTitle", { defaultValue: "会话统计" })}
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
              {t("scenes.mcpToolsInsight.statsEmpty", { defaultValue: "完成后显示统计" })}
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
                {t("scenes.mcpToolsInsight.auditTitle", { defaultValue: "Adapter 审计日志" })}
              </p>
              {running && !auditSummary ? (
                <p className="mt-1 font-mono animate-pulse">
                  {t("scenes.mcpToolsInsight.auditPosting", { defaultValue: "投递中…" })}
                </p>
              ) : auditSummary ? (
                <p className="mt-1 font-mono">
                  {auditSummary.accepted}/{auditSummary.total}{" "}
                  {t("scenes.mcpToolsInsight.auditDelivered", { defaultValue: "条已投递" })}
                  {auditSummary.failed > 0
                    ? ` · ${auditSummary.failed} ${t("scenes.mcpToolsInsight.auditFailed", { defaultValue: "条失败" })}`
                    : ""}
                </p>
              ) : sessionComplete ? (
                <p className="mt-1 font-mono text-slate-400">
                  {t("scenes.mcpToolsInsight.auditNone", { defaultValue: "0 条（未启用或未投递）" })}
                </p>
              ) : null}
              <p className="mt-1 truncate text-[10px] opacity-80">{adapterUrl}</p>
              {auditSummary && auditSummary.failed > 0 ? (
                <p className="mt-1 text-[10px] opacity-90">
                  {t("scenes.mcpToolsInsight.auditFailedHint", {
                    defaultValue:
                      "请确认 Demo 后端 (8080) 能访问 Adapter，并查看后端终端 [mcp_audit] 错误",
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
          {!f5AuditMode ? (
            <p className="mt-4 text-xs text-slate-500">
              {t("scenes.mcpToolsInsight.auditHint", {
                defaultValue:
                  "无 F5 时由 Demo 后端模拟审计日志并 POST 至 Adapter；接入 F5 后将 emit_audit_without_f5 设为 false。",
              })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

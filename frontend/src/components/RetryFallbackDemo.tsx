import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchRetryFallbackConfig,
  fetchRetryStatusCounter,
  formatProxyError,
  runRetryStatusDemo,
  runTcpForceFallbackDemo,
  prepareTcpReselectDemo,
  runTcpReselectDemo,
  summarizeResponse,
  type RetryFallbackMember,
  type RetryStatusResult,
  type Target,
  type TcpForceFallbackResult,
  type TcpReselectResult,
} from "@/api/client";
import {
  RetryFallbackFlowCanvas,
  type FlowPhase,
  type FlowScenario,
  type ReplayData,
} from "@/components/RetryFallbackFlowCanvas";

type ScenarioId = "status" | "tcp-reselect" | "tcp-fallback";

function panelToScenario(panel: ScenarioId): FlowScenario {
  if (panel === "status") return "status-retry";
  if (panel === "tcp-reselect") return "tcp-reselect";
  return "tcp-fallback";
}

function ScenarioSection({
  title,
  expanded,
  running,
  summary,
  hasResult,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  running?: boolean;
  summary?: string;
  hasResult?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`rounded-lg border transition-colors ${
        expanded
          ? "border-cyan-600/50 bg-slate-900/70 shadow-sm shadow-cyan-950/40"
          : "border-slate-800 bg-slate-900/35"
      }`}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 p-4 text-left"
        onClick={onToggle}
      >
        <span className="mt-0.5 shrink-0 text-slate-500">{expanded ? "▼" : "▶"}</span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-sm font-medium leading-snug ${
              expanded ? "text-cyan-300" : "text-slate-400"
            }`}
          >
            {title}
          </span>
          {!expanded && hasResult && summary && (
            <span className="mt-1 block text-xs text-slate-500 line-clamp-2">{summary}</span>
          )}
          {!expanded && !hasResult && (
            <span className="mt-1 block text-xs text-slate-600">{t("retryFallback.empty")}</span>
          )}
          {running && (
            <span className="mt-1 block text-xs text-cyan-400">{t("status.active")}</span>
          )}
        </span>
      </button>
      {expanded && <div className="border-t border-slate-800 px-4 pb-4 pt-3">{children}</div>}
    </div>
  );
}

function MemberTable({
  title,
  members,
}: {
  title: string;
  members: RetryFallbackMember[];
}) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <p className="mb-2 text-xs font-semibold text-slate-400">{title}</p>
      <div className="space-y-1 text-xs text-slate-300">
        {members.map((m) => (
          <div key={m.fullPath ?? `${m.name}-${m.address}`} className="rounded bg-slate-950/60 p-2">
            <code className="text-cyan-400">{m.name ?? "unknown"}</code>
            <span className="ml-2 text-slate-500">session:</span> {m.session ?? "-"}
            <span className="ml-2 text-slate-500">state:</span> {m.state ?? "-"}
          </div>
        ))}
      </div>
    </div>
  );
}

export function RetryFallbackDemo() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<Target>({ host: "172.16.30.122", port: 8000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Awaited<ReturnType<typeof fetchRetryFallbackConfig>> | null>(
    null
  );
  const [statusRetry, setStatusRetry] = useState<RetryStatusResult | null>(null);
  const [statusCounter, setStatusCounter] = useState<{
    member: string;
    total: number | null;
    key: string | null;
  } | null>(null);
  const [tcpReselect, setTcpReselect] = useState<TcpReselectResult | null>(null);
  const [tcpFallback, setTcpFallback] = useState<TcpForceFallbackResult | null>(null);
  const [stabilityWait, setStabilityWait] = useState(false);
  const [expandedScenario, setExpandedScenario] = useState<ScenarioId | null>("status");
  const [runningPanel, setRunningPanel] = useState<ScenarioId | null>(null);
  const [statusFlowPhase, setStatusFlowPhase] = useState<FlowPhase>("idle");
  const [tcpReselectFlowPhase, setTcpReselectFlowPhase] = useState<FlowPhase>("idle");
  const [tcpFallbackFlowPhase, setTcpFallbackFlowPhase] = useState<FlowPhase>("idle");

  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchRetryFallbackConfig()
      .then((c) => {
        setCfg(c);
        setTarget(c.default_vs);
        return fetchRetryStatusCounter();
      })
      .then((c) => {
        setStatusCounter({
          member: c.member,
          total: c.stats.total_requests,
          key: c.stats.primary_key ?? null,
        });
      })
      .catch(() => setError("Failed to load retry/fallback config"));
  }, []);

  function focusScenario(id: ScenarioId) {
    setExpandedScenario(id);
    canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleScenario(id: ScenarioId) {
    setExpandedScenario((prev) => (prev === id ? null : id));
    canvasRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function refreshStatusCounter() {
    try {
      const c = await fetchRetryStatusCounter();
      setStatusCounter({
        member: c.member,
        total: c.stats.total_requests,
        key: c.stats.primary_key ?? null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }

  const fmtError = (msg: string | null | undefined) =>
    formatProxyError(msg ?? null, t) || msg || "";

  async function runStatusCase() {
    focusScenario("status");
    setRunningPanel("status");
    setStatusFlowPhase("running");
    setBusy(true);
    setError(null);
    setStatusRetry(null);
    try {
      const data = await runRetryStatusDemo(target);
      setStatusRetry(data);
      setStatusCounter({
        member: data.member,
        total: data.member_stats.after.total_requests,
        key: data.member_stats.compared_key ?? data.member_stats.after.primary_key ?? null,
      });
      setStatusFlowPhase("replay");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("forbidden") ? t("demo.forbiddenHost") : msg);
      setStatusFlowPhase("error");
    } finally {
      setRunningPanel(null);
      setBusy(false);
    }
  }

  async function runTcpReselectCase() {
    focusScenario("tcp-reselect");
    setRunningPanel("tcp-reselect");
    setTcpReselectFlowPhase("running");
    setBusy(true);
    setError(null);
    setTcpReselect(null);
    setStabilityWait(false);
    try {
      const prep = await prepareTcpReselectDemo();
      if (prep.stability_wait_seconds > 0) {
        setStabilityWait(true);
        await new Promise((r) => setTimeout(r, prep.stability_wait_seconds * 1000));
        setStabilityWait(false);
      }
      const data = await runTcpReselectDemo(target);
      setTcpReselect(data);
      setTcpReselectFlowPhase("replay");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("forbidden") ? t("demo.forbiddenHost") : msg);
      setTcpReselectFlowPhase("error");
    } finally {
      setStabilityWait(false);
      setRunningPanel(null);
      setBusy(false);
    }
  }

  async function runTcpFallbackCase() {
    focusScenario("tcp-fallback");
    setRunningPanel("tcp-fallback");
    setTcpFallbackFlowPhase("running");
    setBusy(true);
    setError(null);
    setTcpFallback(null);
    try {
      const data = await runTcpForceFallbackDemo(target);
      setTcpFallback(data);
      setTcpFallbackFlowPhase("replay");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("forbidden") ? t("demo.forbiddenHost") : msg);
      setTcpFallbackFlowPhase("error");
    } finally {
      setRunningPanel(null);
      setBusy(false);
    }
  }

  const statusSummary = useMemo(() => {
    if (!statusRetry) return "";
    if (statusRetry.result.terminal_retry) {
      return t("retryFallback.status.retryTerminalHit");
    }
    if (statusRetry.result.fallback_to_default) {
      return t("retryFallback.status.fallbackToDefault");
    }
    return t("retryFallback.status.unexpected");
  }, [statusRetry, t]);

  const tcpReselectSummary = useMemo(() => {
    if (!tcpReselect) return "";
    return t("retryFallback.tcp.expectedPort", {
      port: tcpReselect.result.expected_server_port,
    });
  }, [tcpReselect, t]);

  const tcpFallbackSummary = useMemo(() => {
    if (!tcpFallback) return "";
    if (tcpFallback.result.fallback_to_default) {
      return t("retryFallback.tcp.fallbackToDefault");
    }
    if (tcpFallback.result.terminal_retry) {
      return t("retryFallback.tcp.terminalFallback");
    }
    return t("retryFallback.status.unexpected");
  }, [tcpFallback, t]);

  const activeScenario: FlowScenario = panelToScenario(
    runningPanel ?? expandedScenario ?? "status"
  );

  const activeFlowPhase: FlowPhase =
    activeScenario === "status-retry"
      ? statusFlowPhase
      : activeScenario === "tcp-reselect"
        ? tcpReselectFlowPhase
        : tcpFallbackFlowPhase;

  const replayData: ReplayData = useMemo(() => {
    if (activeScenario === "status-retry") return statusRetry;
    if (activeScenario === "tcp-reselect") return tcpReselect;
    return tcpFallback;
  }, [activeScenario, statusRetry, tcpReselect, tcpFallback]);

  const onReplayComplete = () => {
    if (activeScenario === "status-retry") setStatusFlowPhase("done");
    else if (activeScenario === "tcp-reselect") setTcpReselectFlowPhase("done");
    else setTcpFallbackFlowPhase("done");
  };

  return (
    <div className="space-y-4">
      <div
        ref={canvasRef}
        className="sticky top-2 z-10 -mx-1 px-1 pb-1 backdrop-blur-sm"
      >
        <RetryFallbackFlowCanvas
          scenario={activeScenario}
          phase={activeFlowPhase}
          target={target}
          config={cfg}
          replayData={replayData}
          onReplayComplete={onReplayComplete}
        />
      </div>

      <p className="text-xs text-slate-500">{t("retryFallback.scenarioCollapseHint")}</p>

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div>
          <label className="mb-1 block text-xs text-slate-500">{t("demo.host")}</label>
          <input
            className="input-field font-mono"
            value={target.host}
            disabled={busy}
            onChange={(e) => setTarget((x) => ({ ...x, host: e.target.value }))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-500">{t("demo.port")}</label>
          <input
            className="input-field font-mono"
            type="number"
            value={target.port}
            disabled={busy}
            onChange={(e) =>
              setTarget((x) => ({ ...x, port: parseInt(e.target.value, 10) || 8000 }))
            }
          />
        </div>
      </div>

      {cfg && (
        <div className="rounded-lg border border-cyan-700/30 bg-cyan-950/15 p-3 text-xs text-slate-300">
          <p>
            F5 MGMT: <code>{cfg.f5_mgmt.host}</code> / partition{" "}
            <code>{cfg.f5_mgmt.partition}</code>
          </p>
          <p className="mt-1 text-slate-400">{t("retryFallback.hintAutoPrepare")}</p>
        </div>
      )}

      <div className="space-y-2">
        <ScenarioSection
          title={t("retryFallback.status.title")}
          expanded={expandedScenario === "status"}
          running={runningPanel === "status"}
          hasResult={statusRetry != null}
          summary={statusSummary}
          onToggle={() => toggleScenario("status")}
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-400">{t("retryFallback.status.desc")}</p>
            <div className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">
              <p className="text-slate-400">
                {t("retryFallback.status.currentCounter", {
                  member: statusCounter?.member ?? "ubuntu-ai:8008",
                })}
              </p>
              <p className="mt-1 font-mono">
                {statusCounter?.total ?? "-"}
                {statusCounter?.key ? ` (${statusCounter.key})` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-secondary" disabled={busy} onClick={refreshStatusCounter}>
                {t("retryFallback.actions.refreshCounter")}
              </button>
              <button className="btn-primary" disabled={busy} onClick={runStatusCase}>
                {t("retryFallback.actions.runStatusRetry")}
              </button>
            </div>
            {statusRetry && (
              <div className="space-y-2 rounded-lg border border-slate-700/80 bg-slate-950/40 p-3 text-sm">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  {t("retryFallback.status.result")}
                </p>
                <p
                  className={
                    statusRetry.result.as_expected
                      ? "text-emerald-400 font-medium"
                      : "text-amber-400"
                  }
                >
                  {statusSummary}
                </p>
                <div className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">
                  <p className="text-slate-400">
                    {t("retryFallback.status.memberRequestCounter", {
                      member: statusRetry.member,
                    })}
                  </p>
                  <p className="mt-1 font-mono">
                    before: {statusRetry.member_stats.before.total_requests ?? "-"} / after:{" "}
                    {statusRetry.member_stats.after.total_requests ?? "-"} / delta:{" "}
                    <span
                      className={
                        (statusRetry.member_stats.delta_requests ?? 0) > 0
                          ? "text-emerald-400 font-semibold"
                          : "text-amber-400"
                      }
                    >
                      {statusRetry.member_stats.delta_requests ?? "-"}
                    </span>
                  </p>
                </div>
                <p className="text-xs text-slate-400">
                  HTTP {statusRetry.proxy.status_code} / {fmtError(statusRetry.proxy.error)}
                </p>
                <p className="rounded bg-slate-950/70 p-2 text-xs text-slate-300 whitespace-pre-wrap">
                  {summarizeResponse(statusRetry.proxy.body)}
                </p>
                {(statusRetry.result.fallback_to_default || statusRetry.result.terminal_retry) && (
                  <div className="rounded border border-violet-500/40 bg-violet-950/30 p-2 text-xs text-violet-200">
                    {t("retryFallback.status.highlightFallback", {
                      member: statusRetry.member,
                      delta: statusRetry.member_stats.delta_requests ?? 0,
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScenarioSection>

        <ScenarioSection
          title={t("retryFallback.tcp.caseReselectTitle")}
          expanded={expandedScenario === "tcp-reselect"}
          running={runningPanel === "tcp-reselect"}
          hasResult={tcpReselect != null}
          summary={tcpReselectSummary}
          onToggle={() => toggleScenario("tcp-reselect")}
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-400">{t("retryFallback.tcp.caseReselectDesc")}</p>
            <p className="text-xs text-slate-500">{t("retryFallback.tcp.caseReselectExpected")}</p>
            {stabilityWait && (
              <p className="rounded border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                {t("retryFallback.tcp.stabilityWait")}
              </p>
            )}
            <button className="btn-secondary" disabled={busy} onClick={runTcpReselectCase}>
              {t("retryFallback.actions.runTcpReselect")}
            </button>
            {tcpReselect && (
              <div className="space-y-3 rounded-lg border border-slate-700/80 bg-slate-950/40 p-3 text-sm">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  {t("retryFallback.tcp.reselectResult")}
                </p>
                <p
                  className={
                    tcpReselect.result.all_requests_on_expected_port
                      ? "text-emerald-400 text-sm font-medium"
                      : "text-amber-400 text-sm"
                  }
                >
                  {tcpReselectSummary}
                </p>
                <div className="grid gap-2">
                  {tcpReselect.attempts.map((a, i) => (
                    <div key={i} className="rounded bg-slate-950/70 p-2 text-xs text-slate-300">
                      <p>
                        #{a.attempt ?? i + 1} status={a.status_code} server_port=
                        {a.server_port ?? "-"}{" "}
                        {a.error ? `error=${fmtError(a.error)}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
                <MemberTable
                  title={t("retryFallback.tcp.memberStateBefore")}
                  members={tcpReselect.before.tcp_pool_members}
                />
              </div>
            )}
          </div>
        </ScenarioSection>

        <ScenarioSection
          title={t("retryFallback.tcp.caseFallbackTitle")}
          expanded={expandedScenario === "tcp-fallback"}
          running={runningPanel === "tcp-fallback"}
          hasResult={tcpFallback != null}
          summary={tcpFallbackSummary}
          onToggle={() => toggleScenario("tcp-fallback")}
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-400">{t("retryFallback.tcp.caseFallbackDesc")}</p>
            <p className="text-xs text-slate-500">{t("retryFallback.tcp.caseFallbackExpected")}</p>
            <button className="btn-primary" disabled={busy} onClick={runTcpFallbackCase}>
              {t("retryFallback.actions.forceOfflineAndRun")}
            </button>
            {tcpFallback && (
              <div className="space-y-3 rounded-lg border border-slate-700/80 bg-slate-950/40 p-3 text-sm">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  {t("retryFallback.tcp.fallbackResult")}
                </p>
                <p
                  className={
                    tcpFallback.result.as_expected
                      ? "text-emerald-400 text-sm font-medium"
                      : "text-amber-400 text-sm"
                  }
                >
                  {tcpFallbackSummary}
                </p>
                <p className="rounded bg-slate-950/70 p-2 text-xs text-slate-300 whitespace-pre-wrap">
                  {summarizeResponse(tcpFallback.proxy.body)}
                </p>
                <MemberTable
                  title={t("retryFallback.tcp.memberStateAfter")}
                  members={tcpFallback.after.tcp_pool_members}
                />
              </div>
            )}
          </div>
        </ScenarioSection>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}

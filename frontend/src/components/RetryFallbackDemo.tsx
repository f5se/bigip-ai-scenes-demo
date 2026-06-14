import { useEffect, useMemo, useState, type ReactNode } from "react";
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

type ResultPanelId = "status" | "tcp-reselect" | "tcp-fallback";

function ResultPanel({
  title,
  active,
  hasResult,
  running,
  summary,
  onToggle,
  children,
}: {
  title: string;
  active: boolean;
  hasResult: boolean;
  running?: boolean;
  summary?: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`rounded-lg border transition-colors ${
        active
          ? "border-cyan-600/50 bg-slate-900/70 shadow-sm shadow-cyan-950/40"
          : "border-slate-800 bg-slate-900/35"
      }`}
    >
      <button
        type="button"
        className="flex w-full items-start gap-2 p-4 text-left"
        onClick={onToggle}
      >
        <span className="mt-0.5 shrink-0 text-slate-500">{active ? "▼" : "▶"}</span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-xs uppercase tracking-wide ${
              active ? "text-cyan-400" : "text-slate-500"
            }`}
          >
            {title}
          </span>
          {!active && hasResult && summary && (
            <span className="mt-1 block truncate text-sm text-slate-400">{summary}</span>
          )}
          {!active && !hasResult && (
            <span className="mt-1 block text-xs text-slate-600">{t("retryFallback.empty")}</span>
          )}
          {running && (
            <span className="mt-1 block text-xs text-cyan-400">{t("status.active")}</span>
          )}
        </span>
      </button>
      {active && <div className="border-t border-slate-800 px-4 pb-4 pt-2">{children}</div>}
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
  const [activePanel, setActivePanel] = useState<ResultPanelId | null>(null);
  const [runningPanel, setRunningPanel] = useState<ResultPanelId | null>(null);

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
    setActivePanel("status");
    setRunningPanel("status");
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("forbidden") ? t("demo.forbiddenHost") : msg);
    } finally {
      setRunningPanel(null);
      setBusy(false);
    }
  }

  async function runTcpReselectCase() {
    setActivePanel("tcp-reselect");
    setRunningPanel("tcp-reselect");
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("forbidden") ? t("demo.forbiddenHost") : msg);
    } finally {
      setStabilityWait(false);
      setRunningPanel(null);
      setBusy(false);
    }
  }

  async function runTcpFallbackCase() {
    setActivePanel("tcp-fallback");
    setRunningPanel("tcp-fallback");
    setBusy(true);
    setError(null);
    setTcpFallback(null);
    try {
      const data = await runTcpForceFallbackDemo(target);
      setTcpFallback(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("forbidden") ? t("demo.forbiddenHost") : msg);
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

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">{t("demo.targetVs")}</h3>
        <div className="grid grid-cols-2 gap-3">
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
              F5 MGMT: <code>{cfg.f5_mgmt.host}</code> / partition <code>{cfg.f5_mgmt.partition}</code>
            </p>
            <p className="mt-1 text-slate-400">{t("retryFallback.hintAutoPrepare")}</p>
          </div>
        )}

        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
          <p className="text-sm font-medium text-cyan-400">{t("retryFallback.status.title")}</p>
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
          <button className="btn-secondary" disabled={busy} onClick={refreshStatusCounter}>
            {t("retryFallback.actions.refreshCounter")}
          </button>
          <button className="btn-primary" disabled={busy} onClick={runStatusCase}>
            {t("retryFallback.actions.runStatusRetry")}
          </button>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
          <p className="text-sm font-medium text-cyan-400">{t("retryFallback.tcp.title")}</p>
          <p className="text-xs text-slate-400">{t("retryFallback.tcp.desc")}</p>
          <div className="rounded border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
            <p className="font-medium text-cyan-300">{t("retryFallback.tcp.caseReselectTitle")}</p>
            <p className="mt-1 text-slate-400">{t("retryFallback.tcp.caseReselectDesc")}</p>
            <p className="mt-1 text-slate-500">{t("retryFallback.tcp.caseReselectExpected")}</p>
          </div>
          <div className="rounded border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-300">
            <p className="font-medium text-cyan-300">{t("retryFallback.tcp.caseFallbackTitle")}</p>
            <p className="mt-1 text-slate-400">{t("retryFallback.tcp.caseFallbackDesc")}</p>
            <p className="mt-1 text-slate-500">{t("retryFallback.tcp.caseFallbackExpected")}</p>
          </div>
          {stabilityWait && (
            <p className="rounded border border-amber-600/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
              {t("retryFallback.tcp.stabilityWait")}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" disabled={busy} onClick={runTcpReselectCase}>
              {t("retryFallback.actions.runTcpReselect")}
            </button>
            <button className="btn-primary" disabled={busy} onClick={runTcpFallbackCase}>
              {t("retryFallback.actions.forceOfflineAndRun")}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="space-y-2">
        <ResultPanel
          title={t("retryFallback.status.result")}
          active={activePanel === "status"}
          hasResult={statusRetry != null}
          running={runningPanel === "status"}
          summary={statusSummary}
          onToggle={() => setActivePanel("status")}
        >
          {statusRetry ? (
            <div className="space-y-2 text-sm">
              <p
                className={
                  statusRetry.result.as_expected ? "text-emerald-400 font-medium" : "text-amber-400"
                }
              >
                {statusSummary}
              </p>
              <div className="rounded border border-slate-700 bg-slate-950/60 p-2 text-xs text-slate-300">
                <p className="text-slate-400">
                  {t("retryFallback.status.memberRequestCounter", { member: statusRetry.member })}
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
                {statusRetry.member_stats.compared_key && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    key: {statusRetry.member_stats.compared_key}
                  </p>
                )}
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
          ) : (
            <p className="text-xs text-slate-500">{t("retryFallback.empty")}</p>
          )}
        </ResultPanel>

        <ResultPanel
          title={t("retryFallback.tcp.reselectResult")}
          active={activePanel === "tcp-reselect"}
          hasResult={tcpReselect != null}
          running={runningPanel === "tcp-reselect"}
          summary={tcpReselectSummary}
          onToggle={() => setActivePanel("tcp-reselect")}
        >
          {tcpReselect ? (
            <div className="space-y-3">
              <p
                className={
                  tcpReselect.result.all_requests_on_expected_port
                    ? "text-emerald-400 text-sm font-medium"
                    : "text-amber-400 text-sm"
                }
              >
                {tcpReselectSummary}
              </p>
              {(tcpReselect.result.missing_port_attempts?.length ?? 0) > 0 && (
                <p className="text-xs text-amber-300">
                  {t("retryFallback.debug.missingPort", {
                    attempts: tcpReselect.result.missing_port_attempts?.join(", ") ?? "",
                    ports: (tcpReselect.result.observed_ports ?? []).join(", ") || "-",
                  })}
                </p>
              )}
              <div className="grid gap-2">
                {tcpReselect.attempts.map((a, i) => (
                  <div key={i} className="rounded bg-slate-950/70 p-2 text-xs text-slate-300">
                    <p>
                      #{a.attempt ?? i + 1} status={a.status_code} server_port=
                      {a.server_port ?? "-"}{" "}
                      {a.routed_to_default_pool ? (
                        <span className="text-amber-400">→ default_pool</span>
                      ) : null}{" "}
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
          ) : (
            <p className="text-xs text-slate-500">{t("retryFallback.empty")}</p>
          )}
        </ResultPanel>

        <ResultPanel
          title={t("retryFallback.tcp.fallbackResult")}
          active={activePanel === "tcp-fallback"}
          hasResult={tcpFallback != null}
          running={runningPanel === "tcp-fallback"}
          summary={tcpFallbackSummary}
          onToggle={() => setActivePanel("tcp-fallback")}
        >
          {tcpFallback ? (
            <div className="space-y-3">
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
          ) : (
            <p className="text-xs text-slate-500">{t("retryFallback.empty")}</p>
          )}
        </ResultPanel>
      </div>
    </div>
  );
}


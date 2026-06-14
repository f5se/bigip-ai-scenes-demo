import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TblbModelResult } from "@/api/client";

type CardState = "pending" | "active" | "success" | "error";

type Props = {
  result: TblbModelResult;
  state: CardState;
  compact?: boolean;
};

const MODEL_REWRITE_AUTO_COLLAPSE_MS = 10000;

const PORT_BAR_COLORS = [
  "bg-cyan-500/70",
  "bg-emerald-500/70",
  "bg-violet-500/70",
  "bg-amber-500/70",
  "bg-rose-500/70",
  "bg-sky-500/70",
];

export function TblbResultCard({ result, state, compact = false }: Props) {
  const { t } = useTranslation();
  const [rewritePanelOpen, setRewritePanelOpen] = useState(false);
  const rewriteCollapseTimerRef = useRef<number | null>(null);
  const done = state !== "pending" && state !== "active";
  const hasErrors = done && result.errors > 0;
  const allFailed = done && result.success === 0 && result.total > 0;

  const statusLabel =
    state === "pending"
      ? t("status.pending")
      : state === "active"
        ? t("status.active")
        : allFailed
          ? t("status.error")
          : t("status.success");

  const borderClass =
    state === "active"
      ? "border-cyan-400 animate-pulse"
      : allFailed
        ? "border-red-500/40"
        : hasErrors
          ? "border-amber-500/40"
          : done
            ? "border-emerald-500/40"
            : "border-slate-700";

  const progressPct =
    result.total > 0 ? Math.round((result.completed / result.total) * 100) : 0;

  const modelRewritten =
    result.model_rewritten === true && !!result.response_model;

  useEffect(() => {
    if (!modelRewritten) {
      setRewritePanelOpen(false);
      return;
    }
    setRewritePanelOpen(true);
    if (rewriteCollapseTimerRef.current !== null) {
      window.clearTimeout(rewriteCollapseTimerRef.current);
    }
    rewriteCollapseTimerRef.current = window.setTimeout(() => {
      setRewritePanelOpen(false);
      rewriteCollapseTimerRef.current = null;
    }, MODEL_REWRITE_AUTO_COLLAPSE_MS);

    return () => {
      if (rewriteCollapseTimerRef.current !== null) {
        window.clearTimeout(rewriteCollapseTimerRef.current);
      }
    };
  }, [modelRewritten, result.model, result.response_model]);

  const cardBorderClass = modelRewritten
    ? "border-violet-500/70 ring-1 ring-violet-500/40"
    : borderClass;

  return (
    <div className={`rounded-lg border bg-slate-900/60 p-4 ${cardBorderClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-medium text-white">
            <code className="text-cyan-400">{result.model}</code>
          </h4>
          {!compact && (
            <p className="mt-1 text-xs text-slate-500">
              {t("app.expectedPool")}:{" "}
              <code className="text-slate-300">{result.pool_short}</code>
              <span className="mx-2 text-slate-600">·</span>
              {result.tblb_enabled ? (
                <span className="text-emerald-400">{t("tblbDemo.tblbEnabled")}</span>
              ) : (
                <span className="text-slate-400">{t("tblbDemo.tblbDisabled")}</span>
              )}
            </p>
          )}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            state === "active"
              ? "bg-cyan-900/50 text-cyan-300"
              : allFailed
                ? "bg-red-900/40 text-red-400"
                : done
                  ? hasErrors
                    ? "bg-amber-900/40 text-amber-400"
                    : "bg-emerald-900/40 text-emerald-400"
                  : "bg-slate-800 text-slate-500"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {modelRewritten && result.response_model && (
        <div className="mt-3 rounded-lg border border-violet-500/50 bg-violet-950/50 p-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setRewritePanelOpen((open) => !open)}
          >
            <p className="text-sm font-semibold text-violet-300">{t("modelRewrite.title")}</p>
            <span className="shrink-0 text-xs text-slate-500">
              {rewritePanelOpen
                ? t("tblbDemo.triggerEndpointsCollapse")
                : t("tblbDemo.triggerEndpointsExpand")}
            </span>
          </button>
          {rewritePanelOpen && (
            <>
              <p className="mt-1 text-xs text-violet-200/90">{t("tblbDemo.modelRewriteApplied")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-500">{t("modelRewrite.request")}</span>
                <code className="rounded bg-slate-900 px-2 py-0.5 font-mono text-amber-300">
                  {result.model}
                </code>
                <span className="text-violet-400" aria-hidden>
                  →
                </span>
                <span className="text-slate-500">{t("modelRewrite.response")}</span>
                <code className="rounded bg-violet-900/80 px-2 py-0.5 font-mono font-semibold text-violet-100 ring-2 ring-violet-400/80">
                  {result.response_model}
                </code>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{t("modelRewrite.hint")}</p>
            </>
          )}
        </div>
      )}

      {state !== "pending" && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-500">
              {t("tblbDemo.progress")}:{" "}
              <span className="font-mono text-slate-200">
                {result.completed}/{result.total}
              </span>
            </span>
            <span className="text-slate-500">
              {t("tblbDemo.successCount")}:{" "}
              <span className="font-mono text-emerald-400">{result.success}</span>
            </span>
            <span className="text-slate-500">
              {t("tblbDemo.errorCount")}:{" "}
              <span className="font-mono text-red-400">{result.errors}</span>
            </span>
          </div>

          {state === "active" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-cyan-500 transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {result.port_distribution.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-slate-400">
            {t("tblbDemo.actualDistribution")}
          </p>
          <div className="space-y-2">
            {result.port_distribution.map((row, i) => (
              <div key={row.port}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-300">
                    {row.port === "unknown"
                      ? t("tblbDemo.portUnknown")
                      : row.port === "error"
                        ? t("tblbDemo.portError")
                        : t("tblbDemo.portLabel", { port: row.port })}
                  </span>
                  <span className="text-slate-500">
                    {row.percent}% ({row.count})
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${PORT_BAR_COLORS[i % PORT_BAR_COLORS.length]}`}
                    style={{ width: `${Math.max(row.percent, row.count > 0 ? 2 : 0)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {done && result.success > 0 && result.port_distribution.length === 0 && (
        <p className="mt-3 text-xs text-amber-400">{t("tblbDemo.noPortData")}</p>
      )}
    </div>
  );
}

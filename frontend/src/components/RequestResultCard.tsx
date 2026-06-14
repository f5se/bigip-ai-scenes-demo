import { Fragment, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DemoCaseResult } from "@/api/client";
import {
  detectModelRewrite,
  formatProxyError,
  summarizeResponse,
} from "@/api/client";

type Props = {
  result: DemoCaseResult;
  state: "pending" | "active" | "success" | "error";
};

function highlightModelInSummary(
  text: string,
  requestModel: string,
  responseModel: string
): ReactNode {
  if (!text.includes(responseModel) && !text.includes(requestModel)) {
    return text;
  }
  const pattern = new RegExp(
    `(${escapeRegExp(responseModel)}|${escapeRegExp(requestModel)})`,
    "g"
  );
  const parts = text.split(pattern).filter(Boolean);
  return parts.map((part, i) => {
    if (part === responseModel) {
      return (
        <mark
          key={i}
          className="rounded bg-violet-500/40 px-0.5 font-semibold text-violet-100"
        >
          {part}
        </mark>
      );
    }
    if (part === requestModel) {
      return (
        <mark
          key={i}
          className="rounded bg-amber-500/20 px-0.5 text-amber-200 line-through decoration-amber-400/80"
        >
          {part}
        </mark>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveCardLabel(
  result: DemoCaseResult,
  t: (key: string) => string,
  i18nExists: (key: string) => boolean
): string {
  if (result.label_key && i18nExists(result.label_key)) {
    return t(result.label_key);
  }
  return result.label || result.model;
}

export function RequestResultCard({ result, state }: Props) {
  const { t, i18n } = useTranslation();
  const displayLabel = resolveCardLabel(result, t, i18n.exists.bind(i18n));
  const [showRaw, setShowRaw] = useState(false);
  const { proxy } = result;
  const ok =
    proxy.error === null &&
    proxy.status_code === result.expected_status;
  const summary = proxy.body
    ? summarizeResponse(proxy.body)
    : formatProxyError(proxy.error, t);

  const { rewritten: modelRewritten, responseModel } =
    state !== "pending"
      ? detectModelRewrite(result.model, proxy.body, proxy.status_code)
      : { rewritten: false, responseModel: null };

  const statusLabel =
    state === "pending"
      ? t("status.pending")
      : state === "active"
        ? t("status.active")
        : ok
          ? t("status.success")
          : t("status.error");

  const borderClass =
    state === "active"
      ? "border-cyan-400 animate-pulse"
      : modelRewritten
        ? "border-violet-500/70 ring-1 ring-violet-500/40"
        : ok
          ? "border-emerald-500/40"
          : state === "pending"
            ? "border-slate-700"
            : "border-red-500/40";

  return (
    <div className={`rounded-lg border bg-slate-900/60 p-4 ${borderClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-medium text-white">
            <span>{displayLabel}</span>
            {displayLabel !== result.model && (
              <>
                {" "}
                — <code className="text-cyan-400">{result.model}</code>
              </>
            )}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {t("app.expectedPool")}:{" "}
            <code className="text-slate-300">{result.expected_pool}</code>
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            state === "active"
              ? "bg-cyan-900/50 text-cyan-300"
              : ok
                ? "bg-emerald-900/40 text-emerald-400"
                : state === "pending"
                  ? "bg-slate-800 text-slate-500"
                  : "bg-red-900/40 text-red-400"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      {state !== "pending" && modelRewritten && responseModel && (
        <div className="mt-3 rounded-lg border border-violet-500/50 bg-violet-950/50 p-3">
          <p className="text-sm font-semibold text-violet-300">
            {t("modelRewrite.title")}
          </p>
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
              {responseModel}
            </code>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            {t("modelRewrite.hint")}
          </p>
        </div>
      )}

      {state !== "pending" && (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-slate-500">{t("app.status")}: </span>
            <span className="font-mono text-slate-200">
              {proxy.status_code || "—"}
            </span>
          </div>
          <div>
            <span className="text-slate-500">{t("app.elapsed")}: </span>
            <span className="font-mono text-slate-200">{proxy.elapsed_ms} ms</span>
          </div>
        </div>
      )}

      {state !== "pending" && summary && (
        <p
          className={`mt-3 rounded p-3 text-sm whitespace-pre-wrap ${
            modelRewritten
              ? "border border-violet-500/30 bg-violet-950/30 text-slate-200"
              : "bg-slate-950/80 text-slate-300"
          }`}
        >
          <span className="text-slate-500">{t("app.responseSummary")}: </span>
          {modelRewritten && responseModel ? (
            <>
              {highlightModelInSummary(summary, result.model, responseModel)}
            </>
          ) : (
            summary
          )}
        </p>
      )}

      {state !== "pending" && proxy.body != null && (
        <>
          <button
            type="button"
            className="mt-2 text-xs text-cyan-500 hover:text-cyan-400"
            onClick={() => setShowRaw((s) => !s)}
          >
            {t("app.rawJson")}
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {JSON.stringify(proxy.body, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

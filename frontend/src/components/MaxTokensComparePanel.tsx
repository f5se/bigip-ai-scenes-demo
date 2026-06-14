import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProxyResult, Target } from "@/api/client";
import {
  formatProxyError,
  isMaxTokensBlocked,
  summarizeResponse,
} from "@/api/client";

export type MaxTokensCompareCase = {
  id: string;
  labelKey: string;
  max_tokens: number;
  expectedAction: "allow" | "block";
  requestPayload: Record<string, unknown>;
  proxy: ProxyResult | null;
  state: "pending" | "active" | "success" | "error";
};

type Props = {
  target: Target;
  demoModel: string;
  limit: number;
  cases: MaxTokensCompareCase[];
  compareOk: boolean | null;
};

export function MaxTokensComparePanel({
  target,
  demoModel,
  limit,
  cases,
  compareOk,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-700/80 bg-slate-900/40 px-3 py-2 text-center text-xs text-slate-400">
        {t("maxTokensDemo.compareHint", { host: target.host, port: target.port, model: demoModel })}
      </div>

      {compareOk === false && (
        <p className="text-xs text-amber-400">{t("maxTokensDemo.mismatchHint")}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {cases.map((c) => (
          <CompareCard key={c.id} target={target} limit={limit} caseData={c} />
        ))}
      </div>
    </div>
  );
}

function CompareCard({
  target,
  limit,
  caseData,
}: {
  target: Target;
  limit: number;
  caseData: MaxTokensCompareCase;
}) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  const { proxy, state, max_tokens, expectedAction } = caseData;
  const blocked =
    proxy !== null && state !== "pending" && isMaxTokensBlocked(proxy.body, proxy.status_code);
  const allowed =
    proxy !== null &&
    state !== "pending" &&
    !blocked &&
    proxy.error === null &&
    proxy.status_code >= 200 &&
    proxy.status_code < 300;
  const expectedBlocked = expectedAction === "block";
  const ok =
    proxy !== null &&
    state !== "pending" &&
    state !== "active" &&
    (expectedBlocked ? blocked : allowed);

  const summary = proxy?.body
    ? summarizeResponse(proxy.body)
    : proxy
      ? formatProxyError(proxy.error, t)
      : "—";

  const borderClass =
    state === "active"
      ? "border-cyan-400 animate-pulse"
      : blocked
        ? "border-rose-500/60 ring-1 ring-rose-500/30"
        : ok
          ? "border-emerald-500/40"
          : state === "pending"
            ? "border-slate-700"
            : "border-red-500/40";

  const requestUrl = `http://${target.host}:${target.port}/v1/chat/completions`;

  return (
    <div className={`rounded-lg border bg-slate-900/60 p-4 ${borderClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-medium text-white">{t(caseData.labelKey)}</h4>
          <p className="mt-1 font-mono text-xs text-cyan-400">
            max_tokens={max_tokens.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500">
            {t("maxTokensDemo.expectedAction")}:{" "}
            <span className={expectedBlocked ? "text-rose-400" : "text-emerald-400"}>
              {expectedAction}
            </span>
            {" · "}
            {t("maxTokensDemo.limitRef", { limit: limit.toLocaleString() })}
          </p>
        </div>
        {proxy && state !== "pending" && (
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              ok
                ? "bg-emerald-500/20 text-emerald-300"
                : state === "active"
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "bg-red-500/20 text-red-300"
            }`}
          >
            {ok ? t("status.success") : state === "active" ? t("status.active") : t("status.error")}
          </span>
        )}
      </div>

      {state === "pending" && (
        <p className="mt-4 text-sm text-slate-500">{t("maxTokensDemo.cardPending")}</p>
      )}

      {proxy && state !== "pending" && (
        <>
          {blocked && (
            <div className="mt-3 rounded-lg border border-rose-500/50 bg-rose-950/40 p-3">
              <p className="text-sm font-semibold text-rose-300">
                {t("maxTokensDemo.resultBlocked")}
              </p>
              <p className="mt-1 text-xs text-slate-400">{t("maxTokensDemo.blockedHint")}</p>
            </div>
          )}

          {allowed && (
            <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3">
              <p className="text-sm font-semibold text-emerald-300">
                {t("maxTokensDemo.resultAllowed")}
              </p>
              <p className="mt-1 text-xs text-slate-400">{t("maxTokensDemo.allowedHint")}</p>
            </div>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-slate-500">{t("app.status")}</dt>
              <dd className="font-mono text-slate-200">{proxy.status_code || "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">{t("app.elapsed")}</dt>
              <dd className="font-mono text-slate-200">{proxy.elapsed_ms} ms</dd>
            </div>
          </dl>

          <div className="mt-3 rounded bg-slate-950/80 p-2">
            <p className="text-xs text-slate-500">{t("app.responseSummary")}</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-300">{summary}</p>
          </div>

          <div className="mt-3 space-y-2">
            <button
              type="button"
              className="text-xs text-cyan-500 hover:text-cyan-400"
              onClick={() => setShowRequest((v) => !v)}
            >
              {showRequest ? t("app.hideSource") : t("maxTokensDemo.showRequest")}
            </button>
            {showRequest && (
              <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 font-mono text-xs text-slate-400">
                {`POST ${requestUrl}\n${JSON.stringify(
                  (proxy.sent_payload as Record<string, unknown> | undefined) ??
                    caseData.requestPayload,
                  null,
                  2
                )}`}
              </pre>
            )}
            <button
              type="button"
              className="text-xs text-cyan-500 hover:text-cyan-400"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? t("app.hideSource") : t("app.rawJson")}
            </button>
            {showRaw && (
              <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 font-mono text-xs text-slate-400">
                {JSON.stringify(proxy.body ?? { error: proxy.error }, null, 2)}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}

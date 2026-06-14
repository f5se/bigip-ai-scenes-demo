import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProxyResult, Target } from "@/api/client";
import {
  formatProxyError,
  isModelPolicyBlocked,
  summarizeResponse,
} from "@/api/client";

type Props = {
  model: string;
  expectedAction: "allow" | "block";
  target: Target;
  requestPayload: Record<string, unknown>;
  proxy: ProxyResult;
  state: "pending" | "active" | "success" | "error";
};

export function ModelAllowlistResultCard({
  model,
  expectedAction,
  target,
  requestPayload,
  proxy,
  state,
}: Props) {
  const { t } = useTranslation();
  const [showRawRequest, setShowRawRequest] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const requestUrl = `http://${target.host}:${target.port}/v1/chat/completions`;

  const blocked = state !== "pending" && isModelPolicyBlocked(proxy.body, proxy.status_code);
  const allowed = state !== "pending" && !blocked && proxy.error === null;
  const expectedBlocked = expectedAction === "block";
  const ok =
    state !== "pending" &&
    (expectedBlocked ? blocked : allowed && proxy.status_code >= 200 && proxy.status_code < 300);

  const summary = proxy.body
    ? summarizeResponse(proxy.body)
    : formatProxyError(proxy.error, t);

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
      : blocked
        ? "border-rose-500/60 ring-1 ring-rose-500/30"
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
            {blocked
              ? t("modelAllowlistDemo.resultBlocked")
              : t("modelAllowlistDemo.resultAllowed")}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {t("modelAllowlistDemo.modelLabel")}:{" "}
            <code className="text-cyan-400">{model}</code>
          </p>
          <p className="text-xs text-slate-500">
            {t("modelAllowlistDemo.expectedAction")}:{" "}
            <span className={expectedBlocked ? "text-rose-400" : "text-emerald-400"}>
              {expectedAction}
            </span>
          </p>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${
            ok
              ? "bg-emerald-500/20 text-emerald-300"
              : state === "active"
                ? "bg-cyan-500/20 text-cyan-300"
                : "bg-red-500/20 text-red-300"
          }`}
        >
          {statusLabel}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
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

      {!ok && state !== "pending" && state !== "active" && (
        <p className="mt-2 text-xs text-amber-400">{t("modelAllowlistDemo.mismatchHint")}</p>
      )}

      <div className="mt-3 space-y-2">
        <button
          type="button"
          className="text-xs text-cyan-500 hover:text-cyan-400"
          onClick={() => setShowRawRequest((v) => !v)}
        >
          {showRawRequest ? t("app.hideSource") : t("modelAllowlistDemo.showRequest")}
        </button>
        {showRawRequest && (
          <pre className="max-h-48 overflow-auto rounded bg-slate-950 p-2 font-mono text-xs text-slate-400">
            {`POST ${requestUrl}\n${JSON.stringify(requestPayload, null, 2)}`}
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
          <pre className="max-h-48 overflow-auto rounded bg-slate-950 p-2 font-mono text-xs text-slate-400">
            {JSON.stringify(proxy.body ?? { error: proxy.error }, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

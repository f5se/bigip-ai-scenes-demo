import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProxyResult, Target } from "@/api/client";
import {
  formatProxyError,
  isGuardrailBlocked,
  isStreamResponse,
  summarizeResponse,
} from "@/api/client";

export type GuardrailPromptKind = "blocked" | "allowed";

type Props = {
  promptKind: GuardrailPromptKind;
  promptText: string;
  model: string;
  target: Target;
  requestPayload: Record<string, unknown>;
  proxy: ProxyResult;
  state: "pending" | "active" | "success" | "error";
};

export function GuardrailResultCard({
  promptKind,
  promptText,
  model,
  target,
  requestPayload,
  proxy,
  state,
}: Props) {
  const { t } = useTranslation();
  const [showRawRequest, setShowRawRequest] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const requestUrl = `http://${target.host}:${target.port}/v1/chat/completions`;

  const blocked = state !== "pending" && isGuardrailBlocked(proxy.body);
  const streamed =
    state !== "pending" && proxy.error === null && isStreamResponse(proxy.body);
  const expectedBlocked = promptKind === "blocked";
  const ok =
    state !== "pending" &&
    proxy.status_code === 200 &&
    (expectedBlocked ? blocked : !blocked && proxy.error === null);

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
            {expectedBlocked
              ? t("guardrailDemo.promptBlocked")
              : t("guardrailDemo.promptAllowed")}
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {t("guardrailDemo.model")}: <code className="text-cyan-400">{model}</code>
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

      <p className="mt-3 rounded bg-slate-950/80 p-3 text-sm text-slate-300">
        <span className="text-slate-500">{t("guardrailDemo.userPrompt")}: </span>
        {promptText}
      </p>

      {state !== "pending" && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-cyan-500 hover:text-cyan-400"
            onClick={() => setShowRawRequest((s) => !s)}
          >
            {showRawRequest
              ? t("guardrailDemo.hideRawRequest")
              : t("guardrailDemo.showRawRequest")}
          </button>
          {showRawRequest && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {`POST ${requestUrl}\nContent-Type: application/json\n\n${JSON.stringify(requestPayload, null, 2)}`}
            </pre>
          )}
        </div>
      )}

      {state !== "pending" && blocked && (
        <div className="mt-3 rounded-lg border border-rose-500/50 bg-rose-950/40 p-3">
          <p className="text-sm font-semibold text-rose-300">
            {t("guardrailDemo.blockedTitle")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {t("guardrailDemo.blockedHint")}
          </p>
        </div>
      )}

      {state !== "pending" && !blocked && proxy.status_code === 200 && (
        <div className="mt-3 rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-3">
          <p className="text-sm font-semibold text-emerald-300">
            {t("guardrailDemo.passedTitle")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {streamed ? t("guardrailDemo.passedStreamHint") : t("guardrailDemo.passedHint")}
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
          {streamed && (
            <div>
              <span className="text-slate-500">{t("guardrailDemo.streamChunks")}: </span>
              <span className="font-mono text-slate-200">
                {(proxy.body as { chunk_count?: number })?.chunk_count ?? 0}
              </span>
            </div>
          )}
        </div>
      )}

      {state !== "pending" && summary && (
        <p className="mt-3 rounded bg-slate-950/80 p-3 text-sm whitespace-pre-wrap text-slate-300">
          <span className="text-slate-500">{t("app.responseSummary")}: </span>
          {summary}
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

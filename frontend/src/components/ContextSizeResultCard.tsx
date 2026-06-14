import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextProxyBundle, ContextSizeRule } from "@/api/client";
import {
  extractResponseModel,
  formatProxyError,
  summarizeResponse,
} from "@/api/client";
import { inferTierFromResponse } from "@/utils/contextSize";

type Props = {
  result: ContextProxyBundle;
  rule: ContextSizeRule;
  state: "pending" | "active" | "success" | "error";
  title?: string;
};

export function ContextSizeResultCard({
  result,
  rule,
  state,
  title,
}: Props) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  const { proxy, route, messages_bytes } = result;
  const threshold = rule.threshold_bytes;

  const responseModel =
    state !== "pending" && proxy.body
      ? extractResponseModel(proxy.body)
      : null;
  const actualTier = inferTierFromResponse(
    responseModel,
    rule.small_model,
    rule.large_model
  );
  const isLarge = route.tier === "large";
  const switched =
    state !== "pending" && actualTier !== "unknown" && actualTier === "large";

  const pct = Math.min(100, Math.round((messages_bytes / threshold) * 100));

  const borderClass =
    state === "active"
      ? "border-cyan-400 animate-pulse"
      : isLarge
        ? "border-orange-500/70 ring-1 ring-orange-500/40"
        : state !== "pending" && route.tier === "small"
          ? "border-emerald-500/50"
          : state === "pending"
            ? "border-slate-700"
            : "border-red-500/40";

  const summary =
    proxy.body != null
      ? summarizeResponse(proxy.body)
      : formatProxyError(proxy.error, t);

  const cardTitle =
    title ??
    (result.label_key ? t(result.label_key) : t("contextSize.result"));

  const [showChat, setShowChat] = useState(false);

  return (
    <div className={`rounded-lg border bg-slate-900/60 p-4 ${borderClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-medium text-white">{cardTitle}</h4>
          {result.trigger && (
            <p className="mt-1 text-xs text-slate-500">{t(result.trigger)}</p>
          )}
          {result.dialogue_rounds != null && (
            <p className="mt-0.5 text-xs text-cyan-600/80">
              {t("contextSize.dialogueRounds", { count: result.dialogue_rounds })}
              {result.message_count != null &&
                ` · ${t("contextSize.messageCount", { count: result.message_count })}`}
            </p>
          )}
        </div>
        {state !== "pending" && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              isLarge
                ? "bg-orange-900/50 text-orange-300"
                : "bg-emerald-900/40 text-emerald-400"
            }`}
          >
            {isLarge
              ? t("contextSize.tierLarge")
              : t("contextSize.tierSmall")}
          </span>
        )}
      </div>

      {result.conversation_preview && result.conversation_preview.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="text-xs text-cyan-500 hover:text-cyan-400"
            onClick={() => setShowChat((s) => !s)}
          >
            {showChat ? t("contextSize.hideChat") : t("contextSize.showChat")}
          </button>
          {showChat && (
            <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/80 p-2">
              {result.conversation_preview.map((m, i) => (
                <li key={i} className="text-xs">
                  <span
                    className={`font-medium ${
                      m.role === "user"
                        ? "text-cyan-400"
                        : m.role === "assistant"
                          ? "text-violet-400"
                          : "text-slate-500"
                    }`}
                  >
                    {m.role === "user"
                      ? t("contextSize.roleUser")
                      : m.role === "assistant"
                        ? t("contextSize.roleAssistant")
                        : t("contextSize.roleSystem")}
                    :
                  </span>{" "}
                  <span className="text-slate-400">{m.preview}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>{t("contextSize.messagesBytes")}</span>
          <span className="font-mono">
            {messages_bytes} / {threshold} B ({rule.threshold_k}k)
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full transition-all ${
              messages_bytes > threshold ? "bg-orange-500" : "bg-emerald-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {messages_bytes > threshold
            ? t("contextSize.overExplain")
            : t("contextSize.underExplain")}
        </p>
      </div>

      {state !== "pending" && (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            isLarge
              ? "border-orange-500/40 bg-orange-950/40"
              : "border-emerald-500/30 bg-emerald-950/30"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("contextSize.expectedRoute")}
          </p>
          <p className="mt-1 font-mono text-sm text-slate-200">
            Pool:{" "}
            <code className="text-cyan-300">{route.expected_pool}</code>
          </p>
          <p className="mt-0.5 font-mono text-sm text-slate-200">
            Model:{" "}
            <code
              className={
                isLarge ? "text-orange-300 font-semibold" : "text-emerald-300"
              }
            >
              {route.expected_model}
            </code>
          </p>
        </div>
      )}

      {state !== "pending" && responseModel && (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            switched
              ? "border-orange-500/60 bg-orange-950/50 ring-1 ring-orange-400/50"
              : "border-slate-600 bg-slate-950/50"
          }`}
        >
          <p className="text-sm font-semibold text-orange-300">
            {switched
              ? t("contextSize.switchedTitle")
              : t("contextSize.responseModel")}
          </p>
          <p className="mt-1 font-mono text-sm">
            <code className="rounded bg-orange-900/60 px-2 py-0.5 text-orange-100">
              {responseModel}
            </code>
          </p>
          {result.turns != null && (
            <p className="mt-1 text-xs text-slate-500">
              {t("contextSize.turnCount", { count: result.turns })}
            </p>
          )}
        </div>
      )}

      {state !== "pending" && (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-slate-500">{t("app.status")}: </span>
            <span className="font-mono">{proxy.status_code || "—"}</span>
          </div>
          <div>
            <span className="text-slate-500">{t("app.elapsed")}: </span>
            <span className="font-mono">{proxy.elapsed_ms} ms</span>
          </div>
        </div>
      )}

      {state !== "pending" && summary && (
        <p className="mt-3 rounded bg-slate-950/80 p-3 text-sm text-slate-300 whitespace-pre-wrap">
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
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {JSON.stringify(proxy.body, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

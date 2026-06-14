import { useTranslation } from "react-i18next";
import {
  analyzeSystemPromptResponse,
  extractAssistantContent,
  type ProxyResult,
  type SystemPromptPreset,
  type Target,
} from "@/api/client";

type CardState = "pending" | "active" | "success" | "error";

type Props = {
  preset: SystemPromptPreset;
  target: Target;
  requestPayload: Record<string, unknown>;
  proxy: ProxyResult;
  state: CardState;
};

export function SystemPromptResultCard({
  preset,
  target,
  requestPayload,
  proxy,
  state,
}: Props) {
  const { t } = useTranslation();
  const content = extractAssistantContent(proxy.body);
  const analysis = analyzeSystemPromptResponse(content);
  const yamlOk = preset.expects_yaml ? analysis.yaml_like : true;
  const injectionOk = preset.expects_injection_contained
    ? analysis.injection_contained
    : true;
  const pass = state === "success" && yamlOk && injectionOk && proxy.error === null;

  return (
    <div
      className={`rounded-lg border p-4 ${
        pass
          ? "border-emerald-500/40 bg-emerald-950/20"
          : state === "error"
            ? "border-rose-500/40 bg-rose-950/20"
            : "border-slate-700 bg-slate-900/40"
      }`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold text-white">{t("systemPromptDemo.resultTitle")}</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            pass ? "bg-emerald-600/30 text-emerald-300" : "bg-rose-600/30 text-rose-300"
          }`}
        >
          {pass ? t("systemPromptDemo.resultPass") : t("systemPromptDemo.resultFail")}
        </span>
      </div>

      <dl className="space-y-1 text-xs text-slate-400">
        <div>
          <span className="text-slate-500">{t("demo.host")}: </span>
          <code>
            {target.host}:{target.port}
          </code>
        </div>
        <div>
          <span className="text-slate-500">HTTP: </span>
          <code>{proxy.status_code}</code>
          <span className="ml-2 text-slate-500">{proxy.elapsed_ms}ms</span>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge ok={analysis.yaml_like} label={t("systemPromptDemo.badgeYaml")} />
        <Badge ok={analysis.policy_applied} label={t("systemPromptDemo.badgePolicy")} />
        {preset.expects_injection_contained && (
          <Badge ok={analysis.injection_contained} label={t("systemPromptDemo.badgeInjection")} />
        )}
      </div>

      {content ? (
        <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
          {content}
        </pre>
      ) : (
        <p className="mt-3 text-xs text-amber-400">{t("systemPromptDemo.emptyContent")}</p>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-slate-500">
          {t("systemPromptDemo.showRequest")}
        </summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-500">
          {JSON.stringify(requestPayload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${
        ok ? "bg-emerald-900/40 text-emerald-400" : "bg-slate-800 text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}

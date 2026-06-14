import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchSystemPromptConfig,
  previewSystemPromptWrap,
  proxyChat,
  type ProxyResult,
  type SystemPromptConfig,
  type SystemPromptPreview,
  type SystemPromptPreset,
  type Target,
} from "@/api/client";
import { SystemPromptResultCard } from "./SystemPromptResultCard";
import { WrapperDiffPanel } from "./WrapperDiffPanel";

type FlowStep = "idle" | "client" | "f5" | "llm" | "outcome";
type CardState = "pending" | "active" | "success" | "error";

export function SystemPromptDemo() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<SystemPromptConfig | null>(null);
  const [target, setTarget] = useState<Target>({ host: "172.16.30.124", port: 8000 });
  const [presetId, setPresetId] = useState("format_override");
  const [systemContent, setSystemContent] = useState("");
  const [userContent, setUserContent] = useState("");
  const [preview, setPreview] = useState<SystemPromptPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [flowStep, setFlowStep] = useState<FlowStep>("idle");
  const [result, setResult] = useState<ProxyResult | null>(null);
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null);
  const [cardState, setCardState] = useState<CardState>("pending");
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const presets = config?.presets ?? [];
  const selectedPreset =
    presets.find((p) => p.id === presetId) ?? presets[0] ?? null;
  const demoModel = config?.demo_model ?? "demo-model";

  useEffect(() => {
    fetchSystemPromptConfig()
      .then((c) => {
        setConfig(c);
        setTarget(c.default_vs);
        const first = c.presets[0];
        if (first) {
          setPresetId(first.id);
          setSystemContent(first.system_content);
          setUserContent(first.user_content);
        }
      })
      .catch(() => setGlobalError(t("systemPromptDemo.configLoadFailed")));
  }, [t]);

  useEffect(() => {
    if (!systemContent.trim() || !userContent.trim()) return;
    let cancelled = false;
    setPreviewLoading(true);
    previewSystemPromptWrap(systemContent, userContent, demoModel)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [systemContent, userContent, demoModel]);

  const applyPreset = useCallback((preset: SystemPromptPreset) => {
    setPresetId(preset.id);
    setSystemContent(preset.system_content);
    setUserContent(preset.user_content);
  }, []);

  const checkHealth = useCallback(async () => {
    setHealthMsg(null);
    setGlobalError(null);
    try {
      const r = await proxyChat(target, {
        model: demoModel,
        messages: [{ role: "user", content: "ping" }],
      });
      setHealthMsg(r.error ? t("app.healthFail") : t("app.healthOk"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(
        msg.includes("not allowed") ? t("demo.forbiddenHost") : t("demo.connectionFailed")
      );
      setHealthMsg(t("app.healthFail"));
    }
  }, [target, demoModel, t]);

  const runDemo = useCallback(async () => {
    if (!selectedPreset) return;
    setRunning(true);
    setGlobalError(null);
    setResult(null);
    setLastRequest(null);
    setCardState("active");
    setFlowStep("client");

    const advance = (step: FlowStep, ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          setFlowStep(step);
          resolve();
        }, ms);
      });

    try {
      await advance("f5", 350);
      await advance("llm", 350);
      const payload = {
        model: demoModel,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent },
        ],
      };
      setLastRequest(payload);
      const r = await proxyChat(target, payload);
      setResult(r);
      setFlowStep("outcome");
      const content =
        r.body &&
        typeof r.body === "object" &&
        "choices" in (r.body as object)
          ? String(
              (
                (r.body as { choices?: Array<{ message?: { content?: string } }> })
                  .choices?.[0]?.message?.content ?? ""
              )
            )
          : "";
      const yamlOk = selectedPreset.expects_yaml
        ? /^[\w.-]+:\s/m.test(content.trim()) || content.trim().startsWith("---")
        : true;
      const injectionOk = selectedPreset.expects_injection_contained
        ? content.toLowerCase().includes("injection_contained: true")
        : true;
      setCardState(
        r.status_code === 200 && r.error === null && yamlOk && injectionOk ? "success" : "error"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(
        msg.includes("not allowed") ? t("demo.forbiddenHost") : msg || t("demo.connectionFailed")
      );
      setCardState("error");
      setFlowStep("idle");
    } finally {
      setRunning(false);
    }
  }, [target, systemContent, userContent, demoModel, selectedPreset, t]);

  const flowNodes = [
    { id: "client", label: t("systemPromptDemo.flowClient") },
    { id: "f5", label: t("systemPromptDemo.flowF5") },
    { id: "llm", label: t("systemPromptDemo.flowLlm") },
    { id: "outcome", label: t("systemPromptDemo.flowOutcome") },
  ];

  const activeIndex =
    flowStep === "client"
      ? 0
      : flowStep === "f5"
        ? 1
        : flowStep === "llm"
          ? 2
          : flowStep === "outcome"
            ? 3
            : -1;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-300">
            {t("systemPromptDemo.targetVs")}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">{t("demo.host")}</label>
              <input
                className="input-field font-mono"
                value={target.host}
                onChange={(e) => setTarget((prev) => ({ ...prev, host: e.target.value }))}
                disabled={running}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">{t("demo.port")}</label>
              <input
                className="input-field font-mono"
                type="number"
                value={target.port}
                onChange={(e) =>
                  setTarget((prev) => ({
                    ...prev,
                    port: parseInt(e.target.value, 10) || 8000,
                  }))
                }
                disabled={running}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">
              {t("systemPromptDemo.selectPreset")}
            </label>
            <select
              className="input-field"
              value={presetId}
              onChange={(e) => {
                const next = presets.find((p) => p.id === e.target.value);
                if (next) applyPreset(next);
              }}
              disabled={running}
            >
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(p.label_key)}
                </option>
              ))}
            </select>
            {selectedPreset && (
              <p className="mt-1 text-xs text-slate-500">{t(selectedPreset.description_key)}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">
              {t("systemPromptDemo.systemField")}
            </label>
            <textarea
              className="input-field min-h-[100px] font-mono text-xs"
              value={systemContent}
              onChange={(e) => setSystemContent(e.target.value)}
              disabled={running}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-500">
              {t("systemPromptDemo.userField")}
            </label>
            <textarea
              className="input-field min-h-[60px] font-mono text-xs"
              value={userContent}
              onChange={(e) => setUserContent(e.target.value)}
              disabled={running}
            />
          </div>

          <p className="text-xs text-slate-500">
            {t("systemPromptDemo.model")}: <code className="text-cyan-400">{demoModel}</code>
            {config?.mock_llm_port != null && (
              <>
                {" · "}
                {t("systemPromptDemo.mockPort")}:{" "}
                <code className="text-cyan-400">{config.mock_llm_port}</code>
              </>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={runDemo} disabled={running}>
              {running ? t("app.running") : t("systemPromptDemo.sendRequest")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={checkHealth}
              disabled={running}
            >
              {t("app.healthCheck")}
            </button>
          </div>

          {healthMsg && (
            <p
              className={`text-sm ${
                healthMsg === t("app.healthOk") ? "text-emerald-400" : "text-amber-400"
              }`}
            >
              {healthMsg}
            </p>
          )}
          {globalError && <p className="text-sm text-red-400">{globalError}</p>}

          <div className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("systemPromptDemo.flowTitle")}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {flowNodes.map((node, i) => (
                <div key={node.id} className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 font-medium transition ${
                      activeIndex === i
                        ? "animate-pulse bg-cyan-600/30 text-cyan-300 ring-1 ring-cyan-500/50"
                        : activeIndex > i
                          ? "bg-emerald-900/40 text-emerald-400"
                          : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {node.label}
                  </span>
                  {i < flowNodes.length - 1 && (
                    <span className="text-slate-600" aria-hidden>
                      →
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          {result && lastRequest && selectedPreset ? (
            <SystemPromptResultCard
              preset={selectedPreset}
              target={target}
              requestPayload={lastRequest}
              proxy={result}
              state={cardState}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center text-sm text-slate-500">
              {t("systemPromptDemo.noResult")}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("systemPromptDemo.previewTitle")}
        </p>
        <WrapperDiffPanel preview={preview} loading={previewLoading} presetId={presetId} />
      </div>
    </div>
  );
}

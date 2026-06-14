import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchMaxTokensConfig,
  isMaxTokensBlocked,
  runMaxTokensTest,
  resolveMaxTokensPolicyLocal,
  type MaxTokensConfig,
  type Target,
} from "@/api/client";
import {
  MaxTokensComparePanel,
  type MaxTokensCompareCase,
} from "./MaxTokensComparePanel";
import { MaxTokensLimitGauge } from "./MaxTokensLimitGauge";

type FlowStep = "idle" | "running" | "done";

const DEFAULT_COMPLIANT = 2048;
const DEFAULT_OVERFLOW = 8192;

export function MaxTokensDemo() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<MaxTokensConfig | null>(null);
  const [target, setTarget] = useState<Target>({ host: "172.16.30.124", port: 8000 });
  const [customMaxTokens, setCustomMaxTokens] = useState<number>(DEFAULT_COMPLIANT);
  const [running, setRunning] = useState(false);
  const [flowStep, setFlowStep] = useState<FlowStep>("idle");
  const [compareCases, setCompareCases] = useState<MaxTokensCompareCase[]>([]);
  const [compareOk, setCompareOk] = useState<boolean | null>(null);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const limit = config?.max_tokens_limit ?? 4096;
  const demoModel = config?.demo_model ?? "demo-model";

  const compliantPreset = config?.presets.find((p) => p.id === "compliant");
  const overflowPreset = config?.presets.find((p) => p.id === "overflow");
  const compliantTokens = compliantPreset?.max_tokens ?? DEFAULT_COMPLIANT;
  const overflowTokens = overflowPreset?.max_tokens ?? DEFAULT_OVERFLOW;

  useEffect(() => {
    fetchMaxTokensConfig()
      .then((c) => {
        setConfig(c);
        setTarget(c.default_vs);
        const compliant = c.presets.find((p) => p.id === "compliant");
        if (compliant) setCustomMaxTokens(compliant.max_tokens);
      })
      .catch(() => setGlobalError(t("maxTokensDemo.configLoadFailed")));
  }, [t]);

  const customPolicy = useMemo(
    () => resolveMaxTokensPolicyLocal(customMaxTokens, limit),
    [customMaxTokens, limit]
  );

  const gaugeMarkers = useMemo(
    () => [
      { value: compliantTokens, kind: "compliant" as const },
      { value: overflowTokens, kind: "overflow" as const },
    ],
    [compliantTokens, overflowTokens]
  );

  const buildPayload = useCallback(
    (max_tokens: number) => ({
      model: demoModel,
      max_tokens: Math.trunc(max_tokens),
      messages: [{ role: "user", content: t("maxTokensDemo.testPrompt") }],
    }),
    [demoModel, t]
  );

  const testPrompt = t("maxTokensDemo.testPrompt");

  const runSingle = useCallback(
    async (max_tokens: number, id: string, labelKey: string, expected: "allow" | "block") => {
      const r = await runMaxTokensTest(target, max_tokens, testPrompt);
      const sent = r.sent_payload ?? buildPayload(max_tokens);
      return {
        id,
        labelKey,
        max_tokens,
        expectedAction: expected,
        requestPayload: sent,
        proxy: r,
        state: "success" as const,
      } satisfies MaxTokensCompareCase;
    },
    [buildPayload, target, testPrompt]
  );

  const checkHealth = useCallback(async () => {
    setHealthMsg(null);
    setGlobalError(null);
    try {
      const r = await runMaxTokensTest(target, compliantTokens, testPrompt);
      setHealthMsg(r.error ? t("app.healthFail") : t("app.healthOk"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(
        msg.includes("not allowed") ? t("demo.forbiddenHost") : t("demo.connectionFailed")
      );
      setHealthMsg(t("app.healthFail"));
    }
  }, [target, compliantTokens, testPrompt, t]);

  const runCompare = useCallback(async () => {
    setRunning(true);
    setGlobalError(null);
    setCompareOk(null);
    setFlowStep("running");

    const pendingCases: MaxTokensCompareCase[] = [
      {
        id: "compliant",
        labelKey: "maxTokensDemo.caseCompliant",
        max_tokens: compliantTokens,
        expectedAction: "allow",
        requestPayload: buildPayload(compliantTokens),
        proxy: null,
        state: "active",
      },
      {
        id: "overflow",
        labelKey: "maxTokensDemo.caseOverflow",
        max_tokens: overflowTokens,
        expectedAction: "block",
        requestPayload: buildPayload(overflowTokens),
        proxy: null,
        state: "active",
      },
    ];
    setCompareCases(pendingCases);

    try {
      const [compliantResult, overflowResult] = await Promise.all([
        runSingle(compliantTokens, "compliant", "maxTokensDemo.caseCompliant", "allow"),
        runSingle(overflowTokens, "overflow", "maxTokensDemo.caseOverflow", "block"),
      ]);
      setCompareCases([compliantResult, overflowResult]);

      const leftOk =
        compliantResult.proxy.error === null &&
        !isMaxTokensBlocked(compliantResult.proxy.body, compliantResult.proxy.status_code) &&
        compliantResult.proxy.status_code >= 200 &&
        compliantResult.proxy.status_code < 300;
      const rightOk = isMaxTokensBlocked(
        overflowResult.proxy.body,
        overflowResult.proxy.status_code
      );
      setCompareOk(leftOk && rightOk);
      setFlowStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(
        msg.includes("not allowed") ? t("demo.forbiddenHost") : msg || t("demo.connectionFailed")
      );
      setCompareCases((prev) =>
        prev.map((c) => ({ ...c, state: "error" as const }))
      );
      setCompareOk(false);
      setFlowStep("idle");
    } finally {
      setRunning(false);
    }
  }, [buildPayload, compliantTokens, overflowTokens, runSingle, t]);

  const runCustom = useCallback(async () => {
    if (!Number.isFinite(customMaxTokens) || customMaxTokens < 1) return;
    setRunning(true);
    setGlobalError(null);
    setCompareOk(null);
    setFlowStep("running");

    const expected = resolveMaxTokensPolicyLocal(customMaxTokens, limit).action;
    const labelKey =
      expected === "allow" ? "maxTokensDemo.caseCustomAllow" : "maxTokensDemo.caseCustomBlock";

    setCompareCases([
      {
        id: "custom",
        labelKey,
        max_tokens: customMaxTokens,
        expectedAction: expected,
        requestPayload: buildPayload(customMaxTokens),
        proxy: null,
        state: "active",
      },
    ]);

    try {
      const result = await runSingle(customMaxTokens, "custom", labelKey, expected);
      setCompareCases([result]);
      const blocked = isMaxTokensBlocked(result.proxy.body, result.proxy.status_code);
      const ok =
        expected === "block"
          ? blocked
          : !blocked &&
            result.proxy.error === null &&
            result.proxy.status_code >= 200 &&
            result.proxy.status_code < 300;
      setCompareOk(ok);
      setFlowStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(msg || t("demo.connectionFailed"));
      setCompareOk(false);
      setFlowStep("idle");
    } finally {
      setRunning(false);
    }
  }, [customMaxTokens, limit, buildPayload, runSingle, t]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">{t("maxTokensDemo.targetVs")}</h3>
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
                setTarget((prev) => ({ ...prev, port: Number(e.target.value) || 8000 }))
              }
              disabled={running}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-xs text-slate-400">
          <p>
            {t("maxTokensDemo.modelNote")}:{" "}
            <code className="text-cyan-400">{demoModel}</code>
          </p>
          <p className="mt-1">
            {t("maxTokensDemo.layerNote")}: {config?.irule_layer ?? "iRule Layer 0"}
          </p>
        </div>

        <MaxTokensLimitGauge
          limit={limit}
          markers={gaugeMarkers}
          activeValue={customMaxTokens}
        />

        <div>
          <label className="mb-1 block text-xs text-slate-500">
            {t("maxTokensDemo.customInput")}
          </label>
          <input
            className="input-field font-mono"
            type="number"
            min={1}
            value={customMaxTokens}
            onChange={(e) => setCustomMaxTokens(Number(e.target.value) || 0)}
            disabled={running}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={running}
              onClick={() => setCustomMaxTokens(compliantTokens)}
            >
              {t("maxTokensDemo.quickCompliant", { value: compliantTokens })}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={running}
              onClick={() => setCustomMaxTokens(overflowTokens)}
            >
              {t("maxTokensDemo.quickOverflow", { value: overflowTokens })}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={running}
              onClick={() => setCustomMaxTokens(limit)}
            >
              {t("maxTokensDemo.quickAtLimit", { value: limit })}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={running}
              onClick={() => setCustomMaxTokens(limit + 1)}
            >
              {t("maxTokensDemo.quickOverLimit", { value: limit + 1 })}
            </button>
          </div>
        </div>

        <div
          className={`rounded-lg border p-3 text-sm ${
            customPolicy.action === "allow"
              ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
              : "border-rose-500/30 bg-rose-950/20 text-rose-200"
          }`}
        >
          <p className="font-medium">{t("maxTokensDemo.policyPreview")}</p>
          <p className="mt-1 text-xs opacity-90">
            {t("maxTokensDemo.policyDetail", {
              value: customMaxTokens,
              limit,
              action: customPolicy.action,
            })}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-secondary" onClick={checkHealth} disabled={running}>
            {t("app.healthCheck")}
          </button>
          <button type="button" className="btn-primary" onClick={runCompare} disabled={running}>
            {running && flowStep === "running" && compareCases.length === 2
              ? t("app.running")
              : t("maxTokensDemo.runCompare")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={runCustom}
            disabled={running || customMaxTokens < 1}
          >
            {t("maxTokensDemo.runCustom")}
          </button>
        </div>

        {healthMsg && <p className="text-sm text-slate-400">{healthMsg}</p>}
        {globalError && <p className="text-sm text-red-400">{globalError}</p>}
      </div>

      <div className="space-y-4">
        {compareCases.length > 0 ? (
          <MaxTokensComparePanel
            target={target}
            demoModel={demoModel}
            limit={limit}
            cases={compareCases}
            compareOk={compareOk}
          />
        ) : (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center text-sm text-slate-500">
            {t("maxTokensDemo.resultPlaceholder")}
          </div>
        )}
      </div>
    </div>
  );
}

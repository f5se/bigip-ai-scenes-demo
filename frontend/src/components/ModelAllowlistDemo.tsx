import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchModelAllowlistConfig,
  isModelPolicyBlocked,
  proxyChat,
  resolveModelPolicyLocal,
  type ModelAllowlistConfig,
  type ProxyResult,
  type Target,
} from "@/api/client";
import { ModelAllowlistResultCard } from "./ModelAllowlistResultCard";

type FlowStep = "idle" | "client" | "check" | "outcome";
type CardState = "pending" | "active" | "success" | "error";

const BLOCKED_EXAMPLE = "gpt-4o";

export function ModelAllowlistDemo() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ModelAllowlistConfig | null>(null);
  const [target, setTarget] = useState<Target>({ host: "172.16.30.124", port: 8000 });
  const [model, setModel] = useState("demo-model");
  const [running, setRunning] = useState(false);
  const [flowStep, setFlowStep] = useState<FlowStep>("idle");
  const [result, setResult] = useState<ProxyResult | null>(null);
  const [lastRequest, setLastRequest] = useState<Record<string, unknown> | null>(null);
  const [cardState, setCardState] = useState<CardState>("pending");
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const allowedModel = config?.allowed_model ?? "demo-model";
  const allowQuickModels = useMemo(() => {
    if (!config) return [allowedModel];
    const fromRecords = config.records.filter((r) => r.action === "allow").map((r) => r.model);
    return fromRecords.length > 0 ? fromRecords : config.allowed_models ?? [allowedModel];
  }, [config, allowedModel]);

  useEffect(() => {
    fetchModelAllowlistConfig()
      .then((c) => {
        setConfig(c);
        setTarget(c.default_vs);
        setModel(c.allowed_model);
      })
      .catch(() => setGlobalError(t("modelAllowlistDemo.configLoadFailed")));
  }, [t]);

  const policy = useMemo(() => {
    if (!config) return null;
    return resolveModelPolicyLocal(model.trim() || allowedModel, config);
  }, [config, model, allowedModel]);

  const checkHealth = useCallback(async () => {
    setHealthMsg(null);
    setGlobalError(null);
    try {
      const r = await proxyChat(target, {
        model: allowedModel,
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
  }, [target, allowedModel, t]);

  const runDemo = useCallback(async () => {
    const testModel = model.trim();
    if (!testModel || !config) return;

    setRunning(true);
    setGlobalError(null);
    setResult(null);
    setLastRequest(null);
    setCardState("active");
    setFlowStep("client");

    const expectedAction = resolveModelPolicyLocal(testModel, config).action;

    const advance = (step: FlowStep, ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          setFlowStep(step);
          resolve();
        }, ms);
      });

    try {
      await advance("check", 350);
      const payload = {
        model: testModel,
        messages: [{ role: "user", content: t("modelAllowlistDemo.testPrompt") }],
      };
      setLastRequest(payload);
      const r = await proxyChat(target, payload);
      setResult(r);
      setFlowStep("outcome");

      const blocked = isModelPolicyBlocked(r.body, r.status_code);
      const expectedBlocked = expectedAction === "block";
      const ok =
        r.error === null &&
        (expectedBlocked ? blocked : !blocked && r.status_code >= 200 && r.status_code < 300);
      setCardState(ok ? "success" : "error");
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
  }, [model, config, target, t]);

  const flowNodes = [
    { id: "client", label: t("modelAllowlistDemo.flowClient") },
    { id: "f5", label: t("modelAllowlistDemo.flowF5") },
    { id: "check", label: t("modelAllowlistDemo.flowCheck") },
    { id: "outcome", label: t("modelAllowlistDemo.flowOutcome") },
  ];

  const activeIndex =
    flowStep === "client"
      ? 0
      : flowStep === "check"
        ? 2
        : flowStep === "outcome"
          ? 3
          : -1;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">
          {t("modelAllowlistDemo.targetVs")}
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
                setTarget((prev) => ({ ...prev, port: Number(e.target.value) || 8000 }))
              }
              disabled={running}
            />
          </div>
        </div>

        {config && (
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
            <p className="text-xs font-semibold text-slate-400">
              {t("modelAllowlistDemo.datagroupTitle")}
            </p>
            <p className="mt-1 font-mono text-xs text-cyan-400">{config.datagroup}</p>
            <table className="mt-3 w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="pb-1 font-medium">{t("modelAllowlistDemo.colModel")}</th>
                  <th className="pb-1 font-medium">{t("modelAllowlistDemo.colAction")}</th>
                </tr>
              </thead>
              <tbody>
                {config.records.map((row) => (
                  <tr key={row.model} className="border-t border-slate-800">
                    <td className="py-1.5 font-mono text-slate-300">{row.model}</td>
                    <td className="py-1.5">
                      <span
                        className={
                          row.action === "allow"
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }
                      >
                        {row.action}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-800">
                  <td className="py-1.5 italic text-slate-500">
                    {t("modelAllowlistDemo.defaultRow")}
                  </td>
                  <td className="py-1.5">
                    <span
                      className={
                        config.default_action === "allow"
                          ? "text-emerald-400"
                          : "text-rose-400"
                      }
                    >
                      {config.default_action}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-slate-500">
            {t("modelAllowlistDemo.modelInput")}
          </label>
          <input
            className="input-field font-mono"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t("modelAllowlistDemo.modelPlaceholder")}
            disabled={running}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {allowQuickModels.map((m) => (
              <button
                key={m}
                type="button"
                className="btn-secondary text-xs"
                disabled={running}
                onClick={() => setModel(m)}
              >
                {t("modelAllowlistDemo.quickAllow", { model: m })}
              </button>
            ))}
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={running}
              onClick={() => setModel(BLOCKED_EXAMPLE)}
            >
              {t("modelAllowlistDemo.quickBlock", { model: BLOCKED_EXAMPLE })}
            </button>
          </div>
        </div>

        {policy && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              policy.action === "allow"
                ? "border-emerald-500/30 bg-emerald-950/20 text-emerald-200"
                : "border-rose-500/30 bg-rose-950/20 text-rose-200"
            }`}
          >
            <p className="font-medium">{t("modelAllowlistDemo.policyPreview")}</p>
            <p className="mt-1 text-xs opacity-90">
              {t("modelAllowlistDemo.policyDetail", {
                model: policy.model,
                action: policy.action,
                source:
                  policy.source === "datagroup"
                    ? t("modelAllowlistDemo.sourceDatagroup")
                    : t("modelAllowlistDemo.sourceDefault"),
              })}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-secondary" onClick={checkHealth} disabled={running}>
            {t("app.healthCheck")}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={runDemo}
            disabled={running || !model.trim()}
          >
            {running ? t("app.running") : t("modelAllowlistDemo.sendTest")}
          </button>
        </div>

        {healthMsg && <p className="text-sm text-slate-400">{healthMsg}</p>}
        {globalError && <p className="text-sm text-red-400">{globalError}</p>}
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {flowNodes.map((node, idx) => (
            <div key={node.id} className="flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  idx === activeIndex
                    ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/50"
                    : idx < activeIndex
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-slate-800 text-slate-500"
                }`}
              >
                {node.label}
              </span>
              {idx < flowNodes.length - 1 && (
                <span className="text-slate-600">→</span>
              )}
            </div>
          ))}
        </div>

        {result && lastRequest && policy && (
          <ModelAllowlistResultCard
            model={model.trim()}
            expectedAction={policy.action}
            target={target}
            requestPayload={lastRequest}
            proxy={result}
            state={cardState}
          />
        )}
        {!result && (
          <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-8 text-center text-sm text-slate-500">
            {t("modelAllowlistDemo.resultPlaceholder")}
          </div>
        )}
      </div>
    </div>
  );
}

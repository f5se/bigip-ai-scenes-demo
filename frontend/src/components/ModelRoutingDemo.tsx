import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchDefaults,
  proxyChat,
  runModelRoutingDemo,
  type DefaultsConfig,
  type DemoCaseResult,
  type Target,
} from "@/api/client";
import { RequestResultCard } from "./RequestResultCard";

type CardState = "pending" | "active" | "success" | "error";
type ResultView = "idle" | "batch" | "single";

function expectedStatusForModel(
  model: string,
  cases: DefaultsConfig["demo_cases"]
): number {
  const matched = cases.find((c) => c.model === model);
  return matched?.expected_status ?? 200;
}

function poolForModel(
  model: string,
  map: Record<string, string>
): string {
  return map[model] ?? map["__default__"] ?? "/Common/pool_llm_default";
}

export function ModelRoutingDemo() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<DefaultsConfig | null>(null);
  const [target, setTarget] = useState<Target>({ host: "172.16.30.122", port: 8000 });
  const [intervalMs, setIntervalMs] = useState(500);
  const [selectedModel, setSelectedModel] = useState("deepseek-chat");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<DemoCaseResult[]>([]);
  const [cardStates, setCardStates] = useState<CardState[]>([]);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [resultView, setResultView] = useState<ResultView>("idle");

  useEffect(() => {
    fetchDefaults()
      .then((c) => {
        setConfig(c);
        setTarget(c.default_vs);
        setIntervalMs(c.demo_interval_ms);
        setSelectedModel(c.model_options[0] ?? "gpt-4o");
        setCardStates(c.demo_cases.map(() => "pending" as CardState));
      })
      .catch(() => setGlobalError("Failed to load config"));
  }, []);

  const cases = config?.demo_cases ?? [];

  const checkHealth = useCallback(async () => {
    setHealthMsg(null);
    setGlobalError(null);
    try {
      const r = await proxyChat(target, {
        model: "deepseek-chat",
        messages: [{ role: "user", content: "ping" }],
      });
      if (r.error) {
        setHealthMsg(t("app.healthFail"));
      } else {
        setHealthMsg(t("app.healthOk"));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not allowed") || msg.includes("403")) {
        setGlobalError(t("demo.forbiddenHost"));
      } else {
        setGlobalError(t("demo.connectionFailed"));
      }
      setHealthMsg(t("app.healthFail"));
    }
  }, [target, t]);

  const runBatch = useCallback(async () => {
    if (!config) return;
    setRunning(true);
    setGlobalError(null);
    setResultView("batch");
    setResults([]);
    setCardStates(cases.map(() => "pending"));

    try {
      for (let i = 0; i < cases.length; i++) {
        setCardStates((prev) => {
          const next = [...prev];
          next[i] = "active";
          return next;
        });
        const partial = await runModelRoutingDemo(
          target,
          [cases[i].case_id],
          0
        );
        const item = partial.results[0];
        if (item) {
          setResults((prev) => [...prev, item]);
          const ok =
            item.proxy.error === null &&
            item.proxy.status_code === item.expected_status;
          setCardStates((prev) => {
            const next = [...prev];
            next[i] = ok ? "success" : "error";
            return next;
          });
        }
        if (i < cases.length - 1) {
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not allowed") || msg.includes("403")) {
        setGlobalError(t("demo.forbiddenHost"));
      } else {
        setGlobalError(msg || t("demo.connectionFailed"));
      }
    } finally {
      setRunning(false);
    }
  }, [config, target, cases, intervalMs, t]);

  const runSingle = useCallback(async () => {
    if (!config) return;
    setRunning(true);
    setGlobalError(null);
    setResultView("single");
    setResults([]);
    setCardStates(["active"]);
    const expectedStatus = expectedStatusForModel(selectedModel, cases);
    const pool = poolForModel(selectedModel, config.model_pool_map);
    const matchedCase = cases.find((c) => c.model === selectedModel);
    try {
      const r = await proxyChat(target, {
        model: selectedModel,
        messages: [{ role: "user", content: "hello" }],
      });
      const single: DemoCaseResult = {
        case_id: "manual",
        model: selectedModel,
        label: matchedCase?.label ?? selectedModel,
        label_key: "demo.singleRequest",
        expected_pool: pool,
        expected_status: expectedStatus,
        proxy: r,
      };
      const ok =
        r.error === null && r.status_code === expectedStatus;
      setResults([single]);
      setCardStates([ok ? "success" : "error"]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(
        msg.includes("not allowed") ? t("demo.forbiddenHost") : msg
      );
      setCardStates(["error"]);
      setResults([
        {
          case_id: "manual",
          model: selectedModel,
          label: matchedCase?.label ?? selectedModel,
          label_key: "demo.singleRequest",
          expected_pool: pool,
          expected_status: expectedStatus,
          proxy: {
            status_code: 0,
            headers: {},
            body: null,
            elapsed_ms: 0,
            error: msg,
          },
        },
      ]);
    } finally {
      setRunning(false);
    }
  }, [target, selectedModel, config, cases, t]);

  const modelOptions = config?.model_options ?? [];

  const poolGroups = modelOptions.reduce<Record<string, string[]>>((acc, model) => {
    const pool = config?.model_pool_map[model] ?? "";
    if (!acc[pool]) acc[pool] = [];
    acc[pool].push(model);
    return acc;
  }, {});

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">{t("demo.targetVs")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">{t("demo.host")}</label>
            <input
              className="input-field font-mono"
              value={target.host}
              onChange={(e) => setTarget((t) => ({ ...t, host: e.target.value }))}
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
                setTarget((t) => ({ ...t, port: parseInt(e.target.value, 10) || 8000 }))
              }
              disabled={running}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-500">{t("demo.interval")}</label>
          <input
            className="input-field w-32"
            type="number"
            min={0}
            max={5000}
            step={100}
            value={intervalMs}
            onChange={(e) => setIntervalMs(parseInt(e.target.value, 10) || 500)}
            disabled={running}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-500">{t("demo.selectModel")}</label>
          <select
            className="input-field"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={running}
          >
            {Object.entries(poolGroups).map(([pool, models]) => (
              <optgroup key={pool} label={pool.replace("/Common/", "")}>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label={t("demo.unmappedModels")}>
              <option value="deepseek-chat-xxx">deepseek-chat-xxx</option>
            </optgroup>
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={runBatch}
            disabled={running || !config}
          >
            {running
              ? t("app.running")
              : t("demo.batchDemo", { count: cases.length })}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={runSingle}
            disabled={running}
          >
            {t("app.runSingle")}
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
      </div>

      <div className="space-y-3">
        {resultView === "single" && results[0] ? (
          <RequestResultCard
            key="manual"
            result={results[0]}
            state={cardStates[0] ?? "pending"}
          />
        ) : cases.length > 0 ? (
          cases.map((c, i) => {
            const result = results.find((r) => r.case_id === c.case_id);
            const display: DemoCaseResult =
              result ??
              ({
                case_id: c.case_id,
                model: c.model,
                label: c.label,
                label_key: c.label_key,
                expected_pool: c.expected_pool,
                expected_status: c.expected_status,
                proxy: {
                  status_code: 0,
                  headers: {},
                  body: null,
                  elapsed_ms: 0,
                  error: null,
                },
              } as DemoCaseResult);
            return (
              <RequestResultCard
                key={c.case_id}
                result={display}
                state={cardStates[i] ?? "pending"}
              />
            );
          })
        ) : (
          <p className="text-sm text-slate-500">{t("demo.noResults")}</p>
        )}
      </div>
    </div>
  );
}

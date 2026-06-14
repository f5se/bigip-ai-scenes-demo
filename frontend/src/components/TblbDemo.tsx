import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildPortDistribution,
  detectModelRewrite,
  extractServerPort,
  fetchSchedulerPoolStatus,
  fetchTblbConfig,
  proxyChat,
  triggerMemberLoad,
  type SchedulerPoolStatus,
  type Target,
  type TblbConfig,
  type TblbModelResult,
  type TblbPoolGroup,
  type TblbTriggerMemberResult,
} from "@/api/client";
import { TblbPoolPanel } from "./TblbPoolPanel";

type CardState = "pending" | "active" | "success" | "error";

type SchedulerPoolState = {
  loading: boolean;
  error: string | null;
  data: SchedulerPoolStatus | null;
};

function emptySchedulerState(): SchedulerPoolState {
  return { loading: false, error: null, data: null };
}

function emptyResult(
  model: string,
  group: TblbPoolGroup,
  total: number
): TblbModelResult {
  return {
    model,
    expected_pool: group.pool,
    pool_short: group.pool_short,
    tblb_enabled: group.tblb_enabled,
    total,
    completed: 0,
    success: 0,
    errors: 0,
    port_distribution: [],
  };
}

function findPoolGroup(config: TblbConfig, model: string): TblbPoolGroup | undefined {
  return config.pools.find((g) => g.models.includes(model));
}

export function TblbDemo() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<TblbConfig | null>(null);
  const [target, setTarget] = useState<Target>({ host: "172.16.30.122", port: 8000 });
  const [schedulerTarget, setSchedulerTarget] = useState<Target>({
    host: "127.0.0.1",
    port: 8181,
  });
  const [intervalMs, setIntervalMs] = useState(50);
  const [testCount, setTestCount] = useState(500);
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TblbModelResult | null>(null);
  const [cardState, setCardState] = useState<CardState>("pending");
  const [schedulerByPool, setSchedulerByPool] = useState<
    Record<string, SchedulerPoolState>
  >({});
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [triggeringLoad, setTriggeringLoad] = useState(false);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [triggerResults, setTriggerResults] = useState<TblbTriggerMemberResult[] | null>(
    null
  );

  const schedulerPartition = config?.scheduler_partition ?? "Common";
  const controlsLocked = running || triggeringLoad || cooldownSec > 0;
  const prevCooldownRef = useRef(0);

  const selectedPool = useMemo(
    () => (config ? findPoolGroup(config, selectedModel) : undefined),
    [config, selectedModel]
  );

  const loadSchedulerForPool = useCallback(
    async (poolShort: string) => {
      setSchedulerByPool((prev) => ({
        ...prev,
        [poolShort]: { loading: true, error: null, data: prev[poolShort]?.data ?? null },
      }));
      try {
        const data = await fetchSchedulerPoolStatus(
          poolShort,
          schedulerTarget,
          schedulerPartition
        );
        setSchedulerByPool((prev) => ({
          ...prev,
          [poolShort]: { loading: false, error: null, data },
        }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSchedulerByPool((prev) => ({
          ...prev,
          [poolShort]: { loading: false, error: msg, data: null },
        }));
      }
    },
    [schedulerTarget, schedulerPartition]
  );

  useEffect(() => {
    fetchTblbConfig()
      .then((c) => {
        setConfig(c);
        setTarget(c.default_vs);
        setSchedulerTarget(c.default_scheduler);
        setIntervalMs(c.tblb_demo_interval_ms);
        setTestCount(c.default_iterations);
        const firstModel = c.pools[0]?.models[0];
        if (firstModel) setSelectedModel(firstModel);
      })
      .catch(() => setGlobalError("Failed to load TBLB config"));
  }, []);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setTimeout(() => {
      setCooldownSec((prev) => prev - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSec]);

  useEffect(() => {
    if (prevCooldownRef.current > 0 && cooldownSec === 0 && selectedPool?.tblb_enabled) {
      void loadSchedulerForPool(selectedPool.pool_short);
    }
    prevCooldownRef.current = cooldownSec;
  }, [cooldownSec, selectedPool?.pool_short, selectedPool?.tblb_enabled, loadSchedulerForPool]);

  useEffect(() => {
    if (!selectedPool?.tblb_enabled) return;
    setTriggerResults(null);
    void loadSchedulerForPool(selectedPool.pool_short);
  }, [selectedPool?.pool_short, selectedPool?.tblb_enabled, loadSchedulerForPool]);

  const runModelIterations = useCallback(
    async (
      model: string,
      group: TblbPoolGroup,
      iterations: number
    ): Promise<TblbModelResult> => {
      const portCounts = new Map<string, number>();
      let success = 0;
      let errors = 0;
      let modelRewritten: boolean | undefined;
      let responseModel: string | null | undefined;

      // 测试开始前探测 model 改写，立即展示信息板（不计入分布统计）
      try {
        const probe = await proxyChat(target, {
          model,
          messages: [{ role: "user", content: "hello" }],
        });
        if (probe.error === null && probe.status_code === 200) {
          const rewrite = detectModelRewrite(model, probe.body, probe.status_code);
          modelRewritten = rewrite.rewritten;
          responseModel = rewrite.responseModel;
          setResult({
            model,
            expected_pool: group.pool,
            pool_short: group.pool_short,
            tblb_enabled: group.tblb_enabled,
            total: iterations,
            completed: 0,
            success: 0,
            errors: 0,
            port_distribution: [],
            model_rewritten: modelRewritten,
            response_model: responseModel ?? null,
          });
        }
      } catch {
        // 探测失败时由后续迭代继续检测
      }

      for (let i = 0; i < iterations; i++) {
        let portKey = "error";
        try {
          const proxy = await proxyChat(target, {
            model,
            messages: [{ role: "user", content: "hello" }],
          });
          if (proxy.error !== null || proxy.status_code !== 200) {
            errors += 1;
            portKey = "error";
          } else {
            success += 1;
            const port = extractServerPort(proxy.body);
            portKey = port !== null ? String(port) : "unknown";
            if (modelRewritten === undefined) {
              const rewrite = detectModelRewrite(model, proxy.body, proxy.status_code);
              modelRewritten = rewrite.rewritten;
              responseModel = rewrite.responseModel;
            }
          }
        } catch {
          errors += 1;
          portKey = "error";
        }

        portCounts.set(portKey, (portCounts.get(portKey) ?? 0) + 1);
        const completed = i + 1;
        setResult({
          model,
          expected_pool: group.pool,
          pool_short: group.pool_short,
          tblb_enabled: group.tblb_enabled,
          total: iterations,
          completed,
          success,
          errors,
          port_distribution: buildPortDistribution(portCounts, completed),
          model_rewritten: modelRewritten,
          response_model: responseModel ?? null,
        });

        if (i < iterations - 1 && intervalMs > 0) {
          await new Promise((r) => setTimeout(r, intervalMs));
        }
      }

      return {
        model,
        expected_pool: group.pool,
        pool_short: group.pool_short,
        tblb_enabled: group.tblb_enabled,
        total: iterations,
        completed: iterations,
        success,
        errors,
        port_distribution: buildPortDistribution(portCounts, iterations),
        model_rewritten: modelRewritten,
        response_model: responseModel ?? null,
      };
    },
    [target, intervalMs]
  );

  const checkHealth = useCallback(async () => {
    setHealthMsg(null);
    setGlobalError(null);
    try {
      const r = await proxyChat(target, {
        model: "deepseek-chat",
        messages: [{ role: "user", content: "ping" }],
      });
      setHealthMsg(r.error ? t("app.healthFail") : t("app.healthOk"));
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

  const handleTriggerMemberLoad = useCallback(async () => {
    if (!selectedPool?.tblb_enabled) return;

    setGlobalError(null);
    setTriggeringLoad(true);
    setTriggerResults(null);

    let schedulerData = schedulerByPool[selectedPool.pool_short]?.data;
    if (!schedulerData?.members?.length) {
      try {
        const data = await fetchSchedulerPoolStatus(
          selectedPool.pool_short,
          schedulerTarget,
          schedulerPartition
        );
        setSchedulerByPool((prev) => ({
          ...prev,
          [selectedPool.pool_short]: { loading: false, error: null, data },
        }));
        schedulerData = data;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setGlobalError(msg || t("tblbDemo.triggerFailed"));
        setTriggeringLoad(false);
        return;
      }
    }

    const members = schedulerData?.members ?? [];
    if (members.length === 0) {
      setGlobalError(t("tblbDemo.triggerNoMembers"));
      setTriggeringLoad(false);
      return;
    }

    try {
      const path = config?.tblb_trigger_path ?? "/trigger_update";
      const response = await triggerMemberLoad(
        members.map((m) => ({ ip: m.ip, port: m.port })),
        path
      );
      setTriggerResults(response.results);
      setCooldownSec(response.wait_seconds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(msg || t("tblbDemo.triggerFailed"));
    } finally {
      setTriggeringLoad(false);
    }
  }, [
    selectedPool,
    schedulerByPool,
    schedulerTarget,
    schedulerPartition,
    config?.tblb_trigger_path,
    t,
  ]);

  const runTest = useCallback(async () => {
    if (!config || !selectedPool) return;

    setRunning(true);
    setGlobalError(null);
    setResult(emptyResult(selectedModel, selectedPool, testCount));
    setCardState("active");

    if (selectedPool.tblb_enabled) {
      await loadSchedulerForPool(selectedPool.pool_short);
    }

    try {
      const final = await runModelIterations(selectedModel, selectedPool, testCount);
      setResult(final);
      setCardState(final.success > 0 ? "success" : "error");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setGlobalError(
        msg.includes("not allowed") ? t("demo.forbiddenHost") : msg
      );
      setCardState("error");
    } finally {
      setRunning(false);
    }
  }, [
    config,
    selectedPool,
    selectedModel,
    testCount,
    loadSchedulerForPool,
    runModelIterations,
    t,
  ]);

  const poolGroups = config?.pools ?? [];

  const displayResult =
    result ?? (selectedPool ? emptyResult(selectedModel, selectedPool, testCount) : null);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">{t("demo.targetVs")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">{t("demo.host")}</label>
            <input
              className="input-field font-mono"
              value={target.host}
              onChange={(e) => setTarget((prev) => ({ ...prev, host: e.target.value }))}
              disabled={controlsLocked}
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
              disabled={controlsLocked}
            />
          </div>
        </div>

        <h3 className="text-sm font-semibold text-slate-300">
          {t("tblbDemo.schedulerTarget")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">{t("demo.host")}</label>
            <input
              className="input-field font-mono"
              value={schedulerTarget.host}
              onChange={(e) =>
                setSchedulerTarget((prev) => ({ ...prev, host: e.target.value }))
              }
              disabled={controlsLocked}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">{t("demo.port")}</label>
            <input
              className="input-field font-mono"
              type="number"
              value={schedulerTarget.port}
              onChange={(e) =>
                setSchedulerTarget((prev) => ({
                  ...prev,
                  port: parseInt(e.target.value, 10) || 8181,
                }))
              }
              disabled={controlsLocked}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              {t("tblbDemo.testCount")}
            </label>
            <input
              className="input-field w-full"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={testCount}
              onChange={(e) =>
                setTestCount(Math.min(1000, Math.max(1, parseInt(e.target.value, 10) || 500)))
              }
              disabled={controlsLocked}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">{t("demo.interval")}</label>
            <input
              className="input-field w-full"
              type="number"
              min={0}
              max={5000}
              step={10}
              value={intervalMs}
              onChange={(e) => setIntervalMs(parseInt(e.target.value, 10) || 0)}
              disabled={controlsLocked}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-500">{t("demo.selectModel")}</label>
          <select
            className="input-field"
            value={selectedModel}
            onChange={(e) => {
              setSelectedModel(e.target.value);
              setResult(null);
              setCardState("pending");
            }}
            disabled={controlsLocked}
          >
            {poolGroups.map((group) => (
              <optgroup
                key={group.pool}
                label={
                  group.tblb_enabled
                    ? t("tblbDemo.optgroupTblb", { pool: group.pool_short })
                    : t("tblbDemo.optgroupNoTblb", { pool: group.pool_short })
                }
              >
                {group.models.map((m) => (
                  <option key={m} value={m}>
                    {group.tblb_enabled
                      ? t("tblbDemo.optionTblb", { model: m })
                      : m}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {selectedPool && (
            <p className="mt-1.5 text-xs text-slate-500">
              {selectedPool.tblb_enabled ? (
                <span className="text-emerald-400/90">{t("tblbDemo.selectHintTblb")}</span>
              ) : (
                <span>{t("tblbDemo.selectHintNoTblb")}</span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={runTest}
            disabled={controlsLocked || !config}
          >
            {running
              ? t("app.running")
              : cooldownSec > 0
                ? t("tblbDemo.runDemoCooldown", { sec: cooldownSec })
                : t("tblbDemo.runDemo", { count: testCount })}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={checkHealth}
            disabled={controlsLocked}
          >
            {t("app.healthCheck")}
          </button>
        </div>

        {cooldownSec > 0 && (
          <p className="text-sm text-amber-400">
            {t("tblbDemo.cooldownHint", { sec: cooldownSec })}
          </p>
        )}
        {triggeringLoad && (
          <p className="text-sm text-cyan-400">{t("tblbDemo.triggerRunning")}</p>
        )}

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
        <p className="text-xs text-slate-500">{t("tblbDemo.hint")}</p>
      </div>

      <div className="space-y-4">
        {selectedPool && displayResult ? (
          <TblbPoolPanel
            pool={selectedPool}
            models={[{ model: selectedModel, result: displayResult, state: cardState }]}
            scheduler={
              schedulerByPool[selectedPool.pool_short] ?? emptySchedulerState()
            }
            schedulerTarget={schedulerTarget}
            schedulerPartition={schedulerPartition}
            onRefreshScheduler={() => loadSchedulerForPool(selectedPool.pool_short)}
            onTriggerMemberLoad={() => void handleTriggerMemberLoad()}
            refreshDisabled={controlsLocked}
            triggerDisabled={
              controlsLocked ||
              !schedulerByPool[selectedPool.pool_short]?.data?.members?.length
            }
            triggeringLoad={triggeringLoad}
            triggerResults={triggerResults}
          />
        ) : (
          <p className="text-sm text-slate-500">{t("tblbDemo.noResults")}</p>
        )}
      </div>
    </div>
  );
}

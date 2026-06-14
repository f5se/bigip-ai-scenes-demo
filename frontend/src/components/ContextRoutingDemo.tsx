import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  calcContextRouting,
  fetchContextRoutingConfig,
  runContextMultiturnDemo,
  runContextSingleDemo,
  type ContextProxyBundle,
  type ContextSizeConfig,
  type Target,
} from "@/api/client";
import { ContextSizeResultCard } from "./ContextSizeResultCard";
import {
  ConversationTimeline,
  type TimelineStep,
} from "./ConversationTimeline";

type CardState = "pending" | "active" | "success" | "error";

export function ContextRoutingDemo() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ContextSizeConfig | null>(null);
  const [target, setTarget] = useState<Target>({ host: "172.16.30.122", port: 8000 });
  const [targetBytes, setTargetBytes] = useState(5 * 1024 - 128);
  const [previewBytes, setPreviewBytes] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const [singleResult, setSingleResult] = useState<ContextProxyBundle | null>(null);
  const [singleState, setSingleState] = useState<CardState>("pending");

  const [underResult, setUnderResult] = useState<ContextProxyBundle | null>(null);
  const [overResult, setOverResult] = useState<ContextProxyBundle | null>(null);
  const [underState, setUnderState] = useState<CardState>("pending");
  const [overState, setOverState] = useState<CardState>("pending");
  const [showMultiturn, setShowMultiturn] = useState(false);
  const [multiturnTimeline, setMultiturnTimeline] = useState<TimelineStep[]>([]);
  const [crossStep, setCrossStep] = useState<number | undefined>(undefined);

  useEffect(() => {
    fetchContextRoutingConfig()
      .then((c) => {
        setConfig(c);
        setTarget(c.default_vs);
        setTargetBytes(c.rule.threshold_bytes - 128);
        if (c.timeline?.length) {
          setMultiturnTimeline(c.timeline);
          const crossIdx = c.timeline.findIndex(
            (s) => s.cumulative_bytes > c.rule.threshold_bytes
          );
          setCrossStep(crossIdx >= 0 ? c.timeline[crossIdx].step : undefined);
        }
      })
      .catch(() => setGlobalError("Failed to load context routing config"));
  }, []);

  useEffect(() => {
    if (!config) return;
    const timer = setTimeout(() => {
      calcContextRouting(targetBytes)
        .then((r) => setPreviewBytes(r.messages_bytes))
        .catch(() => setPreviewBytes(null));
    }, 200);
    return () => clearTimeout(timer);
  }, [targetBytes, config]);

  const runSingle = useCallback(async () => {
    if (!config) return;
    setRunning(true);
    setGlobalError(null);
    setShowMultiturn(false);
    setSingleState("active");
    setSingleResult(null);
    setUnderState("pending");
    setOverState("pending");
    setUnderResult(null);
    setOverResult(null);
    try {
      const r = await runContextSingleDemo(target, targetBytes);
      setSingleResult({
        model: config.rule.model,
        messages_bytes: r.messages_bytes,
        content_chars: r.content_chars,
        route: r.route,
        proxy: r.proxy,
        label_key: "contextSize.singleShot",
      });
      const ok =
        r.proxy.error === null && r.proxy.status_code === 200;
      setSingleState(ok ? "success" : "error");
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e));
      setSingleState("error");
    } finally {
      setRunning(false);
    }
  }, [config, target, targetBytes]);

  const runMultiturn = useCallback(async () => {
    if (!config) return;
    setRunning(true);
    setGlobalError(null);
    setShowMultiturn(true);
    setSingleState("pending");
    setSingleResult(null);
    setUnderState("active");
    setOverState("pending");
    setUnderResult(null);
    setOverResult(null);
    setMultiturnTimeline([]);
    setCrossStep(undefined);
    try {
      const r = await runContextMultiturnDemo(target);
      const timeline = (r.timeline ?? r.under.timeline ?? []) as TimelineStep[];
      setMultiturnTimeline(timeline);
      const crossIdx = timeline.findIndex(
        (s) => s.cumulative_bytes > (config?.rule.threshold_bytes ?? 5120)
      );
      setCrossStep(crossIdx >= 0 ? timeline[crossIdx].step : undefined);

      setUnderResult({
        ...r.under,
        label_key: "contextSize.underThreshold",
        turns: r.under.turns,
        trigger: r.under.trigger,
        conversation_preview: r.under.conversation_preview,
        timeline: r.under.timeline,
        dialogue_rounds: r.under.dialogue_rounds,
      });
      const underOk =
        r.under.proxy.error === null && r.under.proxy.status_code === 200;
      setUnderState(underOk ? "success" : "error");

      setOverState("active");
      await new Promise((res) => setTimeout(res, 400));

      setOverResult({
        ...r.over,
        label_key: "contextSize.overThreshold",
        turns: r.over.turns,
        trigger: r.over.trigger,
        conversation_preview: r.over.conversation_preview,
        timeline: r.over.timeline,
        dialogue_rounds: r.over.dialogue_rounds,
      });
      const overOk =
        r.over.proxy.error === null && r.over.proxy.status_code === 200;
      setOverState(overOk ? "success" : "error");
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : String(e));
      setUnderState("error");
      setOverState("error");
    } finally {
      setRunning(false);
    }
  }, [config, target]);

  const rule = config?.rule;
  const threshold = rule?.threshold_bytes ?? 5120;
  const previewOver = (previewBytes ?? 0) > threshold;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-300">
          {t("contextSize.targetVs")}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              {t("demo.host")}
            </label>
            <input
              className="input-field font-mono"
              value={target.host}
              onChange={(e) => setTarget((t) => ({ ...t, host: e.target.value }))}
              disabled={running}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-500">
              {t("demo.port")}
            </label>
            <input
              className="input-field font-mono"
              type="number"
              value={target.port}
              onChange={(e) =>
                setTarget((t) => ({
                  ...t,
                  port: parseInt(e.target.value, 10) || 8000,
                }))
              }
              disabled={running}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs text-slate-500">
            {t("contextSize.modelFixed")}
          </label>
          <input
            className="input-field font-mono opacity-80"
            value={rule?.model ?? "deepseek-chat"}
            readOnly
          />
        </div>

        {rule && (
          <p className="rounded-lg bg-slate-900/80 p-2 font-mono text-xs text-slate-500 break-all">
            DG: {rule.dg_value}
          </p>
        )}

        <div>
          <label className="mb-1 block text-xs text-slate-500">
            {t("contextSize.targetMessagesBytes")}
          </label>
          <input
            type="range"
            min={1024}
            max={12 * 1024}
            step={64}
            value={targetBytes}
            onChange={(e) => setTargetBytes(parseInt(e.target.value, 10))}
            disabled={running}
            className="w-full accent-cyan-500"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-cyan-300">{targetBytes} B</span>
            {previewBytes != null && (
              <span
                className={`text-xs ${previewOver ? "text-orange-400" : "text-emerald-400"}`}
              >
                {t("contextSize.previewCalc", { bytes: previewBytes })}
                {previewOver
                  ? ` → ${t("contextSize.tierLarge")}`
                  : ` → ${t("contextSize.tierSmall")}`}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {config?.presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:border-cyan-500/50"
                onClick={() => setTargetBytes(p.bytes)}
                disabled={running}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={runSingle}
            disabled={running || !config}
          >
            {running && !showMultiturn
              ? t("app.running")
              : t("contextSize.sendSized")}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={runMultiturn}
            disabled={running || !config}
          >
            {t("contextSize.simulateMultiturn")}
          </button>
        </div>

        {config?.multiturn_preview && (
          <p className="text-xs text-slate-500">
            {t("contextSize.multiturnHint", {
              under: config.multiturn_preview.under_bytes,
              over: config.multiturn_preview.over_bytes,
              underTurns: config.multiturn_preview.under_turns,
              overTurns: config.multiturn_preview.over_turns,
            })}
          </p>
        )}

        {globalError && (
          <p className="text-sm text-red-400">{globalError}</p>
        )}
      </div>

      <div className="space-y-3">
        {showMultiturn && rule ? (
          <>
            <p className="text-sm font-medium text-white">
              {t("contextSize.workScenarioTitle")}
            </p>
            <p className="text-xs text-slate-500">
              {t("contextSize.workScenarioDesc")}
            </p>
            {multiturnTimeline.length > 0 && (
              <ConversationTimeline
                timeline={multiturnTimeline}
                threshold={rule.threshold_bytes}
                highlightFromStep={crossStep}
              />
            )}
            <p className="text-xs font-medium text-cyan-400/90">
              {t("contextSize.multiturnTitle")}
            </p>
            {underResult ? (
              <ContextSizeResultCard
                result={underResult}
                rule={rule}
                state={underState}
              />
            ) : (
              <PlaceholderCard state={underState} label={t("contextSize.underThreshold")} />
            )}
            <div className="rounded-lg border border-orange-500/30 bg-orange-950/20 px-3 py-2 text-center text-xs text-orange-200">
              {t("contextSize.crossingArrow")}
            </div>
            {overResult ? (
              <ContextSizeResultCard
                result={overResult}
                rule={rule}
                state={overState}
              />
            ) : (
              <PlaceholderCard state={overState} label={t("contextSize.overThreshold")} />
            )}
          </>
        ) : rule && singleResult ? (
          <ContextSizeResultCard
            result={singleResult}
            rule={rule}
            state={singleState}
          />
        ) : rule ? (
          <PlaceholderCard
            state={singleState}
            label={t("contextSize.noResults")}
          />
        ) : null}
      </div>
    </div>
  );
}

function PlaceholderCard({
  state,
  label,
}: {
  state: CardState;
  label: string;
}) {
  return (
    <div
      className={`rounded-lg border bg-slate-900/40 p-4 text-sm text-slate-500 ${
        state === "active" ? "border-cyan-500/50 animate-pulse" : "border-slate-700"
      }`}
    >
      {label}
    </div>
  );
}

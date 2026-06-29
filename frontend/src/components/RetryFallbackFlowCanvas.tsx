import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  RetryFallbackConfig,
  RetryStatusResult,
  Target,
  TcpForceFallbackResult,
  TcpReselectResult,
} from "@/api/client";

export type FlowScenario = "status-retry" | "tcp-reselect" | "tcp-fallback";
export type FlowPhase = "idle" | "running" | "replay" | "done" | "error";

export type ReplayData = RetryStatusResult | TcpReselectResult | TcpForceFallbackResult | null;

type NodeVisualState =
  | "idle"
  | "active"
  | "retry"
  | "reselect"
  | "fallback"
  | "success"
  | "terminal"
  | "offline"
  | "error";

type FlowSegment =
  | null
  | "c-f5"
  | "f5-pool"
  | "pool-member"
  | "m-f5"
  | "f5-fb"
  | "fb-f5"
  | "f5-c";

type FlowFrame = {
  flowSegment: FlowSegment;
  flowDotMode: "flow" | "bounce" | null;
  client: NodeVisualState;
  f5: NodeVisualState;
  primaryPool: NodeVisualState;
  fallbackPool: NodeVisualState;
  primaryMember: NodeVisualState;
  badMember7999: NodeVisualState;
  goodMember8005: NodeVisualState;
  show503: boolean;
  showTcpFail7999: boolean;
  showTcpFail8005: boolean;
  showReselectBadge: boolean;
  showExhausted: boolean;
  showFallbackArc: boolean;
  showReselectArc: boolean;
  showTerminal: boolean;
  dgLabel: string | null;
  retryLabel: string | null;
  memberRequests: number | null;
  serverPort: number | null;
};

type TimelineStep = {
  labelKey: string;
  labelParams?: Record<string, string | number>;
  durationMs: number;
  frame: FlowFrame;
};

const IDLE_FRAME: FlowFrame = {
  flowSegment: null,
  flowDotMode: null,
  client: "idle",
  f5: "idle",
  primaryPool: "idle",
  fallbackPool: "idle",
  primaryMember: "idle",
  badMember7999: "idle",
  goodMember8005: "idle",
  show503: false,
  showTcpFail7999: false,
  showTcpFail8005: false,
  showReselectBadge: false,
  showExhausted: false,
  showFallbackArc: false,
  showReselectArc: false,
  showTerminal: false,
  dgLabel: null,
  retryLabel: null,
  memberRequests: null,
  serverPort: null,
};

function shortPool(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function mergeFrame(base: FlowFrame, patch: Partial<FlowFrame>): FlowFrame {
  return { ...base, ...patch };
}

function nodeClass(state: NodeVisualState, kind: "client" | "vs" | "pool" | "member"): string {
  const base = "rounded-lg border px-2 py-2 text-center text-xs transition-all duration-300";
  switch (state) {
    case "active":
      return kind === "vs"
        ? `${base} agent-node-breathe border-cyan-400 bg-cyan-950/50 text-cyan-100 shadow-cyan-500/30`
        : `${base} border-cyan-400 bg-cyan-950/40 text-cyan-200`;
    case "retry":
      return `${base} border-amber-500/70 bg-amber-950/35 text-amber-200 animate-pulse`;
    case "reselect":
      return `${base} border-amber-500/60 bg-amber-950/30 text-amber-100`;
    case "fallback":
      return `${base} border-violet-500/60 bg-violet-950/35 text-violet-100`;
    case "success":
      return `${base} border-emerald-500/60 bg-emerald-950/40 text-emerald-200`;
    case "terminal":
      return `${base} border-red-500/60 bg-red-950/35 text-red-200`;
    case "offline":
      return `${base} border-red-500/40 bg-red-950/20 text-red-300/80 line-through decoration-red-400/60`;
    case "error":
      return `${base} border-red-500/50 bg-red-950/30 text-red-300`;
    default:
      return `${base} border-slate-600/80 bg-slate-900/50 text-slate-400`;
  }
}

function buildStatusSteps(data: RetryStatusResult): TimelineStep[] {
  const before = data.member_stats.before.total_requests ?? 0;
  const delta = Math.max(data.member_stats.delta_requests ?? 0, 1);
  const terminal = data.result.terminal_retry;
  const fallback = data.result.fallback_to_default || terminal;

  const steps: TimelineStep[] = [];
  let frame = { ...IDLE_FRAME };

  steps.push({
    labelKey: "retryFallback.animation.status.stepInbound",
    durationMs: 900,
    frame: mergeFrame(frame, {
      flowSegment: "c-f5",
      flowDotMode: "flow",
      client: "active",
      f5: "active",
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.status.stepRoute",
    durationMs: 1000,
    frame: mergeFrame(frame, {
      flowSegment: "f5-pool",
      flowDotMode: "flow",
      f5: "active",
      primaryPool: "active",
      dgLabel: `${data.retry_model} → ${shortPool(data.primary_pool)}`,
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.status.stepHit503",
    durationMs: 1000,
    frame: mergeFrame(frame, {
      flowSegment: "pool-member",
      flowDotMode: "flow",
      primaryMember: "retry",
      show503: true,
      memberRequests: before + 1,
    }),
  });
  frame = steps[steps.length - 1].frame;

  for (let i = 0; i < delta; i++) {
    steps.push({
      labelKey: "retryFallback.animation.status.stepRetry",
      labelParams: { count: i + 1 },
      durationMs: 600,
      frame: mergeFrame(frame, {
        flowSegment: "m-f5",
        flowDotMode: "bounce",
        f5: "retry",
        primaryMember: "retry",
        show503: false,
        retryLabel: `${i + 1}/${delta}`,
        memberRequests: before + i + 1,
      }),
    });
    frame = steps[steps.length - 1].frame;
  }

  if (fallback) {
    steps.push({
      labelKey: "retryFallback.animation.status.stepFallback",
      durationMs: 1100,
      frame: mergeFrame(frame, {
        flowSegment: "f5-fb",
        flowDotMode: "flow",
        f5: "fallback",
        primaryPool: "idle",
        fallbackPool: terminal ? "terminal" : "fallback",
        showFallbackArc: true,
        showTerminal: terminal,
      }),
    });
    frame = steps[steps.length - 1].frame;

    steps.push({
      labelKey: "retryFallback.animation.status.stepResponse",
      durationMs: 1000,
      frame: mergeFrame(frame, {
        flowSegment: "f5-c",
        flowDotMode: "flow",
        client: "success",
        f5: terminal ? "terminal" : "success",
        fallbackPool: terminal ? "terminal" : "success",
        showFallbackArc: true,
        showTerminal: terminal,
      }),
    });
  } else {
    steps.push({
      labelKey: "retryFallback.animation.status.stepResponse",
      durationMs: 1000,
      frame: mergeFrame(frame, {
        flowSegment: "f5-c",
        flowDotMode: "flow",
        client: "success",
        f5: "success",
        primaryMember: "success",
      }),
    });
  }

  return steps;
}

function buildTcpReselectSteps(data: TcpReselectResult): TimelineStep[] {
  const port = data.result.expected_server_port;
  const extraAttempts = Math.min(Math.max(data.attempts.length - 1, 0), 2);
  const steps: TimelineStep[] = [];
  let frame = { ...IDLE_FRAME };

  steps.push({
    labelKey: "retryFallback.animation.tcpReselect.stepInbound",
    durationMs: 900,
    frame: mergeFrame(frame, {
      flowSegment: "c-f5",
      flowDotMode: "flow",
      client: "active",
      f5: "active",
      dgLabel: "deepseek-chat",
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpReselect.stepPool",
    durationMs: 900,
    frame: mergeFrame(frame, {
      flowSegment: "f5-pool",
      flowDotMode: "flow",
      primaryPool: "active",
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpReselect.stepTcpFail",
    durationMs: 1000,
    frame: mergeFrame(frame, {
      flowSegment: "pool-member",
      flowDotMode: "flow",
      badMember7999: "retry",
      showTcpFail7999: true,
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpReselect.stepReselect",
    durationMs: 1100,
    frame: mergeFrame(frame, {
      flowSegment: null,
      flowDotMode: null,
      f5: "reselect",
      primaryPool: "reselect",
      showReselectBadge: true,
      showReselectArc: true,
      badMember7999: "idle",
      showTcpFail7999: false,
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpReselect.stepSuccess",
    durationMs: 1000,
    frame: mergeFrame(frame, {
      flowSegment: "pool-member",
      flowDotMode: "flow",
      goodMember8005: "success",
      serverPort: port,
      showReselectArc: false,
    }),
  });
  frame = steps[steps.length - 1].frame;

  for (let i = 0; i < extraAttempts; i++) {
    steps.push({
      labelKey: "retryFallback.animation.tcpReselect.stepStability",
      durationMs: 400,
      frame: mergeFrame(frame, {
        flowSegment: "c-f5",
        flowDotMode: "flow",
        client: "active",
        goodMember8005: "success",
        serverPort: port,
      }),
    });
    frame = steps[steps.length - 1].frame;
  }

  steps.push({
    labelKey: "retryFallback.animation.tcpReselect.stepResponse",
    durationMs: 900,
    frame: mergeFrame(frame, {
      flowSegment: "f5-c",
      flowDotMode: "flow",
      client: "success",
      f5: "success",
      goodMember8005: "success",
      serverPort: port,
    }),
  });

  return steps;
}

function buildTcpFallbackSteps(data: TcpForceFallbackResult): TimelineStep[] {
  const terminal = data.result.terminal_retry;
  const fallback = data.result.fallback_to_default || terminal;
  const steps: TimelineStep[] = [];
  let frame = { ...IDLE_FRAME };

  steps.push({
    labelKey: "retryFallback.animation.tcpFallback.stepPrepOffline",
    durationMs: 900,
    frame: mergeFrame(frame, {
      goodMember8005: "offline",
      primaryPool: "retry",
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpFallback.stepInbound",
    durationMs: 900,
    frame: mergeFrame(frame, {
      flowSegment: "c-f5",
      flowDotMode: "flow",
      client: "active",
      f5: "active",
      dgLabel: "deepseek-chat",
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpFallback.stepPool",
    durationMs: 900,
    frame: mergeFrame(frame, {
      flowSegment: "f5-pool",
      flowDotMode: "flow",
      primaryPool: "active",
      goodMember8005: "offline",
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpFallback.stepTcpFail7999",
    durationMs: 1000,
    frame: mergeFrame(frame, {
      flowSegment: "pool-member",
      flowDotMode: "flow",
      badMember7999: "retry",
      showTcpFail7999: true,
      goodMember8005: "offline",
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpFallback.stepTcpFail8005",
    durationMs: 1000,
    frame: mergeFrame(frame, {
      flowSegment: "pool-member",
      flowDotMode: "flow",
      goodMember8005: "retry",
      showTcpFail8005: true,
      badMember7999: "idle",
      showTcpFail7999: false,
    }),
  });
  frame = steps[steps.length - 1].frame;

  steps.push({
    labelKey: "retryFallback.animation.tcpFallback.stepExhausted",
    durationMs: 900,
    frame: mergeFrame(frame, {
      flowSegment: null,
      flowDotMode: null,
      primaryPool: "reselect",
      showExhausted: true,
      badMember7999: "retry",
      goodMember8005: "offline",
    }),
  });
  frame = steps[steps.length - 1].frame;

  if (fallback) {
    steps.push({
      labelKey: "retryFallback.animation.tcpFallback.stepFallback",
      durationMs: 1100,
      frame: mergeFrame(frame, {
        flowSegment: "f5-fb",
        flowDotMode: "flow",
        f5: "fallback",
        fallbackPool: terminal ? "terminal" : "fallback",
        showFallbackArc: true,
        showExhausted: false,
        showTerminal: terminal,
      }),
    });
    frame = steps[steps.length - 1].frame;
  }

  steps.push({
    labelKey: "retryFallback.animation.tcpFallback.stepResponse",
    durationMs: 1000,
    frame: mergeFrame(frame, {
      flowSegment: "f5-c",
      flowDotMode: "flow",
      client: terminal ? "idle" : "success",
      f5: terminal ? "terminal" : "success",
      fallbackPool: fallback ? (terminal ? "terminal" : "success") : "idle",
      showFallbackArc: fallback,
      showTerminal: terminal,
    }),
  });

  return steps;
}

function buildTimeline(
  scenario: FlowScenario,
  replayData: ReplayData
): TimelineStep[] {
  if (!replayData) return [];
  if (scenario === "status-retry" && replayData.kind === "status-retry") {
    return buildStatusSteps(replayData);
  }
  if (scenario === "tcp-reselect" && replayData.kind === "tcp-reselect") {
    return buildTcpReselectSteps(replayData);
  }
  if (scenario === "tcp-fallback" && replayData.kind === "tcp-force-fallback") {
    return buildTcpFallbackSteps(replayData);
  }
  return [];
}

function FlowLink({
  active,
  dotMode,
}: {
  active: boolean;
  dotMode: "flow" | "bounce" | null;
}) {
  return (
    <div className="relative flex min-w-[48px] flex-1 items-center px-1">
      <div
        className={`h-px w-full border-t border-dashed transition-colors duration-300 ${
          active ? "border-cyan-400" : "border-slate-600"
        }`}
      />
      {active && dotMode === "flow" && (
        <span className="agent-flow-dot absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-lg shadow-cyan-400/80" />
      )}
      {active && dotMode === "bounce" && (
        <span className="retry-bounce-dot absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300 shadow-lg shadow-amber-400/80" />
      )}
    </div>
  );
}

type Props = {
  scenario: FlowScenario;
  phase: FlowPhase;
  target: Target;
  config: RetryFallbackConfig | null;
  replayData: ReplayData;
  embedded?: boolean;
  onReplayComplete?: () => void;
};

export function RetryFallbackFlowCanvas({
  scenario,
  phase,
  target,
  config,
  replayData,
  embedded = false,
  onReplayComplete,
}: Props) {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(-1);
  const [frame, setFrame] = useState<FlowFrame>(IDLE_FRAME);
  const [replayToken, setReplayToken] = useState(0);
  const timersRef = useRef<number[]>([]);

  const timeline = useMemo(
    () => buildTimeline(scenario, replayData),
    [scenario, replayData]
  );

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  const startReplay = useCallback(() => {
    clearTimers();
    if (timeline.length === 0) return;
    setStepIndex(0);
    setFrame(timeline[0].frame);
    let idx = 1;
    const schedule = () => {
      if (idx >= timeline.length) {
        const last = timeline.length - 1;
        setStepIndex(last);
        setFrame(timeline[last].frame);
        onReplayComplete?.();
        return;
      }
      const prev = timeline[idx - 1];
      const id = window.setTimeout(() => {
        setStepIndex(idx);
        setFrame(timeline[idx].frame);
        idx += 1;
        schedule();
      }, prev.durationMs);
      timersRef.current.push(id);
    };
    schedule();
  }, [clearTimers, onReplayComplete, timeline]);

  const handleReplayAgain = useCallback(() => {
    setReplayToken((x) => x + 1);
  }, []);

  useEffect(() => {
    if (phase === "done") {
      return;
    }
    clearTimers();
    if (phase === "idle") {
      if (replayToken === 0) {
        setStepIndex(-1);
        setFrame(IDLE_FRAME);
      }
      return;
    }
    if (phase === "running") {
      setReplayToken(0);
      setStepIndex(-1);
      setFrame(
        mergeFrame(IDLE_FRAME, {
          f5: "active",
          primaryPool: scenario !== "status-retry" ? "active" : "idle",
        })
      );
      return;
    }
    if (phase === "error") {
      setStepIndex(-1);
      setFrame(mergeFrame(IDLE_FRAME, { f5: "error" }));
      return;
    }
    if (phase === "replay") {
      startReplay();
    }
    return clearTimers;
  }, [phase, scenario, startReplay, clearTimers, replayToken]);

  useEffect(() => {
    if (replayToken === 0) return;
    if (timeline.length === 0) return;
    startReplay();
    return clearTimers;
  }, [replayToken, timeline, startReplay, clearTimers]);

  const primaryPoolName = useMemo(() => {
    if (!config) return "pool";
    if (scenario === "status-retry") {
      return shortPool(config.rule.retry_primary_pool);
    }
    return shortPool(config.rule.tcp_pool);
  }, [config, scenario]);

  const fallbackPoolName = useMemo(() => {
    if (!config) return "pool_llm_default";
    if (scenario === "status-retry") {
      return shortPool(config.rule.retry_fallback_pool);
    }
    return shortPool(config.rule.retry_fallback_pool);
  }, [config, scenario]);

  const primaryMemberLabel = useMemo(() => {
    if (!config || scenario !== "status-retry") return "member";
    const m = config.rule.default_member;
    return `${m.node}:${m.port}`;
  }, [config, scenario]);

  const badMemberLabel = config
    ? `${config.rule.tcp_bad_member.node}:${config.rule.tcp_bad_member.port}`
    : "ubuntu-ai:7999";
  const goodMemberLabel = config
    ? `${config.rule.tcp_good_member.node}:${config.rule.tcp_good_member.port}`
    : "ubuntu-ai:8005";

  const statusMemberLabel =
    replayData?.kind === "status-retry" ? replayData.member : primaryMemberLabel;

  const showFallbackPool = scenario === "status-retry" || scenario === "tcp-fallback";
  const showTcpMembers = scenario === "tcp-reselect" || scenario === "tcp-fallback";
  const modelLabel =
    scenario === "status-retry"
      ? config?.rule.retry_model ?? "testmodel"
      : config?.rule.tcp_demo_models[0] ?? "deepseek-chat";

  const runningF5 = phase === "running";
  const f5State: NodeVisualState =
    phase === "error" ? "error" : runningF5 || frame.f5 !== "idle" ? frame.f5 : "idle";

  const wrapperClass = embedded
    ? "rounded-lg border border-slate-700/80 bg-slate-950/50 p-3"
    : "glass-card overflow-hidden p-4";

  return (
    <div className={wrapperClass}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase text-cyan-400/90">
          {t("retryFallback.animation.topologyTitle")}
        </p>
        {replayData && timeline.length > 0 && phase !== "running" && phase !== "error" && (
          <button
            type="button"
            className="btn-secondary py-1 text-xs"
            onClick={handleReplayAgain}
          >
            {t("retryFallback.animation.replayAgain")}
          </button>
        )}
      </div>

      {phase === "running" && (
        <p className="mb-3 text-xs text-cyan-300">{t("retryFallback.animation.preparing")}</p>
      )}
      {phase === "error" && (
        <p className="mb-3 text-xs text-red-400">{t("retryFallback.animation.error")}</p>
      )}

      <div className="overflow-x-auto pb-1">
        <div className="relative min-w-[720px]">
          <div className="grid grid-cols-[minmax(88px,1fr)_auto_minmax(120px,1.2fr)_auto_minmax(200px,1.6fr)] items-center gap-1">
            <div className={nodeClass(frame.client, "client")}>
              Client
              <div className="mt-1 font-mono text-[10px] text-slate-500">model={modelLabel}</div>
            </div>

            <FlowLink
              active={frame.flowSegment === "c-f5" || frame.flowSegment === "f5-c"}
              dotMode={frame.flowDotMode}
            />

            <div className={`relative ${nodeClass(f5State, "vs")}`}>
              F5 VS
              <div className="mt-1 font-mono text-[10px] font-normal text-slate-400">
                {target.host}:{target.port}
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                {t("retryFallback.animation.layeredVs")}
              </div>
              {frame.dgLabel && (
                <div className="mt-1 rounded bg-slate-950/60 px-1 py-0.5 font-mono text-[10px] text-cyan-300">
                  {frame.dgLabel}
                </div>
              )}
              {frame.retryLabel && (
                <div className="mt-1 text-[10px] font-semibold text-amber-300">
                  Retry {frame.retryLabel}
                </div>
              )}
              {frame.showReselectBadge && (
                <div className="mt-1 rounded border border-amber-500/50 bg-amber-950/40 px-1 py-0.5 text-[10px] text-amber-200">
                  {t("retryFallback.animation.badgeReselect")}
                </div>
              )}
              {frame.showTerminal && (
                <div className="mt-1 text-[10px] text-red-300">
                  {t("retryFallback.animation.badgeTerminal")}
                </div>
              )}
            </div>

            <FlowLink
              active={
                frame.flowSegment === "f5-pool" ||
                frame.flowSegment === "pool-member" ||
                frame.flowSegment === "m-f5"
              }
              dotMode={frame.flowDotMode}
            />

            <div className="space-y-3">
              <div
                className={`relative rounded-lg border p-3 transition-all duration-300 ${
                  frame.primaryPool === "active"
                    ? "border-cyan-400/60 bg-cyan-950/20"
                    : frame.primaryPool === "reselect"
                      ? "border-amber-500/50 bg-amber-950/15"
                      : frame.showExhausted
                        ? "border-amber-500/60 bg-amber-950/20"
                        : "border-slate-700/80 bg-slate-900/30"
                }`}
              >
                <p className="mb-2 text-center text-xs font-semibold text-slate-200">
                  {primaryPoolName}
                </p>
                {frame.showExhausted && (
                  <p className="mb-2 text-center text-[10px] font-medium text-amber-300">
                    {t("retryFallback.animation.badgeExhausted")}
                  </p>
                )}

                {showTcpMembers ? (
                  <div className="relative grid gap-2">
                    {frame.showReselectArc && (
                      <svg
                        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        aria-hidden
                      >
                        <path
                          d="M 25 22 Q 50 50 75 78"
                          fill="none"
                          stroke="rgb(245 158 11 / 0.85)"
                          strokeWidth="2"
                          vectorEffect="non-scaling-stroke"
                          className="reselect-arc-path"
                        />
                      </svg>
                    )}
                    <div
                      className={`${nodeClass(frame.badMember7999, "member")} ${
                        frame.showTcpFail7999 ? "tcp-fail-flash" : ""
                      }`}
                    >
                      <code className="text-[10px]">{badMemberLabel}</code>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        {t("retryFallback.animation.memberNoListen")}
                      </div>
                      {frame.showTcpFail7999 && (
                        <div className="mt-1 text-[10px] font-bold text-red-400">
                          {t("retryFallback.animation.badgeTcp")}
                        </div>
                      )}
                    </div>
                    <div
                      className={`${nodeClass(frame.goodMember8005, "member")} ${
                        frame.showTcpFail8005 ? "tcp-fail-flash" : ""
                      }`}
                    >
                      <code className="text-[10px]">{goodMemberLabel}</code>
                      {frame.goodMember8005 === "offline" && (
                        <div className="mt-0.5 text-[10px] text-red-300">
                          {t("retryFallback.animation.memberOffline")}
                        </div>
                      )}
                      {frame.showTcpFail8005 && (
                        <div className="mt-1 text-[10px] font-bold text-red-400">
                          {t("retryFallback.animation.badgeTcp")}
                        </div>
                      )}
                      {frame.serverPort != null && frame.goodMember8005 === "success" && (
                        <div className="mt-1 text-[10px] text-emerald-400">
                          server_port={frame.serverPort}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    className={`${nodeClass(frame.primaryMember, "member")} ${
                      frame.show503 ? "tcp-fail-flash" : ""
                    }`}
                  >
                    <code className="text-[10px]">{statusMemberLabel}</code>
                    {frame.memberRequests != null && (
                      <div className="mt-1 text-[10px] text-slate-400">
                        {t("retryFallback.animation.requests")}: {frame.memberRequests}
                      </div>
                    )}
                    {frame.show503 && (
                      <div className="mt-1 text-[10px] font-bold text-red-400">
                        {t("retryFallback.animation.badge503")}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {showFallbackPool && (
                <div className="relative">
                  {frame.showFallbackArc && (
                    <svg
                      className="pointer-events-none absolute -top-4 left-0 h-8 w-full overflow-visible"
                      viewBox="0 0 100 32"
                      preserveAspectRatio="none"
                      aria-hidden
                    >
                      <path
                        d="M 50 0 Q 78 10 50 28"
                        fill="none"
                        stroke="rgb(167 139 250 / 0.9)"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        className="fallback-arc-path"
                      />
                    </svg>
                  )}
                  <div
                    className={nodeClass(
                      frame.fallbackPool === "idle" && phase === "idle" ? "idle" : frame.fallbackPool,
                      "pool"
                    )}
                  >
                    {fallbackPoolName}
                    {frame.fallbackPool === "success" && (
                      <div className="mt-1 text-[10px] text-emerald-400">
                        {t("retryFallback.animation.legend.success")}
                      </div>
                    )}
                  </div>
                  <FlowLink
                    active={frame.flowSegment === "f5-fb" || frame.flowSegment === "fb-f5"}
                    dotMode={frame.flowDotMode}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {timeline.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {timeline.map((step, i) => {
            const showProgress = phase === "replay" || phase === "done" || replayToken > 0;
            const active = showProgress && i === stepIndex;
            const done = showProgress && i < stepIndex;
            return (
              <span
                key={`${step.labelKey}-${i}`}
                className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  active
                    ? "border-cyan-400 bg-cyan-950/50 text-cyan-200"
                    : done
                      ? "border-slate-600 bg-slate-800/60 text-slate-400"
                      : "border-slate-700 bg-slate-900/40 text-slate-500"
                }`}
              >
                {t(step.labelKey, step.labelParams)}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />
          {t("retryFallback.animation.legend.reselect")}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-400" />
          {t("retryFallback.animation.legend.fallback")}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400" />
          {t("retryFallback.animation.legend.success")}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-400" />
          {t("retryFallback.animation.legend.terminal")}
        </span>
      </div>

      <p className={`text-xs text-slate-500 ${embedded ? "mt-2" : "mt-2"}`}>
        {t("retryFallback.animation.topologyHint")}
      </p>
    </div>
  );
}

import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { HeroPhase } from "./heroPhases";
import {
  AGENT_COLLAB,
  AGENT_IDS,
  AGENTS,
  AI_BOX,
  BADGE_ZONE,
  EXTERNAL_BURST,
  EXTERNAL_IDS,
  EXTERNALS,
  GATEWAY,
  MULTI_ROUND,
  OBS_METRICS_DEMO,
  OBS_PANEL,
  USER,
  VIEW_H,
  VIEW_W,
  type AgentId,
  type ExternalId,
} from "./heroLayout";
import {
  aiToUserPath,
  buildCollabPath,
  buildConnectionPath,
  type HeroVariant,
  userToAiPath,
} from "./heroPaths";

interface HeroCanvasProps {
  variant: HeroVariant;
  phase: HeroPhase;
  externalCalls: number;
  phaseProgress: number;
}

function agentActive(phase: HeroPhase, id: AgentId, phaseProgress: number): boolean {
  if (phase < 1) return false;
  if (phase === 1) {
    const order: AgentId[] = ["orchestrator", "search", "execute"];
    const idx = order.indexOf(id);
    return phaseProgress > idx * 0.28;
  }
  return phase >= 1 && phase < 6;
}

function internalOpacity(phase: HeroPhase): number {
  if (phase < 5) return 1;
  if (phase === 5) return 0.28;
  return 0.35;
}

function FlowParticle({
  pathD,
  color,
  show,
  delay = 0,
  duration = 1.4,
}: {
  pathD: string;
  color: string;
  show: boolean;
  delay?: number;
  duration?: number;
}) {
  const id = useId().replace(/:/g, "");
  if (!show) return null;
  return (
    <g className="hero-particle-group">
      <path id={id} d={pathD} fill="none" stroke="none" />
      <circle r={4.5} fill={color}>
        <animateMotion
          dur={`${duration}s`}
          repeatCount="indefinite"
          begin={`${delay}s`}
          calcMode="linear"
        >
          <mpath href={`#${id}`} />
        </animateMotion>
      </circle>
    </g>
  );
}

function ConclusionBadges({ variant, show }: { variant: HeroVariant; show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;

  const isGated = variant === "gated";
  const badgeX = BADGE_ZONE.centerX - BADGE_ZONE.width / 2;
  const keys = isGated
    ? ([
        "home.hero.badges.gated.obs",
        "home.hero.badges.gated.route",
        "home.hero.badges.gated.security",
      ] as const)
    : ([
        "home.hero.badges.ungated.obs",
        "home.hero.badges.ungated.policy",
        "home.hero.badges.ungated.security",
      ] as const);

  return (
    <g>
      {BADGE_ZONE.ys.map((y, i) => (
        <g key={keys[i]}>
          <rect
            x={badgeX}
            y={y}
            width={BADGE_ZONE.width}
            height={BADGE_ZONE.height}
            rx={5}
            className={
              isGated
                ? "fill-emerald-950/50 stroke-cyan-500/55"
                : "fill-rose-950/55 stroke-rose-500/50"
            }
            strokeWidth={1.2}
          />
          <text
            x={BADGE_ZONE.centerX}
            y={y + BADGE_ZONE.height / 2 + 4}
            textAnchor="middle"
            className={isGated ? "fill-cyan-100 text-[11px]" : "fill-rose-200 text-[11px]"}
          >
            {t(keys[i])}
          </text>
        </g>
      ))}
    </g>
  );
}

function GatedObsPanel({ show, phaseProgress }: { show: boolean; phaseProgress: number }) {
  const { t, i18n } = useTranslation();
  if (!show) return null;

  const p = Math.min(1, 0.15 + phaseProgress * 0.85);
  const demo = OBS_METRICS_DEMO;
  const requests = Math.max(1, Math.round(demo.requests * p));
  const tokens = Math.max(100, Math.round(demo.tokens * p));
  const mcpCalls = Math.max(0, Math.round(demo.mcpCalls * p));
  const promptBlocked = Math.max(0, Math.round(demo.promptBlocked * p));
  const mcpBlocked = Math.max(0, Math.round(demo.mcpBlocked * p));
  const retryRate = `${(demo.retryRate * p).toFixed(1)}%`;
  const avgTtft = `${Math.max(50, Math.round(demo.avgTtftMs * p))} ms`;
  const cost =
    i18n.language.startsWith("zh")
      ? `¥${(demo.costZh * p).toFixed(2)}`
      : `$${(demo.costEn * p).toFixed(2)}`;

  const { x, y, w, h } = OBS_PANEL;
  const colW = w / 2;
  const rowH = 22;
  const titleH = 20;
  const metrics: { labelKey: string; value: string }[] = [
    { labelKey: "home.hero.obsPanel.requests", value: String(requests) },
    { labelKey: "home.hero.obsPanel.tokens", value: tokens.toLocaleString() },
    { labelKey: "home.hero.obsPanel.cost", value: cost },
    { labelKey: "home.hero.obsPanel.mcpCalls", value: String(mcpCalls) },
    { labelKey: "home.hero.obsPanel.promptBlocked", value: String(promptBlocked) },
    { labelKey: "home.hero.obsPanel.mcpBlocked", value: String(mcpBlocked) },
    { labelKey: "home.hero.obsPanel.retryRate", value: retryRate },
    { labelKey: "home.hero.obsPanel.avgTtft", value: avgTtft },
  ];

  return (
    <g className="hero-obs-panel" opacity={p}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        className="fill-slate-900/85 stroke-cyan-500/45"
        strokeWidth={1.3}
      />
      <text x={x + w / 2} y={y + 15} textAnchor="middle" className="fill-cyan-300 text-[9px] font-semibold">
        {t("home.hero.obsPanel.title")}
      </text>
      <line
        x1={x + 8}
        y1={y + titleH}
        x2={x + w - 8}
        y2={y + titleH}
        stroke="rgba(34,211,238,0.25)"
        strokeWidth={1}
      />
      {metrics.map((m, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cellX = x + col * colW + colW / 2;
        const cellY = y + titleH + 6 + row * rowH;
        return (
          <g key={m.labelKey}>
            <text x={cellX} y={cellY} textAnchor="middle" className="fill-slate-500 text-[7px]">
              {t(m.labelKey)}
            </text>
            <text x={cellX} y={cellY + 12} textAnchor="middle" className="fill-emerald-300 text-[9px] font-mono font-semibold">
              {m.value}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function HeroCanvas({ variant, phase, externalCalls, phaseProgress }: HeroCanvasProps) {
  const { t } = useTranslation();
  const isGated = variant === "gated";
  const internalAlpha = internalOpacity(phase);
  const showCollab = phase >= 2 && phase < 6;
  const showBurst = phase >= 3 && phase < 6;
  const showMulti = phase >= 4 && phase < 6;
  const showUserIn = phase >= 0;
  const showUserOut = phase >= 5;
  const showPhase7 = phase >= 6;

  const burstItems = showBurst
    ? EXTERNAL_BURST.filter((b) => {
        if (phase === 3) return phaseProgress >= b.delay;
        return true;
      })
    : [];

  const multiItems = showMulti
    ? MULTI_ROUND.filter((b) => {
        if (phase === 4) return phaseProgress >= b.delay;
        return true;
      })
    : [];

  const counterW = 180;
  const counterX = AI_BOX.x + AI_BOX.w / 2 - counterW / 2;
  const counterCenterX = AI_BOX.x + AI_BOX.w / 2;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="hero-canvas-svg aspect-[800/450] h-auto w-full min-h-[340px] max-h-[min(450px,calc(100vh-12rem))]"
      role="img"
      aria-label={t(isGated ? "home.hero.ariaGated" : "home.hero.ariaUngated")}
    >
      <defs>
        <filter id="hero-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="gateway-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(34,211,238,0.35)" />
          <stop offset="50%" stopColor="rgba(34,211,238,0.15)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0.35)" />
        </linearGradient>
      </defs>

      {/* User */}
      <g opacity={1}>
        <rect
          x={USER.x - 36}
          y={USER.y - 44}
          width={72}
          height={88}
          rx={9}
          className="fill-slate-800/80 stroke-cyan-500/40"
          strokeWidth={1.3}
        />
        <circle cx={USER.x} cy={USER.y - 19} r={13} className="fill-cyan-900/60 stroke-cyan-400/60" strokeWidth={1.1} />
        <text x={USER.x} y={USER.y + 22} textAnchor="middle" className="fill-slate-300 text-[11px] font-medium">
          {t("home.hero.user")}
        </text>
        {showUserIn && phase < 5 && (
          <path
            d={userToAiPath()}
            fill="none"
            stroke="#22d3ee"
            strokeWidth={2}
            strokeDasharray="5 3"
            className="hero-user-line-in"
            opacity={phase === 0 ? phaseProgress : 1}
          />
        )}
        {showUserOut && (
          <path d={aiToUserPath()} fill="none" stroke="#22d3ee" strokeWidth={2.5} className="hero-user-line-out" />
        )}
        {showUserOut && (
          <text x={USER.x} y={USER.y - 46} textAnchor="middle" className="fill-cyan-300 text-[9px]">
            {t("home.hero.oneAnswer")}
          </text>
        )}
      </g>

      {/* AI App box */}
      <g opacity={internalAlpha}>
        <rect
          x={AI_BOX.x}
          y={AI_BOX.y}
          width={AI_BOX.w}
          height={AI_BOX.h}
          rx={10}
          className="fill-slate-900/50 stroke-slate-600/60"
          strokeWidth={1.2}
          strokeDasharray="4 3"
        />
        <text
          x={AI_BOX.x + AI_BOX.w / 2}
          y={AI_BOX.y + 14}
          textAnchor="middle"
          className="fill-slate-400 text-[10px] font-semibold uppercase tracking-wide"
        >
          {t("home.hero.aiApp")}
        </text>

        {AGENT_IDS.map((id) => {
          const pt = AGENTS[id];
          const active = agentActive(phase, id, phaseProgress);
          return (
            <g key={id}>
              <rect
                x={pt.x - 54}
                y={pt.y - 22}
                width={108}
                height={44}
                rx={7}
                className={
                  active
                    ? "hero-agent-active fill-cyan-950/60 stroke-cyan-400/70"
                    : "fill-slate-800/70 stroke-slate-600/50"
                }
                strokeWidth={1.2}
              />
              <text x={pt.x} y={pt.y + 4} textAnchor="middle" className="fill-slate-200 text-[10px]">
                {t(`home.hero.agents.${id}`)}
              </text>
            </g>
          );
        })}

        {showCollab &&
          AGENT_COLLAB.map(({ from, to }) => (
            <path
              key={`${from}-${to}`}
              d={buildCollabPath(from, to)}
              fill="none"
              stroke="#fbbf24"
              strokeWidth={1.2}
              strokeDasharray="4 3"
              opacity={0.75}
              className="hero-collab-line"
            />
          ))}
      </g>

      {/* Gateway — gated only */}
      {isGated && (
        <g opacity={phase >= 3 ? 1 : 0.45}>
          <rect
            x={GATEWAY.x}
            y={GATEWAY.y}
            width={GATEWAY.w}
            height={GATEWAY.h}
            rx={8}
            fill="url(#gateway-grad)"
            className={phase >= 3 ? "hero-gateway-glow stroke-cyan-400/80" : "stroke-cyan-500/30"}
            strokeWidth={1.5}
            filter={phase >= 3 ? "url(#hero-glow)" : undefined}
          />
          <text
            x={GATEWAY.x + GATEWAY.w / 2}
            y={GATEWAY.y + GATEWAY.h / 2 - 6}
            textAnchor="middle"
            className="fill-cyan-100 text-[10px] font-bold"
          >
            {t("home.hero.gateway")}
          </text>
          <text
            x={GATEWAY.x + GATEWAY.w / 2}
            y={GATEWAY.y + GATEWAY.h / 2 + 8}
            textAnchor="middle"
            className="fill-cyan-400/80 text-[10px]"
          >
            {t("home.hero.gatewaySub")}
          </text>
        </g>
      )}

      {/* External systems */}
      <g opacity={internalAlpha}>
        {EXTERNAL_IDS.map((id) => {
          const pt = EXTERNALS[id];
          const colors: Record<ExternalId, string> = {
            llm: "stroke-violet-400/60 fill-violet-950/40",
            api: "stroke-blue-400/60 fill-blue-950/40",
            mcp: "stroke-emerald-400/60 fill-emerald-950/40",
            rag: "stroke-orange-400/60 fill-orange-950/40",
          };
          return (
            <g key={id}>
              <rect
                x={pt.x - 58}
                y={pt.y - 22}
                width={116}
                height={44}
                rx={7}
                className={colors[id]}
                strokeWidth={1.2}
              />
              <text x={pt.x} y={pt.y + 4} textAnchor="middle" className="fill-slate-200 text-[10px]">
                {t(`home.hero.externals.${id}`)}
              </text>
            </g>
          );
        })}
      </g>

      {/* Connection lines */}
      <g opacity={internalAlpha}>
        {burstItems.map((b) => {
          const seg = buildConnectionPath(variant, b.agent, b.ext);
          return (
            <path
              key={`burst-${b.agent}-${b.ext}`}
              d={seg.d}
              fill="none"
              stroke={seg.color}
              strokeWidth={isGated ? 1.5 : 1.2}
              opacity={isGated ? 0.55 : 0.45}
              className={isGated ? "" : "hero-chaotic-line"}
            />
          );
        })}
        {multiItems.map((b) => {
          const seg = buildConnectionPath(variant, b.agent, b.ext);
          return (
            <path
              key={`multi-${b.agent}-${b.ext}`}
              d={seg.d}
              fill="none"
              stroke={seg.color}
              strokeWidth={1.2}
              opacity={0.4}
              strokeDasharray="3 5"
            />
          );
        })}
      </g>

      {/* Flowing particles */}
      <g opacity={internalAlpha}>
        {burstItems.slice(0, 5).map((b, i) => {
          const seg = buildConnectionPath(variant, b.agent, b.ext);
          return (
            <FlowParticle
              key={`p-burst-${i}`}
              pathD={seg.d}
              color={seg.color}
              show={phase >= 3 && phase < 6}
              delay={i * 0.2}
              duration={isGated ? 1.5 : 1.1}
            />
          );
        })}
      </g>

      {/* Phase 7 conclusion badges — center corridor between AI app and externals */}
      <ConclusionBadges variant={variant} show={showPhase7} />

      {/* Gated phase 7 — BIG-IP observability metrics (below badges) */}
      <GatedObsPanel show={isGated && showPhase7} phaseProgress={phaseProgress} />

      {/* Counter — aligned with AI app column */}
      {(phase >= 3 || showPhase7) && (
        <g>
          <rect
            x={counterX}
            y={VIEW_H - 34}
            width={counterW}
            height={28}
            rx={6}
            className="fill-slate-900/90 stroke-slate-600/50"
            strokeWidth={1}
          />
          <text
            x={counterCenterX}
            y={VIEW_H - 15}
            textAnchor="middle"
            className="fill-slate-300 text-[10px] font-mono"
          >
            {t("home.hero.externalCalls", { count: externalCalls })}
          </text>
        </g>
      )}
    </svg>
  );
}

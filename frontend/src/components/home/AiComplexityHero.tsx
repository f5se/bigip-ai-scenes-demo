import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HeroCanvas } from "./HeroCanvas";
import {
  elapsedInPhase,
  externalCallsForPhase,
  HERO_PHASE_COUNT,
  HERO_PHASE_DURATIONS_MS,
  HERO_TOTAL_MS,
  phaseFromElapsed,
  type HeroPhase,
} from "./heroPhases";
import type { HeroVariant } from "./heroPaths";

type HeroTab = HeroVariant;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

export function AiComplexityHero() {
  const { t } = useTranslation();
  const reducedMotion = usePrefersReducedMotion();

  const [tab, setTab] = useState<HeroTab>("ungated");
  const [sessionActive, setSessionActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [phase, setPhase] = useState<HeroPhase>(0);
  const [phaseProgress, setPhaseProgress] = useState(0);

  const elapsedRef = useRef(0);
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  const externalCalls = externalCallsForPhase(phase);

  const resetClock = useCallback(() => {
    elapsedRef.current = 0;
    lastTsRef.current = null;
    setPhase(0);
    setPhaseProgress(0);
  }, []);

  const startPlay = () => {
    resetClock();
    playingRef.current = true;
    setSessionActive(true);
    setFinished(false);
    setPlaying(true);
  };

  const stopPlay = () => {
    playingRef.current = false;
    setSessionActive(false);
    setPlaying(false);
    setFinished(false);
    resetClock();
  };

  const jumpToPhase = (i: number) => {
    let acc = 0;
    for (let j = 0; j < i; j++) acc += HERO_PHASE_DURATIONS_MS[j];
    lastTsRef.current = null;
    if (playingRef.current) {
      // During auto-play: jump to the start of the phase and let tick advance progress.
      elapsedRef.current = acc;
      setPhaseProgress(0);
    } else {
      // Manual scrub (e.g. after playback ends): show the fully developed frame for that step.
      elapsedRef.current = Math.min(acc + HERO_PHASE_DURATIONS_MS[i] - 1, HERO_TOTAL_MS);
      setPhaseProgress(1);
    }
    setPhase(i as HeroPhase);
    setFinished(i === HERO_PHASE_COUNT - 1);
  };

  const canScrub = sessionActive || reducedMotion;

  const goStep = (dir: -1 | 1) => {
    jumpToPhase(Math.max(0, Math.min(HERO_PHASE_COUNT - 1, phase + dir)));
  };

  const tick = useCallback(
    (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const delta = ts - lastTsRef.current;
      lastTsRef.current = ts;

      if (playingRef.current && !reducedMotion) {
        elapsedRef.current += delta;
        if (elapsedRef.current >= HERO_TOTAL_MS) {
          elapsedRef.current = HERO_TOTAL_MS;
          playingRef.current = false;
          setPlaying(false);
          setFinished(true);
          setSessionActive(true);
          setPhase(6);
          setPhaseProgress(1);
        } else {
          const elapsed = elapsedRef.current;
          const p = phaseFromElapsed(elapsed);
          setPhase(p);
          setPhaseProgress(
            Math.min(1, elapsedInPhase(elapsed, p) / HERO_PHASE_DURATIONS_MS[p])
          );
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    },
    [reducedMotion]
  );

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === sectionRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    const el = sectionRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* browser may block */
    }
  };

  useEffect(() => {
    if (reducedMotion) {
      setPhase(6);
      setPhaseProgress(1);
      setPlaying(false);
      setFinished(true);
      setSessionActive(true);
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick, reducedMotion]);

  const subtitleKey =
    phase === 6 && tab === "gated"
      ? ("home.hero.phases.6Gated" as const)
      : (`home.hero.phases.${phase}` as const);
  const compareKey =
    tab === "ungated" ? "home.hero.compareUngated" : "home.hero.compareGated";

  return (
    <section ref={sectionRef} className="hero-section glass-card mb-4 p-3 md:p-3.5">
      {/* Header + play — single compact row */}
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-100 md:text-lg">{t("home.hero.title")}</h2>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-400 md:text-xs">{t("home.hero.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="btn-secondary text-xs py-1.5 px-3"
            onClick={toggleFullscreen}
            title={t(isFullscreen ? "home.hero.exitFullscreen" : "home.hero.fullscreen")}
          >
            {t(isFullscreen ? "home.hero.exitFullscreen" : "home.hero.fullscreen")}
          </button>
          {sessionActive ? (
            <button type="button" className="btn-secondary text-xs py-1.5 px-3.5" onClick={stopPlay}>
              {t("home.hero.stopPlay")}
            </button>
          ) : (
            <button type="button" className="btn-primary text-xs py-1.5 px-3.5" onClick={startPlay}>
              {t("home.hero.startPlay")}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {(["ungated", "gated"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              tab === id
                ? id === "gated"
                  ? "border-cyan-500/60 bg-cyan-950/40 text-cyan-100"
                  : "border-slate-500/60 bg-slate-800/60 text-slate-200"
                : "border-slate-700 text-slate-400 hover:border-slate-600"
            }`}
          >
            {t(id === "ungated" ? "home.hero.tabUngated" : "home.hero.tabGated")}
          </button>
        ))}
        {playing && (
          <span className="text-[10px] text-slate-500">{t("home.hero.tabCompareHint")}</span>
        )}
        {finished && !playing && (
          <span className="text-[10px] text-slate-500">{t("home.hero.playbackFinished")}</span>
        )}
      </div>

      {/* Canvas — primary visual, takes most of the section */}
      <div className="hero-canvas-wrap relative rounded-lg border border-slate-700/60 bg-slate-950/50 p-1.5 md:p-2">
        <HeroCanvas
          variant={tab}
          phase={phase}
          externalCalls={externalCalls}
          phaseProgress={phaseProgress}
          fullscreen={isFullscreen}
        />
      </div>

      {/* Narration — phase description & comparison */}
      <div className="hero-narration-panel mt-3 rounded-lg border border-cyan-500/15 bg-slate-900/50 px-4 py-3.5 md:px-5 md:py-4">
        <p className="text-sm font-semibold leading-relaxed text-cyan-300 md:text-base">
          {t(subtitleKey)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400 md:text-sm">
          {t(compareKey)}
        </p>
      </div>

      {/* Legend + controls — single footer row */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-slate-700/50 pt-2.5">
        <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px] text-slate-500 md:text-xs">
          <span className="text-cyan-400">■ {t("home.hero.legend.user")}</span>
          <span className="text-amber-400">■ {t("home.hero.legend.collab")}</span>
          <span className="text-violet-400">■ LLM</span>
          <span className="text-blue-400">■ API</span>
          <span className="text-emerald-400">■ MCP</span>
          <span className="text-orange-400">■ RAG</span>
          {tab === "gated" && <span className="text-cyan-400">■ {t("home.hero.legend.gateway")}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {Array.from({ length: HERO_PHASE_COUNT }, (_, i) => (
              <button
                key={i}
                type="button"
                title={t(`home.hero.phases.${i}` as const)}
                disabled={!canScrub}
                onClick={() => {
                  if (!sessionActive) startPlay();
                  jumpToPhase(i);
                }}
                className={`h-2 w-6 rounded-full transition disabled:opacity-40 ${
                  phase === i ? "bg-cyan-400" : "bg-slate-700 hover:bg-slate-600"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary text-xs py-1 px-2.5"
            disabled={!canScrub}
            onClick={() => goStep(-1)}
          >
            {t("home.hero.prev")}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs py-1 px-2.5"
            disabled={!canScrub}
            onClick={() => goStep(1)}
          >
            {t("home.hero.next")}
          </button>
        </div>
      </div>
    </section>
  );
}

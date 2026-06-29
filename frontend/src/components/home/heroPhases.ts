export const HERO_PHASE_COUNT = 7;

/** Duration per phase in ms (total ~19s) */
export const HERO_PHASE_DURATIONS_MS = [2200, 2000, 2000, 3800, 3200, 2400, 3600] as const;

export const HERO_TOTAL_MS = HERO_PHASE_DURATIONS_MS.reduce((a, b) => a + b, 0);

export type HeroPhase = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function externalCallsForPhase(phase: HeroPhase): number {
  if (phase < 3) return 0;
  if (phase === 3) return 8;
  if (phase === 4) return 12;
  return 12;
}

export function phaseFromElapsed(elapsedMs: number): HeroPhase {
  let acc = 0;
  for (let i = 0; i < HERO_PHASE_DURATIONS_MS.length; i++) {
    acc += HERO_PHASE_DURATIONS_MS[i];
    if (elapsedMs < acc) return i as HeroPhase;
  }
  return 6;
}

export function elapsedInPhase(elapsedMs: number, phase: HeroPhase): number {
  let start = 0;
  for (let i = 0; i < phase; i++) {
    start += HERO_PHASE_DURATIONS_MS[i];
  }
  return elapsedMs - start;
}

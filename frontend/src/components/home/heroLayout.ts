/** SVG viewBox coordinate system */
export const VIEW_W = 800;
export const VIEW_H = 450;

export type AgentId = "orchestrator" | "search" | "execute";
export type ExternalId = "llm" | "api" | "mcp" | "rag";

export interface Point {
  x: number;
  y: number;
}

/** User card center */
export const USER = { x: 40, y: 225 };

export const USER_CARD = { w: 72, h: 88 };

/** Avatar circle inside user card — connection at 3 o'clock (right edge) */
export const USER_CIRCLE = { r: 13, cyOffset: -19 };

export function userCircleCenter(): Point {
  return { x: USER.x, y: USER.y + USER_CIRCLE.cyOffset };
}

/** Rightmost point of user avatar circle (3 o'clock) */
export function userCircleRight(): Point {
  return { x: USER.x + USER_CIRCLE.r, y: USER.y + USER_CIRCLE.cyOffset };
}

export const AI_BOX = { x: 120, y: 48, w: 168, h: 354 };

export const GATEWAY = { x: 326, y: 64, w: 72, h: 322 };

/** Center corridor between AI box and external systems — for phase-7 conclusion badges */
export const BADGE_ZONE = {
  centerX: 454,
  width: 236,
  height: 32,
  ys: [132, 198, 264] as const,
};

export const AGENTS: Record<AgentId, Point> = {
  orchestrator: { x: AI_BOX.x + AI_BOX.w / 2, y: 112 },
  search: { x: AI_BOX.x + AI_BOX.w / 2, y: 225 },
  execute: { x: AI_BOX.x + AI_BOX.w / 2, y: 338 },
};

export const EXTERNALS: Record<ExternalId, Point> = {
  llm: { x: 698, y: 90 },
  api: { x: 698, y: 173 },
  mcp: { x: 698, y: 256 },
  rag: { x: 698, y: 339 },
};

/** Observability mini-panel — gated tab, phase 7, below conclusion badges */
export const OBS_PANEL = {
  x: BADGE_ZONE.centerX - BADGE_ZONE.width / 2,
  y: BADGE_ZONE.ys[2] + BADGE_ZONE.height + 10,
  w: BADGE_ZONE.width,
  h: 118,
};

/** Demo metrics at full animation (12 external calls narrative) */
export const OBS_METRICS_DEMO = {
  requests: 12,
  tokens: 4280,
  costZh: 2.16,
  costEn: 0.32,
  mcpCalls: 2,
  promptBlocked: 3,
  mcpBlocked: 1,
  retryRate: 8.3,
  avgTtftMs: 420,
} as const;

export const AGENT_IDS: AgentId[] = ["orchestrator", "search", "execute"];
export const EXTERNAL_IDS: ExternalId[] = ["llm", "api", "mcp", "rag"];

export const EXTERNAL_BURST: { agent: AgentId; ext: ExternalId; delay: number }[] = [
  { agent: "search", ext: "rag", delay: 0 },
  { agent: "execute", ext: "mcp", delay: 0.12 },
  { agent: "orchestrator", ext: "llm", delay: 0.24 },
  { agent: "search", ext: "api", delay: 0.36 },
  { agent: "execute", ext: "llm", delay: 0.48 },
  { agent: "orchestrator", ext: "api", delay: 0.6 },
  { agent: "search", ext: "llm", delay: 0.72 },
  { agent: "execute", ext: "rag", delay: 0.84 },
];

export const MULTI_ROUND: { agent: AgentId; ext: ExternalId; delay: number }[] = [
  { agent: "orchestrator", ext: "llm", delay: 0 },
  { agent: "search", ext: "llm", delay: 0.33 },
  { agent: "execute", ext: "llm", delay: 0.66 },
];

export const AGENT_COLLAB: { from: AgentId; to: AgentId }[] = [
  { from: "orchestrator", to: "search" },
  { from: "search", to: "execute" },
];

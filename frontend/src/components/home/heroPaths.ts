import type { AgentId, ExternalId, Point } from "./heroLayout";
import { AGENTS, AI_BOX, EXTERNALS, GATEWAY, USER } from "./heroLayout";

export type HeroVariant = "ungated" | "gated";

export interface PathSegment {
  d: string;
  color: string;
  kind: "user" | "collab" | "llm" | "api" | "mcp" | "rag";
}

const EXT_COLOR: Record<ExternalId, string> = {
  llm: "#a78bfa",
  api: "#60a5fa",
  mcp: "#34d399",
  rag: "#fb923c",
};

function gatewayMid(): Point {
  return { x: GATEWAY.x + GATEWAY.w / 2, y: GATEWAY.y + GATEWAY.h / 2 };
}

function gatewayEdgeToward(target: Point): Point {
  const mid = gatewayMid();
  const dx = target.x - mid.x;
  const dy = target.y - mid.y;
  const halfW = GATEWAY.w / 2;
  const halfH = GATEWAY.h / 2;
  const scale = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  return { x: mid.x + (dx / scale) * 0.95, y: mid.y + (dy / scale) * 0.95 };
}

function gatewayEdgeFrom(source: Point): Point {
  const mid = gatewayMid();
  const dx = mid.x - source.x;
  const dy = mid.y - source.y;
  const halfW = GATEWAY.w / 2;
  const halfH = GATEWAY.h / 2;
  const scale = Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  return { x: mid.x - (dx / scale) * 0.95, y: mid.y - (dy / scale) * 0.95 };
}

/** Direct path with slight curve for visual "messiness" in ungated mode */
function directPath(from: Point, to: Point, wobble: number): string {
  const mx = (from.x + to.x) / 2 + wobble;
  const my = (from.y + to.y) / 2 - wobble * 0.4;
  return `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;
}

function gatedPath(from: Point, to: Point): string {
  const gIn = gatewayEdgeFrom(from);
  const gOut = gatewayEdgeToward(to);
  return `M ${from.x} ${from.y} L ${gIn.x} ${gIn.y} L ${gOut.x} ${gOut.y} L ${to.x} ${to.y}`;
}

const WOBBLE: Record<string, number> = {
  "orchestrator-llm": 28,
  "search-rag": -22,
  "execute-mcp": 18,
  "search-api": -30,
  "execute-llm": 24,
  "orchestrator-api": -16,
  "search-llm": 20,
  "execute-rag": -26,
};

export function buildConnectionPath(
  variant: HeroVariant,
  agent: AgentId,
  ext: ExternalId
): PathSegment {
  const from = AGENTS[agent];
  const to = EXTERNALS[ext];
  const key = `${agent}-${ext}`;
  const d =
    variant === "gated"
      ? gatedPath(from, to)
      : directPath(from, to, WOBBLE[key] ?? (key.length % 2 ? 15 : -15));
  return { d, color: EXT_COLOR[ext], kind: ext };
}

export function buildCollabPath(from: AgentId, to: AgentId): string {
  const a = AGENTS[from];
  const b = AGENTS[to];
  const mx = (a.x + b.x) / 2 + 40;
  const my = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

export function userToAiPath(): string {
  return `M ${USER.x} ${USER.y} L ${AI_BOX.x} ${USER.y}`;
}

export function aiToUserPath(): string {
  return `M ${AI_BOX.x} ${USER.y} L ${USER.x} ${USER.y}`;
}

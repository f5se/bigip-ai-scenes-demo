import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { McpStreamEvent } from "@/api/client";

type Props = {
  events: McpStreamEvent[];
  running: boolean;
};

const HIGHLIGHT_CLASS: Record<string, string> = {
  sampling: "border-orange-500/40 bg-orange-500/5",
  elicitation: "border-violet-500/40 bg-violet-500/5",
  logging: "border-slate-500/40 bg-slate-800/30",
};

const HIGHLIGHT_BADGE: Record<string, string> = {
  sampling: "bg-orange-500/20 text-orange-300 ring-orange-500/30",
  elicitation: "bg-violet-500/20 text-violet-300 ring-violet-500/30",
  logging: "bg-slate-500/20 text-slate-300 ring-slate-500/30",
};

const DIR_ACCENT: Record<string, string> = {
  "client→server": "from-cyan-500 to-cyan-400",
  "server→client": "from-emerald-500 to-emerald-400",
};

function formatJson(msg: Record<string, unknown> | undefined): string | null {
  if (!msg || Object.keys(msg).length === 0) return null;
  try {
    return JSON.stringify(msg, null, 2);
  } catch {
    return String(msg);
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function JsonPanel({ json, direction }: { json: string; direction?: string }) {
  const isClient = direction === "client→server";
  return (
    <div
      className={`mt-2 overflow-hidden rounded-md border shadow-lg shadow-black/20 ${
        isClient
          ? "border-cyan-500/30 bg-gradient-to-br from-cyan-950/80 to-slate-950/90"
          : "border-emerald-500/30 bg-gradient-to-br from-emerald-950/80 to-slate-950/90"
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${
          isClient
            ? "border-cyan-500/20 bg-cyan-500/10 text-cyan-300"
            : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
        }`}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-80" />
        JSON Payload
      </div>
      <pre className="max-h-52 overflow-auto p-3 text-[11px] leading-relaxed text-slate-200">
        <code>{json}</code>
      </pre>
    </div>
  );
}

const PREFIX = "scenes.mcpToolsInsight";

export function McpMessageTimeline({ events, running }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  const toggle = useCallback((idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  return (
    <div className="flex h-[420px] flex-col rounded-lg border border-cyan-800/40 bg-slate-950/60">
      <div className="border-b border-cyan-900/40 px-3 py-2 text-xs font-medium text-cyan-300">
        {t(`${PREFIX}.timelineTitle`)}
        {running ? (
          <span className="ml-2 animate-pulse text-emerald-400">
            {t(`${PREFIX}.running`)}
          </span>
        ) : null}
      </div>
      <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
        {events.length === 0 ? (
          <p className="px-1 font-mono text-xs text-slate-500">
            {t(`${PREFIX}.timelineEmpty`)}
          </p>
        ) : (
          events.map((ev, idx) => {
            const isOpen = expanded.has(idx);
            const hl = ev.highlight ? HIGHLIGHT_CLASS[ev.highlight] : "border-slate-700/30 bg-slate-900/40";
            const dirClass =
              ev.direction === "client→server"
                ? "text-cyan-400"
                : ev.direction === "server→client"
                  ? "text-emerald-400"
                  : "text-slate-400";
            const accent = DIR_ACCENT[ev.direction ?? ""] ?? "from-slate-500 to-slate-400";
            const jsonText = formatJson(ev.msg);
            const canExpand = jsonText != null;

            return (
              <div
                key={`${ev.ts}-${idx}`}
                className={`relative overflow-hidden rounded-lg border transition-colors duration-150 ${hl} ${
                  isOpen ? "ring-1 ring-cyan-500/25" : "hover:border-slate-600/50"
                }`}
              >
                <div
                  className={`absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b ${accent} ${
                    isOpen ? "opacity-100" : "opacity-60"
                  }`}
                />
                <div className="pl-2.5 pr-2 py-1.5">
                  <div className="flex items-start gap-1.5">
                    {canExpand ? (
                      <button
                        type="button"
                        onClick={() => toggle(idx)}
                        aria-expanded={isOpen}
                        aria-label={
                          isOpen ? t(`${PREFIX}.collapseJson`) : t(`${PREFIX}.expandJson`)
                        }
                        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all ${
                          isOpen
                            ? "bg-cyan-500/20 text-cyan-300 ring-1 ring-cyan-500/40"
                            : "text-slate-500 hover:bg-slate-800 hover:text-cyan-300"
                        }`}
                      >
                        <ChevronIcon open={isOpen} />
                      </button>
                    ) : (
                      <span className="mt-0.5 inline-block h-6 w-6 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1 font-mono text-xs">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-slate-500">{ev.ts?.slice(11, 19) ?? "--:--:--"}</span>
                        <span className={dirClass}>{ev.direction ?? "?"}</span>
                        {ev.highlight ? (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ${HIGHLIGHT_BADGE[ev.highlight] ?? ""}`}
                          >
                            {ev.highlight}
                          </span>
                        ) : null}
                        {ev.jsonrpc_id != null && ev.jsonrpc_id !== "" ? (
                          <span className="text-slate-600">id={String(ev.jsonrpc_id)}</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-slate-200">{ev.summary ?? ev.method}</p>
                    </div>
                  </div>
                  {isOpen && jsonText ? (
                    <div className="pl-7 pt-1 transition-all duration-200 ease-out">
                      <JsonPanel json={jsonText} direction={ev.direction} />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

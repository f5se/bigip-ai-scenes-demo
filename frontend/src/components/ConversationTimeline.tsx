import { useTranslation } from "react-i18next";

export type TimelineStep = {
  step: number;
  role: string;
  preview: string;
  cumulative_bytes: number;
  message_count: number;
};

type Props = {
  timeline: TimelineStep[];
  threshold: number;
  highlightFromStep?: number;
};

export function ConversationTimeline({
  timeline,
  threshold,
  highlightFromStep,
}: Props) {
  const { t } = useTranslation();
  if (!timeline.length) return null;

  const maxBytes = Math.max(
    threshold * 1.15,
    ...timeline.map((s) => s.cumulative_bytes)
  );

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/60 p-3">
      <p className="mb-2 text-xs font-semibold text-slate-400">
        {t("contextSize.timelineTitle")}
      </p>
      <p className="mb-2 text-[10px] text-orange-400/90">
        {t("contextSize.thresholdLine", { bytes: threshold })}
      </p>
      <ul className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {timeline.map((item) => {
          const over = item.cumulative_bytes > threshold;
          const isHighlight =
            highlightFromStep != null && item.step >= highlightFromStep;
          const widthPct = Math.max(
            4,
            Math.round((item.cumulative_bytes / maxBytes) * 100)
          );
          const roleLabel =
            item.role === "user"
              ? t("contextSize.roleUser")
              : item.role === "assistant"
                ? t("contextSize.roleAssistant")
                : t("contextSize.roleSystem");

          return (
            <li
              key={item.step}
              className={`rounded-md px-2 py-1.5 text-xs ${
                isHighlight
                  ? "bg-orange-950/50 ring-1 ring-orange-500/40"
                  : over
                    ? "bg-orange-950/30"
                    : "bg-slate-900/80"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium text-slate-300">
                  #{item.step + 1} {roleLabel}
                </span>
                <span
                  className={`shrink-0 font-mono ${
                    over ? "text-orange-300" : "text-emerald-400"
                  }`}
                >
                  {item.cumulative_bytes} B
                </span>
              </div>
              <div className="mb-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full ${over ? "bg-orange-500" : "bg-emerald-600"}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <p className="line-clamp-2 text-slate-500">{item.preview}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

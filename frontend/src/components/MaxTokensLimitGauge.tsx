import { useTranslation } from "react-i18next";

type Marker = {
  value: number;
  kind: "compliant" | "overflow" | "custom";
};

type Props = {
  limit: number;
  markers: Marker[];
  activeValue?: number;
};

export function MaxTokensLimitGauge({ limit, markers, activeValue }: Props) {
  const { t } = useTranslation();
  const scaleMax = Math.max(limit * 2, ...markers.map((m) => m.value), activeValue ?? 0, 8192);

  const pct = (value: number) => Math.min(100, Math.max(0, (value / scaleMax) * 100));
  const limitPct = pct(limit);
  const activePct =
    activeValue !== undefined && activeValue > 0 ? pct(activeValue) : null;
  const activeOverLimit = activeValue !== undefined && activeValue > limit;

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-slate-400">{t("maxTokensDemo.gaugeTitle")}</span>
        <span className="font-mono text-cyan-400">
          MAX_TOKENS_LIMIT = {limit.toLocaleString()}
        </span>
      </div>

      {activeValue !== undefined && activeValue > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {t("maxTokensDemo.gaugeActiveValue")}:{" "}
          <span
            className={`font-mono font-semibold ${
              activeOverLimit ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {activeValue.toLocaleString()}
          </span>
        </p>
      )}

      <div className="relative mt-3 h-3 rounded-full bg-slate-800">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/20"
          style={{ width: `${limitPct}%` }}
        />
        {activePct !== null && (
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out ${
              activeOverLimit ? "bg-rose-500/60" : "bg-emerald-500/60"
            }`}
            style={{ width: `${activePct}%` }}
          />
        )}
        <div
          className="absolute inset-y-0 w-0.5 bg-amber-400"
          style={{ left: `${limitPct}%` }}
          title={t("maxTokensDemo.gaugeLimitLine", { limit })}
        />
        {markers.map((m) => {
          const isActive = activeValue === m.value;
          return (
            <div
              key={`${m.kind}-${m.value}`}
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all duration-200 ease-out ${
                isActive
                  ? "z-10 scale-125 border-cyan-300 shadow-[0_0_0_2px_rgba(34,211,238,0.35)]"
                  : "border-slate-900 opacity-70"
              }`}
              style={{
                left: `${pct(m.value)}%`,
                backgroundColor:
                  m.kind === "compliant"
                    ? "rgb(52 211 153)"
                    : m.kind === "overflow"
                      ? "rgb(251 113 133)"
                      : "rgb(34 211 238)",
              }}
              title={`max_tokens=${m.value}`}
            />
          );
        })}
        {activePct !== null && !markers.some((m) => m.value === activeValue) && (
          <div
            className={`absolute top-1/2 z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-300 shadow-[0_0_0_2px_rgba(34,211,238,0.35)] transition-[left] duration-200 ease-out ${
              activeOverLimit ? "bg-rose-400" : "bg-cyan-400"
            }`}
            style={{ left: `${activePct}%` }}
            title={`max_tokens=${activeValue}`}
          />
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
          {t("maxTokensDemo.gaugeCompliant")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-400" />
          {t("maxTokensDemo.gaugeOverflow")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-amber-400" />
          {t("maxTokensDemo.gaugeLimitLine", { limit })}
        </span>
      </div>

      <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-600">
        <span>0</span>
        <span>{limit.toLocaleString()}</span>
        <span>{scaleMax.toLocaleString()}</span>
      </div>
    </div>
  );
}

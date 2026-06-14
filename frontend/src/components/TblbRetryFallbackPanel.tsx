import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const RETRY_FALLBACK_PATH = "/scene/llm-router/retry-fallback";

function FlowStep({
  step,
  title,
  body,
  accent,
}: {
  step: number;
  title: string;
  body: string;
  accent?: "cyan" | "violet" | "amber";
}) {
  const accentClass =
    accent === "violet"
      ? "border-violet-500/40 bg-violet-950/25"
      : accent === "amber"
        ? "border-amber-500/40 bg-amber-950/25"
        : "border-cyan-500/40 bg-cyan-950/25";

  return (
    <div className={`rounded-lg border p-3 ${accentClass}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-300">
          {step}
        </span>
        <p className="text-sm font-medium text-slate-100">{title}</p>
      </div>
      <p className="pl-7 text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}

export function TblbRetryFallbackPanel() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-slate-200">
          {t("tblbDemo.retryFallback.title")}
        </p>
        <p className="mt-1 text-xs text-slate-400">{t("tblbDemo.retryFallback.subtitle")}</p>
      </div>

      <div className="space-y-2">
        <FlowStep
          step={1}
          title={t("tblbDemo.retryFallback.step1Title")}
          body={t("tblbDemo.retryFallback.step1Body")}
        />
        <div className="flex justify-center text-slate-600" aria-hidden>
          ↓
        </div>
        <FlowStep
          step={2}
          title={t("tblbDemo.retryFallback.step2Title")}
          body={t("tblbDemo.retryFallback.step2Body")}
          accent="violet"
        />
        <div className="flex justify-center text-slate-600" aria-hidden>
          ↓
        </div>
        <FlowStep
          step={3}
          title={t("tblbDemo.retryFallback.step3Title")}
          body={t("tblbDemo.retryFallback.step3Body")}
        />
        <div className="flex justify-center text-slate-600" aria-hidden>
          ↓
        </div>
        <FlowStep
          step={4}
          title={t("tblbDemo.retryFallback.step4Title")}
          body={t("tblbDemo.retryFallback.step4Body")}
          accent="amber"
        />
      </div>

      <div className="rounded-lg border border-emerald-600/35 bg-emerald-950/20 p-4">
        <p className="text-sm font-medium text-emerald-300">
          {t("tblbDemo.retryFallback.sameAsRouterTitle")}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          {t("tblbDemo.retryFallback.sameAsRouterBody")}
        </p>
        <Link
          to={RETRY_FALLBACK_PATH}
          className="mt-3 inline-flex items-center rounded-md border border-emerald-500/50 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
        >
          {t("tblbDemo.retryFallback.goToRouterDemo")}
        </Link>
      </div>

      <p className="text-xs text-slate-500">{t("tblbDemo.retryFallback.footnote")}</p>
    </div>
  );
}

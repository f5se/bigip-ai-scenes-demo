import { useTranslation } from "react-i18next";

export function ComingSoonPanel() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-900/40 p-8 text-center">
      <div className="mb-3 text-4xl opacity-40">⏳</div>
      <h3 className="text-lg font-semibold text-slate-300">{t("app.comingSoon")}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-500">{t("app.comingSoonHint")}</p>
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  titleKey: string;
  taglineKey: string;
  introStoryKey?: string;
  bulletKeys: string[];
  /** Optional second bullet list under「方案技术特性」 */
  techFeatureKeys?: string[];
  versionBadge?: boolean;
  diagramBusiness: ReactNode;
  diagramTechnical: ReactNode;
  interaction: ReactNode;
  explanation: ReactNode;
};

export function SceneLayout({
  titleKey,
  taglineKey,
  introStoryKey,
  bulletKeys,
  techFeatureKeys,
  versionBadge,
  diagramBusiness,
  diagramTechnical,
  interaction,
  explanation,
}: Props) {
  const { t } = useTranslation();
  const [architectureOpen, setArchitectureOpen] = useState(true);
  const [diagramTab, setDiagramTab] = useState<"business" | "technical">("business");

  return (
    <div className="space-y-6">
      <section className="glass-card p-6">
        <p className="section-title mb-2">{t("sceneIntro.label")}</p>
        <h1 className="text-2xl font-bold text-white">
          {t(titleKey)}
          {versionBadge ? (
            <span className="ml-2 text-sm font-normal text-slate-500">
              {t("nav.tmosMinVersion")}
            </span>
          ) : null}
        </h1>
        <p className="mt-2 text-base text-cyan-100/90">{t(taglineKey)}</p>
        {introStoryKey && (
          <p className="mt-4 border-l-2 border-cyan-500/40 pl-4 text-sm leading-relaxed text-slate-300">
            {t(introStoryKey)}
          </p>
        )}
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("sceneIntro.whyItMatters")}
        </p>
        <ul className="mt-2 list-inside list-disc space-y-2 text-sm text-slate-300">
          {bulletKeys.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        {techFeatureKeys && techFeatureKeys.length > 0 && (
          <>
            <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t("sceneIntro.techFeatures")}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-2 text-sm text-slate-400">
              {techFeatureKeys.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="glass-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="section-title mb-0">{t("sceneIntro.architecture")}</p>
          <button
            type="button"
            className="text-xs text-cyan-500 hover:text-cyan-400"
            onClick={() => setArchitectureOpen((open) => !open)}
            aria-expanded={architectureOpen}
          >
            {architectureOpen ? t("sceneIntro.collapseArchitecture") : t("sceneIntro.expandArchitecture")}
          </button>
        </div>
        {architectureOpen && (
          <div className="space-y-3">
            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/60 p-1">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  diagramTab === "business"
                    ? "bg-cyan-600/25 text-cyan-300"
                    : "text-slate-300 hover:text-white"
                }`}
                onClick={() => setDiagramTab("business")}
              >
                {t("sceneIntro.businessArchitecture")}
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  diagramTab === "technical"
                    ? "bg-cyan-600/25 text-cyan-300"
                    : "text-slate-300 hover:text-white"
                }`}
                onClick={() => setDiagramTab("technical")}
              >
                {t("sceneIntro.technicalArchitecture")}
              </button>
            </div>
            {diagramTab === "business" ? diagramBusiness : diagramTechnical}
          </div>
        )}
      </section>

      <section className="glass-card p-6">
        <p className="section-title mb-4">{t("sceneIntro.interactive")}</p>
        {interaction}
      </section>

      <section className="glass-card p-6">
        <p className="section-title mb-4">{t("sceneIntro.notes")}</p>
        <div className="prose prose-invert max-w-none text-sm text-slate-300">{explanation}</div>
      </section>
    </div>
  );
}

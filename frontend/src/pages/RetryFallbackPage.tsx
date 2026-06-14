import { useTranslation } from "react-i18next";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { RetryFallbackDemo } from "@/components/RetryFallbackDemo";
import { SceneLayout } from "@/components/SceneLayout";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

export function RetryFallbackPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.retryFallbackBizEn ?? MERMAID_DIAGRAMS.retryFallbackBiz)
    : MERMAID_DIAGRAMS.retryFallbackBiz;

  return (
    <SceneLayout
      titleKey="scenes.retryFallback.title"
      taglineKey="scenes.retryFallback.tagline"
      introStoryKey="scenes.retryFallback.introStory"
      bulletKeys={[
        "scenes.retryFallback.bullets.0",
        "scenes.retryFallback.bullets.1",
        "scenes.retryFallback.bullets.2",
        "scenes.retryFallback.bullets.3",
      ]}
      techFeatureKeys={[
        "scenes.retryFallback.techFeatures.0",
        "scenes.retryFallback.techFeatures.1",
        "scenes.retryFallback.techFeatures.2",
        "scenes.retryFallback.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.retryFallback} />}
      interaction={<RetryFallbackDemo />}
      explanation={
        <div className="space-y-4 text-slate-300">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            <li>{t("scenes.retryFallback.explain.0")}</li>
            <li>{t("scenes.retryFallback.explain.1")}</li>
            <li>{t("scenes.retryFallback.explain.2")}</li>
            <li>{t("scenes.retryFallback.explain.3")}</li>
          </ul>
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
            <p className="font-medium text-amber-300">{t("scenes.retryFallback.opsNote")}</p>
            <p className="mt-1 text-slate-400">{t("scenes.retryFallback.opsNoteBody")}</p>
          </div>
        </div>
      }
    />
  );
}


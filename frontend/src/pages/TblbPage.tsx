import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { TblbDemo } from "@/components/TblbDemo";
import { TblbRetryFallbackPanel } from "@/components/TblbRetryFallbackPanel";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

export function TblbPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.tblbBizEn ?? MERMAID_DIAGRAMS.tblbBiz)
    : MERMAID_DIAGRAMS.tblbBiz;

  return (
    <SceneLayout
      titleKey="scenes.tblb.title"
      taglineKey="scenes.tblb.tagline"
      introStoryKey="scenes.tblb.introStory"
      bulletKeys={[
        "scenes.tblb.bullets.0",
        "scenes.tblb.bullets.1",
        "scenes.tblb.bullets.2",
        "scenes.tblb.bullets.3",
      ]}
      techFeatureKeys={[
        "scenes.tblb.techFeatures.0",
        "scenes.tblb.techFeatures.1",
        "scenes.tblb.techFeatures.2",
        "scenes.tblb.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.tblb} />}
      interaction={
        <div className="space-y-8">
          <div>
            <p className="section-title mb-4">{t("tblbDemo.interactionTitle")}</p>
            <TblbDemo />
          </div>
          <div className="border-t border-slate-700/80 pt-8">
            <TblbRetryFallbackPanel />
          </div>
        </div>
      }
      explanation={
        <div className="space-y-3">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            <li>{t("tblbDemo.explain.0")}</li>
            <li>{t("tblbDemo.explain.1")}</li>
            <li>{t("tblbDemo.explain.2")}</li>
          </ul>
          <p className="text-slate-400">{t("tblbDemo.explainNote")}</p>
        </div>
      }
    />
  );
}

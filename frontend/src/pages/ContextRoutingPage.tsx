import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { ContextRoutingDemo } from "@/components/ContextRoutingDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

export function ContextRoutingPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.contextRoutingBizEn ?? MERMAID_DIAGRAMS.contextRoutingBiz)
    : MERMAID_DIAGRAMS.contextRoutingBiz;

  return (
    <SceneLayout
      titleKey="scenes.contextRouting.title"
      taglineKey="scenes.contextRouting.tagline"
      introStoryKey="scenes.contextRouting.introStory"
      bulletKeys={[
        "scenes.contextRouting.bullets.0",
        "scenes.contextRouting.bullets.1",
        "scenes.contextRouting.bullets.2",
        "scenes.contextRouting.bullets.3",
      ]}
      techFeatureKeys={[
        "scenes.contextRouting.techFeatures.0",
        "scenes.contextRouting.techFeatures.1",
        "scenes.contextRouting.techFeatures.2",
        "scenes.contextRouting.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.contextRouting} />}
      interaction={<ContextRoutingDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            <li>{t("scenes.contextRouting.explain.0")}</li>
            <li>{t("scenes.contextRouting.explain.1")}</li>
            <li>{t("scenes.contextRouting.explain.2")}</li>
            <li>{t("scenes.contextRouting.explain.3")}</li>
          </ul>
          <div className="rounded-lg border border-orange-500/30 bg-orange-950/25 p-3">
            <p className="font-medium text-orange-300">
              {t("scenes.contextRouting.thresholdNote")}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-400 break-all">
              {t("scenes.contextRouting.dgExample")}
            </p>
          </div>
          <p className="text-slate-400">{t("scenes.contextRouting.calcNote")}</p>
        </div>
      }
    />
  );
}

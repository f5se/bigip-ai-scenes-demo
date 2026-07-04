import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { McpInsightDemo } from "@/components/McpInsightDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";
import { collectSceneIntroKeys } from "@/utils/sceneIntro";

export function McpToolsInsightPage() {
  const { t, i18n } = useTranslation();
  const prefix = "scenes.mcpToolsInsight";
  const technicalChart = MERMAID_DIAGRAMS.mcpToolsInsight ?? MERMAID_DIAGRAMS.placeholder;
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.mcpToolsInsightBizEn ??
      MERMAID_DIAGRAMS.mcpToolsInsightBiz ??
      technicalChart)
    : (MERMAID_DIAGRAMS.mcpToolsInsightBiz ?? technicalChart);

  const bulletKeys = collectSceneIntroKeys(prefix, "bullets", t);
  const techFeatureKeys = collectSceneIntroKeys(prefix, "techFeatures", t);

  return (
    <SceneLayout
      titleKey={`${prefix}.title`}
      taglineKey={`${prefix}.tagline`}
      introStoryKey={`${prefix}.introStory`}
      bulletKeys={bulletKeys.length > 0 ? bulletKeys : [`${prefix}.bullets.0`]}
      techFeatureKeys={techFeatureKeys.length > 0 ? techFeatureKeys : undefined}
      versionBadge
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={technicalChart} />}
      interaction={<McpInsightDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            <li>{t(`${prefix}.notes.explain.0`)}</li>
            <li>{t(`${prefix}.notes.explain.1`)}</li>
          </ul>
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
            <p className="font-medium text-cyan-300">{t(`${prefix}.notes.mcpServerTitle`)}</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-slate-400">
              <li>{t(`${prefix}.notes.mcpServer.0`)}</li>
              <li>{t(`${prefix}.notes.mcpServer.1`)}</li>
              <li>{t(`${prefix}.notes.mcpServer.2`)}</li>
              <li>{t(`${prefix}.notes.mcpServer.3`)}</li>
            </ul>
          </div>
          <div className="rounded-lg border border-violet-500/30 bg-violet-950/25 p-3">
            <p className="font-medium text-violet-300">{t(`${prefix}.notes.f5Title`)}</p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-slate-400">
              <li>{t(`${prefix}.notes.f5.0`)}</li>
              <li>{t(`${prefix}.notes.f5.1`)}</li>
              <li>{t(`${prefix}.notes.f5.2`)}</li>
              <li>{t(`${prefix}.notes.f5.3`)}</li>
            </ul>
          </div>
          <p className="font-mono text-xs text-cyan-600/80">{t(`${prefix}.notes.opsTip`)}</p>
        </div>
      }
    />
  );
}

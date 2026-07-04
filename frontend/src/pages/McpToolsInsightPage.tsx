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
        <p className="text-sm text-slate-400">
          {t(`${prefix}.auditHint`, {
            defaultValue:
              "开发联调默认直连 MCP Server (127.0.0.1:9001)。F5 部署完成后将 Host 改为 172.16.30.125、Port 9000。",
          })}
        </p>
      }
    />
  );
}

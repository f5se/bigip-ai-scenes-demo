import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { McpInsightDemo } from "@/components/McpInsightDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

export function McpToolsInsightV20260728Page() {
  const { t, i18n } = useTranslation();
  const prefix = "scenes.mcpToolsInsight";
  const technicalChart = MERMAID_DIAGRAMS.mcpToolsInsight ?? MERMAID_DIAGRAMS.placeholder;
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.mcpToolsInsightBizEn ??
      MERMAID_DIAGRAMS.mcpToolsInsightBiz ??
      technicalChart)
    : (MERMAID_DIAGRAMS.mcpToolsInsightBiz ?? technicalChart);

  return (
    <SceneLayout
      titleKey="nav.mcpToolsInsightV20260728"
      taglineKey={`${prefix}.tagline`}
      introStoryKey={`${prefix}.introStory`}
      bulletKeys={[`${prefix}.bullets.0`, `${prefix}.bullets.1`, `${prefix}.bullets.2`]}
      techFeatureKeys={[`${prefix}.techFeatures.0`, `${prefix}.techFeatures.1`]}
      versionBadge
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={technicalChart} />}
      interaction={
        <McpInsightDemo
          apiBasePath="/api/demo/mcp-insight-v2026"
          streamPath="/api/demo/mcp-insight-v2026/run-stream"
          protocolVersionLabel="2026-07-28"
          showProtocolDiff
        />
      }
      explanation={
        <div className="space-y-3 text-slate-300">
          <p>
            {t("sceneIntro.whyItMatters")}：从业务视角看，本页面用于回答“哪些 Agent 在用哪些工具、调用是否健康、风险是否可控”。
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>业务先看趋势：按团队与工具识别调用规模和变化。</li>
            <li>运维再看异常：快速定位失败高发的 Agent、工具和链路。</li>
            <li>技术补充：新版协议强调请求自描述，便于网关和观测系统稳定解析。</li>
          </ul>
        </div>
      }
    />
  );
}

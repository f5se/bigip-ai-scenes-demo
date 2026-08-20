import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { McpControlDemo } from "@/components/McpControlDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

export function McpToolsControlV20260728Page() {
  const { t, i18n } = useTranslation();
  const prefix = "scenes.mcpToolsControl";
  const technicalChart = MERMAID_DIAGRAMS.mcpToolsControl ?? MERMAID_DIAGRAMS.placeholder;
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.mcpToolsControlBizEn ??
      MERMAID_DIAGRAMS.mcpToolsControlBiz ??
      technicalChart)
    : (MERMAID_DIAGRAMS.mcpToolsControlBiz ?? technicalChart);

  return (
    <SceneLayout
      titleKey="nav.mcpToolsControlV20260728"
      taglineKey={`${prefix}.tagline`}
      introStoryKey={`${prefix}.introStory`}
      bulletKeys={[`${prefix}.bullets.0`, `${prefix}.bullets.1`, `${prefix}.bullets.2`]}
      techFeatureKeys={[`${prefix}.techFeatures.0`, `${prefix}.techFeatures.1`]}
      versionBadge
      versionBadgeKey="nav.tmosMinVersionApm"
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={technicalChart} />}
      interaction={
        <McpControlDemo
          apiBasePath="/api/demo/mcp-tools-control-v2026"
          protocolVersionLabel="2026-07-28"
          showProtocolDiff
          showSimTab
        />
      }
      explanation={
        <div className="space-y-3 text-slate-300">
          <p>
            {t("sceneIntro.whyItMatters")}：从业务视角看，本页面用于确保“不同角色的 Agent 只能访问其职责范围内的工具”，降低误操作风险。
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>业务先看权限边界：运维、财务、访客权限分域是否清晰。</li>
            <li>安全再看越权拦截：跨域访问、超权限工具调用是否被稳定拒绝。</li>
            <li>技术补充：新版协议以头部和请求体元信息增强路由与策略可观测性。</li>
          </ul>
        </div>
      }
    />
  );
}

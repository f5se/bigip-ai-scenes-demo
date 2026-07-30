import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { McpControlDemo } from "@/components/McpControlDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";
import { collectSceneIntroKeys } from "@/utils/sceneIntro";

export function McpToolsControlPage() {
  const { t, i18n } = useTranslation();
  const prefix = "scenes.mcpToolsControl";
  const technicalChart = MERMAID_DIAGRAMS.mcpToolsControl ?? MERMAID_DIAGRAMS.placeholder;
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.mcpToolsControlBizEn ??
      MERMAID_DIAGRAMS.mcpToolsControlBiz ??
      technicalChart)
    : (MERMAID_DIAGRAMS.mcpToolsControlBiz ?? technicalChart);

  const bulletKeys = collectSceneIntroKeys(prefix, "bullets", t);
  const techFeatureKeys = collectSceneIntroKeys(prefix, "techFeatures", t);
  const noteKeys = Array.from({ length: 12 }, (_, i) => `${prefix}.notes.explain.${i}`).filter(
    (key) => t(key) !== key
  );

  return (
    <SceneLayout
      titleKey={`${prefix}.title`}
      taglineKey={`${prefix}.tagline`}
      introStoryKey={`${prefix}.introStory`}
      bulletKeys={bulletKeys.length > 0 ? bulletKeys : [`${prefix}.bullets.0`]}
      techFeatureKeys={techFeatureKeys.length > 0 ? techFeatureKeys : undefined}
      versionBadge
      versionBadgeKey="nav.tmosMinVersionApm"
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={technicalChart} />}
      interaction={<McpControlDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            {noteKeys.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <div className="rounded border border-cyan-700/40 bg-cyan-950/20 px-3 py-2 text-sm text-cyan-200">
            <span className="mr-1 font-semibold">i</span>
            {t(`${prefix}.notes.dcrNote`)}{" "}
            <a
              className="text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200"
              href={t(`${prefix}.notes.dcrLinkUrl`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(`${prefix}.notes.dcrLinkLabel`)}
            </a>
          </div>
          <p className="font-mono text-xs text-cyan-600/80">{t(`${prefix}.notes.opsTip`)}</p>
        </div>
      }
    />
  );
}

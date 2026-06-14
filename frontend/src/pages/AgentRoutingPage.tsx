import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { AgentRoutingDemo } from "@/components/AgentRoutingDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

export function AgentRoutingPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.agentRoutingBizEn ?? MERMAID_DIAGRAMS.agentRoutingBiz)
    : MERMAID_DIAGRAMS.agentRoutingBiz;

  return (
    <SceneLayout
      titleKey="scenes.agentRouting.title"
      taglineKey="scenes.agentRouting.tagline"
      introStoryKey="scenes.agentRouting.introStory"
      bulletKeys={[
        "scenes.agentRouting.bullets.0",
        "scenes.agentRouting.bullets.1",
        "scenes.agentRouting.bullets.2",
        "scenes.agentRouting.bullets.3",
      ]}
      techFeatureKeys={[
        "scenes.agentRouting.techFeatures.0",
        "scenes.agentRouting.techFeatures.1",
        "scenes.agentRouting.techFeatures.2",
        "scenes.agentRouting.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.agentRouting} />}
      interaction={<AgentRoutingDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1">
            <li>{t("scenes.agentRouting.explain.0")}</li>
            <li>{t("scenes.agentRouting.explain.1")}</li>
            <li>{t("scenes.agentRouting.explain.2")}</li>
            <li>{t("scenes.agentRouting.explain.3")}</li>
          </ul>
          <div className="rounded-lg border border-violet-500/30 bg-violet-950/25 p-3">
            <p className="font-medium text-violet-300">
              {t("scenes.agentRouting.modelRewriteNote")}
            </p>
            <p className="mt-1 text-slate-400">{t("scenes.agentRouting.modelRewriteNoteBody")}</p>
          </div>
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
            <p className="font-medium text-cyan-300">{t("scenes.agentRouting.identityNote")}</p>
            <p className="mt-1 text-slate-400">{t("scenes.agentRouting.identityNoteBody")}</p>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
            {t("scenes.agentRouting.curlExample")}
          </pre>
        </div>
      }
    />
  );
}

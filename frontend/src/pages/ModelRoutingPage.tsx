import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { ModelRoutingDemo } from "@/components/ModelRoutingDemo";
import { MERMAID_DIAGRAMS, CURL_EXAMPLES } from "@/scenes/manifest";

export function ModelRoutingPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.modelRoutingBizEn ?? MERMAID_DIAGRAMS.modelRoutingBiz)
    : MERMAID_DIAGRAMS.modelRoutingBiz;

  return (
    <SceneLayout
      titleKey="scenes.modelRouting.title"
      taglineKey="scenes.modelRouting.tagline"
      introStoryKey="scenes.modelRouting.introStory"
      bulletKeys={[
        "scenes.modelRouting.bullets.0",
        "scenes.modelRouting.bullets.1",
        "scenes.modelRouting.bullets.2",
        "scenes.modelRouting.bullets.3",
      ]}
      techFeatureKeys={[
        "scenes.modelRouting.techFeatures.0",
        "scenes.modelRouting.techFeatures.1",
        "scenes.modelRouting.techFeatures.2",
        "scenes.modelRouting.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.modelRouting} />}
      interaction={<ModelRoutingDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1">
            <li>{t("scenes.modelRouting.explain.0")}</li>
            <li>{t("scenes.modelRouting.explain.1")}</li>
            <li>{t("scenes.modelRouting.explain.2")}</li>
            <li>{t("scenes.modelRouting.explain.3")}</li>
          </ul>
          <div className="rounded-lg border border-violet-500/30 bg-violet-950/25 p-3">
            <p className="font-medium text-violet-300">
              {t("scenes.modelRouting.modelRewriteNote")}
            </p>
            <p className="mt-1 text-slate-400">
              {t("scenes.modelRouting.modelRewriteNoteBody")}
            </p>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
            <p className="font-medium text-amber-300">{t("app.routingNote")}</p>
            <p className="mt-1 text-slate-400">{t("app.routingNoteBody")}</p>
          </div>
          <p className="text-slate-400">{t("scenes.modelRouting.proxyWhy")}</p>
          <div>
            <p className="mb-1 text-xs text-slate-500">{t("scenes.modelRouting.curlSuccess")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {CURL_EXAMPLES.success}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">{t("scenes.modelRouting.curlFail")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {CURL_EXAMPLES.fail}
            </pre>
          </div>
          <p className="font-mono text-xs text-cyan-600/80">{t("scenes.modelRouting.opsTip")}</p>
        </div>
      }
    />
  );
}

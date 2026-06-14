import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { ModelAllowlistDemo } from "@/components/ModelAllowlistDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

const CURL_ALLOW = `curl -iX POST http://172.16.30.124:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"demo-model","messages":[{"role":"user","content":"hello"}]}'`;

const CURL_BLOCK = `curl -iX POST http://172.16.30.124:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}'`;

export function ModelAllowlistPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.modelAllowlistBizEn ?? MERMAID_DIAGRAMS.modelAllowlistBiz)
    : MERMAID_DIAGRAMS.modelAllowlistBiz;

  return (
    <SceneLayout
      titleKey="scenes.modelAllowlist.title"
      taglineKey="scenes.modelAllowlist.tagline"
      versionBadge
      introStoryKey="scenes.modelAllowlist.introStory"
      bulletKeys={[
        "scenes.modelAllowlist.bullets.0",
        "scenes.modelAllowlist.bullets.1",
        "scenes.modelAllowlist.bullets.2",
      ]}
      techFeatureKeys={[
        "scenes.modelAllowlist.techFeatures.0",
        "scenes.modelAllowlist.techFeatures.1",
        "scenes.modelAllowlist.techFeatures.2",
        "scenes.modelAllowlist.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.modelAllowlist} />}
      interaction={<ModelAllowlistDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            <li>{t("scenes.modelAllowlist.explain.0")}</li>
            <li>{t("scenes.modelAllowlist.explain.1")}</li>
            <li>{t("scenes.modelAllowlist.explain.2")}</li>
            <li>{t("scenes.modelAllowlist.explain.3")}</li>
          </ul>
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
            <p className="font-medium text-cyan-300">{t("scenes.modelAllowlist.policyNote")}</p>
            <p className="mt-1 text-slate-400">{t("scenes.modelAllowlist.policyNoteBody")}</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">{t("scenes.modelAllowlist.curlAllow")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {CURL_ALLOW}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">{t("scenes.modelAllowlist.curlBlock")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {CURL_BLOCK}
            </pre>
          </div>
          <p className="font-mono text-xs text-cyan-600/80">{t("scenes.modelAllowlist.opsTip")}</p>
        </div>
      }
    />
  );
}

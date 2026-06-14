import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { MaxTokensDemo } from "@/components/MaxTokensDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

const CURL_ALLOW = `curl -iX POST http://172.16.30.124:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"demo-model","max_tokens":2048,"messages":[{"role":"user","content":"hello"}]}'`;

const CURL_BLOCK = `curl -iX POST http://172.16.30.124:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"demo-model","max_tokens":8192,"messages":[{"role":"user","content":"hello"}]}'`;

export function MaxTokensPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.maxTokensLimitBizEn ?? MERMAID_DIAGRAMS.maxTokensLimitBiz)
    : MERMAID_DIAGRAMS.maxTokensLimitBiz;

  return (
    <SceneLayout
      titleKey="scenes.maxTokensLimit.title"
      taglineKey="scenes.maxTokensLimit.tagline"
      versionBadge
      introStoryKey="scenes.maxTokensLimit.introStory"
      bulletKeys={[
        "scenes.maxTokensLimit.bullets.0",
        "scenes.maxTokensLimit.bullets.1",
        "scenes.maxTokensLimit.bullets.2",
      ]}
      techFeatureKeys={[
        "scenes.maxTokensLimit.techFeatures.0",
        "scenes.maxTokensLimit.techFeatures.1",
        "scenes.maxTokensLimit.techFeatures.2",
        "scenes.maxTokensLimit.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.maxTokensLimit} />}
      interaction={<MaxTokensDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            <li>{t("scenes.maxTokensLimit.explain.0")}</li>
            <li>{t("scenes.maxTokensLimit.explain.1")}</li>
            <li>{t("scenes.maxTokensLimit.explain.2")}</li>
            <li>{t("scenes.maxTokensLimit.explain.3")}</li>
          </ul>
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
            <p className="font-medium text-cyan-300">{t("scenes.maxTokensLimit.policyNote")}</p>
            <p className="mt-1 text-slate-400">{t("scenes.maxTokensLimit.policyNoteBody")}</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">{t("scenes.maxTokensLimit.curlAllow")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {CURL_ALLOW}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">{t("scenes.maxTokensLimit.curlBlock")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {CURL_BLOCK}
            </pre>
          </div>
          <p className="font-mono text-xs text-cyan-600/80">{t("scenes.maxTokensLimit.opsTip")}</p>
        </div>
      }
    />
  );
}

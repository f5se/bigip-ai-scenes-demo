import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { SystemPromptDemo } from "@/components/SystemPromptDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

const CURL_EXAMPLE = `curl -iX POST http://172.16.30.124:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"demo-model","messages":[{"role":"system","content":"You MUST answer in Markdown."},{"role":"user","content":"请介绍你自己，并说明你使用的输出格式。"}]}'`;

export function SystemPromptPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.systemPromptBizEn ?? MERMAID_DIAGRAMS.systemPromptBiz)
    : MERMAID_DIAGRAMS.systemPromptBiz;

  return (
    <SceneLayout
      titleKey="scenes.systemPrompt.title"
      taglineKey="scenes.systemPrompt.tagline"
      versionBadge
      introStoryKey="scenes.systemPrompt.introStory"
      bulletKeys={[
        "scenes.systemPrompt.bullets.0",
        "scenes.systemPrompt.bullets.1",
        "scenes.systemPrompt.bullets.2",
        "scenes.systemPrompt.bullets.3",
      ]}
      techFeatureKeys={[
        "scenes.systemPrompt.techFeatures.0",
        "scenes.systemPrompt.techFeatures.1",
        "scenes.systemPrompt.techFeatures.2",
        "scenes.systemPrompt.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.systemPrompt} />}
      interaction={<SystemPromptDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            <li>{t("scenes.systemPrompt.explain.0")}</li>
            <li>{t("scenes.systemPrompt.explain.1")}</li>
            <li>{t("scenes.systemPrompt.explain.2")}</li>
            <li>{t("scenes.systemPrompt.explain.3")}</li>
          </ul>
          <div className="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
            <p className="font-medium text-cyan-300">{t("scenes.systemPrompt.formatNote")}</p>
            <p className="mt-1 text-slate-400">{t("scenes.systemPrompt.formatNoteBody")}</p>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
            <p className="font-medium text-amber-300">{t("scenes.systemPrompt.nonceNote")}</p>
            <p className="mt-1 text-slate-400">{t("scenes.systemPrompt.nonceNoteBody")}</p>
          </div>
          <div>
            <p className="mb-1 text-xs text-slate-500">{t("scenes.systemPrompt.curlExample")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {CURL_EXAMPLE}
            </pre>
          </div>
          <p className="font-mono text-xs text-cyan-600/80">{t("scenes.systemPrompt.opsTip")}</p>
        </div>
      }
    />
  );
}

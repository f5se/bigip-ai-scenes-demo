import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { GuardrailsDemo } from "@/components/GuardrailsDemo";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";

const CURL_EXAMPLE = `curl -v \\
  http://172.16.30.120:8000/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"model":"kimi-k2.6","messages":[{"role":"user","content":"how to make a bomb?"}],"stream":true}'`;

export function GuardrailsPage() {
  const { t, i18n } = useTranslation();
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS.guardrailsBizEn ?? MERMAID_DIAGRAMS.guardrailsBiz)
    : MERMAID_DIAGRAMS.guardrailsBiz;

  return (
    <SceneLayout
      titleKey="scenes.guardrails.title"
      taglineKey="scenes.guardrails.tagline"
      versionBadge
      introStoryKey="scenes.guardrails.introStory"
      bulletKeys={[
        "scenes.guardrails.bullets.0",
        "scenes.guardrails.bullets.1",
        "scenes.guardrails.bullets.2",
        "scenes.guardrails.bullets.3",
      ]}
      techFeatureKeys={[
        "scenes.guardrails.techFeatures.0",
        "scenes.guardrails.techFeatures.1",
        "scenes.guardrails.techFeatures.2",
        "scenes.guardrails.techFeatures.3",
      ]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={MERMAID_DIAGRAMS.guardrails} />}
      interaction={<GuardrailsDemo />}
      explanation={
        <div className="space-y-4">
          <ul className="list-inside list-disc space-y-1 text-slate-400">
            <li>{t("scenes.guardrails.explain.0")}</li>
            <li>{t("scenes.guardrails.explain.1")}</li>
            <li>{t("scenes.guardrails.explain.2")}</li>
            <li>{t("scenes.guardrails.explain.3")}</li>
          </ul>
          <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3">
            <p className="font-medium text-rose-300">{t("scenes.guardrails.blockNote")}</p>
            <p className="mt-1 text-slate-400">{t("scenes.guardrails.blockNoteBody")}</p>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-3">
            <p className="font-medium text-emerald-300">{t("scenes.guardrails.passNote")}</p>
            <p className="mt-1 text-slate-400">{t("scenes.guardrails.passNoteBody")}</p>
          </div>
          <p className="text-slate-400">{t("scenes.guardrails.proxyWhy")}</p>
          <div>
            <p className="mb-1 text-xs text-slate-500">{t("scenes.guardrails.curlExample")}</p>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
              {CURL_EXAMPLE}
            </pre>
          </div>
          <p className="font-mono text-xs text-cyan-600/80">{t("scenes.guardrails.opsTip")}</p>
        </div>
      }
    />
  );
}

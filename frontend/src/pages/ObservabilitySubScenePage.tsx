import { useTranslation } from "react-i18next";
import { ObservabilityTrafficPanel } from "@/components/ObservabilityTrafficPanel";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";
import { collectSceneIntroKeys } from "@/utils/sceneIntro";
import { useGrafanaConfig } from "@/utils/grafana";

type Props = {
  pageKey: "obsTokens" | "obsMetrics";
};

export function ObservabilitySubScenePage({ pageKey }: Props) {
  const { t, i18n } = useTranslation();
  const { openUrl: grafanaUrl, baseUrl: grafanaBaseUrl } = useGrafanaConfig();
  const prefix = `scenes.${pageKey}`;
  const technicalChart = MERMAID_DIAGRAMS[pageKey] ?? MERMAID_DIAGRAMS.placeholder;
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS[`${pageKey}BizEn`] ??
      MERMAID_DIAGRAMS[`${pageKey}Biz`] ??
      technicalChart)
    : (MERMAID_DIAGRAMS[`${pageKey}Biz`] ?? technicalChart);

  const bulletKeys = collectSceneIntroKeys(prefix, "bullets", t);
  const techFeatureKeys = collectSceneIntroKeys(prefix, "techFeatures", t);

  const isTokens = pageKey === "obsTokens";

  const interaction = (
    <div className="space-y-4">
      <ObservabilityTrafficPanel pageKey={pageKey} />

      <div>
        <p className="text-sm font-medium text-cyan-300">{t(`${prefix}.interactionTitle`)}</p>
        <p className="mt-1 text-xs text-slate-400">{t(`${prefix}.interactionSubtitle`)}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-cyan-700/40 bg-slate-900/50 p-3">
          <p className="mb-2 text-xs font-medium text-cyan-300">
            {isTokens ? "Prompt / Completion Tokens" : "Request / Error / Retry"}
          </p>
          <div className="h-16 rounded bg-slate-800/70 p-2">
            <div className="h-full w-full rounded border border-slate-600/70 bg-gradient-to-r from-cyan-500/20 via-emerald-500/20 to-rose-500/20" />
          </div>
        </div>
        <div className="rounded-lg border border-cyan-700/40 bg-slate-900/50 p-3">
          <p className="mb-2 text-xs font-medium text-cyan-300">
            {isTokens ? "Cost By Model / Version" : "TTFT p95 / Latency p95"}
          </p>
          <div className="h-16 rounded bg-slate-800/70 p-2">
            <div className="flex h-full items-end gap-1">
              <span className="h-4 w-3 rounded-sm bg-cyan-400/50" />
              <span className="h-7 w-3 rounded-sm bg-cyan-400/60" />
              <span className="h-10 w-3 rounded-sm bg-cyan-400/70" />
              <span className="h-8 w-3 rounded-sm bg-cyan-400/60" />
              <span className="h-12 w-3 rounded-sm bg-cyan-400/80" />
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-cyan-700/40 bg-slate-900/50 p-3">
          <p className="mb-2 text-xs font-medium text-cyan-300">
            {isTokens ? "Top-N Spenders" : "Model / Pool Drilldown"}
          </p>
          <div className="h-16 rounded bg-slate-800/70 p-2">
            <div className="h-full w-full rounded border border-slate-600/70 bg-gradient-to-t from-violet-500/20 via-amber-500/20 to-cyan-500/20" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={grafanaUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/20"
        >
          {t(`${prefix}.openGrafana`)}
        </a>
        <span className="text-xs text-slate-400">
          {t(`${prefix}.linkHint`, { url: grafanaBaseUrl })}
        </span>
      </div>
    </div>
  );

  return (
    <SceneLayout
      titleKey={`${prefix}.title`}
      taglineKey={`${prefix}.tagline`}
      introStoryKey={
        t(`${prefix}.introStory`, { defaultValue: "" }) ? `${prefix}.introStory` : undefined
      }
      bulletKeys={bulletKeys.length > 0 ? bulletKeys : [`${prefix}.bullets.0`]}
      techFeatureKeys={techFeatureKeys.length > 0 ? techFeatureKeys : undefined}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={technicalChart} />}
      interaction={interaction}
      explanation={
        <div className="space-y-3">
          <p className="text-slate-400">{t(`${prefix}.plannedIntro`)}</p>
          <ul className="list-inside list-disc space-y-1 text-slate-500">
            <li>{t(`${prefix}.planned.0`)}</li>
            <li>{t(`${prefix}.planned.1`)}</li>
            <li>{t(`${prefix}.planned.2`)}</li>
          </ul>
        </div>
      }
    />
  );
}

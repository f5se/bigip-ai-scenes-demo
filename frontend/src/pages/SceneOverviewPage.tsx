import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { SubFeatureName } from "@/components/SubFeatureName";
import { MERMAID_DIAGRAMS, scenes } from "@/scenes/manifest";

type Props = {
  sceneId: string;
};

export function SceneOverviewPage({ sceneId }: Props) {
  const { t, i18n } = useTranslation();
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return null;

  const k = scene.i18nKey;
  const isObservability = scene.id === "observability";
  const grafanaUrl =
    "http://localhost:3001/d/adz84xj/f5-big-ip-llm?orgId=1&from=now-5m&to=now&timezone=browser&var-model=$__all&var-pool=$__all&var-member=$__all&var-client_ip=$__all&var-price_version=v1&refresh=10s";
  const technicalChart =
    MERMAID_DIAGRAMS[scene.overviewDiagramKey ?? "placeholder"] ?? MERMAID_DIAGRAMS.placeholder;
  const businessChartKey = `${scene.overviewDiagramKey ?? "placeholder"}Biz`;
  const businessChartEnKey = `${businessChartKey}En`;
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS[businessChartEnKey] ??
      MERMAID_DIAGRAMS[businessChartKey] ??
      technicalChart)
    : (MERMAID_DIAGRAMS[businessChartKey] ?? technicalChart);
  const bullets = ["0", "1", "2", "3"]
    .map((i) => `scenes.${k}.bullets.${i}`)
    .filter((key) => {
      const v = t(key, { defaultValue: "" });
      return v !== "" && v !== key;
    });

  const defaultInteraction = (
    <div className="grid gap-3 sm:grid-cols-2">
      {scene.subFeatures?.map((sf) => (
        <Link
          key={sf.id}
          to={sf.path}
          className={`rounded-lg border p-4 transition ${
            sf.ready
              ? "border-cyan-700/40 bg-slate-800/50 hover:border-cyan-500/50"
              : "border-dashed border-slate-600 bg-slate-900/40 hover:border-slate-500"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SubFeatureName
              titleKey={sf.titleKey}
              versionBadge={sf.versionBadge}
              available={sf.ready}
              planned={!sf.ready}
              titleClassName="font-medium text-cyan-400"
              badgeClassName="text-[10px] font-normal text-slate-500"
            />
          </div>
        </Link>
      ))}
    </div>
  );

  const observabilityInteraction = (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-cyan-300">
          {t("scenes.observability.interactionTitle")}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {t("scenes.observability.interactionSubtitle")}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-cyan-700/40 bg-slate-900/50 p-3">
          <p className="mb-2 text-xs font-medium text-cyan-300">
            {t("scenes.observability.mockPanels.traffic")}
          </p>
          <div className="h-16 rounded bg-slate-800/70 p-2">
            <div className="h-full w-full rounded border border-slate-600/70 bg-gradient-to-r from-cyan-500/20 via-emerald-500/20 to-rose-500/20" />
          </div>
        </div>
        <div className="rounded-lg border border-cyan-700/40 bg-slate-900/50 p-3">
          <p className="mb-2 text-xs font-medium text-cyan-300">
            {t("scenes.observability.mockPanels.quality")}
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
            {t("scenes.observability.mockPanels.cost")}
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
          {t("scenes.observability.openGrafana")}
        </a>
        <span className="text-xs text-slate-400">{t("scenes.observability.linkHint")}</span>
      </div>
    </div>
  );

  return (
    <SceneLayout
      titleKey={`scenes.${k}.title`}
      taglineKey={`scenes.${k}.tagline`}
      introStoryKey={
        t(`scenes.${k}.introStory`, { defaultValue: "" })
          ? `scenes.${k}.introStory`
          : undefined
      }
      bulletKeys={bullets.length > 0 ? bullets : [`scenes.${k}.bullets.0`]}
      diagramBusiness={<MermaidDiagram chart={businessChart} />}
      diagramTechnical={<MermaidDiagram chart={technicalChart} />}
      interaction={isObservability ? observabilityInteraction : defaultInteraction}
      explanation={
        <p className="text-slate-400">
          {t(`scenes.${k}.overviewNote`, { defaultValue: t("app.comingSoonHint") })}
        </p>
      }
    />
  );
}

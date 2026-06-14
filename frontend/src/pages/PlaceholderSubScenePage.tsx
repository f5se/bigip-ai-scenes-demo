import { useTranslation } from "react-i18next";
import { SceneLayout } from "@/components/SceneLayout";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { ComingSoonPanel } from "@/components/ComingSoonPanel";
import { MERMAID_DIAGRAMS } from "@/scenes/manifest";
import { collectSceneIntroKeys } from "@/utils/sceneIntro";

type Props = {
  pageKey: string;
};

export function PlaceholderSubScenePage({ pageKey }: Props) {
  const { t, i18n } = useTranslation();
  const prefix = `scenes.${pageKey}`;
  const technicalChart = MERMAID_DIAGRAMS[pageKey] ?? MERMAID_DIAGRAMS.placeholder;
  const businessChart = i18n.language.startsWith("en")
    ? (MERMAID_DIAGRAMS[`${pageKey}BizEn`] ??
      MERMAID_DIAGRAMS[`${pageKey}Biz`] ??
      technicalChart)
    : (MERMAID_DIAGRAMS[`${pageKey}Biz`] ?? technicalChart);

  const bulletKeys = collectSceneIntroKeys(prefix, "bullets", t);
  const techFeatureKeys = collectSceneIntroKeys(prefix, "techFeatures", t);

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
      interaction={<ComingSoonPanel />}
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

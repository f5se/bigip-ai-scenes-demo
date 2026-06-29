import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppBrand } from "@/components/AppBrand";
import { AiComplexityHero } from "@/components/home/AiComplexityHero";
import { SubFeatureName } from "@/components/SubFeatureName";
import { scenes } from "@/scenes/manifest";

export function HomePage() {
  const { t } = useTranslation();

  return (
    <div>
      <div className="glass-card mb-3 p-3 md:p-4">
        <AppBrand variant="header" linkToHome={false} />
      </div>
      <AiComplexityHero />
      <p className="text-base text-slate-400">{t("home.pickScene")}</p>
      <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-2">
        {scenes.map((scene) => (
          <Link
            key={scene.id}
            to={scene.path}
            className="glass-card block p-7 transition hover:border-cyan-500/50 hover:shadow-cyan-900/30"
          >
            <h2 className="text-2xl font-semibold text-cyan-400">{t(scene.titleKey)}</h2>
            <p className="mt-2 text-base leading-relaxed text-slate-400">{t(scene.descKey)}</p>
            {scene.subFeatures && (
              <ul className="mt-5 space-y-2 text-sm leading-relaxed text-slate-400">
                {scene.subFeatures.map((sf) => (
                  <li key={sf.id}>
                    <span className="text-slate-500">→ </span>
                    <SubFeatureName
                      titleKey={sf.titleKey}
                      versionBadge={sf.versionBadge}
                      planned={!sf.ready}
                      titleClassName="font-medium text-slate-300"
                      badgeClassName="text-[11px] font-normal text-slate-500"
                      plannedClassName="rounded bg-amber-950/50 px-1.5 py-0.5 text-[10px] text-amber-500/90"
                    />
                  </li>
                ))}
              </ul>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

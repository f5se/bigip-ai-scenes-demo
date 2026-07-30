import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { scenes } from "@/scenes/manifest";
import { AppBrand } from "./AppBrand";
import { SubFeatureName } from "./SubFeatureName";

type Props = {
  collapsed?: boolean;
};

export function Sidebar({ collapsed = false }: Props) {
  const { t } = useTranslation();

  if (collapsed) return null;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900/90">
      <div className="border-b border-slate-800 px-4 py-5">
        <AppBrand variant="sidebar" />
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <p className="mb-2 px-2 text-xs font-semibold uppercase text-slate-500">
          {t("nav.scenes")}
        </p>
        {scenes.map((scene) => (
          <div key={scene.id} className="mb-3">
            <NavLink
              to={scene.path}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-cyan-600/20 text-cyan-300"
                    : "text-slate-300 hover:bg-slate-800"
                }`
              }
            >
              {t(scene.titleKey)}
            </NavLink>
            {scene.subFeatures && (
              <ul className="ml-3 mt-1 space-y-0.5 border-l border-slate-700 pl-3">
                {scene.subFeatures.map((sf) => (
                  <li key={sf.id}>
                    <NavLink
                      to={sf.path}
                      className={({ isActive }) =>
                        `block rounded px-2 py-1.5 text-xs transition ${
                          isActive
                            ? "text-cyan-400"
                            : "text-slate-400 hover:text-slate-200"
                        }`
                      }
                    >
                      <SubFeatureName
                        titleKey={sf.titleKey}
                        versionBadge={sf.versionBadge}
                        versionBadgeKey={sf.versionBadgeKey}
                        planned={!sf.ready}
                      />
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
}

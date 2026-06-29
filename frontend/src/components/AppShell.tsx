import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { fetchAuthMe, logout } from "@/api/client";
import { shouldShowMemberGuard } from "@/constants/memberGuard";
import { AppBrand } from "./AppBrand";
import { DeepseekMemberGuardBanner } from "./DeepseekMemberGuardBanner";
import { Sidebar } from "./Sidebar";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const [fullscreen, setFullscreen] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const showMemberGuard = shouldShowMemberGuard(location.pathname);

  useEffect(() => {
    fetchAuthMe()
      .then((user) => setUsername(user.username))
      .catch(() => {
        setUsername(null);
      });
  }, []);

  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={fullscreen} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-4">
            {fullscreen && <AppBrand variant="header" />}
          </div>
          <div className="flex items-center gap-4">
            {username ? (
              <span className="hidden text-xs text-slate-400 sm:inline">
                {t("app.loggedInAs")}{" "}
                <span className="font-medium text-cyan-400">{username}</span>
              </span>
            ) : null}
            <LanguageSwitcher />
            {username ? (
              <button type="button" className="btn-secondary text-xs" onClick={() => logout()}>
                {t("app.logout")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setFullscreen((f) => !f)}
            >
              {fullscreen ? t("app.exitFullscreen") : t("app.fullscreen")}
            </button>
          </div>
        </header>
        {showMemberGuard && <DeepseekMemberGuardBanner key={location.pathname} />}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet context={{ fullscreen }} />
        </main>
      </div>
    </div>
  );
}

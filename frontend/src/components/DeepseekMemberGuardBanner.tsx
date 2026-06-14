import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  checkPoolMemberGuard,
  enablePoolMemberGuard,
  type PoolMemberGuardStatus,
} from "@/api/client";

type BannerState = "checking" | "hidden" | "visible" | "enabling";

export function DeepseekMemberGuardBanner() {
  const { t } = useTranslation();
  const [bannerState, setBannerState] = useState<BannerState>("checking");
  const [info, setInfo] = useState<PoolMemberGuardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setError(null);
    setBannerState("checking");
    try {
      const data = await checkPoolMemberGuard();
      setInfo(data);
      setBannerState(data.disabled ? "visible" : "hidden");
    } catch (e) {
      setInfo(null);
      setBannerState("hidden");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const handleEnable = async () => {
    setBannerState("enabling");
    setError(null);
    try {
      await enablePoolMemberGuard();
      await check();
    } catch (e) {
      setBannerState("visible");
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (bannerState === "checking" || bannerState === "hidden") {
    return null;
  }

  return (
    <div
      className="border-b border-amber-500/40 bg-amber-950/60 px-6 py-3 backdrop-blur"
      role="alert"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-sm text-amber-100">
          <p>
            {t("memberGuard.message", {
              pool: info?.pool_short ?? "pool_deepseek-chat",
              member: info?.member ?? "ubuntu-ai:8005",
            })}
          </p>
          {info?.state && (
            <p className="mt-1 text-xs text-amber-200/70">
              {t("memberGuard.stateHint", {
                state: info.state,
                session: info.session ?? "-",
              })}
            </p>
          )}
          {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
        </div>
        <button
          type="button"
          className="btn-primary shrink-0 text-xs"
          disabled={bannerState === "enabling"}
          onClick={handleEnable}
        >
          {bannerState === "enabling" ? t("memberGuard.enabling") : t("memberGuard.enable")}
        </button>
      </div>
    </div>
  );
}

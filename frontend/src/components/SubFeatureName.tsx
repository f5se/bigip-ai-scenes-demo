import { useTranslation } from "react-i18next";

type Props = {
  titleKey: string;
  versionBadge?: boolean;
  versionBadgeKey?: string;
  planned?: boolean;
  available?: boolean;
  titleClassName?: string;
  badgeClassName?: string;
  plannedClassName?: string;
  availableClassName?: string;
};

export function SubFeatureName({
  titleKey,
  versionBadge,
  versionBadgeKey = "nav.tmosMinVersion",
  planned,
  available,
  titleClassName = "",
  badgeClassName = "text-[9px] font-normal text-slate-500",
  plannedClassName = "rounded bg-amber-950/50 px-1 text-[9px] text-amber-500/90",
  availableClassName = "rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400",
}: Props) {
  const { t } = useTranslation();
  const effectiveBadgeKey =
    titleKey === "nav.mcpToolsControl" ? "nav.tmosMinVersionApm" : versionBadgeKey;

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${titleClassName}`}>
      <span>{t(titleKey)}</span>
      {versionBadge ? (
        <span className={badgeClassName}>{t(effectiveBadgeKey)}</span>
      ) : null}
      {planned ? (
        <span className={plannedClassName}>{t("nav.planned")}</span>
      ) : null}
      {available ? (
        <span className={availableClassName}>{t("nav.available")}</span>
      ) : null}
    </span>
  );
}

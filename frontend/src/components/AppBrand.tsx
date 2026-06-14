import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import f5Icon from "@/assets/f5-icon.svg";

type Props = {
  /** Sidebar: compact stack; header: inline row */
  variant?: "sidebar" | "header";
  linkToHome?: boolean;
};

export function AppBrand({ variant = "sidebar", linkToHome = true }: Props) {
  const { t } = useTranslation();
  const isSidebar = variant === "sidebar";

  const content = (
    <div
      className={`flex items-center gap-3 ${isSidebar ? "items-start" : "items-center"}`}
    >
      <img
        src={f5Icon}
        alt="F5"
        className={`shrink-0 rounded-full object-contain shadow-sm shadow-black/20 ${
          isSidebar ? "h-11 w-11" : "h-9 w-9"
        }`}
      />
      <div className="min-w-0">
        <p
          className={`font-bold leading-tight text-white ${
            isSidebar ? "text-[15px] tracking-tight" : "text-base"
          }`}
        >
          {t("app.title")}
        </p>
        <p
          className={`leading-snug text-slate-400 ${
            isSidebar ? "mt-1 text-[11px] leading-relaxed" : "mt-0.5 text-xs"
          }`}
        >
          {t("app.subtitle")}
        </p>
      </div>
    </div>
  );

  if (linkToHome) {
    return (
      <Link
        to="/"
        className="block rounded-lg transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500/60"
      >
        {content}
      </Link>
    );
  }

  return content;
}

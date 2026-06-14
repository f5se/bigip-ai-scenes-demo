import { useTranslation } from "react-i18next";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = i18n.language.startsWith("en") ? "en" : "zh";

  const setLang = (lng: "zh" | "en") => {
    i18n.changeLanguage(lng);
    localStorage.setItem("llm-demo-lang", lng);
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">{t("app.language")}</span>
      <button
        type="button"
        className={`rounded px-2 py-1 ${current === "zh" ? "bg-cyan-600/30 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
        onClick={() => setLang("zh")}
      >
        中文
      </button>
      <button
        type="button"
        className={`rounded px-2 py-1 ${current === "en" ? "bg-cyan-600/30 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
        onClick={() => setLang("en")}
      >
        EN
      </button>
    </div>
  );
}

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zh from "./zh.json";

const saved = localStorage.getItem("llm-demo-lang");

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: saved === "en" || saved === "zh" ? saved : "zh",
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
});

export default i18n;

import type { TFunction } from "i18next";

/** Collect scenes.{key}.bullets.N or techFeatures.N keys that exist in i18n */
export function collectSceneIntroKeys(
  prefix: string,
  section: "bullets" | "techFeatures",
  t: TFunction,
  max = 4
): string[] {
  return Array.from({ length: max }, (_, i) => `${prefix}.${section}.${i}`).filter((key) => {
    const v = t(key, { defaultValue: "" });
    return v !== "" && v !== key;
  });
}

import { useTranslation } from "react-i18next";
import type { SystemPromptPreview } from "@/api/client";
import {
  buildHighlightedLines,
  highlightLineClass,
  type HighlightKind,
} from "@/utils/wrappedSystemHighlight";

type Props = {
  preview: SystemPromptPreview | null;
  loading?: boolean;
  presetId: string;
};

const LEGEND_BY_PRESET: Record<string, HighlightKind[]> = {
  format_override: ["mandatory-key", "user-conflict", "mandatory-block"],
  injection_attack: ["mandatory-key", "user-contained", "mandatory-block"],
  benign: ["mandatory-key", "admin-block", "mandatory-block"],
};

export function WrapperDiffPanel({ preview, loading, presetId }: Props) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <p className="text-sm text-slate-500">{t("systemPromptDemo.previewLoading")}</p>
    );
  }

  if (!preview) {
    return (
      <p className="text-sm text-slate-500">{t("systemPromptDemo.previewIdle")}</p>
    );
  }

  const tagLayers = [
    { tag: preview.tags.outer, label: t("systemPromptDemo.tagOuter") },
    { tag: preview.tags.admin, label: t("systemPromptDemo.tagAdmin") },
    { tag: preview.tags.user, label: t("systemPromptDemo.tagUser") },
    { tag: preview.tags.guardrails, label: t("systemPromptDemo.tagMandatoryRules") },
  ];

  const highlighted = buildHighlightedLines(
    preview.wrapped_system,
    presetId,
    preview.tags
  );

  const legendKinds = LEGEND_BY_PRESET[presetId] ?? ["mandatory-key", "mandatory-block"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        {tagLayers.map(({ tag, label }) => (
          <span
            key={tag}
            className="rounded-full bg-cyan-950/50 px-2 py-0.5 ring-1 ring-cyan-500/30"
            title={tag}
          >
            <span className="text-slate-400">{label}</span>
            <span className="ml-1 font-mono text-cyan-400">{tag}</span>
          </span>
        ))}
        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-400">
          nonce={preview.nonce}
        </span>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-rose-300">
          {t("systemPromptDemo.clientSystem")}
        </p>
        <pre className="max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-400">
          {preview.original_system}
        </pre>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-emerald-300">
          {t("systemPromptDemo.wrappedSystem")}
        </p>
        <div className="max-h-56 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed">
          {highlighted.map((line, index) => (
            <div key={index} className={highlightLineClass(line.kind)}>
              {line.text || "\u00A0"}
            </div>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-500">
          {legendKinds.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span
                className={`inline-block min-w-[1.25rem] px-1 ${highlightLineClass(kind)}`}
              >
                ·
              </span>
              {t(`systemPromptDemo.legend.${kind}`)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

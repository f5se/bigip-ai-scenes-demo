import type { McpControlRunResult } from "@/api/client";
import { useTranslation } from "react-i18next";

const PREFIX = "scenes.mcpToolsControl";

type Props = {
  result: McpControlRunResult;
};

export function McpControlResultTimeline({ result }: Props) {
  const { t } = useTranslation();
  const isTier2 = result.scenario === "tier2";
  const mcpAllowed = result.decision === "allow" || result.gateway_result?.allowed === true;
  const groups = result.token_summary?.mcp_groups;
  const groupsText =
    groups == null ? "—" : Array.isArray(groups) ? groups.join(", ") : String(groups);
  const roleText = result.token_summary?.mcp_role ?? "—";
  const hasGroups = groups != null && String(groups).trim() !== "";

  const modeLabel = isTier2 ? t(`${PREFIX}.tabs.tier2`) : t(`${PREFIX}.tabs.tier1`);
  const bannerText = (() => {
    if (mcpAllowed) {
      return isTier2 ? t(`${PREFIX}.resultAllowTier2`) : t(`${PREFIX}.resultAllowTier1`);
    }
    if (isTier2) {
      if ((result.init_result?.status_code ?? 0) !== 200) {
        return t(`${PREFIX}.reason.tier2BlockedByTier1`);
      }
      return t(`${PREFIX}.reason.tier2ToolDenied`);
    }
    return hasGroups ? t(`${PREFIX}.reason.tier1ServerDenied`) : t(`${PREFIX}.reason.tier1NoGroup`);
  })();

  return (
    <div className="space-y-3">
      <div
        className={`rounded-lg border px-3 py-2 text-sm font-medium ${
          mcpAllowed
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-amber-500/40 bg-amber-500/10 text-amber-100"
        }`}
      >
        {bannerText}
        <span className="ml-2 font-mono text-xs opacity-80">
          {modeLabel} · {result.agent} → {result.target_server}
          {result.tool_name ? ` · ${result.tool_name}` : ""}
        </span>
      </div>

      <ol className="space-y-2">
        <li className="rounded border border-slate-700/80 bg-slate-950/50 px-3 py-2 text-sm">
          <p className="text-slate-200">{t(`${PREFIX}.timeline.steps.token`)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {t(`${PREFIX}.timeline.tokenOk`, { groups: groupsText })} · mcp_role={roleText}
          </p>
        </li>

        {result.init_result ? (
          <li className="rounded border border-slate-700/80 bg-slate-950/50 px-3 py-2 text-sm">
            <p className="text-slate-200">{t(`${PREFIX}.timeline.steps.gateway`)}</p>
            <p className="mt-1 text-xs text-slate-400">
              initialize HTTP {result.init_result.status_code}
              {result.init_result.mcp_session_id ? " · session established" : ""}
            </p>
          </li>
        ) : null}

        <li className="rounded border border-slate-700/80 bg-slate-950/50 px-3 py-2 text-sm">
          <p className="text-slate-200">
            {isTier2 ? t(`${PREFIX}.timeline.steps.mcp`) : t(`${PREFIX}.timeline.steps.decision`)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            HTTP {result.gateway_result?.status_code ?? "-"} · content-type=
            {result.gateway_result?.content_type ?? "-"}
          </p>
          {!mcpAllowed ? (
            <p className="mt-1 text-xs text-amber-300">{bannerText}</p>
          ) : null}
        </li>
      </ol>

      {result.gateway_result?.body_preview ? (
        <pre className="max-h-40 overflow-auto rounded border border-slate-700 bg-slate-950 p-2 text-[11px] text-slate-400">
          {result.gateway_result.body_preview}
        </pre>
      ) : null}
      {result.error_body ? (
        <pre className="max-h-32 overflow-auto rounded border border-rose-800/50 bg-rose-950/20 p-2 text-[11px] text-rose-300/80">
          {result.error_body}
        </pre>
      ) : null}
    </div>
  );
}

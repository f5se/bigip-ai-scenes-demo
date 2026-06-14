import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildSchedulerDirectUrl,
  buildSchedulerProxyUrl,
  type SchedulerPoolStatus,
  type Target,
  type TblbModelResult,
  type TblbPoolGroup,
  type TblbTriggerMemberResult,
} from "@/api/client";
import { TblbResultCard } from "./TblbResultCard";

type CardState = "pending" | "active" | "success" | "error";

type ModelRow = {
  model: string;
  result: TblbModelResult;
  state: CardState;
};

type SchedulerState = {
  loading: boolean;
  error: string | null;
  data: SchedulerPoolStatus | null;
};

type Props = {
  pool: TblbPoolGroup;
  models: ModelRow[];
  scheduler: SchedulerState;
  schedulerTarget: Target;
  schedulerPartition: string;
  onRefreshScheduler: () => void;
  onTriggerMemberLoad: () => void;
  refreshDisabled?: boolean;
  triggerDisabled?: boolean;
  triggeringLoad?: boolean;
  triggerResults?: TblbTriggerMemberResult[] | null;
};

const SCHEDULER_BAR = "bg-violet-500/70";
const TRIGGER_ENDPOINTS_AUTO_COLLAPSE_MS = 2500;

export function TblbPoolPanel({
  pool,
  models,
  scheduler,
  schedulerTarget,
  schedulerPartition,
  onRefreshScheduler,
  onTriggerMemberLoad,
  refreshDisabled = false,
  triggerDisabled = false,
  triggeringLoad = false,
  triggerResults = null,
}: Props) {
  const { t } = useTranslation();
  const anyActive = models.some((m) => m.state === "active");
  const [triggerEndpointsOpen, setTriggerEndpointsOpen] = useState(false);
  const [directEndpointOpen, setDirectEndpointOpen] = useState(false);
  const [proxyEndpointOpen, setProxyEndpointOpen] = useState(false);
  const collapseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!triggerResults?.length) {
      setTriggerEndpointsOpen(false);
      return;
    }
    setTriggerEndpointsOpen(true);
    if (collapseTimerRef.current !== null) {
      window.clearTimeout(collapseTimerRef.current);
    }
    collapseTimerRef.current = window.setTimeout(() => {
      setTriggerEndpointsOpen(false);
      collapseTimerRef.current = null;
    }, TRIGGER_ENDPOINTS_AUTO_COLLAPSE_MS);

    return () => {
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, [triggerResults]);

  const directUrl = buildSchedulerDirectUrl(
    pool.pool_short,
    schedulerTarget,
    schedulerPartition
  );
  const proxyUrl = buildSchedulerProxyUrl(
    pool.pool_short,
    schedulerTarget,
    schedulerPartition
  );

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <div>
          <h3 className="font-medium text-cyan-300">
            <code>{pool.pool_short}</code>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {pool.tblb_enabled ? (
              <span className="text-emerald-400">{t("tblbDemo.tblbEnabled")}</span>
            ) : (
              <span className="text-slate-400">{t("tblbDemo.tblbDisabled")}</span>
            )}
          </p>
        </div>
        {pool.tblb_enabled && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={onTriggerMemberLoad}
              disabled={triggerDisabled || triggeringLoad}
            >
              {triggeringLoad
                ? t("app.running")
                : t("tblbDemo.triggerMemberLoad")}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={onRefreshScheduler}
              disabled={refreshDisabled || scheduler.loading}
            >
              {scheduler.loading ? t("app.running") : t("tblbDemo.refreshScheduler")}
            </button>
          </div>
        )}
      </div>

      {pool.tblb_enabled && (
        <div className="mb-4 rounded-lg border border-violet-500/30 bg-violet-950/20 p-3">
          <p className="mb-2 text-xs font-medium text-violet-300">
            {t("tblbDemo.schedulerDistribution")}
          </p>
          <div className="mb-3 space-y-1.5">
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-600 hover:text-slate-400"
                onClick={() => setDirectEndpointOpen((open) => !open)}
              >
                <span>{t("tblbDemo.schedulerEndpointDirect")}</span>
                <span className="normal-case tracking-normal text-slate-500">
                  {directEndpointOpen
                    ? t("tblbDemo.triggerEndpointsCollapse")
                    : t("tblbDemo.triggerEndpointsExpand")}
                </span>
              </button>
              {directEndpointOpen && (
                <code className="mt-0.5 block break-all rounded bg-slate-950/80 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-400">
                  GET {directUrl}
                </code>
              )}
            </div>
            <div>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-600 hover:text-slate-400"
                onClick={() => setProxyEndpointOpen((open) => !open)}
              >
                <span>{t("tblbDemo.schedulerEndpointProxy")}</span>
                <span className="normal-case tracking-normal text-slate-500">
                  {proxyEndpointOpen
                    ? t("tblbDemo.triggerEndpointsCollapse")
                    : t("tblbDemo.triggerEndpointsExpand")}
                </span>
              </button>
              {proxyEndpointOpen && (
                <code className="mt-0.5 block break-all rounded bg-slate-950/80 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-400">
                  GET {proxyUrl}
                </code>
              )}
            </div>
          </div>
          {scheduler.loading && (
            <p className="text-xs text-slate-500">{t("tblbDemo.schedulerLoading")}</p>
          )}
          {!scheduler.loading && scheduler.error && (
            <p className="text-xs text-amber-400">
              {t("tblbDemo.schedulerError")}: {scheduler.error}
            </p>
          )}
          {!scheduler.loading &&
            !scheduler.error &&
            scheduler.data &&
            scheduler.data.members.length > 0 && (
              <div className="space-y-2">
                {scheduler.data.members.map((member) => (
                  <div key={`${member.ip}:${member.port}`}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-300">
                        {t("tblbDemo.portLabel", { port: member.port })}
                      </span>
                      <span className="text-slate-500">
                        {member.percent}% · score {member.score.toFixed(3)}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${SCHEDULER_BAR}`}
                        style={{
                          width: `${Math.max(member.percent, member.percent > 0 ? 2 : 0)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          {!scheduler.loading &&
            !scheduler.error &&
            scheduler.data &&
            scheduler.data.members.length === 0 && (
              <p className="text-xs text-slate-500">{t("tblbDemo.schedulerEmpty")}</p>
            )}
          {scheduler.data && (
            <p className="mt-2 text-xs text-slate-500">{t("tblbDemo.compareHint")}</p>
          )}
          {triggerResults && triggerResults.length > 0 && (
            <div className="mt-3 border-t border-violet-500/20 pt-2">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-600 hover:text-slate-400"
                onClick={() => setTriggerEndpointsOpen((open) => !open)}
              >
                <span>
                  {t("tblbDemo.triggerEndpoints")} ({triggerResults.length})
                </span>
                <span className="normal-case tracking-normal text-slate-500">
                  {triggerEndpointsOpen
                    ? t("tblbDemo.triggerEndpointsCollapse")
                    : t("tblbDemo.triggerEndpointsExpand")}
                </span>
              </button>
              {triggerEndpointsOpen && (
                <div className="mt-1.5 space-y-1">
                  {triggerResults.map((row) => (
                    <div key={`${row.ip}:${row.port}`} className="text-[11px]">
                      <code
                        className={`block break-all rounded bg-slate-950/80 px-2 py-1 font-mono ${
                          row.ok ? "text-emerald-400/90" : "text-amber-400"
                        }`}
                      >
                        POST {row.url}
                        {row.status_code !== undefined ? ` → ${row.status_code}` : ""}
                        {row.error ? ` (${row.error})` : ""}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3">
        {models.map((row) => (
          <TblbResultCard
            key={row.model}
            result={row.result}
            state={anyActive && row.state === "pending" ? "pending" : row.state}
            compact
          />
        ))}
      </div>
    </div>
  );
}

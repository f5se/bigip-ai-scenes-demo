import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DemoUsageStats, fetchAuthMe, fetchDemoUsageStats } from "@/api/client";
import { scenes } from "@/scenes/manifest";

type RangeKey = "7d" | "30d" | "90d" | "custom";

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}m`;
  return `${(min / 60).toFixed(1)}h`;
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultCustomRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 6);
  return { from: toDateInputValue(from), to: toDateInputValue(to) };
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function BarList({
  items,
  max,
}: {
  items: Array<{ label: string; value: number; hint?: string }>;
  max: number;
}) {
  const peak = Math.max(max, 1);
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="truncate text-slate-300">{item.label}</span>
            <span className="shrink-0 font-mono text-cyan-400">
              {item.value}
              {item.hint ? <span className="ml-2 text-slate-500">{item.hint}</span> : null}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-800">
            <div
              className="h-full rounded bg-gradient-to-r from-cyan-600 to-blue-500"
              style={{ width: `${Math.max(4, (item.value / peak) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="glass-card p-4">
      <p className="section-title">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-cyan-300">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

export function DemoUsagePage() {
  const { t } = useTranslation();
  const initialCustom = useMemo(() => defaultCustomRange(), []);
  const [range, setRange] = useState<RangeKey>("7d");
  const [customFrom, setCustomFrom] = useState(initialCustom.from);
  const [customTo, setCustomTo] = useState(initialCustom.to);
  const [userFilter, setUserFilter] = useState("");
  const [includeAdmin, setIncludeAdmin] = useState(true);
  const [stats, setStats] = useState<DemoUsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});

  const customValid =
    isValidDateInput(customFrom) &&
    isValidDateInput(customTo) &&
    customFrom <= customTo;

  const labelMap = useMemo(() => {
    const map: Record<string, string> = {
      home: t("app.home"),
      "admin/usage": t("usage.title"),
    };
    for (const scene of scenes) {
      map[scene.id] = t(scene.titleKey);
      for (const sf of scene.subFeatures || []) {
        map[`${scene.id}/${sf.id}`] = `${t(scene.titleKey)} / ${t(sf.titleKey)}`;
      }
    }
    return map;
  }, [t]);

  const prettyLabel = useCallback(
    (label: string) => labelMap[label] || label,
    [labelMap]
  );

  useEffect(() => {
    fetchAuthMe()
      .then((user) => setAllowed(user.username.trim().toLowerCase() === "admin"))
      .catch(() => setAllowed(false));
  }, []);

  const load = useCallback(async () => {
    if (allowed !== true) return;
    if (range === "custom" && !customValid) {
      setError(t("usage.rangeInvalid"));
      setStats(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDemoUsageStats({
        range,
        include_admin: includeAdmin,
        ...(range === "custom" ? { start: customFrom, end: customTo } : {}),
        ...(userFilter ? { username: userFilter } : {}),
      });
      setStats(data);
      if (userFilter && !(data.available_users || []).includes(userFilter)) {
        setUserFilter("");
      }
    } catch (err) {
      setStats(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [range, includeAdmin, allowed, customFrom, customTo, customValid, userFilter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (allowed === false) {
    return (
      <div className="glass-card border-rose-500/40 p-6 text-sm text-rose-300">
        {t("usage.adminOnly")}
        <div className="mt-4">
          <Link to="/" className="btn-secondary text-xs">
            {t("app.home")}
          </Link>
        </div>
      </div>
    );
  }

  if (allowed === null) {
    return <p className="text-sm text-slate-500">{t("usage.loading")}</p>;
  }
  const heatItems =
    stats?.scenes.heat.map((row) => ({
      label: prettyLabel(row.label),
      value: row.enters,
    })) || [];
  const cityItems =
    stats?.logins.by_city.map((row) => ({
      label: row.city,
      value: row.count,
    })) || [];
  const userItems =
    stats?.logins.by_user.map((row) => ({
      label: row.username,
      value: row.count,
    })) || [];
  const dwellItems =
    stats?.scenes.dwell.map((row) => ({
      label: prettyLabel(row.label),
      value: Math.round((row.avg_ms || 0) / 1000),
      hint: t("usage.avgShort", { value: formatDuration(row.avg_ms) }),
    })) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="section-title">{t("usage.section")}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-100">{t("usage.title")}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">{t("usage.subtitle")}</p>
        </div>
        <Link to="/" className="btn-secondary text-xs">
          {t("app.home")}
        </Link>
      </div>

      <div className="glass-card flex flex-wrap items-center gap-3 p-4">
        <label className="text-xs text-slate-400">
          {t("usage.range")}
          <select
            className="input-field ml-2 w-auto"
            value={range}
            onChange={(e) => {
              const next = e.target.value as RangeKey;
              setRange(next);
              if (next === "custom" && (!customFrom || !customTo)) {
                const defaults = defaultCustomRange();
                setCustomFrom(defaults.from);
                setCustomTo(defaults.to);
              }
            }}
          >
            <option value="7d">{t("usage.range7d")}</option>
            <option value="30d">{t("usage.range30d")}</option>
            <option value="90d">{t("usage.range90d")}</option>
            <option value="custom">{t("usage.rangeCustom")}</option>
          </select>
        </label>
        {range === "custom" ? (
          <>
            <label className="text-xs text-slate-400">
              {t("usage.rangeFrom")}
              <input
                type="date"
                className="input-field ml-2 w-auto"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              {t("usage.rangeTo")}
              <input
                type="date"
                className="input-field ml-2 w-auto"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </>
        ) : null}
        <label className="text-xs text-slate-400">
          {t("usage.userFilter")}
          <select
            className="input-field ml-2 w-auto min-w-[9rem]"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          >
            <option value="">{t("usage.userAll")}</option>
            {(stats?.available_users || []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={includeAdmin}
            onChange={(e) => setIncludeAdmin(e.target.checked)}
            className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
          />
          {t("usage.includeAdmin")}
        </label>
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={() => void load()}
          disabled={loading || (range === "custom" && !customValid)}
        >
          {loading ? t("usage.loading") : t("usage.refresh")}
        </button>
        {stats ? (
          <span className="text-xs text-slate-500">
            {t("usage.timezone")}: {stats.timezone}
            {` · ${t("usage.rangeApplied")}: ${formatTs(stats.start)} → ${formatTs(stats.end)}`}
            {!stats.geoip_available ? ` · ${t("usage.geoipMissing")}` : ""}
          </span>
        ) : null}
        {range === "custom" && !customValid ? (
          <span className="text-xs text-amber-300">{t("usage.rangeInvalid")}</span>
        ) : null}
      </div>

      {error ? (
        <div className="glass-card border-rose-500/40 p-4 text-sm text-rose-300">
          {error === "admin only" ? t("usage.adminOnly") : error}
        </div>
      ) : null}

      {stats ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label={t("usage.kpiLogins")} value={stats.logins.total} />
            <Kpi label={t("usage.kpiUsers")} value={stats.logins.unique_users} />
            <Kpi label={t("usage.kpiSceneEnters")} value={stats.scenes.total_enters} />
            <Kpi
              label={t("usage.kpiFailed")}
              value={stats.logins.failed_total}
              sub={t("usage.failedHint")}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="glass-card p-5">
              <h2 className="section-title">{t("usage.sceneHeat")}</h2>
              <p className="mt-1 text-xs text-slate-500">
                {userFilter
                  ? t("usage.userScoped", { user: userFilter })
                  : t("usage.userScopedAll")}
              </p>
              <div className="mt-4">
                {heatItems.length ? (
                  <BarList items={heatItems.slice(0, 12)} max={heatItems[0]?.value || 1} />
                ) : (
                  <p className="text-sm text-slate-500">{t("usage.empty")}</p>
                )}
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="section-title">{t("usage.sceneDwell")}</h2>
              <p className="mt-1 text-xs text-slate-500">{t("usage.dwellHint")}</p>
              <p className="mt-1 text-xs text-slate-500">
                {userFilter
                  ? t("usage.userScoped", { user: userFilter })
                  : t("usage.userScopedAll")}
              </p>
              <div className="mt-4">
                {dwellItems.length ? (
                  <BarList items={dwellItems.slice(0, 12)} max={dwellItems[0]?.value || 1} />
                ) : (
                  <p className="text-sm text-slate-500">{t("usage.empty")}</p>
                )}
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="section-title">{t("usage.cityDist")}</h2>
              <div className="mt-4">
                {cityItems.length ? (
                  <BarList items={cityItems.slice(0, 12)} max={cityItems[0]?.value || 1} />
                ) : (
                  <p className="text-sm text-slate-500">{t("usage.empty")}</p>
                )}
              </div>
            </section>

            <section className="glass-card p-5">
              <h2 className="section-title">{t("usage.userDist")}</h2>
              <div className="mt-4">
                {userItems.length ? (
                  <BarList items={userItems.slice(0, 12)} max={userItems[0]?.value || 1} />
                ) : (
                  <p className="text-sm text-slate-500">{t("usage.empty")}</p>
                )}
              </div>
            </section>
          </div>

          {!userFilter ? (
            <section className="glass-card p-5">
              <h2 className="section-title">{t("usage.byUserTitle")}</h2>
              <p className="mt-1 text-xs text-slate-500">{t("usage.byUserHint")}</p>
              <div className="mt-4 space-y-3">
                {(stats.scenes.by_user || []).length ? (
                  (stats.scenes.by_user || []).map((row) => {
                    const open = !!expandedUsers[row.username];
                    const heat = row.heat.slice(0, 8).map((h) => ({
                      label: prettyLabel(h.label),
                      value: h.enters,
                    }));
                    const dwell = row.dwell.slice(0, 8).map((d) => ({
                      label: prettyLabel(d.label),
                      value: Math.round((d.avg_ms || 0) / 1000),
                      hint: t("usage.avgShort", { value: formatDuration(d.avg_ms) }),
                    }));
                    return (
                      <div
                        key={row.username}
                        className="overflow-hidden rounded border border-slate-700/70 bg-slate-950/40"
                      >
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-900/60"
                          onClick={() =>
                            setExpandedUsers((prev) => ({
                              ...prev,
                              [row.username]: !prev[row.username],
                            }))
                          }
                        >
                          <span className="font-medium text-cyan-300">{row.username}</span>
                          <span className="text-xs text-slate-400">
                            {t("usage.byUserEnters", { count: row.total_enters })}
                            <span className="ml-3 text-slate-500">{open ? "▾" : "▸"}</span>
                          </span>
                        </button>
                        {open ? (
                          <div className="grid gap-4 border-t border-slate-800 p-4 lg:grid-cols-2">
                            <div>
                              <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">
                                {t("usage.byUserTopHeat")}
                              </p>
                              {heat.length ? (
                                <BarList items={heat} max={heat[0]?.value || 1} />
                              ) : (
                                <p className="text-sm text-slate-500">{t("usage.empty")}</p>
                              )}
                            </div>
                            <div>
                              <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">
                                {t("usage.byUserTopDwell")}
                              </p>
                              {dwell.length ? (
                                <BarList items={dwell} max={dwell[0]?.value || 1} />
                              ) : (
                                <p className="text-sm text-slate-500">{t("usage.empty")}</p>
                              )}
                            </div>
                            <div className="lg:col-span-2">
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => setUserFilter(row.username)}
                              >
                                {t("usage.userScoped", { user: row.username })}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">{t("usage.byUserEmpty")}</p>
                )}
              </div>
            </section>
          ) : null}

          <section className="glass-card overflow-hidden p-0">
            <div className="border-b border-slate-800 px-5 py-4">
              <h2 className="section-title">{t("usage.recentLogins")}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">{t("usage.colTime")}</th>
                    <th className="px-5 py-3 font-medium">{t("usage.colUser")}</th>
                    <th className="px-5 py-3 font-medium">{t("usage.colIp")}</th>
                    <th className="px-5 py-3 font-medium">{t("usage.colCity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.logins.recent.length ? (
                    stats.logins.recent.map((row, idx) => (
                      <tr key={`${row.ts}-${row.session_id}-${idx}`} className="border-t border-slate-800/80">
                        <td className="px-5 py-3 font-mono text-xs text-slate-300">{formatTs(row.ts)}</td>
                        <td className="px-5 py-3 text-cyan-300">{row.username}</td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-400">{row.client_ip}</td>
                        <td className="px-5 py-3 text-slate-300">{row.city}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                        {t("usage.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="glass-card overflow-hidden p-0">
            <div className="border-b border-slate-800 px-5 py-4">
              <h2 className="section-title">{t("usage.failedLoginsTitle")}</h2>
              <p className="mt-1 text-xs text-slate-500">{t("usage.failedLoginsHint")}</p>
            </div>
            <div className="grid gap-0 lg:grid-cols-2">
              <div className="border-b border-slate-800 p-5 lg:border-b-0 lg:border-r">
                <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">
                  {t("usage.failedByUser")}
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="pb-2 pr-3 font-medium">{t("usage.colUser")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("usage.colCount")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("usage.colLastIp")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("usage.colLastCity")}</th>
                        <th className="pb-2 font-medium">{t("usage.colLastTime")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats.logins.failed_by_user || []).length ? (
                        (stats.logins.failed_by_user || []).map((row) => (
                          <tr key={row.username} className="border-t border-slate-800/80">
                            <td className="py-2.5 pr-3">
                              <span className="text-rose-300">{row.username}</span>
                              <span className="mt-0.5 block text-[11px] text-slate-500">
                                {row.never_succeeded
                                  ? t("usage.failedNeverSucceeded")
                                  : t("usage.failedAlsoSucceeded")}
                                {row.reasons?.length
                                  ? ` · ${row.reasons.map((r) => `${r.reason}×${r.count}`).join(", ")}`
                                  : ""}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-rose-300">{row.count}</td>
                            <td className="py-2.5 pr-3 font-mono text-xs text-slate-400">{row.last_ip}</td>
                            <td className="py-2.5 pr-3 text-slate-300">{row.last_city}</td>
                            <td className="py-2.5 font-mono text-xs text-slate-400">
                              {formatTs(row.last_ts)}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-6 text-slate-500">
                            {t("usage.empty")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="p-5">
                <p className="mb-3 text-xs uppercase tracking-wide text-slate-500">
                  {t("usage.failedRecent")}
                </p>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="pb-2 pr-3 font-medium">{t("usage.colTime")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("usage.colUser")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("usage.colIp")}</th>
                        <th className="pb-2 pr-3 font-medium">{t("usage.colCity")}</th>
                        <th className="pb-2 font-medium">{t("usage.colReason")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats.logins.failed_recent || []).length ? (
                        (stats.logins.failed_recent || []).slice(0, 40).map((row, idx) => (
                          <tr key={`${row.ts}-${row.username}-${idx}`} className="border-t border-slate-800/80">
                            <td className="py-2.5 pr-3 font-mono text-xs text-slate-400">
                              {formatTs(row.ts)}
                            </td>
                            <td className="py-2.5 pr-3 text-rose-300">{row.username}</td>
                            <td className="py-2.5 pr-3 font-mono text-xs text-slate-400">{row.client_ip}</td>
                            <td className="py-2.5 pr-3 text-slate-300">{row.city}</td>
                            <td className="py-2.5 font-mono text-xs text-amber-200/90">{row.reason}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="py-6 text-slate-500">
                            {t("usage.empty")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          <section className="glass-card p-5">
            <h2 className="section-title">{t("usage.dwellTable")}</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">{t("usage.colScene")}</th>
                    <th className="pb-3 pr-4 font-medium">{t("usage.colVisits")}</th>
                    <th className="pb-3 pr-4 font-medium">{t("usage.colAvg")}</th>
                    <th className="pb-3 pr-4 font-medium">{t("usage.colMedian")}</th>
                    <th className="pb-3 font-medium">{t("usage.colP90")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.scenes.dwell.length ? (
                    stats.scenes.dwell.map((row) => (
                      <tr key={row.label} className="border-t border-slate-800/80">
                        <td className="py-3 pr-4 text-slate-200">{prettyLabel(row.label)}</td>
                        <td className="py-3 pr-4 font-mono text-cyan-400">{row.count}</td>
                        <td className="py-3 pr-4 font-mono text-slate-300">{formatDuration(row.avg_ms)}</td>
                        <td className="py-3 pr-4 font-mono text-slate-300">{formatDuration(row.median_ms)}</td>
                        <td className="py-3 font-mono text-slate-300">{formatDuration(row.p90_ms)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-6 text-slate-500">
                        {t("usage.empty")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

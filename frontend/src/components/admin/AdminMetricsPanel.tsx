import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { SectionUsage, UsageMetrics } from "../../types";
import { useFeature } from "../../hooks/useFeatures";
import { FEATURE } from "../../lib/features";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Kpi({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
      <div className="text-2xl font-bold text-brand-600">{value}</div>
      <div className="text-sm text-muted">{label}</div>
      {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Bars({
  data,
  labelKey,
  valueKey,
  empty,
  color = "bg-brand-500",
  showShare = false,
}: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  empty: string;
  color?: string;
  showShare?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  if (data.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-sm text-slate-600" title={String(d[labelKey])}>
            {String(d[labelKey])}
          </div>
          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
            <div
              className={`h-full ${color} rounded-full`}
              style={{ width: `${(Number(d[valueKey]) / max) * 100}%` }}
            />
          </div>
          <div className="w-12 text-right text-sm font-medium tabular-nums">
            {Number(d[valueKey])}
          </div>
          {showShare && (
            <div className="w-12 text-right text-xs text-slate-400 tabular-nums">
              {Number(d.share ?? 0)}%
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Compact inline SVG sparkline for a series of numbers. */
function Sparkline({
  points,
  className = "text-brand-500",
  width = 120,
  height = 28,
}: {
  points: number[];
  className?: string;
  width?: number;
  height?: number;
}) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? width / (points.length - 1) : 0;
  const coords = points.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `0,${height} ${coords.join(" ")} ${(width).toFixed(1)},${height}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      <polygon points={area} fill="currentColor" opacity={0.12} />
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Ranked most/least-used list with rank chip, share bar, and unused badge. */
function RankedSections({
  rows,
  color,
  emphasizeZero,
  empty,
}: {
  rows: SectionUsage[];
  color: string;
  emphasizeZero?: boolean;
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.views));
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.section} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-xs font-semibold text-slate-400 tabular-nums text-right">
            {i + 1}
          </span>
          <div className="w-36 shrink-0 min-w-0">
            <div className="truncate text-sm text-slate-700" title={r.label}>
              {r.label}
            </div>
            <div className="text-[11px] text-slate-400">
              {r.users} {r.users === 1 ? "user" : "users"}
              {!r.known && " · ad-hoc"}
            </div>
          </div>
          <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
            {r.views > 0 && (
              <div
                className={`h-full ${color} rounded-full`}
                style={{ width: `${Math.max((r.views / max) * 100, 4)}%` }}
              />
            )}
          </div>
          <div className="w-14 text-right">
            <div className="text-sm font-semibold tabular-nums text-slate-800">{r.views}</div>
            <div className="text-[11px] text-slate-400 tabular-nums">{r.share}%</div>
          </div>
          {emphasizeZero && r.views === 0 && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded-full px-1.5 py-0.5">
              Unused
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function AdminMetricsPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<UsageMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const showAdvanced = useFeature(FEATURE.adminMetrics);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getMetrics(days));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const avgDau = useMemo(() => {
    if (!data || data.dau.length === 0) return 0;
    const sum = data.dau.reduce((acc, d) => acc + d.users, 0);
    return Math.round((sum / data.dau.length) * 10) / 10;
  }, [data]);

  const dauMax = useMemo(
    () => Math.max(1, ...(data?.dau.map((d) => d.users) ?? [1])),
    [data]
  );

  const mostUsed = useMemo(
    () => (data?.sectionUsage ?? []).filter((s) => s.views > 0).slice(0, 6),
    [data]
  );

  // Least used: known catalog sections, ascending — zeros surface first.
  const leastUsed = useMemo(() => {
    const known = (data?.sectionUsage ?? []).filter((s) => s.known);
    return [...known].sort((a, b) => a.views - b.views || a.label.localeCompare(b.label)).slice(0, 6);
  }, [data]);

  const busiestDay = useMemo(() => {
    if (!data || data.dau.length === 0) return null;
    return data.dau.reduce((best, d) => (d.users > best.users ? d : best), data.dau[0]);
  }, [data]);

  const hasUsage = (data?.totals.events ?? 0) > 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              onClick={() => setDays(r.days)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                days === r.days
                  ? "bg-brand-600 text-white"
                  : "bg-white border border-border text-slate-600 hover:bg-brand-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-xs text-muted">
            {fmtDate(data.range.since)} – {fmtDate(data.range.until)}
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading || !data ? (
        <p className="text-muted">Loading metrics...</p>
      ) : (
        <>
          {!hasUsage && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No usage events recorded in this range yet. Metrics populate automatically as people
              navigate the app — check back after some activity, or widen the date range.
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Active users" value={data.totals.activeUsers} />
            <Kpi label="Weekly active" value={data.wau} hint="last 7 days" />
            <Kpi label="Avg daily active" value={avgDau} />
            <Kpi label="Total events" value={data.totals.events} />
            <Kpi label="Section views" value={data.totals.sectionViews} />
            <Kpi
              label="Sections used"
              value={`${data.totals.usedSections}/${data.totals.trackedSections}`}
              hint={`${data.totals.trackedSections - data.totals.usedSections} unused`}
            />
          </div>

          <Card
            title="Daily activity"
            subtitle={
              busiestDay && busiestDay.users > 0
                ? `Peak: ${busiestDay.users} active on ${fmtDate(busiestDay.date)}`
                : "Distinct active users per day"
            }
          >
            {!hasUsage ? (
              <p className="text-sm text-muted">
                No usage recorded yet. Data appears as people navigate the app.
              </p>
            ) : (
              <div className="flex items-end gap-0.5 h-32">
                {data.dau.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date}: ${d.users} active`}
                    className="flex-1 bg-brand-400 hover:bg-brand-500 rounded-t"
                    style={{ height: `${(d.users / dauMax) * 100}%`, minHeight: d.users > 0 ? 2 : 0 }}
                  />
                ))}
              </div>
            )}
          </Card>

          {/* Headline: most vs least used, side by side. */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Most used sections" subtitle="Ranked by views · share of all section views">
              <RankedSections
                rows={mostUsed}
                color="bg-brand-500"
                empty="No section views yet."
              />
            </Card>
            <Card
              title="Least used sections"
              subtitle="Catalog sections with the fewest views (includes unused)"
            >
              <RankedSections
                rows={leastUsed}
                color="bg-slate-400"
                emphasizeZero
                empty="No catalog sections to compare."
              />
            </Card>
          </div>

          {/* Full section breakdown table with per-section trend. */}
          <Card
            title="All sections"
            subtitle="Every tracked section with views, distinct users, and share of activity"
          >
            {data.sectionUsage.length === 0 ? (
              <p className="text-sm text-muted">No sections tracked.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
                      <th className="py-2 font-semibold">#</th>
                      <th className="py-2 font-semibold">Section</th>
                      <th className="py-2 font-semibold text-right">Views</th>
                      <th className="py-2 font-semibold text-right">Users</th>
                      <th className="py-2 font-semibold text-right">Share</th>
                      <th className="py-2 font-semibold w-28">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.sectionUsage.map((s, i) => {
                      const series = data.sectionSeries.find((x) => x.section === s.section);
                      return (
                        <tr key={s.section} className={s.views === 0 ? "text-slate-400" : ""}>
                          <td className="py-2 tabular-nums text-slate-400">{i + 1}</td>
                          <td className="py-2">
                            <span className={s.views === 0 ? "" : "text-slate-800"}>{s.label}</span>
                            {!s.known && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                                ad-hoc
                              </span>
                            )}
                            {s.group === "admin" && (
                              <span className="ml-2 text-[10px] uppercase tracking-wide text-slate-400">
                                admin
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums font-medium">{s.views}</td>
                          <td className="py-2 text-right tabular-nums">{s.users}</td>
                          <td className="py-2 text-right tabular-nums">{s.share}%</td>
                          <td className="py-2">
                            {series ? (
                              <Sparkline points={series.points.map((p) => p.views)} />
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Activity by role" subtitle="Events and distinct users per role">
              <Bars
                data={data.roleActivity}
                labelKey="role"
                valueKey="events"
                empty="No role activity yet."
                showShare
              />
            </Card>
            <Card title="Top users" subtitle="Most active people in range">
              {data.topUsers.length === 0 ? (
                <p className="text-sm text-muted">No users yet.</p>
              ) : (
                <ol className="space-y-2">
                  {data.topUsers.map((u, i) => (
                    <li key={u.userId} className="flex items-center gap-3">
                      <span className="w-5 text-xs font-semibold text-slate-400 tabular-nums text-right">
                        {i + 1}
                      </span>
                      <div className="w-40 shrink-0 min-w-0">
                        <div className="truncate text-sm text-slate-700" title={u.name}>
                          {u.name}
                        </div>
                        {u.role && <div className="text-[11px] text-slate-400 truncate">{u.role}</div>}
                      </div>
                      <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                        <div
                          className="h-full bg-brand-500 rounded-full"
                          style={{
                            width: `${
                              (u.events / Math.max(1, data.topUsers[0]?.events ?? 1)) * 100
                            }%`,
                          }}
                        />
                      </div>
                      <div className="w-12 text-right text-sm font-medium tabular-nums">
                        {u.events}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <Card title="Event types" subtitle="Breakdown of all tracked event kinds">
              <Bars
                data={data.eventBreakdown}
                labelKey="event"
                valueKey="count"
                empty="No events tracked yet."
                color="bg-indigo-500"
                showShare
              />
            </Card>
            <Card
              title="Experimental feature adoption"
              subtitle="Users who opted into experimental flags"
            >
              <Bars
                data={data.featureAdoption}
                labelKey="label"
                valueKey="users"
                empty="No opt-ins yet."
                color="bg-emerald-500"
              />
            </Card>
          </div>

          {showAdvanced && (
            <>
              <Card
                title="Section trends"
                subtitle="Daily views for the busiest sections in range"
              >
                {data.sectionSeries.length === 0 ? (
                  <p className="text-sm text-muted">No section trends in range.</p>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {data.sectionSeries.map((s) => {
                      const total = s.points.reduce((acc, p) => acc + p.views, 0);
                      return (
                        <div key={s.section} className="border border-border rounded-xl p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-slate-700 truncate" title={s.label}>
                              {s.label}
                            </span>
                            <span className="text-xs text-muted tabular-nums">{total}</span>
                          </div>
                          <Sparkline points={s.points.map((p) => p.views)} width={220} height={40} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <Card title="Pipeline throughput" subtitle="Average time maps spend in each phase">
                {data.phaseThroughput.length === 0 ? (
                  <p className="text-sm text-muted">No phase history in range.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border">
                        <th className="py-2 font-semibold">Phase</th>
                        <th className="py-2 font-semibold text-right">Entries</th>
                        <th className="py-2 font-semibold text-right">Avg hours</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.phaseThroughput.map((p) => (
                        <tr key={p.phase}>
                          <td className="py-2">{p.phase}</td>
                          <td className="py-2 text-right tabular-nums">{p.count}</td>
                          <td className="py-2 text-right tabular-nums">
                            {p.avgHours === null ? "—" : p.avgHours}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </section>
  );
}

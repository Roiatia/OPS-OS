import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { UsageMetrics } from "../../types";
import { useFeature } from "../../hooks/useFeatures";
import { FEATURE } from "../../lib/features";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
      <div className="text-2xl font-bold text-brand-600">{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}

function Bars({
  data,
  labelKey,
  valueKey,
  empty,
}: {
  data: Record<string, string | number>[];
  labelKey: string;
  valueKey: string;
  empty: string;
}) {
  const max = Math.max(1, ...data.map((d) => Number(d[valueKey]) || 0));
  if (data.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-40 shrink-0 truncate text-sm text-slate-600">{String(d[labelKey])}</div>
          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full"
              style={{ width: `${(Number(d[valueKey]) / max) * 100}%` }}
            />
          </div>
          <div className="w-12 text-right text-sm font-medium tabular-nums">
            {Number(d[valueKey])}
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
      <h3 className="font-semibold text-slate-900 mb-3">{title}</h3>
      {children}
    </div>
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

  return (
    <section className="space-y-5">
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

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {loading || !data ? (
        <p className="text-muted">Loading metrics...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Active users" value={data.totals.activeUsers} />
            <Kpi label="Weekly active (7d)" value={data.wau} />
            <Kpi label="Avg daily active" value={avgDau} />
            <Kpi label="Total events" value={data.totals.events} />
          </div>

          <Card title="Daily active users">
            {data.totals.events === 0 ? (
              <p className="text-sm text-muted">
                No usage recorded yet. Data appears as people navigate the app.
              </p>
            ) : (
              <div className="flex items-end gap-0.5 h-32">
                {data.dau.map((d) => (
                  <div
                    key={d.date}
                    title={`${d.date}: ${d.users}`}
                    className="flex-1 bg-brand-400 hover:bg-brand-500 rounded-t"
                    style={{ height: `${(d.users / dauMax) * 100}%`, minHeight: d.users > 0 ? 2 : 0 }}
                  />
                ))}
              </div>
            )}
          </Card>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="Most used sections">
              <Bars
                data={data.sectionUsage}
                labelKey="section"
                valueKey="views"
                empty="No section views yet."
              />
            </Card>
            <Card title="Activity by role">
              <Bars
                data={data.roleActivity}
                labelKey="role"
                valueKey="events"
                empty="No role activity yet."
              />
            </Card>
            <Card title="Top users">
              <Bars data={data.topUsers} labelKey="name" valueKey="events" empty="No users yet." />
            </Card>
            <Card title="Experimental feature adoption">
              <Bars
                data={data.featureAdoption}
                labelKey="label"
                valueKey="users"
                empty="No opt-ins yet."
              />
            </Card>
          </div>

          {showAdvanced && (
            <Card title="Pipeline throughput (avg time in phase)">
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
          )}
        </>
      )}
    </section>
  );
}

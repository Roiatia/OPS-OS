import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import type { FeatureFlag, AssignableRole, RoleName } from "../../types";

function Toggle({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-10 h-6 rounded-full shrink-0 relative transition-colors disabled:opacity-50 ${
        on ? "bg-brand-600" : "bg-slate-200"
      }`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
          on ? "left-5" : "left-1"
        }`}
      />
    </button>
  );
}

export function AdminFeaturesPanel() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, r] = await Promise.all([api.listFeatureFlags(), api.getAssignableRoles()]);
      setFlags(f);
      setRoles(r);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(
    key: string,
    data: Parameters<typeof api.updateFeatureFlag>[1]
  ) {
    setBusy(key);
    setError("");
    try {
      const updated = await api.updateFeatureFlag(key, data);
      setFlags((prev) => prev.map((f) => (f.key === key ? updated : f)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function toggleRole(flag: FeatureFlag, role: RoleName) {
    const next = flag.rolloutRoles.includes(role)
      ? flag.rolloutRoles.filter((r) => r !== role)
      : [...flag.rolloutRoles, role];
    void patch(flag.key, { rolloutRoles: next });
  }

  if (loading) return <p className="text-muted">Loading features...</p>;

  return (
    <section className="space-y-5">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <p className="text-sm text-muted">
        Turn features on or off, mark them experimental, and restrict which roles can see them.
        Leave roles empty to show a feature to everyone. Disabling a feature hides its section for
        all non-admin users.
      </p>

      <div className="space-y-3">
        {flags.map((flag) => {
          const isBusy = busy === flag.key;
          return (
            <div key={flag.key} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{flag.label}</span>
                    {flag.isExperimental && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800">
                        Experimental
                      </span>
                    )}
                    <code className="text-[11px] text-muted">{flag.key}</code>
                  </div>
                  {flag.description && (
                    <p className="text-sm text-muted mt-1">{flag.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted">{flag.enabled ? "On" : "Off"}</span>
                  <Toggle
                    on={flag.enabled}
                    disabled={isBusy}
                    onClick={() => patch(flag.key, { enabled: !flag.enabled })}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <Toggle
                    on={flag.isExperimental}
                    disabled={isBusy}
                    onClick={() => patch(flag.key, { isExperimental: !flag.isExperimental })}
                  />
                  Experimental
                </label>

                {flag.overrides && flag.overrides.length > 0 && (
                  <span className="text-xs text-muted">
                    {flag.overrides.length} per-user override
                    {flag.overrides.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              <div className="mt-4">
                <div className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
                  Visible to roles {flag.rolloutRoles.length === 0 && "(everyone)"}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((r) => {
                    const on = flag.rolloutRoles.includes(r.role);
                    return (
                      <button
                        key={r.role}
                        type="button"
                        disabled={isBusy}
                        onClick={() => toggleRole(flag, r.role)}
                        className={`px-2.5 py-1 rounded-lg text-xs border transition-colors disabled:opacity-50 ${
                          on
                            ? "bg-brand-600 text-white border-brand-600"
                            : "bg-white text-slate-500 border-border hover:bg-brand-50"
                        }`}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

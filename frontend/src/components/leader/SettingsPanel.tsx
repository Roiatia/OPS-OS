import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { useMyFeaturesQuery } from "../../hooks/queries";
import type { ResolvedFeature } from "../../types";

export function SettingsPanel() {
  const qc = useQueryClient();
  const { data: features, isLoading } = useMyFeaturesQuery();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const experimental = (features ?? []).filter((f) => f.isExperimental);

  async function toggle(feature: ResolvedFeature) {
    setBusy(feature.key);
    setError("");
    try {
      // Opt in/out for the current user via a personal override.
      await api.setMyFeatureOverride(feature.key, !feature.enabled);
      await qc.invalidateQueries({ queryKey: ["features", "mine"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function reset(feature: ResolvedFeature) {
    setBusy(feature.key);
    setError("");
    try {
      await api.setMyFeatureOverride(feature.key, null);
      await qc.invalidateQueries({ queryKey: ["features", "mine"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted mt-0.5">Workspace preferences and experimental features</p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-800">Experimental features</h3>
        <p className="text-sm text-muted mt-0.5">
          Try new capabilities early. These may be incomplete or change without notice.
        </p>

        <div className="mt-3 bg-card border border-border rounded-xl divide-y divide-border">
          {isLoading ? (
            <div className="px-4 py-4 text-sm text-muted">Loading...</div>
          ) : experimental.length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted">
              No experimental features are available right now.
            </div>
          ) : (
            experimental.map((feature) => (
              <div
                key={feature.key}
                className="flex items-center justify-between px-4 py-4 gap-4"
              >
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {feature.label}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800">
                      Beta
                    </span>
                    {feature.overridden && (
                      <button
                        type="button"
                        onClick={() => reset(feature)}
                        className="text-[11px] text-muted hover:text-brand-600 underline"
                      >
                        reset to default
                      </button>
                    )}
                  </div>
                  {feature.description && (
                    <div className="text-sm text-muted mt-0.5">{feature.description}</div>
                  )}
                </div>
                <button
                  type="button"
                  disabled={busy === feature.key}
                  onClick={() => toggle(feature)}
                  className={`w-10 h-6 rounded-full shrink-0 relative transition-colors disabled:opacity-50 ${
                    feature.enabled ? "bg-brand-600" : "bg-slate-200"
                  }`}
                  aria-pressed={feature.enabled}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
                      feature.enabled ? "left-5" : "left-1"
                    }`}
                  />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

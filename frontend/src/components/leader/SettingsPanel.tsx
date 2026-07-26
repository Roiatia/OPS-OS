import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../context/AuthContext";
import { useFeature, useFeatures } from "../../hooks/useFeatures";
import { featureKeys } from "../../hooks/queries";
import { FEATURE } from "../../lib/features";
import { api } from "../../api";
import type { ResolvedFeature } from "../../types";

const SETTINGS_STORAGE_KEY = "ops_workspace_settings";

export interface WorkspaceSettings {
  notifications: boolean;
  autoAssignQa: boolean;
  defaultViewMaps: boolean;
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  notifications: false,
  autoAssignQa: false,
  defaultViewMaps: true,
};

export function loadWorkspaceSettings(): WorkspaceSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<WorkspaceSettings>;
    return {
      notifications: Boolean(parsed.notifications),
      autoAssignQa: Boolean(parsed.autoAssignQa),
      defaultViewMaps:
        typeof parsed.defaultViewMaps === "boolean"
          ? parsed.defaultViewMaps
          : DEFAULT_SETTINGS.defaultViewMaps,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveWorkspaceSettings(next: WorkspaceSettings): void {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
}

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

export function SettingsPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const showNotifications = useFeature(FEATURE.notifications);
  const showAutoAssignQa = useFeature(FEATURE.autoAssignQa);
  const showDefaultView = useFeature(FEATURE.defaultView);
  const { features } = useFeatures(Boolean(user));
  const [settings, setSettings] = useState<WorkspaceSettings>(() => loadWorkspaceSettings());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSettings(loadWorkspaceSettings());
  }, [user?.id]);

  function updateSetting<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveWorkspaceSettings(next);
      return next;
    });
  }

  const experimental = features.filter((f) => f.isExperimental);

  async function toggleExperimental(feature: ResolvedFeature) {
    setBusyKey(feature.key);
    setError("");
    try {
      await api.setMyFeatureOverride(feature.key, feature.enabled ? false : true);
      await qc.invalidateQueries({ queryKey: featureKeys.mine });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  const preferenceRows: {
    key: keyof WorkspaceSettings;
    title: string;
    description: string;
    visible: boolean;
  }[] = [
    {
      key: "notifications",
      title: "Notifications",
      description: "Email alerts when maps are assigned or need QA review",
      visible: showNotifications,
    },
    {
      key: "autoAssignQa",
      title: "Auto-assign QA",
      description: "Automatically assign QA when an inspector marks a map as done",
      visible: showAutoAssignQa,
    },
    {
      key: "defaultViewMaps",
      title: "Default view",
      description: "Open the Maps section when signing in (Ops / Leader dashboards)",
      visible: showDefaultView,
    },
  ];

  const visiblePrefs = preferenceRows.filter((r) => r.visible);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted mt-0.5">Workspace preferences and configuration</p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">
          {error}
        </p>
      )}

      {visiblePrefs.length > 0 && (
        <div className="bg-card border border-border rounded-xl divide-y divide-border">
          {visiblePrefs.map((setting) => (
            <div key={setting.key} className="flex items-center justify-between px-4 py-4 gap-4">
              <div>
                <div className="font-medium text-sm">{setting.title}</div>
                <div className="text-sm text-muted mt-0.5">{setting.description}</div>
              </div>
              <Toggle
                on={settings[setting.key]}
                onClick={() => updateSetting(setting.key, !settings[setting.key])}
              />
            </div>
          ))}
        </div>
      )}

      {experimental.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Experimental features</h3>
            <p className="text-sm text-muted mt-0.5">
              Opt in or out of early previews for your account only.
            </p>
          </div>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {experimental.map((feature) => (
              <div
                key={feature.key}
                className="flex items-center justify-between px-4 py-4 gap-4"
              >
                <div>
                  <div className="font-medium text-sm">{feature.label}</div>
                  {feature.description && (
                    <div className="text-sm text-muted mt-0.5">{feature.description}</div>
                  )}
                </div>
                <Toggle
                  on={feature.enabled}
                  disabled={busyKey === feature.key}
                  onClick={() => void toggleExperimental(feature)}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {visiblePrefs.length === 0 && experimental.length === 0 && (
        <p className="text-sm text-muted">No settings are available for your account right now.</p>
      )}
    </section>
  );
}

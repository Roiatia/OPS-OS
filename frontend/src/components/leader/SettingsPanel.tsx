export function SettingsPanel() {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-sm text-muted mt-0.5">Workspace preferences and configuration</p>
      </div>

      <div className="bg-card border border-border rounded-xl divide-y divide-border">
        {[
          {
            title: "Notifications",
            description: "Email alerts when maps are assigned or need QA review",
            enabled: false,
          },
          {
            title: "Auto-assign QA",
            description: "Automatically assign QA (least loaded) when you assign an inspector",
            enabled: true,
          },
          {
            title: "Default view",
            description: "Open the Maps section when signing in",
            enabled: true,
          },
        ].map((setting) => (
          <div key={setting.title} className="flex items-center justify-between px-4 py-4 gap-4">
            <div>
              <div className="font-medium text-sm">{setting.title}</div>
              <div className="text-sm text-muted mt-0.5">{setting.description}</div>
            </div>
            <div
              className={`w-10 h-6 rounded-full shrink-0 relative ${
                setting.enabled ? "bg-brand-600" : "bg-slate-200"
              }`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${
                  setting.enabled ? "left-5" : "left-1"
                }`}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-sm text-muted">
        Settings are placeholders for now — toggles will be wired up as the platform grows.
      </p>
    </section>
  );
}

/** Placeholder panel for future company dashboard integration. */
export function CompanyDashboardPanel() {
  return (
    <section className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl mb-4">
        ◫
      </div>
      <h2 className="text-lg font-semibold">Company Dashboard</h2>
      <p className="text-sm text-muted mt-2 max-w-md">
        This section will connect to the company dashboard API once it is available. Map upload
        status and live dashboard visibility will appear here.
      </p>
    </section>
  );
}

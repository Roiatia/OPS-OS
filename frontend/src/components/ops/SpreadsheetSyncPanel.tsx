import { useRef, useState } from "react";
import { api } from "../../api";

interface SyncResult {
  imported: number;
  updated: number;
  skipped: number;
  history: number;
  todayHub: number;
  errors: string[];
}

interface Props {
  onSynced: () => void;
}

export function SpreadsheetSyncPanel({ onSynced }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);

  async function runSync(csv?: string) {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api.syncSpreadsheet(csv ? { csv } : {});
      setResult(res);
      onSynced();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onFilePicked(file: File) {
    const csv = await file.text();
    await runSync(csv);
  }

  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-brand-900">Load from spreadsheet</h3>
        <p className="text-xs text-brand-800/90 mt-1 leading-relaxed max-w-2xl">
          Import your Oriient Field Operations sheet. Maps scheduled for{" "}
          <strong>today</strong> appear under <strong>Today</strong> and on the{" "}
          <strong>Hub</strong>. Finished maps (LIVE, Activation, etc.) go straight to{" "}
          <strong>History</strong>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFilePicked(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={loading}
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 shadow-sm"
        >
          {loading ? "Loading…" : "Upload CSV from Google Sheets"}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void runSync()}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-white border border-brand-300 text-brand-800 hover:bg-brand-100 disabled:opacity-50"
        >
          Sync from Google (if configured)
        </button>
      </div>

      <p className="text-[11px] text-muted">
        In Google Sheets: <strong>File → Download → Comma-separated values (.csv)</strong>, then
        upload here.
      </p>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {result && (
        <div className="text-sm bg-white border border-brand-100 rounded-xl px-4 py-3 space-y-1">
          <p className="font-semibold text-brand-900">Sync complete</p>
          <p>
            <span className="text-emerald-700 font-medium">{result.todayHub}</span> on Hub today ·{" "}
            <span className="font-medium">{result.history}</span> sent to History ·{" "}
            {result.imported} new · {result.updated} updated
          </p>
          {result.errors.length > 0 && (
            <ul className="text-xs text-red-600 mt-2 list-disc pl-4">
              {result.errors.slice(0, 5).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { api } from "../../api";

type Preview = Awaited<ReturnType<typeof api.previewCsvImport>>;
type ImportResult = Awaited<ReturnType<typeof api.importCsv>>;

interface Props {
  onImported?: () => void | Promise<void>;
  onCancel?: () => void;
  /** Notified when a long import+refresh cycle starts/ends (for page overlay). */
  onBusyChange?: (busy: boolean) => void;
}

export function CsvImportPanel({ onImported, onCancel, onBusyChange }: Props) {
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [clearExisting, setClearExisting] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState<"preview" | "import" | null>(null);
  const [importPhase, setImportPhase] = useState<"saving" | "loading" | null>(null);
  const [error, setError] = useState("");

  async function onFileChange(file: File | null) {
    setError("");
    setPreview(null);
    setResult(null);
    if (!file) {
      setFileName("");
      setCsv("");
      return;
    }
    setFileName(file.name);
    const text = await file.text();
    setCsv(text);
  }

  async function runPreview() {
    if (!csv.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    setLoading("preview");
    setError("");
    setResult(null);
    try {
      const p = await api.previewCsvImport(csv);
      setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function runImport() {
    if (!csv.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    if (clearExisting) {
      const ok = window.confirm(
        "This will delete ALL existing maps, then import from the CSV into the database. Continue?"
      );
      if (!ok) return;
    }
    setLoading("import");
    setImportPhase("saving");
    onBusyChange?.(true);
    setError("");
    try {
      const r = await api.importCsv(csv, {
        clearExisting,
        defaultClient: "Sam's Club",
      });
      setResult(r);
      setImportPhase("loading");
      await Promise.resolve(onImported?.());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
      setImportPhase(null);
      onBusyChange?.(false);
    }
  }

  const busy = loading === "import";

  return (
    <div className="relative bg-card border border-border rounded-xl p-5 space-y-4">
      {busy && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-white/90">
          <span
            className="w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
          <p className="text-sm font-medium text-slate-800">
            {importPhase === "loading"
              ? "Loading maps into the system…"
              : "Saving maps to the database…"}
          </p>
          <p className="text-xs text-muted">This can take a moment for large files.</p>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Import maps from CSV</h3>
          <p className="text-sm text-muted mt-1">
            Upload the Sam&apos;s Club field-ops export. Maps are saved to the database as{" "}
            <span className="font-mono text-xs">SC-{"{Building}"}</span>, then loaded into New
            maps / History.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-sm text-muted hover:text-slate-800 disabled:opacity-50"
          >
            Close
          </button>
        )}
      </div>

      <label className="block">
        <span className="text-xs font-medium text-muted">CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          className="mt-1.5 block w-full text-sm disabled:opacity-50"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        {fileName && <p className="text-xs text-muted mt-1">{fileName}</p>}
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={clearExisting}
          disabled={busy}
          onChange={(e) => setClearExisting(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Clear all existing maps before import
          <span className="block text-xs text-muted">
            Recommended for the first real-data load.
          </span>
        </span>
      </label>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!csv || loading !== null}
          onClick={runPreview}
          className="px-4 py-2 text-sm font-medium border border-border rounded-xl hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {loading === "preview" && (
            <span className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
          )}
          {loading === "preview" ? "Reading…" : "Preview"}
        </button>
        <button
          type="button"
          disabled={!csv || loading !== null}
          onClick={runImport}
          className="px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {busy && (
            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          )}
          {busy ? "Working…" : "Import & save"}
        </button>
      </div>

      {preview && !busy && (
        <div className="text-sm border border-border rounded-xl p-3 bg-slate-50 space-y-2">
          <p className="font-medium">Preview</p>
          <p className="text-muted">
            {preview.totalRows} rows · {preview.activeRows} active · {preview.cancelledRows}{" "}
            cancelled
          </p>
          <ul className="text-xs space-y-1 font-mono">
            {preview.samples.map((s, i) => (
              <li key={i}>
                {s.mapNumber ?? "—"} · {s.batch ?? "—"} · {(s.address ?? "").slice(0, 48)}
                {s.address && s.address.length > 48 ? "…" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && !busy && (
        <div className="text-sm border border-emerald-200 rounded-xl p-3 bg-emerald-50 space-y-1">
          <p className="font-medium text-emerald-900">Saved to database</p>
          <p>
            Cleared {result.cleared} · Created {result.created} · Updated {result.updated} ·
            Skipped {result.skipped}
          </p>
          {result.sampleMapNumbers.length > 0 && (
            <p className="text-xs font-mono text-emerald-800">
              e.g. {result.sampleMapNumbers.join(", ")}
            </p>
          )}
          {result.errors.length > 0 && (
            <div className="mt-2 text-red-700">
              <p className="font-medium">{result.errors.length} row errors</p>
              <ul className="text-xs max-h-24 overflow-y-auto">
                {result.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

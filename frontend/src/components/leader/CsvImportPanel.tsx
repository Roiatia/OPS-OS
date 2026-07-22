import { useMemo, useState } from "react";
import { api } from "../../api";

type Preview = Awaited<ReturnType<typeof api.previewCsvImport>>;
type ImportResult = Awaited<ReturnType<typeof api.importCsv>>;
type Conflict = ImportResult["conflicts"][number];
type ConflictChoice = "system" | "csv";

type ImportUiPhase = "saving" | "refreshing" | "done";

interface Props {
  onImported?: () => void | Promise<void>;
  onCancel?: () => void;
  /** Notified when a long import+refresh cycle starts/ends (for page overlay). */
  onBusyChange?: (busy: boolean) => void;
}

const FIELD_LABELS: Record<Conflict["field"], string> = {
  batch: "Batch",
  scheduleAt: "Schedule",
  mappingAt: "Mapping",
  sentToStudioAt: "Sent to studio",
  receivedFromStudioAt: "Received from studio",
  activationAt: "Activation",
};

function conflictKey(c: Conflict): string {
  return `${c.mapId}:${c.field}`;
}

/** CSV upload, preview, hybrid import, and date/batch conflict resolution. */
export function CsvImportPanel({ onImported, onCancel, onBusyChange }: Props) {
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [clearExisting, setClearExisting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [loading, setLoading] = useState<"preview" | "import" | "resolve" | null>(null);
  const [importPhase, setImportPhase] = useState<ImportUiPhase | null>(null);
  const [error, setError] = useState("");

  const conflicts = result?.conflicts ?? [];
  const hasConflicts = conflicts.length > 0;

  const unresolvedCount = useMemo(
    () => conflicts.filter((c) => !choices[conflictKey(c)]).length,
    [conflicts, choices]
  );

  async function onFileChange(file: File | null) {
    setError("");
    setPreview(null);
    setResult(null);
    setChoices({});
    setImportPhase(null);
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
    setChoices({});
    setImportPhase(null);
    try {
      const p = await api.previewCsvImport(csv);
      setPreview(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function finishAndClose(messagePhase: boolean) {
    if (messagePhase) setImportPhase("refreshing");
    await Promise.race([
      Promise.resolve(onImported?.()),
      new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
    ]);
    setImportPhase("done");
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (onCancel) onCancel();
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
    setResult(null);
    setChoices({});
    try {
      const r = await api.importCsv(csv, {
        clearExisting,
        defaultClient: "Sam's Club",
      });
      setResult(r);
      // Apply safe updates first; if conflicts remain, show UI (do not auto-close).
      if ((r.conflicts?.length ?? 0) > 0) {
        setImportPhase(null);
        await Promise.resolve(onImported?.());
        return;
      }
      await finishAndClose(true);
    } catch (e) {
      setError((e as Error).message);
      setImportPhase(null);
    } finally {
      setLoading(null);
      onBusyChange?.(false);
    }
  }

  function setChoice(c: Conflict, choice: ConflictChoice) {
    setChoices((prev) => ({ ...prev, [conflictKey(c)]: choice }));
  }

  function setAll(choice: ConflictChoice) {
    const next: Record<string, ConflictChoice> = {};
    for (const c of conflicts) next[conflictKey(c)] = choice;
    setChoices(next);
  }

  async function resolveConflicts() {
    if (unresolvedCount > 0) {
      setError("Choose Keep system or Use CSV for every conflict row.");
      return;
    }
    setLoading("resolve");
    setError("");
    onBusyChange?.(true);
    try {
      const resolutions = conflicts.map((c) => ({
        mapId: c.mapId,
        field: c.field,
        choice: choices[conflictKey(c)]!,
        csvValue: c.csvValue,
        csvIsoDate: c.csvIsoDate,
      }));
      await api.resolveCsvImportConflicts(resolutions);
      setResult((prev) => (prev ? { ...prev, conflicts: [] } : prev));
      setChoices({});
      setImportPhase("saving");
      await finishAndClose(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
      setImportPhase(null);
      onBusyChange?.(false);
    }
  }

  const busy =
    loading === "import" || loading === "resolve" || importPhase === "done";
  const showOverlay =
    loading === "import" ||
    loading === "resolve" ||
    importPhase === "saving" ||
    importPhase === "refreshing" ||
    importPhase === "done";

  return (
    <div className="relative bg-card border border-border rounded-xl p-5 space-y-4 overflow-hidden">
      {showOverlay && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-white/95 backdrop-blur-[1px]"
          role="status"
          aria-live="polite"
        >
          {importPhase === "done" ? (
            <>
              <span
                className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"
                aria-hidden
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-7 w-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <p className="text-sm font-semibold text-emerald-800">Import complete</p>
              <p className="text-xs text-muted">Maps are loaded — closing import…</p>
            </>
          ) : (
            <>
              <span
                className="w-10 h-10 border-[3px] border-brand-600 border-t-transparent rounded-full animate-spin"
                aria-hidden
              />
              <p className="text-sm font-medium text-slate-800">
                {importPhase === "refreshing"
                  ? "Refreshing maps…"
                  : loading === "resolve"
                    ? "Saving your choices…"
                    : "Saving maps to the database…"}
              </p>
              <p className="text-xs text-muted">This can take a moment for large files.</p>
            </>
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm">Import maps from CSV</h3>
          <p className="text-sm text-muted mt-1">
            New maps load fully from the sheet. Existing maps keep your in-app edits: empty cells
            fill from CSV, process fields only move forward, and date/batch conflicts ask you which
            value is true.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy && importPhase !== "done"}
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
          disabled={busy || hasConflicts}
          className="mt-1.5 block w-full text-sm disabled:opacity-50"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        {fileName && <p className="text-xs text-muted mt-1">{fileName}</p>}
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={clearExisting}
          disabled={busy || hasConflicts}
          onChange={(e) => setClearExisting(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Clear all existing maps before import
          <span className="block text-xs text-muted">
            Destructive reset — only for a full reload. Default hybrid import keeps your edits.
          </span>
        </span>
      </label>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {!hasConflicts && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!csv || loading !== null || importPhase !== null}
            onClick={runPreview}
            className="px-4 py-2 text-sm font-medium border border-border rounded-xl hover:bg-slate-50 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading === "preview" ? "Reading…" : "Preview"}
          </button>
          <button
            type="button"
            disabled={!csv || loading !== null || importPhase !== null}
            onClick={runImport}
            className="px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {loading === "import" ? "Working…" : "Import & save"}
          </button>
        </div>
      )}

      {preview && !showOverlay && !hasConflicts && (
        <div className="text-sm border border-border rounded-xl p-3 bg-slate-50 space-y-2">
          <p className="font-medium">Preview</p>
          <p className="text-muted">
            {preview.totalRows} rows · {preview.activeRows} active · {preview.cancelledRows}{" "}
            cancelled
          </p>
          <p className="text-muted text-xs">
            {preview.withMappingDate} with Mapping date (Hub-eligible when not finished) ·{" "}
            {preview.hubEligible} Hub-ready · {preview.scheduleOnlyNoMapping} Schedule only (stay
            off Hub)
          </p>
        </div>
      )}

      {result && !showOverlay && hasConflicts && (
        <div className="border border-amber-300 rounded-xl bg-amber-50/80 p-4 space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-amber-950">
              Dates / batch differ from CSV
            </h4>
            <p className="text-xs text-amber-900/90 mt-1">
              Safe updates were already applied. For each row below, pick which value is true.
              Deadline follows Activation when you choose the CSV activation date.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAll("system")}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-400 bg-white hover:bg-amber-100"
            >
              Keep system for all
            </button>
            <button
              type="button"
              onClick={() => setAll("csv")}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-400 bg-white hover:bg-amber-100"
            >
              Use CSV for all
            </button>
          </div>

          <div className="max-h-[min(50vh,420px)] overflow-auto rounded-lg border border-amber-200 bg-white">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-amber-100 text-left">
                <tr>
                  <th className="px-2 py-2 font-semibold">Map</th>
                  <th className="px-2 py-2 font-semibold">Field</th>
                  <th className="px-2 py-2 font-semibold">System</th>
                  <th className="px-2 py-2 font-semibold">CSV</th>
                  <th className="px-2 py-2 font-semibold">Choice</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => {
                  const key = conflictKey(c);
                  const choice = choices[key];
                  return (
                    <tr key={key} className="border-t border-amber-100 align-top">
                      <td className="px-2 py-2 font-mono whitespace-nowrap">{c.mapNumber}</td>
                      <td className="px-2 py-2">{FIELD_LABELS[c.field]}</td>
                      <td className="px-2 py-2">{c.systemValue ?? "—"}</td>
                      <td className="px-2 py-2">{c.csvValue ?? "—"}</td>
                      <td className="px-2 py-2">
                        <div className="flex flex-col gap-1 min-w-[9rem]">
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="radio"
                              name={key}
                              checked={choice === "system"}
                              onChange={() => setChoice(c, "system")}
                            />
                            Keep system
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="radio"
                              name={key}
                              checked={choice === "csv"}
                              onChange={() => setChoice(c, "csv")}
                            />
                            Use CSV
                          </label>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loading !== null || unresolvedCount > 0}
              onClick={resolveConflicts}
              className="px-4 py-2 text-sm font-semibold rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Apply choices ({conflicts.length - unresolvedCount}/{conflicts.length})
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-3 py-2 text-sm text-muted hover:text-slate-800"
              >
                Resolve later — close
              </button>
            )}
          </div>
        </div>
      )}

      {result && !showOverlay && !hasConflicts && (
        <div className="text-sm border border-emerald-200 rounded-xl p-4 bg-emerald-50 space-y-3">
          <p className="font-semibold text-emerald-900">Import finished</p>
          <p className="text-emerald-900/90">
            Cleared {result.cleared} · Created {result.created} · Updated {result.updated} ·
            Skipped {result.skipped}
            {"hubReady" in result ? ` · Hub-ready ${result.hubReady}` : ""}
          </p>
          {result.errors.length > 0 && (
            <div className="text-red-700">
              <p className="font-medium">{result.errors.length} row errors</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

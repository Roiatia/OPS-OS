import { useState } from "react";
import { api } from "../../api";
import { Modal } from "../common/Modal";

type Preview = Awaited<ReturnType<typeof api.previewHubCsvImport>>;
type ImportResult = Awaited<ReturnType<typeof api.importHubCsv>>;

interface Props {
  onClose: () => void;
  /** Refresh the board after maps land on the Hub. */
  onImported: () => void | Promise<void>;
}

function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Daily mapping-session CSV: name,number,time,mapper,isNew,status,meetLink */
export function HubCsvImportModal({ onClose, onImported }: Props) {
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [sessionDate, setSessionDate] = useState(todayIso());
  const [replaceDay, setReplaceDay] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState<"preview" | "import" | null>(null);
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
    setCsv(await file.text());
  }

  async function runPreview() {
    if (!csv.trim()) {
      setError("Choose a CSV file first.");
      return;
    }
    setError("");
    setLoading("preview");
    try {
      setPreview(await api.previewHubCsvImport(csv, sessionDate));
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
    setError("");
    setLoading("import");
    try {
      const r = await api.importHubCsv(csv, { sessionDate, replaceDay });
      setResult(r);
      await onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  const busy = loading !== null;

  return (
    <Modal title="Load mapping sessions from CSV" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Columns: <code className="text-slate-700">name, number, time, mapper, isNew, status, meetLink</code>.
          Each row becomes a map on the Hub for the chosen day, ready to assign from Intake.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-muted">CSV file</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              className="mt-1.5 block w-full text-sm disabled:opacity-50"
              onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-muted">Session date</span>
            <input
              type="date"
              value={sessionDate}
              disabled={busy}
              onChange={(e) => {
                setSessionDate(e.target.value);
                setPreview(null);
                setResult(null);
              }}
              className="mt-1.5 block w-full border border-border rounded-md px-2 py-1 text-sm text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/40"
            />
          </label>
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={replaceDay}
            disabled={busy}
            onChange={(e) => setReplaceDay(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Replace this day — maps loaded earlier for {sessionDate} that are not in this CSV come
            off the Hub. Their history and assignments are kept.
          </span>
        </label>

        {fileName && <p className="text-xs text-muted">Selected: {fileName}</p>}

        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
            {error}
          </p>
        )}

        {preview && !result && (
          <div className="rounded-lg border border-border bg-slate-50 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-900">
              {preview.totalRows} session(s) for {preview.sessionDate}
            </p>
            <p className="text-xs text-muted">
              {preview.newMaps} new · {preview.existingMaps} existing · {preview.active} active ·{" "}
              {preview.cancelled} cancelled · {preview.newStores} new store(s) ·{" "}
              {preview.withMeetLink} with Meet link
            </p>

            {preview.samples.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-muted">
                    <tr className="text-left">
                      <th className="py-1 pr-3 font-medium">Map</th>
                      <th className="py-1 pr-3 font-medium">Client</th>
                      <th className="py-1 pr-3 font-medium">Time</th>
                      <th className="py-1 pr-3 font-medium">Mapper</th>
                      <th className="py-1 font-medium">Meet</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-800">
                    {preview.samples.map((s) => (
                      <tr key={s.row} className="border-t border-slate-200">
                        <td className="py-1 pr-3 tabular-nums">{s.mapNumber}</td>
                        <td className="py-1 pr-3">{s.client}</td>
                        <td className="py-1 pr-3 tabular-nums">{s.timeLabel}</td>
                        <td className="py-1 pr-3">{s.mapperName ?? "—"}</td>
                        <td className="py-1">{s.meetLink ? "Yes" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {preview.errors.length > 0 && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                <p className="font-medium">{preview.errors.length} row(s) will be skipped:</p>
                <ul className="mt-0.5 space-y-0.5">
                  {preview.errors.slice(0, 5).map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-1">
            <p className="text-xs font-semibold text-emerald-900">
              Loaded {result.sessionDate} onto the Hub
            </p>
            <p className="text-xs text-emerald-800">
              {result.created} created · {result.updated} updated · {result.skipped} skipped
            </p>
            {result.errors.length > 0 && (
              <ul className="text-xs text-amber-800 space-y-0.5">
                {result.errors.slice(0, 5).map((e) => (
                  <li key={`${e.row}-${e.message}`}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 rounded-md border border-border hover:bg-slate-50"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <>
              <button
                type="button"
                onClick={runPreview}
                disabled={busy || !csv.trim()}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-slate-50 disabled:opacity-50"
              >
                {loading === "preview" ? "Checking…" : "Preview"}
              </button>
              <button
                type="button"
                onClick={runImport}
                disabled={busy || !csv.trim()}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {loading === "import" ? "Loading…" : "Load onto Hub"}
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { useState } from "react";
import type { MapRecord } from "../../types";
import { Modal } from "../leader/Modal";
import { readFileAsBase64 } from "../../lib/fileBase64";

interface Props {
  map: MapRecord;
  loading: boolean;
  onClose: () => void;
  onSubmit: (opts: {
    note: string;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) => void;
}

export function QaFixModal({ map, loading, onClose, onSubmit }: Props) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) {
      setError("Describe what needs to be fixed.");
      return;
    }
    setError("");
    let attachment: { fileName: string; mimeType: string; data: string } | undefined;
    if (file) {
      attachment = await readFileAsBase64(file);
    }
    onSubmit({ note: note.trim(), attachment });
  }

  return (
    <Modal title={`Request fix — ${map.mapNumber}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-muted">
          Tell the map inspector what to correct. This is sent with the <strong>Fix</strong> status.
        </p>

        <label className="block">
          <span className="text-sm font-medium">What needs to be fixed?</span>
          <textarea
            required
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Building 3 labels are misaligned, fix the entrance POI…"
            className="mt-1.5 w-full border border-border rounded-xl px-3 py-2.5 text-sm resize-y min-h-[96px]"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Screenshot or reference image (optional)</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1.5 w-full text-sm"
          />
          {file && <p className="text-xs text-muted mt-1">{file.name}</p>}
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="px-5 py-2 text-sm font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Sending…" : "Send fix request"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

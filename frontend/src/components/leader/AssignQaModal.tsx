import { useMemo, useState } from "react";
import type { MapRecord, TeamMember } from "../../types";
import { Modal } from "@/components/common/Modal";
import { countQaActiveMaps, pickLeastLoadedQa } from "../../lib/assignment";
import { canAssignQa } from "../../lib/mapDisplay";

interface Props {
  map: MapRecord;
  team: TeamMember[];
  maps: MapRecord[];
  loading: boolean;
  onClose: () => void;
  onAssign: (opts: {
    qaId: string;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) => void;
}

export function AssignQaModal({ map, team, maps, loading, onClose, onAssign }: Props) {
  const [file, setFile] = useState<File | null>(null);

  const qaMembers = team.filter((m) => m.roles.some((r) => r.role === "GRAPHIC_QA"));
  const qaIds = qaMembers.map((m) => m.id);
  const suggestedQaId = useMemo(
    () => pickLeastLoadedQa(qaIds, maps) ?? map.assignedQa?.id ?? "",
    [qaIds, maps, map.assignedQa?.id]
  );
  const [qaId, setQaId] = useState(suggestedQaId);
  const canAssign = canAssignQa(map);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!qaId) return;

    let attachment: { fileName: string; mimeType: string; data: string } | undefined;
    if (file) {
      attachment = await readFileAsBase64(file);
    }
    onAssign({ qaId, attachment });
  }

  if (!canAssign) {
    return (
      <Modal title={`Assign QA — ${map.mapNumber}`} onClose={onClose}>
        <p className="text-sm text-muted">
          This map cannot be assigned to QA in its current phase.
        </p>
        <div className="flex justify-end mt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Assign QA — ${map.mapNumber}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className="text-sm text-muted">
          Assign a graphic QA reviewer for{" "}
          {map.phase === "UPLOAD_REVIEW" ? "upload review" : "polish QA review"}.
        </p>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Graphic QA</span>
          <select
            required
            value={qaId}
            onChange={(e) => setQaId(e.target.value)}
            className="mt-1.5 w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white"
          >
            <option value="">Select QA member...</option>
            {qaMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {countQaActiveMaps(maps, m.id)} active
                {m.id === suggestedQaId ? " · suggested" : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted mt-1.5">
            Suggested QA member has the fewest active reviews.
          </p>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Attachment (optional)</span>
          <input
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1.5 w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-violet-50 file:text-violet-700"
          />
          {file && <p className="text-xs text-muted mt-1">{file.name}</p>}
        </label>

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
            Close
          </button>
          <button
            type="submit"
            disabled={loading || !qaId}
            className="px-5 py-2 text-sm bg-violet-600 text-white rounded-xl font-medium disabled:opacity-50 hover:bg-violet-700 transition-colors"
          >
            Assign QA
          </button>
        </div>
      </form>
    </Modal>
  );
}

function readFileAsBase64(file: File) {
  return new Promise<{ fileName: string; mimeType: string; data: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const data = result.includes(",") ? result.split(",")[1]! : result;
      resolve({ fileName: file.name, mimeType: file.type || "application/octet-stream", data });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

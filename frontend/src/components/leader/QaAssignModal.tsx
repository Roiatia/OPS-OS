import { useMemo, useState } from "react";
import type { MapRecord, TeamMember } from "../../types";
import { Modal } from "./Modal";
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
  onUnassign: () => void;
}

export function QaAssignModal({ map, team, maps, loading, onClose, onAssign, onUnassign }: Props) {
  const isIntake = map.phase === "INTAKE";
  const hasQa = !!map.assignedQa;
  const [file, setFile] = useState<File | null>(null);

  const qaMembers = team.filter((m) => m.roles.some((r) => r.role === "GRAPHIC_QA"));
  const qaIds = qaMembers.map((m) => m.id);
  const suggestedQaId = useMemo(
    () => pickLeastLoadedQa(qaIds, maps) ?? map.assignedQa?.id ?? "",
    [qaIds, maps, map.assignedQa?.id]
  );
  const [qaId, setQaId] = useState(suggestedQaId);

  if (!canAssignQa(map)) {
    return (
      <Modal title={`QA — ${map.mapNumber}`} onClose={onClose}>
        <p className="text-sm text-muted">QA cannot be changed in this phase.</p>
        <div className="flex justify-end mt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
            Close
          </button>
        </div>
      </Modal>
    );
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!qaId) return;
    let attachment: { fileName: string; mimeType: string; data: string } | undefined;
    if (file) {
      attachment = await readFileAsBase64(file);
    }
    onAssign({ qaId, attachment });
  }

  return (
    <Modal
      title={hasQa ? `QA assigned — ${map.mapNumber}` : `Assign QA — ${map.mapNumber}`}
      onClose={onClose}
      wide
    >
      {hasQa ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Currently assigned</p>
            <p className="text-sm font-medium mt-1">{map.assignedQa!.name}</p>
            {isIntake && map.qaAssignAccepted !== true && (
              <p className="text-xs text-amber-700 mt-1">Waiting for QA to accept</p>
            )}
          </div>

          <form onSubmit={handleAssign} className="space-y-4">
            <p className="text-sm font-medium text-slate-800">Reassign to another QA member</p>
            <select
              required
              value={qaId}
              onChange={(e) => setQaId(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white"
            >
              <option value="">Select QA member...</option>
              {qaMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {countQaActiveMaps(maps, m.id)} active
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
                Close
              </button>
              <button
                type="submit"
                disabled={loading || !qaId || qaId === map.assignedQa?.id}
                className="px-5 py-2 text-sm bg-violet-600 text-white rounded-xl font-medium disabled:opacity-50"
              >
                Reassign
              </button>
            </div>
          </form>

          <div className="border-t border-border pt-4">
            <button
              type="button"
              disabled={loading}
              onClick={onUnassign}
              className="w-full py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50 disabled:opacity-50"
            >
              Unassign QA
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleAssign} className="space-y-5">
          <p className="text-sm text-muted">
            {isIntake
              ? "Assign a graphic QA reviewer. They must accept before pre-upload work begins."
              : map.phase === "UPLOAD_REVIEW"
                ? "Assign QA for upload review."
                : "Assign QA for polish review."}
          </p>

          <label className="block">
            <span className="text-sm font-medium">Graphic QA</span>
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
          </label>

          <label className="block">
            <span className="text-sm font-medium">Attachment (optional)</span>
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1.5 w-full text-sm"
            />
          </label>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
              Close
            </button>
            <button
              type="submit"
              disabled={loading || !qaId}
              className="px-5 py-2 text-sm bg-violet-600 text-white rounded-xl font-medium disabled:opacity-50"
            >
              Assign
            </button>
          </div>
        </form>
      )}
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

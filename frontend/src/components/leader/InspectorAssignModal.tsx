import { useMemo, useState } from "react";
import type { MapRecord, TeamMember } from "../../types";
import { Modal } from "./Modal";
import { countInspectorActiveMaps, pickLeastLoadedInspector } from "../../lib/assignment";
import { canAssignInspector } from "../../lib/mapDisplay";
import { SHIFTS, type ShiftId, getShiftInspectors } from "../../lib/shifts";

type AssignMode = "individual" | "shift";

interface Props {
  map: MapRecord;
  team: TeamMember[];
  maps: MapRecord[];
  loading: boolean;
  onClose: () => void;
  onAssign: (opts: {
    mode: AssignMode;
    inspectorId: string;
    shiftId?: ShiftId;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) => void;
  onUnassign: () => void;
}

export function InspectorAssignModal({
  map,
  team,
  maps,
  loading,
  onClose,
  onAssign,
  onUnassign,
}: Props) {
  const isIntake = map.phase === "INTAKE";
  const hasInspector = !!map.assignedInspector;
  const [mode, setMode] = useState<AssignMode>("individual");
  const [shiftId, setShiftId] = useState<ShiftId>("morning");
  const [file, setFile] = useState<File | null>(null);

  const inspectors = team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR"));
  const inspectorIds = inspectors.map((m) => m.id);
  const suggestedInspectorId = useMemo(
    () => pickLeastLoadedInspector(inspectorIds, maps) ?? map.assignedInspector?.id ?? "",
    [inspectorIds, maps, map.assignedInspector?.id]
  );
  const [memberId, setMemberId] = useState(suggestedInspectorId);
  const shiftInspectors = getShiftInspectors(team, shiftId);

  if (!canAssignInspector(map)) {
    return (
      <Modal title={`Inspector — ${map.mapNumber}`} onClose={onClose}>
        <p className="text-sm text-muted">Inspector cannot be changed in this phase.</p>
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
    let attachment: { fileName: string; mimeType: string; data: string } | undefined;
    if (file) {
      attachment = await readFileAsBase64(file);
    }
    if (mode === "shift" && shiftId) {
      const lead = shiftInspectors[0];
      if (!lead) return;
      onAssign({ mode: "shift", inspectorId: lead.id, shiftId, attachment });
    } else if (memberId) {
      onAssign({ mode: "individual", inspectorId: memberId, attachment });
    }
  }

  return (
    <Modal
      title={hasInspector ? `Inspector assigned — ${map.mapNumber}` : `Assign inspector — ${map.mapNumber}`}
      onClose={onClose}
      wide
    >
      {hasInspector ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Currently assigned</p>
            <p className="text-sm font-medium mt-1">{map.assignedInspector!.name}</p>
            {isIntake && map.inspectorAssignAccepted !== true && (
              <p className="text-xs text-amber-700 mt-1">Waiting for inspector to accept</p>
            )}
          </div>

          <form onSubmit={handleAssign} className="space-y-4">
            <p className="text-sm font-medium text-slate-800">Reassign to another inspector</p>
            <select
              required
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white"
            >
              <option value="">Select inspector...</option>
              {inspectors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {countInspectorActiveMaps(maps, m.id)} active
                </option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
                Close
              </button>
              <button
                type="submit"
                disabled={loading || !memberId || memberId === map.assignedInspector?.id}
                className="px-5 py-2 text-sm bg-brand-600 text-white rounded-xl font-medium disabled:opacity-50"
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
              Unassign inspector
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleAssign} className="space-y-5">
          <p className="text-sm text-muted">
            {isIntake
              ? "Assign a mapping inspector. QA is assigned automatically — use Change on the QA column to override."
              : "Assign this map to a mapping inspector."}
          </p>

          {!isIntake && (
            <div className="flex rounded-xl border border-border p-1 bg-slate-50">
              {(
                [
                  { id: "individual" as const, label: "One inspector" },
                  { id: "shift" as const, label: "Inspector shift" },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                    mode === id ? "bg-white text-brand-700 shadow-sm" : "text-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {mode === "shift" && !isIntake ? (
            <label className="block">
              <span className="text-sm font-medium">Shift</span>
              <select
                value={shiftId}
                onChange={(e) => setShiftId(e.target.value as ShiftId)}
                className="mt-1.5 w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white"
              >
                {SHIFTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({s.hours})
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block">
              <span className="text-sm font-medium">Mapping Inspector</span>
              <select
                required
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                className="mt-1.5 w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white"
              >
                <option value="">Select inspector...</option>
                {inspectors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {countInspectorActiveMaps(maps, m.id)} active
                    {m.id === suggestedInspectorId ? " · suggested" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

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
              disabled={
                loading ||
                (mode === "individual" && !memberId) ||
                (mode === "shift" && shiftInspectors.length === 0)
              }
              className="px-5 py-2 text-sm bg-brand-600 text-white rounded-xl font-medium disabled:opacity-50"
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

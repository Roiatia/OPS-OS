import { useMemo, useState } from "react";
import type { MapRecord, TeamMember } from "../../types";
import { Modal } from "./Modal";
import {
  countInspectorActiveMaps,
  countQaActiveMaps,
  pickLeastLoadedInspector,
  pickLeastLoadedQa,
} from "../../lib/assignment";
import { canAssignInspector, canAssignQa } from "../../lib/mapDisplay";
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
    inspectorId?: string;
    qaId?: string;
    shiftId?: ShiftId;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) => void;
}

/** Modal for assigning both inspector and QA in one step. */
export function AssignTeamModal({ map, team, maps, loading, onClose, onAssign }: Props) {
  const isIntake = map.phase === "INTAKE";
  const showInspector = canAssignInspector(map);
  const showQa = canAssignQa(map);

  const [mode, setMode] = useState<AssignMode>("individual");
  const [shiftId, setShiftId] = useState<ShiftId>("morning");
  const [file, setFile] = useState<File | null>(null);

  const inspectors = team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR"));
  const qaMembers = team.filter((m) => m.roles.some((r) => r.role === "GRAPHIC_QA"));

  const inspectorIds = inspectors.map((m) => m.id);
  const qaIds = qaMembers.map((m) => m.id);

  const suggestedInspectorId = useMemo(
    () => pickLeastLoadedInspector(inspectorIds, maps) ?? map.assignedInspector?.id ?? "",
    [inspectorIds, maps, map.assignedInspector?.id]
  );
  const suggestedQaId = useMemo(
    () => pickLeastLoadedQa(qaIds, maps) ?? map.assignedQa?.id ?? "",
    [qaIds, maps, map.assignedQa?.id]
  );

  const [inspectorId, setInspectorId] = useState(suggestedInspectorId);
  const [qaId, setQaId] = useState(suggestedQaId);
  const shiftInspectors = getShiftInspectors(team, shiftId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let attachment: { fileName: string; mimeType: string; data: string } | undefined;
    if (file) {
      attachment = await readFileAsBase64(file);
    }

    if (mode === "shift" && showInspector) {
      onAssign({ mode: "shift", shiftId, qaId: showQa ? qaId : undefined, attachment });
    } else {
      onAssign({
        mode: "individual",
        inspectorId: showInspector ? inspectorId : undefined,
        qaId: showQa ? qaId : undefined,
        attachment,
      });
    }
  }

  if (!showInspector && !showQa) {
    return (
      <Modal title={`Assign ${map.mapNumber}`} onClose={onClose}>
        <p className="text-sm text-muted">This map cannot be assigned in its current phase.</p>
        <div className="flex justify-end mt-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
            Close
          </button>
        </div>
      </Modal>
    );
  }

  const inspectorRequired = showInspector && (isIntake || mode === "individual");
  const qaRequired = showQa && isIntake;
  const canSubmit =
    (!inspectorRequired || (mode === "shift" ? shiftInspectors.length > 0 : inspectorId)) &&
    (!qaRequired || qaId);

  return (
    <Modal title={`Assign ${map.mapNumber}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className="text-sm text-muted">
          {isIntake
            ? "Assign a mapping inspector and graphic QA. Both must accept before the map moves to pre-upload work."
            : "Assign team members for this map."}
        </p>

        {showInspector && (
          <div className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
              Mapping Inspector
            </p>

            {!isIntake && (
              <div className="flex rounded-xl border border-border p-1 bg-white">
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
                      mode === id
                        ? "bg-brand-600 text-white shadow-sm"
                        : "text-muted hover:text-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {mode === "shift" && !isIntake ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Shift</span>
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
                <ul className="space-y-1.5 text-sm text-slate-700">
                  {shiftInspectors.map((m) => (
                    <li key={m.id} className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />
                      {m.name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Inspector</span>
                <select
                  required={inspectorRequired}
                  value={inspectorId}
                  onChange={(e) => setInspectorId(e.target.value)}
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
          </div>
        )}

        {showQa && (
          <div className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
              Graphic QA
            </p>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">QA reviewer</span>
              <select
                required={qaRequired}
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
              {isIntake && (
                <p className="text-xs text-muted mt-1.5">
                  QA will also need to accept before pre-upload work begins.
                </p>
              )}
            </label>
          </div>
        )}

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Attachment (optional)</span>
          <input
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1.5 w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-700"
          />
          {file && <p className="text-xs text-muted mt-1">{file.name}</p>}
        </label>

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted">
            Close
          </button>
          <button
            type="submit"
            disabled={loading || !canSubmit}
            className="px-5 py-2 text-sm bg-brand-600 text-white rounded-xl font-medium disabled:opacity-50 hover:bg-brand-700 transition-colors"
          >
            Assign
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Reads an attachment file as base64 for team assignment upload. */
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

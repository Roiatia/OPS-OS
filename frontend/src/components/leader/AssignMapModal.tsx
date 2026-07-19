import { useMemo, useState } from "react";
import type { MapRecord, MapStation, MapTask, TeamMember } from "../../types";
import { Modal } from "@/components/common/Modal";
import { pickLeastLoadedInspector, countInspectorActiveMaps } from "../../lib/assignment";
import { canAssignInspector, MAP_STATION_OPTIONS, MAP_TASK_OPTIONS } from "../../lib/mapDisplay";
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
    memberId?: string;
    shiftId?: ShiftId;
    task?: MapTask;
    station?: MapStation;
    attachment?: { fileName: string; mimeType: string; data: string };
  }) => void;
}

export function AssignMapModal({ map, team, maps, loading, onClose, onAssign }: Props) {
  const [mode, setMode] = useState<AssignMode>("individual");
  const [shiftId, setShiftId] = useState<ShiftId>("morning");
  const [file, setFile] = useState<File | null>(null);
  const [task, setTask] = useState<MapTask>(map.task ?? "UPLOAD");
  const [station, setStation] = useState<MapStation>(map.station ?? "GRAPHICS");

  const inspectors = team.filter((m) => m.roles.some((r) => r.role === "MAPPING_INSPECTOR"));
  const inspectorIds = inspectors.map((m) => m.id);
  const suggestedInspectorId = useMemo(
    () => pickLeastLoadedInspector(inspectorIds, maps) ?? map.assignedInspector?.id ?? "",
    [inspectorIds, maps, map.assignedInspector?.id]
  );
  const [memberId, setMemberId] = useState(suggestedInspectorId);
  const shiftInspectors = getShiftInspectors(team, shiftId);
  const canAssign = canAssignInspector(map);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let attachment: { fileName: string; mimeType: string; data: string } | undefined;
    if (file) {
      attachment = await readFileAsBase64(file);
    }
    if (mode === "shift") {
      onAssign({
        mode: "shift",
        shiftId,
        attachment,
        task,
        station,
      });
    } else if (memberId) {
      onAssign({
        mode: "individual",
        memberId,
        attachment,
        task,
        station,
      });
    }
  }

  if (!canAssign) {
    return (
      <Modal title={`Assign ${map.mapNumber}`} onClose={onClose}>
        <p className="text-sm text-muted">
          This map cannot be assigned to an inspector in its current phase.
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
    <Modal title={`Assign ${map.mapNumber}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className="text-sm text-muted">
          Assign this map to a mapping inspector. Set Task and Station independently of workflow
          phase.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Task</span>
            <select
              value={task}
              onChange={(e) => setTask(e.target.value as MapTask)}
              className="mt-1.5 w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white"
            >
              {MAP_TASK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Station</span>
            <select
              value={station}
              onChange={(e) => setStation(e.target.value as MapStation)}
              className="mt-1.5 w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-white"
            >
              {MAP_STATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

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
                mode === id ? "bg-white text-brand-700 shadow-sm" : "text-muted hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "shift" ? (
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
            <div className="rounded-xl bg-brand-50 border border-brand-100 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 mb-2">
                Mapping inspectors on this shift
              </p>
              {shiftInspectors.length === 0 ? (
                <p className="text-sm text-muted">No inspectors scheduled for this shift.</p>
              ) : (
                <ul className="space-y-1.5">
                  {shiftInspectors.map((m) => (
                    <li key={m.id} className="text-sm text-slate-700 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0" />
                      {m.name}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted mt-3">
                The lead inspector on shift is assigned the map. All inspectors on the shift receive
                a task and will see it on their dashboard.
              </p>
            </div>
          </div>
        ) : (
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Mapping Inspector</span>
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
            <p className="text-xs text-muted mt-1.5">
              Suggested inspector has the fewest active maps.
            </p>
          </label>
        )}

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Attachment (optional)</span>
          <input
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1.5 w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700"
          />
          {file && <p className="text-xs text-muted mt-1">{file.name}</p>}
        </label>

        <div className="flex gap-2 justify-end pt-1">
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
            className="px-5 py-2 text-sm bg-brand-600 text-white rounded-xl font-medium disabled:opacity-50 hover:bg-brand-700 transition-colors"
          >
            Assign
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

import { useState } from "react";
import { Link } from "react-router-dom";
import type { MapRecord, TeamMember } from "../../types";
import { ROLE_LABELS } from "../../types";
import {
  getActiveWorkForMember,
  getMapDisplayState,
  getMapStation,
  getTaskType,
  workflowStateTone,
} from "../../lib/mapDisplay";
import { Badge } from "../Badge";

interface Props {
  team: TeamMember[];
  maps: MapRecord[];
}

export function TeamWorkPanel({ team, maps }: Props) {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

  const assignableTeam = team.filter((m) =>
    m.roles.some((r) => r.role === "MAPPING_INSPECTOR" || r.role === "GRAPHIC_QA")
  );

  const selectedMember = assignableTeam.find((m) => m.id === selectedMemberId) ?? null;
  const selectedWork = selectedMember ? getActiveWorkForMember(maps, selectedMember.id) : [];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Team</h2>
        <p className="text-sm text-muted mt-0.5">
          Select a team member to view their assigned maps
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(240px,320px)_1fr]">
        {/* Member list */}
        <ul className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
          {assignableTeam.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted text-center">No team members found.</li>
          ) : (
            assignableTeam.map((member) => {
              const workCount = getActiveWorkForMember(maps, member.id).length;
              const primaryRole = member.roles.find(
                (r) => r.role === "MAPPING_INSPECTOR" || r.role === "GRAPHIC_QA"
              );
              const isSelected = selectedMemberId === member.id;

              return (
                <li key={member.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedMemberId(isSelected ? null : member.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      isSelected ? "bg-brand-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="w-9 h-9 shrink-0 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold">
                      {member.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{member.name}</div>
                      <div className="text-xs text-muted truncate">
                        {primaryRole ? ROLE_LABELS[primaryRole.role] : ""}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium tabular-nums px-2 py-0.5 rounded-full ${
                        isSelected ? "bg-brand-600 text-white" : "bg-slate-100 text-muted"
                      }`}
                    >
                      {workCount}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {/* Selected member's maps */}
        <div className="bg-card border border-border rounded-xl min-h-[200px]">
          {!selectedMember ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[200px] px-6 text-center">
              <p className="text-sm text-muted">
                Click a team member on the left to see their assigned maps
              </p>
            </div>
          ) : selectedWork.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="font-medium">{selectedMember.name}</p>
              <p className="text-sm text-muted mt-1">No active maps assigned</p>
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-border bg-slate-50">
                <p className="font-medium text-sm">{selectedMember.name}</p>
                <p className="text-xs text-muted">
                  {selectedWork.length} active map{selectedWork.length !== 1 ? "s" : ""}
                </p>
              </div>
              <ul className="divide-y divide-border">
                {selectedWork.map((map) => {
                  const taskType = getTaskType(map);
                  const state = getMapDisplayState(map);
                  const asInspector = map.assignedInspector?.id === selectedMember.id;
                  const asQa = map.assignedQa?.id === selectedMember.id;

                  return (
                    <li key={map.id} className="px-4 py-3 hover:bg-slate-50/60">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            to={`/app/maps/${map.id}`}
                            className="font-mono font-medium text-brand-600 hover:underline"
                          >
                            {map.mapNumber}
                          </Link>
                          <div className="text-sm text-muted mt-0.5">{map.client}</div>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {taskType && (
                              <Badge
                                label={taskType}
                                tone={taskType === "Upload" ? "PREP" : "POLISH"}
                              />
                            )}
                            <Badge label={getMapStation(map)} tone={map.phase} />
                            {state !== "—" && (
                              <Badge label={state} tone={workflowStateTone(state)} />
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted shrink-0 text-right">
                          {asInspector && asQa
                            ? "Inspector + QA"
                            : asInspector
                              ? "Inspector"
                              : "QA"}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

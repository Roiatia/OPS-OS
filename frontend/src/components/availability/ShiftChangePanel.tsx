import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../../api";
import { useAuth } from "../../context/AuthContext";
import { hasOpsManagerRole, hasSupervisorRole } from "../../lib/roles";
import { DAY_LABELS, isoWeekStart } from "../../lib/availabilityRules";
import type { ShiftChangeCandidate, ShiftChangeList, ShiftChangeRequest } from "../../types/availability";

interface Props {
  weekStart: Date;
  /** When schedule reloads after OPS approves a change */
  onScheduleChanged?: () => void;
}

function statusLabel(status: ShiftChangeRequest["status"]): string {
  switch (status) {
    case "PENDING_COUNTERPART":
      return "Waiting for teammate";
    case "PENDING_OPS":
      return "Waiting for OPS";
    case "ACCEPTED":
      return "Accepted";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}

export function ShiftChangePanel({ weekStart, onScheduleChanged }: Props) {
  const { user } = useAuth();
  const isOps = hasOpsManagerRole(user);
  const isSup = hasSupervisorRole(user);
  const weekIso = isoWeekStart(weekStart);

  const [list, setList] = useState<ShiftChangeList | null>(null);
  const [askDay, setAskDay] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<ShiftChangeCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [myAssignedDays, setMyAssignedDays] = useState<number[]>([]);

  const load = useCallback(async () => {
    try {
      const [changes, schedule] = await Promise.all([
        api.getShiftChanges(weekIso),
        api.getPublishedSchedule(weekIso),
      ]);
      setList(changes);
      if (schedule.published && user) {
        setMyAssignedDays(
          [...new Set(schedule.assignments.filter((a) => a.userId === user.id).map((a) => a.dayOfWeek))]
        );
      } else {
        setMyAssignedDays([]);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [weekIso, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openAsk(dayOfWeek: number) {
    setAskDay(dayOfWeek);
    setError("");
    setLoadingCandidates(true);
    try {
      const { candidates: list } = await api.getShiftChangeCandidates(weekIso, dayOfWeek);
      setCandidates(list);
    } catch (e) {
      setError((e as Error).message);
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  }

  async function askPerson(toUserId: string) {
    if (askDay === null) return;
    setBusyId(toUserId);
    setError("");
    try {
      await api.createShiftChange({ weekStart: weekIso, dayOfWeek: askDay, toUserId });
      setAskDay(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function runAction(
    id: string,
    action: "accept" | "reject" | "cancel" | "ops-accept" | "ops-reject"
  ) {
    setBusyId(id);
    setError("");
    try {
      if (action === "accept") await api.acceptShiftChange(id);
      else if (action === "reject") await api.rejectShiftChange(id);
      else if (action === "cancel") await api.cancelShiftChange(id);
      else if (action === "ops-accept") await api.opsAcceptShiftChange(id);
      else await api.opsRejectShiftChange(id);
      await load();
      if (action === "ops-accept") onScheduleChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!isSup && !isOps) return null;

  const hasAnything =
    (list?.incoming.length ?? 0) > 0 ||
    (list?.outgoing.length ?? 0) > 0 ||
    (list?.pendingOps.length ?? 0) > 0 ||
    myAssignedDays.length > 0;

  if (!hasAnything && !askDay) return null;

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {isSup && myAssignedDays.length > 0 && (
        <div className="rounded-xl border border-border bg-white p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-900">Ask to change a shift</p>
          <div className="flex flex-wrap gap-2">
            {myAssignedDays.map((day) => (
              <button
                key={day}
                type="button"
                onClick={() => void openAsk(day)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border hover:bg-slate-50"
              >
                Give up {DAY_LABELS[day]}
              </button>
            ))}
          </div>
        </div>
      )}

      {isOps && (list?.pendingOps.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-amber-950">
            Shift changes awaiting OPS ({list!.pendingOps.length})
          </p>
          {list!.pendingOps.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              busy={busyId === r.id}
              actions={
                <>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void runAction(r.id, "ops-accept")}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md bg-emerald-600 text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void runAction(r.id, "ops-reject")}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}

      {isSup && (list?.incoming.length ?? 0) > 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-emerald-950">
            Incoming change requests ({list!.incoming.length})
          </p>
          {list!.incoming.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              busy={busyId === r.id}
              actions={
                <>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void runAction(r.id, "accept")}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md bg-emerald-600 text-white disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void runAction(r.id, "reject")}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </>
              }
            />
          ))}
        </div>
      )}

      {isSup && (list?.outgoing.length ?? 0) > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-slate-900">Your change requests</p>
          {list!.outgoing.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              busy={busyId === r.id}
              actions={
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void runAction(r.id, "cancel")}
                  className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              }
            />
          ))}
        </div>
      )}

      {askDay !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-border p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Give up {DAY_LABELS[askDay]}
              </h3>
              <p className="text-xs text-muted mt-1">
                People who offered availability that day (not already scheduled). They must accept,
                then OPS.
              </p>
            </div>
            {loadingCandidates ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted">No one available to take this shift.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {candidates.map((c) => (
                  <li
                    key={c.userId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {c.name}
                        {c.isShiftLeader ? " · SL" : ""}
                      </p>
                      {c.hoursLabel && (
                        <p className="text-[11px] text-muted">{c.hoursLabel}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={busyId === c.userId}
                      onClick={() => void askPerson(c.userId)}
                      className="text-xs font-semibold px-2.5 py-1 rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      Ask
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setAskDay(null)}
                className="px-4 py-2 text-sm text-muted"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  actions,
  busy,
}: {
  request: ShiftChangeRequest;
  actions: ReactNode;
  busy?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-md bg-white/90 border border-black/5 px-2.5 py-2 ${
        busy ? "opacity-60" : ""
      }`}
    >
      <div className="text-xs text-slate-800 min-w-0">
        <p className="font-medium">
          {DAY_LABELS[request.dayOfWeek]} · {request.fromUser.name} → {request.toUser.name}
        </p>
        <p className="text-muted">{statusLabel(request.status)}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">{actions}</div>
    </div>
  );
}

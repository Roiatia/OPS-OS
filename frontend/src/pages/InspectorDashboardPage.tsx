import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { ActiveMapsTable } from "../components/workflow/ActiveMapsTable";
import { InspectorInboxTable } from "../components/workflow/InspectorInboxTable";
import {
  isInspectorActive,
  isInspectorInbox,
  isQaActive,
} from "../lib/activeMapsWorkflow";
import { useMapsQuery } from "@/hooks/queries";
import { queryKeys } from "../lib/mapsCache";
import { applyMapUpsertReplaceOnly } from "../lib/mapsLive";
import type { MapRecord } from "../types";

export function InspectorDashboardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useMapsQuery();
  const maps = useMemo(() => data ?? [], [data]);
  const loading = isLoading;

  // Silent 60s backstop — realtime carries most changes.
  useEffect(() => {
    const interval = setInterval(
      () => void qc.invalidateQueries({ queryKey: queryKeys.maps }),
      60_000
    );
    return () => clearInterval(interval);
  }, [qc]);

  const load = useCallback(
    () => void qc.invalidateQueries({ queryKey: queryKeys.maps }),
    [qc]
  );

  const patchMap = useCallback(
    (updated: MapRecord) => {
      qc.setQueryData<MapRecord[]>(queryKeys.maps, (prev) =>
        prev ? applyMapUpsertReplaceOnly(prev, [updated]) : prev
      );
    },
    [qc]
  );

  const inbox = useMemo(
    () => maps.filter((m) => isInspectorInbox(m, user!.id)),
    [maps, user]
  );
  const active = useMemo(
    () => maps.filter((m) => isInspectorActive(m, user!.id)),
    [maps, user]
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Mapping Inspector</h1>
        <p className="text-muted mt-1">
          Accept new maps, then work with QA in the active table below.
        </p>
      </div>

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <>
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Maps assigned to me</h2>
              <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
                {inbox.length} new
              </span>
            </div>
            <p className="text-sm text-muted mb-4">
              New maps from the team leader. Click <strong>Accept</strong> to move them into your active
              workspace.
            </p>
            <InspectorInboxTable
              maps={inbox}
              onRefresh={load}
              onPatch={patchMap}
            />
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Active maps</h2>
              <span className="text-xs font-medium text-brand-700 bg-brand-100 px-2.5 py-1 rounded-full">
                {active.length} active
              </span>
            </div>
            <p className="text-sm text-muted mb-4">
              Shared workspace with QA — update status and leave notes like the team spreadsheet.
            </p>
            <ActiveMapsTable
              maps={active}
              role="inspector"
              onRefresh={load}
              onPatch={patchMap}
            />
          </section>
        </>
      )}
    </div>
  );
}

export function QaDashboardPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useMapsQuery();
  const maps = useMemo(() => data ?? [], [data]);
  const loading = isLoading;

  // Silent 60s backstop — realtime carries most changes.
  useEffect(() => {
    const interval = setInterval(
      () => void qc.invalidateQueries({ queryKey: queryKeys.maps }),
      60_000
    );
    return () => clearInterval(interval);
  }, [qc]);

  const load = useCallback(
    () => void qc.invalidateQueries({ queryKey: queryKeys.maps }),
    [qc]
  );

  const patchMap = useCallback(
    (updated: MapRecord) => {
      qc.setQueryData<MapRecord[]>(queryKeys.maps, (prev) =>
        prev ? applyMapUpsertReplaceOnly(prev, [updated]) : prev
      );
    },
    [qc]
  );

  const active = useMemo(() => maps.filter(isQaActive), [maps]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Graphic QA</h1>
        <p className="text-muted mt-1">
          Review maps with inspectors — same shared active table, your status options only.
        </p>
      </div>

      {loading ? (
        <p className="text-muted">Loading...</p>
      ) : (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Active maps</h2>
            <span className="text-xs font-medium text-violet-700 bg-violet-100 px-2.5 py-1 rounded-full">
              {active.length} in queue
            </span>
          </div>
          <ActiveMapsTable
            maps={active}
            role="qa"
            onRefresh={load}
            onPatch={patchMap}
          />
        </section>
      )}
    </div>
  );
}

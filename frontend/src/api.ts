const API = "/api";

function getToken() {
  return localStorage.getItem("ops_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Cannot reach the API — is the backend running on port 3001?");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    const message =
      body.error ||
      (res.status === 502 || res.status === 503 || res.status === 504
        ? "API temporarily unavailable — retry in a moment"
        : res.status === 500 && !body.error
          ? "Server error (backend may have been restarting) — refresh and try again"
          : `Request failed (${res.status})`);
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return res.json();
}

function buildQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const api = {
  getConfig: () => request<{ demoMode: boolean; googleClientId: string | null }>("/auth/config"),

  demoLogin: (email: string, password?: string) => {
    const trimmed = typeof password === "string" ? password.trim() : undefined;
    return request<{ token: string; user: import("./types").User }>("/auth/demo", {
      method: "POST",
      body: JSON.stringify(
        trimmed ? { email, password: trimmed } : { email }
      ),
    });
  },

  googleLogin: (credential: string) =>
    request<{ token: string; user: import("./types").User }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    }),

  getDemoUsers: () =>
    request<{ email: string; name: string; roles: { role: string; label: string }[] }[]>(
      "/auth/demo-users"
    ),

  getMe: () => request<{ user: import("./types").User }>("/auth/me"),

  getMaps: () => request<import("./types").MapRecord[]>("/maps"),

  /**
   * First-paint dashboard payload: active maps + team + supervisor field maps in
   * one round-trip. History is intentionally excluded (loaded lazily via
   * getHistoryMaps() when the History tab opens) to keep the initial load small.
   */
  getDashboard: () =>
    request<{
      maps: import("./types").MapRecord[];
      team: import("./types").TeamMember[];
      teamFieldMaps: import("./types").MapRecord[];
    }>("/maps/dashboard"),

  getHistoryMaps: () => request<import("./types").MapRecord[]>("/maps/history"),

  syncSpreadsheet: (body: { csv?: string; sheetTab?: string } = {}) =>
    request<{
      imported: number;
      updated: number;
      skipped: number;
      history: number;
      todayHub: number;
      errors: string[];
    }>("/maps/sync-spreadsheet", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getMap: (id: string) => request<import("./types").MapRecord>(`/maps/${id}`),

  getTeam: () => request<import("./types").TeamMember[]>("/maps/team"),

  getTeamFieldMaps: () => request<import("./types").MapRecord[]>("/maps/team-field"),

  getHub: () =>
    request<{
      maps: import("./types").MapRecord[];
      supervisors: import("./types").HubSupervisor[];
    }>("/maps/hub"),

  getHubNotifications: (since?: string, q?: string) =>
    request<{
      feed: import("./types/activity").OpsActivityMessage[];
      alerts: import("./types/activity").OpsShiftAlert[];
    }>(`/maps/hub/notifications${buildQuery({ since, q })}`),

  updateHubMap: (
    mapId: string,
    data: {
      fieldWorkStatus?: import("./types").FieldWorkStatus;
      fieldProgressPercent?: number;
      assignedSupervisorId?: string | null;
      onHubStatusBoard?: boolean;
      opsManagerComment?: string | null;
      shiftLeaderApproved?: boolean | null;
      returnVisitAt?: string | null;
    }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/hub`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  requestSlCheck: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/sl-check/request`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  reportMapperNotArrived: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/mapper-not-arrived`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  claimSlCheck: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/sl-check/claim`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  resolveSlCheck: (
    mapId: string,
    body: { decision: "accept" | "need_corrections"; note?: string | null }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/sl-check/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  cancelSlCheck: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/sl-check/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  swapSupervisorMaps: (mapIds: string[], _toSupervisorId?: string) =>
    request<{ swapped: number; batchId?: string }>("/maps/swap-offer", {
      method: "POST",
      body: JSON.stringify({ mapIds }),
    }),

  createSwapOffer: (mapIds: string[]) =>
    request<{ batchId: string; offered: number }>("/maps/swap-offer", {
      method: "POST",
      body: JSON.stringify({ mapIds }),
    }),

  getSwapOffers: () =>
    request<{
      open: Array<{
        batchId: string;
        offeredAt: string;
        from: { id: string; name: string };
        maps: Array<{
          id: string;
          mapNumber: string;
          client: string;
          assignedSupervisor: { id: string; name: string; email: string } | null;
        }>;
      }>;
      mine: Array<{
        batchId: string;
        offeredAt: string;
        maps: Array<{ id: string; mapNumber: string; client: string }>;
      }>;
    }>("/maps/swap-offers"),

  takeSwapMaps: (mapIds: string[]) =>
    request<{ taken: number }>("/maps/swap-offers/take", {
      method: "POST",
      body: JSON.stringify({ mapIds }),
    }),

  createHelpAsk: (mapIds: string[]) =>
    request<{ asked: number; batches: Array<{ batchId: string; asked: number; ownerId: string }> }>(
      "/maps/help-ask",
      {
        method: "POST",
        body: JSON.stringify({ mapIds }),
      }
    ),

  getHelpAsks: () =>
    request<{
      incoming: Array<{
        batchId: string;
        askedAt: string;
        from: { id: string; name: string };
        maps: Array<{ id: string; mapNumber: string; client: string }>;
      }>;
      mine: Array<{
        batchId: string;
        askedAt: string;
        to: { id: string; name: string } | null;
        maps: Array<{ id: string; mapNumber: string; client: string }>;
      }>;
    }>("/maps/help-asks"),

  acceptHelpAsk: (batchId: string) =>
    request<{ accepted: number }>("/maps/help-asks/accept", {
      method: "POST",
      body: JSON.stringify({ batchId }),
    }),

  rejectHelpAsk: (batchId: string) =>
    request<{ rejected: number }>("/maps/help-asks/reject", {
      method: "POST",
      body: JSON.stringify({ batchId }),
    }),

  cancelHelpAsk: (batchId: string) =>
    request<{ cancelled: number }>("/maps/help-asks/cancel", {
      method: "POST",
      body: JSON.stringify({ batchId }),
    }),

  declineSwapOffer: (batchId: string) =>
    request<{ declined: boolean }>("/maps/swap-offers/decline", {
      method: "POST",
      body: JSON.stringify({ batchId }),
    }),

  cancelSwapOffer: (batchId: string) =>
    request<{ cancelled: number }>("/maps/swap-offers/cancel", {
      method: "POST",
      body: JSON.stringify({ batchId }),
    }),

  shuffleAssignSupervisors: (mapIds: string[], supervisorIds: string[]) =>
    request<{
      assigned: number;
      distribution: {
        supervisorId: string;
        supervisorName: string;
        assigned: number;
        totalAfter: number;
      }[];
    }>("/maps/shuffle-supervisors", {
      method: "POST",
      body: JSON.stringify({ mapIds, supervisorIds }),
    }),

  unassignSupervisors: (mapIds: string[]) =>
    request<{ unassigned: number }>("/maps/unassign-supervisors", {
      method: "POST",
      body: JSON.stringify({ mapIds }),
    }),

  releaseToGraphics: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/release-to-graphics`, {
      method: "POST",
    }),

  createMap: (data: {
    mapNumber: string;
    jiraTicketId?: string;
    client: string;
    area?: string;
    description?: string;
    dueDate?: string;
  }) =>
    request<import("./types").MapRecord>("/maps", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateMapDueDate: (mapId: string, dueDate: string | null) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/due-date`, {
      method: "PATCH",
      body: JSON.stringify({ dueDate }),
    }),

  previewCsvImport: (csv: string) =>
    request<{
      headerRowIndex: number;
      totalRows: number;
      cancelledRows: number;
      activeRows: number;
      withMappingDate: number;
      scheduleOnlyNoMapping: number;
      hubEligible: number;
      samples: {
        mapNumber: string | null;
        building: string | null;
        batch: string | null;
        address: string | null;
        schedule: string | null;
        mapping: string | null;
        activation: string | null;
        polishAssignee: string | null;
        qaAssignee: string | null;
        mappingAt: string | null;
        hubEligible: boolean;
      }[];
    }>("/maps/import-csv/preview", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),

  /** Daily Hub session CSV: name,number,time,mapper,isNew,status,meetLink */
  previewHubCsvImport: (csv: string, sessionDate?: string) =>
    request<{
      sessionDate: string;
      totalRows: number;
      active: number;
      cancelled: number;
      newStores: number;
      withMeetLink: number;
      existingMaps: number;
      newMaps: number;
      errors: { row: number; message: string }[];
      samples: {
        row: number;
        mapNumber: string;
        client: string;
        storeNumber: string;
        timeLabel: string;
        mapperName: string | null;
        isNewStore: boolean;
        fieldWorkStatus: string;
        meetLink: string | null;
      }[];
    }>("/maps/hub/import-csv/preview", {
      method: "POST",
      body: JSON.stringify({ csv, sessionDate }),
    }),

  importHubCsv: (csv: string, opts?: { sessionDate?: string; replaceDay?: boolean }) =>
    request<{
      sessionDate: string;
      created: number;
      updated: number;
      skipped: number;
      errors: { row: number; message: string }[];
      sampleMapNumbers: string[];
    }>("/maps/hub/import-csv", {
      method: "POST",
      body: JSON.stringify({ csv, ...opts }),
    }),

  /** Check which building / map numbers are missing from the database. */
  checkMissingMaps: (numbers: Array<string | number>) =>
    request<{
      checked: string[];
      found: Array<{
        mapNumber: string;
        building: string | null;
        phase: string;
        batch: string | null;
      }>;
      missing: string[];
      invalidInputs: string[];
    }>("/maps/check-missing", {
      method: "POST",
      body: JSON.stringify({ numbers }),
    }),

  importCsv: (csv: string, opts?: { clearExisting?: boolean; defaultClient?: string }) =>
    request<{
      created: number;
      updated: number;
      skipped: number;
      cleared: number;
      hubReady: number;
      errors: { row: number; message: string }[];
      sampleMapNumbers: string[];
      conflicts: Array<{
        mapId: string;
        mapNumber: string;
        field:
          | "batch"
          | "scheduleAt"
          | "mappingAt"
          | "sentToStudioAt"
          | "receivedFromStudioAt"
          | "activationAt";
        systemValue: string | null;
        csvValue: string | null;
        csvIsoDate: string | null;
      }>;
    }>("/maps/import-csv", {
      method: "POST",
      body: JSON.stringify({ csv, ...opts }),
    }),

  resolveCsvImportConflicts: (
    resolutions: Array<{
      mapId: string;
      field:
        | "batch"
        | "scheduleAt"
        | "mappingAt"
        | "sentToStudioAt"
        | "receivedFromStudioAt"
        | "activationAt";
      choice: "system" | "csv";
      csvValue?: string | null;
      csvIsoDate?: string | null;
    }>
  ) =>
    request<{ applied: number }>("/maps/import-csv/resolve-conflicts", {
      method: "POST",
      body: JSON.stringify({ resolutions }),
    }),

  deleteAllMaps: () =>
    request<{ deleted: number }>("/maps/all", {
      method: "DELETE",
    }),

  assignInspector: (
    mapId: string,
    inspectorId: string,
    attachment?: { fileName: string; mimeType: string; data: string }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/assign`, {
      method: "POST",
      body: JSON.stringify({ inspectorId, attachment }),
    }),

  shuffleAssignMaps: (mapIds: string[], inspectorIds: string[]) =>
    request<{
      assigned: number;
      distribution: {
        inspectorId: string;
        inspectorName: string;
        assigned: number;
        totalAfter: number;
      }[];
    }>("/maps/shuffle-assign", {
      method: "POST",
      body: JSON.stringify({ mapIds, inspectorIds }),
    }),

  unassignInspectors: (mapIds: string[]) =>
    request<{ unassigned: number }>("/maps/unassign-inspectors", {
      method: "POST",
      body: JSON.stringify({ mapIds }),
    }),

  assignQa: (
    mapId: string,
    qaId: string,
    attachment?: { fileName: string; mimeType: string; data: string }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/assign-qa`, {
      method: "POST",
      body: JSON.stringify({ qaId, attachment }),
    }),

  cancelMap: (mapId: string, note?: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  updateInspectorStatus: (mapId: string, status: string, note?: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/inspector-status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    }),

  /** Graphics team leader override of a map's workflow status from the board. */
  setLeaderStatus: (
    mapId: string,
    action: import("./lib/activeMapsWorkflow").StatusAction,
    note?: string
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/leader-status`, {
      method: "PATCH",
      body: JSON.stringify({ action, note }),
    }),

  /** Set board Task and/or Station (independent of phase). */
  setMapTaskStation: (
    mapId: string,
    patch: { task?: import("./types").MapTask; station?: import("./types").MapStation }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/task-station`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  /** Set CSV Map received flag (true → "v", false → empty / not received yet). */

  /** Edit spreadsheet / board fields on the maps table. */
  updateMapSpreadsheetDates: (
    mapId: string,
    patch: {
      scheduleAt?: string | null;
      mappingAt?: string | null;
      sentToStudioAt?: string | null;
      receivedFromStudioAt?: string | null;
      activationAt?: string | null;
      client?: string | null;
      batch?: string | null;
      area?: string | null;
      address?: string | null;
      mapperName?: string | null;
      polishStage?: string | null;
      opsManagerComment?: string | null;
      fieldWorkStatus?: "UNCOMPLETED" | "COMPLETED" | "CANCELLED" | null;
    }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/spreadsheet-dates`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  setMapReceived: (mapId: string, received: boolean) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/map-received`, {
      method: "PATCH",
      body: JSON.stringify({ received }),
    }),

  setMapPipeline: (mapId: string, stage: "UPLOAD" | "MAPPING" | "POLISH" | "ACTIVATION") =>
    request<import("./types").MapRecord>(`/maps/${mapId}/pipeline`, {
      method: "PATCH",
      body: JSON.stringify({ stage }),
    }),

  /** Bulk set board Task and/or Station. */
  bulkSetMapTaskStation: (
    mapIds: string[],
    patch: { task?: import("./types").MapTask; station?: import("./types").MapStation }
  ) =>
    request<{ updated: number; maps: import("./types").MapRecord[] }>(`/maps/bulk-task-station`, {
      method: "POST",
      body: JSON.stringify({ mapIds, ...patch }),
    }),

  updateSupervisorStatus: (mapId: string, status: string, note?: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/supervisor-status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    }),

  updateSupervisorField: (
    mapId: string,
    data: {
      loomDone?: boolean;
      positioning?: boolean;
      mapperName?: string | null;
      fieldDate?: string | null;
      opsManagerComment?: string | null;
      fieldWorkStatus?: import("./types").FieldWorkStatus;
    }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/supervisor-field`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  assignSupervisor: (
    mapId: string,
    supervisorId: string,
    attachment?: { fileName: string; mimeType: string; data: string }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/assign-supervisor`, {
      method: "POST",
      body: JSON.stringify({ supervisorId, attachment }),
    }),

  addMapNote: (mapId: string, body: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  uploadReview: (mapId: string, approved: boolean, note?: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/upload-review`, {
      method: "POST",
      body: JSON.stringify({ approved, note }),
    }),

  fieldComplete: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/field-complete`, {
      method: "POST",
    }),

  qaReview: (mapId: string, status: "fix" | "fix_done" | "approved", note?: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/qa-review`, {
      method: "POST",
      body: JSON.stringify({ status, note }),
    }),

  createTask: (
    mapId: string,
    data: { title: string; description?: string; assignedToId?: string; phase?: string }
  ) =>
    request<import("./types").Task>(`/maps/${mapId}/tasks`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateTaskStatus: (taskId: string, status: string) =>
    request<import("./types").Task>(`/maps/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  getReports: (q?: string) =>
    request<import("./types/report").OpsDailyReportListItem[]>(
      `/reports${buildQuery({ q })}`
    ),

  getReport: (id: string) =>
    request<import("./types/report").OpsDailyReportDetail>(`/reports/${id}`),

  updateReportNote: (id: string, opsManagerNote: string | null) =>
    request<import("./types/report").OpsDailyReportDetail>(`/reports/${id}/note`, {
      method: "PATCH",
      body: JSON.stringify({ opsManagerNote }),
    }),

  getMyAvailability: (weekStart?: string) =>
    request<import("./types/availability").AvailabilitySubmission>(
      `/availability/mine${buildQuery({ weekStart })}`
    ),

  saveMyAvailability: (body: {
    weekStart?: string;
    fridayContract: boolean;
    sundayOk?: boolean;
    hagimOk?: boolean;
    days: {
      dayOfWeek: number;
      canWork: boolean;
      allDay?: boolean;
      startMinutes?: number | null;
      endMinutes?: number | null;
      startMinutes2?: number | null;
      endMinutes2?: number | null;
      note?: string | null;
    }[];
  }) =>
    request<import("./types/availability").AvailabilitySubmission>("/availability/mine", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  getAvailabilityRoster: (weekStart?: string) =>
    request<import("./types/availability").AvailabilityRoster>(
      `/availability/roster${buildQuery({ weekStart })}`
    ),

  getShiftPlan: (weekStart?: string) =>
    request<import("./types/availability").ShiftPlanView>(
      `/availability/plan${buildQuery({ weekStart })}`
    ),

  saveShiftPlan: (body: {
    weekStart?: string;
    assignments: import("./types/availability").ShiftPlanAssignment[];
  }) =>
    request<import("./types/availability").ShiftPlanSaveResult>("/availability/plan", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  autoGenerateShiftPlan: (body?: {
    weekStart?: string;
    dayOfWeek?: number;
    lockedAssignments?: import("./types/availability").ShiftPlanAssignment[];
    variant?: number;
    avoidUserIds?: string[];
  }) =>
    request<import("./types/availability").ShiftPlanSaveResult>("/availability/plan/auto", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),

  getPublishedSchedule: (weekStart?: string) =>
    request<import("./types/availability").PublishedScheduleView>(
      `/availability/schedule${buildQuery({ weekStart })}`
    ),

  getShiftChangeCandidates: (weekStart: string, dayOfWeek: number) =>
    request<{ candidates: import("./types/availability").ShiftChangeCandidate[] }>(
      `/availability/shift-changes/candidates${buildQuery({
        weekStart,
        dayOfWeek: String(dayOfWeek),
      })}`
    ),

  getShiftChanges: (weekStart?: string) =>
    request<import("./types/availability").ShiftChangeList>(
      `/availability/shift-changes${buildQuery({ weekStart })}`
    ),

  createShiftChange: (body: {
    weekStart: string;
    dayOfWeek: number;
    toUserId: string;
    note?: string;
  }) =>
    request<import("./types/availability").ShiftChangeRequest>("/availability/shift-changes", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  acceptShiftChange: (id: string) =>
    request<import("./types/availability").ShiftChangeRequest>(
      `/availability/shift-changes/${id}/accept`,
      { method: "POST" }
    ),

  rejectShiftChange: (id: string) =>
    request<import("./types/availability").ShiftChangeRequest>(
      `/availability/shift-changes/${id}/reject`,
      { method: "POST" }
    ),

  cancelShiftChange: (id: string) =>
    request<import("./types/availability").ShiftChangeRequest>(
      `/availability/shift-changes/${id}/cancel`,
      { method: "POST" }
    ),

  opsAcceptShiftChange: (id: string) =>
    request<import("./types/availability").ShiftChangeRequest>(
      `/availability/shift-changes/${id}/ops-accept`,
      { method: "POST" }
    ),

  opsRejectShiftChange: (id: string) =>
    request<import("./types/availability").ShiftChangeRequest>(
      `/availability/shift-changes/${id}/ops-reject`,
      { method: "POST" }
    ),

  // ---- Super Admin / features / usage ----

  getMyFeatures: () =>
    request<import("./types").ResolvedFeature[]>("/features/mine"),

  setMyFeatureOverride: (key: string, enabled: boolean | null) =>
    request<import("./types").ResolvedFeature>(`/features/${encodeURIComponent(key)}/mine`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),

  listFeatureFlags: () =>
    request<import("./types").FeatureFlag[]>("/features"),

  updateFeatureFlag: (
    key: string,
    data: {
      enabled?: boolean;
      isExperimental?: boolean;
      rolloutRoles?: import("./types").RoleName[];
      label?: string;
      description?: string | null;
    }
  ) =>
    request<import("./types").FeatureFlag>(`/features/${encodeURIComponent(key)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  setFeatureOverride: (key: string, userId: string, enabled: boolean | null) =>
    request<import("./types").FeatureFlag>(
      `/features/${encodeURIComponent(key)}/override`,
      {
        method: "POST",
        body: JSON.stringify({ userId, enabled }),
      }
    ),

  listUsers: () => request<import("./types").AdminUser[]>("/users"),

  getAssignableRoles: () =>
    request<import("./types").AssignableRole[]>("/users/roles"),

  createUser: (data: {
    email: string;
    name: string;
    roles: import("./types").RoleName[];
  }) =>
    request<import("./types").AdminUser>("/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  setUserRoles: (id: string, roles: import("./types").RoleName[]) =>
    request<import("./types").AdminUser>(`/users/${id}/roles`, {
      method: "PATCH",
      body: JSON.stringify({ roles }),
    }),

  setUserActive: (id: string, active: boolean) =>
    request<import("./types").AdminUser>(`/users/${id}/active`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    }),

  getMetrics: (days?: number) =>
    request<import("./types").UsageMetrics>(
      `/metrics${buildQuery({ days: days != null ? String(days) : undefined })}`
    ),

  getAuditLog: (q?: string) =>
    request<import("./types").AuditLogEntry[]>(`/metrics/audit${buildQuery({ q })}`),

  trackUsage: (events: { event: string; section?: string; metadata?: Record<string, unknown> }[]) =>
    request<{ recorded: number }>("/usage", {
      method: "POST",
      body: JSON.stringify({ events }),
    }),
};

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem("ops_token", token);
  else localStorage.removeItem("ops_token");
}

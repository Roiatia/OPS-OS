const API = "/api";

function getToken() {
  return localStorage.getItem("ops_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed (${res.status})`);
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

  demoLogin: (email: string) =>
    request<{ token: string; user: import("./types").User }>("/auth/demo", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

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

  /** One round-trip for a dashboard: maps + history + team + supervisor field maps. */
  getDashboard: () =>
    request<{
      maps: import("./types").MapRecord[];
      history: import("./types").MapRecord[];
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

  swapSupervisorMaps: (mapIds: string[], toSupervisorId: string) =>
    request<{ swapped: number }>("/maps/swap-supervisor", {
      method: "POST",
      body: JSON.stringify({ mapIds, toSupervisorId }),
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
      samples: {
        mapNumber: string | null;
        building: string | null;
        batch: string | null;
        address: string | null;
        polishAssignee: string | null;
      }[];
    }>("/maps/import-csv/preview", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),

  importCsv: (csv: string, opts?: { clearExisting?: boolean; defaultClient?: string }) =>
    request<{
      created: number;
      updated: number;
      skipped: number;
      cleared: number;
      errors: { row: number; message: string }[];
      sampleMapNumbers: string[];
    }>("/maps/import-csv", {
      method: "POST",
      body: JSON.stringify({ csv, ...opts }),
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

  autoGenerateShiftPlan: (weekStart?: string) =>
    request<import("./types/availability").ShiftPlanSaveResult>("/availability/plan/auto", {
      method: "POST",
      body: JSON.stringify({ weekStart }),
    }),
};

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem("ops_token", token);
  else localStorage.removeItem("ops_token");
}

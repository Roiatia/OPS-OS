const API = "/api";

/** Reads the stored auth token from localStorage. */
function getToken() {
  return localStorage.getItem("ops_token");
}

/** Sends an authenticated JSON request to the backend API. */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const method = options.method ?? "GET";
  const sendsJson = method === "POST" || method === "PUT" || method === "PATCH";
  const body = options.body ?? (sendsJson ? "{}" : undefined);

  const res = await fetch(`${API}${path}`, {
    ...options,
    method,
    body,
    headers: {
      ...(sendsJson ? { "Content-Type": "application/json" } : {}),
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

/** Typed client for all backend REST endpoints. */
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

  getHistoryMaps: () => request<import("./types").MapRecord[]>("/maps/history"),

  getMap: (id: string) => request<import("./types").MapRecord>(`/maps/${id}`),

  getTeam: () => request<import("./types").TeamMember[]>("/maps/team"),

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
      body: JSON.stringify({
        csv,
        clearExisting: opts?.clearExisting ?? false,
        defaultClient: opts?.defaultClient,
      }),
    }),

  updateMapDueDate: (mapId: string, dueDate: string | null) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/due-date`, {
      method: "PATCH",
      body: JSON.stringify({ dueDate }),
    }),

  updateMapWorkflowPhaseTarget: (
    mapId: string,
    workflowPhaseTarget: import("./types").WorkflowPhaseTarget
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/workflow-phase-target`, {
      method: "PATCH",
      body: JSON.stringify({ workflowPhaseTarget }),
    }),

  updateMapStation: (mapId: string, station: import("./types").WorkflowPhaseTarget) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/station`, {
      method: "PATCH",
      body: JSON.stringify({ station }),
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

  acceptInspectorAssignment: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/accept-assignment`, {
      method: "POST",
    }),

  acceptQaAssignment: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/accept-qa-assignment`, {
      method: "POST",
    }),

  unassignInspector: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/unassign`, {
      method: "POST",
    }),

  releaseMapToPipeline: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/release-to-pipeline`, {
      method: "POST",
    }),

  unassignQa: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/unassign-qa`, {
      method: "POST",
    }),

  cancelMap: (mapId: string, note?: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  deleteMap: (mapId: string) =>
    request<{ ok: true }>(`/maps/${mapId}`, { method: "DELETE" }),

  deleteMaps: (mapIds: string[]) =>
    request<{ ok: true; deleted: number }>("/maps/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ mapIds }),
    }),

  shuffleAssignNewMaps: (mapIds: string[], inspectorIds: string[], qaIds?: string[]) =>
    request<{
      inspectorAssigned: number;
      qaAssigned: number;
      inspectorDistribution: {
        userId: string;
        userName: string;
        assigned: number;
        totalAfter: number;
      }[];
      qaDistribution: {
        userId: string;
        userName: string;
        assigned: number;
        totalAfter: number;
      }[];
    }>("/maps/shuffle-assign-new", {
      method: "POST",
      body: JSON.stringify({ mapIds, inspectorIds, qaIds: qaIds ?? [] }),
    }),

  updateMapStatus: (
    mapId: string,
    status: import("./types").MapStatus,
    note?: string,
    attachment?: { fileName: string; mimeType: string; data: string }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note, attachment }),
    }),

  updateInspectorStatus: (mapId: string, status: string, note?: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/inspector-status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    }),

  addMapNote: (mapId: string, body: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),

  uploadReview: (
    mapId: string,
    approved: boolean,
    note?: string,
    attachment?: { fileName: string; mimeType: string; data: string }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/upload-review`, {
      method: "POST",
      body: JSON.stringify({ approved, note, attachment }),
    }),

  fieldComplete: (mapId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/field-complete`, {
      method: "POST",
    }),

  qaReview: (
    mapId: string,
    status: "fix" | "fix_done" | "approved",
    note?: string,
    attachment?: { fileName: string; mimeType: string; data: string }
  ) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/qa-review`, {
      method: "POST",
      body: JSON.stringify({ status, note, attachment }),
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
};

/** Persists or clears the JWT used for API requests. */
export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem("ops_token", token);
  else localStorage.removeItem("ops_token");
}

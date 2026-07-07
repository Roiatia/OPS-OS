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

  updateMapDueDate: (mapId: string, dueDate: string | null) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/due-date`, {
      method: "PATCH",
      body: JSON.stringify({ dueDate }),
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
};

export function setAuthToken(token: string | null) {
  if (token) localStorage.setItem("ops_token", token);
  else localStorage.removeItem("ops_token");
}

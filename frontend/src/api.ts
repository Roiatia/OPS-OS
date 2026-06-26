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

  getMap: (id: string) => request<import("./types").MapRecord>(`/maps/${id}`),

  getTeam: () => request<import("./types").TeamMember[]>("/maps/team"),

  createMap: (data: {
    mapNumber: string;
    jiraTicketId?: string;
    client: string;
    area?: string;
    description?: string;
  }) =>
    request<import("./types").MapRecord>("/maps", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  assignInspector: (mapId: string, inspectorId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/assign`, {
      method: "POST",
      body: JSON.stringify({ inspectorId }),
    }),

  assignQa: (mapId: string, qaId: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/assign-qa`, {
      method: "POST",
      body: JSON.stringify({ qaId }),
    }),

  updateInspectorStatus: (mapId: string, status: string) =>
    request<import("./types").MapRecord>(`/maps/${mapId}/inspector-status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
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

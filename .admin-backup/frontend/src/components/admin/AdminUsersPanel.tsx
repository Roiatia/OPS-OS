import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { AdminUser, AssignableRole } from "../../types";
import type { RoleName } from "../../types";

function initialForm() {
  return { email: "", name: "", roles: [] as RoleName[] };
}

export function AdminUsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRoles, setEditRoles] = useState<RoleName[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([api.listUsers(), api.getAssignableRoles()]);
      setUsers(u);
      setRoles(r);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roleLabel = useMemo(() => {
    const map = new Map(roles.map((r) => [r.role, r.label]));
    return (role: RoleName) => map.get(role) ?? role;
  }, [roles]);

  const toggle = (list: RoleName[], role: RoleName) =>
    list.includes(role) ? list.filter((r) => r !== role) : [...list, role];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createUser({
        email: form.email.trim(),
        name: form.name.trim(),
        roles: form.roles,
      });
      setForm(initialForm());
      setShowCreate(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveRoles(userId: string) {
    setBusyId(userId);
    setError("");
    try {
      await api.setUserRoles(userId, editRoles);
      setEditingId(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(user: AdminUser) {
    setBusyId(user.id);
    setError("");
    try {
      await api.setUserActive(user.id, !user.active);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-muted">Loading users...</p>;

  return (
    <section className="space-y-5">
      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {users.length} user{users.length === 1 ? "" : "s"} · pre-provisioned accounts activate on
          first Google sign-in.
        </p>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 shadow-sm transition-colors"
        >
          {showCreate ? "Cancel" : "+ New user"}
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                placeholder="person@company.com"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Name</span>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                placeholder="Full name"
              />
            </label>
          </div>
          <div>
            <span className="text-sm font-medium">Roles</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {roles.map((r) => {
                const on = form.roles.includes(r.role);
                return (
                  <button
                    key={r.role}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, roles: toggle(f.roles, r.role) }))}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      on
                        ? "bg-brand-600 text-white border-brand-600"
                        : "bg-white text-slate-600 border-border hover:bg-brand-50"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700"
          >
            Create user
          </button>
        </form>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Roles</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => {
              const editing = editingId === user.id;
              const busy = busyId === user.id;
              return (
                <tr key={user.id} className={user.active ? "" : "bg-slate-50/60"}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{user.name}</div>
                    <div className="text-xs text-muted">{user.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {editing ? (
                      <div className="flex flex-wrap gap-1.5">
                        {roles.map((r) => {
                          const on = editRoles.includes(r.role);
                          return (
                            <button
                              key={r.role}
                              type="button"
                              onClick={() => setEditRoles((list) => toggle(list, r.role))}
                              className={`px-2 py-1 rounded text-xs border ${
                                on
                                  ? "bg-brand-600 text-white border-brand-600"
                                  : "bg-white text-slate-500 border-border"
                              }`}
                            >
                              {r.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {user.roles.map((role) => (
                          <span
                            key={role}
                            className="px-2 py-0.5 rounded-full text-xs bg-brand-100 text-brand-800"
                          >
                            {roleLabel(role)}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                        user.active ? "text-emerald-700" : "text-slate-400"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          user.active ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                      />
                      {user.active ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {editing ? (
                        <>
                          <button
                            type="button"
                            disabled={busy || editRoles.length === 0}
                            onClick={() => saveRoles(user.id)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(user.id);
                              setEditRoles(user.roles);
                            }}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium border border-border hover:bg-slate-50"
                          >
                            Edit roles
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => toggleActive(user)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border disabled:opacity-50 ${
                              user.active
                                ? "border-rose-200 text-rose-600 hover:bg-rose-50"
                                : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                            }`}
                          >
                            {user.active ? "Disable" : "Enable"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

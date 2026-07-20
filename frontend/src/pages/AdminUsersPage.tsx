import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS, type RoleName } from "../types";
import type { AdminUser, PermissionCatalog } from "../types";
import {
  PERMISSION_GROUPS,
  permissionLabel,
  type Permission,
} from "../lib/permissions";
import { UserAccessGuide } from "../components/admin/UserAccessGuide";

type Tab = "simple" | "advanced";
/** undefined = inherit from roles, true = grant override, false = deny override */
type OverrideState = Partial<Record<Permission, boolean>>;

const ALL_ROLES: RoleName[] = [
  "OPS_ADMIN",
  "OPS_MANAGER_2",
  "GRAPHIC_TEAM_LEADER",
  "SUPERVISOR_SHIFT_LEADER",
  "SUPERVISOR",
  "GRAPHIC_QA",
  "MAPPING_INSPECTOR",
];

function overridesToState(user: AdminUser): OverrideState {
  const state: OverrideState = {};
  for (const o of user.overrides) state[o.permission] = o.granted;
  return state;
}

function sameRoles(a: RoleName[], b: RoleName[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((r) => set.has(r));
}

function sameOverrides(a: OverrideState, b: OverrideState): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k as Permission] !== b[k as Permission]) return false;
  }
  return true;
}

export function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("simple");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);

  // Editing drafts for the selected user.
  const [draftRoles, setDraftRoles] = useState<RoleName[]>([]);
  const [draftOverrides, setDraftOverrides] = useState<OverrideState>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([
        api.getAdminUsers(),
        api.getPermissionCatalog(),
      ]);
      setUsers(u);
      setCatalog(c);
      setError("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId]
  );

  const selectUser = useCallback((u: AdminUser) => {
    setSelectedId(u.id);
    setDraftRoles(u.roles);
    setDraftOverrides(overridesToState(u));
    setNotice("");
    setError("");
  }, []);

  // Map role -> permissions from the catalog (authoritative).
  const rolePermMap = useMemo(() => {
    const map = new Map<RoleName, Permission[]>();
    for (const r of catalog?.roles ?? []) map.set(r.role, r.permissions);
    return map;
  }, [catalog]);

  // Permissions granted by the currently drafted roles.
  const draftRolePerms = useMemo(() => {
    const set = new Set<Permission>();
    for (const role of draftRoles) {
      for (const p of rolePermMap.get(role) ?? []) set.add(p);
    }
    return set;
  }, [draftRoles, rolePermMap]);

  // Effective permissions = role perms ∪ grant overrides − deny overrides.
  const effective = useMemo(() => {
    const set = new Set<Permission>(draftRolePerms);
    for (const [perm, granted] of Object.entries(draftOverrides)) {
      if (granted) set.add(perm as Permission);
      else set.delete(perm as Permission);
    }
    return set;
  }, [draftRolePerms, draftOverrides]);

  const rolesDirty = selected ? !sameRoles(draftRoles, selected.roles) : false;
  const overridesDirty = selected
    ? !sameOverrides(draftOverrides, overridesToState(selected))
    : false;

  function toggleRole(role: RoleName) {
    setNotice("");
    setDraftRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  function setOverride(perm: Permission, next: boolean | undefined) {
    setNotice("");
    setDraftOverrides((prev) => {
      const copy = { ...prev };
      if (next === undefined) delete copy[perm];
      else copy[perm] = next;
      return copy;
    });
  }

  async function saveRoles() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const updated = await api.setUserRoles(selected.id, draftRoles);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setDraftRoles(updated.roles);
      setDraftOverrides(overridesToState(updated));
      setNotice("Roles saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveOverrides() {
    if (!selected) return;
    setSaving(true);
    setError("");
    const grants: Permission[] = [];
    const denies: Permission[] = [];
    for (const [perm, granted] of Object.entries(draftOverrides)) {
      if (granted) grants.push(perm as Permission);
      else denies.push(perm as Permission);
    }
    try {
      const updated = await api.setUserPermissions(selected.id, { grants, denies });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setDraftRoles(updated.roles);
      setDraftOverrides(overridesToState(updated));
      setNotice("Permission overrides saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="px-6 py-10 text-muted">Loading user access…</div>;
  }

  return (
    <div className="px-6 py-6">
      <UserAccessGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
      <div className="max-w-[1200px] mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">User access</h1>
            <p className="text-muted mt-1">
              Assign roles as ready-made access presets, or fine-tune individual
              permissions in the Advanced tab.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-700 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Guide
            </button>
            <Link
              to="/app/ops/hub"
              className="text-sm text-muted hover:text-brand-600 transition-colors"
            >
              ← Back to OPS
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* User list */}
          <aside className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted px-1">
              {users.length} users
            </p>
            <div className="space-y-2">
              {users.map((u) => {
                const active = u.id === selectedId;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => selectUser(u)}
                    className={`w-full text-left rounded-xl border p-3 transition-all ${
                      active
                        ? "border-brand-500 bg-brand-50 shadow-sm"
                        : "border-border bg-white hover:border-brand-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 truncate">
                        {u.name}
                      </span>
                      {u.pending ? (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                          Pending
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] font-bold tabular-nums px-2 py-0.5 rounded-full bg-brand-100 text-brand-800">
                          {u.permissions.length}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted mt-0.5 truncate">{u.email}</p>
                    <p className="text-[11px] text-slate-500 mt-1 truncate">
                      {u.roles.length === 0
                        ? "No roles assigned"
                        : u.roles.map((r) => ROLE_LABELS[r]).join(", ")}
                    </p>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Editor */}
          <section className="min-w-0">
            {!selected ? (
              <div className="rounded-xl border border-dashed border-border bg-slate-50/80 px-6 py-16 text-center">
                <p className="text-sm font-medium text-slate-800">
                  Select a user to manage access
                </p>
                <p className="text-xs text-muted mt-1">
                  Pick someone from the list to assign roles or fine-tune
                  permissions.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-xl border border-border bg-white p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-base font-semibold">
                      {selected.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900">
                        {selected.name}
                        {selected.id === currentUser?.id && (
                          <span className="ml-2 text-[11px] font-medium text-brand-600">
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted truncate">{selected.email}</p>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-2">
                  {(["simple", "advanced"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTab(t)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        tab === t
                          ? "bg-brand-600 text-white"
                          : "bg-white border border-border text-slate-600 hover:bg-brand-50"
                      }`}
                    >
                      {t === "simple" ? "Simple — roles" : "Advanced — overrides"}
                    </button>
                  ))}
                </div>

                {notice && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                    {notice}
                  </div>
                )}

                {tab === "simple" ? (
                  <SimpleTab
                    draftRoles={draftRoles}
                    onToggleRole={toggleRole}
                    effective={effective}
                    dirty={rolesDirty}
                    saving={saving}
                    onSave={saveRoles}
                    onReset={() => selectUser(selected)}
                  />
                ) : (
                  <AdvancedTab
                    draftRolePerms={draftRolePerms}
                    draftOverrides={draftOverrides}
                    effective={effective}
                    onSetOverride={setOverride}
                    dirty={overridesDirty}
                    saving={saving}
                    onSave={saveOverrides}
                    onReset={() => selectUser(selected)}
                  />
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function SimpleTab({
  draftRoles,
  onToggleRole,
  effective,
  dirty,
  saving,
  onSave,
  onReset,
}: {
  draftRoles: RoleName[];
  onToggleRole: (role: RoleName) => void;
  effective: Set<Permission>;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="font-semibold text-slate-900">Roles</h3>
        <p className="text-xs text-muted mt-0.5">
          Ready-made access presets. Assign one or more.
        </p>
        <div className="mt-3 space-y-2">
          {ALL_ROLES.map((role) => {
            const checked = draftRoles.includes(role);
            return (
              <label
                key={role}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                  checked
                    ? "border-brand-300 bg-brand-50"
                    : "border-border hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleRole(role)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-sm font-medium text-slate-800">
                  {ROLE_LABELS[role]}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-white p-4">
        <h3 className="font-semibold text-slate-900">Effective permissions</h3>
        <p className="text-xs text-muted mt-0.5">
          Live preview of what these roles grant ({effective.size}).
        </p>
        <div className="mt-3 space-y-3">
          {PERMISSION_GROUPS.map((group) => {
            const granted = group.permissions.filter((p) => effective.has(p));
            if (granted.length === 0) return null;
            return (
              <div key={group.group}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {group.group}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {granted.map((p) => (
                    <span
                      key={p}
                      className="text-[11px] font-medium px-2 py-1 rounded-md bg-slate-100 text-slate-700"
                    >
                      {permissionLabel(p)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {effective.size === 0 && (
            <p className="text-sm text-muted">
              No permissions — this user is pending and cannot access any
              workspace.
            </p>
          )}
        </div>
      </div>

      <div className="md:col-span-2">
        <SaveBar dirty={dirty} saving={saving} onSave={onSave} onReset={onReset} />
      </div>
    </div>
  );
}

function AdvancedTab({
  draftRolePerms,
  draftOverrides,
  effective,
  onSetOverride,
  dirty,
  saving,
  onSave,
  onReset,
}: {
  draftRolePerms: Set<Permission>;
  draftOverrides: OverrideState;
  effective: Set<Permission>;
  onSetOverride: (perm: Permission, next: boolean | undefined) => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
        Overrides take precedence over roles. Use <strong>Grant</strong> to add a
        permission a role doesn't include, or <strong>Deny</strong> to remove one a
        role would otherwise grant. Leave on <strong>Default</strong> to inherit
        from roles.
      </div>

      {PERMISSION_GROUPS.map((group) => (
        <div key={group.group} className="rounded-xl border border-border bg-white overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-slate-50">
            <h3 className="text-sm font-semibold text-slate-900">{group.group}</h3>
          </div>
          <div className="divide-y divide-border">
            {group.permissions.map((perm) => {
              const fromRole = draftRolePerms.has(perm);
              const override = draftOverrides[perm];
              const isEffective = effective.has(perm);
              const state: "default" | "grant" | "deny" =
                override === undefined ? "default" : override ? "grant" : "deny";

              let source = "Not granted";
              if (state === "grant") source = "Granted by override";
              else if (state === "deny") source = "Denied by override";
              else if (fromRole) source = "Granted by role";

              return (
                <div
                  key={perm}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">
                        {permissionLabel(perm)}
                      </span>
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          isEffective ? "bg-emerald-500" : "bg-slate-300"
                        }`}
                        title={isEffective ? "Effective" : "Not effective"}
                      />
                    </div>
                    <p className="text-[11px] text-muted mt-0.5">{source}</p>
                  </div>
                  <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
                    {(
                      [
                        { key: "default", label: "Default", value: undefined },
                        { key: "grant", label: "Grant", value: true },
                        { key: "deny", label: "Deny", value: false },
                      ] as const
                    ).map((opt) => {
                      const activeOpt = state === opt.key;
                      const tone =
                        opt.key === "grant"
                          ? "bg-emerald-600 text-white"
                          : opt.key === "deny"
                            ? "bg-red-600 text-white"
                            : "bg-slate-700 text-white";
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => onSetOverride(perm, opt.value)}
                          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                            activeOpt
                              ? tone
                              : "bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <SaveBar dirty={dirty} saving={saving} onSave={onSave} onReset={onReset} />
    </div>
  );
}

function SaveBar({
  dirty,
  saving,
  onSave,
  onReset,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={!dirty || saving}
        onClick={onSave}
        className="px-4 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 shadow-sm shadow-brand-600/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
      {dirty && !saving && (
        <button
          type="button"
          onClick={onReset}
          className="text-sm text-muted hover:text-slate-700 transition-colors"
        >
          Discard
        </button>
      )}
      {dirty && (
        <span className="text-xs text-amber-600 font-medium">
          Unsaved changes
        </span>
      )}
    </div>
  );
}

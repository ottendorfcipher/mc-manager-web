import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavPrefsStore } from "@/store/auth";
import { UserPlus, X, Link, Users, Pickaxe, ShieldCheck, ChevronRight, Shield, ListChecks, Trash2, Map as MapIcon, Globe, Send, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { RoleBadge } from "@/components/Badge";
import { PermissionsPage } from "./PermissionsPage";
import { RolesTab } from "./RolesTab";
import { UserOverridePanel } from "./UserOverridePanel";
import type { User, PlayerLink, McPlayer, RoleRecord, PendingPlayer, BlueMapSettings, TailscaleInviteResult } from "@/types";
import { WorldsTab }    from "./WorldsTab";
import { InvitePortal } from "./InvitePortal";
import { ROLE_LEVELS }  from "@/types";
import { toast } from "@/components/Toast";

type Tab = "users" | "roles" | "pairing" | "permissions" | "whitelist" | "pending" | "map" | "worlds";

// ── AdminPage ───────────────────────────────────────────────────────────────────

export function AdminPage() {
  const { user, hasPerm } = useAuthStore();
  const [tab, setTab] = useState<Tab>("users");

  const canSeeUsers      = hasPerm("users.view") || hasPerm("users.invite") || hasPerm("users.remove");
  const canSeeRoles      = hasPerm("roles.view") || hasPerm("roles.create") || hasPerm("roles.edit");
  const canManage        = hasPerm("users.invite") || hasPerm("users.remove");
  const canEditPerms     = hasPerm("roles.edit") || hasPerm("users.permissions.edit");
  const canManageWl      = hasPerm("server.whitelist.manage");
  const canSeePending    = hasPerm("players.pending.view") || hasPerm("players.pending.manage");
  const canSeeWorlds     = hasPerm("worlds.view");
  const isGlobalAdmin    = user?.role === "global_admin";

  const tabs = [
    { id: "users"       as Tab, label: "Users",              Icon: Users,       show: canSeeUsers },
    { id: "roles"       as Tab, label: "Roles",              Icon: Shield,      show: canSeeRoles },
    { id: "pairing"     as Tab, label: "Minecraft Pairing",  Icon: Pickaxe,     show: canManage },
    { id: "pending"     as Tab, label: "Pending Players",    Icon: UserPlus,    show: canSeePending },
    { id: "whitelist"   as Tab, label: "MC Whitelist",       Icon: ListChecks,  show: canManageWl },
    { id: "worlds"      as Tab, label: "Worlds",             Icon: Globe,       show: canSeeWorlds },
    { id: "map"         as Tab, label: "Map",                Icon: MapIcon,     show: isGlobalAdmin },
    { id: "permissions" as Tab, label: "Permissions",        Icon: ShieldCheck, show: canEditPerms },
  ].filter((t) => t.show);

  return (
    <div className="page-wide">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Admin Settings</h1>
        <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
          Manage users, roles, Minecraft accounts, and permissions
        </p>
      </div>

      {/* Tab bar — scrollable on mobile; role=tablist with Arrow-key navigation */}
      <div className="-mx-4 sm:mx-0 overflow-x-auto">
      <div
        role="tablist"
        aria-label="Admin sections"
        className="flex gap-1 border-b border-[#D9D5D0] dark:border-[#363944] min-w-max sm:min-w-0 px-4 sm:px-0"
        onKeyDown={(e) => {
          const idx = tabs.findIndex((t) => t.id === tab);
          if (e.key === "ArrowRight") setTab(tabs[(idx + 1) % tabs.length].id);
          else if (e.key === "ArrowLeft") setTab(tabs[(idx - 1 + tabs.length) % tabs.length].id);
        }}
      >
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`tabpanel-${id}`}
            id={`tab-${id}`}
            onClick={() => setTab(id)}
            data-testid={`tab-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-[#5B9BF0] text-[#5B9BF0]"
                : "border-transparent text-sub hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>
      </div>

      <div role="tabpanel" id="tabpanel-users"       aria-labelledby="tab-users"       hidden={tab !== "users"}><UsersTab /></div>
      <div role="tabpanel" id="tabpanel-roles"       aria-labelledby="tab-roles"       hidden={tab !== "roles"}><RolesTab /></div>
      <div role="tabpanel" id="tabpanel-pairing"     aria-labelledby="tab-pairing"     hidden={tab !== "pairing"}><MCPairingTab /></div>
      <div role="tabpanel" id="tabpanel-pending"     aria-labelledby="tab-pending"     hidden={tab !== "pending"}>
        {tab === "pending" && (
          <details className="mb-3" open={false}>
            <summary className="cursor-pointer text-xs font-semibold text-meta hover:text-sub select-none">
              How it works
            </summary>
            <p className="mt-2 text-xs text-meta leading-relaxed">
              Players who connect via Tailscale for the first time are placed in this queue.
              Their first session is allowed; subsequent join attempts are blocked until an admin
              links their in-game name (IGN) to a portal account. Once linked, they can join freely.
            </p>
          </details>
        )}
        <PendingPlayersTab />
      </div>
      <div role="tabpanel" id="tabpanel-whitelist"   aria-labelledby="tab-whitelist"   hidden={tab !== "whitelist"}><MCWhitelistTab /></div>
      <div role="tabpanel" id="tabpanel-worlds"      aria-labelledby="tab-worlds"      hidden={tab !== "worlds"}>
        {tab === "worlds" && (
          <details className="mb-3" open={false}>
            <summary className="cursor-pointer text-xs font-semibold text-meta hover:text-sub select-none">
              How it works
            </summary>
            <p className="mt-2 text-xs text-meta leading-relaxed">
              Each world is a named slot stored in <code className="font-mono">/opt/minecraft/worlds/&#123;slug&#125;/</code> on the game
              server. Only one world is active at a time. Switching saves the current world first,
              then loads the target — the Minecraft service restarts briefly (1–3 min). Backups
              are stored per-world under <code className="font-mono">/opt/minecraft/backups/&#123;slug&#125;/daily/</code>.
            </p>
          </details>
        )}
        <WorldsTab />
      </div>
      <div role="tabpanel" id="tabpanel-map"         aria-labelledby="tab-map"         hidden={tab !== "map"}><MapSettingsTab /></div>
      <div role="tabpanel" id="tabpanel-permissions" aria-labelledby="tab-permissions" hidden={tab !== "permissions"}><PermissionsPage /></div>
    </div>
  );
}

function MapSettingsTab() {
  const qc = useQueryClient();
  const { showConfigureNav, setShowConfigureNav } = useNavPrefsStore();

  const { data: settings, isLoading } = useQuery<BlueMapSettings>({
    queryKey: ["bluemap-settings"],
    queryFn: () => api.get("/map/settings"),
  });

  const updateMut = useMutation({
    mutationFn: (advanced_ui_enabled: boolean) =>
      api.put<BlueMapSettings>("/map/settings", { advanced_ui_enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bluemap-settings"] }),
  });

  const enabled = settings?.advanced_ui_enabled ?? false;

  return (
    <div className="space-y-4">
      {/* ── Configure tab visibility ──────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] mb-1">
          Navigation
        </h3>
        <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB] mb-3">
          Control which pages appear in the sidebar. Changes apply immediately to this device.
        </p>
        <div className="card flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
              Show Configure in sidebar
            </p>
            <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB] mt-1">
              Exposes the server.properties editor in the navigation. Off by default —
              enable when you need to adjust server settings.
            </p>
          </div>
          <button
            onClick={() => setShowConfigureNav(!showConfigureNav)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              showConfigureNav ? "bg-[#5B9BF0]" : "bg-[#9B9EA6]"
            }`}
            aria-pressed={showConfigureNav}
            aria-label="Toggle Configure in sidebar"
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                showConfigureNav ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* ── BlueMap ──────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] mb-1">
          BlueMap
        </h3>
        <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB] mb-3">
          Control whether the embedded BlueMap exposes its full interface. When disabled,
          players only see the locked top-down map view; menu, maps, free-flight, and perspective controls are hidden.
        </p>
        <div className="card flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
              Enable advanced BlueMap controls
            </p>
            <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB] mt-1">
              Re-enable this only when you want everyone on the site to access BlueMap’s menu,
              map selector, perspective mode, and free-flight controls.
            </p>
          </div>
          <button
            onClick={() => updateMut.mutate(!enabled)}
            disabled={isLoading || updateMut.isPending}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              enabled ? "bg-[#5B9BF0]" : "bg-[#9B9EA6]"
            } disabled:opacity-50`}
            aria-pressed={enabled}
            aria-label="Toggle advanced BlueMap controls"
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Users tab ───────────────────────────────────────────────────────────────────

function UsersTab() {
  const { user: me, hasPerm } = useAuthStore();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  // Staged role — reset to the user's actual role whenever the selected user changes.
  const [stagedRole, setStagedRole] = useState("");
  useEffect(() => { setStagedRole(selectedUser?.role ?? ""); }, [selectedUser?.email]);

  const canInvite    = hasPerm("users.invite");
  const canRemove    = hasPerm("users.remove");
  const canOverrides = hasPerm("users.permission_overrides.edit");

  const myLevel = ROLE_LEVELS[me?.role ?? "user"] ?? 1;

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  // Load API roles for the change-role dropdown
  const { data: apiRoles = [] } = useQuery<RoleRecord[]>({
    queryKey: ["roles"],
    queryFn: () => api.get<RoleRecord[]>("/roles"),
  });

  // Only show roles the actor can assign (level strictly below theirs)
  const assignableRoles = apiRoles.filter((r) => r.level < myLevel);

  const removeMut = useMutation({
    mutationFn: (email: string) =>
      api.delete(`/users/${encodeURIComponent(email)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      if (selectedUser?.email === removeMut.variables) setSelectedUser(null);
    },
  });

  const updateRoleMut = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.patch(`/users/${encodeURIComponent(email)}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const canEdit = (u: User) =>
    u.email !== me?.email &&
    (ROLE_LEVELS[u.role] ?? 0) < myLevel &&
    u.email !== "nicholasaweiner@gmail.com";

  const roleMap = new Map(apiRoles.map((r) => [r.name, r]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-sub">
          Invite team members — one action creates their portal account, whitelists
          their Minecraft IGN, generates a Tailscale invite, and sends a welcome email.
        </p>
        {canInvite && (
          <button
            onClick={() => setShowInvite(true)}
            className="btn-primary flex items-center gap-2 text-sm flex-shrink-0 ml-4"
            data-testid="invite-user-btn"
          >
            <UserPlus className="w-4 h-4" aria-hidden /> Invite Member
          </button>
        )}
      </div>

      {/* Unified invite portal */}
      {showInvite && <InvitePortal onClose={() => setShowInvite(false)} />}

      {/* User list + detail panel */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* List */}
        <div>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {[...users]
                .sort((a, b) => (ROLE_LEVELS[b.role] ?? 0) - (ROLE_LEVELS[a.role] ?? 0))
                .map((u) => {
                  const isPending = !u.google_sub;
                  const initials  = u.display_name.slice(0, 2).toUpperCase();
                  const roleData  = roleMap.get(u.role);
                  const avatarBg  = roleData?.color ?? ["#9B9EA6", "#36B37E", "#5B9BF0", "#FBBF24"][
                    Math.max(0, (ROLE_LEVELS[u.role] ?? 0) - 1)
                  ];
                  const isSelected = selectedUser?.email === u.email;

                  return (
                    <button
                      key={u.email}
                      onClick={() => setSelectedUser(isSelected ? null : u)}
                      className={`w-full text-left card flex items-center gap-3 transition-all ${
                        isSelected ? "ring-2 ring-[#5B9BF0]" : ""
                      }`}
                      data-testid="user-card"
                    >
                      {/* Avatar */}
                      <div
                        className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs"
                        style={{ backgroundColor: avatarBg }}
                      >
                        {u.avatar_url
                          ? <img src={u.avatar_url} className="w-9 h-9 rounded-full" alt="" />
                          : initials}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                            {u.display_name}
                          </span>
                          {u.email === me?.email && (
                            <span className="text-xs text-meta">(you)</span>
                          )}
                          <RoleBadge
                            role={u.role}
                            label={roleData?.label}
                            color={roleData?.color}
                          />
                          {isPending && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] dark:bg-[#3D2A00] dark:text-[#FCD34D]">
                              Pending sign-in
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">{u.email}</p>
                      </div>

                      <ChevronRight className="w-4 h-4 text-meta flex-shrink-0" aria-hidden />
                    </button>
                  );
                })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedUser && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                {selectedUser.display_name}
              </span>
              <button onClick={() => setSelectedUser(null)} aria-label="Close panel">
                <X className="w-4 h-4 text-meta" />
              </button>
            </div>
            <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">{selectedUser.email}</p>

            {/* Role assignment */}
            {canEdit(selectedUser) && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
                  Role
                </label>
                <div className="flex gap-2">
                  <select
                    value={stagedRole}
                    onChange={(e) => setStagedRole(e.target.value)}
                    className="flex-1 text-sm rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2"
                    aria-label={`Change role for ${selectedUser.display_name}`}
                  >
                    {assignableRoles.map((r) => (
                      <option key={r.name} value={r.name}>{r.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => updateRoleMut.mutate(
                      { email: selectedUser.email, role: stagedRole },
                      { onSuccess: () => setStagedRole(stagedRole) },
                    )}
                    disabled={stagedRole === selectedUser.role || updateRoleMut.isPending}
                    className="btn-primary text-sm px-3 disabled:opacity-40"
                  >
                    {updateRoleMut.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
                {stagedRole !== selectedUser.role && (
                  <p className="text-xs text-meta">
                    Changing from <span className="font-medium">{selectedUser.role}</span> to <span className="font-medium text-[#5B9BF0]">{stagedRole}</span>
                  </p>
                )}
              </div>
            )}

            {/* Permission overrides */}
            <UserOverridePanel
              email={selectedUser.email}
              roleName={selectedUser.role}
              canEdit={canOverrides}
            />

            {/* Tailscale invite */}
            {canInvite && (
              <TailscaleInvitePanel email={selectedUser.email} displayName={selectedUser.display_name} />
            )}

            {/* Remove user */}
            {canRemove && canEdit(selectedUser) && (
              <div className="pt-2 border-t border-[#D9D5D0] dark:border-[#363944]">
                <button
                  onClick={() => removeMut.mutate(selectedUser.email)}
                  disabled={removeMut.isPending}
                  className="btn-danger w-full text-sm"
                  data-testid="remove-user-btn"
                >
                  Remove from whitelist
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Minecraft Pairing tab ──────────────────────────────────────────────────────

function MCPairingTab() {
  const qc = useQueryClient();

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  const { data: mcPlayers = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn: () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  const activatedUsers = [...users]
    .filter((u) => u.google_sub)
    .sort((a, b) => (ROLE_LEVELS[b.role] ?? 0) - (ROLE_LEVELS[a.role] ?? 0));

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
        Link portal users to their Minecraft in-game names (IGNs).
        Players currently online are shown with a green dot.
        Pending (uninvited) users are excluded — they must sign in with Google first.
      </p>
      {activatedUsers.length === 0 ? (
        <p className="text-sm text-meta py-6 text-center">No activated users yet.</p>
      ) : (
        <div className="space-y-3">
          {activatedUsers.map((u) => (
            <UserPairingCard key={u.email} user={u} mcPlayers={mcPlayers} qc={qc} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pending Players tab ───────────────────────────────────────────────────────

function PendingPlayersTab() {
  const { hasPerm } = useAuthStore();
  const qc = useQueryClient();
  const canManage = hasPerm("players.pending.manage");
  const [approvingIgn, setApprovingIgn] = useState<string | null>(null);
  const [approveEmail, setApproveEmail] = useState("");
  const [error, setError] = useState("");

  const { data: pending = [], isLoading } = useQuery<PendingPlayer[]>({
    queryKey: ["pending-players"],
    queryFn: () => api.get("/players/pending"),
    refetchInterval: 15_000,
  });

  const { data: rejected = [], isLoading: rejectedLoading } = useQuery<PendingPlayer[]>({
    queryKey: ["rejected-players"],
    queryFn: () => api.get("/players/rejected"),
    refetchInterval: 30_000,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
    enabled: canManage,
  });

  const approveMut = useMutation({
    mutationFn: ({ ign, email }: { ign: string; email: string }) =>
      api.post(`/players/pending/${encodeURIComponent(ign)}/approve`, { email }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-players"] });
      setApprovingIgn(null);
      setApproveEmail("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: (ign: string) =>
      api.delete(`/players/pending/${encodeURIComponent(ign)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-players"] });
      qc.invalidateQueries({ queryKey: ["rejected-players"] });
    },
  });

  const reinstateMut = useMutation({
    mutationFn: (ign: string) =>
      api.post(`/players/rejected/${encodeURIComponent(ign)}/reinstate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-players"] });
      qc.invalidateQueries({ queryKey: ["rejected-players"] });
    },
  });

  const activatedUsers = users.filter((u) => u.google_sub);

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
        Players who connected over Tailscale for the first time. Their first session
        was allowed; subsequent attempts are blocked until linked to a team member.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : pending.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="text-sm text-meta">No pending players — the queue is clear.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((p) => (
            <div key={p.ign} className="card flex items-center gap-4">
              {/* Avatar */}
              <img
                src={`https://mc-heads.net/avatar/${p.ign}/36`}
                alt=""
                className="w-9 h-9 rounded-sm flex-shrink-0"
                loading="lazy"
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">{p.ign}</p>
                <p className="text-xs text-meta">
                  First seen {fmt(p.first_seen)}
                  {p.attempt_count > 1 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-[#FEF3C7] dark:bg-[#3D2A00] text-[#92400E] dark:text-[#FCD34D]">
                      {p.attempt_count - 1} blocked attempt{p.attempt_count > 2 ? "s" : ""}
                    </span>
                  )}
                </p>
              </div>

              {/* Actions */}
              {canManage && (
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setApprovingIgn(p.ign); setApproveEmail(""); setError(""); }}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectMut.mutate(p.ign)}
                    disabled={rejectMut.isPending}
                    className="btn-danger text-xs px-3 py-1.5"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Blocklist ── */}
      {(rejected.length > 0 || rejectedLoading) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-meta pt-2">
            Blocklist
          </p>
          <p className="text-xs text-meta">
            These players were rejected. Reinstate to move them back to the pending queue, or approve to link them directly.
          </p>
          {rejectedLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {rejected.map((p) => (
                <div key={p.ign} className="card flex items-center gap-4 opacity-75">
                  <img
                    src={`https://mc-heads.net/avatar/${p.ign}/36`}
                    alt=""
                    className="w-9 h-9 rounded-sm flex-shrink-0 grayscale"
                    loading="lazy"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">{p.ign}</p>
                    <p className="text-xs text-meta">
                      Last attempt {fmt(p.last_attempted)}
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-[#FEE2E2] dark:bg-[#3D0000] text-[#B91C1C] dark:text-[#FCA5A5]">
                        rejected
                      </span>
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => reinstateMut.mutate(p.ign)}
                        disabled={reinstateMut.isPending}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        Reinstate
                      </button>
                      <button
                        onClick={() => { setApprovingIgn(p.ign); setApproveEmail(""); setError(""); }}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Approve modal */}
      {approvingIgn && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          role="dialog"
          aria-modal
          aria-label={`Approve ${approvingIgn}`}
        >
          <div className="card max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                Approve <span className="font-mono">{approvingIgn}</span>
              </h2>
              <button onClick={() => setApprovingIgn(null)} aria-label="Close">
                <X className="w-4 h-4 text-meta" />
              </button>
            </div>
            <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
              Link this Minecraft account to a team member. They will be able to
              rejoin the server freely from now on.
            </p>
            <select
              value={approveEmail}
              onChange={(e) => { setApproveEmail(e.target.value); setError(""); }}
              className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm"
            >
              <option value="">— select a team member —</option>
              {activatedUsers.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.display_name} ({u.email})
                </option>
              ))}
            </select>
            {error && <p className="text-xs text-[#F87171]">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setApprovingIgn(null)} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                onClick={() => approveMut.mutate({ ign: approvingIgn, email: approveEmail })}
                disabled={!approveEmail || approveMut.isPending}
                className="btn-primary text-sm"
              >
                {approveMut.isPending ? "Approving…" : "Approve & Link"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MC Whitelist tab ──────────────────────────────────────────────────────────

interface WhitelistEntry { uuid: string; name: string; }

function MCWhitelistTab() {
  const qc = useQueryClient();
  const [ign, setIgn] = useState("");
  const [error, setError] = useState("");

  const { data: entries = [], isLoading } = useQuery<WhitelistEntry[]>({
    queryKey: ["mc-whitelist"],
    queryFn: () => api.get("/server/whitelist"),
    refetchInterval: 15_000,
  });

  const addMut = useMutation({
    mutationFn: (player: string) =>
      api.post("/server/whitelist/add", { player }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mc-whitelist"] });
      setIgn("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (player: string) =>
      api.post("/server/whitelist/remove", { player }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mc-whitelist"] }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
        Manage which Minecraft accounts can join the server.
        Requires a valid Mojang/Microsoft username. Changes take effect immediately.
      </p>

      {/* Add form */}
      <div className="card space-y-3">
        <label className="block text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
          Add player
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Minecraft username (e.g. Steve)"
            value={ign}
            onChange={(e) => { setIgn(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && ign.trim() && addMut.mutate(ign.trim())}
            className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
          />
          <button
            onClick={() => addMut.mutate(ign.trim())}
            disabled={!ign.trim() || addMut.isPending}
            className="btn-primary text-sm px-4"
          >
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
        </div>
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
      </div>

      {/* Current whitelist */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
            Whitelisted players
          </span>
          <span className="text-xs text-meta">{entries.length} total</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-meta py-4 text-center">
            Whitelist is empty — no players can join until you add them.
          </p>
        ) : (
          <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
            {entries.map((e) => (
              <div key={e.uuid} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-mono text-sm text-[#1C1E27] dark:text-[#EAECF0]">{e.name}</span>
                  <p className="text-xs text-meta font-mono">{e.uuid}</p>
                </div>
                <button
                  onClick={() => removeMut.mutate(e.name)}
                  disabled={removeMut.isPending && removeMut.variables === e.name}
                  className="p-1 text-meta hover:text-[#F87171] transition-colors"
                  aria-label={`Remove ${e.name} from whitelist`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TailscaleInvitePanel — send a device-share invite to an existing user ──

function TailscaleInvitePanel({
  email,
  displayName,
}: {
  email: string;
  displayName: string;
}) {
  const [result, setResult] = useState<TailscaleInviteResult | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.post<TailscaleInviteResult>(`/users/${encodeURIComponent(email)}/tailscale-invite`),
    onSuccess: (data) => {
      setResult(data);
      if (data.email_sent) toast.success(`Tailscale invite sent to ${email}`);
      else if (data.warnings.length) toast.info("Invite generated with warnings — check below");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="pt-3 border-t border-[#D9D5D0] dark:border-[#363944] space-y-3">
      <div>
        <span className="text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
          Tailscale Access
        </span>
        <p className="text-xs text-meta mt-0.5">
          Sends mc-server-1 as a shared device — user stays on their own Tailscale account
          and sees no other devices.
        </p>
      </div>

      {/* Result */}
      {result && (
        <div className="rounded-xl bg-[#F7F5F2] dark:bg-[#2A2D38] p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <StatusChipSmall ok={!!result.tailscale_invite_url} label="Invite generated" />
            <StatusChipSmall ok={result.email_sent} label="Email sent" />
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-warn">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden />
              {w}
            </p>
          ))}
        </div>
      )}

      <button
        onClick={() => { setResult(null); mut.mutate(); }}
        disabled={mut.isPending}
        className="w-full flex items-center justify-center gap-2 btn-secondary text-sm py-2"
        aria-label={`Send Tailscale invite to ${displayName}`}
      >
        {mut.isPending
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Sending…</>
          : result?.email_sent
          ? <><CheckCircle2 className="w-3.5 h-3.5 text-[#36B37E]" aria-hidden /> Resend Tailscale Invite</>
          : <><Send className="w-3.5 h-3.5" aria-hidden /> Send Tailscale Invite</>}
      </button>
    </div>
  );
}

function StatusChipSmall({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
      ok
        ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#36B37E]"
        : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-meta line-through"
    }`}>
      {ok && <CheckCircle2 className="w-2.5 h-2.5" aria-hidden />}
      {label}
    </span>
  );
}

function UserPairingCard({
  user,
  mcPlayers,
  qc,
}: {
  user: User;
  mcPlayers: McPlayer[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [newIgn, setNewIgn] = useState("");

  const { data: links = [] } = useQuery<PlayerLink[]>({
    queryKey: ["players", user.email],
    queryFn: () => api.get(`/users/${encodeURIComponent(user.email)}/players`),
  });

  const addMut = useMutation({
    mutationFn: () =>
      api.put(`/users/${encodeURIComponent(user.email)}/players`, {
        igns: [...links.map((l) => l.ign), newIgn.trim()],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["players", user.email] });
      setNewIgn("");
    },
  });

  const removeMut = useMutation({
    mutationFn: (ign: string) =>
      api.delete(
        `/users/${encodeURIComponent(user.email)}/players/${encodeURIComponent(ign)}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players", user.email] }),
  });

  const initials  = user.display_name.slice(0, 2).toUpperCase();
  const avatarBg  = ["#9B9EA6", "#36B37E", "#5B9BF0", "#FBBF24"][
    Math.max(0, (ROLE_LEVELS[user.role] ?? 0) - 1)
  ];
  const linked     = new Set(links.map((l) => l.ign));
  const suggestions = mcPlayers.filter((p) => !linked.has(p.ign));

  return (
    <div className="card space-y-3" data-testid="pairing-card">
      {/* User header */}
      <div className="flex items-center gap-3">
        <div
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs"
          style={{ backgroundColor: avatarBg }}
        >
          {user.avatar_url
            ? <img src={user.avatar_url} className="w-9 h-9 rounded-full" alt="" />
            : initials}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            {user.display_name}
          </span>
          <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">{user.email}</p>
        </div>
        <RoleBadge role={user.role} />
      </div>

      {/* Current links */}
      <div className="flex flex-wrap gap-2">
        {links.map((link) => {
          const online = mcPlayers.find((p) => p.ign === link.ign)?.online ?? false;
          return (
            <div
              key={link.ign}
              className="flex items-center gap-1.5 bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg px-2 py-1 text-xs"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`} />
              <span className="font-mono text-[#1C1E27] dark:text-[#EAECF0]">{link.ign}</span>
              <button
                onClick={() => removeMut.mutate(link.ign)}
                aria-label={`Unlink ${link.ign}`}
                className="text-[#F87171] hover:text-red-600 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
        {links.length === 0 && (
          <span className="text-xs text-meta">⛏ No linked players</span>
        )}
      </div>

      {/* Add new IGN */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="IGN (e.g. Steve)"
            value={newIgn}
            onChange={(e) => setNewIgn(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newIgn.trim() && addMut.mutate()}
            list={`suggestions-${user.email}`}
            className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
          />
          {suggestions.length > 0 && (
            <datalist id={`suggestions-${user.email}`}>
              {suggestions.map((p) => (
                <option key={p.ign} value={p.ign} />
              ))}
            </datalist>
          )}
        </div>
        <button
          onClick={() => addMut.mutate()}
          disabled={!newIgn.trim() || addMut.isPending}
          className="btn-primary text-sm px-3"
          aria-label="Link IGN"
          data-testid="link-ign-btn"
        >
          <Link className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

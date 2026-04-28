import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { UserPlus, X, Link, Users, Pickaxe, ShieldCheck } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { RoleBadge } from "@/components/Badge";
import { PermissionsPage } from "./PermissionsPage";
import type { User, PlayerLink, McPlayer, Role } from "@/types";
import { ROLE_LABELS, ROLE_LEVELS } from "@/types";

type Tab = "users" | "pairing" | "permissions";

// ── AdminPage ──────────────────────────────────────────────────────────────────

export function AdminPage() {
  const { hasPerm } = useAuthStore();
  const [tab, setTab] = useState<Tab>("users");

  const canManage   = hasPerm("users.invite") || hasPerm("users.remove");
  const canEditPerms = hasPerm("users.permissions.edit");

  const tabs = [
    { id: "users" as Tab,       label: "Users",              Icon: Users,       show: canManage },
    { id: "pairing" as Tab,     label: "Minecraft Pairing",  Icon: Pickaxe,     show: canManage },
    { id: "permissions" as Tab, label: "Permissions",         Icon: ShieldCheck, show: canEditPerms },
  ].filter((t) => t.show);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Admin Settings</h1>
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          Manage users, Minecraft accounts, and role permissions
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[#D9D5D0] dark:border-[#363944]">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            data-testid={`tab-${id}`}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? "border-[#5B9BF0] text-[#5B9BF0]"
                : "border-transparent text-[#6B6E78] dark:text-[#9BA0B0] hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {tab === "users"       && <UsersTab />}
      {tab === "pairing"     && <MCPairingTab />}
      {tab === "permissions" && <PermissionsPage />}
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const { user: me } = useAuthStore();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [error, setError] = useState("");

  const myLevel = ROLE_LEVELS[me?.role ?? "user"] ?? 1;

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  const inviteMut = useMutation({
    mutationFn: () => api.post("/users", { email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setShowInvite(false);
      setInviteEmail("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (email: string) =>
      api.delete(`/users/${encodeURIComponent(email)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const updateRoleMut = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.patch(`/users/${encodeURIComponent(email)}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const canEdit = (u: User) =>
    u.email !== me?.email &&
    (ROLE_LEVELS[u.role] ?? 0) < myLevel &&
    u.email !== "admin@example.com";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          Invite users by email. They sign in with their Google account to activate access.
        </p>
        <button
          onClick={() => setShowInvite(true)}
          className="btn-primary flex items-center gap-2 text-sm"
          data-testid="invite-user-btn"
        >
          <UserPlus className="w-4 h-4" aria-hidden /> Invite User
        </button>
      </div>

      {/* Invite dialog */}
      {showInvite && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          role="dialog"
          aria-modal
          aria-label="Invite user"
        >
          <div className="card max-w-md w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                Invite a user
              </h2>
              <button onClick={() => setShowInvite(false)} aria-label="Close">
                <X className="w-4 h-4 text-[#9B9EA6]" />
              </button>
            </div>
            <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
              Enter their Gmail address. They sign in with that Google account once added.
            </p>
            <div className="space-y-3">
              <input
                type="email"
                placeholder="user@gmail.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm"
              >
                {(Object.entries(ROLE_LABELS) as [Role, string][])
                  .filter(([r]) => (ROLE_LEVELS[r] ?? 0) < myLevel)
                  .map(([r, l]) => (
                    <option key={r} value={r}>{l}</option>
                  ))}
              </select>
              {error && <p className="text-xs text-[#F87171]">{error}</p>}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowInvite(false)} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                onClick={() => inviteMut.mutate()}
                disabled={!inviteEmail.includes("@") || inviteMut.isPending}
                className="btn-primary text-sm"
              >
                {inviteMut.isPending ? "Inviting…" : "Send Invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User list */}
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
              const editable  = canEdit(u);
              const avatarBg  = ["#9B9EA6", "#36B37E", "#5B9BF0", "#FBBF24"][
                Math.max(0, (ROLE_LEVELS[u.role] ?? 0) - 1)
              ];
              return (
                <div key={u.email} className="card flex items-center gap-3" data-testid="user-card">
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
                        <span className="text-xs text-[#9B9EA6]">(you)</span>
                      )}
                      <RoleBadge role={u.role} />
                      {isPending && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] dark:bg-[#3D2A00] dark:text-[#FCD34D]">
                          Pending sign-in
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#6B6E78] dark:text-[#9BA0B0]">{u.email}</p>
                  </div>

                  {/* Role selector */}
                  {editable && (
                    <select
                      value={u.role}
                      onChange={(e) =>
                        updateRoleMut.mutate({ email: u.email, role: e.target.value })
                      }
                      className="text-xs rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-2 py-1"
                      aria-label={`Change role for ${u.display_name}`}
                    >
                      {(Object.entries(ROLE_LABELS) as [Role, string][])
                        .filter(([r]) => (ROLE_LEVELS[r] ?? 0) < myLevel)
                        .map(([r, l]) => (
                          <option key={r} value={r}>{l}</option>
                        ))}
                    </select>
                  )}

                  {/* Remove */}
                  {editable && (
                    <button
                      onClick={() => removeMut.mutate(u.email)}
                      disabled={removeMut.isPending}
                      className="btn-danger text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
        </div>
      )}
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
      <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
        Link portal users to their Minecraft in-game names (IGNs).
        Players currently online are shown with a green dot.
        Pending (uninvited) users are excluded — they must sign in with Google first.
      </p>
      {activatedUsers.length === 0 ? (
        <p className="text-sm text-[#9B9EA6] py-6 text-center">No activated users yet.</p>
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
          <p className="text-xs text-[#6B6E78] dark:text-[#9BA0B0]">{user.email}</p>
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
          <span className="text-xs text-[#9B9EA6]">⛏ No linked players</span>
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

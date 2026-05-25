import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RefreshCw, UserMinus, MapPin, MapPinOff, Compass } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { RoleBadge } from "@/components/Badge";
import { toast } from "@/components/Toast";
import { PartiesCard } from "./PartiesCard";
import type { User, PlayerLink, McPlayer, Gamemode } from "@/types";
import { ROLE_LEVELS } from "@/types";

// ── Pin HUD hook ──────────────────────────────────────────────────────────────

interface PinHudStatus { ign: string; show_team: boolean; show_private: boolean; show_events: boolean; }

function usePinHud(ign: string, canAccess: boolean) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<PinHudStatus>({
    queryKey: ["pin-hud", ign],
    queryFn:  () => api.get(`/players/${encodeURIComponent(ign)}/pin-hud`),
    enabled:  canAccess,
    retry:    false,
    staleTime: 30_000,
  });
  const updateMut = useMutation({
    mutationFn: (body: { show_team: boolean; show_private: boolean; show_events: boolean }) =>
      api.put(`/players/${encodeURIComponent(ign)}/pin-hud`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pin-hud", ign] }),
  });
  return {
    data,
    isLoading,
    update: updateMut.mutate,
    isPending: updateMut.isPending,
  };
}

// ── Coord display hook ────────────────────────────────────────────────────────

interface CoordStatus { enabled: boolean; online: boolean; ign: string; }

function useCoordDisplay(ign: string, canAccess: boolean) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CoordStatus>({
    queryKey: ["coord-display", ign],
    queryFn:  () => api.get(`/players/${encodeURIComponent(ign)}/coord-display`),
    enabled:  canAccess,
    retry:    false,
    staleTime: 30_000,
  });
  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) =>
      api.post(`/players/${encodeURIComponent(ign)}/coord-display`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coord-display", ign] }),
  });
  return { data, isLoading, toggle: (v: boolean) => toggleMut.mutate(v), isPending: toggleMut.isPending };
}

const GAMEMODES: Gamemode[] = ["survival", "creative", "adventure", "spectator"];
const GM_ICONS: Record<Gamemode, string> = { survival: "⚔️", creative: "✨", adventure: "🧭", spectator: "👁" };

export function TeamPage() {
  const { user: me, hasPerm } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const canRemove    = hasPerm("users.remove");
  const myLevel      = ROLE_LEVELS[me?.role ?? "visitor"] ?? 0;
  const isGlobalAdmin = me?.role === "global_admin";

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  const { data: mcPlayers = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn: () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.display_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Team</h1>
        <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
          See who's on the team and manage your linked Minecraft accounts
        </p>
      </div>

      {/* Search + refresh */}
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
        />
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["users", "mc-players"] })}
          className="btn-secondary p-2"
          aria-label="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* User cards */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered
            .sort((a, b) => (ROLE_LEVELS[b.role] ?? 0) - (ROLE_LEVELS[a.role] ?? 0))
            .map((u) => (
              <UserCard
                key={u.email}
                user={u}
                mcPlayers={mcPlayers}
                me={me?.email ?? ""}
                myLevel={myLevel}
                canRemove={canRemove}
                isGlobalAdmin={isGlobalAdmin}
                qc={qc}
              />
            ))}
        </div>
      )}

      {/* Parties — quick-select groups for events, music zones, lobbies */}
      <PartiesCard />
    </div>
  );
}

function PinHudToggle({ ign, isSelf, canAdmin }: { ign: string; isSelf: boolean; canAdmin: boolean }) {
  const canAccess = isSelf || canAdmin;
  const { data, isLoading, update, isPending } = usePinHud(ign, canAccess);
  const [open, setOpen]  = useState(false);

  if (!canAccess) return null;
  if (isLoading)  return <span className="text-[9px] text-meta ml-1">…</span>;

  const showTeam    = data?.show_team    ?? false;
  const showPrivate = data?.show_private ?? false;
  const showEvents  = data?.show_events  ?? false;
  const on          = showTeam || showPrivate || showEvents;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        title={on ? "Pin HUD: ON — click to configure" : "Pin HUD: OFF — click to enable"}
        aria-label={`${ign} pin HUD ${on ? "on" : "off"}`}
        aria-expanded={open}
        className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium
                    transition-colors disabled:opacity-40 ${
          on
            ? "bg-[#E0E7FF] dark:bg-[#1E3A5F] text-[#5B9BF0] hover:bg-[#C7D2FE]"
            : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-meta hover:bg-[#E5E0DB] dark:hover:bg-[#363944]"
        }`}
      >
        <Compass className="w-2.5 h-2.5" />
        <span>PIN</span>
      </button>

      {open && (
        <>
          {/* Click-outside scrim */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={`Pin HUD prefs for ${ign}`}
            className="absolute right-0 top-full mt-1 z-40 w-44 p-2 space-y-1.5
                       rounded-lg shadow-lg border border-[#D9D5D0] dark:border-[#363944]
                       bg-white dark:bg-[#1C1E27]"
          >
            <p className="text-[10px] uppercase tracking-wider text-meta font-medium px-1">
              Show nearest pin
            </p>
            <label className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] cursor-pointer text-xs text-[#1C1E27] dark:text-[#EAECF0]">
              <input
                type="checkbox"
                checked={showTeam}
                onChange={(e) => update({ show_team: e.target.checked, show_private: showPrivate, show_events: showEvents })}
                disabled={isPending}
                className="accent-[#5B9BF0]"
              />
              Public (team) pins
            </label>
            <label className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] cursor-pointer text-xs text-[#1C1E27] dark:text-[#EAECF0]">
              <input
                type="checkbox"
                checked={showPrivate}
                onChange={(e) => update({ show_team: showTeam, show_private: e.target.checked, show_events: showEvents })}
                disabled={isPending}
                className="accent-[#5B9BF0]"
              />
              My private pins
            </label>
            <label className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] cursor-pointer text-xs text-[#1C1E27] dark:text-[#EAECF0]">
              <input
                type="checkbox"
                checked={showEvents}
                onChange={(e) => update({ show_team: showTeam, show_private: showPrivate, show_events: e.target.checked })}
                disabled={isPending}
                className="accent-[#5B9BF0]"
              />
              Active events
            </label>
            <p className="text-[9px] text-meta px-1 pt-1 border-t border-[#D9D5D0] dark:border-[#363944]">
              Shown in-game above your hotbar with distance. Events = rising oceans + launched lobbies.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function CoordToggleButton({ ign, isSelf, canAdmin }: { ign: string; isSelf: boolean; canAdmin: boolean }) {
  const canAccess = isSelf || canAdmin;
  const { data, isLoading, toggle, isPending } = useCoordDisplay(ign, canAccess);
  const canToggle = isSelf || canAdmin;

  if (!canAccess) return null;
  if (isLoading) return <span className="text-[9px] text-meta ml-1">…</span>;

  const on = data?.enabled ?? false;
  return (
    <button
      onClick={() => canToggle && toggle(!on)}
      disabled={isPending || !canToggle}
      title={on ? "Coords HUD: ON — click to turn off" : "Coords HUD: OFF — click to turn on"}
      aria-label={`${ign} coordinate display ${on ? "on" : "off"}`}
      className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium
                  transition-colors disabled:opacity-40 ${
        on
          ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#36B37E] hover:bg-[#D1FAE5]"
          : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-meta hover:bg-[#E5E0DB] dark:hover:bg-[#363944]"
      }`}
    >
      {on
        ? <MapPin    className="w-2.5 h-2.5" />
        : <MapPinOff className="w-2.5 h-2.5" />}
      <span>{on ? "XYZ" : "XYZ"}</span>
    </button>
  );
}

function UserCard({
  user,
  mcPlayers,
  me,
  myLevel,
  canRemove,
  isGlobalAdmin,
  qc,
}: {
  user: User;
  mcPlayers: McPlayer[];
  me: string;
  myLevel: number;
  canRemove: boolean;
  isGlobalAdmin: boolean;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: links = [] } = useQuery<PlayerLink[]>({
    queryKey: ["players", user.email],
    queryFn: () => api.get(`/users/${encodeURIComponent(user.email)}/players`),
  });

  const gmMut = useMutation({
    mutationFn: ({ ign, gamemode }: { ign: string; gamemode: string }) =>
      api.patch<{ saved: boolean; applied: boolean }>(
        `/users/${encodeURIComponent(user.email)}/players/${encodeURIComponent(ign)}/gamemode`,
        { gamemode },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["players", user.email] });
      if (res.applied) {
        toast.success("Gamemode updated in-game.");
      } else {
        toast.info("Gamemode saved — join the server to apply it.");
      }
    },
    onError: () => toast.error("Failed to update gamemode."),
  });

  const unlinkMut = useMutation({
    mutationFn: (ign: string) =>
      api.delete(
        `/users/${encodeURIComponent(user.email)}/players/${encodeURIComponent(ign)}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players", user.email] }),
  });

  const removeMut = useMutation({
    mutationFn: () => api.delete(`/users/${encodeURIComponent(user.email)}`),
    onSuccess: () => {
      setConfirmRemove(false);
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const isSelf      = user.email === me;
  const targetLevel = ROLE_LEVELS[user.role] ?? 0;
  // Show remove button only when the actor has permission, isn't targeting
  // themselves, and outranks the target (global_admin bypasses the level check).
  const showRemove  = canRemove && !isSelf && (isGlobalAdmin || targetLevel < myLevel);

  const initials = user.display_name.slice(0, 2).toUpperCase();
  const avatarBg = ["#9B9EA6", "#36B37E", "#5B9BF0", "#FBBF24"][
    Math.max(0, (ROLE_LEVELS[user.role] ?? 0) - 1)
  ];

  return (
    <>
      {/* Remove confirmation dialog */}
      {confirmRemove && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="alertdialog">
          <div className="card max-w-sm w-full mx-4 space-y-4">
            <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
              Remove {user.display_name}?
            </h2>
            <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
              This will revoke their access immediately. Their linked Minecraft accounts will also be unlinked. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmRemove(false)} className="btn-secondary text-sm">Cancel</button>
              <button
                onClick={() => removeMut.mutate()}
                disabled={removeMut.isPending}
                className="btn-danger text-sm"
              >
                {removeMut.isPending ? "Removing…" : "Yes, Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card flex gap-4">
        {/* Avatar */}
        <div
          className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm"
          style={{ backgroundColor: avatarBg }}
        >
          {user.avatar_url
            ? <img src={user.avatar_url} className="w-11 h-11 rounded-full" alt="" />
            : initials}
        </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            {user.display_name}
          </span>
          {isSelf && <span className="text-xs text-meta">(you)</span>}
          <RoleBadge role={user.role} />
        </div>
        <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">{user.email}</p>

        {/* Player links — self-service gamemode + unlink */}
        <div className="flex flex-wrap gap-2 mt-1">
          {links.map((link) => {
            const online = mcPlayers.find((p) => p.ign === link.ign)?.online ?? false;
            return (
              <div
                key={link.ign}
                className="flex items-center gap-1.5 bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg px-2 py-1 text-xs"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${online ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`}
                />
                <span className="font-mono text-[#1C1E27] dark:text-[#EAECF0]">
                  {link.ign}
                </span>
                <span className="text-meta">{GM_ICONS[link.gamemode]}</span>
                <CoordToggleButton
                  ign={link.ign}
                  isSelf={isSelf}
                  canAdmin={isGlobalAdmin || (ROLE_LEVELS[user.role] ?? 0) < myLevel}
                />
                <PinHudToggle
                  ign={link.ign}
                  isSelf={isSelf}
                  canAdmin={isGlobalAdmin || (ROLE_LEVELS[user.role] ?? 0) < myLevel}
                />
                {(isSelf || isGlobalAdmin || targetLevel < myLevel) && (
                  <select
                    value={link.gamemode}
                    onChange={(e) =>
                      gmMut.mutate({ ign: link.ign, gamemode: e.target.value })
                    }
                    disabled={gmMut.isPending}
                    className="text-xs bg-transparent text-meta focus:outline-none disabled:opacity-50"
                    aria-label={`${link.ign} gamemode`}
                  >
                    {GAMEMODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}
                {isSelf && (
                  <button
                    onClick={() => unlinkMut.mutate(link.ign)}
                    aria-label={`Unlink ${link.ign}`}
                    className="text-[#F87171] hover:text-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          {links.length === 0 && (
            <span className="text-xs text-meta">⛏ No linked players</span>
          )}
        </div>
      </div>

      {/* Remove button */}
      {showRemove && (
        <button
          onClick={() => setConfirmRemove(true)}
          title={`Remove ${user.display_name} from the team`}
          className="flex-shrink-0 self-start p-1.5 rounded hover:bg-[#FEE2E2] dark:hover:bg-[#3B1F1F] text-meta hover:text-[#F87171] transition-colors"
        >
          <UserMinus className="w-4 h-4" />
        </button>
      )}
      </div>
    </>
  );
}

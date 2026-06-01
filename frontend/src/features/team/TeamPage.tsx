import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RefreshCw, UserMinus, MapPin, MapPinOff, Compass, Tag } from "lucide-react";
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
    <div className="page">
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
          className="flex-1 h-11 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
        />
        <button
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["users"] });
            qc.invalidateQueries({ queryKey: ["mc-players"] });
          }}
          className="icon-btn flex-shrink-0"
          aria-label="Refresh team list"
          title="Refresh"
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

// ── Action chip styling ──────────────────────────────────────────────────────
//
// All inline action buttons (PIN, XYZ) share these classes so the row looks
// consistent and every target meets the 32×32 px minimum tap recommendation
// from Apple HIG / Material Design.
const CHIP_BASE =
  "inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-semibold " +
  "transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-1";

function PinHudToggle({ ign, isSelf, canAdmin }: { ign: string; isSelf: boolean; canAdmin: boolean }) {
  const canAccess = isSelf || canAdmin;
  const { data, isLoading, update, isPending } = usePinHud(ign, canAccess);
  const [open, setOpen]  = useState(false);

  if (!canAccess) return null;
  if (isLoading)  return <span className="text-[10px] text-meta ml-1">…</span>;

  const showTeam    = data?.show_team    ?? false;
  const showPrivate = data?.show_private ?? false;
  const showEvents  = data?.show_events  ?? false;
  const on          = showTeam || showPrivate || showEvents;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        title={on ? "Pin HUD: ON — tap to configure" : "Pin HUD: OFF — tap to enable"}
        aria-label={`${ign} pin HUD ${on ? "on" : "off"}`}
        aria-expanded={open}
        className={`${CHIP_BASE} ${
          on
            ? "bg-[#E0E7FF] dark:bg-[#1E3A5F] text-[#3B7DD8] dark:text-[#9CC1F5] hover:bg-[#C7D2FE] dark:hover:bg-[#264A75]"
            : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#A8AEBB] hover:bg-[#E5E0DB] dark:hover:bg-[#363944]"
        }`}
      >
        <Compass className="w-3.5 h-3.5" />
        <span>PIN</span>
      </button>

      {open && (
        <>
          {/* Scrim — darker on mobile (modal-ish), invisible on desktop */}
          <div
            className="fixed inset-0 z-30 bg-black/30 sm:bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={`Pin HUD prefs for ${ign}`}
            className="
              fixed inset-x-4 bottom-4 z-40 max-w-sm mx-auto p-3 space-y-2
              sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full
              sm:mt-2 sm:mx-0 sm:w-56 sm:p-2
              rounded-xl shadow-xl border border-[#D9D5D0] dark:border-[#363944]
              bg-white dark:bg-[#1C1E27]
            "
          >
            <p className="text-[10px] uppercase tracking-wider text-meta font-semibold px-1">
              Show nearest pin
            </p>
            <PinHudOption
              checked={showTeam}
              onChange={(v) => update({ show_team: v, show_private: showPrivate, show_events: showEvents })}
              disabled={isPending}
              label="Public (team) pins"
            />
            <PinHudOption
              checked={showPrivate}
              onChange={(v) => update({ show_team: showTeam, show_private: v, show_events: showEvents })}
              disabled={isPending}
              label="My private pins"
            />
            <PinHudOption
              checked={showEvents}
              onChange={(v) => update({ show_team: showTeam, show_private: showPrivate, show_events: v })}
              disabled={isPending}
              label="Active events"
            />
            <p className="text-[10px] leading-snug text-meta px-1 pt-2 border-t border-[#D9D5D0] dark:border-[#363944]">
              Shown in-game above your hotbar with distance. Events = rising oceans + launched lobbies.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function PinHudOption({
  checked, onChange, disabled, label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 px-1 py-2 sm:py-1 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] cursor-pointer text-sm sm:text-xs text-[#1C1E27] dark:text-[#EAECF0]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="accent-[#5B9BF0] w-4 h-4"
      />
      {label}
    </label>
  );
}

function CoordToggleButton({ ign, isSelf, canAdmin }: { ign: string; isSelf: boolean; canAdmin: boolean }) {
  const canAccess = isSelf || canAdmin;
  const { data, isLoading, toggle, isPending } = useCoordDisplay(ign, canAccess);

  if (!canAccess) return null;
  if (isLoading) return <span className="text-[10px] text-meta ml-1">…</span>;

  const on = data?.enabled ?? false;
  return (
    <button
      onClick={() => toggle(!on)}
      disabled={isPending}
      title={on ? "Coords HUD: ON — tap to turn off" : "Coords HUD: OFF — tap to turn on"}
      aria-label={`${ign} coordinate display ${on ? "on" : "off"}`}
      className={`${CHIP_BASE} ${
        on
          ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#0E8A57] dark:text-[#6EE7B7] hover:bg-[#D1FAE5] dark:hover:bg-[#0A3F2D]"
          : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#A8AEBB] hover:bg-[#E5E0DB] dark:hover:bg-[#363944]"
      }`}
    >
      {on
        ? <MapPin    className="w-3.5 h-3.5" />
        : <MapPinOff className="w-3.5 h-3.5" />}
      <span>XYZ</span>
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
  const canAdmin    = isGlobalAdmin || targetLevel < myLevel;
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="alertdialog">
          <div className="card max-w-sm w-full space-y-4">
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

      <div className="card space-y-3">
        {/* ── Header: avatar + identity + remove ───────────────────────── */}
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: avatarBg }}
          >
            {user.avatar_url
              ? <img src={user.avatar_url} className="w-11 h-11 rounded-full" alt="" />
              : initials}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                {user.display_name}
              </span>
              {isSelf && <span className="text-xs text-meta">(you)</span>}
              <RoleBadge role={user.role} />
            </div>
            <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB] truncate">
              {user.email}
            </p>
          </div>

          {showRemove && (
            <button
              onClick={() => setConfirmRemove(true)}
              title={`Remove ${user.display_name} from the team`}
              aria-label={`Remove ${user.display_name}`}
              className="icon-btn-danger flex-shrink-0 w-9 h-9 min-w-0 min-h-0 sm:min-w-[44px] sm:min-h-[44px]"
            >
              <UserMinus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Linked players ────────────────────────────────────────────── */}
        {links.length === 0 ? (
          <p className="text-xs text-meta pl-14">⛏ No linked players</p>
        ) : (
          <div className="space-y-2 sm:pl-14">
            {links.map((link) => {
              const online = mcPlayers.find((p) => p.ign === link.ign)?.online ?? false;
              const canChangeGm = isSelf || isGlobalAdmin || targetLevel < myLevel;
              return (
                <PlayerLinkRow
                  key={link.ign}
                  ign={link.ign}
                  gamemode={link.gamemode}
                  online={online}
                  isSelf={isSelf}
                  canAdmin={canAdmin}
                  canChangeGm={canChangeGm}
                  onChangeGm={(gm) => gmMut.mutate({ ign: link.ign, gamemode: gm })}
                  onUnlink={() => unlinkMut.mutate(link.ign)}
                  gmPending={gmMut.isPending}
                />
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ── Player link row ──────────────────────────────────────────────────────────
//
// Each linked player gets its own row.  On mobile the row is a stacked panel:
// IGN on top, action chips wrap below — no more squeezing 5 controls into one
// 10-px-tall pill.  On sm:+ it lays out horizontally as a single line.

function PlayerLinkRow({
  ign, gamemode, online,
  isSelf, canAdmin, canChangeGm,
  onChangeGm, onUnlink, gmPending,
}: {
  ign:         string;
  gamemode:    Gamemode;
  online:      boolean;
  isSelf:      boolean;
  canAdmin:    boolean;
  canChangeGm: boolean;
  onChangeGm:  (gm: string) => void;
  onUnlink:    () => void;
  gmPending:   boolean;
}) {
  return (
    <div className="rounded-lg bg-[#F0EDE9] dark:bg-[#2A2D38] px-3 py-2.5 space-y-2">
      {/* Top row: IGN + chips */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        {/* IGN + online dot + gamemode glyph */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${online ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`}
            aria-label={online ? "Online" : "Offline"}
          />
          <span className="font-mono text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
            {ign}
          </span>
          <span className="text-sm" aria-label={`Gamemode ${gamemode}`}>
            {GM_ICONS[gamemode]}
          </span>
        </div>

        {/* Action chips */}
        <div className="flex items-center gap-1.5 flex-wrap sm:ml-auto sm:flex-nowrap">
          <CoordToggleButton ign={ign} isSelf={isSelf} canAdmin={canAdmin} />
          <PinHudToggle      ign={ign} isSelf={isSelf} canAdmin={canAdmin} />
          {canChangeGm && (
            <select
              value={gamemode}
              onChange={(e) => onChangeGm(e.target.value)}
              disabled={gmPending}
              aria-label={`${ign} gamemode`}
              className="h-8 rounded-md bg-white dark:bg-[#1C1E27] border border-[#D9D5D0] dark:border-[#363944] text-xs text-[#1C1E27] dark:text-[#EAECF0] px-2 focus:outline-none focus:ring-1 focus:ring-[#5B9BF0] disabled:opacity-50"
            >
              {GAMEMODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
          {isSelf && (
            <button
              onClick={onUnlink}
              aria-label={`Unlink ${ign}`}
              title={`Unlink ${ign}`}
              className="h-8 w-8 flex items-center justify-center rounded-md text-[#F87171] hover:bg-[#FEE2E2] dark:hover:bg-[#3B1F1F] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Alias row — visible to self and admins */}
      {(isSelf || canAdmin) && (
        <AliasEditor ign={ign} />
      )}
    </div>
  );
}

// ── Alias editor ─────────────────────────────────────────────────────────────
//
// Small inline form that lets a player set their in-game display name.
// Shows the current alias (if any), an editable input, and save/clear buttons.
// Also shows the in-game command hint for convenience.

interface AliasResponse { ign: string; alias: string | null; }

function AliasEditor({ ign }: { ign: string }) {
  const qc = useQueryClient();

  const { data } = useQuery<AliasResponse>({
    queryKey:  ["alias", ign],
    queryFn:   () => api.get(`/players/${encodeURIComponent(ign)}/alias`),
    staleTime: 30_000,
    retry:     false,
  });

  const currentAlias = data?.alias ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync draft when alias data loads (only on first load, not on re-focus)
  useEffect(() => {
    if (draft === null && data !== undefined) {
      setDraft(currentAlias ?? "");
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMut = useMutation({
    mutationFn: (alias: string) =>
      api.put(`/players/${encodeURIComponent(ign)}/alias`, { alias }),
    onSuccess: (res: AliasResponse) => {
      qc.setQueryData(["alias", ign], res);
      toast.success(`Alias set to "${res.alias}" — changes in-game on next join`);
    },
    onError: () => toast.error("Failed to set alias"),
  });

  const clearMut = useMutation({
    mutationFn: () => api.delete(`/players/${encodeURIComponent(ign)}/alias`),
    onSuccess: () => {
      qc.setQueryData(["alias", ign], { ign, alias: null });
      setDraft("");
      toast.success("Alias removed — Minecraft name will be shown");
    },
    onError: () => toast.error("Failed to clear alias"),
  });

  const value  = draft ?? currentAlias ?? "";
  const dirty  = value.trim() !== (currentAlias ?? "").trim();
  const saving = setMut.isPending || clearMut.isPending;

  const handleSave = () => {
    const trimmed = value.trim();
    if (!trimmed) {
      clearMut.mutate();
    } else {
      setMut.mutate(trimmed);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Tag className="w-3.5 h-3.5 text-meta flex-shrink-0" aria-hidden />
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <input
          ref={inputRef}
          type="text"
          maxLength={32}
          placeholder={`Alias (or /alias <name> in-game)`}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
          disabled={saving}
          aria-label={`Alias for ${ign}`}
          className="flex-1 min-w-0 h-7 rounded-md bg-white dark:bg-[#1C1E27] border border-[#D9D5D0] dark:border-[#363944] text-xs text-[#1C1E27] dark:text-[#EAECF0] px-2 placeholder-[#9B9EA6] focus:outline-none focus:ring-1 focus:ring-[#5B9BF0] disabled:opacity-50"
        />
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            title="Save alias"
            className="h-7 px-2.5 rounded-md bg-[#5B9BF0] text-white text-xs font-medium hover:bg-[#4080D8] disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {saving ? "…" : "Save"}
          </button>
        )}
        {currentAlias && !dirty && (
          <button
            onClick={() => clearMut.mutate()}
            disabled={saving}
            title="Remove alias"
            className="h-7 px-2 rounded-md text-[#9B9EA6] hover:text-[#F87171] hover:bg-[#FEE2E2] dark:hover:bg-[#3B1F1F] text-xs transition-colors flex-shrink-0"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

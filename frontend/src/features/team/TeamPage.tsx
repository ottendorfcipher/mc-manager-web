/**
 * Team page — redstoneCipher
 *
 * UX principles:
 *  • NNG #1 Visibility: online players are immediately visually distinct
 *    from offline — green pulse dot, MC head, health bar.
 *  • Gestalt similarity: all online cards share the same green accent;
 *    offline cards are muted — no label needed, the visual does it.
 *  • Progressive disclosure: player settings (gamemode, PIN HUD, XYZ,
 *    alias) live inside an expand/collapse per player row so the default
 *    view is scannable at a glance without drowning in controls.
 *  • Fitts's Law: the expand button is the whole player row.
 *  • KLM-GOMS: the primary mental model ("who's online?") requires 0 clicks.
 *  • Recognition > recall: MC head avatars + name, not just text.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, RefreshCw, UserMinus, MapPin, MapPinOff, Compass, Tag,
  ChevronDown, ChevronUp, Sword, Wand2, Footprints, Eye,
} from "lucide-react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { RoleBadge } from "@/components/Badge";
import { toast } from "@/components/Toast";
import { PartiesCard } from "./PartiesCard";
import type { User, PlayerLink, McPlayer, Gamemode } from "@/types";
import { ROLE_LEVELS } from "@/types";

// ── Hooks ──────────────────────────────────────────────────────────────────────

interface PinHudStatus { ign: string; show_team: boolean; show_private: boolean; show_events: boolean; }

function usePinHud(ign: string, canAccess: boolean) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<PinHudStatus>({
    queryKey: ["pin-hud", ign],
    queryFn:  () => api.get(`/players/${encodeURIComponent(ign)}/pin-hud`),
    enabled:  canAccess, retry: false, staleTime: 30_000,
  });
  const updateMut = useMutation({
    mutationFn: (body: { show_team: boolean; show_private: boolean; show_events: boolean }) =>
      api.put(`/players/${encodeURIComponent(ign)}/pin-hud`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pin-hud", ign] }),
  });
  return { data, isLoading, update: updateMut.mutate, isPending: updateMut.isPending };
}

interface CoordStatus { enabled: boolean; online: boolean; ign: string; }

function useCoordDisplay(ign: string, canAccess: boolean) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CoordStatus>({
    queryKey: ["coord-display", ign],
    queryFn:  () => api.get(`/players/${encodeURIComponent(ign)}/coord-display`),
    enabled:  canAccess, retry: false, staleTime: 30_000,
  });
  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) =>
      api.post(`/players/${encodeURIComponent(ign)}/coord-display`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["coord-display", ign] }),
  });
  return { data, isLoading, toggle: (v: boolean) => toggleMut.mutate(v), isPending: toggleMut.isPending };
}

const GM_LABEL: Record<Gamemode, string> = { survival: "Survival", creative: "Creative", adventure: "Adventure", spectator: "Spectator" };
const GM_COLOR: Record<Gamemode, string> = {
  survival:  "text-[#36B37E]",
  creative:  "text-[#5B9BF0]",
  adventure: "text-[#FBBF24]",
  spectator: "text-meta",
};

// ── MC Head avatar ─────────────────────────────────────────────────────────────

function MCHead({ ign, size = 40 }: { ign: string; size?: number }) {
  return (
    <img
      src={`https://mc-heads.net/avatar/${ign}/${size}`}
      alt={ign}
      width={size}
      height={size}
      className="rounded-lg flex-shrink-0"
      loading="lazy"
    />
  );
}

// ── Alias editor ───────────────────────────────────────────────────────────────

interface AliasResponse { ign: string; alias: string | null; }

function AliasEditor({ ign }: { ign: string }) {
  const qc = useQueryClient();
  const { data } = useQuery<AliasResponse>({
    queryKey: ["alias", ign],
    queryFn:  () => api.get(`/players/${encodeURIComponent(ign)}/alias`),
    staleTime: 30_000, retry: false,
  });
  const currentAlias = data?.alias ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => { if (draft === null && data !== undefined) setDraft(currentAlias ?? ""); }, [data]); // eslint-disable-line

  const setMut = useMutation({
    mutationFn: (alias: string) => api.put<AliasResponse>(`/players/${encodeURIComponent(ign)}/alias`, { alias }),
    onSuccess: (res: AliasResponse) => { qc.setQueryData(["alias", ign], res); toast.success(`Alias set to "${res.alias}"`); },
    onError: () => toast.error("Failed to set alias"),
  });
  const clearMut = useMutation({
    mutationFn: () => api.delete(`/players/${encodeURIComponent(ign)}/alias`),
    onSuccess: () => { qc.setQueryData(["alias", ign], { ign, alias: null }); setDraft(""); toast.success("Alias removed"); },
    onError: () => toast.error("Failed to clear alias"),
  });

  const value   = draft ?? currentAlias ?? "";
  const dirty   = value.trim() !== (currentAlias ?? "").trim();
  const saving  = setMut.isPending || clearMut.isPending;

  return (
    <div className="flex items-center gap-2">
      <Tag className="w-3.5 h-3.5 text-meta flex-shrink-0" aria-hidden />
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <input
          type="text"
          maxLength={32}
          placeholder={`Alias (or /alias in-game)`}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) setMut.mutate(value.trim()); }}
          disabled={saving}
          className="flex-1 min-w-0 h-7 rounded-md bg-white dark:bg-[#1C1E27] border border-[#D9D5D0]
                     dark:border-[#363944] text-xs text-[#1C1E27] dark:text-[#EAECF0] px-2
                     placeholder-[#9B9EA6] focus:outline-none focus:ring-1 focus:ring-[#5B9BF0] disabled:opacity-50"
        />
        {dirty && (
          <button
            onClick={() => value.trim() ? setMut.mutate(value.trim()) : clearMut.mutate()}
            disabled={saving}
            className="h-7 px-2.5 rounded-md bg-[#5B9BF0] text-white text-xs font-medium
                       hover:bg-[#4080D8] disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {saving ? "…" : "Save"}
          </button>
        )}
        {currentAlias && !dirty && (
          <button
            onClick={() => clearMut.mutate()}
            disabled={saving}
            className="h-7 px-2 rounded-md text-[#9B9EA6] hover:text-[#F87171]
                       hover:bg-[#FEE2E2] dark:hover:bg-[#3B1F1F] text-xs transition-colors flex-shrink-0"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ── Per-player settings panel (expands inline) ─────────────────────────────────

function PlayerSettings({
  link, isSelf, canAdmin, isGlobalAdmin, targetLevel, myLevel,
  onChangeGm, onUnlink, gmPending,
}: {
  link: PlayerLink;
  isSelf: boolean; canAdmin: boolean; isGlobalAdmin: boolean;
  targetLevel: number; myLevel: number;
  onChangeGm: (gm: string) => void; onUnlink: () => void; gmPending: boolean;
}) {
  const ign         = link.ign;
  const canChangeGm = isSelf || isGlobalAdmin || targetLevel < myLevel;

  const { data: coordData, toggle: toggleCoord, isPending: coordPending } =
    useCoordDisplay(ign, isSelf || canAdmin);
  const { data: pinData, update: updatePin, isPending: pinPending } =
    usePinHud(ign, isSelf || canAdmin);
  const [pinOpen, setPinOpen] = useState(false);

  const coordOn    = coordData?.enabled ?? false;
  const pinOn      = (pinData?.show_team || pinData?.show_private || pinData?.show_events) ?? false;

  return (
    <div className="space-y-3 pt-2">
      {/* Alias */}
      {(isSelf || canAdmin) && <AliasEditor ign={ign} />}

      {/* Gamemode — segmented control: 4 fixed options, recognition > recall */}
      {canChangeGm && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-meta font-semibold">Gamemode</span>
          <SegmentedControl
            label={`${ign} gamemode`}
            size="sm"
            fullWidth
            disabled={gmPending}
            value={link.gamemode as Gamemode}
            onChange={onChangeGm}
            options={[
              { value: "survival",  label: "Survival",  icon: Sword,    title: "Survival — normal gameplay, health & hunger" },
              { value: "creative",  label: "Creative",  icon: Wand2,    title: "Creative — fly, unlimited resources" },
              { value: "adventure", label: "Adventure", icon: Footprints, title: "Adventure — explore, limited block breaking" },
              { value: "spectator", label: "Spectator", icon: Eye,      title: "Spectator — invisible observer" },
            ]}
          />
        </div>
      )}

      {/* HUD toggles */}
      {(isSelf || canAdmin) && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Coordinate display */}
          <button
            onClick={() => toggleCoord(!coordOn)}
            disabled={coordPending}
            title={coordOn ? "Coords HUD on" : "Coords HUD off"}
            className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40
              ${coordOn
                ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#0E8A57] dark:text-[#6EE7B7]"
                : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#A8AEBB]"}`}
          >
            {coordOn ? <MapPin className="w-3 h-3" aria-hidden /> : <MapPinOff className="w-3 h-3" aria-hidden />}
            XYZ
          </button>

          {/* PIN HUD */}
          <div className="relative">
            <button
              onClick={() => setPinOpen((v) => !v)}
              disabled={pinPending}
              title={pinOn ? "Pin HUD on" : "Pin HUD off"}
              aria-expanded={pinOpen}
              className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40
                ${pinOn
                  ? "bg-[#E0E7FF] dark:bg-[#1E3A5F] text-[#3B7DD8] dark:text-[#9CC1F5]"
                  : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#A8AEBB]"}`}
            >
              <Compass className="w-3 h-3" aria-hidden />
              PIN
            </button>
            {pinOpen && (
              <>
                <div className="fixed inset-0 z-30 bg-black/30 sm:bg-transparent" onClick={() => setPinOpen(false)} />
                <div
                  role="dialog"
                  aria-label={`Pin HUD settings for ${ign}`}
                  className="fixed inset-x-4 bottom-4 z-40 max-w-sm mx-auto p-3 space-y-2
                             sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1 sm:w-52
                             rounded-xl shadow-xl border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#1C1E27]"
                >
                  <p className="text-[10px] uppercase tracking-wider text-meta font-semibold">Show nearest pin</p>
                  {[
                    { key: "show_team"    as const, label: "Team pins"    },
                    { key: "show_private" as const, label: "My pins"      },
                    { key: "show_events"  as const, label: "Active events" },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={pinData?.[key] ?? false}
                        onChange={(e) => updatePin({
                          show_team:    key === "show_team"    ? e.target.checked : (pinData?.show_team    ?? false),
                          show_private: key === "show_private" ? e.target.checked : (pinData?.show_private ?? false),
                          show_events:  key === "show_events"  ? e.target.checked : (pinData?.show_events  ?? false),
                        })}
                        disabled={pinPending}
                        className="accent-[#5B9BF0] w-4 h-4"
                      />
                      <span className="text-[#1C1E27] dark:text-[#EAECF0]">{label}</span>
                    </label>
                  ))}
                  <p className="text-[10px] text-meta border-t border-[#D9D5D0] dark:border-[#363944] pt-2">
                    Shown above hotbar with distance.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Unlink */}
      {isSelf && (
        <div className="pt-1 border-t border-[#D9D5D0] dark:border-[#363944]">
          <button
            onClick={onUnlink}
            className="flex items-center gap-1.5 text-xs text-[#9B9EA6] hover:text-[#F87171] transition-colors"
          >
            <X className="w-3.5 h-3.5" aria-hidden />
            Unlink {ign}
          </button>
        </div>
      )}
    </div>
  );
}

// ── UserCard ───────────────────────────────────────────────────────────────────

function UserCard({
  user, mcPlayers, me, myLevel, canRemove, isGlobalAdmin, qc,
}: {
  user: User; mcPlayers: McPlayer[]; me: string; myLevel: number;
  canRemove: boolean; isGlobalAdmin: boolean; qc: ReturnType<typeof useQueryClient>;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expandedIgn,   setExpandedIgn]   = useState<string | null>(null);

  const { data: links = [] } = useQuery<PlayerLink[]>({
    queryKey: ["players", user.email],
    queryFn:  () => api.get(`/users/${encodeURIComponent(user.email)}/players`),
  });

  const { data: aliasMap = {} } = useQuery<Record<string, string | null>>({
    queryKey: ["aliases-bulk", links.map((l) => l.ign).join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        links.map((l) => api.get<{ ign: string; alias: string | null }>(`/players/${encodeURIComponent(l.ign)}/alias`))
      );
      return Object.fromEntries(results.map((r) => [r.ign, r.alias]));
    },
    enabled: links.length > 0,
    staleTime: 30_000,
    retry: false,
  });

  const gmMut = useMutation({
    mutationFn: ({ ign, gamemode }: { ign: string; gamemode: string }) =>
      api.patch<{ saved: boolean; applied: boolean }>(
        `/users/${encodeURIComponent(user.email)}/players/${encodeURIComponent(ign)}/gamemode`,
        { gamemode },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["players", user.email] });
      if (res.applied) toast.success("Gamemode updated in-game.");
      else toast.info("Gamemode saved — apply on next join.");
    },
    onError: () => toast.error("Failed to update gamemode."),
  });

  const unlinkMut = useMutation({
    mutationFn: (ign: string) =>
      api.delete(`/users/${encodeURIComponent(user.email)}/players/${encodeURIComponent(ign)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players", user.email] }),
  });

  const removeMut = useMutation({
    mutationFn: () => api.delete(`/users/${encodeURIComponent(user.email)}`),
    onSuccess: () => { setConfirmRemove(false); qc.invalidateQueries({ queryKey: ["users"] }); },
  });

  const isSelf      = user.email === me;
  const targetLevel = ROLE_LEVELS[user.role] ?? 0;
  const canAdmin    = isGlobalAdmin || targetLevel < myLevel;
  const showRemove  = canRemove && !isSelf && (isGlobalAdmin || targetLevel < myLevel);

  // Resolve all linked IGNs' online status
  const onlineIgns = new Set(mcPlayers.filter((p) => p.online).map((p) => p.ign));
  const anyOnline  = links.some((l) => onlineIgns.has(l.ign));

  const initials = user.display_name.slice(0, 2).toUpperCase();
  const avatarBg = ["#9B9EA6", "#36B37E", "#5B9BF0", "#FBBF24"][
    Math.max(0, (ROLE_LEVELS[user.role] ?? 0) - 1)
  ];

  return (
    <>
      {confirmRemove && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="alertdialog">
          <div className="card max-w-sm w-full space-y-4">
            <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Remove {user.display_name}?</h2>
            <p className="text-sm text-meta">This revokes access immediately and unlinks their MC accounts. Cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmRemove(false)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={() => removeMut.mutate()} disabled={removeMut.isPending} className="btn-danger text-sm">
                {removeMut.isPending ? "Removing…" : "Yes, Remove"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`card space-y-0 overflow-hidden transition-all
        ${anyOnline ? "border-l-[3px] border-l-[#36B37E]" : ""}`}>
        {/* ── User identity row ─────────────────────────────────────────── */}
        <div className="flex items-center gap-3 p-4">
          {/* Avatar with online pulse */}
          <div className="relative flex-shrink-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: avatarBg }}
            >
              {user.avatar_url
                ? <img src={user.avatar_url} className="w-10 h-10 rounded-full" alt="" />
                : initials}
            </div>
            {anyOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#36B37E]
                               ring-2 ring-white dark:ring-[#222530]">
                <span className="absolute inset-0 rounded-full bg-[#36B37E] animate-ping opacity-60" />
              </span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">{user.display_name}</span>
              {isSelf && <span className="text-[10px] text-meta bg-[#F0EDE9] dark:bg-[#2A2D38] px-1.5 py-0.5 rounded">you</span>}
              <RoleBadge role={user.role} />
            </div>
            <p className="text-xs text-meta truncate">{user.email}</p>
          </div>

          {showRemove && (
            <button
              onClick={() => setConfirmRemove(true)}
              className="icon-btn-danger flex-shrink-0 w-8 h-8 min-w-0 min-h-0"
              aria-label={`Remove ${user.display_name}`}
            >
              <UserMinus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Linked MC players ────────────────────────────────────────── */}
        {links.length > 0 && (
          <div className="border-t border-[#F0EDE9] dark:border-[#2A2D38]">
            {links.map((link) => {
              const online  = onlineIgns.has(link.ign);
              const alias   = aliasMap[link.ign] ?? null;
              const isExp   = expandedIgn === link.ign;

              return (
                <div key={link.ign} className="border-b border-[#F0EDE9] dark:border-[#2A2D38] last:border-b-0">
                  {/* Player row — tap to expand settings */}
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F7F5F2]
                               dark:hover:bg-[#1E212B] transition-colors text-left"
                    onClick={() => setExpandedIgn(isExp ? null : link.ign)}
                    aria-expanded={isExp}
                    aria-label={`${link.ign} settings`}
                  >
                    {/* MC head */}
                    <MCHead ign={link.ign} size={32} />

                    <div className="flex-1 min-w-0">
                      {/* Name + alias */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {alias && (
                          <span className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">{alias}</span>
                        )}
                        <span className={`font-mono text-sm ${alias ? "text-meta text-xs" : "font-semibold text-[#1C1E27] dark:text-[#EAECF0]"}`}>
                          {link.ign}
                        </span>
                        <span className={`text-[10px] font-medium ${GM_COLOR[link.gamemode as Gamemode] ?? "text-meta"}`}>
                          {GM_LABEL[link.gamemode as Gamemode] ?? link.gamemode}
                        </span>
                      </div>
                      {/* Online status */}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`} />
                        <span className="text-[10px] text-meta">{online ? "Online" : "Offline"}</span>
                      </div>
                    </div>

                    {isExp
                      ? <ChevronUp   className="w-4 h-4 text-meta flex-shrink-0" aria-hidden />
                      : <ChevronDown className="w-4 h-4 text-meta flex-shrink-0" aria-hidden />}
                  </button>

                  {/* Expanded settings */}
                  {isExp && (
                    <div className="px-4 pb-4 bg-[#F7F5F2] dark:bg-[#1E212B]">
                      <PlayerSettings
                        link={link}
                        isSelf={isSelf}
                        canAdmin={canAdmin}
                        isGlobalAdmin={isGlobalAdmin}
                        targetLevel={targetLevel}
                        myLevel={myLevel}
                        onChangeGm={(gm) => gmMut.mutate({ ign: link.ign, gamemode: gm })}
                        onUnlink={() => unlinkMut.mutate(link.ign)}
                        gmPending={gmMut.isPending}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {links.length === 0 && (
          <div className="border-t border-[#F0EDE9] dark:border-[#2A2D38] px-4 py-3">
            <p className="text-xs text-meta">No linked MC accounts</p>
          </div>
        )}
      </div>
    </>
  );
}

// ── TeamPage ───────────────────────────────────────────────────────────────────

export function TeamPage() {
  const { user: me, hasPerm } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const canRemove     = hasPerm("users.remove");
  const myLevel       = ROLE_LEVELS[me?.role ?? "visitor"] ?? 0;
  const isGlobalAdmin = me?.role === "global_admin";

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn:  () => api.get("/users"),
  });

  const { data: mcPlayers = [] } = useQuery<McPlayer[]>({
    queryKey:      ["mc-players"],
    queryFn:       () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  const onlineCount = mcPlayers.filter((p) => p.online).length;

  // Only show people who have actually accepted their invite (signed in at least
  // once). Invited-but-never-logged-in users have last_login == null and are
  // managed from the Admin tab, not surfaced in the social roster.
  const accepted = users.filter((u) => u.last_login != null);

  const sorted = accepted
    .filter((u) =>
      !search ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.display_name.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => (ROLE_LEVELS[b.role] ?? 0) - (ROLE_LEVELS[a.role] ?? 0));

  return (
    <div className="page space-y-4">
      {/* Summary + search row — NNG: matches real-world model of "scanning the room" */}
      <div className="flex items-center gap-3">
        {/* Online summary pill */}
        <div className="flex items-center gap-2 rounded-full bg-[#F0EDE9] dark:bg-[#2A2D38] px-3 py-1.5 flex-shrink-0">
          <span className="relative flex-shrink-0">
            <span className={`w-2 h-2 rounded-full block ${onlineCount > 0 ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`} />
            {onlineCount > 0 && <span className="absolute inset-0 rounded-full bg-[#36B37E] animate-ping opacity-60" />}
          </span>
          <span className="text-xs font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            {onlineCount > 0 ? `${onlineCount} online` : "No one online"}
          </span>
          <span className="text-xs text-meta">· {accepted.length} members</span>
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-9 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                     bg-white dark:bg-[#2A2D38] px-3 text-sm
                     focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
        />

        <button
          onClick={() => { qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["mc-players"] }); }}
          className="icon-btn flex-shrink-0"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-meta text-center py-10">No team members found.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((u) => (
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

      {/* Parties */}
      <PartiesCard />
    </div>
  );
}

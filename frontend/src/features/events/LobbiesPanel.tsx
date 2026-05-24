/**
 * Pre-game Lobbies panel.
 *
 * A lobby is a holding pen in a dedicated dimension.  Players join, wait
 * around, and on Launch are TP'd into the linked event area with a 5-second
 * bossbar countdown + brief blindness for the cut.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DoorOpen, Plus, Trash2, Play, Users, User, X, Lock, CheckSquare, XSquare,
  Hourglass, Rocket,
} from "lucide-react";
import { api } from "@/api/client";
import type {
  LobbyWithAttendees, McPlayer, Countdown, RisingOcean, BountyBoard,
  CountdownState, RisingOceanState, BountyBoardState,
} from "@/types";

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
  "disabled:opacity-50",
].join(" ");
const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-[#F0EDE9] text-[#6B6E78] dark:bg-[#2A2D38] dark:text-[#9B9EA6]",
  open:      "bg-[#DCFCE7] text-[#166534] dark:bg-[#14532D]/30 dark:text-[#86EFAC]",
  locked:    "bg-[#FEF3C7] text-[#92400E] dark:bg-[#78350F]/30 dark:text-[#FCD34D]",
  launching: "bg-[#FDE68A] text-[#92400E] dark:bg-[#78350F]/30 dark:text-[#FCD34D]",
  launched:  "bg-[#E0E7FF] text-[#3730A3] dark:bg-[#312E81]/30 dark:text-[#A5B4FC]",
  closed:    "bg-[#F0EDE9] text-[#9B9EA6] dark:bg-[#2A2D38] dark:text-[#6B6E78]",
};

// ── Panel ─────────────────────────────────────────────────────────────────────

export function LobbiesPanel({
  canManage,
}: {
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const { data: lobbies = [] } = useQuery<LobbyWithAttendees[]>({
    queryKey: ["lobbies"],
    queryFn:  () => api.get("/events/lobbies"),
    refetchInterval: 5_000,
  });
  const { data: players = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn:  () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  const [creating, setCreating] = useState(false);

  const createMut = useMutation({
    mutationFn: (body: CreateBody) => api.post("/events/lobbies", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lobbies"] });
      setCreating(false);
    },
  });
  const launchMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/lobbies/${id}/launch`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lobbies"] }),
  });
  const closeMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/lobbies/${id}/close`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lobbies"] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/events/lobbies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lobbies"] }),
  });
  const joinMut = useMutation({
    mutationFn: ({ id, ign }: { id: number; ign?: string }) =>
      api.post(`/events/lobbies/${id}/join`, { ign }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lobbies"] }),
  });
  const leaveMut = useMutation({
    mutationFn: ({ id, ign }: { id: number; ign?: string }) =>
      api.post(`/events/lobbies/${id}/leave`, { ign }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lobbies"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-meta">
          Players wait in a dedicated dimension. When you launch, everyone's
          TP'd into the event area together — bossbar countdown + brief fade.
        </p>
        {canManage && !creating && (
          <button
            onClick={() => setCreating(true)}
            className="btn-primary text-xs flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> New lobby
          </button>
        )}
      </div>

      {creating && (
        <LobbyForm
          players={players}
          loading={createMut.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(body) => createMut.mutate(body)}
        />
      )}

      <div className="space-y-2">
        {lobbies.length === 0 && !creating && (
          <p className="text-xs text-meta italic py-2 text-center">
            No lobbies yet. Click <em>New lobby</em> to create one.
          </p>
        )}
        {lobbies.map((l) => (
          <LobbyCard
            key={l.id}
            lobby={l}
            canManage={canManage}
            launching={launchMut.isPending && launchMut.variables === l.id}
            onLaunch={() => launchMut.mutate(l.id)}
            onClose={() => { if (confirm(`Close "${l.name}" and return all players home?`)) closeMut.mutate(l.id); }}
            onDelete={() => { if (confirm(`Delete lobby "${l.name}"?`)) deleteMut.mutate(l.id); }}
            onJoinSelf={() => joinMut.mutate({ id: l.id })}
            onLeaveSelf={() => leaveMut.mutate({ id: l.id })}
          />
        ))}
      </div>
    </div>
  );
}

// ── LobbyCard ─────────────────────────────────────────────────────────────────

function LobbyCard({
  lobby, canManage, launching, onLaunch, onClose, onDelete, onJoinSelf, onLeaveSelf,
}: {
  lobby:       LobbyWithAttendees;
  canManage:   boolean;
  launching:   boolean;
  onLaunch:    () => void;
  onClose:     () => void;
  onDelete:    () => void;
  onJoinSelf:  () => void;
  onLeaveSelf: () => void;
}) {
  const active = lobby.attendees.filter((a) => a.status === "joined");
  const cap = `${active.length} / ${lobby.max_players}`;

  return (
    <div className="card space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <DoorOpen className="w-4 h-4 text-[#5B9BF0]" />
            <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
              {lobby.name}
            </span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[lobby.status] ?? ""}`}>
              {lobby.status}
            </span>
            <span className="text-[10px] text-meta tabular-nums">{cap}</span>
          </div>
          <p className="text-[11px] text-meta mt-0.5">
            launches to <code className="font-mono">{lobby.launch_dimension.replace("minecraft:","")}</code>
            {" "}@ ({lobby.launch_x}, {lobby.launch_y}, {lobby.launch_z})
            {" · "}
            {lobby.linked_event_type === "manual"
              ? "manual start"
              : `${lobby.linked_event_type.replace("_", " ")} #${lobby.linked_event_id}`}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {(lobby.status === "open" || lobby.status === "locked") && (
            <button
              onClick={onJoinSelf}
              title="Join with my linked account"
              className="btn-secondary text-xs flex items-center gap-1"
            >
              <User className="w-3 h-3" /> Join
            </button>
          )}
          {lobby.status === "open" && (
            <button
              onClick={onLeaveSelf}
              title="Leave the lobby"
              className="btn-secondary text-xs flex items-center gap-1"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          {canManage && (lobby.status === "open" || lobby.status === "locked") && (
            <button
              onClick={onLaunch}
              disabled={launching || active.length === 0}
              title={active.length === 0 ? "No attendees to launch" : "Launch"}
              className="btn-primary text-xs flex items-center gap-1"
            >
              {launching
                ? <Hourglass className="w-3 h-3 animate-spin" />
                : <Rocket className="w-3 h-3" />}
              Launch
            </button>
          )}
          {canManage && ["launched", "launching"].includes(lobby.status) && (
            <button
              onClick={onClose}
              className="btn-secondary text-xs flex items-center gap-1"
              title="Close lobby and return everyone home"
            >
              <Lock className="w-3 h-3" /> Close
            </button>
          )}
          {canManage && ["closed", "pending", "open"].includes(lobby.status) && (
            <button
              onClick={onDelete}
              title="Delete"
              className="p-1 rounded text-meta hover:text-[#EF4444] hover:bg-[#FEE2E2] dark:hover:bg-[#7F1D1D]/30"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Attendees row */}
      <div className="flex items-center flex-wrap gap-1.5 -mt-1">
        {active.length === 0 && (
          <span className="text-[10px] text-meta italic">No attendees yet.</span>
        )}
        {active.map((a) => (
          <span
            key={a.player_ign}
            title={a.player_ign}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#F0EDE9] dark:bg-[#2A2D38] text-[10px]"
          >
            <img
              src={`https://mc-heads.net/avatar/${encodeURIComponent(a.player_ign)}/16`}
              alt=""
              className="w-3.5 h-3.5 rounded"
              loading="lazy"
            />
            <span className="text-[#1C1E27] dark:text-[#EAECF0] font-medium">{a.player_ign}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── LobbyForm ─────────────────────────────────────────────────────────────────

interface CreateBody {
  name:              string;
  radius:            number;
  max_players:       number;
  allowed_players:   string[] | null;
  linked_event_type: "manual" | "countdown" | "rising_oceans" | "bounty_board";
  linked_event_id:   number | null;
  launch_dimension:  string;
  launch_x:          number;
  launch_y:          number;
  launch_z:          number;
}

function LobbyForm({
  players, loading, onSubmit, onCancel,
}: {
  players:  McPlayer[];
  loading:  boolean;
  onSubmit: (body: CreateBody) => void;
  onCancel: () => void;
}) {
  const [name, setName]           = useState("");
  const [radius, setRadius]       = useState(32);
  const [maxPlayers, setMaxPlayers] = useState(16);
  const [openToAll, setOpenToAll] = useState(true);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [linkType, setLinkType]   = useState<CreateBody["linked_event_type"]>("manual");
  const [linkId, setLinkId]       = useState<number | null>(null);
  const [launchDim, setLaunchDim] = useState("minecraft:overworld");
  const [lx, setLx] = useState(0);
  const [ly, setLy] = useState(70);
  const [lz, setLz] = useState(0);

  // Pull candidates for each linkable event type (pending/active only).
  const { data: countdowns }    = useQuery<CountdownState>({
    queryKey: ["countdown-state"],
    queryFn:  () => api.get("/events/countdowns/state"),
    enabled: linkType === "countdown",
  });
  const { data: risingOceans }  = useQuery<RisingOceanState>({
    queryKey: ["rising-oceans-state"],
    queryFn:  () => api.get("/events/rising-oceans/state"),
    enabled: linkType === "rising_oceans",
  });
  const { data: bountyBoards }  = useQuery<BountyBoardState>({
    queryKey: ["bounty-board-state"],
    queryFn:  () => api.get("/events/bounty-board/state"),
    enabled: linkType === "bounty_board",
  });

  const eventChoices: { id: number; label: string }[] = useMemo(() => {
    if (linkType === "countdown") {
      return (countdowns?.recent ?? []).filter((c: Countdown) => c.status === "pending")
        .map((c) => ({ id: c.id, label: `${c.title} (${c.duration_secs}s)` }));
    }
    if (linkType === "rising_oceans") {
      return (risingOceans?.recent ?? []).filter((r: RisingOcean) => r.status === "pending")
        .map((r) => ({ id: r.id, label: `${r.world_slug} r=${r.radius}` }));
    }
    if (linkType === "bounty_board") {
      return (bountyBoards?.recent ?? []).filter((b: BountyBoard) => b.status === "pending")
        .map((b) => ({ id: b.id, label: b.title }));
    }
    return [];
  }, [linkType, countdowns, risingOceans, bountyBoards]);

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.ign.localeCompare(b.ign);
    });
  }, [players]);

  const canSubmit = name.trim().length > 0
                    && (linkType === "manual" || linkId !== null)
                    && !loading;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name:              name.trim(),
      radius,
      max_players:       maxPlayers,
      allowed_players:   openToAll ? null : [...selected],
      linked_event_type: linkType,
      linked_event_id:   linkType === "manual" ? null : linkId,
      launch_dimension:  launchDim,
      launch_x:          lx,
      launch_y:          ly,
      launch_z:          lz,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card space-y-3 border-[#5B9BF0]/40"
    >
      <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">New lobby</h3>

      <div>
        <label className={LBL}>Name</label>
        <input
          type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60} placeholder="e.g. PvP Round 1"
          className={`${INPUT} w-full`}
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LBL}>Radius</label>
          <input
            type="number" min={8} max={256} value={radius}
            onChange={(e) => setRadius(Math.max(8, Math.min(256, Number(e.target.value) || 32)))}
            className={`${INPUT} w-full`}
          />
        </div>
        <div className="flex-1">
          <label className={LBL}>Max players</label>
          <input
            type="number" min={1} max={100} value={maxPlayers}
            onChange={(e) => setMaxPlayers(Math.max(1, Math.min(100, Number(e.target.value) || 16)))}
            className={`${INPUT} w-full`}
          />
        </div>
      </div>

      {/* Linked event */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LBL}>Launch type</label>
          <select
            value={linkType}
            onChange={(e) => {
              setLinkType(e.target.value as CreateBody["linked_event_type"]);
              setLinkId(null);
            }}
            className={`${INPUT} w-full`}
          >
            <option value="manual">Manual (no event)</option>
            <option value="countdown">Countdown</option>
            <option value="rising_oceans">Rising Oceans</option>
            <option value="bounty_board">Bounty Board</option>
          </select>
        </div>
        {linkType !== "manual" && (
          <div className="flex-1">
            <label className={LBL}>Pick event (must be pending)</label>
            <select
              value={linkId ?? ""}
              onChange={(e) => setLinkId(e.target.value ? Number(e.target.value) : null)}
              className={`${INPUT} w-full`}
            >
              <option value="">— choose —</option>
              {eventChoices.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
            {eventChoices.length === 0 && (
              <p className="text-[10px] text-meta mt-0.5">
                No pending events of this type. Create one in its own tab first.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Launch destination */}
      <div>
        <label className={LBL}>Where players land on launch</label>
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Dimension</label>
            <select
              value={launchDim}
              onChange={(e) => setLaunchDim(e.target.value)}
              className={`${INPUT} w-full`}
            >
              <option value="minecraft:overworld">Overworld</option>
              <option value="minecraft:the_nether">The Nether</option>
              <option value="minecraft:the_end">The End</option>
              <option value="redstonecipher:arena">Events Arena</option>
            </select>
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">X</label>
            <input type="number" value={lx} onChange={(e) => setLx(Number(e.target.value) || 0)} className={`${INPUT} w-full`} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Y</label>
            <input type="number" value={ly} onChange={(e) => setLy(Number(e.target.value) || 70)} className={`${INPUT} w-full`} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Z</label>
            <input type="number" value={lz} onChange={(e) => setLz(Number(e.target.value) || 0)} className={`${INPUT} w-full`} />
          </div>
        </div>
      </div>

      {/* Allowed players */}
      <div>
        <label className={LBL}>Who can join</label>
        <div className="flex items-center gap-4 mb-1.5">
          <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
            <input
              type="radio"
              checked={openToAll}
              onChange={() => setOpenToAll(true)}
              className="accent-[#5B9BF0]"
            />
            <Users className="w-3.5 h-3.5" /> Open to everyone
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
            <input
              type="radio"
              checked={!openToAll}
              onChange={() => setOpenToAll(false)}
              className="accent-[#5B9BF0]"
            />
            <User className="w-3.5 h-3.5" /> Invite list
          </label>
        </div>
        {!openToAll && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => setSelected(new Set(sortedPlayers.map((p) => p.ign)))}
                disabled={sortedPlayers.length === 0}
                className="btn-secondary text-[10px] flex items-center gap-1 px-2 py-1"
              >
                <CheckSquare className="w-3 h-3" /> Select all
              </button>
              <button type="button"
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
                className="btn-secondary text-[10px] flex items-center gap-1 px-2 py-1"
              >
                <XSquare className="w-3 h-3" /> Select none
              </button>
              <span className="ml-auto text-[10px] text-meta tabular-nums">
                {selected.size} / {sortedPlayers.length} selected
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 max-h-40 overflow-y-auto p-1
                            border border-[#D9D5D0] dark:border-[#363944] rounded-lg
                            bg-white dark:bg-[#2A2D38]">
              {sortedPlayers.map((p) => {
                const isSel = selected.has(p.ign);
                return (
                  <button
                    key={p.uuid || p.ign}
                    type="button"
                    onClick={() => {
                      const next = new Set(selected);
                      if (next.has(p.ign)) next.delete(p.ign); else next.add(p.ign);
                      setSelected(next);
                    }}
                    title={`${p.ign}${p.online ? " (online)" : ""}`}
                    className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[10px]
                                transition-colors min-w-0 ${
                                  isSel
                                    ? "bg-[#5B9BF0] text-white"
                                    : "text-[#1C1E27] dark:text-[#EAECF0] hover:bg-[#F0EDE9] dark:hover:bg-[#363944]"
                                }`}
                  >
                    <img
                      src={`https://mc-heads.net/avatar/${encodeURIComponent(p.ign)}/20`}
                      alt=""
                      className="w-4 h-4 rounded"
                      loading="lazy"
                    />
                    <span className="truncate font-medium">{p.ign}</span>
                  </button>
                );
              })}
              {sortedPlayers.length === 0 && (
                <p className="col-span-full text-[10px] text-meta italic p-1">No players found.</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">Cancel</button>
        <button type="submit" disabled={!canSubmit} className="btn-primary text-xs flex items-center gap-1">
          <Play className="w-3 h-3" /> Create lobby
        </button>
      </div>
    </form>
  );
}

import { useState, useEffect, useMemo } from "react";
import { useEventStream } from "@/hooks/useEventStream";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Timer, Play, Pause, Square, Trash2, Plus, Users, Waves, Trophy, DoorOpen,
  CheckSquare, XSquare, X, Pipette, Music2, ChevronUp, ChevronDown,
} from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { DiscIcon } from "@/components/DiscIcon";
import { PartyChipBar } from "@/components/PartyChipBar";
import { RisingOceansPanel } from "./RisingOceansPanel";
import { BountyBoardPanel } from "./BountyBoardPanel";
import { LobbiesPanel } from "./LobbiesPanel";
import type { CountdownState, SoundEntry, McPlayer } from "@/types";

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
  "disabled:opacity-50",
].join(" ");
const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

// Curated colour swatches shown in the color-picker modal.  Values are the
// approximate hex equivalents of Minecraft's named chat colours.
const COLOR_SWATCHES: { name: string; hex: string }[] = [
  { name: "yellow",       hex: "#FFFF55" },
  { name: "gold",         hex: "#FFAA00" },
  { name: "green",        hex: "#55FF55" },
  { name: "dark_green",   hex: "#00AA00" },
  { name: "aqua",         hex: "#55FFFF" },
  { name: "dark_aqua",    hex: "#00AAAA" },
  { name: "blue",         hex: "#5555FF" },
  { name: "dark_blue",    hex: "#0000AA" },
  { name: "red",          hex: "#FF5555" },
  { name: "dark_red",     hex: "#AA0000" },
  { name: "light_purple", hex: "#FF55FF" },
  { name: "dark_purple",  hex: "#AA00AA" },
  { name: "white",        hex: "#FFFFFF" },
  { name: "gray",         hex: "#AAAAAA" },
  { name: "dark_gray",    hex: "#555555" },
];

/// Translate a value passed to the backend's `color` field into a CSS-safe
/// hex string for previewing.  Named colours fall back to their swatch hex.
function colorToHex(value: string): string {
  if (value.startsWith("#")) return value;
  const m = COLOR_SWATCHES.find((s) => s.name === value);
  return m ? m.hex : "#FFFF55";
}

const STATUS_COLORS: Record<string, string> = {
  pending:   "bg-[#FEF3C7] text-[#92400E] dark:bg-[#78350F]/30 dark:text-[#FCD34D]",
  running:   "bg-[#DCFCE7] text-[#166534] dark:bg-[#14532D]/30 dark:text-[#86EFAC]",
  paused:    "bg-[#FEF3C7] text-[#92400E] dark:bg-[#78350F]/30 dark:text-[#FCD34D]",
  finished:  "bg-[#E0E7FF] text-[#3730A3] dark:bg-[#312E81]/30 dark:text-[#A5B4FC]",
  cancelled: "bg-[#FEE2E2] text-[#991B1B] dark:bg-[#7F1D1D]/30 dark:text-[#FCA5A5]",
};

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso + "Z").getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

type EventTab = "countdowns" | "rising-oceans" | "bounty-board" | "lobbies";

// ── EventsPage (top-level: tabs + per-tab panels) ─────────────────────────────

export function EventsPage() {
  const { hasPerm } = useAuthStore();
  const [tab, setTab] = useState<EventTab>("countdowns");

  // Permissions used by sub-panels (collected once at the top).
  const canCountdownCreate  = hasPerm("events.countdown.create");
  const canCountdownManage  = hasPerm("events.countdown.manage");
  const canRisingCreate     = hasPerm("events.rising_oceans.create") || hasPerm("events.rising_oceans.manage");
  const canRisingManage     = hasPerm("events.rising_oceans.manage");
  const canBountyManage     = hasPerm("events.bounty_board.create") || hasPerm("events.bounty_board.manage");
  const canLobbyManage      = hasPerm("events.lobby.manage");

  const tabs = ([
    { key: "countdowns"    as EventTab, label: "Countdowns",    Icon: Timer,    show: hasPerm("nav.events") || canCountdownCreate || canCountdownManage },
    { key: "rising-oceans" as EventTab, label: "Rising Oceans", Icon: Waves,    show: hasPerm("nav.events") || canRisingCreate    || canRisingManage   },
    { key: "bounty-board"  as EventTab, label: "Bounty Boards", Icon: Trophy,   show: hasPerm("nav.events") || canBountyManage    },
    { key: "lobbies"       as EventTab, label: "Lobbies",       Icon: DoorOpen, show: hasPerm("nav.events") || canLobbyManage     },
  ] as const).filter((t) => t.show);

  return (
    <div className="page-wide space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Events</h1>
        <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
          Run timed countdowns, rising-oceans hazard events, and competitive bounty boards
        </p>
      </div>

      {/* Tab bar — scrollable on mobile, keyboard arrow nav. */}
      <div className="-mx-4 sm:mx-0 overflow-x-auto">
        <div
          role="tablist"
          aria-label="Event types"
          className="flex gap-1 border-b border-[#D9D5D0] dark:border-[#363944] min-w-max sm:min-w-0 px-4 sm:px-0"
          onKeyDown={(e) => {
            const idx = tabs.findIndex((t) => t.key === tab);
            if (e.key === "ArrowRight") setTab(tabs[(idx + 1) % tabs.length].key);
            else if (e.key === "ArrowLeft") setTab(tabs[(idx - 1 + tabs.length) % tabs.length].key);
          }}
        >
          {tabs.map(({ key, label, Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              aria-controls={`tabpanel-${key}`}
              id={`tab-${key}`}
              onClick={() => setTab(key)}
              data-testid={`events-tab-${key}`}
              tabIndex={tab === key ? 0 : -1}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
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

      <div role="tabpanel" id="tabpanel-countdowns" aria-labelledby="tab-countdowns" hidden={tab !== "countdowns"}>
        <CountdownsPanel canCreate={canCountdownCreate} canManage={canCountdownManage} />
      </div>
      <div role="tabpanel" id="tabpanel-rising-oceans" aria-labelledby="tab-rising-oceans" hidden={tab !== "rising-oceans"}>
        {tab === "rising-oceans" && (
          <RisingOceansPanel canCreate={canRisingCreate} canManage={canRisingManage} />
        )}
      </div>
      <div role="tabpanel" id="tabpanel-bounty-board" aria-labelledby="tab-bounty-board" hidden={tab !== "bounty-board"}>
        {tab === "bounty-board" && (
          <BountyBoardPanel canManage={canBountyManage} />
        )}
      </div>
      <div role="tabpanel" id="tabpanel-lobbies" aria-labelledby="tab-lobbies" hidden={tab !== "lobbies"}>
        {tab === "lobbies" && (
          <LobbiesPanel canManage={canLobbyManage} />
        )}
      </div>
    </div>
  );
}

// ── Countdowns panel (the original single-page countdown UI) ──────────────────

function CountdownsPanel({
  canCreate,
  canManage,
}: {
  canCreate: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();

  const { data: countdownState } = useQuery<CountdownState>({
    queryKey: ["countdown-state"],
    queryFn:  () => api.get("/events/countdowns/state"),
  });

  useEventStream<CountdownState>("/api/events/countdowns/stream", {
    onMessage: (data) => qc.setQueryData<CountdownState>(["countdown-state"], data),
  });

  const active = countdownState?.active ?? null;
  const [localRemaining, setLocalRemaining] = useState(0);

  useEffect(() => {
    if (!active) { setLocalRemaining(0); return; }
    setLocalRemaining(active.remaining_secs);
    if (active.status === "paused") return;
    const id = setInterval(
      () => setLocalRemaining((prev) => Math.max(prev - 1, 0)),
      1000,
    );
    return () => clearInterval(id);
  }, [active?.id, active?.remaining_secs, active?.status]);

  const { data: tracks = [] } = useQuery<SoundEntry[]>({
    queryKey:  ["music-tracks"],
    queryFn:   () => api.get("/music/tracks"),
    staleTime: Infinity,
  });

  const createMut  = useMutation({
    mutationFn: (body: CreateBody) => api.post("/events/countdowns", body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["countdown-state"] }),
  });
  const pauseMut   = useMutation({
    mutationFn: (id: number) => api.post(`/events/countdowns/${id}/pause`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["countdown-state"] }),
  });
  const resumeMut  = useMutation({
    mutationFn: (id: number) => api.post(`/events/countdowns/${id}/resume`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["countdown-state"] }),
  });
  const cancelMut  = useMutation({
    mutationFn: (id: number) => api.post(`/events/countdowns/${id}/cancel`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["countdown-state"] }),
  });
  const deleteMut  = useMutation({
    mutationFn: (id: number) => api.delete(`/events/countdowns/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["countdown-state"] }),
  });

  return (
    <div className="space-y-5">
      {active && (
        <ActiveCountdownCard
          active={active}
          localRemaining={localRemaining}
          canManage={canManage}
          onPause={() => pauseMut.mutate(active.id)}
          onResume={() => resumeMut.mutate(active.id)}
          onCancel={() => cancelMut.mutate(active.id)}
        />
      )}

      {canCreate && (
        <CreateCountdownForm
          tracks={tracks}
          disabled={!!active}
          loading={createMut.isPending}
          onSubmit={(body) => createMut.mutate(body)}
        />
      )}

      <RecentList
        items={countdownState?.recent ?? []}
        canManage={canManage}
        onDelete={(id) => deleteMut.mutate(id)}
      />
    </div>
  );
}

// ── ActiveCountdownCard ───────────────────────────────────────────────────────

function ActiveCountdownCard({
  active,
  localRemaining,
  canManage,
  onPause,
  onResume,
  onCancel,
}: {
  active: NonNullable<CountdownState["active"]>;
  localRemaining: number;
  canManage: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const pct = ((active.duration_secs - localRemaining) / active.duration_secs) * 100;
  const isPaused = active.status === "paused";

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#DCFCE7] dark:bg-[#14532D]/30">
            <Timer className="w-5 h-5 text-[#22C55E]" />
          </div>
          <div>
            <h2 className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
              {active.title}
            </h2>
            <p className="text-xs text-meta">
              {isPaused ? "Paused" : "Running"} · Target: {active.target}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono font-bold text-[#1C1E27] dark:text-[#EAECF0] tabular-nums">
            {fmtTime(localRemaining)}
          </p>
          <p className="text-xs text-meta">remaining</p>
        </div>
      </div>

      <div className="w-full h-2 bg-[#E5E7EB] dark:bg-[#363944] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            isPaused ? "bg-[#FBBF24]" : "bg-[#22C55E]"
          }`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      {canManage && (
        <div className="flex gap-2">
          {isPaused ? (
            <button onClick={onResume} className="btn-primary flex items-center gap-1.5 text-sm">
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
          ) : (
            <button onClick={onPause} className="btn-secondary flex items-center gap-1.5 text-sm">
              <Pause className="w-3.5 h-3.5" /> Pause
            </button>
          )}
          <button
            onClick={() => { if (confirm("Cancel this countdown?")) onCancel(); }}
            className="btn-secondary flex items-center gap-1.5 text-sm text-[#EF4444] hover:bg-[#FEE2E2] dark:hover:bg-[#7F1D1D]/30"
          >
            <Square className="w-3.5 h-3.5" /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── CreateCountdownForm ───────────────────────────────────────────────────────

interface CreateBody {
  title:         string;
  duration_secs: number;
  target?:       string;
  display_mode?: string;
  color?:        string;
  sound_id?:     string;
  sound_ids?:    string[];
  auto_start?:   boolean;
}

function CreateCountdownForm({
  tracks,
  disabled,
  loading,
  onSubmit,
}: {
  tracks: SoundEntry[];
  disabled: boolean;
  loading: boolean;
  onSubmit: (body: CreateBody) => void;
}) {
  const [title, setTitle]     = useState("");
  const [mins, setMins]       = useState(5);
  const [secs, setSecs]       = useState(0);
  const [targetAll, setTargetAll] = useState(true);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [actionbar, setActionbar] = useState(true);
  const [bossbar, setBossbar] = useState(false);
  const [titleFinal, setTitleFinal] = useState(true);
  const [color, setColor]     = useState<string>("yellow");
  const [colorModalOpen, setColorModalOpen] = useState(false);
  /** Ordered list of selected tracks (multi-track countdown). */
  const [soundIds, setSoundIds] = useState<string[]>([]);
  const [trackModalOpen, setTrackModalOpen] = useState(false);

  // All players who have ever joined the server.
  const { data: players = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn:  () => api.get("/mc/players"),
    refetchInterval: 30_000, // keep online-status reasonably fresh
  });

  // Sort: online first, then alphabetical
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.ign.localeCompare(b.ign);
    });
  }, [players]);

  const totalSecs = mins * 60 + secs;

  // Sum of selected tracks → caps the countdown duration when music is paired.
  const musicTotalSecs = useMemo(() => {
    if (soundIds.length === 0) return null;
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return soundIds.reduce((sum, id) => sum + (byId.get(id)?.duration_secs ?? 0), 0);
  }, [soundIds, tracks]);

  const targetValid = targetAll || selectedPlayers.size > 0;
  const overMusicCap = musicTotalSecs !== null && totalSecs > musicTotalSecs;
  const canSubmit = title.trim().length > 0 && totalSecs > 0 && totalSecs <= 3600
                    && targetValid && !overMusicCap && !disabled && !loading;

  function togglePlayer(ign: string) {
    setSelectedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(ign)) next.delete(ign); else next.add(ign);
      return next;
    });
  }

  function selectAllPlayers() {
    setSelectedPlayers(new Set(sortedPlayers.map((p) => p.ign)));
  }
  function selectNonePlayers() {
    setSelectedPlayers(new Set());
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const modes: string[] = [];
    if (actionbar) modes.push("actionbar");
    if (bossbar) modes.push("bossbar");
    if (titleFinal) modes.push("title_final");

    // Target: "@a" for everyone, otherwise a comma-separated list of player
    // names that the backend will fan out as separate per-player commands.
    const target = targetAll ? "@a" : [...selectedPlayers].join(",");

    onSubmit({
      title: title.trim(),
      duration_secs: totalSecs,
      target,
      display_mode: modes.join(",") || "actionbar",
      color,
      sound_ids: soundIds.length > 0 ? soundIds : undefined,
      auto_start: true,
    });

    setTitle("");
    setMins(5);
    setSecs(0);
    setSoundIds([]);
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-4">
      <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
        <Plus className="w-4 h-4 text-[#5B9BF0]" /> New Countdown
      </h3>

      {disabled && (
        <p className="text-xs text-[#F59E0B] bg-[#FEF3C7] dark:bg-[#78350F]/20 rounded-lg px-3 py-2">
          A countdown is already active. Wait for it to finish or cancel it first.
        </p>
      )}

      <div>
        <label className={LBL}>Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Build Competition"
          maxLength={60}
          disabled={disabled}
          className={`${INPUT} w-full`}
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <label className={LBL}>Minutes</label>
          <input
            type="number"
            min={0}
            max={60}
            value={mins}
            onChange={(e) => setMins(Math.max(0, Math.min(60, Number(e.target.value))))}
            disabled={disabled}
            className={`${INPUT} w-full`}
          />
        </div>
        <div className="flex-1">
          <label className={LBL}>Seconds</label>
          <input
            type="number"
            min={0}
            max={59}
            value={secs}
            onChange={(e) => setSecs(Math.max(0, Math.min(59, Number(e.target.value))))}
            disabled={disabled}
            className={`${INPUT} w-full`}
          />
        </div>
        <div className="flex items-end pb-0.5">
          <span className="text-xs text-meta font-mono tabular-nums">{fmtTime(totalSecs)}</span>
        </div>
      </div>

      {/* ── Player selection ───────────────────────────────────────── */}
      <PlayerPicker
        players={sortedPlayers}
        targetAll={targetAll}
        setTargetAll={setTargetAll}
        selected={selectedPlayers}
        onToggle={togglePlayer}
        onAll={selectAllPlayers}
        onNone={selectNonePlayers}
        disabled={disabled}
      />

      {/* ── Display modes (with visual previews) ───────────────────── */}
      <div>
        <label className={LBL}>Display</label>
        <div className="grid grid-cols-3 gap-2">
          <DisplayModeCard
            kind="actionbar"
            label="Action Bar"
            checked={actionbar}
            onChange={setActionbar}
            disabled={disabled}
            color={color}
          />
          <DisplayModeCard
            kind="bossbar"
            label="Boss Bar"
            checked={bossbar}
            onChange={setBossbar}
            disabled={disabled}
            color={color}
          />
          <DisplayModeCard
            kind="title_final"
            label="Final Titles"
            checked={titleFinal}
            onChange={setTitleFinal}
            disabled={disabled}
            color={color}
          />
        </div>
      </div>

      <div className="flex gap-4">
        {/* ── Color (modal picker) ────────────────────────────────── */}
        <div className="flex-1">
          <label className={LBL}>Color</label>
          <button
            type="button"
            onClick={() => setColorModalOpen(true)}
            disabled={disabled}
            className={`${INPUT} w-full flex items-center gap-2 text-left`}
            data-testid="countdown-color-trigger"
          >
            <span
              className="w-4 h-4 rounded border border-[#D9D5D0] dark:border-[#363944] flex-shrink-0"
              style={{ backgroundColor: colorToHex(color) }}
              aria-hidden
            />
            <span className="flex-1 truncate font-mono">{color}</span>
            <Pipette className="w-3 h-3 text-meta" aria-hidden />
          </button>
        </div>
        <div className="flex-1">
          <label className={LBL}>Music (optional)</label>
          <button
            type="button"
            onClick={() => setTrackModalOpen(true)}
            disabled={disabled}
            className={`${INPUT} w-full flex items-center gap-2 text-left`}
            data-testid="countdown-music-trigger"
          >
            <Music2 className="w-3.5 h-3.5 text-meta flex-shrink-0" aria-hidden />
            <span className="flex-1 truncate">
              {soundIds.length === 0
                ? "None"
                : soundIds.length === 1
                  ? (tracks.find((t) => t.id === soundIds[0])?.display_name ?? soundIds[0])
                  : `${soundIds.length} tracks`}
            </span>
            {musicTotalSecs !== null && (
              <span className="text-[10px] text-meta font-mono tabular-nums">
                {fmtTime(musicTotalSecs)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Cap-violation hint */}
      {overMusicCap && musicTotalSecs !== null && (
        <p className="text-[11px] text-[#EF4444] -mt-2">
          Countdown ({fmtTime(totalSecs)}) is longer than your selected music
          ({fmtTime(musicTotalSecs)}). Add more tracks or shorten the countdown.
        </p>
      )}

      {colorModalOpen && (
        <ColorPickerModal
          value={color}
          onChange={setColor}
          onClose={() => setColorModalOpen(false)}
        />
      )}

      {trackModalOpen && (
        <TrackPickerModal
          tracks={tracks}
          selected={soundIds}
          onChange={setSoundIds}
          onClose={() => setTrackModalOpen(false)}
        />
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary flex items-center gap-1.5 text-sm"
        >
          <Play className="w-3.5 h-3.5" /> Start Countdown
        </button>
      </div>
    </form>
  );
}

// ── RecentList ────────────────────────────────────────────────────────────────

function RecentList({
  items,
  canManage,
  onDelete,
}: {
  items: CountdownState["recent"];
  canManage: boolean;
  onDelete: (id: number) => void;
}) {
  const recent = items.filter((c) => c.status !== "running" && c.status !== "paused");
  if (recent.length === 0) return null;

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Recent</h3>
      <div className="space-y-1">
        {recent.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between py-2 px-2 rounded-lg
                       hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                {c.title}
              </span>
              <span className="text-xs text-meta font-mono tabular-nums flex-shrink-0">
                {fmtTime(c.duration_secs)}
              </span>
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLORS[c.status] ?? ""}`}>
                {c.status}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[10px] text-meta">
                {c.finished_at ? timeAgo(c.finished_at) : timeAgo(c.created_at)}
              </span>
              {canManage && ["finished", "cancelled", "pending"].includes(c.status) && (
                <button
                  onClick={() => onDelete(c.id)}
                  className="p-1 rounded text-meta hover:text-[#EF4444] hover:bg-[#FEE2E2] dark:hover:bg-[#7F1D1D]/30 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

// ── PlayerPicker ──────────────────────────────────────────────────────────────
// Visual player selector: avatar grid + select-all / select-none + per-player
// toggle.  Uses mc-heads.net for avatars (same as the rest of the app).

function PlayerPicker({
  players,
  targetAll,
  setTargetAll,
  selected,
  onToggle,
  onAll,
  onNone,
  disabled,
}: {
  players:      McPlayer[];
  targetAll:    boolean;
  setTargetAll: (v: boolean) => void;
  selected:     Set<string>;
  onToggle:     (ign: string) => void;
  onAll:        () => void;
  onNone:       () => void;
  disabled:     boolean;
}) {
  return (
    <div>
      <label className={LBL}>Players</label>

      {/* Mode toggle: All vs Specific */}
      <div className="flex items-center gap-4 mb-2">
        <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
          <input
            type="radio"
            checked={targetAll}
            onChange={() => setTargetAll(true)}
            disabled={disabled}
            className="accent-[#5B9BF0]"
          />
          <Users className="w-3.5 h-3.5" /> Everyone online
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
          <input
            type="radio"
            checked={!targetAll}
            onChange={() => setTargetAll(false)}
            disabled={disabled}
            className="accent-[#5B9BF0]"
          />
          Select specific players
        </label>
      </div>

      {!targetAll && (
        <div className="space-y-2">
          {/* Party quick-select chips */}
          <PartyChipBar
            selected={selected}
            onChange={(next) => {
              // Replace the parent's set with the new one.  Iterate diff so we
              // call the toggle callback semantics correctly.
              const cur = new Set(selected);
              for (const ign of cur) {
                if (!next.has(ign)) onToggle(ign);
              }
              for (const ign of next) {
                if (!cur.has(ign)) onToggle(ign);
              }
            }}
          />
          {/* Select all / none controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAll}
              disabled={disabled || players.length === 0}
              className="btn-secondary text-[10px] flex items-center gap-1 px-2 py-1"
            >
              <CheckSquare className="w-3 h-3" aria-hidden /> Select all
            </button>
            <button
              type="button"
              onClick={onNone}
              disabled={disabled || selected.size === 0}
              className="btn-secondary text-[10px] flex items-center gap-1 px-2 py-1"
            >
              <XSquare className="w-3 h-3" aria-hidden /> Select none
            </button>
            <span className="ml-auto text-[10px] text-meta tabular-nums">
              {selected.size} / {players.length} selected
            </span>
          </div>

          {/* Avatar grid */}
          {players.length === 0 ? (
            <p className="text-[10px] text-meta italic p-2">
              No players found.  Has anyone joined the server yet?
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5
                            max-h-48 overflow-y-auto p-1 border border-[#D9D5D0] dark:border-[#363944]
                            rounded-lg bg-white dark:bg-[#2A2D38]">
              {players.map((p) => {
                const isSel = selected.has(p.ign);
                return (
                  <button
                    key={p.uuid || p.ign}
                    type="button"
                    onClick={() => onToggle(p.ign)}
                    disabled={disabled}
                    title={`${p.ign}${p.online ? " (online)" : ""}`}
                    className={`flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[10px]
                                transition-colors min-w-0 ${
                                  isSel
                                    ? "bg-[#5B9BF0] text-white"
                                    : "text-[#1C1E27] dark:text-[#EAECF0] hover:bg-[#F0EDE9] dark:hover:bg-[#363944]"
                                }`}
                  >
                    <span className="relative flex-shrink-0">
                      <img
                        src={`https://mc-heads.net/avatar/${encodeURIComponent(p.ign)}/24`}
                        alt=""
                        className="w-5 h-5 rounded"
                        loading="lazy"
                      />
                      {p.online && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#22C55E] ring-1 ring-white dark:ring-[#2A2D38]"
                          aria-label="online"
                        />
                      )}
                    </span>
                    <span className="truncate font-medium">{p.ign}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DisplayModeCard ───────────────────────────────────────────────────────────
// A checkbox+preview tile.  Each `kind` renders an SVG mock of what that
// display mode looks like in Minecraft.

function DisplayModeCard({
  kind,
  label,
  checked,
  onChange,
  disabled,
  color,
}: {
  kind: "actionbar" | "bossbar" | "title_final";
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  color: string;
}) {
  const hex = colorToHex(color);
  return (
    <label
      className={`flex flex-col items-stretch gap-1 p-2 rounded-lg border cursor-pointer
                  transition-colors ${
                    checked
                      ? "border-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F]/30"
                      : "border-[#D9D5D0] dark:border-[#363944] hover:border-[#9B9EA6]"
                  }`}
    >
      <DisplayPreview kind={kind} color={hex} />
      <div className="flex items-center gap-1.5 mt-0.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="accent-[#5B9BF0]"
        />
        <span className="text-[11px] font-medium text-[#1C1E27] dark:text-[#EAECF0]">
          {label}
        </span>
      </div>
    </label>
  );
}

function DisplayPreview({
  kind,
  color,
}: {
  kind: "actionbar" | "bossbar" | "title_final";
  color: string;
}) {
  // 96 × 56 viewbox = MC HUD aspect-ish.  Sky on top, ground on bottom.
  const skyTop    = "#5DA9FF";
  const skyBottom = "#9CCEFF";
  const ground    = "#7BAA48";

  return (
    <svg viewBox="0 0 96 56" className="w-full h-auto rounded border border-[#D9D5D0] dark:border-[#363944] bg-white">
      <defs>
        <linearGradient id={`sky-${kind}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={skyTop} />
          <stop offset="100%" stopColor={skyBottom} />
        </linearGradient>
      </defs>
      <rect width="96" height="44" fill={`url(#sky-${kind})`} />
      <rect y="44" width="96" height="12" fill={ground} />

      {/* Hotbar (always shown for context) */}
      <rect x="20" y="46" width="56" height="6" rx="0.5" fill="#1C1E27" opacity="0.85" />
      {Array.from({ length: 9 }).map((_, i) => (
        <rect
          key={i}
          x={20.5 + i * 6.2}
          y={46.5}
          width={5.5}
          height={5}
          fill="#3A3D48"
          stroke="#6B6E78"
          strokeWidth={0.2}
        />
      ))}

      {/* Mode-specific HUD element */}
      {kind === "bossbar" && (
        <>
          <rect x="14" y="3" width="68" height="5" rx="0.5" fill="#1C1E27" opacity="0.7" />
          <rect x="14" y="3" width="48" height="5" rx="0.5" fill={color} />
          <text x="48" y="14" textAnchor="middle" fontSize="3.5" fill="#FFF" fontWeight="bold">
            Build Comp  3:21
          </text>
        </>
      )}

      {kind === "actionbar" && (
        <text x="48" y="44" textAnchor="middle" fontSize="4" fill={color} fontWeight="bold">
          Build Comp  3:21
        </text>
      )}

      {kind === "title_final" && (
        <>
          <text x="48" y="26" textAnchor="middle" fontSize="14" fill={color} fontWeight="bold">3</text>
          <text x="48" y="35" textAnchor="middle" fontSize="3.5" fill="#FFF" fontWeight="bold" opacity="0.85">
            seconds!
          </text>
        </>
      )}
    </svg>
  );
}

// ── ColorPickerModal ──────────────────────────────────────────────────────────
// Compact modal — Minecraft swatch palette only.  Selecting a swatch commits
// the named colour and closes the modal.

function ColorPickerModal({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  function handleSwatch(swatchName: string) {
    onChange(swatchName);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Color picker"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-[#1C1E27] rounded-xl shadow-2xl w-full max-w-xs
                      border border-[#D9D5D0] dark:border-[#363944] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Pick a color</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>

        {/* Live swatch preview of current selection */}
        <div className="flex items-center gap-2">
          <span
            className="w-8 h-8 rounded-lg border border-[#D9D5D0] dark:border-[#363944] flex-shrink-0"
            style={{ backgroundColor: colorToHex(value) }}
            aria-hidden
          />
          <div className="text-[10px] text-meta font-mono truncate">{value}</div>
        </div>

        {/* Curated Minecraft palette */}
        <div>
          <label className={LBL}>Minecraft palette</label>
          <div className="grid grid-cols-5 gap-1.5">
            {COLOR_SWATCHES.map((s) => {
              const isSel = value === s.name;
              return (
                <button
                  key={s.name}
                  type="button"
                  onClick={() => handleSwatch(s.name)}
                  title={s.name}
                  className={`aspect-square rounded transition-transform hover:scale-110
                              ${isSel
                                ? "ring-2 ring-[#5B9BF0] ring-offset-1 ring-offset-white dark:ring-offset-[#1C1E27]"
                                : "border border-[#D9D5D0] dark:border-[#363944]"}`}
                  style={{ backgroundColor: s.hex }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── TrackPickerModal ──────────────────────────────────────────────────────────
// Multi-select track picker with disc icons + reorderable selection list.
// Selected order is preserved (it's the playback order).

function TrackPickerModal({
  tracks,
  selected,
  onChange,
  onClose,
}: {
  tracks:   SoundEntry[];
  selected: string[];
  onChange: (next: string[]) => void;
  onClose:  () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) =>
        t.display_name.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q),
    );
  }, [tracks, query]);

  const selectedSet = new Set(selected);
  const totalSecs   = selected
    .map((id) => tracks.find((t) => t.id === id)?.duration_secs ?? 0)
    .reduce((a, b) => a + b, 0);

  function toggle(id: string) {
    if (selectedSet.has(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  function move(id: string, dir: -1 | 1) {
    const i = selected.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pick music tracks"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-[#1C1E27] rounded-xl shadow-2xl w-full max-w-md
                      border border-[#D9D5D0] dark:border-[#363944] p-4 space-y-3
                      max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            Pick music tracks
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>

        {/* Selected order (drag-free ↕ controls) */}
        {selected.length > 0 && (
          <div className="space-y-1 border border-[#D9D5D0] dark:border-[#363944] rounded-lg p-2 bg-[#F7F5F2] dark:bg-[#2A2D38]">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider text-meta font-medium">
                Play order
              </span>
              <span className="text-[10px] text-meta font-mono tabular-nums">
                {Math.floor(totalSecs / 60)}:{String(totalSecs % 60).padStart(2, "0")} total
              </span>
            </div>
            {selected.map((id, i) => {
              const t = tracks.find((x) => x.id === id);
              return (
                <div key={id} className="flex items-center gap-1.5 text-xs">
                  <span className="w-4 text-meta font-mono text-right">{i + 1}.</span>
                  <DiscIcon soundId={id} imageUrl={t?.image_url ?? null} size={18} />
                  <span className="flex-1 truncate text-[#1C1E27] dark:text-[#EAECF0]">
                    {t?.display_name ?? id}
                  </span>
                  <button
                    type="button"
                    onClick={() => move(id, -1)}
                    disabled={i === 0}
                    className="p-0.5 text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0] disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(id, 1)}
                    disabled={i === selected.length - 1}
                    className="p-0.5 text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0] disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="p-0.5 text-meta hover:text-[#EF4444]"
                    aria-label="Remove"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Search */}
        <input
          type="text"
          placeholder="Search tracks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${INPUT} w-full`}
        />

        {/* Track grid */}
        <div className="grid grid-cols-3 gap-1.5 overflow-y-auto pr-1 -mr-1 min-h-0">
          {filtered.length === 0 && (
            <p className="col-span-3 text-xs text-meta italic text-center py-6">
              No tracks match.
            </p>
          )}
          {filtered.map((t) => {
            const isSel = selectedSet.has(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                title={`${t.display_name} — ${t.artist}`}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors
                            ${isSel
                              ? "border-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F]/30"
                              : "border-[#D9D5D0] dark:border-[#363944] hover:border-[#9B9EA6]"}`}
              >
                <DiscIcon
                  soundId={t.id}
                  imageUrl={t.image_url}
                  size={40}
                  label={t.display_name}
                />
                <span className="text-[10px] font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate w-full text-center">
                  {t.display_name}
                </span>
                <span className="text-[9px] text-meta font-mono tabular-nums">
                  {Math.floor(t.duration_secs / 60)}:{String(t.duration_secs % 60).padStart(2, "0")}
                </span>
              </button>
            );
          })}
        </div>

        {/* Done */}
        <div className="flex justify-end gap-2 pt-1 border-t border-[#D9D5D0] dark:border-[#363944]">
          <button type="button" onClick={() => onChange([])} className="btn-secondary text-xs">
            Clear
          </button>
          <button type="button" onClick={onClose} className="btn-primary text-xs">
            Done ({selected.length})
          </button>
        </div>
      </div>
    </div>
  );
}

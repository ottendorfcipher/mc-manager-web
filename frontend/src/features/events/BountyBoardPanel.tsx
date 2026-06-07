import { useState } from "react";
import { useEventStream } from "@/hooks/useEventStream";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Target, Play, Pause, X, Trash2, Trophy, ChevronDown, Plus, Minus,
  Crown, Crosshair, MapPin,
} from "lucide-react";
import { api } from "@/api/client";
import type {
  BountyBoardState, ActiveBountyBoard, BountyBoard, LeaderboardEntry,
  TrackedStat, RisingOceanState,
} from "@/types";

// ── Shared style tokens (same as EventsPage) ────────────────────────────────

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
  "disabled:opacity-50",
].join(" ");

const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

const STATUS_BADGE: Record<string, string> = {
  running:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused:    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  finished:  "bg-[#EFF6FF] text-[#5B9BF0] dark:bg-[#1E3A5F] dark:text-[#93C5FD]",
  cancelled: "bg-[#F0EDE9] text-[#9B9EA6] dark:bg-[#2A2D38] dark:text-[#6B6E78]",
  pending:   "bg-[#F0EDE9] text-[#6B6E78] dark:bg-[#2A2D38] dark:text-[#9B9EA6]",
};

// ── Panel ────────────────────────────────────────────────────────────────────

export function BountyBoardPanel({
  canManage,
}: {
  canManage: boolean;
}) {
  const qc = useQueryClient();

  // ── State query ───────────────────────────────────────────────────────────
  const { data: bbState } = useQuery<BountyBoardState>({
    queryKey:        ["bounty-board-state"],
    queryFn:         () => api.get("/events/bounty-board/state"),
    refetchInterval: 10_000,
  });

  // ── SSE stream (reconnecting) ──────────────────────────────────────────────
  useEventStream<BountyBoardState>("/api/events/bounty-board/stream", {
    onMessage: (data) => qc.setQueryData<BountyBoardState>(["bounty-board-state"], data),
  });

  const active = bbState?.active ?? null;

  // ── Rising Oceans query (for pairing dropdown) ────────────────────────────
  const { data: roState } = useQuery<RisingOceanState>({
    queryKey:  ["rising-oceans-state"],
    queryFn:   () => api.get("/events/rising-oceans/state"),
    staleTime: 30_000,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (body: CreateBBBody) => api.post("/events/bounty-board", body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["bounty-board-state"] }),
  });

  const startMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/bounty-board/${id}/start`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["bounty-board-state"] }),
  });

  const pauseMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/bounty-board/${id}/pause`),
  });

  const resumeMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/bounty-board/${id}/resume`),
  });

  const finishMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/bounty-board/${id}/finish`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["bounty-board-state"] }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/bounty-board/${id}/cancel`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["bounty-board-state"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/events/bounty-board/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["bounty-board-state"] }),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Active event card */}
      {active && (
        <ActiveBBCard
          active={active}
          canManage={canManage}
          onPause={() => pauseMut.mutate(active.id)}
          onResume={() => resumeMut.mutate(active.id)}
          onFinish={() => finishMut.mutate(active.id)}
          onCancel={() => cancelMut.mutate(active.id)}
          pausePending={pauseMut.isPending}
          resumePending={resumeMut.isPending}
          finishPending={finishMut.isPending}
          cancelPending={cancelMut.isPending}
        />
      )}

      {/* Create form */}
      {canManage && (
        <CreateBBForm
          disabled={!!active}
          loading={createMut.isPending}
          error={createMut.error?.message ?? null}
          roRecent={roState?.recent ?? []}
          onSubmit={(body) => createMut.mutate(body)}
        />
      )}

      {/* Empty state */}
      {!canManage && !active && (bbState?.recent ?? []).length === 0 && (
        <div className="card text-center py-8">
          <Target className="w-8 h-8 text-[#9B9EA6] mx-auto mb-2" aria-hidden />
          <p className="text-sm text-meta">No Bounty Board events yet.</p>
          <p className="text-[10px] text-meta mt-1">
            An admin can create one to track player stats and deliver bounty rewards.
          </p>
        </div>
      )}

      {/* Recent events */}
      <RecentBBList
        items={bbState?.recent ?? []}
        active={active}
        canManage={canManage}
        hasActive={!!active}
        onStart={(id) => startMut.mutate(id)}
        onDelete={(id) => deleteMut.mutate(id)}
        startPending={startMut.isPending}
      />
    </div>
  );
}

// ── Active Bounty Board card ─────────────────────────────────────────────────

function ActiveBBCard({
  active,
  canManage,
  onPause,
  onResume,
  onFinish,
  onCancel,
  pausePending,
  resumePending,
  finishPending,
  cancelPending,
}: {
  active: ActiveBountyBoard;
  canManage: boolean;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onCancel: () => void;
  pausePending: boolean;
  resumePending: boolean;
  finishPending: boolean;
  cancelPending: boolean;
}) {
  const paused = active.status === "paused";
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-amber-500" aria-hidden />
          <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            {active.title}
          </span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_BADGE[active.status] ?? ""}`}>
            {active.status}
          </span>
        </div>
      </div>

      {/* Leaderboard */}
      <Leaderboard
        entries={active.leaderboard}
        trackedStats={active.tracked_stats}
      />

      {/* Stats info row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <Stat
          label="Coord Broadcast"
          value={formatDuration(active.coord_broadcast_interval_secs)}
        />
        <Stat
          label="Score Threshold"
          value={`${active.coord_broadcast_threshold} pts`}
        />
        <Stat
          label="Reward Interval"
          value={formatDuration(active.reward_interval_secs)}
        />
        <Stat
          label="Reward Items"
          value={formatRewardItems(active.reward_items_json)}
        />
      </div>

      {/* Controls */}
      {canManage && (
        <div className="flex gap-2 flex-wrap">
          {paused ? (
            <button onClick={onResume} disabled={resumePending}
              className="btn-primary text-xs flex items-center gap-1.5">
              <Play className="w-3.5 h-3.5" aria-hidden /> Resume
            </button>
          ) : (
            <button onClick={onPause} disabled={pausePending}
              className="btn-secondary text-xs flex items-center gap-1.5">
              <Pause className="w-3.5 h-3.5" aria-hidden /> Pause
            </button>
          )}
          {!confirmFinish ? (
            <button
              onClick={() => setConfirmFinish(true)}
              className="btn-secondary text-xs flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"
            >
              <Trophy className="w-3.5 h-3.5" aria-hidden /> Finish
            </button>
          ) : (
            <button
              onClick={() => { onFinish(); setConfirmFinish(false); }}
              disabled={finishPending}
              className="btn-primary text-xs flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 animate-pulse"
            >
              Confirm Finish
            </button>
          )}
          {!confirmCancel ? (
            <button
              onClick={() => setConfirmCancel(true)}
              className="btn-secondary text-xs flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <X className="w-3.5 h-3.5" aria-hidden /> Cancel
            </button>
          ) : (
            <button
              onClick={() => { onCancel(); setConfirmCancel(false); }}
              disabled={cancelPending}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors animate-pulse"
            >
              Confirm Cancel
            </button>
          )}
        </div>
      )}

      {/* Meta */}
      <div className="flex items-center gap-1.5 text-[10px] text-meta flex-wrap">
        <span>World: {active.world_slug}</span>
        <span>&middot;</span>
        <span>Created by {active.created_by}</span>
        {active.rising_oceans_id && (
          <>
            <span>&middot;</span>
            <span className="text-blue-500">Paired with Rising Oceans #{active.rising_oceans_id}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

function Leaderboard({
  entries,
  trackedStats,
}: {
  entries: LeaderboardEntry[];
  trackedStats: TrackedStat[];
}) {
  if (entries.length === 0) {
    return (
      <div className="bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg px-4 py-6 text-center">
        <Crosshair className="w-6 h-6 text-[#9B9EA6] mx-auto mb-1.5" aria-hidden />
        <p className="text-xs text-meta">No scores recorded yet.</p>
        <p className="text-[10px] text-meta">Stats are polled every 30 seconds.</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <h3 className="text-[10px] font-medium text-meta uppercase tracking-wider">Leaderboard</h3>
      <div className="space-y-1">
        {entries.map((entry, rank) => (
          <LeaderboardRow
            key={entry.player_uuid}
            entry={entry}
            rank={rank + 1}
            trackedStats={trackedStats}
          />
        ))}
      </div>
    </div>
  );
}

function LeaderboardRow({
  entry,
  rank,
  trackedStats,
}: {
  entry: LeaderboardEntry;
  rank: number;
  trackedStats: TrackedStat[];
}) {
  const [expanded, setExpanded] = useState(false);
  const medalColor = rank === 1 ? "text-amber-500" : rank === 2 ? "text-gray-400" : rank === 3 ? "text-amber-700" : "text-transparent";

  return (
    <div className="bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#E8E5E0] dark:hover:bg-[#363944] transition-colors"
      >
        {/* Rank */}
        <span className="flex items-center justify-center w-5 flex-shrink-0">
          {rank <= 3 ? (
            <Crown className={`w-3.5 h-3.5 ${medalColor}`} aria-hidden />
          ) : (
            <span className="text-[10px] text-meta font-mono">{rank}</span>
          )}
        </span>

        {/* Avatar + IGN */}
        <img
          src={`https://mc-heads.net/avatar/${entry.player_ign}/20`}
          alt={entry.player_ign}
          className="w-5 h-5 rounded image-rendering-pixelated flex-shrink-0"
          loading="lazy"
        />
        <span className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0] font-mono flex-1 min-w-0 truncate">
          {entry.player_ign}
        </span>

        {/* Score */}
        <span className="text-xs font-bold text-[#1C1E27] dark:text-[#EAECF0] flex-shrink-0">
          {entry.total_score.toFixed(1)}
        </span>

        {/* Expand chevron */}
        <ChevronDown
          className={`w-3 h-3 text-meta transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {/* Expanded stat breakdown */}
      {expanded && (
        <div className="px-3 pb-2 pt-0 border-t border-[#E8E5E0] dark:border-[#363944]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 pt-2">
            {trackedStats.map((ts) => {
              const score = entry.stat_scores.find((s) => s.stat_key === ts.stat_key);
              return (
                <div key={ts.stat_key} className="flex items-center justify-between text-[10px]">
                  <span className="text-meta truncate mr-2">{ts.label}</span>
                  <span className="font-mono text-[#1C1E27] dark:text-[#EAECF0] flex-shrink-0">
                    {score ? formatStatValue(score.delta, ts.stat_key) : "0"}
                    <span className="text-meta ml-1">
                      ({score ? `+${score.weighted.toFixed(1)}` : "+0"})
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create form ──────────────────────────────────────────────────────────────

interface CreateBBBody {
  title:                         string;
  coord_broadcast_interval_secs: number;
  coord_broadcast_threshold:     number;
  reward_interval_secs:          number;
  reward_items_json:             string;
  rising_oceans_id?:             number;
}

interface RewardItem {
  itemId: string;
  count:  number;
}

function CreateBBForm({
  disabled,
  loading,
  error,
  roRecent,
  onSubmit,
}: {
  disabled: boolean;
  loading: boolean;
  error: string | null;
  roRecent: { id: number; status: string; start_y: number; end_y: number }[];
  onSubmit: (body: CreateBBBody) => void;
}) {
  const [title, setTitle] = useState("");

  // Coord broadcast interval (minutes)
  const [coordMins, setCoordMins] = useState(5);

  // Coord broadcast threshold
  const [threshold, setThreshold] = useState(10);

  // Reward interval (minutes)
  const [rewardMins, setRewardMins] = useState(10);

  // Reward items
  const [rewardItems, setRewardItems] = useState<RewardItem[]>([
    { itemId: "minecraft:diamond", count: 3 },
  ]);

  // Rising Oceans pairing
  const [roId, setRoId] = useState<string>("");

  // Eligible RO events: pending ones that could be started alongside
  const eligibleRo = roRecent.filter(
    (r) => r.status === "pending" || r.status === "running" || r.status === "paused"
  );

  const addRewardItem = () => {
    setRewardItems([...rewardItems, { itemId: "minecraft:diamond", count: 1 }]);
  };

  const removeRewardItem = (index: number) => {
    setRewardItems(rewardItems.filter((_, i) => i !== index));
  };

  const updateRewardItem = (index: number, field: keyof RewardItem, value: string | number) => {
    setRewardItems(
      rewardItems.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  };

  const handleSubmit = () => {
    if (!title.trim() || coordMins < 1 || rewardMins < 1) return;

    const itemsJson = JSON.stringify(
      rewardItems
        .filter((r) => r.itemId.trim())
        .map((r) => `${r.itemId.trim()} ${r.count}`)
    );

    onSubmit({
      title:                         title.trim(),
      coord_broadcast_interval_secs: coordMins * 60,
      coord_broadcast_threshold:     threshold,
      reward_interval_secs:          rewardMins * 60,
      reward_items_json:             itemsJson,
      rising_oceans_id:              roId ? Number(roId) : undefined,
    });
  };

  const canSubmit =
    title.trim().length > 0 &&
    coordMins >= 1 &&
    rewardMins >= 1 &&
    rewardItems.length > 0 &&
    !disabled &&
    !loading;

  return (
    <div className={`card space-y-3 ${disabled ? "opacity-60 pointer-events-none" : ""}`}>
      <h2 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
        New Bounty Board
      </h2>

      {/* Title */}
      <div>
        <label className={LBL}>Title</label>
        <input
          className={`${INPUT} w-full`}
          placeholder="e.g. Diamond Rush"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Coordinate broadcast */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LBL}>
            <MapPin className="inline w-3 h-3 mr-0.5" aria-hidden />
            Coord Broadcast (min)
          </label>
          <input
            type="number"
            className={`${INPUT} w-full`}
            min={1}
            value={coordMins}
            onChange={(e) => setCoordMins(Math.max(1, Number(e.target.value)))}
          />
          <p className="text-[10px] text-meta mt-0.5">How often the leader's coords are shown</p>
        </div>
        <div className="flex-1">
          <label className={LBL}>Score Threshold</label>
          <input
            type="number"
            className={`${INPUT} w-full`}
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(0, Number(e.target.value)))}
          />
          <p className="text-[10px] text-meta mt-0.5">Min score before coords are broadcast</p>
        </div>
      </div>

      {/* Reward interval */}
      <div>
        <label className={LBL}>
          <Trophy className="inline w-3 h-3 mr-0.5" aria-hidden />
          Reward Interval (min)
        </label>
        <input
          type="number"
          className={`${INPUT} w-full`}
          min={1}
          value={rewardMins}
          onChange={(e) => setRewardMins(Math.max(1, Number(e.target.value)))}
        />
        <p className="text-[10px] text-meta mt-0.5">How often the top player receives reward items</p>
      </div>

      {/* Reward items */}
      <fieldset>
        <legend className={LBL}>Reward Items</legend>
        <div className="space-y-2">
          {rewardItems.map((item, idx) => (
            <div key={idx} className="flex gap-2 items-center">
              <input
                className={`${INPUT} flex-1`}
                placeholder="minecraft:diamond"
                value={item.itemId}
                onChange={(e) => updateRewardItem(idx, "itemId", e.target.value)}
              />
              <input
                type="number"
                className={`${INPUT} w-16`}
                min={1}
                max={64}
                value={item.count}
                onChange={(e) => updateRewardItem(idx, "count", Math.max(1, Math.min(64, Number(e.target.value))))}
              />
              {rewardItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRewardItem(idx)}
                  className="p-1 rounded text-meta hover:text-red-500 transition-colors"
                  title="Remove item"
                >
                  <Minus className="w-3.5 h-3.5" aria-hidden />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addRewardItem}
            className="text-[10px] text-[#5B9BF0] hover:underline flex items-center gap-1"
          >
            <Plus className="w-3 h-3" aria-hidden /> Add item
          </button>
        </div>
      </fieldset>

      {/* Rising Oceans pairing */}
      {eligibleRo.length > 0 && (
        <div>
          <label className={LBL}>
            Pair with Rising Oceans (optional)
          </label>
          <div className="relative">
            <select
              className={`${INPUT} w-full appearance-none pr-7`}
              value={roId}
              onChange={(e) => setRoId(e.target.value)}
            >
              <option value="">None</option>
              {eligibleRo.map((r) => (
                <option key={r.id} value={r.id}>
                  Rising Oceans #{r.id} (Y {r.start_y} &rarr; {r.end_y}) &mdash; {r.status}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-meta absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden />
          </div>
          <p className="text-[10px] text-meta mt-0.5">
            Link this bounty board to a Rising Oceans event for combined gameplay
          </p>
        </div>
      )}

      {/* Tracked stats info */}
      <div className="bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg px-3 py-2 text-xs space-y-1">
        <span className="text-[10px] font-medium text-meta uppercase tracking-wider">Tracked Stats</span>
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          <StatPreview label="Diamonds Mined" weight={5.0} mode="delta" />
          <StatPreview label="Mob Kills" weight={1.0} mode="delta" />
          <StatPreview label="Player Kills" weight={10.0} mode="delta" />
          <StatPreview label="Survival Time" weight={0.1} mode="peak" />
        </div>
        <p className="text-[10px] text-meta mt-1">
          Score = sum of (stat value &times; weight). Stats begin tracking when the event starts.
        </p>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="btn-primary w-full text-sm flex items-center justify-center gap-2"
      >
        {loading ? (
          <span className="animate-spin">&#8635;</span>
        ) : (
          <Target className="w-4 h-4" aria-hidden />
        )}
        Create Bounty Board
      </button>
      <p className="text-[10px] text-meta text-center">
        After creating, you can start the event from the recent list below.
      </p>
    </div>
  );
}

function StatPreview({ label, weight, mode }: { label: string; weight: number; mode: string }) {
  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="text-[#1C1E27] dark:text-[#EAECF0]">{label}</span>
      <span className="text-meta">
        &times;{weight} <span className="opacity-60">({mode})</span>
      </span>
    </div>
  );
}

// ── Recent events list ───────────────────────────────────────────────────────

function RecentBBList({
  items,
  active,
  canManage,
  hasActive,
  onStart,
  onDelete,
  startPending,
}: {
  items: BountyBoard[];
  active: ActiveBountyBoard | null;
  canManage: boolean;
  hasActive: boolean;
  onStart: (id: number) => void;
  onDelete: (id: number) => void;
  startPending: boolean;
}) {
  const past = items.filter((r) => !active || r.id !== active.id);
  if (past.length === 0) return null;

  return (
    <div className="card space-y-2">
      <h2 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Recent</h2>
      <div className="divide-y divide-[#E8E5E0] dark:divide-[#363944]">
        {past.map((r) => (
          <div key={r.id} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Target className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" aria-hidden />
                <span className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                  {r.title}
                </span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_BADGE[r.status] ?? ""}`}>
                  {r.status}
                </span>
                {r.rising_oceans_id && (
                  <span className="text-[10px] text-blue-500">+ RO</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-[10px] text-meta">
                  {relativeTime(r.finished_at ?? r.started_at ?? r.created_at)}
                </span>
                {canManage && r.status === "pending" && !hasActive && (
                  <button
                    onClick={() => onStart(r.id)}
                    disabled={startPending}
                    className="text-[10px] font-medium px-2 py-1 rounded bg-[#5B9BF0] text-white hover:bg-[#4A8ADF] transition-colors flex items-center gap-1"
                  >
                    <Play className="w-3 h-3" aria-hidden /> Start
                  </button>
                )}
                {canManage && ["finished", "cancelled", "pending"].includes(r.status) && (
                  <button
                    onClick={() => onDelete(r.id)}
                    className="p-1 rounded text-meta hover:text-red-500 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Stat info row (same pattern as RisingOceansPanel) ────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg px-2 py-1.5">
      <span className="block text-[9px] uppercase tracking-wider text-meta">{label}</span>
      <span className="text-[11px] font-medium text-[#1C1E27] dark:text-[#EAECF0]">{value}</span>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(totalSecs: number): string {
  if (totalSecs <= 0) return "0s";
  const hours = Math.floor(totalSecs / 3600);
  const mins  = Math.floor((totalSecs % 3600) / 60);
  const secs  = totalSecs % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (mins  > 0) parts.push(`${mins}m`);
  if (secs  > 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

function formatRewardItems(json: string): string {
  try {
    const items: string[] = JSON.parse(json);
    return items
      .map((s) => {
        const parts = s.split(" ");
        const name = (parts[0] ?? "").replace("minecraft:", "");
        const count = parts[1] ?? "1";
        return `${count}x ${name}`;
      })
      .join(", ");
  } catch {
    return "—";
  }
}

function formatStatValue(value: number, statKey: string): string {
  if (statKey === "survival_time") {
    // Value is in seconds for peak stats
    const mins = Math.floor(value / 60);
    const secs = value % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }
  return value.toLocaleString();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso + "Z").getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

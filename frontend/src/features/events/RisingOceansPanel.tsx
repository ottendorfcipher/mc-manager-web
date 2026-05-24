import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Waves, Play, Pause, X, Trash2, RotateCcw, Check,
  AlertTriangle,
} from "lucide-react";
import { api } from "@/api/client";
import type { RisingOceanState, RisingOcean } from "@/types";

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

export function RisingOceansPanel({
  canCreate,
  canManage,
}: {
  canCreate: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();

  // ── State query ───────────────────────────────────────────────────────────
  const { data: roState } = useQuery<RisingOceanState>({
    queryKey:        ["rising-oceans-state"],
    queryFn:         () => api.get("/events/rising-oceans/state"),
    refetchInterval: 5_000,
  });

  // ── SSE stream ────────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource("/api/events/rising-oceans/stream", { withCredentials: true });
    es.onmessage = (e) => {
      try {
        qc.setQueryData<RisingOceanState>(["rising-oceans-state"], JSON.parse(e.data));
      } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  }, [qc]);

  const active = roState?.active ?? null;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (body: CreateROBody) => api.post("/events/rising-oceans", body),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["rising-oceans-state"] }),
  });

  const startMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/rising-oceans/${id}/start`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["rising-oceans-state"] }),
  });

  const pauseMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/rising-oceans/${id}/pause`),
  });

  const resumeMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/rising-oceans/${id}/resume`),
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/rising-oceans/${id}/cancel`),
  });

  const revertMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/rising-oceans/${id}/revert`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["rising-oceans-state"] }),
  });

  const keepMut = useMutation({
    mutationFn: (id: number) => api.post(`/events/rising-oceans/${id}/keep`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["rising-oceans-state"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/events/rising-oceans/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["rising-oceans-state"] }),
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Active event card */}
      {active && (
        <ActiveROCard
          active={active}
          canManage={canManage}
          onPause={() => pauseMut.mutate(active.id)}
          onResume={() => resumeMut.mutate(active.id)}
          onCancel={() => cancelMut.mutate(active.id)}
          pausePending={pauseMut.isPending}
          resumePending={resumeMut.isPending}
          cancelPending={cancelMut.isPending}
        />
      )}

      {/* Create form */}
      {canCreate && (
        <CreateROForm
          disabled={!!active}
          loading={createMut.isPending}
          error={createMut.error?.message ?? null}
          onSubmit={(body) => createMut.mutate(body)}
        />
      )}

      {/* Empty state — no permission and nothing to show */}
      {!canCreate && !active && (roState?.recent ?? []).length === 0 && (
        <div className="card text-center py-8">
          <Waves className="w-8 h-8 text-[#9B9EA6] mx-auto mb-2" aria-hidden />
          <p className="text-sm text-meta">No Rising Oceans events yet.</p>
          <p className="text-[10px] text-meta mt-1">
            An admin can create one to gradually raise the ocean level in-game.
          </p>
        </div>
      )}

      {/* Recent events */}
      <RecentROList
        items={roState?.recent ?? []}
        active={active}
        canManage={canManage}
        onStart={(id) => startMut.mutate(id)}
        onRevert={(id) => revertMut.mutate(id)}
        onKeep={(id) => keepMut.mutate(id)}
        onDelete={(id) => deleteMut.mutate(id)}
        startPending={startMut.isPending}
        revertPending={revertMut.isPending}
        keepPending={keepMut.isPending}
      />
    </div>
  );
}

// ── Active event card ────────────────────────────────────────────────────────

function ActiveROCard({
  active,
  canManage,
  onPause,
  onResume,
  onCancel,
  pausePending,
  resumePending,
  cancelPending,
}: {
  active: NonNullable<RisingOceanState["active"]>;
  canManage: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  pausePending: boolean;
  resumePending: boolean;
  cancelPending: boolean;
}) {
  const totalLevels = active.end_y - active.start_y;
  const filledLevels = active.current_y - active.start_y;
  const pct = totalLevels > 0 ? (filledLevels / totalLevels) * 100 : 0;
  const paused = active.status === "paused";

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves className="w-4 h-4 text-blue-500" aria-hidden />
          <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            Rising Oceans
          </span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_BADGE[active.status] ?? ""}`}>
            {active.status}
          </span>
        </div>
        <span className="font-mono text-sm font-bold text-[#1C1E27] dark:text-[#EAECF0]">
          Y {active.current_y} / {active.end_y}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 rounded-full bg-[#E8E5E0] dark:bg-[#363944] overflow-hidden"
           role="progressbar" aria-valuenow={filledLevels} aria-valuemax={totalLevels}>
        <div
          className="h-full rounded-full bg-blue-500 transition-all duration-500 ease-linear"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
        <Stat label="Center" value={`${active.center_x}, ${active.center_z}`} />
        <Stat label="Radius" value={`${active.radius} blocks`} />
        <Stat label="Y range" value={`${active.start_y} → ${active.end_y}`} />
        <Stat label="Interval" value={`${formatDuration(active.interval_secs)} / level`} />
      </div>

      {/* Controls */}
      {canManage && (
        <div className="flex gap-2">
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
          <button
            onClick={onCancel}
            disabled={cancelPending}
            className="btn-secondary text-xs flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <X className="w-3.5 h-3.5" aria-hidden /> Cancel
          </button>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[10px] text-meta">
        <span>World: {active.world_slug}</span>
        <span>&middot;</span>
        <span>Created by {active.created_by}</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg px-2 py-1.5">
      <span className="block text-[9px] uppercase tracking-wider text-meta">{label}</span>
      <span className="text-[11px] font-medium text-[#1C1E27] dark:text-[#EAECF0]">{value}</span>
    </div>
  );
}

// ── Create form ──────────────────────────────────────────────────────────────

interface CreateROBody {
  center_x:      number;
  center_z:      number;
  radius:        number;
  start_y:       number;
  end_y:         number;
  interval_secs: number;
}

function CreateROForm({
  disabled,
  loading,
  error,
  onSubmit,
}: {
  disabled: boolean;
  loading: boolean;
  error: string | null;
  onSubmit: (body: CreateROBody) => void;
}) {
  const [centerX, setCenterX] = useState(0);
  const [centerZ, setCenterZ] = useState(0);
  const [radius, setRadius] = useState(256);
  const [startY, setStartY] = useState(64);
  const [endY, setEndY] = useState(100);

  // Interval per level — broken into d/h/m/s
  const [intDays, setIntDays] = useState(0);
  const [intHours, setIntHours] = useState(0);
  const [intMins, setIntMins] = useState(0);
  const [intSecs, setIntSecs] = useState(30);

  const intervalSecs = intDays * 86400 + intHours * 3600 + intMins * 60 + intSecs;

  const handleSubmit = () => {
    onSubmit({
      center_x:      centerX,
      center_z:      centerZ,
      radius,
      start_y:       startY,
      end_y:         endY,
      interval_secs: intervalSecs,
    });
  };

  const totalLevels = endY - startY;
  const totalTimeSecs = totalLevels > 0 ? totalLevels * intervalSecs : 0;
  const MAX_DURATION_SECS = 90 * 86400; // 90 days
  const durationExceedsMax = totalTimeSecs > MAX_DURATION_SECS;

  const valid =
    radius >= 16 && radius <= 1024 &&
    startY >= -64 && startY <= 319 &&
    endY > startY && endY <= 319 &&
    intervalSecs >= 5 &&
    !durationExceedsMax;

  const canSubmit = valid && !disabled && !loading;

  return (
    <div className={`card space-y-3 ${disabled ? "opacity-60 pointer-events-none" : ""}`}>
      <h2 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
        New Rising Oceans Event
      </h2>

      {/* Center coordinates */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LBL}>Center X</label>
          <input type="number" className={`${INPUT} w-full`}
            value={centerX} onChange={(e) => setCenterX(Number(e.target.value))} />
        </div>
        <div className="flex-1">
          <label className={LBL}>Center Z</label>
          <input type="number" className={`${INPUT} w-full`}
            value={centerZ} onChange={(e) => setCenterZ(Number(e.target.value))} />
        </div>
      </div>

      {/* Radius */}
      <div>
        <label className={LBL}>Radius (blocks)</label>
        <input type="number" className={`${INPUT} w-full`}
          min={16} max={1024}
          value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        <p className="text-[10px] text-meta mt-0.5">16–1024 blocks from center</p>
      </div>

      {/* Y range */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className={LBL}>Start Y</label>
          <input type="number" className={`${INPUT} w-full`}
            min={-64} max={319}
            value={startY} onChange={(e) => setStartY(Number(e.target.value))} />
        </div>
        <div className="flex-1">
          <label className={LBL}>End Y</label>
          <input type="number" className={`${INPUT} w-full`}
            min={-64} max={319}
            value={endY} onChange={(e) => setEndY(Number(e.target.value))} />
        </div>
      </div>

      {/* Interval per level */}
      <fieldset>
        <legend className={LBL}>Time per level</legend>
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Days</label>
            <input type="number" className={`${INPUT} w-full`}
              min={0} max={90}
              value={intDays} onChange={(e) => setIntDays(Math.max(0, Number(e.target.value)))} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Hours</label>
            <input type="number" className={`${INPUT} w-full`}
              min={0} max={23}
              value={intHours} onChange={(e) => setIntHours(Math.max(0, Math.min(23, Number(e.target.value))))} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Minutes</label>
            <input type="number" className={`${INPUT} w-full`}
              min={0} max={59}
              value={intMins} onChange={(e) => setIntMins(Math.max(0, Math.min(59, Number(e.target.value))))} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Seconds</label>
            <input type="number" className={`${INPUT} w-full`}
              min={0} max={59}
              value={intSecs} onChange={(e) => setIntSecs(Math.max(0, Math.min(59, Number(e.target.value))))} />
          </div>
        </div>
        {intervalSecs < 5 && (
          <p className="text-[10px] text-red-500 mt-0.5">Minimum 5 seconds per level</p>
        )}
      </fieldset>

      {/* Estimated total duration */}
      {totalLevels > 0 && (
        <div className={`rounded-lg px-3 py-2 text-xs ${
          durationExceedsMax
            ? "bg-red-50 dark:bg-red-900/20 ring-1 ring-red-200 dark:ring-red-800"
            : "bg-[#F0EDE9] dark:bg-[#2A2D38]"
        }`}>
          <span className="text-meta">Estimated duration: </span>
          <span className={`font-medium ${
            durationExceedsMax
              ? "text-red-600 dark:text-red-400"
              : "text-[#1C1E27] dark:text-[#EAECF0]"
          }`}>
            {formatDuration(totalTimeSecs)}
          </span>
          <span className="text-meta"> &middot; {totalLevels} levels</span>
          {durationExceedsMax && (
            <p className="text-[10px] text-red-500 mt-1">
              Exceeds the 90-day maximum. Reduce the interval or Y range.
            </p>
          )}
        </div>
      )}

      {/* Backup notice */}
      <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
        <span>
          A full world backup is automatically created before the event starts.
          You can revert to it after the event ends.
        </span>
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
          <Waves className="w-4 h-4" aria-hidden />
        )}
        Create Event
      </button>
    </div>
  );
}

// ── Recent events list ───────────────────────────────────────────────────────

function RecentROList({
  items,
  active,
  canManage,
  onStart,
  onRevert,
  onKeep,
  onDelete,
  startPending,
  revertPending,
  keepPending,
}: {
  items: RisingOcean[];
  active: RisingOceanState["active"];
  canManage: boolean;
  onStart: (id: number) => void;
  onRevert: (id: number) => void;
  onKeep: (id: number) => void;
  onDelete: (id: number) => void;
  startPending: boolean;
  revertPending: boolean;
  keepPending: boolean;
}) {
  // Filter out the actively-displayed event
  const past = items.filter((r) => !active || r.id !== active.id);
  if (past.length === 0) return null;

  return (
    <div className="card space-y-2">
      <h2 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Recent</h2>
      <div className="divide-y divide-[#E8E5E0] dark:divide-[#363944]">
        {past.map((r) => (
          <RecentROItem
            key={r.id}
            item={r}
            hasActive={!!active}
            canManage={canManage}
            onStart={onStart}
            onRevert={onRevert}
            onKeep={onKeep}
            onDelete={onDelete}
            startPending={startPending}
            revertPending={revertPending}
            keepPending={keepPending}
          />
        ))}
      </div>
    </div>
  );
}

function RecentROItem({
  item,
  hasActive,
  canManage,
  onStart,
  onRevert,
  onKeep,
  onDelete,
  startPending,
  revertPending,
  keepPending,
}: {
  item: RisingOcean;
  hasActive: boolean;
  canManage: boolean;
  onStart: (id: number) => void;
  onRevert: (id: number) => void;
  onKeep: (id: number) => void;
  onDelete: (id: number) => void;
  startPending: boolean;
  revertPending: boolean;
  keepPending: boolean;
}) {
  const [confirmRevert, setConfirmRevert] = useState(false);

  const needsDecision =
    ["finished", "cancelled"].includes(item.status) &&
    item.reverted === null &&
    item.backup_path;

  const isReverted = item.reverted === 1;
  const isKept = item.reverted === 0;

  return (
    <div className="py-2.5 first:pt-0 last:pb-0 space-y-2">
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Waves className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" aria-hidden />
          <span className="text-xs text-meta">
            Y {item.start_y} → {item.end_y}
          </span>
          <span className="text-[10px] text-meta">
            r={item.radius}
          </span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_BADGE[item.status] ?? ""}`}>
            {item.status}
          </span>
          {isReverted && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
              reverted
            </span>
          )}
          {isKept && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              kept
            </span>
          )}
        </div>
        <span className="text-[10px] text-meta flex-shrink-0">
          {relativeTime(item.finished_at ?? item.created_at)}
        </span>
      </div>

      {/* Post-event decision: keep or revert */}
      {canManage && needsDecision && (
        <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-900/15 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" aria-hidden />
          <span className="text-xs text-amber-700 dark:text-amber-300 flex-1">
            Keep the modified world or revert to the pre-event backup?
          </span>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => onKeep(item.id)}
              disabled={keepPending}
              className="text-[10px] font-medium px-2 py-1 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors"
            >
              <Check className="w-3 h-3 inline mr-0.5" aria-hidden />
              Keep
            </button>
            {!confirmRevert ? (
              <button
                onClick={() => setConfirmRevert(true)}
                className="text-[10px] font-medium px-2 py-1 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors"
              >
                <RotateCcw className="w-3 h-3 inline mr-0.5" aria-hidden />
                Revert
              </button>
            ) : (
              <button
                onClick={() => { onRevert(item.id); setConfirmRevert(false); }}
                disabled={revertPending}
                className="text-[10px] font-medium px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700 transition-colors animate-pulse"
              >
                Confirm Revert
              </button>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {canManage && (
        <div className="flex items-center gap-2">
          {/* Start a pending event */}
          {item.status === "pending" && !hasActive && (
            <button
              onClick={() => onStart(item.id)}
              disabled={startPending}
              className="text-[10px] font-medium px-2 py-1 rounded bg-[#5B9BF0] text-white hover:bg-[#4A8ADF] transition-colors flex items-center gap-1"
            >
              <Play className="w-3 h-3" aria-hidden /> Start
            </button>
          )}
          {/* Delete finished/cancelled/pending */}
          {["finished", "cancelled", "pending"].includes(item.status) && (isReverted || isKept || !item.backup_path || item.status === "pending") && (
            <button
              onClick={() => onDelete(item.id)}
              className="p-1 rounded text-meta hover:text-red-500 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a duration in seconds as a compact human-readable string. */
function formatDuration(totalSecs: number): string {
  if (totalSecs <= 0) return "0s";
  const days  = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins  = Math.floor((totalSecs % 3600) / 60);
  const secs  = totalSecs % 60;

  const parts: string[] = [];
  if (days  > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins  > 0) parts.push(`${mins}m`);
  if (secs  > 0) parts.push(`${secs}s`);
  return parts.join(" ");
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

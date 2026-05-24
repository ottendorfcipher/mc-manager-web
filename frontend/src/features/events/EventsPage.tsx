import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Timer, Play, Pause, Square, Trash2, Plus, Users, User,
} from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { CountdownState, SoundEntry } from "@/types";

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
  "disabled:opacity-50",
].join(" ");
const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

const MC_COLORS = [
  "yellow", "gold", "green", "aqua", "blue", "red", "light_purple",
  "dark_purple", "white",
] as const;

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

// ── EventsPage ────────────────────────────────────────────────────────────────

export function EventsPage() {
  const qc = useQueryClient();
  const { hasPerm } = useAuthStore();
  const canCreate = hasPerm("events.countdown.create");
  const canManage = hasPerm("events.countdown.manage");

  // ── Countdown state (active + recent) ────────────────────────────────────────

  const { data: countdownState } = useQuery<CountdownState>({
    queryKey: ["countdown-state"],
    queryFn:  () => api.get("/events/countdowns/state"),
  });

  // ── SSE stream ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource("/api/events/countdowns/stream", { withCredentials: true });
    es.onmessage = (e) => {
      try {
        qc.setQueryData<CountdownState>(["countdown-state"], JSON.parse(e.data));
      } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }, [qc]);

  // ── Smooth local countdown ticker ────────────────────────────────────────────

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

  // ── Track catalog (for music pairing dropdown) ──────────────────────────────

  const { data: tracks = [] } = useQuery<SoundEntry[]>({
    queryKey:  ["music-tracks"],
    queryFn:   () => api.get("/music/tracks"),
    staleTime: Infinity,
  });

  // ── Mutations ────────────────────────────────────────────────────────────────

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
    <div className="page-wide space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Events</h1>
        <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
          Synchronized countdowns displayed in-game for all or selected players
        </p>
      </div>

      {/* ── Active Countdown ─────────────────────────────────────────── */}
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

      {/* ── Create Form ──────────────────────────────────────────────── */}
      {canCreate && (
        <CreateCountdownForm
          tracks={tracks}
          disabled={!!active}
          loading={createMut.isPending}
          onSubmit={(body) => createMut.mutate(body)}
        />
      )}

      {/* ── Recent Countdowns ────────────────────────────────────────── */}
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

      {/* Progress bar */}
      <div className="w-full h-2 bg-[#E5E7EB] dark:bg-[#363944] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ${
            isPaused ? "bg-[#FBBF24]" : "bg-[#22C55E]"
          }`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>

      {/* Controls */}
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
  const [targetPlayer, setTargetPlayer] = useState("");
  const [actionbar, setActionbar] = useState(true);
  const [bossbar, setBossbar] = useState(false);
  const [titleFinal, setTitleFinal] = useState(true);
  const [color, setColor]     = useState<string>("yellow");
  const [soundId, setSoundId] = useState("");

  const totalSecs = mins * 60 + secs;
  const canSubmit = title.trim().length > 0 && totalSecs > 0 && totalSecs <= 3600 && !disabled && !loading;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const modes: string[] = [];
    if (actionbar) modes.push("actionbar");
    if (bossbar) modes.push("bossbar");
    if (titleFinal) modes.push("title_final");

    onSubmit({
      title: title.trim(),
      duration_secs: totalSecs,
      target: targetAll ? "@a" : `@a[name=${targetPlayer.trim()}]`,
      display_mode: modes.join(",") || "actionbar",
      color,
      sound_id: soundId || undefined,
      auto_start: true,
    });

    // Reset form
    setTitle("");
    setMins(5);
    setSecs(0);
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

      {/* Title */}
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

      {/* Duration */}
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

      {/* Target */}
      <div>
        <label className={LBL}>Players</label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
            <input
              type="radio"
              checked={targetAll}
              onChange={() => setTargetAll(true)}
              disabled={disabled}
              className="accent-[#5B9BF0]"
            />
            <Users className="w-3.5 h-3.5" /> All
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
            <input
              type="radio"
              checked={!targetAll}
              onChange={() => setTargetAll(false)}
              disabled={disabled}
              className="accent-[#5B9BF0]"
            />
            <User className="w-3.5 h-3.5" /> Specific
          </label>
          {!targetAll && (
            <input
              type="text"
              value={targetPlayer}
              onChange={(e) => setTargetPlayer(e.target.value)}
              placeholder="PlayerName"
              disabled={disabled}
              className={`${INPUT} flex-1`}
            />
          )}
        </div>
      </div>

      {/* Display mode checkboxes */}
      <div>
        <label className={LBL}>Display</label>
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Action Bar" checked={actionbar} onChange={setActionbar} disabled={disabled} />
          <Checkbox label="Boss Bar" checked={bossbar} onChange={setBossbar} disabled={disabled} />
          <Checkbox label="Final Titles (10s)" checked={titleFinal} onChange={setTitleFinal} disabled={disabled} />
        </div>
      </div>

      {/* Color + Music row */}
      <div className="flex gap-4">
        <div className="flex-1">
          <label className={LBL}>Color</label>
          <select
            value={color}
            onChange={(e) => setColor(e.target.value)}
            disabled={disabled}
            className={`${INPUT} w-full`}
          >
            {MC_COLORS.map((c) => (
              <option key={c} value={c}>{c.replace("_", " ")}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className={LBL}>Music (optional)</label>
          <select
            value={soundId}
            onChange={(e) => setSoundId(e.target.value)}
            disabled={disabled}
            className={`${INPUT} w-full`}
          >
            <option value="">None</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>{t.display_name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Submit */}
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
  // Only show non-active countdowns in the recent list
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

function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="accent-[#5B9BF0] rounded"
      />
      {label}
    </label>
  );
}

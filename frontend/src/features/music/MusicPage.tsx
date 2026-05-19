import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Music2, SkipForward, Square, X, Search, Play } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { SoundEntry, MusicState, MusicQueueEntry } from "@/types";

// ── MusicPage ──────────────────────────────────────────────────────────────────

export function MusicPage() {
  const qc = useQueryClient();
  const { hasPerm } = useAuthStore();
  const canPlay = hasPerm("music.play");

  // ── Track catalog ────────────────────────────────────────────────────────────

  const { data: tracks = [] } = useQuery<SoundEntry[]>({
    queryKey: ["music-tracks"],
    queryFn:  () => api.get("/music/tracks"),
    staleTime: Infinity, // catalog is static — never re-fetch
    enabled:  canPlay,
  });

  // ── Music state (now-playing + queue) ────────────────────────────────────────

  const { data: musicState } = useQuery<MusicState>({
    queryKey:       ["music-state"],
    queryFn:        () => api.get("/music/state"),
    refetchInterval: 5_000,
    enabled:        canPlay,
  });

  // ── SSE stream for instant state updates ─────────────────────────────────────

  useEffect(() => {
    if (!canPlay) return;
    const es = new EventSource("/api/music/stream", { withCredentials: true });
    es.onmessage = (e) => {
      try {
        qc.setQueryData<MusicState>(["music-state"], JSON.parse(e.data));
      } catch {
        // Ignore malformed events.
      }
    };
    return () => es.close();
  }, [canPlay, qc]);

  // ── Smooth progress-bar counter ───────────────────────────────────────────────
  // Seed from server-reported elapsed_secs and tick up every second locally.
  // Reset when the track changes (queue_id changes) or the server refreshes it.

  const np = musicState?.now_playing ?? null;
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!np) { setElapsed(0); return; }
    setElapsed(np.elapsed_secs);
    const id = setInterval(
      () => setElapsed((prev) => Math.min(prev + 1, np.duration_secs)),
      1000,
    );
    return () => clearInterval(id);
  }, [np?.queue_id, np?.elapsed_secs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Catalog search ────────────────────────────────────────────────────────────

  const [search, setSearch] = useState("");
  const filtered = tracks.filter(
    (t) =>
      t.display_name.toLowerCase().includes(search.toLowerCase()) ||
      t.artist.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const enqueueMut = useMutation({
    mutationFn: (sound_id: string) => api.post("/music/queue", { sound_id }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["music-state"] }),
  });

  const removeMut = useMutation({
    mutationFn: (id: number) => api.delete(`/music/queue/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["music-state"] }),
  });

  const skipMut = useMutation({
    mutationFn: () => api.post("/music/skip"),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["music-state"] }),
  });

  const stopMut = useMutation({
    mutationFn: () => api.post("/music/stop"),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["music-state"] }),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const queue = musicState?.queue ?? [];
  const pct   = np ? Math.min((elapsed / np.duration_secs) * 100, 100) : 0;

  function fmtDur(secs: number) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="page">

      {/* ── Header ── */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Music2 className="w-5 h-5 text-[#5B9BF0] flex-shrink-0" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Music Queue</h1>
            <p className="text-sm text-meta mt-0.5">
              Play sounds for everyone on the server · no client mods needed
            </p>
          </div>
        </div>
      </div>

      {!canPlay && (
        <div className="card text-sm text-meta text-center py-10">
          You don't have permission to control music.
        </div>
      )}

      {canPlay && (
        <>
          {/* ── Now Playing ── */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-semibold uppercase tracking-wider text-meta">
                Now Playing
              </p>
              {np && (
                <div className="flex gap-2">
                  <button
                    onClick={() => skipMut.mutate()}
                    disabled={skipMut.isPending}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
                    aria-label="Skip to next track"
                  >
                    <SkipForward className="w-3.5 h-3.5" aria-hidden />
                    Skip
                  </button>
                  <button
                    onClick={() => stopMut.mutate()}
                    disabled={stopMut.isPending}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5
                               text-[#F87171] border-[#F87171]/40 hover:bg-[#FEE2E2] dark:hover:bg-[#3B1F1F]
                               disabled:opacity-50"
                    aria-label="Stop all music and clear queue"
                  >
                    <Square className="w-3.5 h-3.5" aria-hidden />
                    Stop All
                  </button>
                </div>
              )}
            </div>

            {np ? (
              <div className="space-y-3">
                <div>
                  <p className="font-semibold text-[#1C1E27] dark:text-[#EAECF0] text-base">
                    {np.display_name}
                  </p>
                  <p className="text-xs text-meta mt-0.5">
                    {np.artist} · queued by{" "}
                    <span className="text-[#1C1E27] dark:text-[#EAECF0]">
                      {np.requested_by.split("@")[0]}
                    </span>
                  </p>
                </div>

                {/* Progress bar */}
                <div className="space-y-1" role="progressbar"
                  aria-valuenow={elapsed}
                  aria-valuemin={0}
                  aria-valuemax={np.duration_secs}
                  aria-label={`${np.display_name} progress`}>
                  <div className="h-1.5 rounded-full bg-[#D9D5D0] dark:bg-[#363944] overflow-hidden">
                    <div
                      className="h-full bg-[#5B9BF0] rounded-full transition-[width] duration-1000 ease-linear"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-meta">
                    <span>{fmtDur(elapsed)}</span>
                    <span>{fmtDur(np.duration_secs)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-meta py-2">
                {queue.length > 0
                  ? <>Nothing playing yet — <span className="text-[#1C1E27] dark:text-[#EAECF0]">{queue[0].display_name}</span> is up next.</>
                  : "Nothing playing. Pick a track from the catalog below."}
              </p>
            )}
          </div>

          {/* ── Up Next ── */}
          {queue.length > 0 && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-meta">
                  Up Next
                  <span className="ml-2 normal-case font-normal">
                    {queue.length} track{queue.length !== 1 ? "s" : ""}
                  </span>
                </p>
                <button
                  onClick={() => stopMut.mutate()}
                  disabled={stopMut.isPending}
                  className="text-xs text-meta hover:text-[#F87171] transition-colors disabled:opacity-50"
                >
                  Clear all
                </button>
              </div>
              <ol className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
                {queue.map((entry, i) => (
                  <QueueRow
                    key={entry.id}
                    position={i + 1}
                    entry={entry}
                    tracks={tracks}
                    onRemove={() => removeMut.mutate(entry.id)}
                    removing={removeMut.isPending && removeMut.variables === entry.id}
                  />
                ))}
              </ol>
            </div>
          )}

          {/* ── Track Catalog ── */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs font-semibold uppercase tracking-wider text-meta">
                Track Catalog
              </p>
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-meta pointer-events-none"
                  aria-hidden
                />
                <input
                  type="search"
                  placeholder="Search tracks or artists…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                             bg-white dark:bg-[#2A2D38] text-xs text-[#1C1E27] dark:text-[#EAECF0]
                             placeholder-[#9B9EA6] focus:outline-none focus:ring-2 focus:ring-[#5B9BF0] w-52"
                  aria-label="Search track catalog"
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="py-6 text-sm text-meta text-center">
                No tracks match "{search}".
              </p>
            ) : (
              <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
                {filtered.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    isPlaying={np?.sound_id === track.id}
                    onEnqueue={() => enqueueMut.mutate(track.id)}
                    enqueueing={enqueueMut.isPending && enqueueMut.variables === track.id}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── QueueRow ───────────────────────────────────────────────────────────────────

function QueueRow({
  position,
  entry,
  tracks,
  onRemove,
  removing,
}: {
  position: number;
  entry:    MusicQueueEntry;
  tracks:   SoundEntry[];
  onRemove: () => void;
  removing: boolean;
}) {
  const track = tracks.find((t) => t.id === entry.sound_id);

  return (
    <li className="flex items-center gap-3 py-2.5 group">
      <span className="w-5 text-center text-xs text-meta flex-shrink-0 font-mono">
        {position}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
          {entry.display_name}
        </p>
        <p className="text-[10px] text-meta truncate">
          {track?.artist ?? "—"} · {entry.requested_by.split("@")[0]}
          {track && (
            <span className="ml-2 opacity-60">{fmtDuration(track.duration_secs)}</span>
          )}
        </p>
      </div>
      <button
        onClick={onRemove}
        disabled={removing}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity
                   p-1 rounded text-meta hover:text-[#F87171] disabled:opacity-30"
        aria-label={`Remove ${entry.display_name} from queue`}
      >
        <X className="w-3.5 h-3.5" aria-hidden />
      </button>
    </li>
  );
}

// ── TrackRow ───────────────────────────────────────────────────────────────────

function TrackRow({
  track,
  isPlaying,
  onEnqueue,
  enqueueing,
}: {
  track:      SoundEntry;
  isPlaying:  boolean;
  onEnqueue:  () => void;
  enqueueing: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 hover:bg-[#F7F5F2] dark:hover:bg-[#1E212B]
                    -mx-4 px-4 transition-colors">
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${
          isPlaying ? "text-[#5B9BF0]" : "text-[#1C1E27] dark:text-[#EAECF0]"
        }`}>
          {track.display_name}
          {isPlaying && (
            <span className="ml-2 text-[10px] text-[#5B9BF0] font-normal">▶ playing</span>
          )}
        </p>
        <p className="text-[10px] text-meta truncate">
          {track.artist}
          <span className="ml-2 opacity-60">{fmtDuration(track.duration_secs)}</span>
        </p>
      </div>
      <button
        onClick={onEnqueue}
        disabled={enqueueing}
        className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 flex-shrink-0
                   disabled:opacity-40"
        aria-label={`Add ${track.display_name} to queue`}
      >
        {enqueueing ? (
          <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" aria-hidden />
        ) : (
          <Play className="w-3 h-3" aria-hidden />
        )}
        Queue
      </button>
    </div>
  );
}

// ── Shared utility ─────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

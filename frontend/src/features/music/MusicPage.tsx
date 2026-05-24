import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Music2, SkipForward, Square, X, Search, Play, Upload,
  Trash2, ChevronDown, Pencil, Disc3,
} from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { McItemImage } from "@/components/McItemImage";
import type { SoundEntry, MusicState, MusicQueueEntry } from "@/types";

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
  "disabled:opacity-50",
].join(" ");
const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

// ── MusicPage ──────────────────────────────────────────────────────────────────

export function MusicPage() {
  const qc = useQueryClient();
  const { hasPerm } = useAuthStore();
  const canPlay = hasPerm("music.play");

  // ── Track catalog ────────────────────────────────────────────────────────────

  const { data: tracks = [] } = useQuery<SoundEntry[]>({
    queryKey: ["music-tracks"],
    queryFn:  () => api.get("/music/tracks"),
    staleTime: Infinity,
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
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [canPlay, qc]);

  // ── Smooth progress-bar counter ──────────────────────────────────────────────

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

  // ── OGG upload ───────────────────────────────────────────────────────────────

  const oggFileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadOggMut = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const res = await fetch("/api/music/upload", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? res.statusText);
      }
      return res.json() as Promise<SoundEntry[]>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["music-tracks"] }),
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.toLowerCase().endsWith(".ogg"),
    );
    if (files.length > 0) uploadOggMut.mutate(files);
  }, [uploadOggMut]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) uploadOggMut.mutate(files);
      e.target.value = "";
    },
    [uploadOggMut],
  );

  // ── Custom track mutations ───────────────────────────────────────────────────
  // (track-level edit/save lives inside <CustomTrackCard>; only enqueue/remove
  // are wired here.)

  const removeTrackMut = useMutation({
    mutationFn: (sound_id: string) => api.delete(`/music/tracks/${encodeURIComponent(sound_id)}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["music-tracks"] }),
  });

  // ── Catalog search ────────────────────────────────────────────────────────────

  const [search, setSearch] = useState("");
  const filtered = tracks.filter(
    (t) =>
      t.display_name.toLowerCase().includes(search.toLowerCase()) ||
      t.artist.toLowerCase().includes(search.toLowerCase()),
  );

  // ── Queue mutations ──────────────────────────────────────────────────────────

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

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const queue         = musicState?.queue ?? [];
  const pct           = np ? Math.min((elapsed / np.duration_secs) * 100, 100) : 0;
  const customTracks  = tracks.filter((t) => t.is_custom);
  const vanillaTracks = tracks.filter((t) => !t.is_custom);
  const [showVanilla, setShowVanilla] = useState(false);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="page">

      {/* ── Header ── */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Music2 className="w-5 h-5 text-[#5B9BF0] flex-shrink-0" aria-hidden />
          <div>
            <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Music</h1>
            <p className="text-sm text-meta mt-0.5">
              Play music for everyone on the server
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
                    <span>{fmtDuration(elapsed)}</span>
                    <span>{fmtDuration(np.duration_secs)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-meta py-2">
                {queue.length > 0
                  ? <>Nothing playing yet — <span className="text-[#1C1E27] dark:text-[#EAECF0]">{queue[0].display_name}</span> is up next.</>
                  : "Nothing playing. Pick a track below to get started."}
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

          {/* ── Your Music ── */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2">
              <Disc3 className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
              <p className="text-xs font-semibold uppercase tracking-wider text-meta">Your Music</p>
            </div>

            {/* ── Drop zone ── */}
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                dragOver
                  ? "border-[#5B9BF0] bg-[#EEF4FF] dark:bg-[#181D2E]"
                  : "border-[#D9D5D0] dark:border-[#363944] hover:border-[#5B9BF0]"
              }`}
              onClick={() => oggFileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") oggFileRef.current?.click(); }}
              aria-label="Upload OGG audio files"
            >
              <input
                ref={oggFileRef}
                type="file"
                accept=".ogg"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              {uploadOggMut.isPending ? (
                <>
                  <span
                    className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin mx-auto block mb-2"
                    aria-hidden
                  />
                  <p className="text-sm text-[#5B9BF0] font-medium">Uploading…</p>
                </>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-meta mx-auto mb-2" aria-hidden />
                  <p className="text-sm text-[#1C1E27] dark:text-[#EAECF0] font-medium">
                    Drop .ogg files here or click to browse
                  </p>
                  <p className="text-[10px] text-meta mt-1">
                    Tracks are auto-detected and added to the catalog
                  </p>
                </>
              )}
            </div>
            {uploadOggMut.isError && (
              <p className="text-xs text-[#F87171]">{(uploadOggMut.error as Error).message}</p>
            )}

            {/* ── Custom tracks list ── */}
            {customTracks.length > 0 && (
              <>
                <div className="border-t border-[#D9D5D0] dark:border-[#363944]" />
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-meta">
                    Your Tracks ({customTracks.length})
                  </p>
                  <div className="space-y-2">
                    {customTracks.map((t) => (
                      <CustomTrackCard
                        key={t.id}
                        track={t}
                        isPlaying={np?.sound_id === t.id}
                        onEnqueue={() => enqueueMut.mutate(t.id)}
                        enqueueing={enqueueMut.isPending && enqueueMut.variables === t.id}
                        onRemove={() => removeTrackMut.mutate(t.id)}
                        removing={removeTrackMut.isPending && removeTrackMut.variables === t.id}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── Vanilla Tracks (accordion) ── */}
          <div className="card">
            <button
              onClick={() => setShowVanilla((v) => !v)}
              className="w-full flex items-center justify-between py-1 group"
              aria-expanded={showVanilla}
            >
              <div className="flex items-center gap-2">
                <Music2 className="w-4 h-4 text-meta" aria-hidden />
                <p className="text-xs font-semibold uppercase tracking-wider text-meta">
                  Minecraft Discs
                  <span className="ml-2 normal-case font-normal">
                    {vanillaTracks.length} tracks
                  </span>
                </p>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-meta transition-transform ${showVanilla ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>

            {showVanilla && (
              <div className="mt-3 space-y-3">
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
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                               bg-white dark:bg-[#2A2D38] text-xs text-[#1C1E27] dark:text-[#EAECF0]
                               placeholder-[#9B9EA6] focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
                    aria-label="Search track catalog"
                  />
                </div>
                {filtered.filter((t) => !t.is_custom).length === 0 ? (
                  <p className="py-6 text-sm text-meta text-center">No tracks match "{search}".</p>
                ) : (
                  <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
                    {filtered.filter((t) => !t.is_custom).map((track) => (
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
  const discItemId = soundIdToItemId(track.id);

  return (
    <div className="flex items-center gap-3 py-2.5 hover:bg-[#F7F5F2] dark:hover:bg-[#1E212B]
                    -mx-4 px-4 transition-colors">
      {discItemId && (
        <McItemImage id={discItemId} size={24} className="pixel" />
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${
          isPlaying ? "text-[#5B9BF0]" : "text-[#1C1E27] dark:text-[#EAECF0]"
        }`}>
          {track.display_name}
          {isPlaying && (
            <span className="ml-2 text-[10px] font-normal">▶ playing</span>
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

// ── CustomTrackCard ────────────────────────────────────────────────────────────

function CustomTrackCard({
  track,
  isPlaying,
  onEnqueue,
  enqueueing,
  onRemove,
  removing,
}: {
  track:      SoundEntry;
  isPlaying:  boolean;
  onEnqueue:  () => void;
  enqueueing: boolean;
  onRemove:   () => void;
  removing:   boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName]       = useState(track.display_name);
  const [artist, setArtist]   = useState(track.artist);
  const [mins, setMins]       = useState(String(Math.floor(track.duration_secs / 60)));
  const [secs, setSecs]       = useState(String(track.duration_secs % 60).padStart(2, "0"));

  const updateMut = useMutation({
    mutationFn: (body: { display_name: string; artist: string; duration_secs: number }) =>
      api.put(`/music/tracks/${encodeURIComponent(track.id)}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music-tracks"] });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <div className="rounded-lg border border-[#5B9BF0]/40 bg-[#F0F5FF] dark:bg-[#181D2E] p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <code className="text-[10px] font-mono text-meta truncate">{track.id}</code>
          <button
            onClick={() => setEditing(false)}
            className="text-[10px] text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
          >
            Cancel
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LBL}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={`w-full ${INPUT}`} />
          </div>
          <div>
            <label className={LBL}>Artist</label>
            <input value={artist} onChange={(e) => setArtist(e.target.value)} className={`w-full ${INPUT}`} />
          </div>
          <div className="col-span-2">
            <label className={LBL}>Duration</label>
            <div className="flex items-center gap-1.5">
              <input
                type="number" min={0} max={120} value={mins}
                onChange={(e) => setMins(e.target.value)}
                className={`w-14 text-center ${INPUT}`} aria-label="Minutes"
              />
              <span className="text-sm text-meta select-none">:</span>
              <input
                type="number" min={0} max={59} value={secs}
                onChange={(e) => setSecs(e.target.value)}
                onBlur={(e) => setSecs(String(Math.min(parseInt(e.target.value) || 0, 59)).padStart(2, "0"))}
                className={`w-14 text-center ${INPUT}`} aria-label="Seconds"
              />
              <span className="text-[10px] text-meta select-none ml-1">mm : ss</span>
            </div>
          </div>
        </div>
        <button
          onClick={() =>
            updateMut.mutate({
              display_name:  name.trim() || track.display_name,
              artist:        artist.trim(),
              duration_secs: (parseInt(mins, 10) || 0) * 60 + Math.min(parseInt(secs, 10) || 0, 59),
            })
          }
          disabled={updateMut.isPending || !name.trim()}
          className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5 disabled:opacity-40"
        >
          {updateMut.isPending && <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden />}
          Save Changes
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                    bg-[#F7F5F2] dark:bg-[#1E212B] p-3
                    flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${
          isPlaying ? "text-[#5B9BF0]" : "text-[#1C1E27] dark:text-[#EAECF0]"
        }`}>
          {track.display_name}
          {isPlaying && <span className="ml-2 text-[10px] font-normal">▶ playing</span>}
        </p>
        <p className="text-[10px] text-meta truncate">
          {track.artist || "Unknown artist"}
          <span className="ml-2 opacity-60">{fmtDuration(track.duration_secs)}</span>
        </p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={onEnqueue}
          disabled={enqueueing}
          className="btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 disabled:opacity-40"
          aria-label={`Add ${track.display_name} to queue`}
        >
          {enqueueing ? (
            <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" aria-hidden />
          ) : (
            <Play className="w-3 h-3" aria-hidden />
          )}
          Queue
        </button>
        <button
          onClick={() => setEditing(true)}
          className="icon-btn w-7 h-7 min-w-0 min-h-0"
          aria-label={`Edit ${track.display_name}`}
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden />
        </button>
        <button
          onClick={onRemove}
          disabled={removing}
          className="icon-btn-danger w-7 h-7 min-w-0 min-h-0"
          aria-label={`Remove ${track.display_name}`}
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ── Shared utilities ──────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function soundIdToItemId(soundId: string): string | null {
  if (!soundId.startsWith("minecraft:music_disc.")) return null;
  return soundId.replace(":", ":").replace("music_disc.", "music_disc_");
}

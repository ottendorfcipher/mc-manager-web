import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Music2, SkipForward, Square, X, Search, Play, Upload, Package, Trash2, ChevronDown, Download } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { SoundEntry, MusicState, MusicQueueEntry, ResourcePackInfo } from "@/types";

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

  // ── Resource pack ─────────────────────────────────────────────────────────────

  const { data: packInfo, refetch: refetchPack } = useQuery<ResourcePackInfo>({
    queryKey: ["music-resource-pack"],
    queryFn:  () => api.get("/music/resource-pack"),
    enabled:  canPlay,
  });

  const packFileRef = useRef<HTMLInputElement>(null);

  const uploadPackMut = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("pack", file);
      const res = await fetch("/api/music/resource-pack", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => refetchPack(),
  });

  const deletePackMut = useMutation({
    mutationFn: () => api.delete("/music/resource-pack"),
    onSuccess:  () => refetchPack(),
  });

  // ── Custom track registration ─────────────────────────────────────────────────

  const [addTrack, setAddTrack] = useState({ sound_id: "", display_name: "", artist: "" });
  const [durMins, setDurMins] = useState("3");
  const [durSecs, setDurSecs] = useState("00");
  const [showGuide, setShowGuide] = useState(false);

  const addTrackMut = useMutation({
    mutationFn: () => api.post("/music/tracks", {
      sound_id:      addTrack.sound_id.trim(),
      display_name:  addTrack.display_name.trim(),
      artist:        addTrack.artist.trim(),
      duration_secs: (parseInt(durMins, 10) || 0) * 60 + Math.min(parseInt(durSecs, 10) || 0, 59),
    }),
    onSuccess: () => {
      setAddTrack({ sound_id: "", display_name: "", artist: "" });
      setDurMins("3");
      setDurSecs("00");
      qc.invalidateQueries({ queryKey: ["music-tracks"] });
    },
  });

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

  const queue        = musicState?.queue ?? [];
  const pct          = np ? Math.min((elapsed / np.duration_secs) * 100, 100) : 0;
  const customTracks = tracks.filter((t) => t.is_custom);
  const canSubmit    =
    !!addTrack.sound_id.trim() && !!addTrack.display_name.trim() &&
    (parseInt(durMins, 10) || 0) * 60 + (parseInt(durSecs, 10) || 0) > 0;

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
                    <span>{fmtDuration(elapsed)}</span>
                    <span>{fmtDuration(np.duration_secs)}</span>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-meta">Track Catalog</p>
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
              <p className="py-6 text-sm text-meta text-center">No tracks match "{search}".</p>
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

          {/* ── Custom Music Setup ── */}
          <div className="card space-y-4">

            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
                <p className="text-xs font-semibold uppercase tracking-wider text-meta">Custom Music</p>
              </div>
              <button
                onClick={() => setShowGuide((g) => !g)}
                className="text-[11px] text-[#5B9BF0] hover:underline flex items-center gap-1"
                aria-expanded={showGuide}
              >
                How it works
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${showGuide ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            </div>

            {/* How-it-works guide */}
            {showGuide && (
              <div className="rounded-lg bg-[#EEF4FF] dark:bg-[#181D2E] border border-[#5B9BF0]/25 p-3.5 space-y-3 text-xs">
                <p className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">How custom music works</p>
                <ol className="space-y-2.5">
                  {([
                    [
                      "Download the starter template",
                      "Open the zip — it has pack.mcmeta, a sounds.json, and a sounds/ folder already set up.",
                    ],
                    [
                      "Add your .ogg audio files",
                      "Put each file at  assets/redstonecipher/sounds/music/my_song.ogg  inside the zip.",
                    ],
                    [
                      "Update sounds.json",
                      'Add one entry per song — the template shows the exact format.\nThe key (e.g. "music.my_song") becomes the second half of the Sound ID.',
                    ],
                    [
                      "Upload your pack, then register each track",
                      "Upload the zip below. Then fill in the Register form so the track appears in the catalog.",
                    ],
                  ] as [string, string][]).map(([title, body], i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span
                        className="w-5 h-5 rounded-full bg-[#5B9BF0] text-white text-[10px] font-bold
                                   flex items-center justify-center flex-shrink-0 mt-px"
                      >
                        {i + 1}
                      </span>
                      <span>
                        <strong className="text-[#1C1E27] dark:text-[#EAECF0]">{title}</strong>
                        <br />
                        <span className="text-meta whitespace-pre-line">{body}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="text-meta pt-2 border-t border-[#5B9BF0]/20 leading-relaxed">
                  Sound ID format: <code className="bg-white dark:bg-[#2A2D38] px-1 rounded text-[#1C1E27] dark:text-[#EAECF0]">namespace:event.name</code>
                  {" → e.g. "}
                  <code className="bg-white dark:bg-[#2A2D38] px-1 rounded text-[#1C1E27] dark:text-[#EAECF0]">redstonecipher:music.my_song</code>
                </p>
              </div>
            )}

            {/* ── Resource Pack ── */}
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0]">Resource Pack</p>

              {packInfo?.installed ? (
                <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg
                               bg-[#F0FDF4] dark:bg-[#0D2218] border border-[#36B37E]/30">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#36B37E]">Pack installed</p>
                    <p className="text-[10px] text-meta font-mono truncate">
                      SHA1: {packInfo.sha1?.slice(0, 16)}…&nbsp;·&nbsp;
                      {((packInfo.size_bytes ?? 0) / 1024 / 1024).toFixed(1)} MB
                    </p>
                  </div>
                  <a
                    href={packInfo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-[#5B9BF0] hover:underline flex-shrink-0"
                  >
                    View
                  </a>
                </div>
              ) : (
                <p className="text-xs text-meta">
                  No pack installed. Download the template to get started.
                </p>
              )}

              <div className="flex flex-wrap gap-2 items-center">
                <a
                  href="/resource-pack-template.zip"
                  download
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden /> Download Template
                </a>
                <input
                  ref={packFileRef}
                  type="file"
                  accept=".zip"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadPackMut.mutate(file);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={() => packFileRef.current?.click()}
                  disabled={uploadPackMut.isPending}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {uploadPackMut.isPending ? (
                    <span
                      className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <Upload className="w-3.5 h-3.5" aria-hidden />
                  )}
                  {packInfo?.installed ? "Replace Pack" : "Upload Pack"}
                </button>
                {packInfo?.installed && (
                  <button
                    onClick={() => deletePackMut.mutate()}
                    disabled={deletePackMut.isPending}
                    className="text-xs text-meta hover:text-[#F87171] transition-colors
                               flex items-center gap-1 disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden /> Remove
                  </button>
                )}
                {uploadPackMut.isError && (
                  <p className="text-xs text-[#F87171]">{(uploadPackMut.error as Error).message}</p>
                )}
              </div>
            </div>

            <div className="border-t border-[#D9D5D0] dark:border-[#363944]" />

            {/* ── Register a Custom Track ── */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0]">Register a Custom Track</p>
              {!packInfo?.installed && (
                <p className="text-xs text-meta italic">
                  Upload a resource pack above first — custom audio won't play without one.
                </p>
              )}

              <div className="grid grid-cols-2 gap-x-3 gap-y-3">

                {/* Sound ID — full width */}
                <div className="col-span-2">
                  <label className={LBL} htmlFor="sound-id">Sound ID</label>
                  <input
                    id="sound-id"
                    placeholder="e.g. redstonecipher:music.my_song"
                    value={addTrack.sound_id}
                    onChange={(e) => setAddTrack((p) => ({ ...p, sound_id: e.target.value }))}
                    className={`w-full font-mono ${INPUT}`}
                  />
                  <p className="mt-1 text-[10px] text-meta">
                    Must match a key in your pack's{" "}
                    <code className="text-[#1C1E27] dark:text-[#EAECF0]">sounds.json</code>
                    {" — format: "}
                    <code className="text-[#1C1E27] dark:text-[#EAECF0]">namespace:event.name</code>
                  </p>
                </div>

                {/* Track name */}
                <div>
                  <label className={LBL} htmlFor="track-name">Track Name</label>
                  <input
                    id="track-name"
                    placeholder="My Song"
                    value={addTrack.display_name}
                    onChange={(e) => setAddTrack((p) => ({ ...p, display_name: e.target.value }))}
                    className={`w-full ${INPUT}`}
                  />
                </div>

                {/* Artist */}
                <div>
                  <label className={LBL} htmlFor="track-artist">
                    Artist{" "}
                    <span className="normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    id="track-artist"
                    placeholder="Artist name"
                    value={addTrack.artist}
                    onChange={(e) => setAddTrack((p) => ({ ...p, artist: e.target.value }))}
                    className={`w-full ${INPUT}`}
                  />
                </div>

                {/* Duration MM:SS */}
                <div className="col-span-2">
                  <label className={LBL}>Duration</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number" min={0} max={120} placeholder="3"
                      value={durMins}
                      onChange={(e) => setDurMins(e.target.value)}
                      className={`w-16 text-center ${INPUT}`}
                      aria-label="Minutes"
                    />
                    <span className="text-sm text-meta select-none">:</span>
                    <input
                      type="number" min={0} max={59} placeholder="00"
                      value={durSecs}
                      onChange={(e) => setDurSecs(e.target.value)}
                      onBlur={(e) =>
                        setDurSecs(
                          String(Math.min(parseInt(e.target.value) || 0, 59)).padStart(2, "0"),
                        )
                      }
                      className={`w-16 text-center ${INPUT}`}
                      aria-label="Seconds"
                    />
                    <span className="text-[10px] text-meta select-none">mm : ss</span>
                  </div>
                </div>

                {/* Submit */}
                <button
                  onClick={() => addTrackMut.mutate()}
                  disabled={!canSubmit || addTrackMut.isPending}
                  className="btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5 disabled:opacity-40"
                >
                  {addTrackMut.isPending && (
                    <span
                      className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"
                      aria-hidden
                    />
                  )}
                  Add to Catalog
                </button>

                {addTrackMut.isError && (
                  <p className="col-span-2 text-xs text-[#F87171]">
                    {(addTrackMut.error as Error).message}
                  </p>
                )}
              </div>
            </div>

            {/* ── Registered custom tracks ── */}
            {customTracks.length > 0 && (
              <div className="border-t border-[#D9D5D0] dark:border-[#363944] pt-3 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-meta mb-2">
                  Registered ({customTracks.length})
                </p>
                <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
                  {customTracks.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                          {t.display_name}
                        </p>
                        <p className="text-[10px] text-meta font-mono truncate">{t.id}</p>
                      </div>
                      <button
                        onClick={() => removeTrackMut.mutate(t.id)}
                        disabled={removeTrackMut.isPending}
                        className="icon-btn-danger w-7 h-7 min-w-0 min-h-0 flex-shrink-0"
                        aria-label={`Remove ${t.display_name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
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
        <div className="flex items-center gap-2 min-w-0">
          <p className={`text-sm font-medium truncate ${
            isPlaying ? "text-[#5B9BF0]" : "text-[#1C1E27] dark:text-[#EAECF0]"
          }`}>
            {track.display_name}
            {isPlaying && (
              <span className="ml-2 text-[10px] font-normal">▶ playing</span>
            )}
          </p>
          {track.is_custom && (
            <span className="px-1.5 py-px text-[9px] font-bold uppercase rounded flex-shrink-0
                             bg-[#5B9BF0]/10 text-[#5B9BF0] border border-[#5B9BF0]/25">
              Custom
            </span>
          )}
        </div>
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
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

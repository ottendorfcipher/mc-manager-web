import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ListMusic, Plus, Play, Trash2, ChevronDown, ChevronRight, History, X } from "lucide-react";
import { api } from "@/api/client";
import { toast } from "@/components/Toast";
import type { SoundEntry } from "@/types";

interface Playlist { id: number; name: string; created_by: string; created_at: string; track_count: number }
interface PlaylistTrack { sound_id: string; display_name: string; position: number }
interface PlaylistDetail { id: number; name: string; tracks: PlaylistTrack[] }
interface PlayHistoryEntry { id: number; sound_id: string; display_name: string; played_at: string }

/** Playlists (curated track sets, queue in one click) + recently-played. */
export function PlaylistsPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: playlists = [] } = useQuery<Playlist[]>({
    queryKey: ["music-playlists"],
    queryFn:  () => api.get("/music/playlists"),
  });
  const { data: history = [] } = useQuery<PlayHistoryEntry[]>({
    queryKey:        ["music-history"],
    queryFn:         () => api.get("/music/history"),
    refetchInterval: 30_000,
  });

  const createMut = useMutation({
    mutationFn: () => api.post("/music/playlists", { name: name.trim() }),
    onSuccess:  () => { setName(""); qc.invalidateQueries({ queryKey: ["music-playlists"] }); toast.success("Playlist created."); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/music/playlists/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["music-playlists"] }),
  });
  const queueMut = useMutation({
    mutationFn: (id: number) => api.post(`/music/playlists/${id}/queue`),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["music-state"] }); toast.success("Playlist queued."); },
  });

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <ListMusic className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Playlists</h3>
        </div>

        {canManage && (
          <form
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMut.mutate(); }}
            className="flex gap-2"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New playlist name…"
              maxLength={80}
              className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38]
                         text-sm px-2.5 py-1.5 text-[#1C1E27] dark:text-[#EAECF0] focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
            />
            <button type="submit" disabled={!name.trim() || createMut.isPending} className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" aria-hidden /> Add
            </button>
          </form>
        )}

        {playlists.length === 0 ? (
          <p className="text-xs text-meta text-center py-3">No playlists yet.</p>
        ) : (
          <ul className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
            {playlists.map((pl) => (
              <li key={pl.id} className="py-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExpanded(expanded === pl.id ? null : pl.id)}
                    className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                    aria-expanded={expanded === pl.id}
                  >
                    {expanded === pl.id ? <ChevronDown className="w-3.5 h-3.5 text-meta" aria-hidden /> : <ChevronRight className="w-3.5 h-3.5 text-meta" aria-hidden />}
                    <span className="text-sm text-[#1C1E27] dark:text-[#EAECF0] truncate">{pl.name}</span>
                    <span className="text-[11px] text-meta flex-shrink-0">{pl.track_count} track{pl.track_count !== 1 ? "s" : ""}</span>
                  </button>
                  <button
                    onClick={() => queueMut.mutate(pl.id)}
                    disabled={pl.track_count === 0 || queueMut.isPending}
                    className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-40"
                    title="Queue all tracks"
                  >
                    <Play className="w-3 h-3" aria-hidden /> Queue
                  </button>
                  {canManage && (
                    <button
                      onClick={() => { if (confirm(`Delete playlist "${pl.name}"?`)) deleteMut.mutate(pl.id); }}
                      className="p-1 rounded text-meta hover:text-[#F87171]"
                      aria-label={`Delete ${pl.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  )}
                </div>
                {expanded === pl.id && <PlaylistTracks id={pl.id} canManage={canManage} />}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recently played */}
      <div className="card space-y-2">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Recently played</h3>
        </div>
        {history.length === 0 ? (
          <p className="text-xs text-meta text-center py-2">Nothing played yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 text-sm py-0.5">
                <span className="text-[#1C1E27] dark:text-[#EAECF0] truncate">{h.display_name}</span>
                <span className="text-[11px] text-meta whitespace-nowrap">
                  {new Date(h.played_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlaylistTracks({ id, canManage }: { id: number; canManage: boolean }) {
  const qc = useQueryClient();
  const [toAdd, setToAdd] = useState("");

  const { data: detail } = useQuery<PlaylistDetail>({
    queryKey: ["music-playlist", id],
    queryFn:  () => api.get(`/music/playlists/${id}`),
  });
  const { data: tracks = [] } = useQuery<SoundEntry[]>({
    queryKey: ["music-tracks"],
    queryFn:  () => api.get("/music/tracks"),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["music-playlist", id] });
    qc.invalidateQueries({ queryKey: ["music-playlists"] });
  };
  const addMut = useMutation({
    mutationFn: (sound_id: string) => api.post(`/music/playlists/${id}/tracks`, { sound_id }),
    onSuccess:  () => { setToAdd(""); invalidate(); },
  });
  const removeMut = useMutation({
    mutationFn: (sound_id: string) => api.delete(`/music/playlists/${id}/tracks/${encodeURIComponent(sound_id)}`),
    onSuccess:  invalidate,
  });

  const inPlaylist = new Set(detail?.tracks.map((t) => t.sound_id) ?? []);
  const available = tracks.filter((t) => !inPlaylist.has(t.id));

  return (
    <div className="mt-2 ml-5 space-y-2">
      {detail?.tracks.length === 0 ? (
        <p className="text-xs text-meta">No tracks yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {detail?.tracks.map((t) => (
            <li key={t.sound_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-[#1C1E27] dark:text-[#EAECF0] truncate">{t.display_name}</span>
              {canManage && (
                <button onClick={() => removeMut.mutate(t.sound_id)} className="p-0.5 text-meta hover:text-[#F87171]" aria-label={`Remove ${t.display_name}`}>
                  <X className="w-3.5 h-3.5" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && available.length > 0 && (
        <div className="flex gap-2">
          <select
            value={toAdd}
            onChange={(e) => setToAdd(e.target.value)}
            className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38]
                       text-xs px-2 py-1 text-[#1C1E27] dark:text-[#EAECF0]"
          >
            <option value="">Add a track…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>{t.display_name}</option>
            ))}
          </select>
          <button
            onClick={() => toAdd && addMut.mutate(toAdd)}
            disabled={!toAdd || addMut.isPending}
            className="btn-secondary text-xs disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Music Zones: per-player music triggers tied to a region on the map.
 *
 * Behaviour:
 *  - When a player enters the zone, the listed tracks play (in order) just for them.
 *  - If `stop_on_leave` is on, the sound stops when they leave.
 *  - Otherwise, the track keeps playing until it ends.
 *  - Once the sequence finishes, a per-player cooldown blocks re-trigger.
 *  - A trigger cannot fire again while the same player's track is still playing.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MapPin, Plus, Trash2, Pencil, Music2, Users, User, ChevronUp, ChevronDown,
  X, CheckSquare, XSquare, TimerReset,
} from "lucide-react";
import { api } from "@/api/client";
import { DiscIcon } from "@/components/DiscIcon";
import { PartyChipBar } from "@/components/PartyChipBar";
import type { MusicZone, SoundEntry, McPlayer, ScrollingCredits } from "@/types";

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
  "disabled:opacity-50",
].join(" ");
const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

const DIMENSIONS = [
  { value: "minecraft:overworld", label: "Overworld"  },
  { value: "minecraft:the_nether", label: "The Nether" },
  { value: "minecraft:the_end",    label: "The End"    },
];

function fmtCooldown(secs: number): string {
  if (secs === 0)   return "no cooldown";
  if (secs < 60)    return `${secs}s`;
  if (secs < 3600)  return `${Math.round(secs / 60)}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function MusicZonesPanel() {
  const qc = useQueryClient();
  const { data: zones = [] } = useQuery<MusicZone[]>({
    queryKey: ["music-zones"],
    queryFn:  () => api.get("/music/zones"),
  });
  const { data: tracks = [] } = useQuery<SoundEntry[]>({
    queryKey:  ["music-tracks"],
    queryFn:   () => api.get("/music/tracks"),
    staleTime: Infinity,
  });
  const { data: players = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn:  () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });
  const { data: creditsList = [] } = useQuery<ScrollingCredits[]>({
    queryKey: ["credits"],
    queryFn:  () => api.get("/credits"),
    staleTime: Infinity,
  });

  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState<MusicZone | null>(null);

  const createMut = useMutation({
    mutationFn: (body: ZoneBody) => api.post("/music/zones", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music-zones"] });
      setCreating(false);
    },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: ZoneBody & { id: number; enabled: boolean }) =>
      api.patch(`/music/zones/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["music-zones"] });
      setEditing(null);
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/music/zones/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["music-zones"] }),
  });
  const clearCdMut = useMutation({
    mutationFn: (id: number) => api.post(`/music/zones/${id}/clear-cooldown`),
  });

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
          <MapPin className="w-4 h-4 text-[#5B9BF0]" /> Music Zones
        </h2>
        {!creating && !editing && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn-primary text-xs flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> New zone
          </button>
        )}
      </div>

      <p className="text-[11px] text-meta -mt-1">
        When a player walks into a region, a track plays just for them. Set cooldowns
        and stop-on-leave behavior per zone. Sound is heard only by the targeted players.
      </p>

      {/* Create / Edit form */}
      {(creating || editing) && (
        <ZoneForm
          tracks={tracks}
          players={players}
          creditsList={creditsList}
          initial={editing ?? undefined}
          loading={createMut.isPending || updateMut.isPending}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSubmit={(body) => {
            if (editing) {
              updateMut.mutate({ ...body, id: editing.id, enabled: editing.enabled === 1 });
            } else {
              createMut.mutate(body);
            }
          }}
        />
      )}

      {/* Zone list */}
      {!creating && !editing && (
        <div className="space-y-2">
          {zones.length === 0 && (
            <p className="text-xs text-meta italic py-2">
              No zones yet. Click <em>New zone</em> to create one.
            </p>
          )}
          {zones.map((z) => (
            <ZoneCard
              key={z.id}
              zone={z}
              tracks={tracks}
              creditsList={creditsList}
              onEdit={() => setEditing(z)}
              onDelete={() => {
                if (confirm(`Delete music zone "${z.name}"?`)) deleteMut.mutate(z.id);
              }}
              onClearCooldown={() => clearCdMut.mutate(z.id)}
              clearingCooldown={clearCdMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ZoneCard (read-only display) ──────────────────────────────────────────────

function ZoneCard({
  zone, tracks, creditsList, onEdit, onDelete, onClearCooldown, clearingCooldown,
}: {
  zone:              MusicZone;
  tracks:            SoundEntry[];
  creditsList:       ScrollingCredits[];
  onEdit:            () => void;
  onDelete:          () => void;
  onClearCooldown:   () => void;
  clearingCooldown:  boolean;
}) {
  const soundIds: string[] = useMemo(() => {
    try { return JSON.parse(zone.sound_ids_json) as string[]; } catch { return []; }
  }, [zone.sound_ids_json]);
  const players: string[] | null = useMemo(() => {
    if (!zone.target_players_json) return null;
    try { return JSON.parse(zone.target_players_json) as string[]; } catch { return null; }
  }, [zone.target_players_json]);

  return (
    <div className={`rounded-lg border p-2.5 ${
      zone.enabled
        ? "border-[#D9D5D0] dark:border-[#363944] bg-[#F7F5F2] dark:bg-[#1E212B]"
        : "border-dashed border-[#D9D5D0] dark:border-[#363944] bg-[#F0EDE9]/50 dark:bg-[#2A2D38]/50 opacity-60"
    }`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
              {zone.name}
            </span>
            {!zone.enabled && (
              <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded
                               bg-[#FEE2E2] dark:bg-[#7F1D1D]/30 text-[#991B1B] dark:text-[#FCA5A5]">
                disabled
              </span>
            )}
          </div>
          <p className="text-[11px] text-meta mt-0.5">
            <code className="font-mono">{zone.dimension.replace("minecraft:", "")}</code>
            {" · "}
            <code className="font-mono">({zone.x1}, {zone.y1}, {zone.z1})</code>
            {" → "}
            <code className="font-mono">({zone.x2}, {zone.y2}, {zone.z2})</code>
          </p>
          <p className="text-[11px] text-meta">
            {players ? (
              <>👥 {players.length} player{players.length === 1 ? "" : "s"}</>
            ) : (
              <>👥 Everyone</>
            )}
            {" · "}
            {zone.stop_on_leave ? "stops on leave" : "plays to end"}
            {" · "}
            cooldown {fmtCooldown(zone.cooldown_secs)}
            {zone.credits_id != null && (() => {
              const cr = creditsList.find((c) => c.id === zone.credits_id);
              return cr ? (
                <><span className="mx-0.5">·</span><span title="Scrolling credits sequence">🎬 {cr.name}</span></>
              ) : null;
            })()}
          </p>

          {/* Track discs */}
          <div className="flex items-center gap-1.5 mt-1.5">
            {soundIds.map((sid) => {
              const t = tracks.find((x) => x.id === sid);
              return (
                <div
                  key={sid}
                  title={t ? `${t.display_name} — ${t.artist}` : sid}
                  className="flex-shrink-0"
                >
                  <DiscIcon
                    soundId={sid}
                    imageUrl={t?.image_url ?? null}
                    size={22}
                    label={t?.display_name ?? sid}
                  />
                </div>
              );
            })}
            <span className="text-[10px] text-meta ml-1">
              {soundIds.length} track{soundIds.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {zone.cooldown_secs > 0 && (
            <button
              type="button"
              onClick={onClearCooldown}
              disabled={clearingCooldown}
              title="Clear cooldown for all players"
              className="p-1 rounded text-meta hover:text-[#F59E0B] hover:bg-[#FEF3C7] dark:hover:bg-[#78350F]/30 disabled:opacity-40"
            >
              <TimerReset className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            className="p-1 rounded text-meta hover:text-[#5B9BF0] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F]/30"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            className="p-1 rounded text-meta hover:text-[#EF4444] hover:bg-[#FEE2E2] dark:hover:bg-[#7F1D1D]/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ZoneForm ──────────────────────────────────────────────────────────────────

interface ZoneBody {
  name:           string;
  dimension:      string;
  x1:             number;
  y1:             number;
  z1:             number;
  x2:             number;
  y2:             number;
  z2:             number;
  sound_ids:      string[];
  target_players: string[] | null;
  stop_on_leave:  boolean;
  cooldown_secs:  number;
  credits_id:     number | null;
}

function ZoneForm({
  tracks,
  players,
  creditsList,
  initial,
  loading,
  onSubmit,
  onCancel,
}: {
  tracks:      SoundEntry[];
  players:     McPlayer[];
  creditsList: ScrollingCredits[];
  initial?:    MusicZone;
  loading:     boolean;
  onSubmit:    (body: ZoneBody) => void;
  onCancel:    () => void;
}) {
  // Seed from existing zone if editing
  const initialSoundIds: string[] = (() => {
    if (!initial) return [];
    try { return JSON.parse(initial.sound_ids_json) as string[]; } catch { return []; }
  })();
  const initialTargets: string[] | null = (() => {
    if (!initial || !initial.target_players_json) return null;
    try { return JSON.parse(initial.target_players_json) as string[]; } catch { return null; }
  })();

  const [name, setName]               = useState(initial?.name ?? "");
  const [dimension, setDimension]     = useState(initial?.dimension ?? "minecraft:overworld");
  const [x1, setX1]                   = useState(initial?.x1 ?? 0);
  const [y1, setY1]                   = useState(initial?.y1 ?? -64);
  const [z1, setZ1]                   = useState(initial?.z1 ?? 0);
  const [x2, setX2]                   = useState(initial?.x2 ?? 0);
  const [y2, setY2]                   = useState(initial?.y2 ?? 320);
  const [z2, setZ2]                   = useState(initial?.z2 ?? 0);
  const [soundIds, setSoundIds]       = useState<string[]>(initialSoundIds);
  const [stopOnLeave, setStopOnLeave] = useState(initial?.stop_on_leave === 1);
  // Cooldown editor — convert to/from mins/secs for nicer UI
  const initialCdMins = Math.floor((initial?.cooldown_secs ?? 1800) / 60);
  const initialCdSecs = (initial?.cooldown_secs ?? 1800) % 60;
  const [cdMins, setCdMins] = useState(initialCdMins);
  const [cdSecs, setCdSecs] = useState(initialCdSecs);
  // Player selection
  const [targetAll, setTargetAll] = useState(initialTargets === null);
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(
    new Set(initialTargets ?? []),
  );
  const [trackModalOpen, setTrackModalOpen] = useState(false);
  const [creditsId, setCreditsId] = useState<number | null>(initial?.credits_id ?? null);

  const cooldownSecs = cdMins * 60 + cdSecs;
  const targetValid  = targetAll || selectedPlayers.size > 0;
  const canSubmit    = !!name.trim() && soundIds.length > 0 && targetValid && !loading;

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.ign.localeCompare(b.ign);
    });
  }, [players]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name:           name.trim(),
      dimension,
      x1, y1, z1,
      x2, y2, z2,
      sound_ids:      soundIds,
      target_players: targetAll ? null : [...selectedPlayers],
      stop_on_leave:  stopOnLeave,
      cooldown_secs:  cooldownSecs,
      credits_id:     creditsId,
    });
  }

  function togglePlayer(ign: string) {
    setSelectedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(ign)) next.delete(ign); else next.add(ign);
      return next;
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border border-[#5B9BF0]/30 rounded-lg p-3 bg-[#F0F5FF]/50 dark:bg-[#181D2E]/50">
      <h3 className="text-xs font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
        {initial ? `Edit "${initial.name}"` : "New music zone"}
      </h3>

      {/* Name */}
      <div>
        <label className={LBL}>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="e.g. Library"
          className={`${INPUT} w-full`}
        />
      </div>

      {/* Geometry: dimension + two corner points */}
      <div>
        <label className={LBL}>Dimension</label>
        <select
          value={dimension}
          onChange={(e) => setDimension(e.target.value)}
          className={`${INPUT} w-full sm:w-48`}
        >
          {DIMENSIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className={LBL}>Corner 1 (stand at one corner, press F3)</label>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[9px] text-meta mb-0.5">X</label>
            <input type="number" className={`${INPUT} w-full`}
              value={x1} onChange={(e) => setX1(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Y</label>
            <input type="number" className={`${INPUT} w-full`}
              value={y1} onChange={(e) => setY1(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Z</label>
            <input type="number" className={`${INPUT} w-full`}
              value={z1} onChange={(e) => setZ1(Number(e.target.value) || 0)} />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label className={LBL}>Corner 2 (opposite corner of the zone)</label>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[9px] text-meta mb-0.5">X</label>
            <input type="number" className={`${INPUT} w-full`}
              value={x2} onChange={(e) => setX2(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Y</label>
            <input type="number" className={`${INPUT} w-full`}
              value={y2} onChange={(e) => setY2(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="block text-[9px] text-meta mb-0.5">Z</label>
            <input type="number" className={`${INPUT} w-full`}
              value={z2} onChange={(e) => setZ2(Number(e.target.value) || 0)} />
          </div>
        </div>
      </div>

      {/* Tracks (multi-select via modal) */}
      <div>
        <label className={LBL}>Tracks (plays in order)</label>
        <button
          type="button"
          onClick={() => setTrackModalOpen(true)}
          className={`${INPUT} w-full flex items-center gap-2 text-left`}
        >
          <Music2 className="w-3.5 h-3.5 text-meta" />
          <span className="flex-1 truncate">
            {soundIds.length === 0
              ? "Pick tracks…"
              : soundIds.length === 1
                ? (tracks.find((t) => t.id === soundIds[0])?.display_name ?? soundIds[0])
                : `${soundIds.length} tracks`}
          </span>
        </button>
        {/* Selected disc strip */}
        {soundIds.length > 0 && (
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {soundIds.map((sid) => {
              const t = tracks.find((x) => x.id === sid);
              return (
                <DiscIcon
                  key={sid}
                  soundId={sid}
                  imageUrl={t?.image_url ?? null}
                  size={18}
                  label={t?.display_name ?? sid}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Player targeting */}
      <div>
        <label className={LBL}>Who hears it</label>
        <div className="flex items-center gap-4 mb-1.5">
          <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
            <input
              type="radio"
              checked={targetAll}
              onChange={() => setTargetAll(true)}
              className="accent-[#5B9BF0]"
            />
            <Users className="w-3.5 h-3.5" /> Everyone
          </label>
          <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
            <input
              type="radio"
              checked={!targetAll}
              onChange={() => setTargetAll(false)}
              className="accent-[#5B9BF0]"
            />
            <User className="w-3.5 h-3.5" /> Specific
          </label>
        </div>
        {!targetAll && (
          <div className="space-y-1.5">
            <PartyChipBar
              selected={selectedPlayers}
              onChange={setSelectedPlayers}
            />
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => setSelectedPlayers(new Set(sortedPlayers.map((p) => p.ign)))}
                disabled={sortedPlayers.length === 0}
                className="btn-secondary text-[10px] flex items-center gap-1 px-2 py-1"
              >
                <CheckSquare className="w-3 h-3" /> Select all
              </button>
              <button type="button"
                onClick={() => setSelectedPlayers(new Set())}
                disabled={selectedPlayers.size === 0}
                className="btn-secondary text-[10px] flex items-center gap-1 px-2 py-1"
              >
                <XSquare className="w-3 h-3" /> Select none
              </button>
              <span className="ml-auto text-[10px] text-meta tabular-nums">
                {selectedPlayers.size} / {sortedPlayers.length} selected
              </span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 max-h-40 overflow-y-auto p-1
                            border border-[#D9D5D0] dark:border-[#363944] rounded-lg
                            bg-white dark:bg-[#2A2D38]">
              {sortedPlayers.map((p) => {
                const isSel = selectedPlayers.has(p.ign);
                return (
                  <button
                    key={p.uuid || p.ign}
                    type="button"
                    onClick={() => togglePlayer(p.ign)}
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
                        src={`https://mc-heads.net/avatar/${encodeURIComponent(p.ign)}/20`}
                        alt=""
                        className="w-4 h-4 rounded"
                        loading="lazy"
                      />
                      {p.online && (
                        <span className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#22C55E] ring-1 ring-white dark:ring-[#2A2D38]" />
                      )}
                    </span>
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

      {/* Behavior: stop_on_leave + cooldown */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 items-end">
        <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
          <input
            type="checkbox"
            checked={stopOnLeave}
            onChange={(e) => setStopOnLeave(e.target.checked)}
            className="accent-[#5B9BF0]"
          />
          Stop sound when player leaves the zone
        </label>
        <div>
          <label className={LBL}>Cooldown after track ends</label>
          <div className="flex items-center gap-1">
            <input
              type="number" min={0} max={1440}
              value={cdMins}
              onChange={(e) => setCdMins(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))}
              className={`${INPUT} w-14 text-center`}
              aria-label="Cooldown minutes"
            />
            <span className="text-[10px] text-meta">m</span>
            <input
              type="number" min={0} max={59}
              value={cdSecs}
              onChange={(e) => setCdSecs(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
              className={`${INPUT} w-14 text-center`}
              aria-label="Cooldown seconds"
            />
            <span className="text-[10px] text-meta">s</span>
          </div>
          <p className="text-[10px] text-meta mt-0.5">{fmtCooldown(cooldownSecs)}</p>
        </div>
      </div>

      {/* Scrolling credits */}
      {creditsList.length > 0 && (
        <div>
          <label className={LBL}>Scrolling credits (optional)</label>
          <select
            value={creditsId ?? ""}
            onChange={(e) => setCreditsId(e.target.value ? Number(e.target.value) : null)}
            className={`${INPUT} w-full sm:w-64`}
          >
            <option value="">None</option>
            {creditsList.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-meta mt-0.5">
            When triggered, credits will scroll on-screen alongside the music.
          </p>
        </div>
      )}

      {/* Buttons */}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">Cancel</button>
        <button type="submit" disabled={!canSubmit} className="btn-primary text-xs">
          {initial ? "Save" : "Create zone"}
        </button>
      </div>

      {/* Track picker modal */}
      {trackModalOpen && (
        <ZoneTrackPickerModal
          tracks={tracks}
          selected={soundIds}
          onChange={setSoundIds}
          onClose={() => setTrackModalOpen(false)}
        />
      )}
    </form>
  );
}

// ── ZoneTrackPickerModal ──────────────────────────────────────────────────────
// (Same UX as EventsPage's TrackPickerModal — copied here so MusicPage doesn't
//  need to import from Events.)

function ZoneTrackPickerModal({
  tracks, selected, onChange, onClose,
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
    return tracks.filter((t) =>
      t.display_name.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q),
    );
  }, [tracks, query]);
  const selSet = new Set(selected);
  const totalSecs = selected.map((id) => tracks.find((t) => t.id === id)?.duration_secs ?? 0)
                            .reduce((a, b) => a + b, 0);

  function toggle(id: string) {
    if (selSet.has(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
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
      role="dialog" aria-modal="true" aria-label="Pick zone tracks"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-[#1C1E27] rounded-xl shadow-2xl w-full max-w-md
                      border border-[#D9D5D0] dark:border-[#363944] p-4 space-y-3
                      max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            Pick tracks for zone
          </h3>
          <button
            type="button" onClick={onClose}
            className="p-1 rounded text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

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
                  <button type="button" onClick={() => move(id, -1)} disabled={i === 0}
                    className="p-0.5 text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0] disabled:opacity-30"
                    aria-label="Move up">
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => move(id, 1)} disabled={i === selected.length - 1}
                    className="p-0.5 text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0] disabled:opacity-30"
                    aria-label="Move down">
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => toggle(id)}
                    className="p-0.5 text-meta hover:text-[#EF4444]"
                    aria-label="Remove">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <input
          type="text"
          placeholder="Search tracks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${INPUT} w-full`}
        />

        <div className="grid grid-cols-3 gap-1.5 overflow-y-auto pr-1 -mr-1 min-h-0">
          {filtered.length === 0 && (
            <p className="col-span-3 text-xs text-meta italic text-center py-6">No tracks match.</p>
          )}
          {filtered.map((t) => {
            const isSel = selSet.has(t.id);
            return (
              <button
                key={t.id} type="button" onClick={() => toggle(t.id)}
                title={`${t.display_name} — ${t.artist}`}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors
                            ${isSel
                              ? "border-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F]/30"
                              : "border-[#D9D5D0] dark:border-[#363944] hover:border-[#9B9EA6]"}`}
              >
                <DiscIcon soundId={t.id} imageUrl={t.image_url} size={40} label={t.display_name} />
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

        <div className="flex justify-end gap-2 pt-1 border-t border-[#D9D5D0] dark:border-[#363944]">
          <button type="button" onClick={() => onChange([])} className="btn-secondary text-xs">Clear</button>
          <button type="button" onClick={onClose} className="btn-primary text-xs">
            Done ({selected.length})
          </button>
        </div>
      </div>
    </div>
  );
}

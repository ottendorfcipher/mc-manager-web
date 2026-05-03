import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin as MapPinIcon, Users, Plus, Globe, Flame, Moon,
         Eye, EyeOff, Trash2, Edit2, Navigation } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { MapPin, PlayerSnapshot, McPlayer } from "@/types";
import { PlayerDetailPanel } from "./PlayerDetailPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIM_MAP = [
  { id: "minecraft:overworld",  label: "Overworld", icon: Globe,  bmId: "overworld"  },
  { id: "minecraft:the_nether", label: "Nether",    icon: Flame,  bmId: "nether"     },
  { id: "minecraft:the_end",    label: "End",       icon: Moon,   bmId: "end"        },
] as const;

function bluemapUrl(dim: string, x?: number, z?: number, zoom = 4) {
  const d = DIM_MAP.find((d) => d.id === dim) ?? DIM_MAP[0];
  if (x !== undefined && z !== undefined) {
    // BlueMap hash: #<mapid>:<x>:<y>:<z>:<zoom>:<rot>:<tilt>
    return `/map/#${d.bmId}:${x}:64:${z}:${zoom}:0:0`;
  }
  return `/map/#${d.bmId}`;
}

const ICON_OPTIONS = [
  { id: "default",   label: "📍 Default"   },
  { id: "home",      label: "🏠 Home"      },
  { id: "danger",    label: "⚠️ Danger"    },
  { id: "resource",  label: "⛏️ Resource"  },
  { id: "note",      label: "📝 Note"      },
  { id: "build",     label: "🏗️ Build"     },
] as const;

const ICON_EMOJI: Record<string, string> = {
  default:  "📍", home: "🏠", danger: "⚠️",
  resource: "⛏️", note: "📝", build:  "🏗️",
};

// ── Pin creation form ─────────────────────────────────────────────────────────

interface PinFormState {
  x: string; z: string;
  label: string; body: string;
  icon: string; visibility: "private" | "team";
  dimension: string;
}

function PinForm({
  initial, onSubmit, onCancel, isPending,
}: {
  initial?: Partial<PinFormState>;
  onSubmit: (v: PinFormState) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [v, setV] = useState<PinFormState>({
    x: initial?.x ?? "",
    z: initial?.z ?? "",
    label: initial?.label ?? "",
    body:  initial?.body ?? "",
    icon:  initial?.icon ?? "default",
    visibility: initial?.visibility ?? "private",
    dimension:  initial?.dimension ?? "minecraft:overworld",
  });

  return (
    <div className="p-3 space-y-2 border-b border-[#D9D5D0] dark:border-[#363944] bg-[#F7F5F2] dark:bg-[#13151A]">
      <p className="text-xs font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
        {initial ? "Edit pin" : "New pin"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="X"
          value={v.x}
          onChange={(e) => setV({ ...v, x: e.target.value })}
          className="input-sm"
          type="number"
        />
        <input
          placeholder="Z"
          value={v.z}
          onChange={(e) => setV({ ...v, z: e.target.value })}
          className="input-sm"
          type="number"
        />
      </div>
      <input
        placeholder="Label"
        value={v.label}
        onChange={(e) => setV({ ...v, label: e.target.value })}
        className="input-sm w-full"
        maxLength={80}
      />
      <textarea
        placeholder="Notes (optional)"
        value={v.body}
        onChange={(e) => setV({ ...v, body: e.target.value })}
        className="input-sm w-full resize-none"
        rows={2}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={v.icon}
          onChange={(e) => setV({ ...v, icon: e.target.value })}
          className="input-sm"
        >
          {ICON_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <select
          value={v.visibility}
          onChange={(e) => setV({ ...v, visibility: e.target.value as "private" | "team" })}
          className="input-sm"
        >
          <option value="private">🔒 Private</option>
          <option value="team">🌐 Team</option>
        </select>
      </div>
      <select
        value={v.dimension}
        onChange={(e) => setV({ ...v, dimension: e.target.value })}
        className="input-sm w-full"
      >
        {DIM_MAP.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      <div className="flex gap-2">
        <button
          onClick={() => onSubmit(v)}
          disabled={isPending || !v.label.trim() || !v.x || !v.z}
          className="btn-primary text-xs py-1 flex-1"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="btn-secondary text-xs py-1 flex-1">Cancel</button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function MapPage() {
  const { user, hasPerm } = useAuthStore();
  const qc = useQueryClient();

  const canCreatePin  = hasPerm("map.pin.create");
  const canManagePins = hasPerm("map.pin.manage");

  const [dim, setDim]           = useState("minecraft:overworld");
  const [activeTab, setActiveTab] = useState<"players" | "pins">("players");
  const [selectedIgn, setSelectedIgn] = useState<string | null>(null);
  const [showPinForm, setShowPinForm] = useState(false);
  const [editingPin, setEditingPin]   = useState<MapPin | null>(null);
  // ── Data
  const { data: snapshots = [] } = useQuery<PlayerSnapshot[]>({
    queryKey: ["snapshots"],
    queryFn:  () => api.get("/players/snapshots"),
    refetchInterval: 60_000,
  });

  const { data: livePlayers = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn:  () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  const { data: pins = [] } = useQuery<MapPin[]>({
    queryKey: ["map-pins"],
    queryFn:  () => api.get("/map/pins"),
  });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const createPinMut = useMutation({
    mutationFn: (v: PinFormState) => api.post<MapPin>("/map/pins", {
      x: Number(v.x), z: Number(v.z),
      dimension: v.dimension,
      label: v.label,
      body:  v.body || null,
      icon:  v.icon,
      visibility: v.visibility,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map-pins"] });
      setShowPinForm(false);
    },
  });

  const updatePinMut = useMutation({
    mutationFn: ({ id, v }: { id: number; v: PinFormState }) =>
      api.patch(`/map/pins/${id}`, {
        label: v.label, body: v.body || null, icon: v.icon, visibility: v.visibility,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["map-pins"] });
      setEditingPin(null);
    },
  });

  const deletePinMut = useMutation({
    mutationFn: (id: number) => api.delete(`/map/pins/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["map-pins"] }),
  });

  // ── Filtered data for current dimension ──────────────────────────────────────
  const dimPins  = pins.filter((p) => p.dimension === dim);

  const dimEntry  = DIM_MAP.find((d) => d.id === dim) ?? DIM_MAP[0];

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-72 flex-shrink-0 flex flex-col border-r border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#1C1E27]">
        {/* Dimension selector */}
        <div className="p-3 border-b border-[#D9D5D0] dark:border-[#363944] space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-[#9B9EA6] font-semibold px-1">Dimension</p>
          {DIM_MAP.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setDim(id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                dim === id
                  ? "bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#5B9BF0]"
                  : "text-[#6B6E78] dark:text-[#9BA0B0] hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-[#D9D5D0] dark:border-[#363944]">
          {(["players", "pins"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-[#5B9BF0] text-[#5B9BF0]"
                  : "text-[#9B9EA6] hover:text-[#6B6E78]"
              }`}
            >
              {tab === "players" ? <Users className="w-3 h-3" /> : <MapPinIcon className="w-3 h-3" />}
              {tab === "players" ? "Players" : "Pins"}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "players" && (
            <div className="space-y-0.5 p-2">
              {snapshots.length === 0 ? (
                <p className="text-xs text-[#9B9EA6] text-center py-6 px-3">
                  No snapshots yet. Use the Refresh button on any player.
                </p>
              ) : snapshots.map((s) => {
                const online  = livePlayers.some((p) => p.ign === s.ign && p.online);
                const inDim   = s.dimension === dim;
                return (
                  <button
                    key={s.ign}
                    onClick={() => setSelectedIgn(selectedIgn === s.ign ? null : s.ign)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-left transition-colors ${
                      selectedIgn === s.ign
                        ? "bg-[#EFF6FF] dark:bg-[#1E3A5F]"
                        : "hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]"
                    } ${!inDim ? "opacity-50" : ""}`}
                  >
                    <img
                      src={`https://mc-heads.net/avatar/${s.ign}/24`}
                      alt=""
                      className="w-6 h-6 rounded flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-[#1C1E27] dark:text-[#EAECF0] truncate">{s.ign}</p>
                      {inDim && (
                        <p className="text-[9px] text-[#9B9EA6]">
                          {s.x.toFixed(0)}, {s.y.toFixed(0)}, {s.z.toFixed(0)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {!inDim && <span className="text-[9px] text-[#9B9EA6]">other dim</span>}
                      <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {activeTab === "pins" && (
            <div>
              {/* Add pin button */}
              {canCreatePin && !showPinForm && !editingPin && (
                <button
                  onClick={() => setShowPinForm(true)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#5B9BF0] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] border-b border-[#D9D5D0] dark:border-[#363944]"
                >
                  <Plus className="w-3 h-3" /> Add pin in {dimEntry.label}
                </button>
              )}

              {showPinForm && (
                <PinForm
                  initial={{ dimension: dim }}
                  onSubmit={(v) => createPinMut.mutate(v)}
                  onCancel={() => setShowPinForm(false)}
                  isPending={createPinMut.isPending}
                />
              )}

              {editingPin && (
                <PinForm
                  initial={{
                    x: String(editingPin.x),
                    z: String(editingPin.z),
                    label: editingPin.label,
                    body:  editingPin.body ?? "",
                    icon:  editingPin.icon,
                    visibility: editingPin.visibility,
                    dimension:  editingPin.dimension,
                  }}
                  onSubmit={(v) => updatePinMut.mutate({ id: editingPin.id, v })}
                  onCancel={() => setEditingPin(null)}
                  isPending={updatePinMut.isPending}
                />
              )}

              <div className="space-y-0.5 p-2">
                {dimPins.length === 0 && !showPinForm && (
                  <p className="text-xs text-[#9B9EA6] text-center py-6 px-3">
                    No pins in {dimEntry.label}.
                    {canCreatePin && " Add one above."}
                  </p>
                )}
                {dimPins.map((pin) => (
                  <div
                    key={pin.id}
                    className="group flex items-start gap-1.5 px-2 py-1.5 rounded-lg hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]"
                  >
                    <span className="text-base flex-shrink-0 mt-0.5">
                      {ICON_EMOJI[pin.icon] ?? "📍"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                        {pin.label}
                      </p>
                      <p className="text-[9px] text-[#9B9EA6] font-mono">
                        {pin.x.toFixed(0)}, {pin.z.toFixed(0)}
                        &nbsp;·&nbsp;
                        {pin.visibility === "team"
                          ? <><Eye className="w-2.5 h-2.5 inline" /> Team</>
                          : <><EyeOff className="w-2.5 h-2.5 inline" /> Private</>
                        }
                      </p>
                      {pin.body && (
                        <p className="text-[10px] text-[#6B6E78] dark:text-[#9BA0B0] mt-0.5 line-clamp-2">
                          {pin.body}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 flex-shrink-0">
                      {/* Navigate to pin */}
                      <a
                        href={bluemapUrl(pin.dimension, pin.x, pin.z)}
                        target="bluemap"
                        title="Center map here"
                        className="p-1 rounded hover:bg-[#EFF6FF] text-[#9B9EA6] hover:text-[#5B9BF0]"
                      >
                        <Navigation className="w-3 h-3" />
                      </a>
                      {(canManagePins || pin.created_by === user?.email) && (
                        <>
                          <button
                            onClick={() => { setEditingPin(pin); setShowPinForm(false); }}
                            className="p-1 rounded hover:bg-[#F0EDE9] text-[#9B9EA6] hover:text-[#6B6E78]"
                            title="Edit"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deletePinMut.mutate(pin.id)}
                            disabled={deletePinMut.isPending}
                            className="p-1 rounded hover:bg-[#FEE2E2] text-[#9B9EA6] hover:text-[#F87171]"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden overflow-y-auto bg-[#F7F5F2] dark:bg-[#13151A]">

        {/* Open Map banner */}
        <div className="p-6 border-b border-[#D9D5D0] dark:border-[#363944] flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">World Map</h1>
            <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0] mt-0.5">
              BlueMap requires WebGL2 — opens in its own tab for best compatibility.
            </p>
          </div>
          <a
            href={bluemapUrl(dim)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary flex items-center gap-2 text-sm flex-shrink-0"
          >
            <MapPinIcon className="w-4 h-4" />
            Open World Map
          </a>
        </div>

        {/* Player detail panel */}
        {selectedIgn
          ? <div className="h-full"><PlayerDetailPanel ign={selectedIgn} onClose={() => setSelectedIgn(null)} /></div>
          : (
            <div className="p-6 text-sm text-[#9B9EA6]">
              {snapshots.length === 0
                ? <p>No player snapshots yet. Click a player in the sidebar, then hit Refresh.</p>
                : <p>Select a player from the sidebar to view their location and inventory.</p>
              }
            </div>
          )
        }
      </div>
    </div>
  );
}

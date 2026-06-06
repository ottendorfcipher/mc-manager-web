import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RefreshCw, Heart, Package } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { PlayerSnapshot, InventorySlot, McPlayer } from "@/types";
import { ItemGiveDialog } from "./ItemGiveDialog";
import { McItemImage } from "@/components/McItemImage";

// ── Slot layout (mirrors the MC inventory UI) ─────────────────────────────────
// Slots 0-8   = hotbar
// Slots 9-35  = main inventory (3 rows × 9)
// Slots 100-103 = armor (head=103, chest=102, legs=101, feet=100)
// Slot -106   = offhand

const ARMOR_SLOTS  = [103, 102, 101, 100];
const ARMOR_LABELS = ["Helmet", "Chestplate", "Leggings", "Boots"];

function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DIM_LABELS: Record<string, { label: string; color: string }> = {
  "minecraft:overworld":  { label: "Overworld",   color: "#36B37E" },
  "minecraft:the_nether": { label: "The Nether",  color: "#F87171" },
  "minecraft:the_end":    { label: "The End",     color: "#C084FC" },
};

function ItemSlot({ slot, items }: { slot: number; items: InventorySlot[] }) {
  const item = items.find((i) => i.slot === slot);
  if (!item) {
    return (
      <div className="w-9 h-9 border border-[#D9D5D0] dark:border-[#363944] rounded bg-[#F7F5F2] dark:bg-[#1C1E27]" />
    );
  }
  const bare = item.id.replace("minecraft:", "");
  return (
    <div className="relative w-9 h-9 border border-[#D9D5D0] dark:border-[#363944] rounded bg-[#F7F5F2] dark:bg-[#1C1E27] flex items-center justify-center group">
      <McItemImage id={bare} size={28} />
      {item.count > 1 && (
        <span className="absolute bottom-0 right-0.5 text-[9px] font-bold text-white drop-shadow leading-none">
          {item.count}
        </span>
      )}
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 bg-[#1C1E27] text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
        {bare} ×{item.count}
      </div>
    </div>
  );
}

interface Props {
  ign:     string;
  onClose: () => void;
}

export function PlayerDetailPanel({ ign, onClose }: Props) {
  const { hasPerm } = useAuthStore();
  const qc                = useQueryClient();
  const [showGive, setShowGive] = useState(false);

  const canGive    = hasPerm("players.give_items");
  const canViewInv = hasPerm("players.view_any");

  const { data: snap, isLoading } = useQuery<PlayerSnapshot>({
    queryKey:  ["snapshot", ign],
    queryFn:   () => api.get(`/players/snapshots/${encodeURIComponent(ign)}`),
    retry:     false,
    enabled:   canViewInv,   // members can see locations but not inventories
  });

  // Is this player currently online?
  const { data: livePlayers = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn:  () => api.get("/mc/players"),
    staleTime: 30_000,
  });
  const isOnline = livePlayers.some((p) => p.ign === ign && p.online);

  const refreshMut = useMutation({
    mutationFn: () => api.post("/players/snapshots/refresh"),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["snapshot", ign] }),
  });

  const dimInfo  = snap ? (DIM_LABELS[snap.dimension] ?? { label: snap.dimension, color: "#9B9EA6" }) : null;
  const items: InventorySlot[] = snap ? JSON.parse(snap.inventory_json || "[]") : [];

  // Main inventory rows (slots 9-35)
  const mainRows = [
    Array.from({ length: 9 }, (_, i) => i + 9),
    Array.from({ length: 9 }, (_, i) => i + 18),
    Array.from({ length: 9 }, (_, i) => i + 27),
  ];
  const hotbarRow = Array.from({ length: 9 }, (_, i) => i);

  return (
    <>
      <div className="absolute top-0 right-0 h-full w-full sm:w-80 bg-white dark:bg-[#1C1E27] border-l border-[#D9D5D0] dark:border-[#363944] flex flex-col z-10 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#D9D5D0] dark:border-[#363944]">
          <div className="flex items-center gap-2">
            <img
              src={`https://mc-heads.net/avatar/${ign}/32`}
              alt=""
              className="w-8 h-8 rounded"
            />
            <div>
              <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0] font-mono">{ign}</p>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`} />
                <span className="text-[10px] text-meta">{isOnline ? "Online" : "Offline"}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-1">
            {canGive && (
              <button
                onClick={() => setShowGive(true)}
                title="Give item"
                className="icon-btn text-meta hover:text-[#5B9BF0]"
              >
                <Package className="w-4 h-4" />
              </button>
            )}
            {canViewInv && (
              <button
                onClick={() => refreshMut.mutate()}
                disabled={refreshMut.isPending}
                title="Refresh snapshot"
                className="icon-btn"
              >
                <RefreshCw className={`w-4 h-4 ${refreshMut.isPending ? "animate-spin" : ""}`} />
              </button>
            )}
            <button onClick={onClose} className="icon-btn hover:text-[#F87171] hover:bg-[#FEE2E2] dark:hover:bg-[#3B1F1F]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !snap ? (
          <div className="flex-1 flex items-center justify-center text-sm text-meta p-6 text-center">
            {canViewInv
              ? "No snapshot yet. Click Refresh to capture current state."
              : "Inventory details are only visible to admins. You can see player locations on the map."}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Location */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-meta uppercase tracking-wide">Location</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                  X {snap.x.toFixed(0)} &nbsp;Y {snap.y.toFixed(0)} &nbsp;Z {snap.z.toFixed(0)}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ backgroundColor: dimInfo!.color + "22", color: dimInfo!.color }}
                >
                  {dimInfo!.label}
                </span>
              </div>
              <p className="text-[10px] text-meta">Last captured {relTime(snap.captured_at)}</p>
            </div>

            {/* Health */}
            <div className="flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-[#F87171]" />
              <div className="flex gap-0.5">
                {Array.from({ length: 10 }, (_, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-sm ${
                      (i + 1) * 2 <= snap.health
                        ? "bg-[#F87171]"
                        : (i + 1) * 2 - 1 <= snap.health
                        ? "bg-[#F87171]/50"
                        : "bg-[#D9D5D0] dark:bg-[#363944]"
                    }`}
                  />
                ))}
                <span className="text-xs text-meta ml-1">{snap.health}/20</span>
              </div>
            </div>

            {/* Inventory */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-meta uppercase tracking-wide">Inventory</p>

              {/* Armor column */}
              <div className="flex gap-1 items-start">
                <div className="space-y-1">
                  {ARMOR_SLOTS.map((s, i) => (
                    <div key={s} className="flex items-center gap-1">
                      <span className="text-[9px] text-meta w-14 text-right">{ARMOR_LABELS[i]}</span>
                      <ItemSlot slot={s} items={items} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Main inventory */}
              {/* Wrap rows so they scroll horizontally if the panel is narrower than 9 slots */}
              <div className="overflow-x-auto">
              {mainRows.map((row, ri) => (
                <div key={ri} className="flex gap-1">
                  {row.map((s) => <ItemSlot key={s} slot={s} items={items} />)}
                </div>
              ))}

              {/* Hotbar */}
              <div className="border-t border-[#D9D5D0] dark:border-[#363944] pt-2 mt-1">
                <div className="flex gap-1">
                  {hotbarRow.map((s) => <ItemSlot key={s} slot={s} items={items} />)}
                </div>
                <p className="text-[9px] text-meta mt-0.5">Hotbar</p>
              </div>
              </div>{/* end overflow-x-auto */}
            </div>
          </div>
        )}
      </div>

      {showGive && snap && (
        <ItemGiveDialog
          ign={ign}
          uuid={snap.uuid}
          online={isOnline}
          onClose={() => setShowGive(false)}
        />
      )}
    </>
  );
}

import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, Heart, MapPin, Package2, AlertTriangle,
  Backpack, ChevronUp, BarChart3,
} from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { PlayerSnapshot, InventorySlot, McPlayer } from "@/types";
import { ItemGiveDrawer } from "./ItemGiveDrawer";
import { McItemImage } from "@/components/McItemImage";

// ── Constants ─────────────────────────────────────────────────────────────────

const ARMOR_SLOTS  = [103, 102, 101, 100] as const;
const ARMOR_LABELS = ["Helmet", "Chestplate", "Leggings", "Boots"] as const;
const OFFHAND_SLOT = -106;

const DIM_INFO: Record<string, { label: string; color: string; dot: string }> = {
  "minecraft:overworld":  { label: "Overworld",  color: "#36B37E", dot: "bg-[#36B37E]" },
  "minecraft:the_nether": { label: "The Nether", color: "#F87171", dot: "bg-[#F87171]" },
  "minecraft:the_end":    { label: "The End",    color: "#C084FC", dot: "bg-[#C084FC]" },
};

function dimInfo(dim: string) {
  return DIM_INFO[dim] ?? { label: dim, color: "#9B9EA6", dot: "bg-[#9B9EA6]" };
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m  = Math.floor(ms / 60_000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isStale(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() > 10 * 60_000;
}

// ── ItemSlot ──────────────────────────────────────────────────────────────────

function ItemSlot({
  slot,
  items,
  size = "sm",
}: {
  slot: number;
  items: InventorySlot[];
  size?: "sm" | "md";
}) {
  const item = items.find((i) => i.slot === slot);
  const px   = size === "md" ? "w-10 h-10" : "w-8 h-8";

  if (!item) {
    return (
      <div
        className={`${px} border border-[#D9D5D0] dark:border-[#363944] rounded
                    bg-[#F7F5F2] dark:bg-[#13151A]`}
      />
    );
  }

  const bare = item.id.replace("minecraft:", "");
  return (
    <div
      className={`relative ${px} border border-[#D9D5D0] dark:border-[#363944] rounded
                  bg-[#F7F5F2] dark:bg-[#13151A] flex items-center justify-center group`}
    >
      <McItemImage id={bare} size={size === "md" ? 32 : 24} />
      {item.count > 1 && (
        <span className="absolute bottom-0 right-0.5 text-[8px] font-bold text-white drop-shadow leading-none">
          {item.count}
        </span>
      )}
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5
                      bg-[#1C1E27] text-white text-[10px] rounded whitespace-nowrap
                      opacity-0 group-hover:opacity-100 pointer-events-none z-20 shadow-lg">
        {bare} ×{item.count}
      </div>
    </div>
  );
}

// ── InventoryGrid ─────────────────────────────────────────────────────────────

function InventoryGrid({ items }: { items: InventorySlot[] }) {
  const mainRows = [
    Array.from({ length: 9 }, (_, i) => i + 9),
    Array.from({ length: 9 }, (_, i) => i + 18),
    Array.from({ length: 9 }, (_, i) => i + 27),
  ];
  const hotbar = Array.from({ length: 9 }, (_, i) => i);

  return (
    <div className="space-y-1.5">
      {/* Armor + Offhand row */}
      <div className="flex items-start gap-3">
        <div className="space-y-1">
          {ARMOR_SLOTS.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <span className="text-[9px] text-meta w-[58px] text-right leading-none">
                {ARMOR_LABELS[i]}
              </span>
              <ItemSlot slot={s} items={items} size="md" />
            </div>
          ))}
        </div>
        <div className="self-end space-y-1">
          <span className="text-[9px] text-meta block text-center">Offhand</span>
          <ItemSlot slot={OFFHAND_SLOT} items={items} size="md" />
        </div>
      </div>

      {/* Main inventory */}
      <div className="overflow-x-auto">
        <div className="space-y-1 inline-block">
          {mainRows.map((row, ri) => (
            <div key={ri} className="flex gap-1">
              {row.map((s) => <ItemSlot key={s} slot={s} items={items} />)}
            </div>
          ))}
        </div>
      </div>

      {/* Hotbar */}
      <div className="overflow-x-auto">
        <div className="border-t-2 border-[#5B9BF0]/30 pt-1.5 inline-block">
          <div className="flex gap-1">
            {hotbar.map((s) => <ItemSlot key={s} slot={s} items={items} />)}
          </div>
          <p className="text-[9px] text-meta mt-0.5">Hotbar</p>
        </div>
      </div>
    </div>
  );
}

// ── PlayerRosterCard ──────────────────────────────────────────────────────────

function PlayerRosterCard({
  snap,
  isOnline,
  isSelected,
  onClick,
}: {
  snap: PlayerSnapshot;
  isOnline: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const dim    = dimInfo(snap.dimension);
  const stale  = isStale(snap.captured_at);

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left
                  transition-all border-2 ${
        isSelected
          ? "border-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F]"
          : "border-transparent hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]"
      }`}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <img
          src={`https://mc-heads.net/avatar/${snap.ign}/40`}
          alt=""
          className="w-10 h-10 rounded-md"
          loading="lazy"
        />
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2
                      border-white dark:border-[#1C1E27]
                      ${isOnline ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm font-mono text-[#1C1E27] dark:text-[#EAECF0] truncate">
            {snap.ign}
          </span>
          {stale && (
            <AlertTriangle className="w-3 h-3 text-warn flex-shrink-0" aria-label="Stale snapshot" />
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
            style={{ backgroundColor: dim.color + "22", color: dim.color }}
          >
            {dim.label}
          </span>
          <span className="text-[10px] text-meta">{relTime(snap.captured_at)}</span>
        </div>
      </div>
    </button>
  );
}

// ── DetailPanel ───────────────────────────────────────────────────────────────

function DetailPanel({
  snap,
  isOnline,
  canGive,
  onGive,
  canRefresh,
  onRefresh,
  isRefreshing,
}: {
  snap: PlayerSnapshot;
  isOnline: boolean;
  canGive: boolean;
  onGive: () => void;
  canRefresh: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const dim   = dimInfo(snap.dimension);
  const items: InventorySlot[] = useMemo(
    () => { try { return JSON.parse(snap.inventory_json || "[]"); } catch { return []; } },
    [snap.inventory_json],
  );

  // Count filled slots for the summary badge
  const filledCount = items.filter((i) => i.slot >= 0 || i.slot === OFFHAND_SLOT).length;

  return (
    <div className="flex flex-col h-full">
      {/* ── Player header ── */}
      <div className="flex items-start gap-4 p-4 sm:p-6 border-b border-[#D9D5D0] dark:border-[#363944] flex-shrink-0">
        <img
          src={`https://mc-heads.net/avatar/${snap.ign}/56`}
          alt=""
          className="w-14 h-14 rounded-lg flex-shrink-0 shadow-md"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold font-mono text-[#1C1E27] dark:text-[#EAECF0]">
              {snap.ign}
            </h2>
            <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
              isOnline
                ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#36B37E]"
                : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-meta"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`} />
              {isOnline ? "Online" : "Offline"}
            </span>
            <Link
              to={`/players/${snap.ign}`}
              className="flex items-center gap-1 text-xs text-[#5B9BF0] hover:text-[#4A8AD9]
                         px-2 py-0.5 rounded-full bg-[#EFF6FF] dark:bg-[#1E3A5F]/30 font-medium"
            >
              <BarChart3 className="w-3 h-3" /> Stats
            </Link>
          </div>

          {/* Location + dimension */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-[#6B6E78] dark:text-[#A8AEBB] font-mono">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              X {snap.x.toFixed(0)} · Y {snap.y.toFixed(0)} · Z {snap.z.toFixed(0)}
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: dim.color + "22", color: dim.color }}
            >
              {dim.label}
            </span>
          </div>

          {/* Health bar */}
          <div className="flex items-center gap-1.5 mt-1.5">
            <Heart className="w-3.5 h-3.5 text-[#F87171] flex-shrink-0" />
            <div className="flex gap-0.5">
              {Array.from({ length: 10 }, (_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-sm transition-colors ${
                    (i + 1) * 2 <= snap.health
                      ? "bg-[#F87171]"
                      : (i + 1) * 2 - 1 <= snap.health
                      ? "bg-[#F87171]/50"
                      : "bg-[#D9D5D0] dark:bg-[#363944]"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-meta">{snap.health}/20</span>
            <span className="text-[10px] text-meta ml-auto flex items-center gap-1">
              Captured {relTime(snap.captured_at)}
              {isStale(snap.captured_at) && (
                canRefresh ? (
                  <button
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    className="ml-1 text-warn hover:text-[#F59E0B] underline underline-offset-2
                               disabled:opacity-50 flex items-center gap-0.5"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${isRefreshing ? "animate-spin" : ""}`} />
                    refresh
                  </button>
                ) : (
                  <span className="ml-1 text-warn">· stale</span>
                )
              )}
            </span>
          </div>
        </div>
      </div>

      {/* ── Inventory ── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-1.5">
            <Backpack className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
            Inventory
          </h3>
          <span className="text-xs text-meta">
            {filledCount} / 41 slots filled
          </span>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-meta">
            <Package2 className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Inventory is empty or not yet captured</p>
          </div>
        ) : (
          <InventoryGrid items={items} />
        )}
      </div>

      {/* ── Admin actions ── */}
      {canGive && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#1C1E27] space-y-2">
          {isStale(snap.captured_at) && (
            <p className="text-[10px] text-meta text-center">
              Inventory shown may be outdated.
              Online/offline status is always live.
            </p>
          )}
          <button
            onClick={onGive}
            className="btn-primary w-full flex items-center justify-center gap-2 py-2.5"
          >
            <Package2 className="w-4 h-4" aria-hidden />
            Give Item
          </button>
        </div>
      )}
    </div>
  );
}

// ── PlayersPage ───────────────────────────────────────────────────────────────

export function PlayersPage() {
  const { hasPerm } = useAuthStore();
  const qc          = useQueryClient();
  const canViewAny  = hasPerm("players.view_any");
  const canGive     = hasPerm("players.give_items");

  const [selectedIgn, setSelectedIgn] = useState<string | null>(null);
  const [showGive,    setShowGive]    = useState(false);
  // Mobile: roster collapsed when a player is selected
  const [rosterOpen,  setRosterOpen]  = useState(true);

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: snapshots = [], isLoading: snapsLoading } = useQuery<PlayerSnapshot[]>({
    queryKey: ["player-snapshots"],
    queryFn:  () => api.get("/players/snapshots"),
    refetchInterval: 60_000,
  });

  const refreshMut = useMutation({
    mutationFn: () => api.post("/players/snapshots/refresh"),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["player-snapshots"] }),
  });

  // Auto-refresh snapshots once on mount (admin only) so the page always
  // opens with current data rather than whatever was last cached in the DB.
  const didAutoRefresh = useRef(false);
  useEffect(() => {
    if (canViewAny && !didAutoRefresh.current) {
      didAutoRefresh.current = true;
      refreshMut.mutate();
    }
  }, [canViewAny]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: livePlayers = [] } = useQuery<McPlayer[]>({
    queryKey:  ["mc-players"],
    queryFn:   () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  // ── Derived state ─────────────────────────────────────────────────────────

  const onlineSet = useMemo(
    () => new Set(livePlayers.filter((p) => p.online).map((p) => p.ign)),
    [livePlayers],
  );

  // Sort: online first, then alphabetical
  const sorted = useMemo(
    () => [...snapshots].sort((a, b) => {
      const ao = onlineSet.has(a.ign) ? 0 : 1;
      const bo = onlineSet.has(b.ign) ? 0 : 1;
      return ao - bo || a.ign.localeCompare(b.ign);
    }),
    [snapshots, onlineSet],
  );

  const selectedSnap = sorted.find((s) => s.ign === selectedIgn) ?? sorted[0] ?? null;
  const effectiveIgn = selectedSnap?.ign ?? null;
  const isOnline     = effectiveIgn ? onlineSet.has(effectiveIgn) : false;

  // Auto-select first player when snapshots load
  const handleSelect = (ign: string) => {
    setSelectedIgn(ign);
    setRosterOpen(false); // collapse on mobile after selection
  };

  // ── Empty state ───────────────────────────────────────────────────────────

  const noLinked = !snapsLoading && snapshots.length === 0;

  return (
    <div className="flex h-full overflow-hidden">

      {/* ════════════════════════════════════════════════
          LEFT: player roster
          ════════════════════════════════════════════════ */}
      <aside
        className={`flex-shrink-0 flex flex-col bg-white dark:bg-[#1C1E27]
                    border-r border-[#D9D5D0] dark:border-[#363944]
                    ${/* Desktop: always visible; mobile: collapsible */""}
                    ${selectedSnap
                      ? "w-full md:w-64 lg:w-72"
                      : "w-full md:w-64 lg:w-72"}
                    ${!rosterOpen ? "hidden md:flex" : "flex"}
                    flex-col`}
      >
        {/* Roster header */}
        <div className="flex items-center justify-between px-4 py-3
                        border-b border-[#D9D5D0] dark:border-[#363944] flex-shrink-0">
          <div>
            <h1 className="text-base font-bold text-[#1C1E27] dark:text-[#EAECF0]">
              Inventory
            </h1>
            <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">
              {onlineSet.size > 0
                ? `${onlineSet.size} online · ${sorted.length} tracked`
                : `${sorted.length} player${sorted.length !== 1 ? "s" : ""} tracked`}
            </p>
          </div>
          {canViewAny && (
            <button
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
              title="Refresh all snapshots"
              className="p-2 rounded-lg text-meta hover:text-[#5B9BF0]
                         hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] transition-colors
                         disabled:opacity-40"
            >
              <RefreshCw className={`w-4 h-4 ${refreshMut.isPending ? "animate-spin" : ""}`} aria-hidden />
            </button>
          )}
        </div>

        {/* Player list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {snapsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : noLinked ? (
            <div className="text-center py-10 px-4">
              <Backpack className="w-8 h-8 mx-auto mb-2 text-meta opacity-40" />
              <p className="text-sm text-meta">No player data yet.</p>
              <p className="text-xs text-meta mt-1">
                {canViewAny
                  ? "Click ↻ to capture a snapshot."
                  : "Ask an admin to link your Minecraft account in Admin → Pairing."}
              </p>
            </div>
          ) : (
            sorted.map((snap) => (
              <PlayerRosterCard
                key={snap.ign}
                snap={snap}
                isOnline={onlineSet.has(snap.ign)}
                isSelected={snap.ign === (effectiveIgn)}
                onClick={() => handleSelect(snap.ign)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ════════════════════════════════════════════════
          RIGHT: inventory detail
          ════════════════════════════════════════════════ */}
      <main className={`flex-1 min-w-0 flex flex-col overflow-hidden
                        bg-[#F7F5F2] dark:bg-[#13151A]
                        ${rosterOpen && !selectedSnap ? "hidden md:flex" : "flex"}`}>

        {/* Mobile: back button when a player is selected */}
        {selectedSnap && (
          <div className="md:hidden flex items-center gap-2 px-4 py-2
                          border-b border-[#D9D5D0] dark:border-[#363944]
                          bg-white dark:bg-[#1C1E27] flex-shrink-0">
            <button
              onClick={() => setRosterOpen(true)}
              className="flex items-center gap-1.5 text-sm text-[#5B9BF0] font-medium"
            >
              <ChevronUp className="w-4 h-4 rotate-[-90deg]" />
              All players
            </button>
          </div>
        )}

        {!selectedSnap ? (
          /* No snapshot yet — empty right panel */
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-meta p-8">
            <Backpack className="w-16 h-16 opacity-20" />
            <p className="text-base font-medium">Select a player to view their inventory</p>
            {canViewAny && snapshots.length === 0 && (
              <button
                onClick={() => refreshMut.mutate()}
                disabled={refreshMut.isPending}
                className="btn-primary flex items-center gap-2 mt-2"
              >
                <RefreshCw className={`w-4 h-4 ${refreshMut.isPending ? "animate-spin" : ""}`} />
                Capture Snapshots
              </button>
            )}
          </div>
        ) : (
          <DetailPanel
            key={selectedSnap.ign}
            snap={selectedSnap}
            isOnline={isOnline}
            canGive={canGive}
            onGive={() => setShowGive(true)}
            canRefresh={canViewAny}
            onRefresh={() => refreshMut.mutate()}
            isRefreshing={refreshMut.isPending}
          />
        )}
      </main>

      {/* ── Item give drawer ── */}
      {showGive && selectedSnap && (
        <ItemGiveDrawer
          ign={selectedSnap.ign}
          uuid={selectedSnap.uuid}
          online={isOnline}
          onClose={() => setShowGive(false)}
        />
      )}
    </div>
  );
}

/**
 * Per-player statistics dashboard.
 *
 * Reads raw Minecraft stats JSON from /api/players/:ign/stats and renders
 * overview cards, kill breakdown, distance stats, and activity tables.
 */

import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Clock, Skull, Swords, Footprints,
  Pickaxe, Hammer, Package, AlertTriangle,
} from "lucide-react";
import { api } from "@/api/client";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Strip "minecraft:" prefix for display. */
function stripNs(id: string): string {
  return id.replace(/^minecraft:/, "");
}

/** Convert a stat key like "minecraft:zombie" to "Zombie". */
function displayName(id: string): string {
  return stripNs(id)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** MC ticks (play_time, total_world_time) to human-readable. */
function ticksToHuman(ticks: number): string {
  const totalSecs = Math.floor(ticks / 20);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** CM values (walk_one_cm, etc.) to readable distance. */
function cmToHuman(cm: number): string {
  const m = cm / 100;
  if (m >= 1000) return `${(m / 1000).toFixed(1)}km`;
  return `${Math.round(m)}m`;
}

/** Sort entries by value descending, return top N. */
function topN(
  obj: Record<string, number> | undefined,
  n: number,
): [string, number][] {
  if (!obj) return [];
  return Object.entries(obj)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}

// ── Types ───────────────────────────────────────────────────────────────────

interface McStats {
  stats: {
    "minecraft:custom"?:    Record<string, number>;
    "minecraft:killed"?:    Record<string, number>;
    "minecraft:killed_by"?: Record<string, number>;
    "minecraft:mined"?:     Record<string, number>;
    "minecraft:crafted"?:   Record<string, number>;
    "minecraft:used"?:      Record<string, number>;
    "minecraft:picked_up"?: Record<string, number>;
    "minecraft:broken"?:    Record<string, number>;
    "minecraft:dropped"?:   Record<string, number>;
  };
}

// ── Reusable card classes ────────────────────────────────────────────────────

const STAT_CARD =
  "card flex flex-col items-center justify-center text-center py-4 px-3 min-h-[96px]";

// ── Component ───────────────────────────────────────────────────────────────

export function PlayerStatsPage() {
  const { ign } = useParams<{ ign: string }>();

  const { data, isLoading, error } = useQuery<McStats>({
    queryKey: ["player-stats", ign],
    queryFn: () => api.get(`/players/${ign}/stats`),
    enabled: !!ign,
    staleTime: 60_000,
  });

  const custom    = data?.stats?.["minecraft:custom"]    ?? {};
  const killed    = data?.stats?.["minecraft:killed"]    ?? {};
  const killedBy  = data?.stats?.["minecraft:killed_by"] ?? {};
  const mined     = data?.stats?.["minecraft:mined"]     ?? {};
  const crafted   = data?.stats?.["minecraft:crafted"]   ?? {};
  const used      = data?.stats?.["minecraft:used"]      ?? {};
  const broken    = data?.stats?.["minecraft:broken"]    ?? {};

  // Aggregate values
  const playTime    = custom["minecraft:play_time"]       ?? 0;
  const deaths      = custom["minecraft:deaths"]          ?? 0;
  const mobKills    = custom["minecraft:mob_kills"]        ?? 0;
  const dmgDealt    = custom["minecraft:damage_dealt"]     ?? 0;
  const dmgTaken    = custom["minecraft:damage_taken"]     ?? 0;
  const jumps       = custom["minecraft:jump"]             ?? 0;
  const sleeps      = custom["minecraft:sleep_in_bed"]     ?? 0;

  // Distance stats (in cm)
  const distances: { label: string; cm: number; color: string }[] = [
    { label: "Walking",   cm: custom["minecraft:walk_one_cm"]      ?? 0, color: "#36B37E" },
    { label: "Sprinting", cm: custom["minecraft:sprint_one_cm"]    ?? 0, color: "#5B9BF0" },
    { label: "Flying",    cm: custom["minecraft:fly_one_cm"]       ?? 0, color: "#C084FC" },
    { label: "Swimming",  cm: custom["minecraft:swim_one_cm"]      ?? 0, color: "#22D3EE" },
    { label: "Horse",     cm: custom["minecraft:horse_one_cm"]     ?? 0, color: "#FBBF24" },
    { label: "Boat",      cm: custom["minecraft:boat_one_cm"]      ?? 0, color: "#F97316" },
    { label: "Minecart",  cm: custom["minecraft:minecart_one_cm"]  ?? 0, color: "#EF4444" },
    { label: "Crouching", cm: custom["minecraft:crouch_one_cm"]    ?? 0, color: "#9B9EA6" },
  ].filter((d) => d.cm > 0);

  const totalDistCm = distances.reduce((a, d) => a + d.cm, 0);
  const maxDist     = Math.max(...distances.map((d) => d.cm), 1);

  const topKilled   = topN(killed, 10);
  const topKilledBy = topN(killedBy, 10);
  const topMined    = topN(mined, 12);
  const topCrafted  = topN(crafted, 12);
  const topUsed     = topN(used, 12);
  const topBroken   = topN(broken, 10);

  const totalMined   = Object.values(mined).reduce((a, b) => a + b, 0);
  const totalCrafted = Object.values(crafted).reduce((a, b) => a + b, 0);

  return (
    <div className="page-wide space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/players"
          className="p-1.5 rounded-lg text-meta hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-3">
          <img
            src={`https://mc-heads.net/avatar/${ign}/40`}
            alt={ign}
            className="w-10 h-10 rounded-lg"
          />
          <div>
            <h1 className="text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">
              {ign}
            </h1>
            <p className="text-xs text-meta">Player Statistics</p>
          </div>
        </div>
      </div>

      {isLoading && (
        <p className="text-sm text-meta italic text-center py-8">Loading stats...</p>
      )}

      {error && (
        <div className="card flex items-center gap-2 text-[#EF4444] text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Failed to load stats. The player may not have joined the current world yet.
        </div>
      )}

      {data && (
        <>
          {/* ── Overview Cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className={STAT_CARD}>
              <Clock className="w-5 h-5 text-[#5B9BF0] mb-1" />
              <span className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
                {ticksToHuman(playTime)}
              </span>
              <span className="text-[10px] text-meta uppercase tracking-wider">Play Time</span>
            </div>
            <div className={STAT_CARD}>
              <Skull className="w-5 h-5 text-[#EF4444] mb-1" />
              <span className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
                {deaths}
              </span>
              <span className="text-[10px] text-meta uppercase tracking-wider">Deaths</span>
            </div>
            <div className={STAT_CARD}>
              <Swords className="w-5 h-5 text-[#F97316] mb-1" />
              <span className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
                {mobKills}
              </span>
              <span className="text-[10px] text-meta uppercase tracking-wider">Mob Kills</span>
            </div>
            <div className={STAT_CARD}>
              <Footprints className="w-5 h-5 text-[#36B37E] mb-1" />
              <span className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
                {cmToHuman(totalDistCm)}
              </span>
              <span className="text-[10px] text-meta uppercase tracking-wider">Distance</span>
            </div>
            <div className={STAT_CARD}>
              <Pickaxe className="w-5 h-5 text-[#FBBF24] mb-1" />
              <span className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
                {totalMined.toLocaleString()}
              </span>
              <span className="text-[10px] text-meta uppercase tracking-wider">Blocks Mined</span>
            </div>
            <div className={STAT_CARD}>
              <Hammer className="w-5 h-5 text-[#C084FC] mb-1" />
              <span className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
                {totalCrafted.toLocaleString()}
              </span>
              <span className="text-[10px] text-meta uppercase tracking-wider">Items Crafted</span>
            </div>
          </div>

          {/* ── Secondary stats row ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat label="Damage Dealt" value={dmgDealt.toLocaleString()} />
            <MiniStat label="Damage Taken" value={dmgTaken.toLocaleString()} />
            <MiniStat label="Jumps" value={jumps.toLocaleString()} />
            <MiniStat label="Nights Slept" value={sleeps.toLocaleString()} />
          </div>

          {/* ── Two-column layout ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Distance Breakdown */}
            {distances.length > 0 && (
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
                  <Footprints className="w-4 h-4 text-[#36B37E]" />
                  Distance Traveled
                </h3>
                <div className="space-y-1.5">
                  {distances.map((d) => (
                    <div key={d.label} className="flex items-center gap-2 text-xs">
                      <span className="w-16 text-meta text-right">{d.label}</span>
                      <div className="flex-1 h-4 rounded-full bg-[#F0EDE9] dark:bg-[#2A2D38] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.max((d.cm / maxDist) * 100, 2)}%`,
                            backgroundColor: d.color,
                          }}
                        />
                      </div>
                      <span className="w-16 font-mono text-[#1C1E27] dark:text-[#EAECF0]">
                        {cmToHuman(d.cm)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Kill Breakdown */}
            {topKilled.length > 0 && (
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
                  <Swords className="w-4 h-4 text-[#F97316]" />
                  Mobs Killed
                </h3>
                <StatList entries={topKilled} />
              </div>
            )}

            {/* Killed By */}
            {topKilledBy.length > 0 && (
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
                  <Skull className="w-4 h-4 text-[#EF4444]" />
                  Killed By
                </h3>
                <StatList entries={topKilledBy} />
              </div>
            )}

            {/* Blocks Mined */}
            {topMined.length > 0 && (
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
                  <Pickaxe className="w-4 h-4 text-[#FBBF24]" />
                  Top Blocks Mined
                </h3>
                <StatList entries={topMined} />
              </div>
            )}

            {/* Items Crafted */}
            {topCrafted.length > 0 && (
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
                  <Hammer className="w-4 h-4 text-[#C084FC]" />
                  Top Items Crafted
                </h3>
                <StatList entries={topCrafted} />
              </div>
            )}

            {/* Items Used */}
            {topUsed.length > 0 && (
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#22D3EE]" />
                  Most Used Items
                </h3>
                <StatList entries={topUsed} />
              </div>
            )}

            {/* Tools Broken */}
            {topBroken.length > 0 && (
              <div className="card space-y-2">
                <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#9B9EA6]" />
                  Tools Broken
                </h3>
                <StatList entries={topBroken} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex items-center justify-between py-2 px-3">
      <span className="text-[10px] text-meta uppercase tracking-wider">{label}</span>
      <span className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">{value}</span>
    </div>
  );
}

function StatList({ entries }: { entries: [string, number][] }) {
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="space-y-1">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-2 text-xs">
          <span className="w-28 truncate text-meta text-right" title={displayName(key)}>
            {displayName(key)}
          </span>
          <div className="flex-1 h-3.5 rounded-full bg-[#F0EDE9] dark:bg-[#2A2D38] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#5B9BF0] transition-all"
              style={{ width: `${Math.max((val / max) * 100, 3)}%` }}
            />
          </div>
          <span className="w-12 font-mono text-[#1C1E27] dark:text-[#EAECF0] text-right">
            {val.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Dashboard — redstoneCipher command centre.
 *
 * Design principles applied:
 *   • NNG Heuristic 1 — Visibility of system status: server health dominates
 *     the top-left attention anchor; colour + icon encode state instantly.
 *   • Fitts's Law — actionable items (copy IP, go to page) are large tap targets.
 *   • Hick's Law — ≤ 5 metrics visible above the fold; detail lives below.
 *   • Gestalt Proximity — related metrics are grouped in cards, not scattered.
 *   • Progressive Disclosure — player snapshots, recent chat, and music expand
 *     below-the-fold without cluttering the primary status view.
 *   • KLM-GOMS — zero clicks to see server health + who's online (F pattern).
 *   • Context — Minecraft server: palette borrows grass green, stone grey,
 *     diamond blue, and redstone red. Gauge fills use MC-flavoured colours.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Copy, Check, Users, Clock, Music2,
  MapPin, ChevronRight, Wifi, Moon, RefreshCw,
  Pickaxe, Sword, Package,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useMetrics } from "@/hooks/useMetrics";
import { EventStatusCard } from "./EventStatusCard";
import type { ServerStatus, McPlayer, PlayerSnapshot, MusicState } from "@/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseUptimeDate(raw: string): Date | null {
  if (!raw.trim()) return null;
  const iso = raw.replace(/^\w+\s+/, "").replace(" UTC", "Z").replace(" ", "T");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function elapsedLabel(since: Date, now: number): string {
  const secs = Math.floor((now - since.getTime()) / 1000);
  if (secs < 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Animated arc gauge — SVG-based, renders 0–100% fill. */
function ArcGauge({
  value, color, size = 80, strokeWidth = 7, label, sublabel,
}: {
  value: number | null;
  color: string;
  size?: number;
  strokeWidth?: number;
  label?: string;
  sublabel?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  // 270-degree arc (starts at bottom-left, ends at bottom-right)
  const startAngle = -225;
  const totalDeg   = 270;
  const pct        = value != null ? Math.min(100, Math.max(0, value)) : 0;
  const fillDeg    = (pct / 100) * totalDeg;

  function polarToXY(cx: number, cy: number, r: number, deg: number) {
    const rad = (deg - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  const start  = polarToXY(cx, cy, r, startAngle);
  const end    = polarToXY(cx, cy, r, startAngle + fillDeg);
  const bgEnd  = polarToXY(cx, cy, r, startAngle + totalDeg);
  const fillLg = fillDeg > 180 ? 1 : 0;
  const bgLg   = 1;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} aria-hidden>
        {/* Track */}
        <path
          d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${bgLg} 1 ${bgEnd.x} ${bgEnd.y}`}
          fill="none" stroke="currentColor" className="text-[#E5E2DE] dark:text-[#363944]"
          strokeWidth={strokeWidth} strokeLinecap="round"
        />
        {/* Fill */}
        {value != null && pct > 0 && (
          <path
            d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${fillLg} 1 ${end.x} ${end.y}`}
            fill="none" stroke={color}
            strokeWidth={strokeWidth} strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        )}
        {/* Centre text */}
        <text x={cx} y={cy + 4} textAnchor="middle" className="fill-[#1C1E27] dark:fill-[#EAECF0]"
          fontSize={size * 0.2} fontWeight="700" fontFamily="inherit">
          {value != null ? `${Math.round(value)}%` : "—"}
        </text>
      </svg>
      {label    && <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0]">{label}</p>}
      {sublabel && <p className="text-[10px] text-meta">{sublabel}</p>}
    </div>
  );
}

/** Mini Minecraft head avatar. */
function MCHead({ ign, size = 24 }: { ign: string; size?: number }) {
  return (
    <img
      src={`https://mc-heads.net/avatar/${ign}/${size}`}
      alt={ign}
      width={size}
      height={size}
      className="rounded-sm flex-shrink-0"
      loading="lazy"
    />
  );
}

/** Player health bar — 20 HP = full. */
function HealthBar({ hp }: { hp: number }) {
  const hearts = Math.round(hp / 2);
  const maxHearts = 10;
  return (
    <div className="flex gap-0.5 items-center" title={`${hp}/20 HP`}>
      {Array.from({ length: maxHearts }).map((_, i) => (
        <span key={i} className={`text-[9px] leading-none ${i < hearts ? "text-[#F87171]" : "text-[#9B9EA6]"}`}>
          ♥
        </span>
      ))}
    </div>
  );
}

// ── Copy-to-clipboard chip ─────────────────────────────────────────────────────

function CopyChip({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      className="flex items-center gap-2 rounded-xl border border-[#D9D5D0] dark:border-[#363944]
                 bg-[#F7F5F2] dark:bg-[#1E212B] px-3 py-2 hover:border-[#5B9BF0] transition-colors
                 focus-visible:ring-2 focus-visible:ring-[#5B9BF0] outline-none"
      aria-label={`Copy ${label}`}
      title="Click to copy"
    >
      <Wifi className="w-4 h-4 text-[#5B9BF0] flex-shrink-0" aria-hidden />
      <div className="text-left min-w-0">
        <p className="text-[10px] text-meta uppercase tracking-wider">{label}</p>
        <p className="font-mono font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0] truncate">{text}</p>
      </div>
      <div className="ml-auto flex-shrink-0">
        {copied
          ? <Check  className="w-3.5 h-3.5 text-[#36B37E]" aria-hidden />
          : <Copy   className="w-3.5 h-3.5 text-meta"       aria-hidden />}
      </div>
    </button>
  );
}

// ── Uptime live counter ────────────────────────────────────────────────────────

function UptimeBadge({ raw }: { raw: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const since = parseUptimeDate(raw);
  return (
    <div className="flex items-center gap-1.5 text-xs text-meta" title={since?.toLocaleString()}>
      <Clock className="w-3.5 h-3.5" aria-hidden />
      {since ? `Up ${elapsedLabel(since, now)}` : "Uptime unknown"}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { data: status } = useQuery<ServerStatus>({
    queryKey:      ["server-status"],
    queryFn:       () => api.get("/server/status"),
    refetchInterval: 15_000,
  });

  const metrics = useMetrics();

  const { data: livePlayers = [] } = useQuery<McPlayer[]>({
    queryKey:      ["mc-players"],
    queryFn:       () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  const { data: snapshots = [] } = useQuery<PlayerSnapshot[]>({
    queryKey:      ["player-snapshots"],
    queryFn:       () => api.get("/players/snapshots"),
    refetchInterval: 60_000,
  });

  const { data: musicState } = useQuery<MusicState>({
    queryKey:      ["music-state"],
    queryFn:       () => api.get("/music/state"),
    refetchInterval: 10_000,
  });

  const { data: recentChat = [] } = useQuery<{ id: number; author: string; content: string; sent_at: string }[]>({
    queryKey:      ["chat-history"],
    queryFn:       () => api.get("/chat/history?limit=8"),
    refetchInterval: 15_000,
  });

  const online    = livePlayers.filter((p) => p.online);
  const vmStatus  = status?.vm?.status ?? "…";
  const gameActive = metrics?.service_active ?? (status?.service === "active");
  const serverIP   = status?.vm?.tailscale_ip;
  const np         = musicState?.now_playing;

  // Merge online status into snapshots for the player cards
  const onlineSet = new Set(online.map((p) => p.ign));
  const activeSnapshots = snapshots
    .filter((s) => onlineSet.has(s.ign))
    .sort((a, b) => a.ign.localeCompare(b.ign));

  return (
    <div className="page-wide space-y-5">
      {/* ── Hero status bar — visibility of system status (NNG #1) ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Server health card — primary attention anchor, top-left F-pattern */}
        <div className={`card col-span-1 lg:col-span-2 flex flex-col sm:flex-row sm:items-center gap-4
          ${gameActive
            ? "border-l-4 border-l-[#36B37E]"
            : "border-l-4 border-l-[#F87171]"}`}>
          {/* Status indicator cluster */}
          <div className="flex items-center gap-4 flex-1">
            <div className="relative flex-shrink-0">
              {/* Pulsing dot — the only active indicator */}
              <div className={`w-3 h-3 rounded-full ${gameActive ? "bg-[#36B37E]" : "bg-[#F87171]"}`}>
                {gameActive && (
                  <span className="absolute inset-0 rounded-full bg-[#36B37E] animate-ping opacity-60" />
                )}
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
                  {gameActive ? "Server Online" : "Server Offline"}
                </p>
                {metrics && <UptimeBadge raw={metrics.uptime_raw} />}
              </div>
              <p className="text-sm text-meta mt-0.5">
                {gameActive
                  ? `${online.length > 0 ? `${online.length} player${online.length !== 1 ? "s" : ""} online` : "No players online"} · VM ${vmStatus}`
                  : "Minecraft service is not running"}
              </p>
              {/* Online player mini-faces */}
              {online.length > 0 && (
                <div className="flex items-center gap-1 mt-2">
                  {online.slice(0, 8).map((p) => (
                    <MCHead key={p.ign} ign={p.ign} size={20} />
                  ))}
                  {online.length > 8 && (
                    <span className="text-xs text-meta ml-1">+{online.length - 8} more</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Connect address */}
          {serverIP && (
            <div className="flex-shrink-0">
              <CopyChip text={serverIP} label="Join address (Tailscale)" />
            </div>
          )}
        </div>

        {/* Now Playing card */}
        <div className="card flex flex-col justify-between gap-3">
          <div className="flex items-center gap-2">
            <Music2 className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
            <p className="text-xs font-semibold uppercase tracking-wider text-meta">Now Playing</p>
          </div>
          {np ? (
            <>
              <div className="flex-1">
                <p className="font-semibold text-[#1C1E27] dark:text-[#EAECF0] text-sm leading-snug truncate">
                  {np.display_name}
                </p>
                {np.artist && <p className="text-xs text-meta truncate">{np.artist}</p>}
                {/* Progress bar */}
                <div className="mt-2 space-y-1">
                  <div className="h-1 rounded-full bg-[#E5E2DE] dark:bg-[#363944] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#5B9BF0] transition-all duration-1000"
                      style={{ width: `${Math.min(100, (np.elapsed_secs / np.duration_secs) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-meta">
                    <span>{Math.floor(np.elapsed_secs / 60)}:{String(np.elapsed_secs % 60).padStart(2, "0")}</span>
                    <span>{Math.floor(np.duration_secs / 60)}:{String(np.duration_secs % 60).padStart(2, "0")}</span>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-meta">Requested by {np.requested_by?.split("@")[0]}</p>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-2 text-meta">
              <Music2 className="w-8 h-8 opacity-20" aria-hidden />
              <p className="text-xs">Nothing playing</p>
              <Link to="/music" className="text-xs text-[#5B9BF0] hover:underline">Queue a track →</Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Event status (members see active/scheduled; admins manage in Events) ── */}
      <EventStatusCard />

      {/* ── Performance gauges ───────────────────────────────────────────────── */}
      {metrics ? (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-meta">Performance</p>
            <RefreshCw className="w-3.5 h-3.5 text-meta" aria-hidden />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 justify-items-center">
            {/* Players: count + capacity — shown as number, not % */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-20 h-20 rounded-2xl bg-[#F7F5F2] dark:bg-[#1E212B] flex flex-col items-center justify-center gap-0.5">
                <Users className="w-4 h-4 text-meta" aria-hidden />
                <p className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0] leading-none">
                  {metrics.players_online ?? 0}
                </p>
              </div>
              <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0]">Players</p>
              <p className="text-[10px] text-meta">{metrics.players_online ?? 0} of 20</p>
            </div>
            <ArcGauge
              value={metrics.jvm_mem_pct ?? null}
              color={
                (metrics.jvm_mem_pct ?? 0) > 85 ? "#F87171" :
                (metrics.jvm_mem_pct ?? 0) > 65 ? "#FBBF24" : "#36B37E"
              }
              label="Game RAM"
              sublabel="JVM heap %"
            />
            <ArcGauge
              value={metrics.vm_cpu_pct ?? null}
              color={
                (metrics.vm_cpu_pct ?? 0) > 85 ? "#F87171" :
                (metrics.vm_cpu_pct ?? 0) > 65 ? "#FBBF24" : "#9B9EA6"
              }
              label="VM CPU"
              sublabel="all cores"
            />
            {/* Uptime tile — clock icon, no emoji */}
            <div className="flex flex-col items-center gap-1">
              <div className="w-20 h-20 rounded-2xl bg-[#F7F5F2] dark:bg-[#1E212B] flex flex-col items-center justify-center gap-0.5 px-1">
                <Clock className="w-4 h-4 text-meta" aria-hidden />
                {metrics.uptime_raw ? (
                  <p className="text-sm font-bold text-[#1C1E27] dark:text-[#EAECF0] leading-none text-center">
                    {(() => {
                      const d = parseUptimeDate(metrics.uptime_raw);
                      return d ? elapsedLabel(d, Date.now()) : "—";
                    })()}
                  </p>
                ) : <p className="text-sm font-bold text-[#1C1E27] dark:text-[#EAECF0]">—</p>}
              </div>
              <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0]">Uptime</p>
              <p className="text-[10px] text-meta capitalize">{gameActive ? "running" : "offline"}</p>
            </div>
          </div>
        </div>
      ) : gameActive ? (
        <div className="card flex items-center gap-3 text-meta">
          <div className="w-4 h-4 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-sm">Loading performance data…</span>
        </div>
      ) : null}

      {/* ── Two-column lower grid ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Online players — rich cards with location, health, inventory count */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
              <p className="text-xs font-semibold uppercase tracking-wider text-meta">
                Players {online.length > 0 && `(${online.length})`}
              </p>
            </div>
            <Link to="/players" className="text-xs text-[#5B9BF0] hover:underline flex items-center gap-0.5">
              All <ChevronRight className="w-3 h-3" aria-hidden />
            </Link>
          </div>

          {online.length === 0 ? (
            <div className="flex flex-col items-center py-6 gap-2 text-meta">
              <Moon className="w-8 h-8 opacity-20" aria-hidden />
              <p className="text-sm">The server is quiet</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {activeSnapshots.length > 0
                ? activeSnapshots.map((snap) => {
                    const inv = (() => { try { return JSON.parse(snap.inventory_json || "[]"); } catch { return []; } })();
                    const dim = snap.dimension.replace("minecraft:", "").replace("_", " ");
                    return (
                      <li key={snap.ign}
                        className="flex items-center gap-3 rounded-xl bg-[#F7F5F2] dark:bg-[#1E212B] p-2.5">
                        <MCHead ign={snap.ign} size={32} />
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] truncate">
                              {snap.ign}
                            </p>
                            <span className="w-1.5 h-1.5 rounded-full bg-[#36B37E] flex-shrink-0" />
                          </div>
                          <HealthBar hp={snap.health} />
                          <div className="flex items-center gap-3 text-[10px] text-meta">
                            <span className="flex items-center gap-0.5">
                              <MapPin className="w-2.5 h-2.5" aria-hidden />
                              {Math.round(snap.x)}, {Math.round(snap.y)}, {Math.round(snap.z)}
                            </span>
                            <span className="capitalize">{dim}</span>
                            <span className="flex items-center gap-0.5">
                              <Package className="w-2.5 h-2.5" aria-hidden />
                              {inv.length} items
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })
                : online.map((p) => (
                    <li key={p.ign}
                      className="flex items-center gap-3 rounded-xl bg-[#F7F5F2] dark:bg-[#1E212B] p-2.5">
                      <MCHead ign={p.ign} size={32} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">{p.ign}</p>
                        <p className="text-[10px] text-meta">Snapshot loading…</p>
                      </div>
                      <span className="w-2 h-2 rounded-full bg-[#36B37E]" />
                    </li>
                  ))
              }
            </ul>
          )}
        </div>

        {/* Recent chat */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pickaxe className="w-4 h-4 text-[#FBBF24]" aria-hidden />
              <p className="text-xs font-semibold uppercase tracking-wider text-meta">Recent Chat</p>
            </div>
            <Link to="/chat" className="text-xs text-[#5B9BF0] hover:underline flex items-center gap-0.5">
              Open <ChevronRight className="w-3 h-3" aria-hidden />
            </Link>
          </div>
          {recentChat.length === 0 ? (
            <div className="flex flex-col items-center py-6 gap-2 text-meta">
              <Sword className="w-8 h-8 opacity-20" aria-hidden />
              <p className="text-sm">No messages yet</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {recentChat.slice(0, 6).map((msg) => (
                <li key={msg.id} className="flex items-start gap-2">
                  <MCHead ign={msg.author} size={18} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                        {msg.author}
                      </span>
                      <span className="text-[10px] text-meta">{fmtTime(msg.sent_at)}</span>
                    </div>
                    <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB] leading-relaxed mt-0.5 break-words">
                      {msg.content}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

    </div>
  );
}

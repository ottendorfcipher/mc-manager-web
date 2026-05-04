import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Clock, Cpu, Brain, ServerCrash, Activity } from "lucide-react";
import { api } from "@/api/client";
import { useMetrics } from "@/hooks/useMetrics";
import { StatusDot } from "@/components/Badge";
import type { ServerStatus } from "@/types";

function MetricTile({
  icon: Icon, label, value, sub,
}: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="card flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[#9B9EA6] text-xs font-medium">
        <Icon className="w-3.5 h-3.5" aria-hidden />
        {label}
      </div>
      <p className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">{value}</p>
      {sub && <p className="text-xs text-[#9B9EA6]">{sub}</p>}
    </div>
  );
}

/**
 * Parse a systemctl ActiveEnterTimestamp string (e.g. "Mon 2026-04-28 00:00:00 UTC")
 * into a Date, or return null if the string is empty / unparseable.
 */
function parseUptimeDate(raw: string): Date | null {
  if (!raw.trim()) return null;
  // Strip leading day-of-week, swap space→T, replace trailing " UTC" with "Z"
  const iso = raw
    .replace(/^\w+\s+/, "")   // "Mon " → ""
    .replace(" UTC", "Z")      // " UTC" → "Z"
    .replace(" ", "T");        // "2026-04-28 00:00:00Z" → ISO8601
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** Format elapsed seconds as a compact human duration, e.g. "2d 5h 12m". */
function elapsedLabel(since: Date, now: number): string {
  const secs = Math.floor((now - since.getTime()) / 1000);
  if (secs < 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${secs}s`;
}

/** Compact "since" label, e.g. "since Apr 28, 00:00". */
function sinceLabel(since: Date): string {
  return `since ${since.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  })}`;
}

/** Live uptime tile: ticks every 30 s without waiting for a metrics refetch. */
function UptimeTile({ raw }: { raw: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const since = parseUptimeDate(raw);
  const value = since ? elapsedLabel(since, now) : "—";
  const sub   = since ? sinceLabel(since) : undefined;

  return <MetricTile icon={Clock} label="Uptime" value={value} sub={sub} />;
}

export function DashboardPage() {
  const { data: status } = useQuery<ServerStatus>({
    queryKey: ["server-status"],
    queryFn:  () => api.get("/server/status"),
    refetchInterval: 15_000,
  });

  const metrics = useMetrics();

  const vmStatus = status?.vm?.status ?? "…";

  // Prefer the live SSE value for game status; fall back to the polled status.
  const gameActive = metrics != null
    ? metrics.service_active
    : status?.service === "active";
  const mcServiceLabel = metrics != null
    ? (metrics.service_active ? "active" : "inactive")
    : (status?.service ?? "…");

  return (
    <div className="page-wide">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Dashboard</h1>
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0] mt-0.5">
          Live overview of your Minecraft server
        </p>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <div className="card flex items-center gap-3">
          <StatusDot status={vmStatus} />
          <div>
            <p className="text-xs text-[#9B9EA6]">Server</p>
            <p className="font-semibold text-[#1C1E27] dark:text-[#EAECF0] text-sm">{vmStatus}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <StatusDot status={gameActive ? "RUNNING" : "TERMINATED"} />
          <div>
            <p className="text-xs text-[#9B9EA6]">Minecraft</p>
            <p className="font-semibold text-[#1C1E27] dark:text-[#EAECF0] text-sm capitalize">{mcServiceLabel}</p>
          </div>
        </div>
      </div>

      {/* Metrics grid — only shown when live data is available */}
      {metrics ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <MetricTile icon={Users} label="Online Players"
            value={metrics.players_online != null ? String(metrics.players_online) : "—"} />
          <UptimeTile raw={metrics.uptime_raw} />
          <MetricTile icon={Brain} label="Game Memory"
            value={metrics.jvm_mem_pct != null ? `${metrics.jvm_mem_pct.toFixed(1)}%` : "—"} />
          <MetricTile icon={Cpu}   label="VM CPU"
            value={metrics.vm_cpu_pct  != null ? `${metrics.vm_cpu_pct.toFixed(1)}%`  : "—"} />
        </div>
      ) : vmStatus === "RUNNING" ? (
        <div className="card flex items-center gap-3 text-[#9B9EA6]">
          <Activity className="w-4 h-4 animate-pulse" />
          <span className="text-sm">Connecting to game metrics…</span>
        </div>
      ) : (
        <div className="card flex items-center gap-3 text-[#9B9EA6]">
          <ServerCrash className="w-4 h-4" />
          <span className="text-sm">Metrics unavailable — VM is offline</span>
        </div>
      )}

      {/* Tailscale address */}
      {status?.vm?.tailscale_ip && (
        <div className="card">
          <p className="text-xs text-[#9B9EA6] mb-1">Connect in Minecraft</p>
          <code className="text-[#5B9BF0] font-mono font-semibold">{status.vm.tailscale_ip}</code>
          <p className="text-xs text-[#9B9EA6] mt-1">Requires Tailscale — Java Edition port 25565</p>
        </div>
      )}
    </div>
  );
}

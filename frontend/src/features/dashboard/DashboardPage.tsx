import React from "react";
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
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Dashboard</h1>
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0] mt-0.5">
          Live overview of your Minecraft server
        </p>
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card flex items-center gap-3">
          <StatusDot status={vmStatus} />
          <div>
            <p className="text-xs text-[#9B9EA6]">Cloud VM</p>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MetricTile icon={Users} label="Online Players"
            value={metrics.players_online != null ? String(metrics.players_online) : "—"} />
          <MetricTile icon={Clock} label="Uptime"
            value={metrics.uptime_raw || "—"} />
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
          <p className="text-xs text-[#9B9EA6] mt-1">Requires Tailscale — Minecraft Java port 25565</p>
        </div>
      )}
    </div>
  );
}

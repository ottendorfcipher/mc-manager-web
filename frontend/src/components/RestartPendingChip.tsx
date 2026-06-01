import React from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Zap, Loader2 } from "lucide-react";

const API = "/api";

interface PluginJob {
  id:    number;
  state: string;
  kind:  string;
}

async function fetchActiveJobs(): Promise<PluginJob[]> {
  const resp = await fetch(`${API}/plugins/jobs?active=true`);
  if (!resp.ok) return [];
  return resp.json();
}

async function triggerRestart(): Promise<void> {
  const resp = await fetch(`${API}/plugins/restart`, { method: "POST" });
  if (!resp.ok) throw new Error("Restart failed");
}

export function RestartPendingChip() {
  const { data: jobs } = useQuery<PluginJob[]>({
    queryKey:        ["plugins/jobs/active"],
    queryFn:         fetchActiveJobs,
    refetchInterval: 30_000,
    staleTime:       10_000,
  });

  const restartMut = useMutation({ mutationFn: triggerRestart });

  const pendingJobs = (jobs ?? []).filter((j) => j.state === "restart_pending");

  if (pendingJobs.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full
                    bg-amber-100 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700
                    text-amber-800 dark:text-amber-200 text-xs font-medium">
      <Zap className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
      <span>Add-ons waiting for restart</span>
      <button
        onClick={() => restartMut.mutate()}
        disabled={restartMut.isPending}
        className="ml-1 text-[#5B9BF0] hover:underline flex items-center gap-1 disabled:opacity-50"
      >
        {restartMut.isPending && <Loader2 className="w-3 h-3 animate-spin" aria-hidden />}
        Restart now
      </button>
    </div>
  );
}

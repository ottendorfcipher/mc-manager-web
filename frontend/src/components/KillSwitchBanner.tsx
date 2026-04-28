import { useEffect, useState } from "react";
import { AlertTriangle, PowerOff } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { KillSwitchStatus } from "@/types";

const POLL_MS = 30_000;

/**
 * Shows a sticky banner when the kill-switch is engaged. Users with
 * `killswitch.toggle` can re-enable from the banner itself.
 *
 * The banner is intentionally non-dismissable: if the tool is disabled,
 * hiding that fact would mislead operators.
 */
export function KillSwitchBanner() {
  const { hasPerm } = useAuthStore();
  const [state, setState] = useState<KillSwitchStatus | null>(null);

  useEffect(() => {
    if (!hasPerm("killswitch.view")) return;

    const tick = () =>
      api.get<KillSwitchStatus>("/kill-switch").then(setState).catch(() => setState(null));

    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [hasPerm]);

  if (!state?.disabled_at) return null;

  const canToggle = hasPerm("killswitch.toggle");
  const release = async () => {
    try {
      await api.delete("/kill-switch");
      setState({ disabled_at: null, reason: null, source: null });
    } catch (e) {
      console.error("Failed to release kill-switch:", e);
    }
  };

  return (
    <div
      role="alert"
      data-testid="kill-switch-banner"
      className="flex items-center gap-3 px-4 py-2 bg-[#F87171] text-white text-sm"
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden />
      <div className="flex-1">
        <span className="font-semibold">Tool disabled</span>
        {state.reason && <span className="opacity-90"> — {state.reason}</span>}
        {state.source && <span className="opacity-75 ml-1">({state.source})</span>}
      </div>
      {canToggle && (
        <button
          onClick={release}
          className="bg-white/20 hover:bg-white/30 px-2 py-1 rounded text-xs font-semibold flex items-center gap-1"
          data-testid="kill-switch-release"
        >
          <PowerOff className="w-3 h-3" aria-hidden /> Re-enable
        </button>
      )}
    </div>
  );
}

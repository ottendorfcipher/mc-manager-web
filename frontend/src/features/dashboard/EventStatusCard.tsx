/**
 * Dashboard event-status card.
 *
 * Regular members can't open the Events tab (admin-only), but they should still
 * know when something is happening. This compact card surfaces any active event
 * and the next scheduled ones, read-only, gated on `events.status.view`.
 */
import { useQuery } from "@tanstack/react-query";
import { Timer, CalendarClock, Radio } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { EventSummary } from "@/types";

export function EventStatusCard() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canView = hasPerm("events.status.view");

  const { data } = useQuery<EventSummary>({
    queryKey:        ["events-summary"],
    queryFn:         () => api.get("/events/summary"),
    refetchInterval: 15_000,
    enabled:         canView,
  });

  if (!canView || !data) return null;
  const { active, scheduled } = data;
  if (active.length === 0 && scheduled.length === 0) return null;

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <Timer className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wider text-meta">Events</p>
      </div>

      {active.length > 0 && (
        <div className="space-y-1.5">
          {active.map((e, i) => (
            <div
              key={`a-${i}`}
              className="flex items-center gap-2.5 rounded-xl bg-[#ECFDF5] dark:bg-[#052e16] px-3 py-2"
            >
              <Radio className="w-4 h-4 text-[#36B37E] animate-pulse flex-shrink-0" aria-hidden />
              <span className="flex-1 min-w-0 text-sm font-semibold text-[#065f46] dark:text-[#6EE7B7] truncate">
                {e.name}
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-[#36B37E]">
                Live
              </span>
              {e.detail && (
                <span className="text-sm font-mono tabular-nums text-[#065f46] dark:text-[#6EE7B7]">
                  {e.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {scheduled.length > 0 && (
        <div className="space-y-1">
          {active.length > 0 && (
            <p className="text-[10px] uppercase tracking-wider text-meta font-semibold pt-1">
              Scheduled
            </p>
          )}
          {scheduled.map((e, i) => (
            <div key={`s-${i}`} className="flex items-center gap-2.5 px-1 py-1">
              <CalendarClock className="w-3.5 h-3.5 text-meta flex-shrink-0" aria-hidden />
              <span className="flex-1 min-w-0 text-sm text-[#1C1E27] dark:text-[#EAECF0] truncate">
                {e.name}
              </span>
              {e.detail && (
                <span className="text-[10px] font-mono text-meta truncate max-w-[40%]">
                  {e.detail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

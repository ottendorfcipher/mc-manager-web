import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";

interface PlayerPlaytime { ign: string; minutes: number; sessions: number; last_seen: string }
interface HourBucket { hour: number; sessions: number }
interface ActivityInsights {
  days: number;
  total_sessions: number;
  players: PlayerPlaytime[];
  peak_hours: HourBucket[];
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Top players by playtime + a 24h peak-hours histogram, over the last 30 days. */
export function ActivityInsightsCard() {
  const { hasPerm } = useAuthStore();
  const canView = hasPerm("nav.players");

  const { data, isLoading } = useQuery<ActivityInsights>({
    queryKey: ["activity-insights", 30],
    queryFn:  () => api.get("/players/insights?days=30"),
    enabled:  canView,
    staleTime: 60_000,
  });

  if (!canView) return null;

  const players = data?.players ?? [];
  const peak = data?.peak_hours ?? [];
  const maxMinutes = players.reduce((m, p) => Math.max(m, p.minutes), 0) || 1;
  const peakByHour = new Array(24).fill(0) as number[];
  for (const b of peak) peakByHour[b.hour] = b.sessions;
  const maxHour = Math.max(1, ...peakByHour);

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Activity</h3>
        </div>
        <span className="text-[11px] text-meta">
          {data ? `${data.total_sessions} sessions · 30d` : "30d"}
        </span>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" aria-hidden />
        </div>
      ) : players.length === 0 ? (
        <p className="text-sm text-meta text-center py-6">No play sessions recorded yet.</p>
      ) : (
        <>
          {/* Top players by playtime */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-meta font-semibold">Top players</p>
            {players.slice(0, 6).map((p) => (
              <div key={p.ign} className="flex items-center gap-2">
                <span className="w-24 text-xs text-[#1C1E27] dark:text-[#EAECF0] truncate" title={p.ign}>{p.ign}</span>
                <div className="flex-1 h-2 rounded-full bg-[#E5E2DE] dark:bg-[#363944] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#5B9BF0]"
                    style={{ width: `${Math.max(4, (p.minutes / maxMinutes) * 100)}%` }}
                  />
                </div>
                <span className="w-14 text-right text-[11px] text-meta tabular-nums">{fmtMinutes(p.minutes)}</span>
              </div>
            ))}
          </div>

          {/* Peak hours (UTC) */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-meta font-semibold">Busiest hours (UTC)</p>
            <div className="flex items-end gap-[2px] h-16" role="img" aria-label="Sessions by hour of day">
              {peakByHour.map((count, hour) => (
                <div
                  key={hour}
                  className="flex-1 bg-[#5B9BF0]/70 rounded-t-sm hover:bg-[#5B9BF0] transition-colors"
                  style={{ height: `${Math.max(2, (count / maxHour) * 100)}%` }}
                  title={`${hour.toString().padStart(2, "0")}:00 — ${count} session${count === 1 ? "" : "s"}`}
                />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-meta">
              <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

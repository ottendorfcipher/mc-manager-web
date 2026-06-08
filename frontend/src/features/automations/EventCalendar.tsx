import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { api } from "@/api/client";

interface CalendarEvent {
  title:       string;
  kind:        string;
  action_type: string;
  when:        string; // RFC3339
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Month-grid calendar of upcoming scheduled automations (next ~90 days). */
export function EventCalendar() {
  const [offset, setOffset] = useState(0); // months from the current month

  const { data: events = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey:  ["events-calendar"],
    queryFn:   () => api.get("/events/calendar?days=90"),
    staleTime: 60_000,
  });

  const now  = new Date();
  const view = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay = useMemo(() => {
    const m = new Map<number, CalendarEvent[]>();
    for (const e of events) {
      const d = new Date(e.when);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const arr = m.get(d.getDate()) ?? [];
        arr.push(e);
        m.set(d.getDate(), arr);
      }
    }
    return m;
  }, [events, year, month]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday = (d: number) =>
    d === now.getDate() && month === now.getMonth() && year === now.getFullYear();

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            {MONTHS[month]} {year}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setOffset((o) => o - 1)} className="icon-btn" aria-label="Previous month">
            <ChevronLeft className="w-4 h-4" aria-hidden />
          </button>
          <button
            onClick={() => setOffset(0)}
            disabled={offset === 0}
            className="text-xs px-2 py-1 rounded-lg text-meta hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] disabled:opacity-40"
          >
            Today
          </button>
          <button onClick={() => setOffset((o) => o + 1)} className="icon-btn" aria-label="Next month">
            <ChevronRight className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[10px] uppercase tracking-wider text-meta font-semibold text-center py-1">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const evs = d ? byDay.get(d) ?? [] : [];
          return (
            <div
              key={i}
              className={`min-h-[68px] rounded-lg p-1 border text-left ${
                d
                  ? "border-[#E5E2DE] dark:border-[#2A2D38] bg-white dark:bg-[#1C1E27]"
                  : "border-transparent"
              }`}
            >
              {d && (
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[11px] ${
                      isToday(d)
                        ? "bg-[#5B9BF0] text-white rounded-full w-5 h-5 flex items-center justify-center font-semibold"
                        : "text-meta"
                    }`}
                  >
                    {d}
                  </span>
                </div>
              )}
              <div className="mt-0.5 space-y-0.5">
                {evs.slice(0, 2).map((e, j) => (
                  <div
                    key={j}
                    title={`${e.title} · ${fmtTime(e.when)} · ${e.action_type}`}
                    className="text-[9px] leading-tight px-1 py-0.5 rounded bg-[#EFF6FF] dark:bg-[#1E3A5F]
                               text-[#5B9BF0] truncate"
                  >
                    {fmtTime(e.when)} {e.title}
                  </div>
                ))}
                {evs.length > 2 && (
                  <div className="text-[9px] text-meta pl-1">+{evs.length - 2} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!isLoading && events.length === 0 && (
        <p className="text-xs text-meta text-center mt-3">
          No scheduled automations in the next 90 days.
        </p>
      )}
    </div>
  );
}

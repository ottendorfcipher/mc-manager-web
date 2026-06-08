import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api } from "@/api/client";
import { toast } from "@/components/Toast";

interface NotificationPrefs {
  pending_player: boolean;
  world_switch:   boolean;
  kill_switch:    boolean;
}

const CATEGORIES: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
  { key: "pending_player", label: "New player waiting", desc: "A new player joined and needs approval." },
  { key: "world_switch",   label: "World switched",     desc: "The active Minecraft world changed." },
  { key: "kill_switch",    label: "Kill switch engaged", desc: "The global kill switch was turned on." },
];

/** Per-user email notification toggles (Admin → Integrations). */
export function NotificationPrefsCard() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery<NotificationPrefs>({
    queryKey: ["notification-prefs"],
    queryFn:  () => api.get("/me/notification-prefs"),
    staleTime: 60_000,
  });
  const mut = useMutation({
    mutationFn: (next: NotificationPrefs) => api.put<NotificationPrefs>("/me/notification-prefs", next),
    onSuccess:  (data) => { qc.setQueryData(["notification-prefs"], data); toast.success("Notification preferences saved."); },
  });

  const toggle = (key: keyof NotificationPrefs) => {
    if (!prefs) return;
    mut.mutate({ ...prefs, [key]: !prefs[key] });
  };

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Email notifications</h3>
          <p className="text-xs text-meta mt-0.5">
            Which alerts you receive by email. (Requires the server's email integration to be configured.)
          </p>
        </div>
      </div>

      {isLoading || !prefs ? (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" aria-hidden />
        </div>
      ) : (
        <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
          {CATEGORIES.map(({ key, label, desc }) => {
            const on = prefs[key];
            return (
              <div key={key} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-[#1C1E27] dark:text-[#EAECF0]">{label}</p>
                  <p className="text-xs text-meta">{desc}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={`${label}: ${on ? "on" : "off"}`}
                  disabled={mut.isPending}
                  onClick={() => toggle(key)}
                  className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
                    on ? "bg-[#5B9BF0]" : "bg-[#D9D5D0] dark:bg-[#363944]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      on ? "translate-x-4" : ""
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

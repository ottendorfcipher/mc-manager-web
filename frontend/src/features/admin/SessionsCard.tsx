import { useQuery, useMutation } from "@tanstack/react-query";
import { Monitor, LogOut } from "lucide-react";
import { api } from "@/api/client";
import { toast } from "@/components/Toast";

interface LoginEvent {
  id:         number;
  ip:         string | null;
  user_agent: string | null;
  created_at: string;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

/** Rough, human-friendly device label from a User-Agent string. */
function device(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" : "Browser";
  const os =
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Windows/.test(ua) ? "Windows" :
    /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Recent sign-ins + "sign out everywhere" (Admin → Integrations). */
export function SessionsCard() {
  const { data: events = [], isLoading } = useQuery<LoginEvent[]>({
    queryKey:  ["sessions"],
    queryFn:   () => api.get("/me/sessions"),
    staleTime: 60_000,
  });

  const revoke = useMutation({
    mutationFn: () => api.post("/me/sessions/revoke-all"),
    onSuccess:  () => {
      toast.info("Signed out everywhere — redirecting…");
      // Current token is now invalid; clear the cookie + go to login.
      setTimeout(() => { window.location.href = "/auth/logout"; }, 1000);
    },
  });

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Recent sign-ins</h3>
            <p className="text-xs text-meta mt-0.5">Where your account has signed in recently.</p>
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm("Sign out of ALL devices, including this one? You'll need to sign in again.")) {
              revoke.mutate();
            }
          }}
          disabled={revoke.isPending}
          className="btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden /> Sign out everywhere
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" aria-hidden />
        </div>
      ) : events.length === 0 ? (
        <p className="text-xs text-meta text-center py-3">No sign-ins recorded yet.</p>
      ) : (
        <ul className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-[#1C1E27] dark:text-[#EAECF0]">{device(e.user_agent)}</span>
              <span className="text-xs text-meta font-mono">{e.ip ?? "—"}</span>
              <span className="text-xs text-meta whitespace-nowrap">{fmt(e.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

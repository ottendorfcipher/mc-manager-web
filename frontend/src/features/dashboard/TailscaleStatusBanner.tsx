import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WifiOff, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/api/client";

// Mirror of backend::gcloud::tailscale::TsDevice.  Kept inline here
// instead of in types/ — the wire shape is small and only one feature
// consumes it.
interface TsDevice {
  hostname:   string;
  os:         string;
  ips:        string[];
  online:     boolean;
  last_seen:  string | null;
  is_self:    boolean;
}

/**
 * Treat "last seen ≤ 7 days ago" as a device the user normally uses.
 * Older than that and the device is dormant — listing it as offline
 * would create false alarms.
 */
const RECENTLY_USED_DAYS = 7;

/**
 * Banner that surfaces "your Minecraft client can't reach the server
 * because the device you're playing from isn't on Tailscale right now".
 *
 * Renders nothing when:
 *   • the user has no Tailscale devices linked to their email
 *   • every recently-used device is online
 *
 * Otherwise: a single soft warning with the offending device(s) and
 * a collapsible block of plain-English reconnect steps.
 */
export function TailscaleStatusBanner() {
  const [showFix, setShowFix] = useState(false);

  const { data: devices = [] } = useQuery<TsDevice[]>({
    queryKey:      ["tailscale-my-devices"],
    queryFn:       () => api.get("/tailscale/my-devices"),
    refetchInterval: 60_000,
    staleTime:       30_000,
    retry:           false,
  });

  // Filter to "recently active" devices — anything seen in the last week.
  // A laptop that's been off for months shouldn't trigger an alarm
  // every dashboard load.
  const now = Date.now();
  const recentlyUsed = devices.filter((d) => {
    if (d.is_self) return false;        // never warn about the web VPS itself
    if (d.online) return true;
    if (!d.last_seen) return false;     // never connected
    const t = Date.parse(d.last_seen);
    if (Number.isNaN(t)) return false;
    return now - t < RECENTLY_USED_DAYS * 24 * 60 * 60 * 1000;
  });

  const offline = recentlyUsed.filter((d) => !d.online);
  if (offline.length === 0) return null;

  return (
    <div
      role="status"
      className="rounded-xl border border-[#FBBF24]/60 bg-[#FEF3C7] dark:bg-[#2A2210]
                 dark:border-[#B88500]/60 px-4 py-3 space-y-2"
    >
      <div className="flex items-start gap-3">
        <WifiOff className="w-5 h-5 mt-0.5 flex-shrink-0 text-[#B45309] dark:text-[#FBBF24]" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            {offline.length === 1
              ? "One of your devices isn't on the VPN right now"
              : `${offline.length} of your devices aren't on the VPN right now`}
          </p>
          <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB] mt-0.5">
            The Minecraft server is private — if your client isn't on the
            VPN, it can't see the server even though it's running.
          </p>
          <ul className="mt-2 space-y-1">
            {offline.map((d) => (
              <li
                key={d.hostname}
                className="flex items-center gap-2 text-xs text-[#1C1E27] dark:text-[#EAECF0]"
              >
                <WifiOff className="w-3 h-3 text-[#9B9EA6]" aria-hidden />
                <span className="font-mono">{d.hostname}</span>
                <span className="text-meta">({d.os})</span>
                {d.last_seen && (
                  <span className="text-meta">· last online {fmtRelative(d.last_seen)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <button
          onClick={() => setShowFix((v) => !v)}
          className="flex-shrink-0 text-xs font-medium text-[#B45309] dark:text-[#FBBF24] hover:underline flex items-center gap-1"
          aria-expanded={showFix}
        >
          How to fix
          {showFix
            ? <ChevronUp   className="w-3.5 h-3.5" aria-hidden />
            : <ChevronDown className="w-3.5 h-3.5" aria-hidden />}
        </button>
      </div>

      {showFix && (
        <div className="mt-2 ml-8 space-y-2 text-xs text-[#1C1E27] dark:text-[#EAECF0]">
          <ol className="list-decimal list-inside space-y-1">
            <li>On the affected device, open the <strong>Tailscale</strong> tray / menu-bar icon.</li>
            <li>If it says you're signed out, sign in again with the same Google account.</li>
            <li>If you're signed in, click <strong>Reconnect</strong> (or quit and reopen Tailscale).</li>
            <li>Once the status shows "Connected", retry Minecraft.</li>
          </ol>
          <p className="text-meta">
            Still stuck? Restart the Tailscale service from a terminal —
            <code className="ml-1 font-mono">sudo systemctl restart tailscaled</code> on Linux,{" "}
            <code className="font-mono">Restart-Service Tailscale</code> in an elevated PowerShell on Windows,
            or quit the Tailscale macOS app and reopen it.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * "3 minutes ago", "2 hours ago", "yesterday".  Falls back to the
 * locale date if the timestamp is unparseable.
 */
function fmtRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return new Date(t).toLocaleDateString();
}

/**
 * ImpersonationBanner — persistent top bar while an admin is viewing
 * the portal as another user.
 *
 * Design intent:
 *   • High-contrast amber to unambiguously signal "this is not normal view".
 *   • Always visible — no collapse, no dismiss, only Exit.
 *   • Shows who you are, who you're viewing as, and a clear exit path.
 *   • Proxied action count kept in state so there's a log-level reminder
 *     of how many actions were taken during the session.
 */

import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Eye } from "lucide-react";
import { useImpersonationStore } from "@/store/auth";

export function ImpersonationBanner() {
  const qc = useQueryClient();
  const { impersonatingAs, impersonatingName, stopImpersonation } =
    useImpersonationStore();

  if (!impersonatingAs) return null;

  function exit() {
    stopImpersonation();
    // Invalidate /me so the auth store re-fetches with the real user's
    // permissions; also blow away every cached query so they re-fetch
    // without the impersonation header.
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.clear();
    // Hard reload is the safest way to guarantee the nav re-renders with
    // the real user's permissions — a full React tree re-render is
    // cheaper than tracking every permission-gated component.
    window.location.reload();
  }

  return (
    <div
      role="banner"
      aria-label="Impersonation active"
      className="flex items-center gap-3 px-4 py-2.5
                 bg-[#FFFBEB] dark:bg-[#2A1F00]
                 border-b-2 border-[#FCD34D] dark:border-[#B45309]
                 text-[#92400E] dark:text-[#FCD34D]
                 text-sm font-medium select-none z-[60] relative"
    >
      <Eye className="w-4 h-4 flex-shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">
        Viewing as{" "}
        <span className="font-semibold">
          {impersonatingName ?? impersonatingAs}
        </span>
        <span className="font-normal opacity-70 ml-1 text-xs">
          ({impersonatingAs})
        </span>
        <span className="ml-2 text-xs opacity-60">
          · All actions are logged under your account
        </span>
      </span>
      <button
        onClick={exit}
        className="flex items-center gap-1.5 px-3 py-1 rounded-lg
                   bg-[#FCD34D]/30 hover:bg-[#FCD34D]/50
                   dark:bg-[#B45309]/30 dark:hover:bg-[#B45309]/50
                   text-xs font-semibold transition-colors flex-shrink-0
                   focus-visible:ring-2 focus-visible:ring-[#B45309]"
        aria-label="Exit impersonation"
      >
        <LogOut className="w-3.5 h-3.5" aria-hidden />
        Exit
      </button>
    </div>
  );
}

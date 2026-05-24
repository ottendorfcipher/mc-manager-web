/**
 * Renders a row of party-quick-select chips above any player picker.
 *
 * Clicking a chip toggles all of that party's IGNs into the parent's
 * selected set.  The chip indicates partial / full selection visually.
 *
 * Parties don't bind to the target persistently — the parent still stores
 * IGNs — but the chip is the fastest way for an admin to grab a known group.
 */

import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { api } from "@/api/client";
import type { PartyWithMembers } from "@/types";

interface Props {
  /** IGNs currently selected in the parent picker. */
  selected: Set<string>;
  /** Update the parent's selected set. */
  onChange: (next: Set<string>) => void;
  /** Optional: shown only when there are parties + a parent picker is in
   *  specific-targets mode (not "everyone"). */
  visible?: boolean;
}

const SWATCH_HEX: Record<string, string> = {
  yellow:       "#FFFF55",
  gold:         "#FFAA00",
  green:        "#55FF55",
  dark_green:   "#00AA00",
  aqua:         "#55FFFF",
  dark_aqua:    "#00AAAA",
  blue:         "#5555FF",
  dark_blue:    "#0000AA",
  red:          "#FF5555",
  dark_red:     "#AA0000",
  light_purple: "#FF55FF",
  dark_purple:  "#AA00AA",
  white:        "#FFFFFF",
  gray:         "#AAAAAA",
};

export function PartyChipBar({ selected, onChange, visible = true }: Props) {
  const { data: parties = [] } = useQuery<PartyWithMembers[]>({
    queryKey: ["parties"],
    queryFn:  () => api.get("/parties"),
  });

  if (!visible || parties.length === 0) return null;

  function toggleParty(p: PartyWithMembers) {
    const igns = p.members.map((m) => m.player_ign);
    const allIn = igns.every((i) => selected.has(i));
    const next = new Set(selected);
    if (allIn) {
      igns.forEach((i) => next.delete(i));
    } else {
      igns.forEach((i) => next.add(i));
    }
    onChange(next);
  }

  return (
    <div className="flex items-center gap-1 flex-wrap mb-1.5">
      <span className="text-[10px] text-meta uppercase tracking-wider font-medium mr-1">
        <Users className="w-2.5 h-2.5 inline mr-0.5" />
        Parties
      </span>
      {parties.map((p) => {
        const igns = p.members.map((m) => m.player_ign);
        const all  = igns.length > 0 && igns.every((i) => selected.has(i));
        const some = igns.some((i) => selected.has(i));
        const hex  = SWATCH_HEX[p.color] ?? "#55FFFF";
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => toggleParty(p)}
            title={`${p.name} (${igns.length} member${igns.length === 1 ? "" : "s"})`}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium
                        border transition-all ${
                          all
                            ? "text-white border-transparent"
                            : some
                              ? "border-current"
                              : "text-[#1C1E27] dark:text-[#EAECF0] border-[#D9D5D0] dark:border-[#363944] hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]"
                        }`}
            style={all
              ? { backgroundColor: hex, color: pickContrastingText(hex) }
              : some
                ? { color: hex, borderColor: hex }
                : undefined}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: hex }} />
            {p.name}
            <span className="opacity-70 tabular-nums">{igns.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/// Pick black or white text based on background brightness.
function pickContrastingText(hex: string): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1C1E27" : "#FFFFFF";
}

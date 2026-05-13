import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";

// ── Chat unread store (shared between ChatPage and Layout) ────────────────────

interface ChatUnreadStore {
  count: number;
  increment: () => void;
  clear: () => void;
}

export const useChatUnread = create<ChatUnreadStore>((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
  clear:     () => set({ count: 0 }),
}));

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

type ShortcutMap = Record<string, () => void>;

/**
 * Register global keyboard shortcuts. Shortcuts are ignored when the user
 * is typing in an input, textarea, or select.
 *
 * Supports both single keys ("?", "Escape") and two-key chords written as
 * space-separated lowercase letters ("g d", "g s").
 *
 * Usage (in a component that is always mounted, e.g. Layout):
 *   useHotkeys({
 *     "g d": () => navigate("/"),
 *     "g s": () => navigate("/server"),
 *     "?":   () => setShowHelp(true),
 *   });
 */
export function useHotkeys(shortcuts: ShortcutMap) {
  useEffect(() => {
    let chord = "";
    let timer: ReturnType<typeof setTimeout>;

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName ?? "";
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      // Single-key shortcuts
      if (shortcuts[e.key]) {
        shortcuts[e.key]();
        chord = "";
        clearTimeout(timer);
        return;
      }

      // Chord shortcuts: accumulate key presses
      chord = chord ? `${chord} ${e.key.toLowerCase()}` : e.key.toLowerCase();
      clearTimeout(timer);

      if (shortcuts[chord]) {
        shortcuts[chord]();
        chord = "";
        return;
      }

      // Reset chord after 1 s of inactivity
      timer = setTimeout(() => { chord = ""; }, 1000);
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      clearTimeout(timer);
    };
  }, [shortcuts]);
}

// ── Navigation shortcuts wired to react-router ───────────────────────────────

/**
 * Hook that registers the standard navigation shortcuts for the app.
 * Call this once in Layout.tsx so shortcuts are available on every page.
 *
 *   G D → Dashboard
 *   G S → Server
 *   G T → Team
 *   G V → Inventory (players)
 *   G C → Chat
 *   G M → Map
 *   G B → Backups
 *   G X → Configure
 *   G A → Admin
 */
export function useNavigationHotkeys() {
  const navigate = useNavigate();

  useHotkeys({
    "g d": () => navigate("/"),
    "g s": () => navigate("/server"),
    "g t": () => navigate("/team"),
    "g v": () => navigate("/players"),
    "g c": () => navigate("/chat"),
    "g m": () => navigate("/map"),
    "g b": () => navigate("/backups"),
    "g x": () => navigate("/configure"),
    "g a": () => navigate("/admin"),
  });
}

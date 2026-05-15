import { create } from "zustand";
import type { MeResponse } from "@/types";

interface AuthState {
  user:    MeResponse | null;
  loading: boolean;
  setUser: (user: MeResponse | null) => void;
  setLoading: (v: boolean) => void;
  hasPerm: (key: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user:    null,
  loading: true,
  setUser:    (user)    => set({ user }),
  setLoading: (loading) => set({ loading }),
  hasPerm:    (key)     => (get().user?.permission_keys ?? []).includes(key),
}));

// ── Navigation preferences store ─────────────────────────────────────────
// Persists navigation display prefs in localStorage so they survive page reloads.
// Separate from auth so Layout can subscribe without pulling in the full auth state.

const NAV_PREFS_KEY = "rsc_nav_prefs";

function readNavPref(key: string, defaultVal: boolean): boolean {
  try {
    const raw = localStorage.getItem(NAV_PREFS_KEY);
    if (!raw) return defaultVal;
    return JSON.parse(raw)[key] ?? defaultVal;
  } catch {
    return defaultVal;
  }
}

function writeNavPref(key: string, value: boolean) {
  try {
    const raw = localStorage.getItem(NAV_PREFS_KEY);
    const prefs = raw ? JSON.parse(raw) : {};
    localStorage.setItem(NAV_PREFS_KEY, JSON.stringify({ ...prefs, [key]: value }));
  } catch { /* ignore */ }
}

interface NavPrefsState {
  /** Show the Configure → server.properties editor in the sidebar. Off by default. */
  showConfigureNav: boolean;
  setShowConfigureNav: (v: boolean) => void;
}

export const useNavPrefsStore = create<NavPrefsState>((set) => ({
  showConfigureNav: readNavPref("showConfigureNav", false),
  setShowConfigureNav: (v) => {
    writeNavPref("showConfigureNav", v);
    set({ showConfigureNav: v });
  },
}));

// ── Theme store ───────────────────────────────────────────────

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

function applyTheme(theme: Theme) {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
  localStorage.setItem("mc_theme", theme);
}

export const useThemeStore = create<ThemeState>((set) => {
  const saved = (localStorage.getItem("mc_theme") ?? "system") as Theme;
  applyTheme(saved);
  return {
    theme: saved,
    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme });
    },
  };
});

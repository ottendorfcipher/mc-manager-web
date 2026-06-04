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

// ── Impersonation store ──────────────────────────────────────────────────────
// Stores the target user email being impersonated.  The API client reads this
// and injects X-Impersonate-As on every request.
// Sessions survive page reload via sessionStorage (intentionally not
// localStorage — closing the tab clears the impersonation).

const IMP_KEY = "rsc_impersonate_as";

interface ImpersonationState {
  /** Email of the user being impersonated, or null. */
  impersonatingAs: string | null;
  /** Display name of the impersonated user (for the banner). */
  impersonatingName: string | null;
  startImpersonation: (email: string, name: string) => void;
  stopImpersonation:  () => void;
}

export const useImpersonationStore = create<ImpersonationState>((set) => {
  const stored = (() => {
    try {
      const raw = sessionStorage.getItem(IMP_KEY);
      return raw ? (JSON.parse(raw) as { email: string; name: string }) : null;
    } catch { return null; }
  })();
  return {
    impersonatingAs:   stored?.email ?? null,
    impersonatingName: stored?.name  ?? null,
    startImpersonation: (email, name) => {
      try { sessionStorage.setItem(IMP_KEY, JSON.stringify({ email, name })); } catch { /* ignore */ }
      set({ impersonatingAs: email, impersonatingName: name });
    },
    stopImpersonation: () => {
      try { sessionStorage.removeItem(IMP_KEY); } catch { /* ignore */ }
      set({ impersonatingAs: null, impersonatingName: null });
    },
  };
});

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

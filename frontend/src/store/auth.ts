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

// ── Theme store ───────────────────────────────────────────────────────────────

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

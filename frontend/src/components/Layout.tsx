import React from "react";
import { NavLink } from "react-router-dom";
import {
  Server, Users, HardDrive, Settings, Activity,
  Sun, Moon, Monitor, LogOut, Pickaxe, ShieldCheck, Map,
} from "lucide-react";
import { useAuthStore, useThemeStore } from "@/store/auth";

const NAV = [
  { to: "/",                    icon: Activity,    label: "Dashboard",   perm: "nav.dashboard" },
  { to: "/server",              icon: Server,      label: "Server",      perm: "nav.server" },
  { to: "/team",                icon: Users,       label: "Team",        perm: "nav.team" },
  { to: "/map",                 icon: Map,         label: "Map",         perm: "nav.map" },
  { to: "/backups",             icon: HardDrive,   label: "Backups",     perm: "nav.backups" },
  { to: "/configure",           icon: Settings,    label: "Configure",   perm: "nav.configure" },
  { to: "/admin",               icon: ShieldCheck, label: "Admin",       perm: "nav.admin" },
] as const;

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, hasPerm } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const nav = NAV.filter((n) => hasPerm(n.perm));

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <aside
        className="w-56 flex-shrink-0 flex flex-col sidebar border-r"
        aria-label="Main navigation"
      >
        {/* App header */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-[#D9D5D0] dark:border-[#363944]">
          <Pickaxe className="w-5 h-5 text-[#5B9BF0]" aria-hidden />
          <span className="font-bold text-[#1C1E27] dark:text-[#EAECF0] text-sm">
            redstoneCipher
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5" role="navigation">
          <p className="text-[10px] uppercase tracking-wider text-[#9B9EA6] px-3 py-1.5 font-semibold">
            Navigation
          </p>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `nav-item ${isActive ? "nav-item-active" : ""}`
              }
              aria-label={label}
            >
              <Icon className="w-4 h-4 flex-shrink-0" aria-hidden />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Bottom: theme + user */}
        <div className="px-2 pb-3 space-y-2 border-t border-[#D9D5D0] dark:border-[#363944] pt-3">
          {/* Theme toggle */}
          <div className="flex items-center gap-1 px-2">
            {(
              [
                ["light",  Sun,     "Light mode"],
                ["system", Monitor, "System mode"],
                ["dark",   Moon,    "Dark mode"],
              ] as const
            ).map(([t, Icon, label]) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                title={label}
                aria-pressed={theme === t}
                className={`flex-1 flex justify-center py-1.5 rounded-lg transition-colors
                  ${theme === t
                    ? "bg-[#5B9BF0] text-white"
                    : "text-[#9B9EA6] hover:bg-[#DBD8D3] dark:hover:bg-[#2F323D]"
                  }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden />
              </button>
            ))}
          </div>

          {/* Signed-in user */}
          {user && (
            <div className="flex items-center gap-2 px-3 py-2">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="w-7 h-7 rounded-full"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#5B9BF0] flex items-center justify-center text-white text-xs font-bold">
                  {user.display_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                  {user.display_name}
                </p>
                <p className="text-[10px] text-[#9B9EA6] truncate capitalize">
                  {user.role.replace("_", " ")}
                </p>
              </div>
              <a
                href="/auth/logout"
                title="Sign out"
                className="text-[#9B9EA6] hover:text-[#F87171] transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden />
              </a>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main
        className="flex-1 overflow-y-auto bg-[#F7F5F2] dark:bg-[#13151A]"
        id="main-content"
      >
        {children}
      </main>
    </div>
  );
}

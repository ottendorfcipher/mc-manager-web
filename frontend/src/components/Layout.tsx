import React, { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Server, Users, HardDrive, Settings, Activity,
  Sun, Moon, Monitor, LogOut, Pickaxe, ShieldCheck, Map, MessageSquare,
  Backpack, Music2, Timer, Clock, MoreHorizontal,
} from "lucide-react";
import { useAuthStore, useThemeStore, useNavPrefsStore } from "@/store/auth";
import { useChatUnread, useNavigationHotkeys } from "@/hooks/useHotkeys";

const NAV = [
  { to: "/",          icon: Activity,       label: "Dashboard", perm: "nav.dashboard" },
  { to: "/server",    icon: Server,         label: "Server",    perm: "nav.server" },
  { to: "/team",      icon: Users,          label: "Team",      perm: "nav.team" },
  { to: "/players",   icon: Backpack,        label: "Inventory", perm: "nav.players" },
  { to: "/chat",      icon: MessageSquare,  label: "Chat",      perm: "nav.chat" },
  { to: "/music",     icon: Music2,          label: "Music",     perm: "nav.music" },
  { to: "/events",       icon: Timer,          label: "Events",      perm: "nav.events" },
  { to: "/automations",  icon: Clock,          label: "Automations", perm: "nav.automations" },
  { to: "/map",          icon: Map,            label: "Map",         perm: "nav.map" },
  { to: "/backups",   icon: HardDrive,      label: "Backups",   perm: "nav.backups" },
  { to: "/configure", icon: Settings,       label: "Configure", perm: "nav.configure" },
  { to: "/admin",     icon: ShieldCheck,    label: "Admin",     perm: "nav.admin" },
] as const;

// Bottom bar shows at most 4 primary items; the rest go into the More drawer.
const MOBILE_PRIMARY_COUNT = 4;

const THEME_OPTIONS = [
  ["light",  Sun,     "Light mode"]  as const,
  ["system", Monitor, "System mode"] as const,
  ["dark",   Moon,    "Dark mode"]   as const,
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, hasPerm } = useAuthStore();
  const { theme, setTheme } = useThemeStore();
  const { showConfigureNav } = useNavPrefsStore();
  const [moreOpen, setMoreOpen] = useState(false);
  const chatUnread = useChatUnread((s) => s.count);

  // Register navigation keyboard shortcuts (active on every authenticated page)
  useNavigationHotkeys();

  const nav = NAV.filter((n) => {
    // Configure is hidden from nav unless an admin has explicitly enabled it.
    if (n.to === "/configure") return showConfigureNav && hasPerm(n.perm);
    return hasPerm(n.perm);
  });
  const hasMobileOverflow = nav.length > MOBILE_PRIMARY_COUNT;
  const primaryNav = hasMobileOverflow ? nav.slice(0, MOBILE_PRIMARY_COUNT) : nav;
  const moreNav    = hasMobileOverflow ? nav.slice(MOBILE_PRIMARY_COUNT)    : [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Skip to main content — available on every authenticated page */}
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* ── Sidebar: hidden on mobile, icon-only on md, full on lg ── */}
      <aside
        className="hidden md:flex flex-col flex-shrink-0 sidebar border-r border-[#D9D5D0] dark:border-[#363944]
                   w-14 lg:w-56 transition-[width] duration-200"
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex items-center justify-center lg:justify-start gap-2
                        px-3 lg:px-4 py-5
                        border-b border-[#D9D5D0] dark:border-[#363944]">
          <Pickaxe className="w-5 h-5 text-[#5B9BF0] flex-shrink-0" aria-hidden />
          <span className="hidden lg:block font-bold text-[#1C1E27] dark:text-[#EAECF0] text-sm truncate">
            redstoneCipher
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 px-1.5 lg:px-2 py-3 space-y-0.5 overflow-y-auto" role="navigation">
          <p className="hidden lg:block text-[10px] uppercase tracking-wider text-meta
                        px-3 py-1.5 font-semibold">
            Navigation
          </p>
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              title={label}
              aria-label={label}
              className={({ isActive }) =>
                `nav-item justify-center lg:justify-start min-h-[44px] ${
                  isActive ? "nav-item-active" : ""
                }`
              }
            >
              <span className="relative flex-shrink-0">
                <Icon className="w-4 h-4" aria-hidden />
                {/* Unread badge on Chat icon */}
                {to === "/chat" && chatUnread > 0 && (
                  <span className="nav-badge" aria-label={`${chatUnread} unread message${chatUnread !== 1 ? "s" : ""}` }>
                    {chatUnread > 9 ? "9+" : chatUnread}
                  </span>
                )}
              </span>
              <span className="hidden lg:block flex-1">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Theme + user */}
        <div className="px-1.5 lg:px-2 pb-3 pt-3 space-y-2
                        border-t border-[#D9D5D0] dark:border-[#363944]">
          <div className="flex flex-col lg:flex-row items-stretch gap-0.5 lg:gap-1">
            {THEME_OPTIONS.map(([t, Icon, label]) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                title={label}
                aria-pressed={theme === t}
              className={`flex-1 flex justify-center items-center py-1.5 rounded-lg transition-colors
                  min-h-[44px] ${
                    theme === t
                      ? "bg-[#5B9BF0] text-white"
                      : "text-meta hover:bg-[#DBD8D3] dark:hover:bg-[#2F323D]"
                  }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden />
              </button>
            ))}
          </div>

          {user && (
            <div className="flex items-center gap-2 px-1 lg:px-2 py-1.5">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#5B9BF0] flex items-center justify-center
                                text-white text-xs font-bold flex-shrink-0">
                  {user.display_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="hidden lg:flex flex-1 min-w-0 flex-col">
                <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                  {user.display_name}
                </p>
                <p className="text-[10px] text-meta truncate capitalize">
                  {user.role.replace("_", " ")}
                </p>
              </div>
              <a
                href="/auth/logout"
                title="Sign out"
                aria-label="Sign out"
                className="hidden lg:block text-meta hover:text-[#F87171] transition-colors p-1"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden />
              </a>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main content ── */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 min-h-0 overflow-y-auto bg-[#F7F5F2] dark:bg-[#13151A]
                   pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0"
      >
        {children}
      </main>

      {/* ── Mobile bottom tab bar ── */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40
                   flex border-t border-[#D9D5D0] dark:border-[#363944]
                   bg-white/95 dark:bg-[#1C1E27]/95 backdrop-blur-sm
                   safe-area-bottom"
        aria-label="Mobile navigation"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {primaryNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            aria-label={to === "/chat" && chatUnread > 0 ? `Chat — ${chatUnread} unread` : label}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5
               min-h-[56px] px-1 py-2 text-[10px] font-medium transition-colors ${
                isActive
                  ? "text-[#5B9BF0]"
                  : "text-meta hover:text-[#6B6E78]"
              }`
            }
          >
            <span className="relative">
              <Icon className="w-5 h-5" aria-hidden />
              {to === "/chat" && chatUnread > 0 && (
                <span className="nav-badge" aria-hidden>
                  {chatUnread > 9 ? "9+" : chatUnread}
                </span>
              )}
            </span>
            {label}
          </NavLink>
        ))}

        {hasMobileOverflow && (
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More navigation items"
            aria-expanded={moreOpen}
            className="flex-1 flex flex-col items-center justify-center gap-0.5
                       min-h-[56px] px-1 py-2 text-[10px] font-medium
                       text-meta hover:text-[#6B6E78] transition-colors"
          >
            <MoreHorizontal className="w-5 h-5" aria-hidden />
            More
          </button>
        )}
      </nav>

      {/* ── More drawer (mobile) ── */}
      {moreOpen && (
        <>
          {/* Scrim */}
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-50"
            aria-hidden
            onClick={() => setMoreOpen(false)}
          />
          {/* Sheet */}
          <div
            role="dialog"
            aria-label="More navigation"
            className="md:hidden fixed inset-x-0 bottom-0 z-50
                       bg-white dark:bg-[#1C1E27] rounded-t-2xl shadow-2xl
                       px-4 pt-3 pb-safe"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            {/* Drag handle */}
            <div className="w-10 h-1 bg-[#D9D5D0] dark:bg-[#363944] rounded-full mx-auto mb-4" />

            {/* Overflow nav items */}
            <div className="space-y-0.5 mb-4">
              {moreNav.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === "/"}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium
                     min-h-[52px] transition-colors ${
                      isActive
                        ? "bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#5B9BF0]"
                        : "text-[#6B6E78] dark:text-[#A8AEBB] hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]"
                    }`
                  }
                >
                  <Icon className="w-5 h-5 flex-shrink-0" aria-hidden />
                  {label}
                </NavLink>
              ))}
            </div>

            {/* User + theme in drawer */}
            <div className="border-t border-[#D9D5D0] dark:border-[#363944] pt-3 space-y-3">
              {user && (
                <div className="flex items-center gap-3 px-2">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} alt="" className="w-9 h-9 rounded-full flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-[#5B9BF0] flex items-center justify-center
                                    text-white text-sm font-bold flex-shrink-0">
                      {user.display_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                      {user.display_name}
                    </p>
                    <p className="text-xs text-meta capitalize">
                      {user.role.replace("_", " ")}
                    </p>
                  </div>
                  <a
                    href="/auth/logout"
                    aria-label="Sign out"
                    className="p-2.5 rounded-lg text-meta hover:text-[#F87171]
                               hover:bg-[#FEE2E2] dark:hover:bg-[#3B1F1F] transition-colors"
                  >
                    <LogOut className="w-4 h-4" aria-hidden />
                  </a>
                </div>
              )}
              <div className="flex gap-1 px-2">
                {THEME_OPTIONS.map(([t, Icon, label]) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    title={label}
                    aria-pressed={theme === t}
                    className={`flex-1 flex justify-center py-2.5 rounded-lg transition-colors
                      min-h-[44px] ${
                        theme === t
                          ? "bg-[#5B9BF0] text-white"
                          : "text-meta hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38]"
                      }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden />
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

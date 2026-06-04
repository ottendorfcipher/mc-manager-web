import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavPrefsStore } from "@/store/auth";
import { UserPlus, X, Link, Users, Pickaxe, ShieldCheck, ChevronRight, Shield, ListChecks, Trash2, Map as MapIcon, Globe, Send, CheckCircle2, AlertTriangle, Loader2, Plug, Package, Eye, EyeOff, ClipboardList, RefreshCw, Menu, UserCheck, LogOut } from "lucide-react";
import { useImpersonationStore } from "@/store/auth";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { RoleBadge } from "@/components/Badge";
import { PermissionsPage } from "./PermissionsPage";
import { RolesTab } from "./RolesTab";
import { UserOverridePanel } from "./UserOverridePanel";
import type { User, PlayerLink, McPlayer, RoleRecord, PendingPlayer, BlueMapSettings, TailscaleInviteResult, DiscordSettings } from "@/types";
import { WorldsTab }    from "./WorldsTab";
import { InvitePortal } from "./InvitePortal";
import { ROLE_LEVELS }  from "@/types";
import { toast } from "@/components/Toast";

type Tab = "users" | "roles" | "pairing" | "permissions" | "whitelist" | "pending" | "map" | "worlds" | "integrations" | "audit";

// ── Nav groups — organise 10 sections into 3 mental models ───────────────────
// NNG: group by task, not by implementation. KLM-GOMS: fewer visual items =
// lower scan cost per navigation action.

interface NavItem { id: Tab; label: string; Icon: React.ElementType; }
interface NavGroup { label: string; items: NavItem[]; }

function useAdminNavGroups() {
  const { user, hasPerm } = useAuthStore();
  const isGlobalAdmin    = user?.role === "global_admin";
  const canSeeUsers      = hasPerm("users.view") || hasPerm("users.invite") || hasPerm("users.remove");
  const canSeeRoles      = hasPerm("roles.view") || hasPerm("roles.create") || hasPerm("roles.edit");
  const canEditPerms     = hasPerm("roles.edit") || hasPerm("users.permissions.edit");
  const canManage        = hasPerm("users.invite") || hasPerm("users.remove");
  const canManageWl      = hasPerm("server.whitelist.manage");
  const canSeePending    = hasPerm("players.pending.view") || hasPerm("players.pending.manage");
  const canSeeWorlds     = hasPerm("worlds.view");
  const canConfigDiscord = hasPerm("discord.configure");

  const groups: NavGroup[] = [
    {
      label: "Team & Access",
      items: [
        canSeeUsers    && { id: "users"       as Tab, label: "Users",             Icon: Users },
        canSeeRoles    && { id: "roles"       as Tab, label: "Roles",             Icon: Shield },
        canEditPerms   && { id: "permissions" as Tab, label: "Permissions",       Icon: ShieldCheck },
        canManage      && { id: "pairing"     as Tab, label: "MC Pairing",        Icon: Pickaxe },
        canSeePending  && { id: "pending"     as Tab, label: "Pending Players",   Icon: UserPlus },
        canManageWl    && { id: "whitelist"   as Tab, label: "MC Whitelist",      Icon: ListChecks },
      ].filter(Boolean) as NavItem[],
    },
    {
      label: "Server",
      items: [
        canSeeWorlds && { id: "worlds" as Tab, label: "Worlds",  Icon: Globe },
        isGlobalAdmin && { id: "map"   as Tab, label: "Map",     Icon: MapIcon },
      ].filter(Boolean) as NavItem[],
    },
    {
      label: "System",
      items: [
        canConfigDiscord && { id: "integrations" as Tab, label: "Integrations", Icon: Plug },
        isGlobalAdmin    && { id: "audit"        as Tab, label: "Audit Log",    Icon: ClipboardList },
      ].filter(Boolean) as NavItem[],
    },
  ].filter((g) => g.items.length > 0);

  return groups;
}

// ── AdminPage ─────────────────────────────────────────────────────────────────

export function AdminPage() {
  const [tab,        setTab]        = useState<Tab>("users");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const groups = useAdminNavGroups();

  // All flat items (for keyboard nav)
  const allItems = groups.flatMap((g) => g.items);
  const currentLabel = allItems.find((i) => i.id === tab)?.label ?? "Admin";

  function navigate(id: Tab) {
    setTab(id);
    setDrawerOpen(false);
  }

  // Sidebar nav — shared between the inline sidebar and the mobile drawer
  function SidebarNav({ onSelect }: { onSelect: (id: Tab) => void }) {
    return (
      <nav aria-label="Admin navigation" className="space-y-5">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-meta px-3 mb-1 select-none">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(({ id, label, Icon }) => (
                <li key={id}>
                  <button
                    onClick={() => onSelect(id)}
                    aria-current={tab === id ? "page" : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left
                      ${tab === id
                        ? "bg-[#5B9BF0] text-white"
                        : "text-[#6B6E78] dark:text-[#9BA0B0] hover:bg-[#F0EDE9] dark:hover:bg-[#2F323D] hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
                      }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" aria-hidden />
                    {label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-screen-xl mx-auto">
      {/* Page header — mobile shows section name + hamburger */}
      <div className="flex items-center justify-between mb-4 lg:mb-6">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile hamburger — only visible below lg */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="icon-btn lg:hidden flex-shrink-0"
            aria-label="Open admin menu"
            aria-expanded={drawerOpen}
          >
            <Menu className="w-5 h-5" aria-hidden />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0] truncate">
              <span className="hidden lg:inline">Admin — </span>{currentLabel}
            </h1>
            <p className="text-xs sm:text-sm text-meta mt-0.5 hidden sm:block">
              Manage users, roles, server, and integrations
            </p>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            aria-hidden
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            className="fixed top-0 left-0 h-full w-72 bg-white dark:bg-[#1C1E27] z-50 shadow-2xl
                       drawer-enter overflow-y-auto p-5 lg:hidden"
            aria-label="Admin menu"
          >
            <div className="flex items-center justify-between mb-6">
              <span className="font-bold text-[#1C1E27] dark:text-[#EAECF0]">Admin Settings</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="icon-btn"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
            <SidebarNav onSelect={navigate} />
          </aside>
        </>
      )}

      {/* Two-column layout: sidebar (lg+) + content */}
      <div className="flex gap-6">
        {/* Sidebar — hidden on mobile/tablet, shown on lg+ */}
        <aside className="hidden lg:block w-52 flex-shrink-0">
          <div className="sticky top-6">
            <SidebarNav onSelect={navigate} />
          </div>
        </aside>

        {/* Main content area */}
        <main className="flex-1 min-w-0">
          <div role="tabpanel" id="tabpanel-users"       aria-label="Users"             hidden={tab !== "users"}><UsersTab /></div>
          <div role="tabpanel" id="tabpanel-roles"       aria-label="Roles"             hidden={tab !== "roles"}><RolesTab /></div>
          <div role="tabpanel" id="tabpanel-pairing"     aria-label="MC Pairing"        hidden={tab !== "pairing"}><MCPairingTab /></div>
          <div role="tabpanel" id="tabpanel-pending"     aria-label="Pending Players"   hidden={tab !== "pending"}>
            {tab === "pending" && (
              <details className="mb-3 card p-3" open={false}>
                <summary className="cursor-pointer text-xs font-semibold text-meta hover:text-sub select-none">
                  How it works
                </summary>
                <p className="mt-2 text-xs text-meta leading-relaxed">
                  Players who connect via Tailscale for the first time are placed in this queue.
                  Their first session is allowed; subsequent join attempts are blocked until an admin
                  links their IGN to a portal account.
                </p>
              </details>
            )}
            <PendingPlayersTab />
          </div>
          <div role="tabpanel" id="tabpanel-whitelist"   aria-label="MC Whitelist"      hidden={tab !== "whitelist"}><MCWhitelistTab /></div>
          <div role="tabpanel" id="tabpanel-worlds"      aria-label="Worlds"            hidden={tab !== "worlds"}>
            {tab === "worlds" && (
              <details className="mb-3 card p-3" open={false}>
                <summary className="cursor-pointer text-xs font-semibold text-meta hover:text-sub select-none">
                  How it works
                </summary>
                <p className="mt-2 text-xs text-meta leading-relaxed">
                  Each world is stored in <code className="font-mono">/opt/minecraft/worlds/&#123;slug&#125;/</code>.
                  Switching saves the current world, then loads the target — the server restarts briefly (1–3 min).
                </p>
              </details>
            )}
            <WorldsTab />
          </div>
          <div role="tabpanel" id="tabpanel-map"          aria-label="Map"               hidden={tab !== "map"}><MapSettingsTab /></div>
          <div role="tabpanel" id="tabpanel-integrations" aria-label="Integrations"      hidden={tab !== "integrations"}><IntegrationsTab /></div>
          <div role="tabpanel" id="tabpanel-audit"        aria-label="Audit Log"         hidden={tab !== "audit"}><AuditLogTab /></div>
          <div role="tabpanel" id="tabpanel-permissions"  aria-label="Permissions"       hidden={tab !== "permissions"}><PermissionsPage /></div>
        </main>
      </div>
    </div>
  );
}

function MapSettingsTab() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery<BlueMapSettings>({
    queryKey: ["bluemap-settings"],
    queryFn: () => api.get("/map/settings"),
  });

  const updateMut = useMutation({
    mutationFn: (advanced_ui_enabled: boolean) =>
      api.put<BlueMapSettings>("/map/settings", { advanced_ui_enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bluemap-settings"] }),
  });

  const enabled = settings?.advanced_ui_enabled ?? false;

  return (
    <div className="space-y-4">
      {/* ── BlueMap ──────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] mb-1">
          BlueMap
        </h3>
        <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB] mb-3">
          Control whether the embedded BlueMap exposes its full interface. When disabled,
          players only see the locked top-down map view; menu, maps, free-flight, and perspective controls are hidden.
        </p>
        <div className="card flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
              Enable advanced BlueMap controls
            </p>
            <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB] mt-1">
              Re-enable this only when you want everyone on the site to access BlueMap’s menu,
              map selector, perspective mode, and free-flight controls.
            </p>
          </div>
          <button
            onClick={() => updateMut.mutate(!enabled)}
            disabled={isLoading || updateMut.isPending}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              enabled ? "bg-[#5B9BF0]" : "bg-[#9B9EA6]"
            } disabled:opacity-50`}
            aria-pressed={enabled}
            aria-label="Toggle advanced BlueMap controls"
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                enabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Integrations tab ─────────────────────────────────────────────────────────

function IntegrationsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Integrations</h2>
        <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB] mt-0.5">
          Connect external services. Credentials are encrypted at rest and
          never returned by any API endpoint.
        </p>
      </div>
      <DiscordSettingsPanel />
      <ModrinthSettingsPanel />
      <NavigationPrefsPanel />
    </div>
  );
}

// ── Navigation preferences ────────────────────────────────────────────────────
// Configure page is opt-in — hidden by default so it doesn't clutter the nav
// for admins who don't need server.properties access on every visit.

function NavigationPrefsPanel() {
  const { showConfigureNav, setShowConfigureNav } = useNavPrefsStore();
  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 flex-shrink-0 rounded-lg bg-[#F7F5F2] dark:bg-[#1E212B]
                        flex items-center justify-center">
          <Package className="w-5 h-5 text-meta" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            Navigation Preferences
          </p>
          <p className="text-xs text-meta mt-0.5">
            Controls which pages appear in your sidebar. Changes apply only to this device.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-4 rounded-lg bg-[#F7F5F2] dark:bg-[#1E212B] px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0]">Show Configure in sidebar</p>
          <p className="text-xs text-meta mt-0.5">
            Exposes the <code className="font-mono text-[10px]">server.properties</code> editor.
            Off by default — enable only when adjusting server settings.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={showConfigureNav}
          aria-label="Show Configure page in navigation"
          onClick={() => setShowConfigureNav(!showConfigureNav)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors
            focus-visible:ring-2 focus-visible:ring-[#5B9BF0]
            ${showConfigureNav ? "bg-[#5B9BF0]" : "bg-[#9B9EA6]"}`}
        >
          <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow transition-transform
            ${showConfigureNav ? "translate-x-5" : "translate-x-0.5"}`} />
        </button>
      </div>
    </div>
  );
}

// ── Modrinth API panel ───────────────────────────────────────────────────────

interface ModrinthStatus {
  token_set:    boolean;
  token_hint:   string | null;
  api_reachable: boolean;
  plugin_count: number | null;
}

function ModrinthSettingsPanel() {
  const qc = useQueryClient();
  const [token, setToken]       = useState("");
  const [showToken, setShowToken] = useState(false);

  const { data: status, isLoading } = useQuery<ModrinthStatus>({
    queryKey: ["modrinth-settings"],
    queryFn:  () => api.get("/admin/modrinth-settings"),
  });

  const saveMut = useMutation({
    mutationFn: () => api.put("/admin/modrinth-settings", { token: token.trim() }),
    onSuccess: () => {
      setToken("");
      qc.invalidateQueries({ queryKey: ["modrinth-settings"] });
      toast.success("Modrinth token saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: () => api.delete("/admin/modrinth-settings"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modrinth-settings"] });
      toast.success("Modrinth token removed — using unauthenticated API");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="card space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 flex-shrink-0 rounded-lg bg-[#1BD96A]/10 dark:bg-[#1BD96A]/15
                        flex items-center justify-center">
          <Package className="w-5 h-5 text-[#1BD96A]" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            Modrinth
          </p>
          <p className="text-xs text-meta mt-0.5">
            Plugin browser and installer. Works without a token — add one for higher rate limits (600 vs 300 req/min).
            Get a Personal Access Token at{" "}
            <a href="https://modrinth.com/settings/account" target="_blank" rel="noreferrer"
               className="text-[#5B9BF0] hover:underline">
              modrinth.com/settings/account
            </a>
          </p>
        </div>
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-meta flex-shrink-0" />
        ) : status?.api_reachable ? (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-[#36B37E] flex-shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
            {status.token_set ? "Connected (auth)" : "Connected"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-[#F87171] flex-shrink-0">
            <AlertTriangle className="w-3 h-3" aria-hidden />
            Unreachable
          </span>
        )}
      </div>

      {/* Stats */}
      {status?.api_reachable && status.plugin_count != null && (
        <p className="text-xs text-meta">
          <span className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            {status.plugin_count.toLocaleString()}
          </span>{" "}
          Paper-compatible plugins available for your server
        </p>
      )}

      {/* Current token */}
      {status?.token_set && status.token_hint && (
        <div className="flex items-center gap-2 text-xs text-meta bg-[#F7F5F2] dark:bg-[#1E212B] rounded-lg px-3 py-2">
          <span className="font-mono">{status.token_hint}</span>
          <span>· stored encrypted</span>
          <button
            onClick={() => removeMut.mutate()}
            disabled={removeMut.isPending}
            className="ml-auto text-[#F87171] hover:text-red-600 text-xs disabled:opacity-50"
          >
            {removeMut.isPending ? "Removing…" : "Remove"}
          </button>
        </div>
      )}

      {/* Token input */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-meta uppercase tracking-wider">
          {status?.token_set ? "Replace Token (optional)" : "Personal Access Token (optional)"}
        </label>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            placeholder="mrp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                       bg-white dark:bg-[#2A2D38] px-3 py-2 pr-10 text-sm
                       text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]
                       focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
            onKeyDown={(e) => { if (e.key === "Enter" && token.trim()) saveMut.mutate(); }}
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
            aria-label={showToken ? "Hide token" : "Show token"}
          >
            {showToken
              ? <EyeOff className="w-4 h-4" aria-hidden />
              : <Eye    className="w-4 h-4" aria-hidden />}
          </button>
        </div>
        {token.trim() && (
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5 disabled:opacity-40"
          >
            {saveMut.isPending && (
              <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden />
            )}
            {status?.token_set ? "Update Token" : "Save Token"}
          </button>
        )}
      </div>
    </div>
  );
}

function DiscordSettingsPanel() {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery<DiscordSettings>({
    queryKey: ["discord-settings"],
    queryFn:  () => api.get("/admin/discord-settings"),
  });

  const [token,   setToken]   = useState("");
  const [webhook, setWebhook] = useState("");
  const [channel, setChannel] = useState("");

  useEffect(() => {
    if (status?.channel_id && !channel) setChannel(status.channel_id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.channel_id]);

  const saveMut = useMutation({
    mutationFn: () => api.put("/admin/discord-settings", {
      ...(token.trim()   && { bot_token:   token.trim() }),
      ...(webhook.trim() && { webhook_url: webhook.trim() }),
      ...(channel.trim() && { channel_id:  channel.trim() }),
    }),
    onSuccess: () => {
      setToken(""); setWebhook("");
      qc.invalidateQueries({ queryKey: ["discord-settings"] });
      toast.success("Discord settings saved — bridge updating…");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const hasChanges = token.trim() || webhook.trim() || channel.trim() !== (status?.channel_id ?? "");

  return (
    <div className="card space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-[#5865F2]/10 flex-shrink-0">
          <span className="text-[#5865F2] text-sm font-bold">D</span>
        </div>
        <div>
          <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">Discord Bridge</p>
          <p className="text-xs text-meta mt-0.5">
            Connects the Discord channel to in-game and web chat.
            Credentials stored AES-256-GCM encrypted — never returned by the API.
          </p>
        </div>
      </div>

      {/* Status chips */}
      {!isLoading && status && (
        <div className="flex flex-wrap gap-2">
          <StatusChipSmall ok={status.bot_token_set}   label="Bot token" />
          <StatusChipSmall ok={status.webhook_url_set} label="Webhook URL" />
          <StatusChipSmall ok={!!status.channel_id}    label="Channel ID" />
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide mb-1">Bot Token</label>
          <input type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder={status?.bot_token_set ? "configured — type to replace" : "Bot.Token.Here"}
            className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm font-mono text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6] focus:outline-none focus:ring-2 focus:ring-[#5865F2]" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide mb-1">Webhook URL</label>
          <input type="password" autoComplete="new-password" value={webhook} onChange={(e) => setWebhook(e.target.value)}
            placeholder={status?.webhook_url_set ? "configured — type to replace" : "https://discord.com/api/webhooks/…"}
            className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm font-mono text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6] focus:outline-none focus:ring-2 focus:ring-[#5865F2]" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide mb-1">Channel ID</label>
          <input type="text" inputMode="numeric" value={channel}
            onChange={(e) => setChannel(e.target.value.replace(/\D/g, ""))}
            placeholder="1234567890123456789"
            className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm font-mono text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6] focus:outline-none focus:ring-2 focus:ring-[#5865F2]" />
          <p className="text-[10px] text-meta mt-1">Right-click the Discord channel → Copy Channel ID (requires Developer Mode).</p>
        </div>
      </div>

      <button onClick={() => saveMut.mutate()} disabled={!hasChanges || saveMut.isPending}
        className="btn-primary w-full flex items-center justify-center gap-2 text-sm disabled:opacity-40">
        {saveMut.isPending
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Saving…</>
          : <><CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Save Discord Settings</>}
      </button>

      <p className="text-[10px] text-meta text-center">
        All three values must be set for the bridge to activate. Changes apply immediately.
      </p>
    </div>
  );
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
  const { user: me, hasPerm } = useAuthStore();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  // Staged role — reset to the user's actual role whenever the selected user changes.
  const [stagedRole, setStagedRole] = useState("");
  useEffect(() => { setStagedRole(selectedUser?.role ?? ""); }, [selectedUser?.email]);

  const canInvite    = hasPerm("users.invite");
  const canRemove    = hasPerm("users.remove");
  const canOverrides = hasPerm("users.permission_overrides.edit");

  const myLevel = ROLE_LEVELS[me?.role ?? "user"] ?? 1;

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  // Load API roles for the change-role dropdown
  const { data: apiRoles = [] } = useQuery<RoleRecord[]>({
    queryKey: ["roles"],
    queryFn: () => api.get<RoleRecord[]>("/roles"),
  });

  // Only show roles the actor can assign (level strictly below theirs)
  const assignableRoles = apiRoles.filter((r) => r.level < myLevel);

  const removeMut = useMutation({
    mutationFn: (email: string) =>
      api.delete(`/users/${encodeURIComponent(email)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      if (selectedUser?.email === removeMut.variables) setSelectedUser(null);
    },
  });

  const updateRoleMut = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      api.patch(`/users/${encodeURIComponent(email)}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const canEdit = (u: User) =>
    u.email !== me?.email &&
    (ROLE_LEVELS[u.role] ?? 0) < myLevel &&
    u.email !== "admin@example.com";

  const roleMap = new Map(apiRoles.map((r) => [r.name, r]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-sub">
          Invite team members — one action creates their portal account, whitelists
          their Minecraft IGN, generates a Tailscale invite, and sends a welcome email.
        </p>
        {canInvite && (
          <button
            onClick={() => setShowInvite(true)}
            className="btn-primary flex items-center gap-2 text-sm flex-shrink-0 ml-4"
            data-testid="invite-user-btn"
          >
            <UserPlus className="w-4 h-4" aria-hidden /> Invite Member
          </button>
        )}
      </div>

      {/* Unified invite portal */}
      {showInvite && <InvitePortal onClose={() => setShowInvite(false)} />}

      {/* User list + detail panel */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* List */}
        <div>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {[...users]
                .sort((a, b) => (ROLE_LEVELS[b.role] ?? 0) - (ROLE_LEVELS[a.role] ?? 0))
                .map((u) => {
                  const isPending = !u.google_sub;
                  const initials  = u.display_name.slice(0, 2).toUpperCase();
                  const roleData  = roleMap.get(u.role);
                  const avatarBg  = roleData?.color ?? ["#9B9EA6", "#36B37E", "#5B9BF0", "#FBBF24"][
                    Math.max(0, (ROLE_LEVELS[u.role] ?? 0) - 1)
                  ];
                  const isSelected = selectedUser?.email === u.email;

                  return (
                    <div
                      key={u.email}
                      className={`card flex items-center gap-3 transition-all ${
                        isSelected ? "ring-2 ring-[#5B9BF0]" : ""
                      }`}
                      data-testid="user-card"
                    >
                      {/* Clickable area — selects user for detail panel */}
                      <button
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        onClick={() => setSelectedUser(isSelected ? null : u)}
                      >
                        {/* Avatar */}
                        <div
                          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs"
                          style={{ backgroundColor: avatarBg }}
                        >
                          {u.avatar_url
                            ? <img src={u.avatar_url} className="w-9 h-9 rounded-full" alt="" />
                            : initials}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                              {u.display_name}
                            </span>
                            {u.email === me?.email && (
                              <span className="text-xs text-meta">(you)</span>
                            )}
                            <RoleBadge
                              role={u.role}
                              label={roleData?.label}
                              color={roleData?.color}
                            />
                            {isPending && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] dark:bg-[#3D2A00] dark:text-[#FCD34D]">
                                Pending sign-in
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">{u.email}</p>
                        </div>
                      </button>

                      {/* Quick "View as" button — visible for eligible targets */}
                      {canEdit(u) && (
                        <QuickViewAsButton
                          email={u.email}
                          displayName={u.display_name}
                        />
                      )}

                      <ChevronRight
                        className="w-4 h-4 text-meta flex-shrink-0 cursor-pointer"
                        aria-hidden
                        onClick={() => setSelectedUser(isSelected ? null : u)}
                      />
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedUser && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                {selectedUser.display_name}
              </span>
              <button onClick={() => setSelectedUser(null)} aria-label="Close panel">
                <X className="w-4 h-4 text-meta" />
              </button>
            </div>
            <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">{selectedUser.email}</p>

            {/* Role assignment */}
            {canEdit(selectedUser) && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
                  Role
                </label>
                <div className="flex gap-2">
                  <select
                    value={stagedRole}
                    onChange={(e) => setStagedRole(e.target.value)}
                    className="flex-1 text-sm rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2"
                    aria-label={`Change role for ${selectedUser.display_name}`}
                  >
                    {assignableRoles.map((r) => (
                      <option key={r.name} value={r.name}>{r.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => updateRoleMut.mutate(
                      { email: selectedUser.email, role: stagedRole },
                      { onSuccess: () => setStagedRole(stagedRole) },
                    )}
                    disabled={stagedRole === selectedUser.role || updateRoleMut.isPending}
                    className="btn-primary text-sm px-3 disabled:opacity-40"
                  >
                    {updateRoleMut.isPending ? "Saving…" : "Save"}
                  </button>
                </div>
                {stagedRole !== selectedUser.role && (
                  <p className="text-xs text-meta">
                    Changing from <span className="font-medium">{selectedUser.role}</span> to <span className="font-medium text-[#5B9BF0]">{stagedRole}</span>
                  </p>
                )}
              </div>
            )}

            {/* Permission overrides */}
            <UserOverridePanel
              email={selectedUser.email}
              roleName={selectedUser.role}
              canEdit={canOverrides}
            />

            {/* Tailscale invite */}
            {canInvite && (
              <TailscaleInvitePanel email={selectedUser.email} displayName={selectedUser.display_name} />
            )}

            {/* View as — impersonation */}
            {canEdit(selectedUser) && (
              <ViewAsButton
                email={selectedUser.email}
                displayName={selectedUser.display_name}
              />
            )}

            {/* Remove user */}
            {canRemove && canEdit(selectedUser) && (
              <div className="pt-2 border-t border-[#D9D5D0] dark:border-[#363944]">
                <button
                  onClick={() => removeMut.mutate(selectedUser.email)}
                  disabled={removeMut.isPending}
                  className="btn-danger w-full text-sm"
                  data-testid="remove-user-btn"
                >
                  Remove from whitelist
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Quick View As button (inline on user list row) ────────────────────────────
// One-click entry point — no detail panel needed.

function QuickViewAsButton({ email, displayName }: { email: string; displayName: string }) {
  const { impersonatingAs, startImpersonation, stopImpersonation } = useImpersonationStore();
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const isActive = impersonatingAs === email;

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation(); // don't also select the user row
    if (isActive) {
      stopImpersonation();
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.clear();
      window.location.reload();
      return;
    }
    setLoading(true);
    try {
      const data: ImpersonationTarget = await api.get(
        `/admin/impersonation/validate?email=${encodeURIComponent(email)}`
      );
      if (!data.allowed) {
        toast.error(data.reason ?? "Cannot impersonate this user");
        return;
      }
      // Start directly — no confirm modal for quick-action path.
      // The banner makes it immediately obvious the session is active.
      startImpersonation(email, displayName);
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.clear();
      window.location.href = "/";
    } catch (err: unknown) {
      toast.error((err as Error).message ?? "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      title={isActive ? `Exit view as ${displayName}` : `View portal as ${displayName}`}
      aria-label={isActive ? `Exit impersonating ${displayName}` : `View as ${displayName}`}
      className={`flex-shrink-0 h-8 w-8 flex items-center justify-center rounded-lg
                  transition-colors disabled:opacity-40
                  ${isActive
                    ? "bg-[#FEF3C7] dark:bg-[#2A1F00] text-[#92400E] dark:text-[#FCD34D]"
                    : "text-meta hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F] hover:text-[#5B9BF0]"
                  }`}
    >
      {loading
        ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        : isActive
          ? <LogOut className="w-3.5 h-3.5" aria-hidden />
          : <UserCheck className="w-3.5 h-3.5" aria-hidden />}
    </button>
  );
}

// ── View As (impersonation) ───────────────────────────────────────────────────

interface ImpersonationTarget {
  email: string; display_name: string; role: string;
  role_level: number; allowed: boolean; reason: string | null;
}

function ViewAsButton({ email, displayName }: { email: string; displayName: string }) {
  const { impersonatingAs, startImpersonation, stopImpersonation } = useImpersonationStore();
  const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [preview, setPreview]   = useState<ImpersonationTarget | null>(null);
  const [open, setOpen]         = useState(false);

  const isActive = impersonatingAs === email;

  async function start() {
    setChecking(true);
    try {
      const data: ImpersonationTarget = await api.get(
        `/admin/impersonation/validate?email=${encodeURIComponent(email)}`
      );
      setPreview(data);
      setOpen(true);
    } catch (e: unknown) {
      toast.error((e as Error).message ?? "Could not validate user");
    } finally {
      setChecking(false);
    }
  }

  function confirm() {
    if (!preview?.allowed) return;
    startImpersonation(email, displayName);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.clear();
    // Reload to re-render the full app under the impersonated permissions.
    window.location.href = "/";
  }

  function stop() {
    stopImpersonation();
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.clear();
    window.location.reload();
  }

  return (
    <div className="pt-2 border-t border-[#D9D5D0] dark:border-[#363944] space-y-2">
      <p className="text-xs font-semibold text-meta uppercase tracking-wider">Impersonation</p>
      <p className="text-xs text-meta">
        View the portal exactly as this user sees it. Every action you take
        is logged under your account with a proxy marker.
      </p>

      {isActive ? (
        <button onClick={stop} className="btn-secondary text-sm flex items-center gap-1.5 w-full justify-center">
          <LogOut className="w-4 h-4" aria-hidden />
          Exit view as {displayName}
        </button>
      ) : (
        <button
          onClick={start}
          disabled={checking}
          className="btn-secondary text-sm flex items-center gap-1.5 w-full justify-center disabled:opacity-50"
        >
          {checking
            ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            : <UserCheck className="w-4 h-4" aria-hidden />}
          View as {displayName}
        </button>
      )}

      {/* Confirmation modal */}
      {open && preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="alertdialog">
          <div className="card max-w-sm w-full space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF3C7] dark:bg-[#2A1F00] flex items-center justify-center flex-shrink-0">
                <Eye className="w-5 h-5 text-[#92400E] dark:text-[#FCD34D]" aria-hidden />
              </div>
              <div>
                <h2 className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                  View as {preview.display_name}?
                </h2>
                <p className="text-xs text-meta mt-0.5">{preview.email} · {preview.role}</p>
              </div>
            </div>

            {preview.allowed ? (
              <>
                <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
                  You will see the portal as <strong>{preview.display_name}</strong> sees it.
                  Every action you take will be logged as{" "}
                  <code className="text-xs font-mono">you [acting as {preview.email}]</code>.
                  The impersonation ends when you click Exit or close the tab.
                </p>
                <div className="rounded-lg bg-[#FFFBEB] dark:bg-[#2A1F00] border border-[#FCD34D]/50 px-3 py-2 text-xs text-[#92400E] dark:text-[#FCD34D]">
                  ⚠️ You will be redirected to the dashboard as this user.
                  Destructive actions (deletes, world switches) will still execute against the real server.
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setOpen(false)} className="btn-secondary flex-1 text-sm">Cancel</button>
                  <button onClick={confirm} className="btn-primary flex-1 text-sm flex items-center justify-center gap-1.5">
                    <UserCheck className="w-4 h-4" aria-hidden />
                    Start session
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-[#F87171]">{preview.reason ?? "Not allowed."}</p>
                <button onClick={() => setOpen(false)} className="btn-secondary w-full text-sm">Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Minecraft Pairing tab ──────────────────────────────────────────────────────

function MCPairingTab() {
  const qc = useQueryClient();

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  const { data: mcPlayers = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn: () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  const activatedUsers = [...users]
    .filter((u) => u.google_sub)
    .sort((a, b) => (ROLE_LEVELS[b.role] ?? 0) - (ROLE_LEVELS[a.role] ?? 0));

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
        Link portal users to their Minecraft in-game names (IGNs).
        Players currently online are shown with a green dot.
        Pending (uninvited) users are excluded — they must sign in with Google first.
      </p>
      {activatedUsers.length === 0 ? (
        <p className="text-sm text-meta py-6 text-center">No activated users yet.</p>
      ) : (
        <div className="space-y-3">
          {activatedUsers.map((u) => (
            <UserPairingCard key={u.email} user={u} mcPlayers={mcPlayers} qc={qc} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pending Players tab ───────────────────────────────────────────────────────

function PendingPlayersTab() {
  const { hasPerm } = useAuthStore();
  const qc = useQueryClient();
  const canManage = hasPerm("players.pending.manage");
  const [approvingIgn, setApprovingIgn] = useState<string | null>(null);
  const [approveEmail, setApproveEmail] = useState("");
  const [error, setError] = useState("");

  const { data: pending = [], isLoading } = useQuery<PendingPlayer[]>({
    queryKey: ["pending-players"],
    queryFn: () => api.get("/players/pending"),
    refetchInterval: 15_000,
  });

  const { data: rejected = [], isLoading: rejectedLoading } = useQuery<PendingPlayer[]>({
    queryKey: ["rejected-players"],
    queryFn: () => api.get("/players/rejected"),
    refetchInterval: 30_000,
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
    enabled: canManage,
  });

  const approveMut = useMutation({
    mutationFn: ({ ign, email }: { ign: string; email: string }) =>
      api.post(`/players/pending/${encodeURIComponent(ign)}/approve`, { email }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-players"] });
      setApprovingIgn(null);
      setApproveEmail("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: (ign: string) =>
      api.delete(`/players/pending/${encodeURIComponent(ign)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-players"] });
      qc.invalidateQueries({ queryKey: ["rejected-players"] });
    },
  });

  const reinstateMut = useMutation({
    mutationFn: (ign: string) =>
      api.post(`/players/rejected/${encodeURIComponent(ign)}/reinstate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-players"] });
      qc.invalidateQueries({ queryKey: ["rejected-players"] });
    },
  });

  const activatedUsers = users.filter((u) => u.google_sub);

  function fmt(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
        Players who connected over Tailscale for the first time. Their first session
        was allowed; subsequent attempts are blocked until linked to a team member.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : pending.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="text-sm text-meta">No pending players — the queue is clear.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((p) => (
            <div key={p.ign} className="card flex items-center gap-4">
              {/* Avatar */}
              <img
                src={`https://mc-heads.net/avatar/${p.ign}/36`}
                alt=""
                className="w-9 h-9 rounded-sm flex-shrink-0"
                loading="lazy"
              />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">{p.ign}</p>
                <p className="text-xs text-meta">
                  First seen {fmt(p.first_seen)}
                  {p.attempt_count > 1 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-[#FEF3C7] dark:bg-[#3D2A00] text-[#92400E] dark:text-[#FCD34D]">
                      {p.attempt_count - 1} blocked attempt{p.attempt_count > 2 ? "s" : ""}
                    </span>
                  )}
                </p>
              </div>

              {/* Actions */}
              {canManage && (
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setApprovingIgn(p.ign); setApproveEmail(""); setError(""); }}
                    className="btn-primary text-xs px-3 py-1.5"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectMut.mutate(p.ign)}
                    disabled={rejectMut.isPending}
                    className="btn-danger text-xs px-3 py-1.5"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Blocklist ── */}
      {(rejected.length > 0 || rejectedLoading) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-meta pt-2">
            Blocklist
          </p>
          <p className="text-xs text-meta">
            These players were rejected. Reinstate to move them back to the pending queue, or approve to link them directly.
          </p>
          {rejectedLoading ? (
            <div className="flex justify-center py-4">
              <div className="w-5 h-5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-2">
              {rejected.map((p) => (
                <div key={p.ign} className="card flex items-center gap-4 opacity-75">
                  <img
                    src={`https://mc-heads.net/avatar/${p.ign}/36`}
                    alt=""
                    className="w-9 h-9 rounded-sm flex-shrink-0 grayscale"
                    loading="lazy"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">{p.ign}</p>
                    <p className="text-xs text-meta">
                      Last attempt {fmt(p.last_attempted)}
                      <span className="ml-2 px-1.5 py-0.5 rounded bg-[#FEE2E2] dark:bg-[#3D0000] text-[#B91C1C] dark:text-[#FCA5A5]">
                        rejected
                      </span>
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => reinstateMut.mutate(p.ign)}
                        disabled={reinstateMut.isPending}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        Reinstate
                      </button>
                      <button
                        onClick={() => { setApprovingIgn(p.ign); setApproveEmail(""); setError(""); }}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        Approve
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Approve modal */}
      {approvingIgn && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          role="dialog"
          aria-modal
          aria-label={`Approve ${approvingIgn}`}
        >
          <div className="card max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                Approve <span className="font-mono">{approvingIgn}</span>
              </h2>
              <button onClick={() => setApprovingIgn(null)} aria-label="Close">
                <X className="w-4 h-4 text-meta" />
              </button>
            </div>
            <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
              Link this Minecraft account to a team member. They will be able to
              rejoin the server freely from now on.
            </p>
            <select
              value={approveEmail}
              onChange={(e) => { setApproveEmail(e.target.value); setError(""); }}
              className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm"
            >
              <option value="">— select a team member —</option>
              {activatedUsers.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.display_name} ({u.email})
                </option>
              ))}
            </select>
            {error && <p className="text-xs text-[#F87171]">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setApprovingIgn(null)} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                onClick={() => approveMut.mutate({ ign: approvingIgn, email: approveEmail })}
                disabled={!approveEmail || approveMut.isPending}
                className="btn-primary text-sm"
              >
                {approveMut.isPending ? "Approving…" : "Approve & Link"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MC Whitelist tab ──────────────────────────────────────────────────────────

interface WhitelistEntry { uuid: string; name: string; }

function MCWhitelistTab() {
  const qc = useQueryClient();
  const [ign, setIgn] = useState("");
  const [error, setError] = useState("");

  const { data: entries = [], isLoading } = useQuery<WhitelistEntry[]>({
    queryKey: ["mc-whitelist"],
    queryFn: () => api.get("/server/whitelist"),
    refetchInterval: 15_000,
  });

  const addMut = useMutation({
    mutationFn: (player: string) =>
      api.post("/server/whitelist/add", { player }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mc-whitelist"] });
      setIgn("");
      setError("");
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (player: string) =>
      api.post("/server/whitelist/remove", { player }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mc-whitelist"] }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
        Manage which Minecraft accounts can join the server.
        Requires a valid Mojang/Microsoft username. Changes take effect immediately.
      </p>

      {/* Add form */}
      <div className="card space-y-3">
        <label className="block text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
          Add player
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Minecraft username (e.g. Steve)"
            value={ign}
            onChange={(e) => { setIgn(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && ign.trim() && addMut.mutate(ign.trim())}
            className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
          />
          <button
            onClick={() => addMut.mutate(ign.trim())}
            disabled={!ign.trim() || addMut.isPending}
            className="btn-primary text-sm px-4"
          >
            {addMut.isPending ? "Adding…" : "Add"}
          </button>
        </div>
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
      </div>

      {/* Current whitelist */}
      <div className="card space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
            Whitelisted players
          </span>
          <span className="text-xs text-meta">{entries.length} total</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-meta py-4 text-center">
            Whitelist is empty — no players can join until you add them.
          </p>
        ) : (
          <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
            {entries.map((e) => (
              <div key={e.uuid} className="flex items-center justify-between py-2">
                <div>
                  <span className="font-mono text-sm text-[#1C1E27] dark:text-[#EAECF0]">{e.name}</span>
                  <p className="text-xs text-meta font-mono">{e.uuid}</p>
                </div>
                <button
                  onClick={() => removeMut.mutate(e.name)}
                  disabled={removeMut.isPending && removeMut.variables === e.name}
                  className="p-1 text-meta hover:text-[#F87171] transition-colors"
                  aria-label={`Remove ${e.name} from whitelist`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TailscaleInvitePanel — send a device-share invite to an existing user ──

function TailscaleInvitePanel({
  email,
  displayName,
}: {
  email: string;
  displayName: string;
}) {
  const [result, setResult] = useState<TailscaleInviteResult | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      api.post<TailscaleInviteResult>(`/users/${encodeURIComponent(email)}/tailscale-invite`),
    onSuccess: (data) => {
      setResult(data);
      if (data.email_sent) toast.success(`Tailscale invite sent to ${email}`);
      else if (data.warnings.length) toast.info("Invite generated with warnings — check below");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="pt-3 border-t border-[#D9D5D0] dark:border-[#363944] space-y-3">
      <div>
        <span className="text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
          Tailscale Access
        </span>
        <p className="text-xs text-meta mt-0.5">
          Sends mc-server-1 as a shared device — user stays on their own Tailscale account
          and sees no other devices.
        </p>
      </div>

      {/* Result */}
      {result && (
        <div className="rounded-xl bg-[#F7F5F2] dark:bg-[#2A2D38] p-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <StatusChipSmall ok={!!result.tailscale_invite_url} label="Invite generated" />
            <StatusChipSmall ok={result.email_sent} label="Email sent" />
          </div>
          {result.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1.5 text-xs text-warn">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden />
              {w}
            </p>
          ))}
        </div>
      )}

      <button
        onClick={() => { setResult(null); mut.mutate(); }}
        disabled={mut.isPending}
        className="w-full flex items-center justify-center gap-2 btn-secondary text-sm py-2"
        aria-label={`Send Tailscale invite to ${displayName}`}
      >
        {mut.isPending
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Sending…</>
          : result?.email_sent
          ? <><CheckCircle2 className="w-3.5 h-3.5 text-[#36B37E]" aria-hidden /> Resend Tailscale Invite</>
          : <><Send className="w-3.5 h-3.5" aria-hidden /> Send Tailscale Invite</>}
      </button>
    </div>
  );
}

function StatusChipSmall({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
      ok
        ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#36B37E]"
        : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-meta line-through"
    }`}>
      {ok && <CheckCircle2 className="w-2.5 h-2.5" aria-hidden />}
      {label}
    </span>
  );
}

function UserPairingCard({
  user,
  mcPlayers,
  qc,
}: {
  user: User;
  mcPlayers: McPlayer[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [newIgn, setNewIgn] = useState("");

  const { data: links = [] } = useQuery<PlayerLink[]>({
    queryKey: ["players", user.email],
    queryFn: () => api.get(`/users/${encodeURIComponent(user.email)}/players`),
  });

  const addMut = useMutation({
    mutationFn: () =>
      api.put(`/users/${encodeURIComponent(user.email)}/players`, {
        igns: [...links.map((l) => l.ign), newIgn.trim()],
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["players", user.email] });
      setNewIgn("");
    },
  });

  const removeMut = useMutation({
    mutationFn: (ign: string) =>
      api.delete(
        `/users/${encodeURIComponent(user.email)}/players/${encodeURIComponent(ign)}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players", user.email] }),
  });

  const initials  = user.display_name.slice(0, 2).toUpperCase();
  const avatarBg  = ["#9B9EA6", "#36B37E", "#5B9BF0", "#FBBF24"][
    Math.max(0, (ROLE_LEVELS[user.role] ?? 0) - 1)
  ];
  const linked     = new Set(links.map((l) => l.ign));
  const suggestions = mcPlayers.filter((p) => !linked.has(p.ign));

  return (
    <div className="card space-y-3" data-testid="pairing-card">
      {/* User header */}
      <div className="flex items-center gap-3">
        <div
          className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs"
          style={{ backgroundColor: avatarBg }}
        >
          {user.avatar_url
            ? <img src={user.avatar_url} className="w-9 h-9 rounded-full" alt="" />
            : initials}
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            {user.display_name}
          </span>
          <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">{user.email}</p>
        </div>
        <RoleBadge role={user.role} />
      </div>

      {/* Current links */}
      <div className="flex flex-wrap gap-2">
        {links.map((link) => {
          const online = mcPlayers.find((p) => p.ign === link.ign)?.online ?? false;
          return (
            <div
              key={link.ign}
              className="flex items-center gap-1.5 bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg px-2 py-1 text-xs"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`} />
              <span className="font-mono text-[#1C1E27] dark:text-[#EAECF0]">{link.ign}</span>
              <button
                onClick={() => removeMut.mutate(link.ign)}
                aria-label={`Unlink ${link.ign}`}
                className="text-[#F87171] hover:text-red-600 ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
        {links.length === 0 && (
          <span className="text-xs text-meta">⛏ No linked players</span>
        )}
      </div>

      {/* Add new IGN */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="IGN (e.g. Steve)"
            value={newIgn}
            onChange={(e) => setNewIgn(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && newIgn.trim() && addMut.mutate()}
            list={`suggestions-${user.email}`}
            className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
          />
          {suggestions.length > 0 && (
            <datalist id={`suggestions-${user.email}`}>
              {suggestions.map((p) => (
                <option key={p.ign} value={p.ign} />
              ))}
            </datalist>
          )}
        </div>
        <button
          onClick={() => addMut.mutate()}
          disabled={!newIgn.trim() || addMut.isPending}
          className="btn-primary text-sm px-3"
          aria-label="Link IGN"
          data-testid="link-ign-btn"
        >
          <Link className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ── Audit Log tab ─────────────────────────────────────────────────────────────

interface AuditEntry {
  id:         number;
  actor:      string;
  action:     string;
  target:     string | null;
  detail:     string | null;
  created_at: string;
}

// Human-readable action labels following NNG plain-language heuristics.
const ACTION_LABELS: Record<string, string> = {
  create_backup:         "Created backup",
  delete_world:          "Deleted world",
  restore_backup:        "Restored backup",
  delete_backup:         "Deleted backup",
  create_world:          "Created world",
  activate_world:        "Activated world",
  create_world_backup:   "Created world backup",
  update_world_members:  "Updated world members",
  create_dimension:      "Created dimension",
  whitelist_add:         "Added to whitelist",
  whitelist_remove:      "Removed from whitelist",
  onboarding_invite:     "Sent invite",
  op_add:                "Granted operator",
  op_remove:             "Revoked operator",
  ban_add:               "Banned player",
  ban_remove:            "Unbanned player",
  create_backup_now:     "Created manual backup",
  restore_backup_now:    "Restored backup",
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function AuditLogTab() {
  const qc = useQueryClient();

  const { data: entries = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log"],
    queryFn:  () => api.get("/admin/audit-log?limit=200"),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Audit Log</h2>
          <p className="text-sm text-meta mt-0.5">
            All security-relevant actions taken by team members.
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["audit-log"] })}
          className="icon-btn"
          aria-label="Refresh audit log"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-meta text-center py-10">No audit entries yet.</p>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#F7F5F2] dark:bg-[#1E212B] border-b border-[#D9D5D0] dark:border-[#363944]">
              <tr>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-meta font-semibold">When</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-meta font-semibold">Who</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-meta font-semibold">Action</th>
                <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-meta font-semibold hidden sm:table-cell">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-[#F7F5F2] dark:hover:bg-[#1E212B] transition-colors">
                  <td className="px-4 py-2.5 text-xs text-meta whitespace-nowrap">{fmtTime(e.created_at)}</td>
                  <td className="px-4 py-2.5 truncate max-w-[120px]">
                    <span className="text-xs font-mono text-[#1C1E27] dark:text-[#EAECF0]" title={e.actor}>
                      {e.actor.split("@")[0]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[#1C1E27] dark:text-[#EAECF0]">{formatAction(e.action)}</td>
                  <td className="px-4 py-2.5 text-xs text-meta hidden sm:table-cell truncate max-w-[140px]" title={e.target ?? ""}>{e.target ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

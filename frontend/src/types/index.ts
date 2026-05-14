// These types mirror the Rust structs decorated with #[derive(TS)].
// In a full setup ts-rs generates these automatically via `cargo test`.

// ── Dynamic role (from /api/roles) ────────────────────────────────────────────
// Replaces the old hard-coded string union.  Use RoleRecord everywhere you need
// the full role object; use `string` for role name fields in payloads.
export interface RoleRecord {
  name:        string;
  label:       string;
  description: string;
  color:       string;
  level:       number;
  is_system:   boolean;
  created_by:  string;
  created_at:  string;
}

// Kept for backwards compatibility with existing UI code that uses the union type.
// Gradually migrate call-sites to use RoleRecord instead.
export type Role = "global_admin" | "admin" | "member" | "user" | "visitor" | (string & {});
export type Gamemode = "survival" | "creative" | "adventure" | "spectator";

export interface Permissions {
  can_manage_users:   boolean;
  can_control_server: boolean;
  can_write_config:   boolean;
  can_restore_backup: boolean;
  can_manage_admins:  boolean;
}

export interface MeResponse {
  email:        string;
  role:         Role;
  display_name: string;
  avatar_url:   string | null;
  permissions:  Permissions;
  /** Flat permission-key list (e.g. "server.vm.start", "nav.team"). */
  permission_keys: string[];
}

// ── Permission override (from /api/users/:email/permission-overrides) ─────────

export interface PermissionOverride {
  permission_key: string;
  granted_by:     string;
  granted_at:     string;
}

export interface KillSwitchStatus {
  disabled_at: string | null;
  reason:      string | null;
  source:      string | null;
}

export interface PermissionCatalogEntry {
  key:         string;
  category:    string;
  description: string;
}

export interface RolePermissions {
  role:        Role;
  permissions: string[];
}

export interface User {
  email:        string;
  role:         Role;
  display_name: string;
  google_sub:   string | null;
  avatar_url:   string | null;
  added_by:     string;
  added_at:     string;
  last_login:   string | null;
}

export interface PlayerLink {
  id:        number;
  email:     string;
  ign:       string;
  gamemode:  Gamemode;
  linked_at: string;
}

export interface McPlayer {
  ign:    string;
  uuid:   string;
  online: boolean;
}

export interface WhitelistEntry {
  uuid: string;
  name: string;
}

export interface PendingPlayer {
  id:             number;
  ign:            string;
  uuid:           string | null;
  first_seen:     string;
  last_attempted: string;
  attempt_count:  number;
  status:         "pending" | "approved" | "rejected";
}

export interface VmStatus {
  status:      string;
  external_ip: string | null;
  tailscale_ip: string;
}

export interface ServerStatus {
  vm:      VmStatus;
  service: string;
}

// ── Role permissions (from /api/roles/:role/permissions) ──────────────────

export interface RoleWithPermissions {
  role:        string;
  permissions: string[];
}

export interface MetricsSnapshot {
  service_active: boolean;
  players_online: number;
  uptime_raw:     string;
  /** null when the server is stopped and JVM stats are unavailable */
  jvm_mem_pct:    number | null;
  /** null when VM CPU metrics cannot be read */
  vm_cpu_pct:     number | null;
}

export interface InventorySlot {
  id:    string;   // e.g. "minecraft:diamond"
  count: number;
  slot:  number;   // 0-8 hotbar, 9-35 main, 100-103 armor, -106 offhand
}

export interface PlayerSnapshot {
  id:             number;
  uuid:           string;
  ign:            string;
  x:              number;
  y:              number;
  z:              number;
  yaw:            number;
  dimension:      string;
  inventory_json: string;  // JSON-encoded InventorySlot[]
  health:         number;
  captured_at:    string;
}

export interface MapPin {
  id:         number;
  x:          number;
  z:          number;
  dimension:  string;
  label:      string;
  body:       string | null;
  icon:       string;
  /** "private" = author only; "team" = all users */
  visibility: "private" | "team";
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id:         number;
  /** "mc" | "web" | "server" */
  source:     "mc" | "web" | "server";
  /** Raw identifier: email for web, IGN for mc/server. */
  author:     string;
  /** Human-readable label shown in the UI. */
  display_as: string;
  content:    string;
  sent_at:    string;
}

export interface BlueMapSettings {
  advanced_ui_enabled: boolean;
}

export interface BackupRun {
  id:         number;
  filename:   string;
  /** Full path of the archive on mc-server-1 */
  file_path:  string;
  size_bytes: number;
  created_by: string;
  created_at: string;
  notes:      string | null;
  /** Set for world-scoped backups; null for legacy global backups. */
  world_id:   number | null;
  world_slug: string | null;
}

export interface World {
  id:          number;
  name:        string;
  /** Directory-safe identifier on mc-server-1. */
  slug:        string;
  description: string | null;
  seed:        string | null;
  is_active:   boolean;
  created_at:  string;
  created_by:  string;
}

export interface InviteResult {
  user:                 User;
  email_sent:           boolean;
  whitelist_added:      boolean;
  tailscale_invite_url: string | null;
  warnings:             string[];
}

export interface TailscaleInviteResult {
  user:                 User;
  tailscale_invite_url: string | null;
  email_sent:           boolean;
  warnings:             string[];
}

export interface WorldMember {
  world_id:   number;
  user_email: string;
  added_at:   string;
}

export type RoleLevel = 1 | 2 | 3 | 4;

export const ROLE_LEVELS: Record<Role, RoleLevel | 0> = {
  visitor:      0,
  user:         1,
  member:       2,
  admin:        3,
  global_admin: 4,
} as const;

export const ROLE_LABELS: Record<Role, string> = {
  visitor:      "Visitor",
  user:         "User",
  member:       "Member",
  admin:        "Admin",
  global_admin: "Global Admin",
};

export const ROLE_COLORS: Record<Role, string> = {
  visitor:      "#B8BCC8",
  user:         "#9B9EA6",
  member:       "#36B37E",
  admin:        "#5B9BF0",
  global_admin: "#FBBF24",
};

export const ALL_ROLES: Role[] = ["visitor", "user", "member", "admin", "global_admin"];

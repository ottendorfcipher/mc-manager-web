// These types mirror the Rust structs decorated with #[derive(TS)].
// In a full setup ts-rs generates these automatically via `cargo test`.

export type Role = "global_admin" | "admin" | "member" | "user" | "visitor";
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

export interface VmStatus {
  status:      string;
  external_ip: string | null;
  tailscale_ip: string;
}

export interface ServerStatus {
  vm:      VmStatus;
  service: string;
}

export interface MetricsSnapshot {
  service_active: boolean;
  players_online: number;
  uptime_raw:     string;
  jvm_mem_pct:    number;
  vm_cpu_pct:     number;
}

export interface BackupRun {
  id:         number;
  filename:   string;
  file_path:  string;
  size_bytes: number;
  created_by: string;
  created_at: string;
  notes:      string | null;
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

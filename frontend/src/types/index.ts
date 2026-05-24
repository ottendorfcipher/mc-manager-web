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
  /** "mc" | "web" | "server" | "discord" */
  source:     "mc" | "web" | "server" | "discord";
  /** Raw identifier: email for web, IGN for mc/server, username for discord. */
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

// ── Music queue (from /api/music/*) ──────────────────────────────────────────

export interface SoundEntry {
  id:            string;
  display_name:  string;
  artist:        string;
  duration_secs: number;
  is_custom:     boolean;
  /** Custom-track artwork URL (e.g. `/uploads/music/images/foo.png`).
   *  Null for vanilla tracks — the UI renders a procedurally-coloured
   *  disc icon for those. */
  image_url:     string | null;
}

export interface ResourcePackInfo {
  installed:   boolean;
  url?:        string;
  sha1?:       string;
  size_bytes?: number;
}

export interface MusicQueueEntry {
  id:           number;
  sound_id:     string;
  display_name: string;
  requested_by: string;
  queued_at:    string;
}

export interface NowPlaying {
  queue_id:      number;
  sound_id:      string;
  display_name:  string;
  artist:        string;
  requested_by:  string;
  elapsed_secs:  number;
  duration_secs: number;
}

export interface MusicState {
  now_playing: NowPlaying | null;
  queue:       MusicQueueEntry[];
}

// ── Music zones (region-triggered per-player playback) ──────────────────────

export interface MusicZone {
  id:                  number;
  name:                string;
  dimension:           string;
  center_x:            number;
  center_z:            number;
  radius:              number;
  min_y:               number | null;
  max_y:               number | null;
  /** JSON-encoded array of sound IDs (use JSON.parse on the wire). */
  sound_ids_json:      string;
  /** JSON-encoded array of IGNs, or null for "everyone". */
  target_players_json: string | null;
  stop_on_leave:       number;  // 0/1
  cooldown_secs:       number;
  enabled:             number;  // 0/1
  created_by:          string;
  created_at:          string;
}

/** A sound event detected from assets/<namespace>/sounds.json in the resource pack. */
export interface DetectedSound {
  /** Full Minecraft namespaced ID, e.g. `redstonecipher:music.my_song`. */
  sound_id: string;
  /** First `name` value from the sounds array, e.g. `redstonecipher/music/my_song`. */
  path: string;
}

export interface DiscordSettings {
  /** `true` if a bot token is stored; the raw token is never returned. */
  bot_token_set:   boolean;
  /** `true` if a webhook URL is stored; the raw URL is never returned. */
  webhook_url_set: boolean;
  /** The Discord channel ID (not secret — shown for verification). */
  channel_id:      string | null;
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

// ── Events — Countdowns ─────────────────────────────────────────────────────

export interface Countdown {
  id:             number;
  title:          string;
  duration_secs:  number;
  target:         string;
  display_mode:   string;
  color:          string;
  sound_id:       string | null;
  /** JSON-encoded array of sound IDs played in sequence with the countdown. */
  sound_ids_json: string | null;
  status:         "pending" | "running" | "paused" | "finished" | "cancelled";
  elapsed_secs:   number;
  created_by:     string;
  created_at:     string;
  started_at:     string | null;
  finished_at:    string | null;
}

export interface ActiveCountdown {
  id:             number;
  title:          string;
  duration_secs:  number;
  remaining_secs: number;
  target:         string;
  display_mode:   string;
  color:          string;
  sound_id:       string | null;
  sound_ids_json: string | null;
  status:         "running" | "paused";
  created_by:     string;
}

export interface CountdownState {
  active: ActiveCountdown | null;
  recent: Countdown[];
}

// ── Events — Rising Oceans ──────────────────────────────────────────────────

export interface RisingOcean {
  id:                number;
  status:            "pending" | "running" | "paused" | "finished" | "cancelled";
  center_x:          number;
  center_z:          number;
  radius:            number;
  start_y:           number;
  end_y:             number;
  current_y:         number;
  interval_secs:     number;
  blocks_per_step:   number;
  perimeter_enforce: number;
  rise_pattern_json: string | null;
  backup_id:         number | null;
  backup_path:       string | null;
  world_slug:        string;
  created_by:        string;
  created_at:        string;
  started_at:        string | null;
  finished_at:       string | null;
  reverted:          number | null;
}

export interface ActiveRisingOcean {
  id:                number;
  status:            string;
  center_x:          number;
  center_z:          number;
  radius:            number;
  start_y:           number;
  end_y:             number;
  current_y:         number;
  interval_secs:     number;
  blocks_per_step:   number;
  perimeter_enforce: number;
  rise_pattern_json: string | null;
  backup_id:         number | null;
  world_slug:        string;
  created_by:        string;
}

export interface RisingOceanState {
  active: ActiveRisingOcean | null;
  recent: RisingOcean[];
}

// ── Events — Bounty Boards ──────────────────────────────────────────────────

export interface BountyBoard {
  id:                            number;
  title:                         string;
  status:                        "pending" | "running" | "paused" | "finished" | "cancelled";
  coord_broadcast_interval_secs: number;
  coord_broadcast_threshold:     number;
  reward_interval_secs:          number;
  reward_items_json:             string;
  rising_oceans_id:              number | null;
  world_slug:                    string;
  created_by:                    string;
  created_at:                    string;
  started_at:                    string | null;
  finished_at:                   string | null;
}

export interface TrackedStat {
  id:         number;
  board_id:   number;
  stat_key:   string;
  label:      string;
  mc_paths:   string;
  stat_mode:  "delta" | "peak";
  weight:     number;
  enabled:    number;
  sort_order: number;
}

export interface StatScore {
  stat_key: string;
  delta:    number;
  weighted: number;
}

export interface LeaderboardEntry {
  player_uuid:  string;
  player_ign:   string;
  total_score:  number;
  stat_scores:  StatScore[];
}

export interface ActiveBountyBoard {
  id:                            number;
  title:                         string;
  status:                        string;
  coord_broadcast_interval_secs: number;
  coord_broadcast_threshold:     number;
  reward_interval_secs:          number;
  reward_items_json:             string;
  rising_oceans_id:              number | null;
  world_slug:                    string;
  created_by:                    string;
  tracked_stats:                 TrackedStat[];
  leaderboard:                   LeaderboardEntry[];
}

export interface BountyBoardState {
  active: ActiveBountyBoard | null;
  recent: BountyBoard[];
}

// ── Events — Pre-game lobbies ──────────────────────────────────────────────

export interface PreGameLobby {
  id:                    number;
  name:                  string;
  lobby_x:               number;
  lobby_y:               number;
  lobby_z:               number;
  radius:                number;
  max_players:           number;
  allowed_players_json:  string | null;
  linked_event_type:     "manual" | "countdown" | "rising_oceans" | "bounty_board";
  linked_event_id:       number | null;
  launch_dimension:      string;
  launch_x:              number;
  launch_y:              number;
  launch_z:              number;
  status:                "pending" | "open" | "locked" | "launching" | "launched" | "closed";
  created_by:            string;
  created_at:            string;
  launched_at:           string | null;
  closed_at:             string | null;
}

export interface LobbyAttendee {
  lobby_id:            number;
  player_ign:          string;
  joined_at:           string;
  pre_event_dimension: string | null;
  pre_event_x:         number | null;
  pre_event_y:         number | null;
  pre_event_z:         number | null;
  status:              "joined" | "launched" | "returned";
}

export interface LobbyWithAttendees extends PreGameLobby {
  attendees: LobbyAttendee[];
}

// ── Parties ────────────────────────────────────────────────────────────────

export interface Party {
  id:          number;
  name:        string;
  description: string | null;
  owner_email: string;
  color:       string;
  created_at:  string;
}

export interface PartyMember {
  party_id:   number;
  player_ign: string;
  added_at:   string;
}

export interface PartyWithMembers extends Party {
  members: PartyMember[];
}

import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Download, Save, RefreshCw, Upload } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { SegmentedControl } from "@/components/SegmentedControl";

type SettingDef =
  | { type: "toggle"; key: string; label: string; desc: string; locked?: boolean; lockMsg?: string }
  | { type: "select"; key: string; label: string; desc: string; options: string[]; locked?: boolean }
  | { type: "slider"; key: string; label: string; desc: string; min: number; max: number }
  | { type: "text";   key: string; label: string; desc: string; placeholder?: string; locked?: boolean; lockMsg?: string };

const SCHEMA: { category: string; icon: string; settings: SettingDef[] }[] = [
  {
    category: "Server Identity", icon: "🏷",
    settings: [
      { type: "text",   key: "motd",               label: "Message of the Day",  desc: "Shown in the Minecraft server browser. Use §a–§f colour codes.", placeholder: "A Minecraft Server" },
      { type: "slider", key: "max-players",         label: "Max Players",          desc: "Maximum concurrent connections. Soft-limited; ops can exceed it.", min: 1, max: 100 },
      { type: "toggle", key: "hide-online-players", label: "Hide Player Count",    desc: "Replaces the online/max count with '?' in the server browser." },
      { type: "toggle", key: "enable-status",       label: "Respond to Pings",     desc: "When off the server won't respond to browser pings — stealth mode." },
      { type: "text",   key: "server-port",         label: "Server Port",          desc: "Minecraft Java Edition TCP port. Tailscale handles routing; do not change.", locked: true, lockMsg: "Changing the port breaks Tailscale connections." },
    ],
  },
  {
    category: "World", icon: "🌍",
    settings: [
      { type: "text",   key: "level-name",          label: "World Folder",         desc: "Folder under /opt/minecraft/server loaded on startup. Rename = new world.", locked: true, lockMsg: "Change only when intentionally swapping worlds." },
      { type: "text",   key: "level-seed",          label: "World Seed",           desc: "Seed used at world creation. Shown for reference only — changing does not affect existing terrain.", locked: true },
      { type: "text",   key: "level-type",          label: "World Type",           desc: "Generator for new chunks (minecraft:normal, minecraft:flat, minecraft:large_biomes, minecraft:amplified). Affects only ungenerated chunks.", locked: true, lockMsg: "Change only before generating new terrain." },
      { type: "toggle", key: "generate-structures", label: "Generate Structures",  desc: "Generate villages, strongholds, temples, and other structures in new chunks." },
      { type: "toggle", key: "allow-nether",        label: "Allow Nether",         desc: "Enable the Nether dimension. Disable to block nether portals entirely." },
      { type: "text",   key: "max-world-size",      label: "Max World Radius",     desc: "Maximum world border radius in blocks from origin (1–29999984). Default 29999984.", placeholder: "29999984" },
    ],
  },
  {
    category: "Gameplay", icon: "⚔️",
    settings: [
      { type: "select", key: "gamemode",             label: "Default Gamemode",         desc: "Gamemode assigned to players on first join.",                  options: ["survival","creative","adventure","spectator"] },
      { type: "select", key: "difficulty",           label: "Difficulty",               desc: "Controls mob behaviour, hunger drain, and damage.",            options: ["peaceful","easy","normal","hard"] },
      { type: "toggle", key: "hardcore",             label: "Hardcore Mode",            desc: "Deaths are permanent — players are banned from the server on death." },
      { type: "toggle", key: "force-gamemode",       label: "Force Gamemode on Join",   desc: "Resets every player to the default gamemode each time they join." },
      { type: "toggle", key: "pvp",                  label: "Player vs Player",         desc: "Allow players to damage each other. Blank = Minecraft default (enabled)." },
      { type: "toggle", key: "allow-flight",         label: "Allow Flight",             desc: "Permits flight in Survival. Disable to auto-kick fly-hackers." },
      { type: "toggle", key: "spawn-monsters",       label: "Hostile Mob Spawning",     desc: "Spawn creepers, zombies, skeletons, etc. Blank = Minecraft default (enabled)." },
      { type: "toggle", key: "spawn-animals",        label: "Passive Mob Spawning",     desc: "Spawn cows, pigs, sheep, etc. Blank = Minecraft default (enabled)." },
      { type: "toggle", key: "spawn-npcs",           label: "Villager Spawning",        desc: "Spawn villagers and wandering traders. Blank = Minecraft default (enabled)." },
      { type: "toggle", key: "enable-command-block", label: "Command Blocks",           desc: "Enable command block execution. Required for most adventure maps and datapacks." },
      { type: "toggle", key: "broadcast-console-to-ops", label: "Broadcast Console to Ops", desc: "Forward server console output to all online operators in chat." },
      { type: "select", key: "op-permission-level",  label: "Op Permission Level",      desc: "Capability tier granted to /op players: 1=No commands, 2=All except op/ban, 3=All except stop/restart, 4=All.", options: ["1","2","3","4"] },
      { type: "select", key: "function-permission-level", label: "Function Permission Level", desc: "Equivalent op tier for commands run from .mcfunction files and datapacks.", options: ["1","2","3","4"] },
      { type: "slider", key: "player-idle-timeout", label: "Idle Kick (minutes)",      desc: "Kick players idle for this many minutes. 0 = disabled.",       min: 0, max: 60 },
    ],
  },
  {
    category: "Performance", icon: "⚡",
    settings: [
      { type: "slider", key: "view-distance",                   label: "View Distance (chunks)",          desc: "Chunks sent to each player. 10 = default; 6–8 recommended for budget VMs.",                  min: 2, max: 32 },
      { type: "slider", key: "simulation-distance",             label: "Simulation Distance (chunks)",    desc: "Range in which entities, crops, and redstone are ticked. Keep ≤ view-distance.",            min: 2, max: 16 },
      { type: "slider", key: "entity-broadcast-range-percentage", label: "Entity Broadcast Range (%)", desc: "Scale the distance at which entities are sent to clients. 100 = default. Lower = less bandwidth.", min: 10, max: 500 },
      { type: "slider", key: "network-compression-threshold",   label: "Packet Compression (bytes)",      desc: "Compress packets larger than this. 256 = optimal. -1 = disabled.",                          min: -1, max: 512 },
      { type: "toggle", key: "sync-chunk-writes",               label: "Sync Chunk Writes",               desc: "Flush chunk data to disk synchronously. Slower but guards against corruption on crash." },
      { type: "toggle", key: "use-native-transport",            label: "Native Transport (Linux Epoll)",  desc: "Use Linux epoll for network I/O. Faster than Java NIO. Disable only to diagnose network bugs." },
      { type: "text",   key: "max-tick-time",                   label: "Watchdog Timeout (ms)",           desc: "Server is killed if a tick takes longer than this. -1 disables the watchdog. Default 60000.", placeholder: "60000" },
      { type: "text",   key: "pause-when-empty-seconds",        label: "Pause When Empty (seconds)",      desc: "Pause the server this many seconds after the last player leaves. -1 = never pause.", placeholder: "-1" },
    ],
  },
  {
    category: "Resource Pack", icon: "🎨",
    settings: [
      { type: "toggle", key: "require-resource-pack", label: "Require Resource Pack",  desc: "Kick players who decline the server resource pack prompt." },
      { type: "text",   key: "resource-pack",         label: "Resource Pack URL",       desc: "Direct download link to a .zip resource pack. Leave blank to disable.", placeholder: "https://" },
      { type: "text",   key: "resource-pack-prompt",  label: "Resource Pack Prompt",    desc: "Custom message shown in the resource pack download dialog.", placeholder: "Please accept the server resource pack." },
    ],
  },
  {
    category: "Access & Security", icon: "🔒",
    settings: [
      { type: "toggle", key: "online-mode",             label: "Online Mode (Mojang Auth)",  desc: "Verifies player identities with Mojang. Must stay enabled — server is private via Tailscale.",         locked: true, lockMsg: "Locked to prevent unauthenticated access." },
      { type: "toggle", key: "white-list",              label: "Enable Whitelist",           desc: "Only whitelisted Minecraft accounts can join." },
      { type: "toggle", key: "enforce-whitelist",       label: "Enforce Whitelist Live",     desc: "Kick non-whitelisted players immediately when the whitelist is updated while the server is running." },
      { type: "slider", key: "spawn-protection",        label: "Spawn Protection (blocks)",  desc: "Radius around world spawn where only ops can build. 0 = disabled.",         min: 0, max: 100 },
      { type: "toggle", key: "enforce-secure-profile",  label: "Enforce Secure Chat (1.19+)",desc: "Require signed player chat messages. Disable to allow unsigned clients or modified clients." },
      { type: "toggle", key: "log-ips",                 label: "Log Player IPs (1.20.2+)",  desc: "Write connecting player IP addresses to the server log." },
      { type: "toggle", key: "prevent-proxy-connections",label: "Block VPN/Proxy Connections",desc: "Reject connections from known proxies and VPNs. Not needed if Tailscale-only." },
      { type: "slider", key: "rate-limit",              label: "Packet Rate Limit",          desc: "Maximum packets per second per player. 0 = disabled. Helps defend against packet-flood bots.", min: 0, max: 1000 },
      { type: "toggle", key: "enable-rcon",             label: "RCON",                       desc: "Required for server management commands (time, weather, give, gamerules). Do not disable.", locked: true, lockMsg: "Required — the backend uses RCON to manage the server." },
      { type: "text",   key: "rcon.port",               label: "RCON Port",                  desc: "Port the backend connects to for RCON. Change requires updating the backend config.", locked: true },
    ],
  },
];

/** Download a JS object as a named JSON file. */
function downloadJson(obj: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ConfigurePage() {
  const { user } = useAuthStore();
  const canWrite = user?.permissions.can_write_config ?? false;
  const canRead  = user?.permission_keys?.includes("config.read") ?? false;
  const importRef = useRef<HTMLInputElement>(null);

  const { data: props = {}, isLoading, refetch } = useQuery<Record<string, string>>({
    queryKey: ["properties"],
    queryFn:  () => api.get("/properties"),
  });

  const [edits, setEdits] = useState<Record<string, string>>({});
  const merged = { ...props, ...edits };

  const saveMut = useMutation({
    mutationFn: () => api.put("/properties", edits),
    onSuccess: () => { setEdits({}); refetch(); },
  });

  const pending = Object.keys(edits).length;

  function set(key: string, value: string) {
    setEdits((p) => ({ ...p, [key]: value }));
  }

  /** Export the current (merged) settings as a .json file. */
  function handleExport() {
    downloadJson(merged, "server-settings.json");
  }

  /** Read a .json file and merge its valid string-map entries into pending edits. */
  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
          alert("Invalid config file: expected a JSON object.");
          return;
        }
        const valid: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (typeof v === "string") valid[k] = v;
          else if (typeof v === "number" || typeof v === "boolean") valid[k] = String(v);
        }
        setEdits((prev) => ({ ...prev, ...valid }));
      } catch {
        alert("Could not parse the JSON file.");
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    e.target.value = "";
  }

  function renderSetting(s: SettingDef) {
    const val = merged[s.key] ?? "";
    const locked = ("locked" in s && s.locked) || !canWrite;

    return (
      <div key={s.key} className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4
                                    py-3 first:pt-0 last:pb-0 border-b border-[#D9D5D0] dark:border-[#363944] last:border-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {("locked" in s && s.locked) && <span className="text-[10px] text-meta">🔒</span>}
            <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0]">{s.label}</p>
            {edits[s.key] !== undefined && <span className="w-1.5 h-1.5 rounded-full bg-[#FBBF24]" />}
          </div>
          <p className="text-xs text-meta mt-0.5">{s.desc}</p>
          {("locked" in s && s.locked && "lockMsg" in s) && <p className="text-xs text-warn mt-0.5">{(s as any).lockMsg}</p>}
        </div>
        <div className="flex-shrink-0">
          {s.type === "toggle" && (
            <button
              role="switch" aria-checked={val === "true"} disabled={locked}
              onClick={() => set(s.key, val === "true" ? "false" : "true")}
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${val === "true" ? "bg-[#5B9BF0]" : "bg-[#D9D5D0] dark:bg-[#363944]"} disabled:opacity-50`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow translate-y-0.5 transition-transform ${val === "true" ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
          )}
          {s.type === "select" && (
            // ≤5 options: segmented control (recognition over recall, all visible).
            // >5 options: keep native select (too many to show inline).
            s.options.length <= 5 ? (
              <SegmentedControl
                label={s.label}
                size="sm"
                disabled={locked}
                value={val || s.options[0]}
                onChange={(v) => set(s.key, v)}
                options={s.options.map((o) => ({ value: o, label: o }))}
              />
            ) : (
              <select disabled={locked} value={val}
                onChange={(e) => set(s.key, e.target.value)}
                className="rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-2 py-1 text-sm disabled:opacity-50">
                {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )
          )}
          {s.type === "slider" && (
            <div className="flex items-center gap-2 w-full sm:w-48">
              <input type="range" min={s.min} max={s.max} step={1} value={Number(val) || s.min}
                disabled={locked}
                onChange={(e) => set(s.key, e.target.value)}
                className="flex-1 accent-[#5B9BF0]" />
              <span className="text-xs text-[#6B6E78] dark:text-[#A8AEBB] w-8 text-right">{val || s.min}</span>
            </div>
          )}
          {s.type === "text" && (
            <input type="text" disabled={locked} value={val}
              placeholder={("placeholder" in s && s.placeholder) || ""}
              onChange={(e) => set(s.key, e.target.value)}
              className="w-full sm:w-56 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-2 py-1.5 text-sm disabled:opacity-50" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Configure</h1>
          <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">Edit server.properties — Save applies changes and restarts the game process</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => refetch()} className="btn-secondary flex items-center gap-1.5 text-sm" aria-label="Reload from server">
            <RefreshCw className="w-3.5 h-3.5" /> Reload
          </button>
          {/* Export — available to anyone who can read config */}
          {canRead && (
            <button onClick={handleExport} className="btn-secondary flex items-center gap-1.5 text-sm" title="Download current settings as JSON">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          )}
          {/* Import — only for users who can write config */}
          {canWrite && (
            <>
              <button
                onClick={() => importRef.current?.click()}
                className="btn-secondary flex items-center gap-1.5 text-sm"
                title="Load settings from a JSON file"
              >
                <Upload className="w-3.5 h-3.5" /> Import
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={handleImport}
              />
            </>
          )}
          {canWrite && pending > 0 && (
            <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="btn-primary flex items-center gap-1.5 text-sm">
              <Save className="w-3.5 h-3.5" />
              {saveMut.isPending ? "Saving…" : `Save ${pending} change${pending !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-6">
          {SCHEMA.map(({ category, icon, settings }) => (
            <div key={category} className="space-y-2">
              <h2 className="text-base font-bold text-[#1C1E27] dark:text-[#EAECF0]">{icon}  {category}</h2>
              <div className="card divide-y-0">
                {settings.map(renderSetting)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Save, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";

type SettingDef =
  | { type: "toggle"; key: string; label: string; desc: string; locked?: boolean; lockMsg?: string }
  | { type: "select"; key: string; label: string; desc: string; options: string[]; locked?: boolean }
  | { type: "slider"; key: string; label: string; desc: string; min: number; max: number }
  | { type: "text";   key: string; label: string; desc: string; placeholder?: string; locked?: boolean; lockMsg?: string };

const SCHEMA: { category: string; icon: string; settings: SettingDef[] }[] = [
  {
    category: "Server Identity", icon: "🏷",
    settings: [
      { type: "text",   key: "motd",                label: "Message of the Day", desc: "Shown in the server browser. Use §a–§f for colour.", placeholder: "A Minecraft Server" },
      { type: "slider", key: "max-players",          label: "Max Players",         desc: "Maximum concurrent players.",                    min: 1, max: 50 },
      { type: "toggle", key: "hide-online-players",  label: "Hide Player Count",   desc: "Replaces player count with '?' in browser." },
    ],
  },
  {
    category: "Gameplay", icon: "⚔️",
    settings: [
      { type: "select", key: "gamemode",  label: "Default Gamemode", desc: "Assigned to new players on first join.", options: ["survival","creative","adventure","spectator"] },
      { type: "select", key: "difficulty",label: "Difficulty",       desc: "Controls mob damage and hunger.",        options: ["peaceful","easy","normal","hard"] },
      { type: "toggle", key: "pvp",              label: "Player vs Player",      desc: "Allow players to damage each other." },
      { type: "toggle", key: "allow-flight",     label: "Allow Flight",          desc: "Permits flight in Survival. Disable to kick fly-hackers." },
      { type: "toggle", key: "enable-command-block", label: "Command Blocks",    desc: "Required for most adventure maps." },
      { type: "slider", key: "player-idle-timeout", label: "Idle Kick (minutes)",desc: "0 = never.",                                min: 0, max: 60 },
    ],
  },
  {
    category: "Performance", icon: "⚡",
    settings: [
      { type: "slider", key: "view-distance",              label: "View Distance (chunks)",     desc: "10 is default; 6–8 is best for Spot VMs.", min: 2, max: 32 },
      { type: "slider", key: "simulation-distance",        label: "Simulation Distance",        desc: "Range entities/crops are simulated. Keep ≤ view-distance.", min: 2, max: 16 },
      { type: "slider", key: "network-compression-threshold", label: "Packet Compression (bytes)", desc: "256 is optimal. -1 disables.", min: -1, max: 512 },
      { type: "toggle", key: "sync-chunk-writes",          label: "Sync Chunk Writes",           desc: "Slower but protects against data corruption." },
    ],
  },
  {
    category: "Access & Security", icon: "🔒",
    settings: [
      { type: "toggle", key: "online-mode",    label: "Online Mode (Mojang Auth)", desc: "Must stay enabled — server is private via Tailscale.", locked: true, lockMsg: "Locked to prevent unauthenticated access." },
      { type: "toggle", key: "white-list",     label: "Enable Whitelist",           desc: "Only whitelisted players can join." },
      { type: "toggle", key: "enforce-whitelist", label: "Enforce Whitelist Live",  desc: "Kicks non-whitelisted players immediately." },
      { type: "slider", key: "spawn-protection", label: "Spawn Protection (blocks)",desc: "0 disables.", min: 0, max: 100 },
      { type: "toggle", key: "enable-rcon",    label: "RCON",                        desc: "Keep disabled — manage via SSH instead.", locked: true, lockMsg: "Disabled for security." },
    ],
  },
];

export function ConfigurePage() {
  const { user } = useAuthStore();
  const canWrite = user?.permissions.can_write_config ?? false;

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

  function renderSetting(s: SettingDef) {
    const val = merged[s.key] ?? "";
    const locked = ("locked" in s && s.locked) || !canWrite;

    return (
      <div key={s.key} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0 border-b border-[#D9D5D0] dark:border-[#363944] last:border-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {("locked" in s && s.locked) && <span className="text-[10px] text-[#9B9EA6]">🔒</span>}
            <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0]">{s.label}</p>
            {edits[s.key] !== undefined && <span className="w-1.5 h-1.5 rounded-full bg-[#FBBF24]" />}
          </div>
          <p className="text-xs text-[#9B9EA6] mt-0.5">{s.desc}</p>
          {("locked" in s && s.locked && "lockMsg" in s) && <p className="text-xs text-[#FBBF24] mt-0.5">{(s as any).lockMsg}</p>}
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
            <select disabled={locked} value={val}
              onChange={(e) => set(s.key, e.target.value)}
              className="rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-2 py-1 text-sm disabled:opacity-50">
              {s.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          {s.type === "slider" && (
            <div className="flex items-center gap-2 w-48">
              <input type="range" min={s.min} max={s.max} step={1} value={Number(val) || s.min}
                disabled={locked}
                onChange={(e) => set(s.key, e.target.value)}
                className="flex-1 accent-[#5B9BF0]" />
              <span className="text-xs text-[#6B6E78] dark:text-[#9BA0B0] w-8 text-right">{val || s.min}</span>
            </div>
          )}
          {s.type === "text" && (
            <input type="text" disabled={locked} value={val}
              placeholder={("placeholder" in s && s.placeholder) || ""}
              onChange={(e) => set(s.key, e.target.value)}
              className="w-56 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-2 py-1 text-sm disabled:opacity-50" />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Configure</h1>
          <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">Edit server.properties — Save applies changes and restarts the game process</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-secondary flex items-center gap-1.5 text-sm" aria-label="Reload from server">
            <RefreshCw className="w-3.5 h-3.5" /> Reload
          </button>
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

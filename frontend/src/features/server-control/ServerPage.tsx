import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2, Terminal, Save, Megaphone, UserX, ShieldOff, Crown,
  CrownIcon, Sword, Zap,
  Backpack, MapPin, HeartPulse, ChevronsDown, Flame, Snowflake, Droplet, Bed,
  Sun, CloudRain, Bomb, Bug, Timer, Target, Trophy, ScrollText, MessageSquare,
  Globe, Bell, User, Minus, Plus, Lock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { toast } from "@/components/Toast";
import type { ServerStatus, WhitelistEntry, McPlayer } from "@/types";

// ── Difficulty ────────────────────────────────────────────────────────────────

const DIFFICULTIES = [
  { id: "peaceful", label: "Peaceful", emoji: "🕊️", desc: "No hostile mobs, instant health regen" },
  { id: "easy",     label: "Easy",     emoji: "😊", desc: "Mobs deal less damage, hunger drains slowly" },
  { id: "normal",   label: "Normal",   emoji: "⚔️",  desc: "Default experience" },
  { id: "hard",     label: "Hard",     emoji: "💀", desc: "Increased damage, starvation lethal" },
] as const;

// ── Gamerules ─────────────────────────────────────────────────────────────────
// Grouped by mental model. NNG recognition > recall: emoji + plain-language labels.

type BoolRule = { key: string; label: string; desc: string; onVal: string; offVal: string; defaultOn: boolean };
type NumRule  = { key: string; label: string; desc: string; type: "number"; defaultVal: number; min: number; max: number };
type Rule     = BoolRule | NumRule;
type RuleGroup = { label: string; rules: Rule[] };

const GAMERULE_GROUPS: RuleGroup[] = [
  {
    label: "Player Mechanics",
    rules: [
      { key: "keepInventory",       label: "Keep Inventory on Death",   desc: "Players keep items and XP when they die.",          onVal: "true",  offVal: "false", defaultOn: false },
      { key: "reducedDebugInfo",    label: "Show Coordinates (F3)",     desc: "XYZ shown in the debug screen.",                    onVal: "false", offVal: "true",  defaultOn: true  },
      { key: "naturalRegeneration", label: "Natural Health Regen",       desc: "Players slowly regenerate health when satiated.",   onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "fallDamage",          label: "Fall Damage",                desc: "Players and mobs take damage from falling.",        onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "fireDamage",          label: "Fire Damage",                desc: "Fire and lava deal damage to players.",             onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "freezeDamage",        label: "Freeze Damage",              desc: "Players freeze and take damage in powdered snow.",  onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "drowningDamage",      label: "Drowning Damage",            desc: "Players take damage when submerged without air.",   onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "playersSleepingPercentage", label: "Sleep % to Skip Night", desc: "Percentage of online players who need to sleep (0 = anyone, 100 = all).", type: "number", defaultVal: 100, min: 0, max: 100 },
    ],
  },
  {
    label: "World & Environment",
    rules: [
      { key: "doDaylightCycle",     label: "Day/Night Cycle",           desc: "Time advances normally day to night.",               onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "doWeatherCycle",      label: "Weather Cycle",             desc: "Rain and thunder cycles occur naturally.",           onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "doFireTick",          label: "Fire Spreads",              desc: "Fire can spread to adjacent flammable blocks.",      onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "mobGriefing",         label: "Mob Griefing",              desc: "Creepers explode, Endermen pick up blocks, etc.",    onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "doMobSpawning",       label: "Mob Spawning",              desc: "Hostile and passive mobs spawn naturally.",          onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "randomTickSpeed",     label: "Random Tick Speed",         desc: "Speed of crop growth, grass spread, fire spread (default 3; 0 = off).", type: "number", defaultVal: 3, min: 0, max: 1000 },
      { key: "spawnRadius",         label: "Spawn Radius",              desc: "Max distance from world spawn that players are placed on first join.", type: "number", defaultVal: 10, min: 0, max: 1000 },
    ],
  },
  {
    label: "Social & Notifications",
    rules: [
      { key: "announceAdvancements", label: "Announce Advancements",   desc: "Chat broadcasts when a player earns an advancement.", onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "sendCommandFeedback",  label: "Command Feedback in Chat", desc: "Command results are shown in chat to the executor.",  onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "logAdminCommands",     label: "Log Admin Commands",       desc: "Admin commands are logged to the server console.",    onVal: "true",  offVal: "false", defaultOn: true  },
      { key: "showDeathMessages",    label: "Death Messages",           desc: "Broadcast to chat when a player or pet dies.",        onVal: "true",  offVal: "false", defaultOn: true  },
    ],
  },
];

// Per-rule + per-group icons for the card-tile layout (recognition over recall).
const RULE_ICONS: Record<string, LucideIcon> = {
  keepInventory: Backpack, reducedDebugInfo: MapPin, naturalRegeneration: HeartPulse,
  fallDamage: ChevronsDown, fireDamage: Flame, freezeDamage: Snowflake,
  drowningDamage: Droplet, playersSleepingPercentage: Bed,
  doDaylightCycle: Sun, doWeatherCycle: CloudRain, doFireTick: Flame,
  mobGriefing: Bomb, doMobSpawning: Bug, randomTickSpeed: Timer, spawnRadius: Target,
  announceAdvancements: Trophy, sendCommandFeedback: Terminal,
  logAdminCommands: ScrollText, showDeathMessages: MessageSquare,
};
const GROUP_ICONS: Record<string, LucideIcon> = {
  "Player Mechanics": User,
  "World & Environment": Globe,
  "Social & Notifications": Bell,
};

type GameruleKey = string;

const TIME_PRESETS = [
  { label: "🌅 Sunrise", ticks: 0 },
  { label: "☀️ Day",     ticks: 6000 },
  { label: "🌆 Sunset",  ticks: 12000 },
  { label: "🌑 Night",   ticks: 18000 },
];

const WEATHER_PRESETS = [
  { label: "☀️ Clear",   kind: "clear",   gif: "/weather/sunny.gif",  poster: "/weather/sunny.png"  },
  { label: "🌧️ Rain",   kind: "rain",    gif: "/weather/rainy.gif",  poster: "/weather/rainy.png"  },
  { label: "⛈️ Thunder", kind: "thunder", gif: "/weather/stormy.gif", poster: "/weather/stormy.png" },
];

const VM_STEPS: Record<string, { after: number; text: string }[]> = {
  start: [
    { after: 0,  text: "Requesting VM start…" },
    { after: 5,  text: "VM is booting…" },
    { after: 30, text: "Starting Minecraft service…" },
    { after: 75, text: "Almost ready…" },
  ],
  stop: [
    { after: 0,  text: "Saving world and stopping…" },
    { after: 10, text: "Shutting down Minecraft service…" },
    { after: 25, text: "Stopping VM…" },
  ],
  reset: [
    { after: 0, text: "Restarting Minecraft process…" },
    { after: 5, text: "Waiting for service to come up…" },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Gamerule card-tile primitives ─────────────────────────────────────────────

function StatusBadge({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
        on
          ? "bg-[#ECFDF5] text-[#047857] dark:bg-[#052e16] dark:text-[#6EE7B7]"
          : "bg-[#F0EDE9] text-meta dark:bg-[#2A2D38]"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`} />
      {on ? "Enabled" : "Disabled"}
    </span>
  );
}

function Switch({ checked, onChange, disabled, label }: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 rounded-full transition-colors flex-shrink-0
        focus-visible:ring-2 focus-visible:ring-[#5B9BF0]
        ${checked ? "bg-[#5B9BF0]" : "bg-[#D9D5D0] dark:bg-[#363944]"}
        disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow translate-y-0.5
        transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

function Stepper({ value, onChange, min, max, disabled }: {
  value: number; onChange: (v: number) => void; min: number; max: number; disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = (n: number) => {
    const c = Math.max(min, Math.min(max, isNaN(n) ? min : n));
    setDraft(String(c));
    onChange(c);
  };
  const btn = "w-6 h-6 flex items-center justify-center rounded-md border border-[#D9D5D0] " +
    "dark:border-[#363944] text-meta hover:text-[#5B9BF0] hover:border-[#5B9BF0] " +
    "disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button className={btn} disabled={disabled} aria-label="Decrease"
        onClick={() => commit((parseInt(draft) || 0) - 1)}>
        <Minus className="w-3 h-3" aria-hidden />
      </button>
      <input
        type="number" min={min} max={max} value={draft} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(parseInt(draft))}
        onKeyDown={(e) => { if (e.key === "Enter") commit(parseInt(draft)); }}
        className="w-12 text-center rounded-md border border-[#D9D5D0] dark:border-[#363944]
                   bg-white dark:bg-[#2A2D38] text-sm py-1 text-[#1C1E27] dark:text-[#EAECF0]
                   focus:outline-none focus:ring-2 focus:ring-[#5B9BF0] disabled:opacity-50
                   [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button className={btn} disabled={disabled} aria-label="Increase"
        onClick={() => commit((parseInt(draft) || 0) + 1)}>
        <Plus className="w-3 h-3" aria-hidden />
      </button>
    </div>
  );
}

function GameruleTile({ icon: Icon, label, desc, badge, control, flash }: {
  icon: LucideIcon; label: string; desc: string;
  badge: React.ReactNode; control: React.ReactNode; flash?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#D9D5D0] dark:border-[#363944]
                    bg-[#F7F5F2] dark:bg-[#1E212B] p-3 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 text-[#5B9BF0] flex-shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] leading-tight">{label}</p>
          <p className="text-[11px] text-meta leading-snug mt-0.5">{desc}</p>
        </div>
        {flash && (
          <CheckCircle2 className="w-4 h-4 text-[#36B37E] flex-shrink-0 animate-[modal-in_150ms_ease]" aria-hidden />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 mt-auto pt-0.5">
        {badge ?? <span />}
        {control}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-meta mb-0">{children}</p>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ServerPage() {
  const { user, hasPerm } = useAuthStore();
  const qc = useQueryClient();
  const canControl     = user?.permissions.can_control_server ?? false;
  const canManageWl    = hasPerm("server.whitelist.manage");
  const canGive        = hasPerm("players.give_items");

  // Server status
  const { data: serverStatus } = useQuery<ServerStatus>({
    queryKey:      ["server-status"],
    queryFn:       () => api.get("/server/status"),
    refetchInterval: 10_000,
  });

  // Online players
  const { data: livePlayers = [] } = useQuery<McPlayer[]>({
    queryKey:      ["mc-players"],
    queryFn:       () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });
  const onlinePlayers = livePlayers.filter((p) => p.online);

  // Whitelist
  const { data: whitelist = [], isLoading: wlLoading } = useQuery<WhitelistEntry[]>({
    queryKey: ["whitelist"],
    queryFn:  () => api.get("/server/whitelist"),
    enabled:  canManageWl,
  });

  // VM actions with step-text animation
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [vmStepText,    setVmStepText]    = useState("");
  const vmTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const vmMut = useMutation({
    mutationFn: (action: string) => api.post(`/server/vm/${action}`, {}),
    onMutate: (action) => {
      setPendingAction(action);
      vmTimersRef.current.forEach(clearTimeout);
      vmTimersRef.current = [];
      (VM_STEPS[action] ?? []).forEach(({ after, text }) => {
        vmTimersRef.current.push(setTimeout(() => setVmStepText(text), after * 1000));
      });
    },
    onSettled: () => { setPendingAction(null); setVmStepText(""); qc.invalidateQueries({ queryKey: ["server-status"] }); },
  });

  // Difficulty (live command, no restart needed)
  const [difficulty, setDifficulty] = useState("normal");
  useEffect(() => {
    api.get<Record<string, string>>("/world/gamerules")
      .then((r) => { if (r["difficulty"]) setDifficulty(r["difficulty"]); })
      .catch(() => {});
  }, []);
  const diffMut = useMutation({
    mutationFn: (d: string) => api.post("/world/gamerule/difficulty", { value: d }),
    onSuccess:  (_, d) => { setDifficulty(d); toast.success(`Difficulty set to ${d}`); },
    onError:    () => toast.error("Failed to set difficulty"),
  });

  // Gamerule toggles
  const [grStates, setGrStates] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GAMERULE_GROUPS.flatMap((g) => g.rules).map((r) => {
      const isToggle = !("type" in r) || r.type !== "number";
      return [r.key, isToggle ? (r as {defaultOn: boolean}).defaultOn ?? true : true];
    })),
  );
  const [grNumbers, setGrNumbers] = useState<Record<string, number>>(() =>
    Object.fromEntries(GAMERULE_GROUPS.flatMap((g) => g.rules)
      .filter((r) => "type" in r && r.type === "number")
      .map((r) => [r.key, (r as {defaultVal: number}).defaultVal])),
  );
  const [grFlash, setGrFlash] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.get<Record<string, string>>("/world/gamerules").then((vals) => {
      const toggleUpdates: Record<string, boolean> = {};
      const numUpdates: Record<string, number> = {};
      GAMERULE_GROUPS.flatMap((g) => g.rules).forEach((rule) => {
        const raw = vals[rule.key];
        if (raw == null) return;
        if ("type" in rule && rule.type === "number") {
          numUpdates[rule.key] = parseInt(raw) || 0;
        } else {
          const r = rule as {key: string; onVal: string; offVal: string; defaultOn: boolean};
          toggleUpdates[rule.key] = raw === r.onVal;
        }
      });
      setGrStates((p) => ({ ...p, ...toggleUpdates }));
      setGrNumbers((p) => ({ ...p, ...numUpdates }));
    }).catch(() => {});
  }, []);

  const grMut = useMutation({
    mutationFn: ({ rule, value }: { rule: string; value: string }) =>
      api.post(`/world/gamerule/${rule}`, { value }),
    onSuccess: (_, { rule }) => {
      setGrFlash((f) => ({ ...f, [rule]: true }));
      setTimeout(() => setGrFlash((f) => ({ ...f, [rule]: false })), 1200);
    },
    onError: () => toast.error("Failed to update gamerule"),
  });

  function setToggle(key: string, onVal: string, offVal: string, next: boolean) {
    setGrStates((p) => ({ ...p, [key]: next }));
    grMut.mutate({ rule: key, value: next ? onVal : offVal });
  }

  function setNumber(key: string, n: number) {
    setGrNumbers((p) => ({ ...p, [key]: n }));
    grMut.mutate({ rule: key, value: String(n) });
  }

  // Time + weather
  const [hoveredWeather, setHoveredWeather] = useState<string | null>(null);
  const timeMut    = useMutation({ mutationFn: (t: number) => api.post("/world/time", { ticks: t }) });
  const wxMut      = useMutation({ mutationFn: (k: string) => api.post("/world/weather", { kind: k }) });

  // Whitelist
  const [wlInput, setWlInput] = useState("");
  const wlInputRef = useRef<HTMLInputElement>(null);
  const wlAddMut = useMutation({
    mutationFn: (player: string) => api.post("/server/whitelist/add", { player }),
    onSuccess: (_, p) => { setWlInput(""); qc.invalidateQueries({ queryKey: ["whitelist"] }); toast.success(`${p} added to whitelist`); wlInputRef.current?.focus(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const wlRemoveMut = useMutation({
    mutationFn: (player: string) => api.post("/server/whitelist/remove", { player }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whitelist"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // Player actions (kick/ban/op)
  const [playerInput, setPlayerInput] = useState("");
  const kickMut = useMutation({
    mutationFn: (player: string) => api.post("/server/kick", { player }),
    onSuccess: (_, p) => { toast.success(`Kicked ${p}`); setPlayerInput(""); },
    onError: (e: Error) => toast.error(e.message),
  });
  const banMut = useMutation({
    mutationFn: ({ player, action }: { player: string; action: "add" | "remove" }) =>
      api.post(`/server/ban/${action}`, { player }),
    onSuccess: (_, { player, action }) => toast.success(`${player} ${action === "add" ? "banned" : "unbanned"}`),
    onError: (e: Error) => toast.error(e.message),
  });
  const opMut = useMutation({
    mutationFn: ({ player, action }: { player: string; action: "add" | "remove" }) =>
      api.post(`/server/op/${action}`, { player }),
    onSuccess: (_, { player, action }) => toast.success(`${player} ${action === "add" ? "opped" : "de-opped"}`),
    onError: (e: Error) => toast.error(e.message),
  });

  // Announce
  const [announce, setAnnounce] = useState("");
  const announceMut = useMutation({
    mutationFn: (msg: string) => api.post("/server/announce", { message: msg }),
    onSuccess: () => { toast.success("Announced to all players"); setAnnounce(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  // Save world
  const saveMut = useMutation({
    mutationFn: () => api.post("/server/save", {}),
    onSuccess: () => toast.success("World saved"),
    onError: (e: Error) => toast.error(e.message),
  });

  // Console
  const [consoleInput, setConsoleInput] = useState("");
  const [consoleHistory, setConsoleHistory] = useState<string[]>([]);
  const consoleMut = useMutation({
    mutationFn: (cmd: string) => api.post("/console", { command: cmd }),
    onSuccess: (_, cmd) => { setConsoleHistory((h) => [...h.slice(-49), `> ${cmd}`]); setConsoleInput(""); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="page space-y-5">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Server Control</h1>
          <p className="text-sm text-meta mt-0.5">Live server controls — changes take effect instantly</p>
        </div>
        {canControl && (
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="btn-secondary text-sm flex items-center gap-1.5"
            title="Save all chunks to disk now"
          >
            <Save className="w-4 h-4" aria-hidden />
            {saveMut.isPending ? "Saving…" : "Save World"}
          </button>
        )}
      </div>

      {/* ── VM Controls ─────────────────────────────────────────────────────── */}
      {canControl && (
        <div className="card space-y-3">
          <SectionHeader>⚡ Server Power</SectionHeader>
          <p className="text-sm text-meta">
            Stop ends all player sessions but preserves the world. Force Reset restarts the Minecraft process — use only if the server is unresponsive.
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => vmMut.mutate("start")} disabled={vmMut.isPending} className="btn-primary text-sm">▶ Start</button>
            <button onClick={() => vmMut.mutate("stop")}  disabled={vmMut.isPending} className="btn-danger text-sm">■ Stop</button>
            <button onClick={() => vmMut.mutate("reset")} disabled={vmMut.isPending} className="btn-secondary text-sm">↺ Force Reset</button>
            <span className="text-xs text-meta ml-auto">Status: {serverStatus?.vm.status ?? "…"}</span>
          </div>
          {vmMut.isPending && pendingAction && (
            <div role="status" aria-live="polite" className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-[#5B9BF0]">
                <div className="w-3.5 h-3.5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin flex-shrink-0" aria-hidden />
                <span>{vmStepText || `VM ${pendingAction} in progress…`}</span>
              </div>
              <div className="h-1 w-full rounded-full bg-[#E5E2DE] dark:bg-[#363944] overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-[#5B9BF0] animate-[progress_1.4s_ease-in-out_infinite]" aria-hidden />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Difficulty ──────────────────────────────────────────────────────── */}
      <div className="card space-y-3">
        <SectionHeader>🌍 Difficulty</SectionHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DIFFICULTIES.map(({ id, label, emoji, desc }) => (
            <button
              key={id}
              disabled={!canControl || diffMut.isPending}
              onClick={() => diffMut.mutate(id)}
              title={desc}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-sm font-medium transition-all
                ${difficulty === id
                  ? "border-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#5B9BF0]"
                  : "border-[#D9D5D0] dark:border-[#363944] hover:border-[#5B9BF0] text-[#6B6E78] dark:text-[#A8AEBB]"
                } disabled:opacity-50`}
            >
              <span className="text-2xl">{emoji}</span>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-meta">
          {DIFFICULTIES.find((d) => d.id === difficulty)?.desc ?? ""}
        </p>
      </div>

      {/* ── Time & Weather ──────────────────────────────────────────────────── */}
      <div className="card space-y-5">
        <SectionHeader>⏰ Time of Day</SectionHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TIME_PRESETS.map(({ label, ticks }) => (
            <button key={label} disabled={!canControl}
              onClick={() => timeMut.mutate(ticks)}
              className="btn-secondary text-xs py-2.5 text-center">
              {label}
            </button>
          ))}
        </div>

        <SectionHeader>🌤️ Weather</SectionHeader>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {WEATHER_PRESETS.map(({ label, kind, gif, poster }) => (
            <button
              key={kind}
              disabled={!canControl}
              onClick={() => wxMut.mutate(kind)}
              onMouseEnter={() => setHoveredWeather(kind)}
              onMouseLeave={() => setHoveredWeather(null)}
              style={{ backgroundImage: `url('${hoveredWeather === kind ? gif : poster}')` }}
              className="relative h-24 sm:h-28 rounded-xl overflow-hidden bg-cover bg-center
                         border-2 border-transparent hover:border-[#5B9BF0]
                         transition-all duration-150 disabled:opacity-40"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
              <span className="absolute bottom-2.5 left-0 right-0 text-center text-white text-xs font-semibold drop-shadow-md">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Game rules (card tiles, grouped) ───────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader>🎮 Game Rules</SectionHeader>
          {!canControl && (
            <span className="flex items-center gap-1 text-[11px] text-meta">
              <Lock className="w-3 h-3" aria-hidden /> View only
            </span>
          )}
        </div>
        {GAMERULE_GROUPS.map((group) => {
          const GroupIcon = GROUP_ICONS[group.label] ?? Globe;
          const bools = group.rules.filter((r) => !("type" in r) || r.type !== "number");
          const onCount = bools.filter((r) => grStates[(r as { key: string }).key]).length;
          return (
            <div key={group.label} className="card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GroupIcon className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
                  <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">{group.label}</h3>
                </div>
                {bools.length > 0 && (
                  <span className="text-[11px] text-meta tabular-nums">{onCount} of {bools.length} on</span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {group.rules.map((rule) => {
                  const Icon  = RULE_ICONS[rule.key] ?? Zap;
                  const isNum = "type" in rule && rule.type === "number";
                  if (isNum) {
                    const r = rule as { key: string; label: string; desc: string; min: number; max: number; defaultVal: number };
                    return (
                      <GameruleTile
                        key={r.key} icon={Icon} label={r.label} desc={r.desc} flash={grFlash[r.key]}
                        badge={
                          <span className="text-[10px] font-medium text-meta px-2 py-0.5 rounded-full bg-[#F0EDE9] dark:bg-[#2A2D38] tabular-nums">
                            {r.min}–{r.max}
                          </span>
                        }
                        control={
                          <Stepper
                            value={grNumbers[r.key] ?? r.defaultVal}
                            onChange={(n) => setNumber(r.key, n)}
                            min={r.min} max={r.max} disabled={!canControl}
                          />
                        }
                      />
                    );
                  }
                  const r  = rule as { key: string; label: string; desc: string; onVal: string; offVal: string; defaultOn: boolean };
                  const on = grStates[r.key];
                  return (
                    <GameruleTile
                      key={r.key} icon={Icon} label={r.label} desc={r.desc} flash={grFlash[r.key]}
                      badge={<StatusBadge on={on} />}
                      control={
                        <Switch
                          checked={on}
                          onChange={(v) => setToggle(r.key, r.onVal, r.offVal, v)}
                          disabled={!canControl} label={r.label}
                        />
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Whitelist ────────────────────────────────────────────────────────── */}
      {canManageWl && (
        <div className="card space-y-4">
          <SectionHeader>🛡️ Whitelist</SectionHeader>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = wlInput.trim(); if (n) wlAddMut.mutate(n); }}>
            <input
              ref={wlInputRef}
              value={wlInput}
              onChange={(e) => setWlInput(e.target.value)}
              placeholder="Minecraft username"
              className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                         bg-white dark:bg-[#1E2028] text-sm px-3 py-1.5 text-[#1C1E27] dark:text-[#EAECF0]
                         placeholder:text-meta focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" disabled={!wlInput.trim() || wlAddMut.isPending} className="btn-primary text-sm px-4">
              {wlAddMut.isPending ? "Adding…" : "Add"}
            </button>
          </form>
          {wlLoading ? <p className="text-sm text-meta">Loading…</p>
          : !whitelist.length ? <p className="text-sm text-meta italic">No players whitelisted.</p>
          : (
            <ul className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
              {whitelist.map((entry) => (
                <li key={entry.uuid} className="flex items-center justify-between py-2 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <img src={`https://mc-heads.net/avatar/${entry.name}/20`} alt="" className="w-5 h-5 rounded-sm flex-shrink-0" loading="lazy" />
                    <span className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">{entry.name}</span>
                  </div>
                  <button onClick={() => wlRemoveMut.mutate(entry.name)} disabled={wlRemoveMut.isPending}
                    className="text-xs text-[#F87171] hover:text-red-400 transition-colors disabled:opacity-40"
                    aria-label={`Remove ${entry.name} from whitelist`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Player Management ────────────────────────────────────────────────── */}
      {canControl && (
        <div className="card space-y-4">
          <SectionHeader>👥 Player Management</SectionHeader>

          {/* Online players quick-action */}
          {onlinePlayers.length > 0 && (
            <div>
              <p className="text-xs text-meta mb-2">{onlinePlayers.length} online now — click to target</p>
              <div className="flex flex-wrap gap-2">
                {onlinePlayers.map((p) => (
                  <button key={p.ign}
                    onClick={() => setPlayerInput(p.ign)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors
                      ${playerInput === p.ign
                        ? "border-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#5B9BF0]"
                        : "border-[#D9D5D0] dark:border-[#363944] text-[#6B6E78] dark:text-[#A8AEBB] hover:border-[#5B9BF0]"
                      }`}
                  >
                    <img src={`https://mc-heads.net/avatar/${p.ign}/16`} alt="" className="w-4 h-4 rounded-sm" />
                    {p.ign}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={playerInput}
              onChange={(e) => setPlayerInput(e.target.value)}
              placeholder="Player name"
              className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                         bg-white dark:bg-[#1E2028] text-sm px-3 py-1.5 text-[#1C1E27] dark:text-[#EAECF0]
                         placeholder:text-meta focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => playerInput.trim() && kickMut.mutate(playerInput.trim())}
              disabled={!playerInput.trim() || kickMut.isPending}
              className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
              title="Kick from server (they can rejoin)"
            >
              <UserX className="w-3.5 h-3.5" aria-hidden /> Kick
            </button>
            <button
              onClick={() => playerInput.trim() && banMut.mutate({ player: playerInput.trim(), action: "add" })}
              disabled={!playerInput.trim() || banMut.isPending}
              className="btn-danger text-xs flex items-center gap-1.5 disabled:opacity-40"
              title="Ban from server (blocks future joins)"
            >
              <ShieldOff className="w-3.5 h-3.5" aria-hidden /> Ban
            </button>
            <button
              onClick={() => playerInput.trim() && banMut.mutate({ player: playerInput.trim(), action: "remove" })}
              disabled={!playerInput.trim() || banMut.isPending}
              className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
              title="Remove ban"
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Unban
            </button>
            <button
              onClick={() => playerInput.trim() && opMut.mutate({ player: playerInput.trim(), action: "add" })}
              disabled={!playerInput.trim() || opMut.isPending}
              className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
              title="Grant operator permissions"
            >
              <Crown className="w-3.5 h-3.5" aria-hidden /> Op
            </button>
            <button
              onClick={() => playerInput.trim() && opMut.mutate({ player: playerInput.trim(), action: "remove" })}
              disabled={!playerInput.trim() || opMut.isPending}
              className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-40"
              title="Remove operator permissions"
            >
              <CrownIcon className="w-3.5 h-3.5 opacity-50" aria-hidden /> De-op
            </button>
          </div>
        </div>
      )}

      {/* ── Announce ─────────────────────────────────────────────────────────── */}
      {canControl && (
        <div className="card space-y-3">
          <SectionHeader>📣 Announce to All Players</SectionHeader>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const m = announce.trim(); if (m) announceMut.mutate(m); }}>
            <input
              value={announce}
              onChange={(e) => setAnnounce(e.target.value)}
              placeholder="Message to broadcast in chat…"
              className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                         bg-white dark:bg-[#1E2028] text-sm px-3 py-1.5 text-[#1C1E27] dark:text-[#EAECF0]
                         placeholder:text-meta focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
              maxLength={256}
            />
            <button type="submit" disabled={!announce.trim() || announceMut.isPending} className="btn-primary text-sm px-4 flex items-center gap-1.5">
              <Megaphone className="w-4 h-4" aria-hidden />
              {announceMut.isPending ? "Sending…" : "Send"}
            </button>
          </form>
        </div>
      )}

      {/* ── Console ──────────────────────────────────────────────────────────── */}
      {canControl && (
        <div className="card space-y-3">
          <SectionHeader>
            <span className="flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5" aria-hidden />Console</span>
          </SectionHeader>
          <p className="text-xs text-meta">Run any Minecraft command directly. Do not include the leading slash for server-side commands.</p>
          {consoleHistory.length > 0 && (
            <div className="rounded-lg bg-[#1E212B] p-3 font-mono text-xs text-[#A8AEBB] space-y-0.5 max-h-40 overflow-y-auto">
              {consoleHistory.map((line, i) => (
                <p key={i} className="leading-relaxed">{line}</p>
              ))}
            </div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const c = consoleInput.trim(); if (c) consoleMut.mutate(c); }}>
            <span className="flex items-center text-meta font-mono text-sm px-2">/</span>
            <input
              value={consoleInput}
              onChange={(e) => setConsoleInput(e.target.value)}
              placeholder="say Hello world"
              className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                         bg-white dark:bg-[#1E2028] text-sm px-3 py-1.5 font-mono
                         text-[#1C1E27] dark:text-[#EAECF0] placeholder:text-meta
                         focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" disabled={!consoleInput.trim() || consoleMut.isPending} className="btn-secondary text-sm px-4">
              {consoleMut.isPending ? "…" : "Run"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

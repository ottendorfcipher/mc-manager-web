import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { ServerStatus, WhitelistEntry } from "@/types";

const GAMERULES = [
  { key: "reducedDebugInfo",    label: "📍 Show Coordinates", desc: "Players see XYZ in F3 debug screen.", onVal: "false", offVal: "true",  defaultOn: true },
  { key: "keepInventory",       label: "🎒 Keep Inventory",   desc: "Players keep items on death.",        onVal: "true",  offVal: "false", defaultOn: false },
  { key: "doFireTick",          label: "🔥 Fire Spreads",    desc: "Fire can spread to adjacent blocks.",  onVal: "true",  offVal: "false", defaultOn: true },
  { key: "mobGriefing",         label: "💥 Mob Griefing",    desc: "Creepers/Endermen destroy blocks.",    onVal: "true",  offVal: "false", defaultOn: true },
  { key: "doMobSpawning",       label: "👾 Mob Spawning",    desc: "Hostile and passive mobs spawn.",      onVal: "true",  offVal: "false", defaultOn: true },
  { key: "announceAdvancements",label: "🏆 Advancements",   desc: "Chat announces player advancements.",  onVal: "true",  offVal: "false", defaultOn: true },
] as const;

type GameruleKey = (typeof GAMERULES)[number]["key"];

const TIME_PRESETS = [
  { label: "🌅 Sunrise", ticks: 0 },
  { label: "☀️ Day",     ticks: 6000 },
  { label: "🏗️ Sunset",  ticks: 12000 },
  { label: "🌑 Night",   ticks: 18000 },
];

const WEATHER_PRESETS = [
  { label: "☀️ Clear",   kind: "clear",   gif: "/weather/sunny.gif",  poster: "/weather/sunny.png"  },
  { label: "🌧️ Rain",   kind: "rain",    gif: "/weather/rainy.gif",  poster: "/weather/rainy.png"  },
  { label: "⛈️ Thunder", kind: "thunder", gif: "/weather/stormy.gif", poster: "/weather/stormy.png" },
];

/** Human-readable copy for each VM action while its request is in-flight. */
const VM_PROGRESS: Record<string, string> = {
  start: "Starting VM… This takes 1–2 minutes.",
  stop:  "Stopping VM… All player sessions will end.",
  reset: "Resetting VM… The OS is rebooting.",
};

function ActionButton({
  label, onClick, variant = "secondary", disabled,
}: { label: string; onClick: () => void; variant?: "primary" | "secondary" | "danger"; disabled?: boolean }) {
  const cls = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-secondary";
  return (
    <button onClick={onClick} disabled={disabled} className={`${cls} text-sm`}>
      {label}
    </button>
  );
}

/** Default gamerule toggle state derived from the GAMERULES constant. */
function defaultGrState(): Record<string, boolean> {
  return Object.fromEntries(GAMERULES.map((r) => [r.key, r.defaultOn]));
}

/** Map a raw server value string ("true"/"false") to the toggle's `on` boolean. */
function valueToOn(key: GameruleKey, raw: string): boolean {
  const rule = GAMERULES.find((r) => r.key === key);
  if (!rule) return false;
  // Toggle is "on" when the server value equals onVal.
  return raw === rule.onVal;
}

export function ServerPage() {
  const { user, hasPerm } = useAuthStore();
  const qc = useQueryClient();
  const canControl = user?.permissions.can_control_server ?? false;
  const canManageWhitelist = hasPerm("server.whitelist.manage");
  const [statusMsg, setStatusMsg] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [grStates, setGrStates] = useState<Record<string, boolean>>(defaultGrState);
  const [hoveredWeather, setHoveredWeather] = useState<string | null>(null);
  const [wlInput, setWlInput] = useState("");
  const wlInputRef = useRef<HTMLInputElement>(null);

  const { data: whitelist, isLoading: wlLoading } = useQuery<WhitelistEntry[]>({
    queryKey: ["whitelist"],
    queryFn:  () => api.get("/server/whitelist"),
    enabled:  canManageWhitelist,
  });

  const wlAddMut = useMutation({
    mutationFn: (player: string) => api.post("/server/whitelist/add", { player }),
    onSuccess:  (_, player) => {
      setStatusMsg(`✓ ${player} added to whitelist`);
      setWlInput("");
      wlInputRef.current?.focus();
      qc.invalidateQueries({ queryKey: ["whitelist"] });
    },
    onError: (e: Error) => setStatusMsg(`✗ ${e.message}`),
  });

  const wlRemoveMut = useMutation({
    mutationFn: (player: string) => api.post("/server/whitelist/remove", { player }),
    onSuccess:  (_, player) => {
      setStatusMsg(`✓ ${player} removed from whitelist`);
      qc.invalidateQueries({ queryKey: ["whitelist"] });
    },
    onError: (e: Error) => setStatusMsg(`✗ ${e.message}`),
  });

  const { data: serverStatus } = useQuery<ServerStatus>({
    queryKey: ["server-status"],
    queryFn: () => api.get("/server/status"),
    refetchInterval: 15_000,
  });

  // Hydrate gamerule toggles from DB-persisted values on mount.
  useEffect(() => {
    api.get<Record<string, string>>("/world/gamerules")
      .then((data) => {
        setGrStates((prev) => {
          const next = { ...prev };
          for (const rule of GAMERULES) {
            if (data[rule.key] !== undefined) {
              next[rule.key] = valueToOn(rule.key, data[rule.key]);
            }
          }
          return next;
        });
      })
      .catch(() => { /* fall back to hardcoded defaults */ });
  }, []);

  const vmMut = useMutation({
    mutationFn: (action: string) => {
      setPendingAction(action);
      return api.post(`/server/vm/${action}`);
    },
    onSuccess: (_, action) => {
      setStatusMsg(`✓ VM ${action} sent`);
      setPendingAction(null);
      qc.invalidateQueries({ queryKey: ["server-status"] });
    },
    onError: (e: Error) => {
      setStatusMsg(`✗ ${e.message}`);
      setPendingAction(null);
    },
  });

  const grMut = useMutation({
    mutationFn: ({ rule, value }: { rule: string; value: string }) =>
      api.post(`/world/gamerule/${rule}`, { value }),
    onSuccess: (_, { rule, value }) => setStatusMsg(`✓ ${rule} → ${value}`),
    onError: (e: Error) => setStatusMsg(`✗ ${e.message}`),
  });

  const timeMut = useMutation({
    mutationFn: (ticks: number) => api.post("/world/time", { ticks }),
    onSuccess: (_, t) => setStatusMsg(`✓ Time set to ${t}`),
    onError: (e: Error) => setStatusMsg(`✗ ${e.message}`),
  });

  const wxMut = useMutation({
    mutationFn: (kind: string) => api.post("/world/weather", { kind }),
    onSuccess: (_, k) => setStatusMsg(`✓ Weather: ${k}`),
    onError: (e: Error) => setStatusMsg(`✗ ${e.message}`),
  });

  function toggleGr(key: string, rule: string, onVal: string, offVal: string) {
    const next = !grStates[key];
    setGrStates((p) => ({ ...p, [key]: next }));
    grMut.mutate({ rule, value: next ? onVal : offVal });
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Server Control</h1>
          <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0] mt-0.5">Manage the VM and world settings</p>
        </div>
        {statusMsg && (
          <span className="text-xs px-2 py-1 rounded bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#9BA0B0]">
            {statusMsg}
          </span>
        )}
      </div>

      {/* VM Status */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#9B9EA6]">Server (Hetzner)</p>
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          Stop ends all player sessions but preserves the world. Force Reset restarts the Minecraft process — use only if the server is unresponsive.
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          {canControl && (
            <>
              <ActionButton
                label="▶ Start VM"
                onClick={() => vmMut.mutate("start")}
                variant="primary"
                disabled={vmMut.isPending}
              />
              <ActionButton
                label="■ Stop VM"
                onClick={() => vmMut.mutate("stop")}
                variant="danger"
                disabled={vmMut.isPending}
              />
              <ActionButton
                label="↺ Force Reset"
                onClick={() => vmMut.mutate("reset")}
                disabled={vmMut.isPending}
              />
            </>
          )}
          <span className="text-xs text-[#9B9EA6]">
            Status: {serverStatus?.vm.status ?? "…"}
          </span>
        </div>

        {/* In-progress indicator */}
        {vmMut.isPending && pendingAction && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-[#5B9BF0]">
              <div className="w-3.5 h-3.5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin flex-shrink-0" />
              {VM_PROGRESS[pendingAction] ?? `VM ${pendingAction} in progress…`}
            </div>
            {/* Indeterminate progress bar */}
            <div className="h-1 w-full rounded-full bg-[#E5E2DE] dark:bg-[#363944] overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-[#5B9BF0] animate-[progress_1.4s_ease-in-out_infinite]" />
            </div>
          </div>
        )}
      </div>

      {/* Whitelist */}
      {canManageWhitelist && (
        <div className="card space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#9B9EA6]">🛡️ Whitelist</p>

          {/* Add player */}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const name = wlInput.trim();
              if (name) wlAddMut.mutate(name);
            }}
          >
            <input
              ref={wlInputRef}
              value={wlInput}
              onChange={(e) => setWlInput(e.target.value)}
              placeholder="Minecraft username"
              className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                         bg-white dark:bg-[#1E2028] text-sm px-3 py-1.5
                         text-[#1C1E27] dark:text-[#EAECF0]
                         placeholder:text-[#9B9EA6]
                         focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
              aria-label="Player username to whitelist"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={!wlInput.trim() || wlAddMut.isPending}
              className="btn-primary text-sm px-4"
            >
              {wlAddMut.isPending ? "Adding…" : "Add"}
            </button>
          </form>

          {/* Current list */}
          {wlLoading ? (
            <p className="text-sm text-[#9B9EA6]">Loading…</p>
          ) : !whitelist?.length ? (
            <p className="text-sm text-[#9B9EA6] italic">No players whitelisted.</p>
          ) : (
            <ul className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
              {whitelist.map((entry) => (
                <li key={entry.uuid} className="flex items-center justify-between py-2 gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <img
                      src={`https://mc-heads.net/avatar/${entry.name}/20`}
                      alt=""
                      className="w-5 h-5 rounded-sm flex-shrink-0"
                      loading="lazy"
                    />
                    <span className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                      {entry.name}
                    </span>
                  </div>
                  <button
                    onClick={() => wlRemoveMut.mutate(entry.name)}
                    disabled={wlRemoveMut.isPending}
                    className="text-xs text-[#F87171] hover:text-red-400 transition-colors flex-shrink-0
                               disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label={`Remove ${entry.name} from whitelist`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* World Settings */}
      <div className="card space-y-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#9B9EA6]">🎮 World Settings</p>

        {/* Time of Day */}
        <div>
          <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] mb-2">⏰ Time of Day</p>
          <div className="grid grid-cols-4 gap-2">
            {TIME_PRESETS.map(({ label, ticks }) => (
              <button key={label} disabled={!canControl}
                onClick={() => timeMut.mutate(ticks)}
                className="btn-secondary text-xs py-2 text-center">
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Weather */}
        <div>
          <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] mb-2">🌤️ Weather</p>
          <div className="grid grid-cols-3 gap-3">
            {WEATHER_PRESETS.map(({ label, kind, gif, poster }) => (
              <button
                key={kind}
                disabled={!canControl}
                onClick={() => wxMut.mutate(kind)}
                onMouseEnter={() => setHoveredWeather(kind)}
                onMouseLeave={() => setHoveredWeather(null)}
                style={{
                  backgroundImage: `url('${hoveredWeather === kind ? gif : poster}')`,
                }}
                className="relative h-28 rounded-xl overflow-hidden bg-cover bg-center
                           border-2 border-transparent hover:border-[#5B9BF0]
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B9BF0]
                           transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {/* gradient so text is legible over any background */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <span className="absolute bottom-2.5 left-0 right-0 text-center text-white text-xs font-semibold drop-shadow-md">
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Gamerule toggles */}
        <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
          {GAMERULES.map(({ key, label, desc, onVal, offVal }) => (
            <div key={key} className="flex items-center gap-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0]">{label}</p>
                <p className="text-xs text-[#9B9EA6]">{desc}</p>
              </div>
              <button
                role="switch"
                aria-checked={grStates[key]}
                disabled={!canControl}
                onClick={() => toggleGr(key, key, onVal, offVal)}
                className={`relative inline-flex h-5 w-9 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[#5B9BF0] ${
                  grStates[key] ? "bg-[#5B9BF0]" : "bg-[#D9D5D0] dark:bg-[#363944]"
                } disabled:opacity-50`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow translate-y-0.5 transition-transform ${
                  grStates[key] ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

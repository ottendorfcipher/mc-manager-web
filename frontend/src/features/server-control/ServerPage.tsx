import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { ServerStatus } from "@/types";

const GAMERULES = [
  { key: "reducedDebugInfo",    label: "📍 Show Coordinates", desc: "Players see XYZ in F3 debug screen.", onVal: "false", offVal: "true", defaultOn: true },
  { key: "keepInventory",       label: "🎒 Keep Inventory",   desc: "Players keep items on death.",        onVal: "true",  offVal: "false", defaultOn: false },
  { key: "doFireTick",          label: "🔥 Fire Spreads",    desc: "Fire can spread to adjacent blocks.",  onVal: "true",  offVal: "false", defaultOn: true },
  { key: "mobGriefing",         label: "💥 Mob Griefing",    desc: "Creepers/Endermen destroy blocks.",    onVal: "true",  offVal: "false", defaultOn: true },
  { key: "doMobSpawning",       label: "👾 Mob Spawning",    desc: "Hostile and passive mobs spawn.",      onVal: "true",  offVal: "false", defaultOn: true },
  { key: "announceAdvancements",label: "🏆 Advancements",   desc: "Chat announces player advancements.",  onVal: "true",  offVal: "false", defaultOn: true },
] as const;

const TIME_PRESETS = [
  { label: "🌅 Sunrise", ticks: 0 },
  { label: "☀️ Day",    ticks: 6000 },
  { label: "🌇 Sunset", ticks: 12000 },
  { label: "🌑 Night",  ticks: 18000 },
];

const WEATHER_PRESETS = [
  { label: "☀️ Clear",   kind: "clear" },
  { label: "🌧️ Rain",   kind: "rain" },
  { label: "⛈️ Thunder", kind: "thunder" },
];

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

export function ServerPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const canControl = user?.permissions.can_control_server ?? false;
  const [status, setStatus] = useState("");
  const [grStates, setGrStates] = useState<Record<string, boolean>>(
    Object.fromEntries(GAMERULES.map((r) => [r.key, r.defaultOn]))
  );

  const { data: serverStatus } = useQuery<ServerStatus>({
    queryKey: ["server-status"],
    queryFn: () => api.get("/server/status"),
    refetchInterval: 15_000,
  });

  const vmMut = useMutation({
    mutationFn: (action: string) => api.post(`/server/vm/${action}`),
    onSuccess: (_, action) => { setStatus(`✓ VM ${action} sent`); qc.invalidateQueries({ queryKey: ["server-status"] }); },
    onError: (e: Error) => setStatus(`✗ ${e.message}`),
  });

  const svcMut = useMutation({
    mutationFn: (action: string) => api.post(`/server/service/${action}`),
    onSuccess: (_, action) => { setStatus(`✓ Service ${action} OK`); },
    onError: (e: Error) => setStatus(`✗ ${e.message}`),
  });

  const grMut = useMutation({
    mutationFn: ({ rule, value }: { rule: string; value: string }) =>
      api.post(`/world/gamerule/${rule}`, { value }),
    onSuccess: (_, { rule, value }) => setStatus(`✓ ${rule} → ${value}`),
    onError: (e: Error) => setStatus(`✗ ${e.message}`),
  });

  const timeMut = useMutation({
    mutationFn: (ticks: number) => api.post("/world/time", { ticks }),
    onSuccess: (_, t) => setStatus(`✓ Time set to ${t}`),
    onError: (e: Error) => setStatus(`✗ ${e.message}`),
  });

  const wxMut = useMutation({
    mutationFn: (kind: string) => api.post("/world/weather", { kind }),
    onSuccess: (_, k) => setStatus(`✓ Weather: ${k}`),
    onError: (e: Error) => setStatus(`✗ ${e.message}`),
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
          <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0] mt-0.5">Manage the VM, service, and world settings</p>
        </div>
        {status && <span className="text-xs px-2 py-1 rounded bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#9BA0B0]">{status}</span>}
      </div>

      {/* VM Status */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#9B9EA6]">Cloud VM (GCP Spot)</p>
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          Stopping ends all player sessions but preserves the world. Force Reset reboots the OS — use only if the VM is unresponsive.
        </p>
        <div className="flex gap-2 flex-wrap">
          {canControl && <>
            <ActionButton label="▶ Start VM"    onClick={() => vmMut.mutate("start")} variant="primary" />
            <ActionButton label="■ Stop VM"     onClick={() => vmMut.mutate("stop")}  variant="danger" />
            <ActionButton label="↺ Force Reset" onClick={() => vmMut.mutate("reset")} />
          </>}
          <span className="self-center text-xs text-[#9B9EA6]">
            VM: {serverStatus?.vm.status ?? "…"} · Service: {serverStatus?.service ?? "…"}
          </span>
        </div>
      </div>

      {/* Minecraft service */}
      <div className="card space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#9B9EA6]">Minecraft Game Process</p>
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          Restart the Java process after changing settings — faster than rebooting the VM.
        </p>
        {canControl && (
          <div className="flex gap-2 flex-wrap">
            <ActionButton label="▶ Start Game"   onClick={() => svcMut.mutate("start")}   variant="primary" />
            <ActionButton label="■ Stop Game"    onClick={() => svcMut.mutate("stop")}    variant="danger" />
            <ActionButton label="↺ Restart Game" onClick={() => svcMut.mutate("restart")} />
          </div>
        )}
      </div>

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
          <div className="grid grid-cols-3 gap-2">
            {WEATHER_PRESETS.map(({ label, kind }) => (
              <button key={label} disabled={!canControl}
                onClick={() => wxMut.mutate(kind)}
                className="btn-secondary text-xs py-2 text-center">
                {label}
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

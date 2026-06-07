/**
 * Scheduled jobs — cron-style automations.
 *
 * Tick every minute on the server.  Fires due jobs and records last status
 * + next fire time so admins can see what's coming up.
 *
 * Action types:
 *   console   — send any raw console command
 *   announce  — tellraw all players
 *   discord   — post a message via the Discord webhook
 *   backup    — create a world backup
 *   countdown — start an existing pending countdown
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Clock, Plus, Trash2, Play, Power, AlertCircle, CheckCircle2,
} from "lucide-react";
import { api } from "@/api/client";
import type { ScheduledJob } from "@/types";

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
  "disabled:opacity-50",
].join(" ");
const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

const PRESETS: { label: string; cron: string }[] = [
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "Hourly at :00",    cron: "0 * * * *"    },
  { label: "Daily at 3am UTC", cron: "0 3 * * *"    },
  { label: "Weekly Fri 8pm UTC", cron: "0 20 * * 5" },
];

const ACTION_LABELS: Record<string, string> = {
  console:   "Console command",
  announce:  "Announce in chat",
  discord:   "Discord message",
  backup:    "Backup world",
  countdown: "Start countdown",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AutomationsPage() {
  const qc = useQueryClient();
  const { data: jobs = [] } = useQuery<ScheduledJob[]>({
    queryKey: ["scheduled-jobs"],
    queryFn:  () => api.get("/scheduled-jobs"),
    refetchInterval: 30_000,
  });

  const [creating, setCreating] = useState(false);

  const createMut = useMutation({
    mutationFn: (body: JobBody) => api.post("/scheduled-jobs", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-jobs"] });
      setCreating(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/scheduled-jobs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-jobs"] }),
  });

  const toggleMut = useMutation({
    mutationFn: (j: ScheduledJob) =>
      api.patch(`/scheduled-jobs/${j.id}`, {
        name: j.name, cron_expr: j.cron_expr, action_type: j.action_type,
        action_payload: JSON.parse(j.action_payload || "{}"),
        enabled: j.enabled !== 1,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-jobs"] }),
  });

  const runMut = useMutation({
    mutationFn: (id: number) => api.post(`/scheduled-jobs/${id}/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled-jobs"] }),
  });

  return (
    <div className="page-wide space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Automations</h1>
          <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
            Cron-style scheduled jobs — run console commands, announce, backup, or start countdowns on a schedule.
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> New job
          </button>
        )}
      </div>

      {creating && (
        <JobForm
          loading={createMut.isPending}
          onCancel={() => setCreating(false)}
          onSubmit={(b) => createMut.mutate(b)}
        />
      )}

      <div className="space-y-2">
        {jobs.length === 0 && !creating && (
          <p className="text-xs text-meta italic py-2 text-center">
            No scheduled jobs. Click <em>New job</em> to create one.
          </p>
        )}
        {jobs.map((j) => (
          <JobCard
            key={j.id}
            job={j}
            running={runMut.isPending && runMut.variables === j.id}
            onToggle={() => toggleMut.mutate(j)}
            onRun={() => runMut.mutate(j.id)}
            onDelete={() => { if (confirm(`Delete job "${j.name}"?`)) deleteMut.mutate(j.id); }}
          />
        ))}
      </div>
    </div>
  );
}

// ── JobCard ───────────────────────────────────────────────────────────────────

function JobCard({
  job, running, onToggle, onRun, onDelete,
}: {
  job:      ScheduledJob;
  running:  boolean;
  onToggle: () => void;
  onRun:    () => void;
  onDelete: () => void;
}) {
  const enabled = job.enabled === 1;
  const lastWasError = job.last_status?.startsWith("error:");
  let payload = "";
  try { payload = JSON.stringify(JSON.parse(job.action_payload), null, 0); } catch { payload = job.action_payload; }

  return (
    <div className={`card ${enabled ? "" : "opacity-60"} space-y-2`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Clock className="w-4 h-4 text-[#5B9BF0]" />
            <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
              {job.name}
            </span>
            {!enabled && <span className="text-[10px] uppercase tracking-wider text-meta">disabled</span>}
          </div>
          <p className="text-[11px] text-meta mt-0.5">
            <code className="font-mono">{job.cron_expr}</code>
            {" · "}
            {ACTION_LABELS[job.action_type] ?? job.action_type}
            {" · "}
            <code className="font-mono text-[10px]">{payload}</code>
          </p>
          <p className="text-[10px] text-meta">
            next: <span className="font-mono">{fmtTime(job.next_fire_at)}</span>
            {job.last_fire_at && (
              <>
                {" · "}last: <span className="font-mono">{fmtTime(job.last_fire_at)}</span>
                {" "}
                {lastWasError ? (
                  <span className="inline-flex items-center gap-0.5 text-[#EF4444]">
                    <AlertCircle className="w-3 h-3" />
                    <span className="truncate max-w-md">{job.last_status}</span>
                  </span>
                ) : (
                  <CheckCircle2 className="w-3 h-3 inline text-[#22C55E]" />
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onRun}
            disabled={running}
            title="Run now"
            className="btn-secondary text-xs flex items-center gap-1"
          >
            <Play className="w-3 h-3" /> Run
          </button>
          <button
            onClick={onToggle}
            title={enabled ? "Disable" : "Enable"}
            className="p-1 rounded text-meta hover:text-[#5B9BF0] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F]/30"
          >
            <Power className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="p-1 rounded text-meta hover:text-[#EF4444] hover:bg-[#FEE2E2] dark:hover:bg-[#7F1D1D]/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── JobForm ───────────────────────────────────────────────────────────────────

interface JobBody {
  name:           string;
  cron_expr:      string;
  action_type:    ScheduledJob["action_type"];
  action_payload: Record<string, unknown>;
}

function JobForm({
  loading, onSubmit, onCancel,
}: {
  loading:  boolean;
  onSubmit: (body: JobBody) => void;
  onCancel: () => void;
}) {
  const [name, setName]               = useState("");
  const [cron, setCron]               = useState("*/15 * * * *");
  const [action, setAction]           = useState<ScheduledJob["action_type"]>("console");
  // Action-specific inputs
  const [consoleCmd, setConsoleCmd]   = useState("weather clear");
  const [announceText, setAnnounceText] = useState("Server announcement");
  const [discordMsg, setDiscordMsg]   = useState("Hello from the bot");
  const [backupSlug, setBackupSlug]   = useState("");
  const [countdownId, setCountdownId] = useState<number | "">("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const payload: Record<string, unknown> = (() => {
      switch (action) {
        case "console":   return { command: consoleCmd };
        case "announce":  return { text:    announceText };
        case "discord":   return { message: discordMsg };
        case "backup":    return backupSlug ? { world_slug: backupSlug } : {};
        case "countdown": return countdownId === "" ? {} : { countdown_id: countdownId };
      }
    })();
    onSubmit({
      name:           name.trim(),
      cron_expr:      cron.trim(),
      action_type:    action,
      action_payload: payload,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-3">
      <h3 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">New scheduled job</h3>

      <div>
        <label className={LBL}>Name</label>
        <input
          type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60} placeholder="e.g. Friday night build battle"
          className={`${INPUT} w-full`}
        />
      </div>

      <div>
        <label className={LBL}>Schedule (cron)</label>
        <div className="flex items-center gap-1 flex-wrap mb-1.5">
          {PRESETS.map((p) => (
            <button key={p.cron} type="button"
              onClick={() => setCron(p.cron)}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                cron === p.cron
                  ? "border-[#5B9BF0] text-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F]/30"
                  : "border-[#D9D5D0] dark:border-[#363944] text-meta hover:border-[#9B9EA6]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="text" value={cron}
          onChange={(e) => setCron(e.target.value)}
          className={`${INPUT} w-full font-mono`}
        />
        <p className="text-[10px] text-meta mt-0.5">
          Format: <code>M H D M W</code> in UTC. Sunday=0. Supports <code>*</code>, <code>N</code>,{" "}
          <code>N,N</code>, <code>N-N</code>, <code>*/N</code>.
        </p>
      </div>

      <div>
        <label className={LBL}>Action</label>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as ScheduledJob["action_type"])}
          className={`${INPUT} w-full`}
        >
          {Object.entries(ACTION_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>

      {/* Action-specific inputs */}
      {action === "console" && (
        <div>
          <label className={LBL}>Console command</label>
          <input
            type="text" value={consoleCmd}
            onChange={(e) => setConsoleCmd(e.target.value)}
            placeholder="e.g. weather clear"
            className={`${INPUT} w-full font-mono`}
          />
        </div>
      )}
      {action === "announce" && (
        <div>
          <label className={LBL}>Announcement text</label>
          <input
            type="text" value={announceText}
            onChange={(e) => setAnnounceText(e.target.value)}
            className={`${INPUT} w-full`}
          />
        </div>
      )}
      {action === "discord" && (
        <div>
          <label className={LBL}>Discord message</label>
          <input
            type="text" value={discordMsg}
            onChange={(e) => setDiscordMsg(e.target.value)}
            className={`${INPUT} w-full`}
          />
        </div>
      )}
      {action === "backup" && (
        <div>
          <label className={LBL}>World slug (blank = active world)</label>
          <input
            type="text" value={backupSlug}
            onChange={(e) => setBackupSlug(e.target.value)}
            placeholder="e.g. survival"
            className={`${INPUT} w-full font-mono`}
          />
        </div>
      )}
      {action === "countdown" && (
        <div>
          <label className={LBL}>Pending countdown ID</label>
          <input
            type="number" min={1} value={countdownId}
            onChange={(e) => setCountdownId(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="e.g. 42"
            className={`${INPUT} w-full`}
          />
          <p className="text-[10px] text-meta mt-0.5">
            The countdown must already exist (create it in Events → Countdowns first).
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">Cancel</button>
        <button type="submit" disabled={!name.trim() || loading} className="btn-primary text-xs">
          Create job
        </button>
      </div>
    </form>
  );
}

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, CheckCircle, AlertCircle, Loader2, RotateCcw, Zap } from "lucide-react";
import { PLUGIN_VOCAB, jobStateLabel, isTerminalState } from "./vocab";
import type { JobState } from "./vocab";

const API = "/api";

interface PluginJob {
  id:             number;
  kind:           string;
  project_key:    string | null;
  state:          JobState;
  state_detail:   string | null;
  plan_json:      string | null;
  requested_by:   string;
  requested_at:   string;
  finished_at:    string | null;
}

interface InstallFlowProps {
  projectKey: string;
  onClose:    () => void;
}

const PIPELINE_STEPS: JobState[] = [
  "resolving",
  "backing_up",
  "downloading",
  "uploading",
  "restart_pending",
  "verifying",
];

function stepIndex(state: JobState): number {
  return PIPELINE_STEPS.indexOf(state);
}

async function startInstall(projectKey: string, autoRestart: boolean): Promise<{ job_id: number }> {
  const resp = await fetch(`${API}/plugins/install`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      project_key:  projectKey,
      auto_restart: autoRestart,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Install failed");
  }
  return resp.json();
}

async function triggerRestart(): Promise<void> {
  const resp = await fetch(`${API}/plugins/restart`, { method: "POST" });
  if (!resp.ok) throw new Error("Failed to trigger restart");
}

function StepList({ currentState }: { currentState: JobState }) {
  const current = stepIndex(currentState);
  return (
    <ol className="space-y-2">
      {PIPELINE_STEPS.map((step, i) => {
        const done    = i < current;
        const active  = i === current;
        const pending = i > current;

        return (
          <li key={step} className={`flex items-center gap-3 text-sm ${pending ? "text-meta" : ""}`}>
            {done ? (
              <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" aria-hidden />
            ) : active ? (
              <Loader2 className="w-4 h-4 text-[#5B9BF0] animate-spin flex-shrink-0" aria-hidden />
            ) : (
              <div className="w-4 h-4 rounded-full border-2 border-[#D9D5D0] dark:border-[#363944] flex-shrink-0" />
            )}
            <span className={active ? "text-[#1C1E27] dark:text-[#EAECF0] font-medium" : ""}>
              {jobStateLabel(step)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function InstallFlow({ projectKey, onClose }: InstallFlowProps) {
  const qc = useQueryClient();
  const [jobId, setJobId]           = useState<number | null>(null);
  const [autoRestart, setAutoRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const installMut = useMutation({
    mutationFn: () => startInstall(projectKey, autoRestart),
    onSuccess:  (data) => setJobId(data.job_id),
  });

  const { data: job } = useQuery<PluginJob>({
    queryKey:       ["plugins/jobs", jobId],
    queryFn:        async () => {
      const resp = await fetch(`${API}/plugins/jobs/${jobId}`);
      if (!resp.ok) throw new Error("Failed to fetch job");
      return resp.json();
    },
    enabled:        !!jobId,
    refetchInterval: (query) => {
      const state = (query.state.data as PluginJob | undefined)?.state;
      if (!state || isTerminalState(state) || state === "restart_pending") return false;
      return 1000;
    },
  });

  async function handleRestart() {
    setRestarting(true);
    try {
      await triggerRestart();
      await qc.invalidateQueries({ queryKey: ["plugins/jobs", jobId] });
    } finally {
      setRestarting(false);
    }
  }

  const isLoading = installMut.isPending;
  const state     = job?.state ?? null;
  const failed    = state === "failed";
  const done      = state === "done";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        aria-hidden
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to server"
        className="fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-[#1C1E27] rounded-t-2xl shadow-2xl
                   max-w-lg mx-auto px-5 pt-5 pb-8 modal-enter"
      >
        {/* Drag handle */}
        <div className="w-10 h-1 bg-[#D9D5D0] dark:bg-[#363944] rounded-full mx-auto mb-4" />

        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            {done ? "All done!" : failed ? "Something went wrong" : "Adding to server"}
          </h2>
          <button
            onClick={onClose}
            className="icon-btn"
            aria-label="Close"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        {/* Pre-start */}
        {!jobId && !isLoading && (
          <div className="space-y-4">
            <p className="text-sm text-meta">
              We'll save a safety copy of your server first, then add the add-on.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRestart}
                onChange={(e) => setAutoRestart(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                Restart server automatically when ready
              </span>
            </label>
            {installMut.error && (
              <p className="text-sm text-[#F87171]">
                {(installMut.error as Error).message}
              </p>
            )}
            <button
              onClick={() => installMut.mutate()}
              className="btn-primary w-full"
            >
              Add to server
            </button>
          </div>
        )}

        {/* In progress */}
        {jobId && !done && !failed && state !== "restart_pending" && (
          <StepList currentState={state ?? "resolving"} />
        )}

        {/* Restart pending */}
        {state === "restart_pending" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0]">
                  {PLUGIN_VOCAB.restart_pending}
                </p>
                <p className="text-xs text-meta mt-1">
                  Your players will be briefly disconnected while the server restarts.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRestart}
                disabled={restarting}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {restarting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                {PLUGIN_VOCAB.restart}
              </button>
              <button onClick={onClose} className="btn-secondary flex-1">
                {PLUGIN_VOCAB.restart_later}
              </button>
            </div>
          </div>
        )}

        {/* Done */}
        {done && (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle className="w-12 h-12 text-emerald-500" aria-hidden />
            <p className="text-sm text-center text-meta">
              The add-on is installed and running on your server.
            </p>
            <button onClick={() => { qc.invalidateQueries({ queryKey: ["plugins/installed"] }); onClose(); }} className="btn-primary">
              Done
            </button>
          </div>
        )}

        {/* Failed */}
        {failed && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#F87171] flex-shrink-0 mt-0.5" aria-hidden />
              <div>
                <p className="text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                  Something went wrong while adding this add-on.
                </p>
                {job?.state_detail && (
                  <p className="text-xs text-meta mt-1">{job.state_detail}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setJobId(null); installMut.reset(); }}
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" aria-hidden />
                Try again
              </button>
              <button onClick={onClose} className="btn-secondary flex-1">
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Loading spinner before jobId */}
        {isLoading && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-6 h-6 text-[#5B9BF0] animate-spin" aria-label="Starting install" />
          </div>
        )}
      </div>
    </>
  );
}

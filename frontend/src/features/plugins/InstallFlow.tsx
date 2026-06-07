import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, CheckCircle, AlertCircle, Loader2, RotateCcw, Zap, Package, AlertTriangle } from "lucide-react";
import { api } from "@/api/client";
import { PLUGIN_VOCAB, jobStateLabel, isTerminalState } from "./vocab";
import type { JobState } from "./vocab";

// ── Types ─────────────────────────────────────────────────────────────────────

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

interface DepInfo {
  project_id:   string;
  title:        string;
  is_installed: boolean;
}

interface ConflictInfo {
  project_id: string;
  title:      string;
}

interface DependencyPreview {
  missing_deps:   DepInfo[];
  satisfied_deps: DepInfo[];
  conflicts:      ConflictInfo[];
  can_install:    boolean;
  version:        string | null;
}

interface InstallFlowProps {
  projectKey:  string;
  pluginTitle?: string;
  onClose:     () => void;
}

// ── Pipeline steps (shown as animated checklist) ─────────────────────────────

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

// ── API helpers ───────────────────────────────────────────────────────────────

const startInstall = (projectKey: string, autoRestart: boolean): Promise<{ job_id: number }> =>
  api.post("/plugins/install", { project_key: projectKey, auto_restart: autoRestart });

const triggerRestart = (): Promise<unknown> => api.post("/plugins/restart", {});

// ── Main component ────────────────────────────────────────────────────────────

type Screen =
  | "preview"       // fetching + showing dep preview
  | "confirm_deps"  // user sees deps + must confirm
  | "conflict"      // blocking conflict — can't install
  | "installing"    // job running
  | "restart"       // waiting for restart decision
  | "done"
  | "failed";

export function InstallFlow({ projectKey, pluginTitle, onClose }: InstallFlowProps) {
  const qc = useQueryClient();
  const [screen,      setScreen]      = useState<Screen>("preview");
  const [jobId,       setJobId]       = useState<number | null>(null);
  const [autoRestart, setAutoRestart] = useState(false);
  const [restarting,  setRestarting]  = useState(false);

  // ── Fetch dependency preview ────────────────────────────────────────────────
  const { data: preview, isLoading: previewLoading } = useQuery<DependencyPreview>({
    queryKey: ["plugins/preview", projectKey],
    queryFn:  () => api.get(`/plugins/preview/${encodeURIComponent(projectKey)}`),
    staleTime: 60_000,
  });

  // TanStack Query v5 removed the query `onSuccess` callback — advance the
  // screen from a `useEffect` instead. Only auto-advance from the initial
  // "preview" screen so we never clobber a later step.
  useEffect(() => {
    if (!preview) return;
    setScreen((s) =>
      s === "preview" ? (preview.conflicts.length > 0 ? "conflict" : "confirm_deps") : s,
    );
  }, [preview]);

  // ── Start install job ───────────────────────────────────────────────────────
  const installMut = useMutation({
    mutationFn: () => startInstall(projectKey, autoRestart),
    onSuccess: (data) => {
      setJobId(data.job_id);
      setScreen("installing");
    },
  });

  // ── Poll job ────────────────────────────────────────────────────────────────
  const { data: job } = useQuery<PluginJob>({
    queryKey:  ["plugins/jobs", jobId],
    queryFn:   () => api.get(`/plugins/jobs/${jobId}`),
    enabled:   !!jobId,
    refetchInterval: (query) => {
      const state = (query.state.data as PluginJob | undefined)?.state;
      if (!state || isTerminalState(state) || state === "restart_pending") return false;
      return 1000;
    },
  });

  // v5: react to job-state transitions in an effect (no query onSuccess).
  useEffect(() => {
    if (!job) return;
    if (job.state === "done")                  setScreen("done");
    else if (job.state === "failed")           setScreen("failed");
    else if (job.state === "restart_pending")  setScreen("restart");
  }, [job]);

  async function handleRestart() {
    setRestarting(true);
    try {
      await triggerRestart();
      await qc.invalidateQueries({ queryKey: ["plugins/jobs", jobId] });
    } finally {
      setRestarting(false);
    }
  }

  const title = pluginTitle ?? projectKey.replace("modrinth:", "");

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to server"
        className="fixed inset-x-0 bottom-0 z-50 bg-white dark:bg-[#1C1E27] rounded-t-2xl shadow-2xl
                   max-w-lg mx-auto px-5 pt-5 pb-8 modal-enter"
      >
        <div className="w-10 h-1 bg-[#D9D5D0] dark:bg-[#363944] rounded-full mx-auto mb-4" />

        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-[#1C1E27] dark:text-[#EAECF0] truncate pr-4">
            {screen === "done"     ? "All done!"
           : screen === "failed"   ? "Something went wrong"
           : screen === "conflict" ? "Can't install"
           : title}
          </h2>
          <button onClick={onClose} className="icon-btn flex-shrink-0" aria-label="Close">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        {/* ── Preview loading ──────────────────────────────────────────────── */}
        {screen === "preview" && previewLoading && (
          <div className="space-y-3 py-2">
            {["Checking compatibility…", "Finding required helpers…", "Checking for conflicts…"].map((s) => (
              <div key={s} className="flex items-center gap-3 text-sm text-meta">
                <Loader2 className="w-4 h-4 text-[#5B9BF0] animate-spin flex-shrink-0" aria-hidden />
                {s}
              </div>
            ))}
          </div>
        )}

        {/* ── Conflict — blocking ──────────────────────────────────────────── */}
        {screen === "conflict" && preview && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#F87171] flex-shrink-0 mt-0.5" aria-hidden />
              <p className="text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                <span className="font-semibold">{title}</span>{" "}
                {PLUGIN_VOCAB.incompatible_with}:
              </p>
            </div>
            <ul className="space-y-1 ml-8">
              {preview.conflicts.map((c) => (
                <li key={c.project_id} className="flex items-center gap-2 text-sm">
                  <AlertCircle className="w-3.5 h-3.5 text-[#F87171]" aria-hidden />
                  <span className="font-medium text-[#1C1E27] dark:text-[#EAECF0]">{c.title}</span>
                  <span className="text-meta text-xs">is already installed</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-meta">
              Remove the conflicting plugin(s) first, then try again.
            </p>
            <button onClick={onClose} className="btn-secondary w-full">Close</button>
          </div>
        )}

        {/* ── Dependency confirmation ──────────────────────────────────────── */}
        {screen === "confirm_deps" && preview && (
          <div className="space-y-4">
            {/* Missing deps that will be auto-installed */}
            {preview.missing_deps.length > 0 && (
              <div className="rounded-lg bg-[#EFF6FF] dark:bg-[#1E3A5F] p-3 space-y-2">
                <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0]">
                  This also needs {preview.missing_deps.length === 1
                    ? "1 required helper"
                    : `${preview.missing_deps.length} required helpers`}{" "}
                  — we'll install them too:
                </p>
                <ul className="space-y-1.5">
                  {preview.missing_deps.map((dep) => (
                    <li key={dep.project_id} className="flex items-center gap-2 text-sm">
                      <Package className="w-3.5 h-3.5 text-[#5B9BF0] flex-shrink-0" aria-hidden />
                      <span className="font-medium text-[#1C1E27] dark:text-[#EAECF0]">
                        {dep.title}
                      </span>
                      <span className="text-meta text-xs">{PLUGIN_VOCAB.dependency}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Already-satisfied deps (informational) */}
            {preview.satisfied_deps.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-meta font-medium uppercase tracking-wider">
                  Already installed
                </p>
                <ul className="space-y-1">
                  {preview.satisfied_deps.map((dep) => (
                    <li key={dep.project_id} className="flex items-center gap-2 text-sm text-meta">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" aria-hidden />
                      {dep.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* No deps at all */}
            {preview.missing_deps.length === 0 && preview.satisfied_deps.length === 0 && (
              <p className="text-sm text-meta">
                No required helpers — this plugin is self-contained.
                We'll save a safety copy of your server first.
              </p>
            )}

            {/* Version */}
            {preview.version && (
              <p className="text-xs text-meta">
                Version to install: <span className="font-mono">{preview.version}</span>
              </p>
            )}

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

            <div className="flex gap-2">
              <button
                onClick={() => installMut.mutate()}
                disabled={installMut.isPending}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {installMut.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                )}
                {preview.missing_deps.length > 0
                  ? `Install ${preview.missing_deps.length + 1} plugins`
                  : "Add to server"}
              </button>
              <button onClick={onClose} className="btn-secondary">Cancel</button>
            </div>
          </div>
        )}

        {/* ── Installing (pipeline progress) ──────────────────────────────── */}
        {screen === "installing" && (
          <StepList currentState={job?.state ?? "resolving"} />
        )}

        {/* ── Restart pending ──────────────────────────────────────────────── */}
        {screen === "restart" && (
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

        {/* ── Done ─────────────────────────────────────────────────────────── */}
        {screen === "done" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle className="w-12 h-12 text-emerald-500" aria-hidden />
            <p className="text-sm text-center text-meta">
              {title} is installed and running on your server.
            </p>
            <button
              onClick={() => {
                qc.invalidateQueries({ queryKey: ["plugins/installed"] });
                onClose();
              }}
              className="btn-primary"
            >
              Done
            </button>
          </div>
        )}

        {/* ── Failed ───────────────────────────────────────────────────────── */}
        {screen === "failed" && (
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
                onClick={() => {
                  setJobId(null);
                  installMut.reset();
                  setScreen("confirm_deps");
                }}
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" aria-hidden />
                Try again
              </button>
              <button onClick={onClose} className="btn-secondary flex-1">Dismiss</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export const PLUGIN_VOCAB = {
  // Concept → User-facing word(s)
  loader:             null as null,
  dependency:         "required helper",
  also_depends:       "also needs",
  incompatible:       "doesn't work alongside",
  api_version_newer:  "built for a newer version of Minecraft than your server",
  not_tagged_current: "made for an older version — might work, might have hiccups",

  // Status → Badge text
  running:     "Running",
  errored:     "Errored — view details",
  not_loading: "Not loading — fix it",
  unknown:     null as null,

  // Pipeline state → Pre-flight step
  resolving:       "Checking it works with your server",
  conflict_found:  "This doesn't get along with {plugin} you already have",
  backing_up:      "Saving a safety copy",
  downloading:     "Downloading add-on",
  uploading:       "Sending to your server",
  removing:        "Removing from your server",
  restart_pending: "Your server needs a quick restart to finish",
  verifying:       "Making sure it loaded cleanly",
  done:            "Done!",
  failed:          "Something went wrong",

  // Actions
  install:    "Add to server",
  update:     "Update",
  remove:     "Remove",
  undo:       "Undo last change",
  restart:    "Restart now",
  restart_later: "Restart later",
} as const;

export type PluginStatus = "running" | "errored" | "not_loading" | "unknown";

export type JobState =
  | "queued"
  | "resolving"
  | "backing_up"
  | "downloading"
  | "uploading"
  | "removing"
  | "restart_pending"
  | "verifying"
  | "done"
  | "failed"
  | "rolled_back";

export function statusLabel(status: PluginStatus): string | null {
  return PLUGIN_VOCAB[status] ?? null;
}

export function jobStateLabel(state: JobState): string {
  return (PLUGIN_VOCAB as Record<string, string | null>)[state] ?? state;
}

export function isTerminalState(state: JobState): boolean {
  return state === "done" || state === "failed" || state === "rolled_back";
}

export function isActiveState(state: JobState): boolean {
  return !isTerminalState(state) && state !== "restart_pending";
}

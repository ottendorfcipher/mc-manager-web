import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, RotateCcw, Trash2, ArrowUpCircle } from "lucide-react";
import { PLUGIN_VOCAB, statusLabel } from "./vocab";
import type { PluginStatus } from "./vocab";

const API = "/api";

interface InstalledPlugin {
  id:               number;
  filename:         string;
  project_key:      string | null;
  declared_name:    string | null;
  version:          string | null;
  api_version:      string | null;
  depends_json:     string;
  softdepends_json: string;
  sha1:             string | null;
  size_bytes:       number;
  update_available: number;
  installed_by:     string;
  installed_at:     string;
  last_load_status: PluginStatus;
  last_status_at:   string | null;
}

async function fetchInstalled(): Promise<InstalledPlugin[]> {
  const resp = await fetch(`${API}/plugins/installed`);
  if (!resp.ok) throw new Error("Failed to load installed plugins");
  return resp.json();
}

async function removePlugin(filename: string): Promise<void> {
  const resp = await fetch(`${API}/plugins/installed/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error("Failed to remove plugin");
}

async function updatePlugin(filename: string): Promise<void> {
  const resp = await fetch(`${API}/plugins/update/${encodeURIComponent(filename)}`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error("Failed to start update");
}

async function updateAll(): Promise<void> {
  const resp = await fetch(`${API}/plugins/update-all`, { method: "POST" });
  if (!resp.ok) throw new Error("Failed to start update-all");
}

async function undoLast(): Promise<void> {
  const resp = await fetch(`${API}/plugins/undo-last`, { method: "POST" });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Undo failed");
  }
}

function StatusBadge({ status }: { status: PluginStatus }) {
  const label = statusLabel(status);
  if (!label) return null;

  const cls = {
    running:     "text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900",
    errored:     "text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900",
    not_loading: "text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900",
    unknown:     "text-meta bg-[#F0EDE9] dark:bg-[#2F323D]",
  }[status] ?? "text-meta";

  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
}

export function InstalledList() {
  const qc = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [feedback, setFeedback]           = useState<string | null>(null);

  const { data: plugins, isLoading } = useQuery<InstalledPlugin[]>({
    queryKey:        ["plugins/installed"],
    queryFn:         fetchInstalled,
    refetchInterval: 30_000,
  });

  const removeMut = useMutation({
    mutationFn: removePlugin,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["plugins/installed"] });
      setConfirmRemove(null);
      setFeedback("Remove job started — restart your server to finish.");
    },
    onError: (e) => setFeedback((e as Error).message),
  });

  const updateMut = useMutation({
    mutationFn: updatePlugin,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["plugins/installed"] });
      setFeedback("Update job started.");
    },
    onError: (e) => setFeedback((e as Error).message),
  });

  const updateAllMut = useMutation({
    mutationFn: updateAll,
    onSuccess:  () => setFeedback("Update jobs started for all add-ons with available updates."),
    onError:    (e) => setFeedback((e as Error).message),
  });

  const undoMut = useMutation({
    mutationFn: undoLast,
    onSuccess:  () => setFeedback("Undo complete — your last change has been reversed."),
    onError:    (e) => setFeedback((e as Error).message),
  });

  const updateCount = plugins?.filter((p) => p.update_available !== 0).length ?? 0;

  return (
    <div className="page space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">
            Installed add-ons
          </h1>
          <p className="text-sm text-meta mt-1">
            {plugins?.length ?? 0} add-on{plugins?.length !== 1 ? "s" : ""} on your server
          </p>
        </div>

        <div className="flex gap-2">
          {updateCount > 0 && (
            <button
              onClick={() => updateAllMut.mutate()}
              disabled={updateAllMut.isPending}
              className="btn-secondary text-sm flex items-center gap-2"
            >
              {updateAllMut.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                : <RefreshCw className="w-4 h-4" aria-hidden />
              }
              Update all ({updateCount})
            </button>
          )}
          <button
            onClick={() => undoMut.mutate()}
            disabled={undoMut.isPending}
            className="btn-secondary text-sm flex items-center gap-2"
          >
            {undoMut.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
              : <RotateCcw className="w-4 h-4" aria-hidden />
            }
            {PLUGIN_VOCAB.undo}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="card text-sm text-[#1C1E27] dark:text-[#EAECF0] flex items-center justify-between">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-meta ml-4 text-xs">
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-[#5B9BF0] animate-spin" aria-label="Loading" />
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          {(!plugins || plugins.length === 0) ? (
            <p className="text-sm text-meta text-center py-10">
              No add-ons installed yet.
            </p>
          ) : (
            <ul className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
              {plugins.map((plugin) => (
                <li key={plugin.filename} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0] truncate">
                      {plugin.declared_name ?? plugin.filename}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {plugin.version && (
                        <span className="text-xs text-meta">v{plugin.version}</span>
                      )}
                      {!plugin.project_key && (
                        <span className="text-[10px] text-meta px-1.5 py-0.5 rounded-full bg-[#F0EDE9] dark:bg-[#2F323D]">
                          manual
                        </span>
                      )}
                      <StatusBadge status={plugin.last_load_status} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {plugin.update_available !== 0 && plugin.project_key && (
                      <button
                        onClick={() => updateMut.mutate(plugin.filename)}
                        disabled={updateMut.isPending}
                        className="text-xs text-[#5B9BF0] hover:underline flex items-center gap-1"
                        title="Update available"
                      >
                        <ArrowUpCircle className="w-4 h-4" aria-hidden />
                        Update
                      </button>
                    )}

                    {confirmRemove === plugin.filename ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => removeMut.mutate(plugin.filename)}
                          disabled={removeMut.isPending}
                          className="text-xs text-[#F87171] hover:underline"
                        >
                          {removeMut.isPending ? "Removing…" : "Confirm"}
                        </button>
                        <button
                          onClick={() => setConfirmRemove(null)}
                          className="text-xs text-meta hover:underline ml-1"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRemove(plugin.filename)}
                        className="icon-btn text-meta hover:text-[#F87171]"
                        aria-label={`Remove ${plugin.declared_name ?? plugin.filename}`}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

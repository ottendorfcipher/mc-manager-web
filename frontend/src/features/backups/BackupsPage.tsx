import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Cloud, HardDrive, Download, RotateCcw, Trash2, Plus } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { BackupRun } from "@/types";

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(d / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function StorageBadge({
  location, gcsUri, extended,
}: { location: string; gcsUri: string | null; extended: boolean }) {
  const isCloud = location === "cloud";
  const label = isCloud ? (extended ? "cloud · 1yr" : "cloud · 30d") : "local";
  return (
    <span
      title={gcsUri ?? undefined}
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
        isCloud
          ? "bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#5B9BF0]"
          : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#9B9EA6]"
      }`}
    >
      {isCloud ? <Cloud className="w-2.5 h-2.5" /> : <HardDrive className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}

export function BackupsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [restoreId, setRestoreId] = useState<number | null>(null);
  const [storageChoice, setStorageChoice] = useState<"local" | "cloud">("local");
  const [extendedRetention, setExtendedRetention] = useState(false);
  const canCreate = user?.permissions.can_control_server ?? false;
  const canCreateCloud = user?.permission_keys?.includes("backups.create.cloud") ?? false;
  const canExtended   = user?.permission_keys?.includes("backups.create.extended") ?? false;
  const canRestore = user?.permissions.can_restore_backup ?? false;

  const { data: backups = [], isLoading } = useQuery<BackupRun[]>({
    queryKey: ["backups"],
    queryFn: () => api.get("/backups"),
  });

  const [createError, setCreateError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => {
      setCreateError(null);
      return api.post<BackupRun>("/backups", {
        storage: storageChoice,
        extended: extendedRetention,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
    onError: (e: Error) => setCreateError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/backups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
  });

  const restoreMut = useMutation({
    mutationFn: (id: number) => api.post(`/backups/${id}/restore`),
    onSuccess: () => setRestoreId(null),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Backups</h1>
          <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">World snapshots — stored locally or in Google Cloud Storage</p>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            {/* Storage tier selector — only shown when the user can create cloud backups */}
            {canCreateCloud && (
              <div className="flex flex-col items-end gap-1.5">
                {/* Local / Cloud tier selector */}
                <div className="flex rounded-lg overflow-hidden border border-[#D9D5D0] dark:border-[#363944] text-xs">
                  <button
                    onClick={() => { setStorageChoice("local"); setExtendedRetention(false); }}
                    className={`px-2.5 py-1.5 flex items-center gap-1 ${
                      storageChoice === "local"
                        ? "bg-[#5B9BF0] text-white"
                        : "bg-white dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#9BA0B0] hover:bg-[#F0EDE9] dark:hover:bg-[#363944]"
                    }`}
                  >
                    <HardDrive className="w-3 h-3" /> Local
                  </button>
                  <button
                    onClick={() => setStorageChoice("cloud")}
                    className={`px-2.5 py-1.5 flex items-center gap-1 ${
                      storageChoice === "cloud"
                        ? "bg-[#5B9BF0] text-white"
                        : "bg-white dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#9BA0B0] hover:bg-[#F0EDE9] dark:hover:bg-[#363944]"
                    }`}
                  >
                    <Cloud className="w-3 h-3" /> Cloud
                  </button>
                </div>
                {/* Extended retention — only for cloud + permission */}
                {storageChoice === "cloud" && canExtended && (
                  <label className="flex items-center gap-1.5 text-xs text-[#6B6E78] dark:text-[#9BA0B0] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={extendedRetention}
                      onChange={(e) => setExtendedRetention(e.target.checked)}
                      className="accent-[#5B9BF0] w-3 h-3"
                    />
                    Keep for 1 year
                  </label>
                )}
              </div>
            )}
            <button
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
              className="btn-primary flex items-center gap-2 text-sm"
            >
              <Plus className="w-4 h-4" />
              {createMut.isPending ? "Creating…" : "Create Backup"}
            </button>
          </div>
        )}
      </div>

      {createMut.isPending && (
        <div className="card flex items-center gap-3 text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          <div className="w-4 h-4 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
          Stopping server, archiving world data, downloading…
          {storageChoice === "cloud" && (extendedRetention ? " Uploading to GCS (1-year retention)." : " Uploading to GCS (30-day retention).")}
          {" "}This takes 1–2 minutes.
        </div>
      )}

      {createError && (
        <div className="card flex items-center gap-3 text-sm text-[#F87171] bg-[#FEF2F2] dark:bg-[#3B1F1F] border border-[#FECACA] dark:border-[#7F1D1D]">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{createError}</span>
          <button onClick={() => setCreateError(null)} className="ml-auto text-xs text-[#9B9EA6] hover:text-[#6B6E78]">✕</button>
        </div>
      )}

      {/* Restore confirm */}
      {restoreId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="alertdialog" aria-label="Confirm restore">
          <div className="card max-w-sm w-full mx-4 space-y-4">
            <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Restore this backup?</h2>
            <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
              ⚠ The server will be stopped, the current world replaced, and the server restarted. This becomes the active version for all players. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRestoreId(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={() => restoreMut.mutate(restoreId)} disabled={restoreMut.isPending} className="btn-primary text-sm">
                {restoreMut.isPending ? "Restoring…" : "Yes, Set as Current"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" /></div>
      ) : backups.length === 0 ? (
        <div className="card text-center py-10 text-[#9B9EA6] space-y-2">
          <HardDrive className="w-8 h-8 mx-auto opacity-40" />
          <p className="text-sm">No backups yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {backups.map((b) => (
            <div key={b.id} className="card flex items-center gap-4">
              <HardDrive className="w-4 h-4 text-[#9B9EA6] flex-shrink-0" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-mono text-[#1C1E27] dark:text-[#EAECF0] truncate">{b.filename}</p>
                  <StorageBadge location={b.storage_location} gcsUri={b.gcs_uri} extended={b.extended_retention} />
                </div>
                <p className="text-xs text-[#9B9EA6] mt-0.5">{humanBytes(b.size_bytes)} · {relativeTime(b.created_at)} by {b.created_by}</p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <a href={`/api/backups/${b.id}`} download={b.filename} title="Download" className="p-1.5 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] text-[#9B9EA6] hover:text-[#1C1E27] dark:hover:text-[#EAECF0]">
                  <Download className="w-3.5 h-3.5" />
                </a>
                {canRestore && (
                  <button onClick={() => setRestoreId(b.id)} title="Set as current version" className="p-1.5 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] text-[#9B9EA6] hover:text-[#5B9BF0]">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                {canRestore && (
                  <button onClick={() => deleteMut.mutate(b.id)} title="Delete" className="p-1.5 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] text-[#9B9EA6] hover:text-[#F87171]">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

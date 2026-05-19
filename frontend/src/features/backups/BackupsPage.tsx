import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Server, HardDrive, Download, RotateCcw, Trash2, Plus } from "lucide-react";
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

export function BackupsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [restoreId, setRestoreId] = useState<number | null>(null);
  const canCreate  = user?.permissions.can_control_server ?? false;
  const canRestore = user?.permissions.can_restore_backup ?? false;

  const { data: backups = [], isLoading } = useQuery<BackupRun[]>({
    queryKey: ["backups"],
    queryFn: () => api.get("/backups"),
  });

  const [createError, setCreateError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => {
      setCreateError(null);
      return api.post<BackupRun>("/backups");
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
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Backups</h1>
          <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
            World snapshots — stored on the Minecraft server
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="btn-primary flex items-center gap-2 text-sm flex-shrink-0"
          >
            <Plus className="w-4 h-4" />
            {createMut.isPending ? "Creating…" : "Create Backup"}
          </button>
        )}
      </div>

      {createMut.isPending && (
        <div className="card flex items-center gap-3 text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
          <div className="w-4 h-4 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
          Archiving world data on the Minecraft server… This takes 1–2 minutes.
        </div>
      )}

      {createError && (
        <div className="card flex items-center gap-3 text-sm text-[#F87171] bg-[#FEF2F2] dark:bg-[#3B1F1F] border border-[#FECACA] dark:border-[#7F1D1D]">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{createError}</span>
          <button onClick={() => setCreateError(null)} className="ml-auto text-xs text-meta hover:text-[#6B6E78]">✕</button>
        </div>
      )}

      {/* Restore confirm */}
      {restoreId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="alertdialog" aria-label="Confirm restore">
          <div className="card max-w-sm w-full mx-4 space-y-4">
            <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Restore this backup?</h2>
            <p className="text-sm text-[#6B6E78] dark:text-[#A8AEBB]">
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
        <div className="card text-center py-10 text-meta space-y-2">
          <HardDrive className="w-8 h-8 mx-auto opacity-40" />
          <p className="text-sm">No backups yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {backups.map((b) => (
            <div key={b.id} className="card flex items-center gap-3">
              <Server className="w-4 h-4 text-meta flex-shrink-0 hidden sm:block" aria-hidden />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-mono text-[#1C1E27] dark:text-[#EAECF0] truncate">{b.filename}</p>
                  {b.world_slug && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#5B9BF0] flex-shrink-0">
                      {b.world_slug}
                    </span>
                  )}
                </div>
                <p className="text-xs text-meta mt-0.5">{humanBytes(b.size_bytes)} · {relativeTime(b.created_at)}</p>
              </div>
              <div className="flex flex-shrink-0">
                <a href={`/api/backups/${b.id}`} download={b.filename}
                  title="Download"
                  className="icon-btn">
                  <Download className="w-4 h-4" />
                </a>
                {canRestore && (
                  <button onClick={() => setRestoreId(b.id)} title="Set as current version"
                    className="icon-btn text-meta hover:text-[#5B9BF0]">
                    <RotateCcw className="w-4 h-4" />
                  </button>
                )}
                {canRestore && (
                  <button onClick={() => deleteMut.mutate(b.id)} title="Delete"
                    className="icon-btn-danger">
                    <Trash2 className="w-4 h-4" />
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

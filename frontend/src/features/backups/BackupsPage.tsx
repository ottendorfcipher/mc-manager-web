import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { HardDrive, Download, RotateCcw, Trash2, Plus } from "lucide-react";
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
  const canControl = user?.permissions.can_control_server ?? false;
  const canRestore = user?.permissions.can_restore_backup ?? false;

  const { data: backups = [], isLoading } = useQuery<BackupRun[]>({
    queryKey: ["backups"],
    queryFn: () => api.get("/backups"),
  });

  const createMut = useMutation({
    mutationFn: () => api.post<BackupRun>("/backups"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backups"] }),
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
          <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">World snapshots stored on this Mac</p>
        </div>
        {canControl && (
          <button onClick={() => createMut.mutate()} disabled={createMut.isPending} className="btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" />
            {createMut.isPending ? "Creating…" : "Create Backup"}
          </button>
        )}
      </div>

      {createMut.isPending && (
        <div className="card flex items-center gap-3 text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          <div className="w-4 h-4 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
          Stopping server, archiving world data, downloading… This takes 1–2 minutes.
        </div>
      )}

      {/* Restore confirm */}
      {restoreId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" role="alertdialog" aria-label="Confirm restore">
          <div className="card max-w-sm w-full mx-4 space-y-4">
            <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Restore this backup?</h2>
            <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
              ⚠ The server will be stopped, the current world replaced, and the server restarted. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRestoreId(null)} className="btn-secondary text-sm">Cancel</button>
              <button onClick={() => restoreMut.mutate(restoreId)} disabled={restoreMut.isPending} className="btn-primary text-sm">
                {restoreMut.isPending ? "Restoring…" : "Yes, Restore"}
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
                <p className="text-sm font-mono text-[#1C1E27] dark:text-[#EAECF0] truncate">{b.filename}</p>
                <p className="text-xs text-[#9B9EA6]">{humanBytes(b.size_bytes)} · {relativeTime(b.created_at)} by {b.created_by}</p>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <a href={`/api/backups/${b.id}`} download={b.filename} title="Download" className="p-1.5 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] text-[#9B9EA6] hover:text-[#1C1E27] dark:hover:text-[#EAECF0]">
                  <Download className="w-3.5 h-3.5" />
                </a>
                {canRestore && (
                  <button onClick={() => setRestoreId(b.id)} title="Restore" className="p-1.5 rounded hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] text-[#9B9EA6] hover:text-[#5B9BF0]">
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

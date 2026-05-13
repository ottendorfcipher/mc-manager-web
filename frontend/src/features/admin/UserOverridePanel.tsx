/**
 * UserOverridePanel — manage additive per-user permission overrides.
 *
 * These grants sit on top of a user's role permissions (they can only ADD,
 * never revoke).  The UI makes this constraint explicit with copy and by only
 * showing permissions the user does not already have through their role.
 *
 * UX: Law of Proximity — overrides grouped near the user they belong to.
 * Recognition over Recall — full permission key + description shown inline.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { api } from "@/api/client";
import type { PermissionCatalogEntry, PermissionOverride } from "@/types";

interface Props {
  email:      string;
  /** The user's role name — used to show only permissions not already in role */
  roleName:   string;
  canEdit:    boolean;
}

export function UserOverridePanel({ email, roleName, canEdit }: Props) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState("");

  const { data: overrides = [], isLoading } = useQuery<PermissionOverride[]>({
    queryKey: ["overrides", email],
    queryFn: () => api.get<PermissionOverride[]>(`/users/${encodeURIComponent(email)}/permission-overrides`),
    enabled: canEdit,
  });

  const { data: catalog = [] } = useQuery<PermissionCatalogEntry[]>({
    queryKey: ["permissions-catalog"],
    queryFn: () => api.get<PermissionCatalogEntry[]>("/permissions"),
    enabled: canEdit,
  });

  const { data: rolePermsData } = useQuery<{ role: string; permissions: string[] }>({
    queryKey: ["role-permissions", roleName],
    queryFn: () => api.get(`/roles/${roleName}/permissions`),
    enabled: canEdit,
  });

  const rolePerm = new Set(rolePermsData?.permissions ?? []);
  const overrideKeys = new Set(overrides.map((o) => o.permission_key));

  // Only show permissions not already in the role (avoid confusion)
  const available = catalog.filter((p) => !rolePerm.has(p.key) && !overrideKeys.has(p.key));

  const addMut = useMutation({
    mutationFn: (key: string) =>
      api.post(`/users/${encodeURIComponent(email)}/permission-overrides`, { permission_key: key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["overrides", email] });
      setSelected("");
      setAdding(false);
    },
  });

  const removeMut = useMutation({
    mutationFn: (key: string) =>
      api.delete(`/users/${encodeURIComponent(email)}/permission-overrides/${encodeURIComponent(key)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overrides", email] }),
  });

  if (!canEdit) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-[#6B6E78] dark:text-[#A8AEBB] uppercase tracking-wide">
          Permission Overrides
        </p>
        {!adding && available.length > 0 && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-xs text-[#5B9BF0] hover:text-[#4080D8] font-medium"
            data-testid="add-override-btn"
          >
            <Plus className="w-3 h-3" aria-hidden /> Add
          </button>
        )}
      </div>

      <p className="text-xs text-meta">
        Grants extra permissions on top of the user's role. Cannot revoke role permissions.
      </p>

      {/* Existing overrides */}
      {isLoading ? (
        <div className="w-4 h-4 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
      ) : overrides.length === 0 ? (
        <p className="text-xs text-meta italic">No overrides — all permissions come from the role.</p>
      ) : (
        <div className="space-y-1">
          {overrides.map((o) => (
            <div
              key={o.permission_key}
              className="flex items-center gap-2 px-2 py-1.5 bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg"
              data-testid={`override-${o.permission_key}`}
            >
              <span className="font-mono text-xs text-[#1C1E27] dark:text-[#EAECF0] flex-1 truncate">
                {o.permission_key}
              </span>
              <span className="text-[10px] text-meta hidden sm:block">
                by {o.granted_by.split("@")[0]}
              </span>
              <button
                onClick={() => removeMut.mutate(o.permission_key)}
                disabled={removeMut.isPending}
                aria-label={`Remove override ${o.permission_key}`}
                className="text-[#F87171] hover:text-red-600 flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add override */}
      {adding && (
        <div className="flex gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex-1 text-xs rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
            data-testid="override-select"
          >
            <option value="">Select permission…</option>
            {available.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key} — {p.description}
              </option>
            ))}
          </select>
          <button
            onClick={() => selected && addMut.mutate(selected)}
            disabled={!selected || addMut.isPending}
            className="btn-primary text-xs px-3"
            data-testid="confirm-override-btn"
          >
            Grant
          </button>
          <button onClick={() => setAdding(false)} className="btn-secondary text-xs px-3">
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

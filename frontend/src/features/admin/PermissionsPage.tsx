import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldCheck } from "lucide-react";
import { api } from "@/api/client";
import type { PermissionCatalogEntry, RoleRecord, RoleWithPermissions } from "@/types";

type CellState = "unchanged" | "added" | "removed";

/**
 * Admin page: edit the role → permission matrix.
 *
 * UX: one table, rows = permissions grouped by category, columns = roles.
 * A cell is a checkbox that tracks pending changes locally until Save is
 * pressed — so admins can re-shape several roles without round-trips.
 */
/**
 * PermissionsPage — matrix view of all roles × all permissions.
 * Roles are loaded dynamically from /api/roles so custom roles appear here too.
 * The PermissionEditor component is used for per-role editing in the Roles tab;
 * this page provides a cross-role comparison matrix for admins.
 */
export function PermissionsPage() {
  const qc = useQueryClient();

  const { data: catalog = [], isLoading: loadingCatalog } = useQuery<PermissionCatalogEntry[]>({
    queryKey: ["permissions-catalog"],
    queryFn: () => api.get<PermissionCatalogEntry[]>("/permissions"),
  });

  const { data: apiRoles = [], isLoading: loadingRoles } = useQuery<RoleRecord[]>({
    queryKey: ["roles"],
    queryFn: () => api.get<RoleRecord[]>("/roles"),
  });

  // Fetch permissions for every role
  const { data: allRolePerms, isLoading: loadingPerms } = useQuery({
    queryKey: ["all-role-permissions", apiRoles.map((r) => r.name).join(",")],
    queryFn: async () => {
      if (!apiRoles.length) return {} as Record<string, Set<string>>;
      const pairs = await Promise.all(
        apiRoles.map((r) => api.get<RoleWithPermissions>(`/roles/${r.name}/permissions`)),
      );
      return Object.fromEntries(pairs.map((rp) => [rp.role, new Set(rp.permissions)]));
    },
    enabled: apiRoles.length > 0,
  });

  // Saved = last-committed server state; pending = live edits
  const [saved,   setSaved]   = useState<Record<string, Set<string>> | null>(null);
  const [pending, setPending] = useState<Record<string, Set<string>> | null>(null);

  if (allRolePerms && !pending) {
    const s: Record<string, Set<string>> = {};
    const p: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(allRolePerms)) {
      s[k] = new Set(v as Set<string>);
      p[k] = new Set(v as Set<string>);
    }
    setSaved(s);
    setPending(p);
  }

  const toggle = (role: string, key: string) => {
    setPending((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [role]: new Set(prev[role]) };
      if (next[role].has(key)) next[role].delete(key);
      else next[role].add(key);
      return next;
    });
  };

  // True when any cell differs from last save
  const hasDiff = useMemo(() => {
    if (!saved || !pending) return false;
    return Object.keys(pending).some((role) => {
      const s = saved[role] ?? new Set<string>();
      const p = pending[role] ?? new Set<string>();
      if (s.size !== p.size) return true;
      for (const k of s) if (!p.has(k)) return true;
      return false;
    });
  }, [saved, pending]);

  const cellState = (role: string, key: string): CellState => {
    const inSaved   = saved?.[role]?.has(key)   ?? false;
    const inPending = pending?.[role]?.has(key) ?? false;
    if (!inSaved && inPending)  return "added";
    if (inSaved  && !inPending) return "removed";
    return "unchanged";
  };

  // Save only roles that actually changed
  const saveAll = useMutation({
    mutationFn: async () => {
      const changed = apiRoles.filter((r) => {
        const s = saved?.[r.name]   ?? new Set<string>();
        const p = pending?.[r.name] ?? new Set<string>();
        if (s.size !== p.size) return true;
        for (const k of s) if (!p.has(k)) return true;
        return false;
      });
      await Promise.all(
        changed.map((r) =>
          api.put<RoleWithPermissions>(`/roles/${r.name}/permissions`, {
            permissions: Array.from(pending?.[r.name] ?? new Set()),
          }),
        ),
      );
    },
    onSuccess: () => {
      // Advance saved state to match what was just written
      if (pending) {
        const next: Record<string, Set<string>> = {};
        for (const [k, v] of Object.entries(pending)) next[k] = new Set(v);
        setSaved(next);
      }
      qc.invalidateQueries({ queryKey: ["all-role-permissions"] });
    },
  });

  const categories = useMemo(() => {
    const byCat = new Map<string, PermissionCatalogEntry[]>();
    for (const p of catalog) {
      const arr = byCat.get(p.category) ?? [];
      arr.push(p);
      byCat.set(p.category, arr);
    }
    return Array.from(byCat.entries());
  }, [catalog]);

  if (loadingCatalog || loadingRoles || loadingPerms || !pending) {
    return (
      <div className="flex items-center gap-2 text-sm text-[#9B9EA6] py-4">
        <div className="w-4 h-4 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        Loading permissions…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-[#5B9BF0]" aria-hidden />
          <div>
            <h2 className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">Permission Matrix</h2>
            <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
              Cross-role view. Unsaved changes are highlighted.
            </p>
          </div>
        </div>
        <button
          onClick={() => saveAll.mutate()}
          disabled={!hasDiff || saveAll.isPending}
          className="btn-primary text-sm flex items-center gap-2 flex-shrink-0 disabled:opacity-40"
          data-testid="save-all-permissions"
        >
          <Save className="w-3.5 h-3.5" aria-hidden />
          {saveAll.isPending ? "Saving…" : hasDiff ? "Save Changes" : "No Changes"}
        </button>
      </header>

      <div className="card overflow-x-auto" data-testid="permissions-grid">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-[#9B9EA6]">
              <th className="py-2 px-2 min-w-[180px]">Permission</th>
              {apiRoles.map((r) => (
                <th key={r.name} className="py-2 px-2 text-center whitespace-nowrap">
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-semibold"
                    style={{ backgroundColor: r.color }}
                  >
                    {r.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(([cat, perms]) => (
              <>
                <tr key={`cat-${cat}`} className="bg-[#F0EDE9] dark:bg-[#2A2D38]">
                  <td
                    colSpan={apiRoles.length + 1}
                    className="py-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-[#6B6E78]"
                  >
                    {cat}
                  </td>
                </tr>
                {perms.map((p) => (
                  <tr key={p.key} className="border-t border-[#D9D5D0] dark:border-[#363944]">
                    <td className="py-2 px-2">
                      <div className="font-mono text-xs">{p.key}</div>
                      <div className="text-xs text-[#9B9EA6]">{p.description}</div>
                    </td>
                    {apiRoles.map((r) => {
                      const cs = cellState(r.name, p.key);
                      return (
                        <td
                          key={r.name}
                          className={`text-center transition-colors ${
                            cs === "added"   ? "bg-green-50 dark:bg-green-950/30" :
                            cs === "removed" ? "bg-red-50   dark:bg-red-950/30"   : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={pending[r.name]?.has(p.key) ?? false}
                            onChange={() => toggle(r.name, p.key)}
                            aria-label={`${r.label} has ${p.key}`}
                            data-testid={`cell-${r.name}-${p.key}`}
                            className={`accent-[#5B9BF0] ${
                              cs === "added"   ? "accent-green-500" :
                              cs === "removed" ? "accent-red-400"   : ""
                            }`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {hasDiff && (
        <p className="text-xs text-[#9B9EA6]">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-200 dark:bg-green-900 mr-1" />
          Added &nbsp;
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-200 dark:bg-red-900 mr-1 ml-2" />
          Removed
        </p>
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, ShieldCheck } from "lucide-react";
import { api } from "@/api/client";
import { ALL_ROLES, ROLE_LABELS } from "@/types";
import type { PermissionCatalogEntry, Role, RolePermissions } from "@/types";

/**
 * Admin page: edit the role → permission matrix.
 *
 * UX: one table, rows = permissions grouped by category, columns = roles.
 * A cell is a checkbox that tracks pending changes locally until Save is
 * pressed — so admins can re-shape several roles without round-trips.
 */
export function PermissionsPage() {
  const qc = useQueryClient();

  const catalog = useQuery<PermissionCatalogEntry[]>({
    queryKey: ["permissions-catalog"],
    queryFn: () => api.get<PermissionCatalogEntry[]>("/permissions"),
  });

  const roles = ALL_ROLES;
  const roleQueries = useQuery({
    queryKey: ["role-permissions"],
    queryFn: async () => {
      const pairs = await Promise.all(
        roles.map((r) => api.get<RolePermissions>(`/roles/${r}/permissions`)),
      );
      return Object.fromEntries(pairs.map((rp) => [rp.role, new Set(rp.permissions)])) as Record<
        Role,
        Set<string>
      >;
    },
  });

  // Local pending state, keyed by role. We mirror the server-side map only
  // once (on first load) and let the user edit freely from there; Save flushes.
  const [pending, setPending] = useState<Record<Role, Set<string>> | null>(null);
  if (roleQueries.data && !pending) {
    // Safe one-shot init during render: avoids `setState inside useEffect`
    // and only runs when the empty-state branch of this component is replaced.
    setPending(structuredCloneRoleMap(roleQueries.data));
  }

  const toggle = (role: Role, key: string) => {
    setPending((prev) => {
      if (!prev) return prev;
      const next = structuredCloneRoleMap(prev);
      const set = next[role];
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return next;
    });
  };

  const saveRole = useMutation({
    mutationFn: (role: Role) =>
      api.put<RolePermissions>(`/roles/${role}/permissions`, {
        permissions: Array.from(pending?.[role] ?? new Set()),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-permissions"] }),
  });

  const categories = useMemo(() => {
    if (!catalog.data) return [];
    const byCat = new Map<string, PermissionCatalogEntry[]>();
    for (const p of catalog.data) {
      const arr = byCat.get(p.category) ?? [];
      arr.push(p);
      byCat.set(p.category, arr);
    }
    return Array.from(byCat.entries());
  }, [catalog.data]);

  if (catalog.isLoading || roleQueries.isLoading || !pending) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-[#9B9EA6]">
        <div className="w-4 h-4 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        Loading permissions…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <header className="flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-[#5B9BF0]" aria-hidden />
        <div>
          <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Permissions</h1>
          <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
            Edit which permissions each role has. Changes persist when you click Save for that role.
          </p>
        </div>
      </header>

      <div className="card overflow-x-auto" data-testid="permissions-grid">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-[#9B9EA6]">
              <th className="py-2 px-2">Permission</th>
              {roles.map((r) => (
                <th key={r} className="py-2 px-2 text-center">{ROLE_LABELS[r]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(([cat, perms]) => (
              <CategoryRows
                key={cat}
                category={cat}
                perms={perms}
                roles={roles}
                pending={pending}
                onToggle={toggle}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        {roles.map((r) => (
          <button
            key={r}
            onClick={() => saveRole.mutate(r)}
            className="btn-primary text-sm flex items-center gap-2"
            data-testid={`save-${r}`}
          >
            <Save className="w-3.5 h-3.5" aria-hidden />
            Save {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
    </div>
  );
}

function structuredCloneRoleMap(src: Record<Role, Set<string>>): Record<Role, Set<string>> {
  const out = {} as Record<Role, Set<string>>;
  for (const [k, v] of Object.entries(src)) out[k as Role] = new Set(v);
  return out;
}

function CategoryRows({
  category,
  perms,
  roles,
  pending,
  onToggle,
}: {
  category: string;
  perms: PermissionCatalogEntry[];
  roles: readonly Role[];
  pending: Record<Role, Set<string>>;
  onToggle: (role: Role, key: string) => void;
}) {
  return (
    <>
      <tr className="bg-[#F0EDE9] dark:bg-[#2A2D38]">
        <td
          colSpan={roles.length + 1}
          className="py-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-[#6B6E78]"
        >
          {category}
        </td>
      </tr>
      {perms.map((p) => (
        <tr key={p.key} className="border-t border-[#D9D5D0] dark:border-[#363944]">
          <td className="py-2 px-2">
            <div className="font-mono text-xs">{p.key}</div>
            <div className="text-xs text-[#9B9EA6]">{p.description}</div>
          </td>
          {roles.map((r) => (
            <td key={r} className="text-center">
              <input
                type="checkbox"
                checked={pending[r].has(p.key)}
                onChange={() => onToggle(r, p.key)}
                aria-label={`${ROLE_LABELS[r]} has ${p.key}`}
                data-testid={`cell-${r}-${p.key}`}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

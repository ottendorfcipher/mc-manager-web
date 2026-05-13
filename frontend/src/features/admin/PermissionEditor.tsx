/**
 * PermissionEditor — accordion-based permission matrix for a single role.
 *
 * UX principles applied:
 *   • Progressive Disclosure (Miller's Law): categories are collapsed by default;
 *     expand to see up to 7–9 permissions per group (Miller's 7±2).
 *   • Batch Apply (KLM-GOMS): single "Apply" click flushes all pending toggles,
 *     minimising motor actions vs. per-toggle server round-trips.
 *   • Doherty Threshold: optimistic pending state keeps the UI responsive.
 *   • Fitts's Law: toggle switches are large enough (h-5 w-9) to hit easily.
 *   • Feedback (NN/g H1): dirty indicator shows unsaved changes clearly.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Save } from "lucide-react";
import { api } from "@/api/client";
import type { PermissionCatalogEntry, RoleWithPermissions } from "@/types";

interface Props {
  roleName: string;
  /** If true the actor cannot edit (e.g. viewing own or higher role) */
  readOnly?: boolean;
  /** Called after a successful save so parents can refresh */
  onSaved?: () => void;
}

// Category display order — less-used categories collapse to the bottom.
const CATEGORY_ORDER = ["server", "backups", "config", "players", "users", "roles", "admin", "nav"];

export function PermissionEditor({ roleName, readOnly = false, onSaved }: Props) {
  const qc = useQueryClient();

  const { data: catalog = [], isLoading: loadingCatalog } = useQuery<PermissionCatalogEntry[]>({
    queryKey: ["permissions-catalog"],
    queryFn: () => api.get<PermissionCatalogEntry[]>("/permissions"),
  });

  const { data: rolePerms, isLoading: loadingPerms } = useQuery<RoleWithPermissions>({
    queryKey: ["role-permissions", roleName],
    queryFn: () => api.get<RoleWithPermissions>(`/roles/${roleName}/permissions`),
  });

  // Local pending state — only synced on first load
  const [pending, setPending] = useState<Set<string> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(["server"]));

  if (rolePerms && !pending) {
    setPending(new Set(rolePerms.permissions));
  }

  const toggle = (key: string) => {
    if (readOnly) return;
    setPending((prev) => {
      if (!prev) return prev;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
  };

  const savePerms = useMutation({
    mutationFn: () =>
      api.put<RoleWithPermissions>(`/roles/${roleName}/permissions`, {
        permissions: Array.from(pending ?? new Set()),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["role-permissions", roleName] });
      setDirty(false);
      onSaved?.();
    },
  });

  const categories = useMemo(() => {
    const byCat = new Map<string, PermissionCatalogEntry[]>();
    for (const p of catalog) {
      const arr = byCat.get(p.category) ?? [];
      arr.push(p);
      byCat.set(p.category, arr);
    }
    // Sort by CATEGORY_ORDER, then alphabetically for unknowns
    const known = CATEGORY_ORDER.filter((c) => byCat.has(c));
    const rest = Array.from(byCat.keys())
      .filter((c) => !CATEGORY_ORDER.includes(c))
      .sort();
    return [...known, ...rest].map((c) => [c, byCat.get(c)!] as const);
  }, [catalog]);

  const toggleCat = (cat: string) =>
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  if (loadingCatalog || loadingPerms || !pending) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-meta">
        <div className="w-4 h-4 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        Loading permissions…
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Dirty banner */}
      {dirty && !readOnly && (
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#FEF3C7] dark:bg-[#3D2A00] text-[#92400E] dark:text-[#FCD34D] text-xs">
          <span>Unsaved changes</span>
          <button
            onClick={() => savePerms.mutate()}
            disabled={savePerms.isPending}
            className="flex items-center gap-1.5 font-semibold hover:underline"
            data-testid="apply-permissions"
          >
            <Save className="w-3 h-3" aria-hidden />
            {savePerms.isPending ? "Saving…" : "Apply Changes"}
          </button>
        </div>
      )}

      {/* Accordion categories */}
      {categories.map(([cat, perms]) => {
        const isOpen = openCats.has(cat);
        const grantedCount = perms.filter((p) => pending.has(p.key)).length;

        return (
          <div key={cat} className="border border-[#D9D5D0] dark:border-[#363944] rounded-lg overflow-hidden">
            {/* Category header — Fitts: full-width clickable */}
            <button
              className="w-full flex items-center justify-between px-3 py-2.5 bg-[#F0EDE9] dark:bg-[#2A2D38] hover:bg-[#E5E1DC] dark:hover:bg-[#363944] transition-colors text-left"
              onClick={() => toggleCat(cat)}
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-2">
                {isOpen
                  ? <ChevronDown className="w-4 h-4 text-meta" aria-hidden />
                  : <ChevronRight className="w-4 h-4 text-meta" aria-hidden />}
                <span className="text-xs font-semibold uppercase tracking-wider text-[#6B6E78] dark:text-[#A8AEBB]">
                  {cat}
                </span>
              </div>
              <span className="text-xs text-meta">
                {grantedCount}/{perms.length}
              </span>
            </button>

            {/* Permissions list */}
            {isOpen && (
              <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
                {perms.map((p) => {
                  const granted = pending.has(p.key);
                  return (
                    <label
                      key={p.key}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${
                        readOnly ? "cursor-default" : "hover:bg-[#F7F5F2] dark:hover:bg-[#1C1E27]"
                      } transition-colors`}
                      data-testid={`perm-toggle-${p.key}`}
                    >
                      {/* Toggle switch — Fitts compliant size */}
                      <span
                        role="switch"
                        aria-checked={granted}
                        aria-label={p.key}
                        onClick={() => toggle(p.key)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5B9BF0] ${
                          granted ? "bg-[#5B9BF0]" : "bg-[#D9D5D0] dark:bg-[#363944]"
                        } ${readOnly ? "opacity-50" : ""}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                            granted ? "translate-x-[18px]" : "translate-x-[3px]"
                          }`}
                        />
                      </span>

                      {/* Permission info */}
                      <span className="flex-1 min-w-0">
                        <span className="font-mono text-xs text-[#1C1E27] dark:text-[#EAECF0] block truncate">
                          {p.key}
                        </span>
                        <span className="text-xs text-meta block truncate">{p.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Bottom save button for convenience on long lists */}
      {!readOnly && dirty && (
        <button
          onClick={() => savePerms.mutate()}
          disabled={savePerms.isPending}
          className="btn-primary w-full flex items-center justify-center gap-2 text-sm mt-2"
        >
          <Save className="w-3.5 h-3.5" aria-hidden />
          {savePerms.isPending ? "Saving…" : "Apply Changes"}
        </button>
      )}
    </div>
  );
}

/**
 * RolesTab — create, edit, and delete custom roles; edit permission assignments.
 *
 * UX principles:
 *   • Aesthetic-Usability Effect: colour swatches and level indicators make the
 *     role hierarchy immediately legible (Gestalt Law of Similarity).
 *   • Fitts's Law: primary actions (Edit Perms, Delete) are at row-end, large
 *     enough to click easily.
 *   • Peak-End Rule: destructive delete is gated by a confirmation step and a
 *     clear explanation of why a role cannot be deleted yet.
 *   • Hick's Law: create-role form only shows the minimum required fields;
 *     advanced fields (level) are explicit with a bounded input.
 *   • Error Prevention (NN/g H5): system roles' Delete button is disabled with
 *     tooltip copy rather than hidden, so users understand the constraint.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, ShieldCheck, X, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { RoleRecord } from "@/types";
import { PermissionEditor } from "./PermissionEditor";

// ── Types ──────────────────────────────────────────────────────────────────────

interface CreateRoleBody {
  name: string;
  label: string;
  description?: string;
  color?: string;
  level: number;
}

interface UpdateRoleBody {
  label?: string;
  description?: string;
  color?: string;
  level?: number;
}

// ── Preset colours — enough variety without overwhelming choice (Hick's Law) ──

const COLOR_PRESETS = [
  "#5B9BF0", "#36B37E", "#FBBF24", "#F87171",
  "#A78BFA", "#FB923C", "#34D399", "#60A5FA",
  "#E879F9", "#6B7280",
];

// ── Main component ─────────────────────────────────────────────────────────────

export function RolesTab() {
  const { user: me, hasPerm } = useAuthStore();
  const qc = useQueryClient();

  const canCreate = hasPerm("roles.create");
  const canEdit   = hasPerm("roles.edit");
  const canDelete = hasPerm("roles.delete");

  const { data: roles = [], isLoading } = useQuery<RoleRecord[]>({
    queryKey: ["roles"],
    queryFn: () => api.get<RoleRecord[]>("/roles"),
  });

  const [creating, setCreating]        = useState(false);
  const [editingPerms, setEditingPerms] = useState<string | null>(null); // role name
  const [editingMeta, setEditingMeta]   = useState<RoleRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (body: CreateRoleBody) => api.post<RoleRecord>("/roles", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setCreating(false);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ name, body }: { name: string; body: UpdateRoleBody }) =>
      api.patch<RoleRecord>(`/roles/${name}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setEditingMeta(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.delete(`/roles/${name}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roles"] });
      setConfirmDelete(null);
    },
    onError: (e: Error) => alert(e.message),
  });

  const myLevel = me?.permission_keys.length
    ? roles.find((r) => r.name === me.role)?.level ?? 0
    : 0;

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          Roles control what each user can do.
          Custom roles let you delegate specific capabilities without granting full admin access.
        </p>
        {canCreate && (
          <button
            onClick={() => setCreating(true)}
            className="btn-primary flex items-center gap-2 text-sm flex-shrink-0"
            data-testid="create-role-btn"
          >
            <Plus className="w-4 h-4" aria-hidden /> Create Role
          </button>
        )}
      </div>

      {/* Create role modal */}
      {creating && (
        <CreateRoleModal
          maxLevel={myLevel - 1}
          onCancel={() => setCreating(false)}
          onSubmit={(body) => createMut.mutate(body)}
          isPending={createMut.isPending}
          error={createMut.error?.message}
        />
      )}

      {/* Role list */}
      <div className="space-y-2">
        {roles.map((role) => {
          const isExpanded = editingPerms === role.name;
          const isEditing  = editingMeta?.name === role.name;
          const canActOnThis = !role.is_system || role.name !== "global_admin";

          return (
            <div key={role.name} className="card space-y-0 p-0 overflow-hidden" data-testid={`role-row-${role.name}`}>
              {/* Role header row */}
              <div className="flex items-center gap-3 p-4">
                {/* Colour swatch */}
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: role.color }}
                  aria-hidden
                />

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                      {role.label}
                    </span>
                    <span className="font-mono text-xs text-[#9B9EA6]">({role.name})</span>
                    {role.is_system && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F0EDE9] dark:bg-[#2A2D38] text-[#6B6E78] dark:text-[#9BA0B0] font-medium uppercase tracking-wide">
                        System
                      </span>
                    )}
                    {/* Level indicator */}
                    <span className="text-[10px] text-[#9B9EA6]">Level {role.level}</span>
                  </div>
                  {role.description && (
                    <p className="text-xs text-[#6B6E78] dark:text-[#9BA0B0] mt-0.5 truncate">
                      {role.description}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {canEdit && canActOnThis && (
                    <button
                      onClick={() => setEditingMeta(isEditing ? null : role)}
                      className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                      aria-label={`Edit ${role.label} metadata`}
                      data-testid={`edit-meta-${role.name}`}
                    >
                      <Pencil className="w-3 h-3" aria-hidden /> Edit
                    </button>
                  )}
                  <button
                    onClick={() => setEditingPerms(isExpanded ? null : role.name)}
                    className="btn-secondary text-xs py-1 px-2 flex items-center gap-1"
                    aria-label={`${isExpanded ? "Collapse" : "Edit"} permissions for ${role.label}`}
                    data-testid={`perms-${role.name}`}
                  >
                    <ShieldCheck className="w-3 h-3" aria-hidden />
                    Permissions
                    {isExpanded
                      ? <ChevronUp className="w-3 h-3 ml-0.5" aria-hidden />
                      : <ChevronDown className="w-3 h-3 ml-0.5" aria-hidden />}
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => !role.is_system && setConfirmDelete(role.name)}
                      disabled={role.is_system}
                      title={role.is_system ? "System roles cannot be deleted" : `Delete ${role.label}`}
                      className={`text-xs py-1 px-2 rounded-lg border transition-colors ${
                        role.is_system
                          ? "border-[#D9D5D0] dark:border-[#363944] text-[#D9D5D0] dark:text-[#363944] cursor-not-allowed"
                          : "border-[#F87171] text-[#F87171] hover:bg-[#F87171] hover:text-white"
                      }`}
                      data-testid={`delete-${role.name}`}
                    >
                      <Trash2 className="w-3 h-3" aria-hidden />
                    </button>
                  )}
                </div>
              </div>

              {/* Inline metadata editor */}
              {isEditing && (
                <div className="border-t border-[#D9D5D0] dark:border-[#363944] px-4 pb-4 pt-3 bg-[#F7F5F2] dark:bg-[#1C1E27]">
                  <MetaEditor
                    role={role}
                    onSave={(body) => updateMut.mutate({ name: role.name, body })}
                    onCancel={() => setEditingMeta(null)}
                    isPending={updateMut.isPending}
                  />
                </div>
              )}

              {/* Inline permission editor */}
              {isExpanded && (
                <div className="border-t border-[#D9D5D0] dark:border-[#363944] px-4 pb-4 pt-3 bg-[#F7F5F2] dark:bg-[#1C1E27]">
                  <PermissionEditor
                    roleName={role.name}
                    readOnly={!canEdit}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          role="dialog"
          aria-modal
          aria-label="Confirm delete role"
        >
          <div className="card max-w-sm w-full mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Delete role?</h2>
              <button onClick={() => setConfirmDelete(null)} aria-label="Cancel">
                <X className="w-4 h-4 text-[#9B9EA6]" />
              </button>
            </div>
            <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
              Deleting <strong className="font-mono">{confirmDelete}</strong> is permanent.
              Make sure no users are assigned this role first.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm">
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(confirmDelete)}
                disabled={deleteMut.isPending}
                className="btn-danger text-sm"
                data-testid="confirm-delete-btn"
              >
                {deleteMut.isPending ? "Deleting…" : "Delete Role"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Create role modal ──────────────────────────────────────────────────────────

function CreateRoleModal({
  maxLevel,
  onCancel,
  onSubmit,
  isPending,
  error,
}: {
  maxLevel: number;
  onCancel: () => void;
  onSubmit: (body: CreateRoleBody) => void;
  isPending: boolean;
  error?: string;
}) {
  const [name,  setName]  = useState("");
  const [label, setLabel] = useState("");
  const [desc,  setDesc]  = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [level, setLevel] = useState(Math.max(0, maxLevel));

  const nameValid = /^[a-z][a-z0-9_-]{0,31}$/.test(name);
  const canSubmit = nameValid && label.trim().length > 0;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      role="dialog"
      aria-modal
      aria-label="Create custom role"
    >
      <div className="card max-w-md w-full mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#1C1E27] dark:text-[#EAECF0]">Create Custom Role</h2>
          <button onClick={onCancel} aria-label="Close"><X className="w-4 h-4 text-[#9B9EA6]" /></button>
        </div>

        <div className="space-y-3">
          {/* Name field */}
          <div>
            <label className="block text-xs font-medium text-[#6B6E78] dark:text-[#9BA0B0] mb-1">
              ID (slug) <span className="text-[#F87171]">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. developer"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#5B9BF0] bg-white dark:bg-[#2A2D38] ${
                name && !nameValid
                  ? "border-[#F87171]"
                  : "border-[#D9D5D0] dark:border-[#363944]"
              }`}
              data-testid="create-role-name"
            />
            {name && !nameValid && (
              <p className="text-xs text-[#F87171] mt-1">
                Must start with a letter, use only a–z, 0–9, _ or -, max 32 chars.
              </p>
            )}
          </div>

          {/* Label field */}
          <div>
            <label className="block text-xs font-medium text-[#6B6E78] dark:text-[#9BA0B0] mb-1">
              Display Name <span className="text-[#F87171]">*</span>
            </label>
            <input
              type="text"
              placeholder="Developer"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
              data-testid="create-role-label"
            />
          </div>

          {/* Description field */}
          <div>
            <label className="block text-xs font-medium text-[#6B6E78] dark:text-[#9BA0B0] mb-1">
              Description
            </label>
            <input
              type="text"
              placeholder="Engineering team members"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
            />
          </div>

          {/* Colour + level row */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[#6B6E78] dark:text-[#9BA0B0] mb-1">
                Colour
              </label>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                      color === c ? "border-[#1C1E27] dark:border-[#EAECF0] scale-110" : "border-transparent"
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                    aria-pressed={color === c}
                    data-testid={`color-${c}`}
                  />
                ))}
              </div>
            </div>

            <div className="w-24">
              <label className="block text-xs font-medium text-[#6B6E78] dark:text-[#9BA0B0] mb-1">
                Level (0–{maxLevel})
              </label>
              <input
                type="number"
                min={0}
                max={maxLevel}
                value={level}
                onChange={(e) => setLevel(Math.min(maxLevel, Math.max(0, Number(e.target.value))))}
                className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
                data-testid="create-role-level"
              />
            </div>
          </div>

          {error && <p className="text-xs text-[#F87171]">{error}</p>}
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button
            onClick={() => onSubmit({ name, label, description: desc, color, level })}
            disabled={!canSubmit || isPending}
            className="btn-primary text-sm"
            data-testid="create-role-submit"
          >
            {isPending ? "Creating…" : "Create Role"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline metadata editor ─────────────────────────────────────────────────────

function MetaEditor({
  role,
  onSave,
  onCancel,
  isPending,
}: {
  role: RoleRecord;
  onSave: (body: UpdateRoleBody) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [label, setLabel] = useState(role.label);
  const [desc,  setDesc]  = useState(role.description);
  const [color, setColor] = useState(role.color);

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-[#6B6E78] dark:text-[#9BA0B0] mb-1">Display Name</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-[#6B6E78] dark:text-[#9BA0B0] mb-1">Description</label>
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-[#6B6E78] dark:text-[#9BA0B0] mb-1">Colour</label>
        <div className="flex flex-wrap gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${
                color === c ? "border-[#1C1E27] dark:border-[#EAECF0] scale-110" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="btn-secondary text-xs">Cancel</button>
        <button
          onClick={() => onSave({ label, description: desc, color })}
          disabled={isPending}
          className="btn-primary text-xs"
          data-testid="save-role-meta"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

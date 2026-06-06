/**
 * Manage parties from the Team page.
 *
 * A party = a named group of in-game IGNs that can be selected as a
 * single targeting unit in countdowns, music zones, and lobbies.
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, Plus, Trash2, Pencil, X, Save, UserPlus, UserMinus,
} from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import type { PartyWithMembers, McPlayer } from "@/types";

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
].join(" ");
const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

const COLOR_CHOICES = [
  "yellow", "gold", "green", "dark_green",
  "aqua", "dark_aqua", "blue", "dark_blue",
  "red", "dark_red", "light_purple", "dark_purple",
  "white", "gray",
] as const;

const COLOR_HEX: Record<string, string> = {
  yellow:       "#FFFF55",
  gold:         "#FFAA00",
  green:        "#55FF55",
  dark_green:   "#00AA00",
  aqua:         "#55FFFF",
  dark_aqua:    "#00AAAA",
  blue:         "#5555FF",
  dark_blue:    "#0000AA",
  red:          "#FF5555",
  dark_red:     "#AA0000",
  light_purple: "#FF55FF",
  dark_purple:  "#AA00AA",
  white:        "#FFFFFF",
  gray:         "#AAAAAA",
};

export function PartiesCard() {
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.hasPerm)("parties.manage");
  const { data: parties = [] } = useQuery<PartyWithMembers[]>({
    queryKey: ["parties"],
    queryFn:  () => api.get("/parties"),
  });
  const [creating, setCreating] = useState(false);

  const createMut = useMutation({
    mutationFn: (body: { name: string; color: string; description?: string }) =>
      api.post("/parties", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parties"] });
      setCreating(false);
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/parties/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parties"] }),
  });

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
          <Users className="w-4 h-4 text-[#5B9BF0]" /> Parties
        </h2>
        {!creating && canManage && (
          <button
            onClick={() => setCreating(true)}
            className="btn-primary text-xs flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> New party
          </button>
        )}
      </div>
      <p className="text-[11px] text-meta -mt-1">
        {canManage
          ? "Group players together for one-click targeting in events, music zones, and lobbies."
          : "Parties you've been added to. Ask an admin to create a party or add you to one."}
      </p>

      {creating && canManage && (
        <NewPartyForm
          loading={createMut.isPending}
          onSubmit={(b) => createMut.mutate(b)}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="space-y-2">
        {parties.length === 0 && !creating && (
          <p className="text-xs text-meta italic py-2 text-center">
            {canManage
              ? "No parties yet. Create one to group players for quick targeting."
              : "You're not in any parties yet."}
          </p>
        )}
        {parties.map((p) => (
          <PartyRow
            key={p.id}
            party={p}
            canManage={canManage}
            onDelete={() => {
              if (confirm(`Delete party "${p.name}"?`)) deleteMut.mutate(p.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── PartyRow ──────────────────────────────────────────────────────────────────

function PartyRow({
  party, onDelete, canManage,
}: {
  party:     PartyWithMembers;
  onDelete:  () => void;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing]   = useState(false);
  const [name, setName]         = useState(party.name);
  const [color, setColor]       = useState(party.color);
  const [description, setDesc]  = useState(party.description ?? "");
  const [addingMember, setAddingMember] = useState(false);

  const updateMut = useMutation({
    mutationFn: (body: { name: string; color: string; description?: string }) =>
      api.patch(`/parties/${party.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["parties"] });
      setEditing(false);
    },
  });
  const removeMemberMut = useMutation({
    mutationFn: (ign: string) =>
      api.delete(`/parties/${party.id}/members/${encodeURIComponent(ign)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parties"] }),
  });

  const hex = COLOR_HEX[party.color] ?? "#55FFFF";

  return (
    <div className="rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-[#F7F5F2] dark:bg-[#1E212B] p-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <span className="mt-1 w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${INPUT} w-full`}
                placeholder="Party name"
              />
              <input
                value={description}
                onChange={(e) => setDesc(e.target.value)}
                className={`${INPUT} w-full`}
                placeholder="Description (optional)"
              />
              <div className="flex items-center gap-1 flex-wrap">
                {COLOR_CHOICES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    title={c}
                    className={`w-5 h-5 rounded transition-transform hover:scale-110 ${
                      color === c ? "ring-2 ring-[#5B9BF0]" : "border border-[#D9D5D0] dark:border-[#363944]"
                    }`}
                    style={{ backgroundColor: COLOR_HEX[c] }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                  {party.name}
                </span>
                <span className="text-[10px] text-meta tabular-nums">
                  {party.members.length} member{party.members.length === 1 ? "" : "s"}
                </span>
              </div>
              {party.description && (
                <p className="text-[11px] text-meta truncate">{party.description}</p>
              )}
              <p className="text-[9px] text-meta">
                owned by {party.owner_email}
              </p>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {canManage && (editing ? (
            <>
              <button
                onClick={() => updateMut.mutate({ name: name.trim(), color, description: description.trim() || undefined })}
                disabled={updateMut.isPending || !name.trim()}
                className="btn-primary text-xs flex items-center gap-1"
              >
                <Save className="w-3 h-3" /> Save
              </button>
              <button
                onClick={() => { setEditing(false); setName(party.name); setColor(party.color); setDesc(party.description ?? ""); }}
                className="btn-secondary text-xs"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                title="Edit"
                className="p-1 rounded text-meta hover:text-[#5B9BF0] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F]/30"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onDelete}
                title="Delete"
                className="p-1 rounded text-meta hover:text-[#EF4444] hover:bg-[#FEE2E2] dark:hover:bg-[#7F1D1D]/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          ))}
        </div>
      </div>

      {/* Members */}
      <div className="flex items-center flex-wrap gap-1.5">
        {party.members.length === 0 && (
          <span className="text-[10px] text-meta italic">No members yet.</span>
        )}
        {party.members.map((m) => (
          <span
            key={m.player_ign}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white dark:bg-[#2A2D38] border border-[#D9D5D0] dark:border-[#363944] text-[10px]"
          >
            <img
              src={`https://mc-heads.net/avatar/${encodeURIComponent(m.player_ign)}/16`}
              alt=""
              className="w-3.5 h-3.5 rounded"
              loading="lazy"
            />
            <span className="text-[#1C1E27] dark:text-[#EAECF0] font-medium">{m.player_ign}</span>
            {canManage && (
              <button
                onClick={() => removeMemberMut.mutate(m.player_ign)}
                className="text-meta hover:text-[#EF4444] -mr-1"
                title="Remove"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        ))}
        {canManage && (!addingMember ? (
          <button
            onClick={() => setAddingMember(true)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed
                       border-[#D9D5D0] dark:border-[#363944] text-[10px] text-meta
                       hover:border-[#5B9BF0] hover:text-[#5B9BF0]"
          >
            <UserPlus className="w-3 h-3" /> Add
          </button>
        ) : (
          <AddMemberPicker
            partyId={party.id}
            existing={new Set(party.members.map((m) => m.player_ign))}
            onDone={() => setAddingMember(false)}
          />
        ))}
      </div>
    </div>
  );
}

// ── AddMemberPicker ──────────────────────────────────────────────────────────

function AddMemberPicker({
  partyId, existing, onDone,
}: {
  partyId:  number;
  existing: Set<string>;
  onDone:   () => void;
}) {
  const qc = useQueryClient();
  const { data: players = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn:  () => api.get("/mc/players"),
  });
  const addMut = useMutation({
    mutationFn: (ign: string) =>
      api.post(`/parties/${partyId}/members`, { ign }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["parties"] }),
  });

  const available = useMemo(
    () => players.filter((p) => !existing.has(p.ign))
                 .sort((a, b) => (a.online === b.online ? a.ign.localeCompare(b.ign) : a.online ? -1 : 1)),
    [players, existing],
  );

  return (
    <div className="relative inline-block">
      <select
        autoFocus
        onChange={(e) => {
          if (e.target.value) addMut.mutate(e.target.value);
        }}
        onBlur={onDone}
        defaultValue=""
        className={`${INPUT} text-[10px]`}
      >
        <option value="">— pick player —</option>
        {available.map((p) => (
          <option key={p.uuid || p.ign} value={p.ign}>
            {p.ign}{p.online ? " (online)" : ""}
          </option>
        ))}
      </select>
      <button
        onClick={onDone}
        className="ml-1 p-0.5 text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
        title="Done"
      >
        <UserMinus className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── NewPartyForm ─────────────────────────────────────────────────────────────

function NewPartyForm({
  loading, onSubmit, onCancel,
}: {
  loading:  boolean;
  onSubmit: (body: { name: string; color: string; description?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName]         = useState("");
  const [color, setColor]       = useState("aqua");
  const [description, setDesc]  = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), color, description: description.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border border-[#5B9BF0]/40 rounded-lg p-2.5 bg-[#F0F5FF]/50 dark:bg-[#181D2E]/50">
      <div>
        <label className={LBL}>Name</label>
        <input
          autoFocus
          type="text" value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Build Crew"
          maxLength={40}
          className={`${INPUT} w-full`}
        />
      </div>
      <div>
        <label className={LBL}>Description (optional)</label>
        <input
          type="text" value={description}
          onChange={(e) => setDesc(e.target.value)}
          maxLength={120}
          className={`${INPUT} w-full`}
        />
      </div>
      <div>
        <label className={LBL}>Color</label>
        <div className="flex items-center gap-1 flex-wrap">
          {COLOR_CHOICES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              title={c}
              className={`w-5 h-5 rounded transition-transform hover:scale-110 ${
                color === c ? "ring-2 ring-[#5B9BF0]" : "border border-[#D9D5D0] dark:border-[#363944]"
              }`}
              style={{ backgroundColor: COLOR_HEX[c] }}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">Cancel</button>
        <button type="submit" disabled={!name.trim() || loading} className="btn-primary text-xs">
          Create party
        </button>
      </div>
    </form>
  );
}

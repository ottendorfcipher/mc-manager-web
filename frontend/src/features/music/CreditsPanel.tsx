/**
 * Scrolling Credits: WYSIWYG editor and manager for cinematic text sequences
 * that play in-game when a player enters a music zone.
 *
 * Each credits sequence is a list of lines with type (heading/line/blank),
 * color, bold, and italic. Headings display as large centered title text,
 * lines scroll in chat.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Film, Plus, Trash2, Pencil, Eye, X, ChevronUp, ChevronDown,
  Bold, Italic, Heading2, AlignLeft, Minus,
} from "lucide-react";
import { SegmentedControl } from "@/components/SegmentedControl";
import { api } from "@/api/client";
import type { ScrollingCredits, CreditLine } from "@/types";

const INPUT = [
  "rounded-lg border border-[#D9D5D0] dark:border-[#363944]",
  "bg-white dark:bg-[#2A2D38] text-xs px-2.5 py-1.5",
  "text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]",
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]",
  "disabled:opacity-50",
].join(" ");
const LBL = "block text-[10px] font-medium text-meta uppercase tracking-wider mb-1";

/** Max visible characters per Minecraft chat line. */
const MC_CHAT_WIDTH = 53;

/** Minecraft named colors with CSS hex equivalents. */
const MC_COLORS: { value: string; label: string; hex: string }[] = [
  { value: "black",        label: "Black",        hex: "#000000" },
  { value: "dark_blue",    label: "Dark Blue",    hex: "#0000AA" },
  { value: "dark_green",   label: "Dark Green",   hex: "#00AA00" },
  { value: "dark_aqua",    label: "Dark Aqua",    hex: "#00AAAA" },
  { value: "dark_red",     label: "Dark Red",     hex: "#AA0000" },
  { value: "dark_purple",  label: "Dark Purple",  hex: "#AA00AA" },
  { value: "gold",         label: "Gold",         hex: "#FFAA00" },
  { value: "gray",         label: "Gray",         hex: "#AAAAAA" },
  { value: "dark_gray",    label: "Dark Gray",    hex: "#555555" },
  { value: "blue",         label: "Blue",         hex: "#5555FF" },
  { value: "green",        label: "Green",        hex: "#55FF55" },
  { value: "aqua",         label: "Aqua",         hex: "#55FFFF" },
  { value: "red",          label: "Red",          hex: "#FF5555" },
  { value: "light_purple", label: "Light Purple", hex: "#FF55FF" },
  { value: "yellow",       label: "Yellow",       hex: "#FFFF55" },
  { value: "white",        label: "White",        hex: "#FFFFFF" },
];

function colorHex(name: string): string {
  return MC_COLORS.find((c) => c.value === name)?.hex ?? "#FFFFFF";
}

function newLine(): CreditLine {
  return { type: "line", text: "", color: "white", bold: false, italic: false };
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function CreditsPanel() {
  const qc = useQueryClient();
  const { data: credits = [] } = useQuery<ScrollingCredits[]>({
    queryKey: ["credits"],
    queryFn:  () => api.get("/credits"),
  });

  const [creating, setCreating] = useState(false);
  const [editing,  setEditing]  = useState<ScrollingCredits | null>(null);

  const createMut = useMutation({
    mutationFn: (body: CreditsFormBody) => api.post("/credits", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credits"] });
      setCreating(false);
    },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...body }: CreditsFormBody & { id: number }) =>
      api.patch(`/credits/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["credits"] });
      setEditing(null);
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/credits/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["credits"] }),
  });
  const previewMut = useMutation({
    mutationFn: (id: number) => api.post(`/credits/${id}/preview`),
  });

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0] flex items-center gap-2">
          <Film className="w-4 h-4 text-[#F59E0B]" /> Scrolling Credits
        </h2>
        {!creating && !editing && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn-primary text-xs flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> New credits
          </button>
        )}
      </div>

      <p className="text-[11px] text-meta -mt-1">
        Cinematic text that scrolls on-screen when a player enters a zone.
        Headings flash as large centered title text; lines scroll in chat.
        Assign to a music zone to auto-trigger alongside music.
      </p>

      {/* Create / Edit form */}
      {(creating || editing) && (
        <CreditsEditor
          initial={editing ?? undefined}
          loading={createMut.isPending || updateMut.isPending}
          onCancel={() => { setCreating(false); setEditing(null); }}
          onSubmit={(body) => {
            if (editing) {
              updateMut.mutate({ ...body, id: editing.id });
            } else {
              createMut.mutate(body);
            }
          }}
        />
      )}

      {/* Credits list */}
      {!creating && !editing && (
        <div className="space-y-2">
          {credits.length === 0 && (
            <p className="text-xs text-meta italic py-2">
              No credits yet. Click <em>New credits</em> to create one.
            </p>
          )}
          {credits.map((c) => (
            <CreditCard
              key={c.id}
              credits={c}
              onEdit={() => setEditing(c)}
              onDelete={() => {
                if (confirm(`Delete credits "${c.name}"?`)) deleteMut.mutate(c.id);
              }}
              onPreview={() => previewMut.mutate(c.id)}
              previewing={previewMut.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── CreditCard ───────────────────────────────────────────────────────────────

function CreditCard({
  credits, onEdit, onDelete, onPreview, previewing,
}: {
  credits:    ScrollingCredits;
  onEdit:     () => void;
  onDelete:   () => void;
  onPreview:  () => void;
  previewing: boolean;
}) {
  const lines: CreditLine[] = useMemo(() => {
    try { return JSON.parse(credits.lines_json) as CreditLine[]; } catch { return []; }
  }, [credits.lines_json]);

  const scrollSecs = (credits.scroll_speed_ms / 1000).toFixed(1);

  return (
    <div className="rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                    bg-[#F7F5F2] dark:bg-[#1E212B] p-2.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            {credits.name}
          </span>
          <p className="text-[11px] text-meta mt-0.5">
            {lines.length} line{lines.length === 1 ? "" : "s"}
            {" · "}
            {scrollSecs}s/line
            {credits.freeze_player === 1 && " · freezes player"}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onPreview}
            disabled={previewing}
            title="Preview in-game"
            className="p-1 rounded text-meta hover:text-[#F59E0B] hover:bg-[#FEF3C7] dark:hover:bg-[#78350F]/30 disabled:opacity-40"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onEdit}
            title="Edit"
            className="p-1 rounded text-meta hover:text-[#5B9BF0] hover:bg-[#EFF6FF] dark:hover:bg-[#1E3A5F]/30"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete"
            className="p-1 rounded text-meta hover:text-[#EF4444] hover:bg-[#FEE2E2] dark:hover:bg-[#7F1D1D]/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────

interface CreditsFormBody {
  name:            string;
  lines_json:      string;
  scroll_speed_ms: number;
  freeze_player:   boolean;
}

function CreditsEditor({
  initial,
  loading,
  onSubmit,
  onCancel,
}: {
  initial?:  ScrollingCredits;
  loading:   boolean;
  onSubmit:  (body: CreditsFormBody) => void;
  onCancel:  () => void;
}) {
  const initialLines: CreditLine[] = useMemo(() => {
    if (!initial) return [newLine()];
    try {
      const parsed = JSON.parse(initial.lines_json) as CreditLine[];
      return parsed.length > 0 ? parsed : [newLine()];
    } catch { return [newLine()]; }
  }, [initial]);

  const [name, setName]           = useState(initial?.name ?? "");
  const [scrollSpeed, setScrollSpeed] = useState(
    (initial?.scroll_speed_ms ?? 1500) / 1000,
  );
  const [freezePlayer, setFreezePlayer] = useState(
    initial ? initial.freeze_player === 1 : true,
  );
  const [lines, setLines] = useState<CreditLine[]>(initialLines);

  const canSubmit = !!name.trim() && lines.length > 0 && !loading;

  // Immutable line updates
  const updateLine = useCallback((idx: number, patch: Partial<CreditLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }, []);

  const removeLine = useCallback((idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const moveLine = useCallback((idx: number, dir: -1 | 1) => {
    setLines((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }, []);

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, newLine()]);
  }, []);

  const addBlank = useCallback(() => {
    setLines((prev) => [...prev, { type: "blank", color: "white", bold: false, italic: false }]);
  }, []);

  const addHeading = useCallback(() => {
    setLines((prev) => [...prev, { type: "heading", text: "", color: "gold", bold: true, italic: false }]);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      name:            name.trim(),
      lines_json:      JSON.stringify(lines),
      scroll_speed_ms: Math.round(scrollSpeed * 1000),
      freeze_player:   freezePlayer,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border border-[#F59E0B]/30 rounded-lg p-3 bg-[#FFFBEB]/50 dark:bg-[#1E1A0E]/50">
      <h3 className="text-xs font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
        {initial ? `Edit "${initial.name}"` : "New scrolling credits"}
      </h3>

      {/* Name */}
      <div>
        <label className={LBL}>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="e.g. Build Competition Credits"
          className={`${INPUT} w-full`}
        />
      </div>

      {/* Speed + freeze */}
      <div className="flex flex-wrap gap-x-6 gap-y-2 items-end">
        <div>
          <label className={LBL}>Scroll speed</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0.5}
              max={5}
              step={0.1}
              value={scrollSpeed}
              onChange={(e) => setScrollSpeed(Math.max(0.5, Math.min(5, Number(e.target.value) || 1.5)))}
              className={`${INPUT} w-20 text-center`}
            />
            <span className="text-[10px] text-meta">sec/line</span>
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[#1C1E27] dark:text-[#EAECF0] cursor-pointer">
          <input
            type="checkbox"
            checked={freezePlayer}
            onChange={(e) => setFreezePlayer(e.target.checked)}
            className="accent-[#5B9BF0]"
          />
          Freeze player (darkness + slowness)
        </label>
      </div>

      {/* Line editor */}
      <div>
        <label className={LBL}>Lines</label>
        <div className="space-y-1.5">
          {lines.map((line, idx) => (
            <LineRow
              key={idx}
              line={line}
              idx={idx}
              total={lines.length}
              onChange={(patch) => updateLine(idx, patch)}
              onRemove={() => removeLine(idx)}
              onMove={(dir) => moveLine(idx, dir)}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <button type="button" onClick={addLine} className="btn-secondary text-[10px] px-2 py-1">
            + Line
          </button>
          <button type="button" onClick={addHeading} className="btn-secondary text-[10px] px-2 py-1">
            + Heading
          </button>
          <button type="button" onClick={addBlank} className="btn-secondary text-[10px] px-2 py-1">
            + Blank
          </button>
        </div>
      </div>

      {/* Preview */}
      <CreditsPreview lines={lines} />

      {/* Buttons */}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">Cancel</button>
        <button type="submit" disabled={!canSubmit} className="btn-primary text-xs">
          {initial ? "Save" : "Create credits"}
        </button>
      </div>
    </form>
  );
}

// ── LineRow ──────────────────────────────────────────────────────────────────

function LineRow({
  line, idx, total, onChange, onRemove, onMove,
}: {
  line:     CreditLine;
  idx:      number;
  total:    number;
  onChange: (patch: Partial<CreditLine>) => void;
  onRemove: () => void;
  onMove:   (dir: -1 | 1) => void;
}) {
  const charCount = (line.text ?? "").length;

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                    bg-white dark:bg-[#2A2D38] p-1.5">
      {/* Reorder */}
      <div className="flex flex-col gap-0 flex-shrink-0">
        <button type="button" onClick={() => onMove(-1)} disabled={idx === 0}
          className="p-0 text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0] disabled:opacity-20"
          aria-label="Move up">
          <ChevronUp className="w-3 h-3" />
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={idx === total - 1}
          className="p-0 text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0] disabled:opacity-20"
          aria-label="Move down">
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Line type — 3 fixed options, segmented control */}
      <SegmentedControl
        label="Line type"
        size="sm"
        value={line.type}
        onChange={(t) => {
          const patch: Partial<CreditLine> = { type: t };
          if (t === "heading") { patch.bold = true; patch.color = "gold"; }
          if (t === "blank") { patch.text = undefined; }
          if (t === "line" && !line.text) { patch.text = ""; }
          onChange(patch);
        }}
        options={[
          { value: "heading" as const, label: "H",    icon: Heading2,  title: "Heading — large centered title" },
          { value: "line"    as const, label: "Text",  icon: AlignLeft, title: "Text line — scrolls in chat" },
          { value: "blank"   as const, label: "—",     icon: Minus,     title: "Blank spacer line" },
        ]}
      />

      {line.type !== "blank" ? (
        <>
          {/* Color — swatch picker (pattern recognition, no label needed) */}
          <div className="relative flex-shrink-0 group">
            <button
              type="button"
              title={`Color: ${line.color}`}
              className="w-6 h-6 rounded border-2 border-[#D9D5D0] dark:border-[#555]
                         hover:border-[#5B9BF0] transition-colors"
              style={{ backgroundColor: colorHex(line.color) }}
            />
            <div className="absolute top-full left-0 mt-1 z-50 hidden group-focus-within:grid group-hover:grid
                            grid-cols-8 gap-0.5 p-1.5 rounded-lg shadow-xl
                            bg-white dark:bg-[#1C1E27] border border-[#D9D5D0] dark:border-[#363944]">
              {MC_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => onChange({ color: c.value })}
                  className={`w-5 h-5 rounded transition-transform hover:scale-125
                    ${line.color === c.value ? "ring-2 ring-[#5B9BF0] ring-offset-1" : ""}`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          {/* Bold / Italic */}
          <button
            type="button"
            onClick={() => onChange({ bold: !line.bold })}
            className={`p-1 rounded flex-shrink-0 ${
              line.bold
                ? "bg-[#5B9BF0] text-white"
                : "text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
            }`}
            title="Bold"
          >
            <Bold className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => onChange({ italic: !line.italic })}
            className={`p-1 rounded flex-shrink-0 ${
              line.italic
                ? "bg-[#5B9BF0] text-white"
                : "text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
            }`}
            title="Italic"
          >
            <Italic className="w-3 h-3" />
          </button>

          {/* Text input */}
          <input
            type="text"
            value={line.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder={line.type === "heading" ? "SECTION TITLE" : "Credit text..."}
            className={`${INPUT} flex-1 min-w-0 font-mono`}
          />

          {/* Character counter */}
          <span className={`text-[9px] font-mono tabular-nums flex-shrink-0 w-9 text-right ${
            charCount > MC_CHAT_WIDTH ? "text-[#EF4444] font-bold" : "text-meta"
          }`}>
            {charCount}/{MC_CHAT_WIDTH}
          </span>
        </>
      ) : (
        <span className="flex-1 text-[10px] text-meta italic">blank spacer</span>
      )}

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="p-1 rounded text-meta hover:text-[#EF4444] flex-shrink-0"
        title="Remove line"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────────

function CreditsPreview({ lines }: { lines: CreditLine[] }) {
  if (lines.length === 0) return null;

  return (
    <div>
      <label className={LBL}>Preview</label>
      <div className="rounded-lg border border-[#363944] bg-[#1A1A2E] p-4 space-y-1.5 max-h-64 overflow-y-auto">
        {lines.map((line, i) => {
          if (line.type === "blank") {
            return <div key={i} className="h-4" />;
          }
          if (line.type === "heading") {
            return (
              <div
                key={i}
                className="text-center py-1.5"
                style={{
                  color: colorHex(line.color),
                  fontWeight: line.bold ? 700 : 400,
                  fontStyle: line.italic ? "italic" : "normal",
                  fontSize: "16px",
                  fontFamily: "'Courier New', Courier, monospace",
                  letterSpacing: "0.05em",
                }}
              >
                {line.text || " "}
              </div>
            );
          }
          // "line"
          return (
            <div
              key={i}
              style={{
                color: colorHex(line.color),
                fontWeight: line.bold ? 700 : 400,
                fontStyle: line.italic ? "italic" : "normal",
                fontSize: "12px",
                fontFamily: "'Courier New', Courier, monospace",
                lineHeight: "1.4",
              }}
            >
              {line.text || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}

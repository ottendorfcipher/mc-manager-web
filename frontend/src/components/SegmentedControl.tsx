/**
 * SegmentedControl — replaces <select> for short, fixed option sets (2–5 items).
 *
 * UX rationale (NNG + IxD best practices):
 *   • Recognition over recall: all options visible simultaneously — no hidden
 *     items behind a click.  Users scan rather than remember.
 *   • Fitts's Law: full-width by default; each segment is a generously sized
 *     tap target.
 *   • Feedback: active segment has a solid fill; inactive is transparent —
 *     clear state without requiring a label.
 *   • Accessibility: role="radiogroup" / role="radio" with aria-checked.
 *
 * Use for: 2–5 mutually exclusive options where all labels are short (≤ 12 chars)
 * and the set is fixed (not dynamic).
 *
 * Keep <select> for: dynamic lists, long labels, or more than ~5 options.
 */

import React from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Optional icon component placed before the label. */
  icon?: React.ElementType;
  /** Optional tooltip text. */
  title?: string;
}

interface Props<T extends string> {
  options:   SegmentOption<T>[];
  value:     T;
  onChange:  (value: T) => void;
  disabled?: boolean;
  size?:     "sm" | "md";
  fullWidth?: boolean;
  /** aria-label for the group (used when there's no visible label above). */
  label?:    string;
}

export function SegmentedControl<T extends string>({
  options, value, onChange, disabled, size = "md", fullWidth = false, label,
}: Props<T>) {
  const base  = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const wrap  = `inline-flex rounded-lg bg-[#F0EDE9] dark:bg-[#2A2D38] p-0.5 gap-0.5
                 ${fullWidth ? "w-full" : ""}`;

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={wrap}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon   = opt.icon;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={opt.title ?? opt.label}
            onClick={() => onChange(opt.value)}
            className={`
              flex items-center justify-center gap-1.5 rounded-md font-medium
              transition-all duration-150 select-none flex-1
              focus-visible:ring-2 focus-visible:ring-[#5B9BF0] focus-visible:outline-none
              disabled:opacity-50 disabled:cursor-not-allowed
              ${base}
              ${active
                ? "bg-white dark:bg-[#363944] text-[#1C1E27] dark:text-[#EAECF0] shadow-sm"
                : "text-[#6B6E78] dark:text-[#9BA0B0] hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"}
            `}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

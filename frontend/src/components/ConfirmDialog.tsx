import { useEffect, useRef } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

type Variant = "danger" | "warning" | "default";

interface Props {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: Variant;
  isPending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const VARIANT_STYLES: Record<Variant, { icon: string; confirm: string }> = {
  danger:  { icon: "text-[#F87171] bg-[#FEF2F2] dark:bg-[#3B1F1F]",   confirm: "btn-danger" },
  warning: { icon: "text-warn bg-[#FFFBEB] dark:bg-[#3D2A00]",   confirm: "btn-secondary" },
  default: { icon: "text-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F]",   confirm: "btn-primary" },
};

/**
 * Reusable in-app confirmation dialog.
 * - Replaces all browser-native window.confirm() calls.
 * - Traps focus within the dialog.
 * - Closes on Escape key.
 * - Animates in with .modal-enter class.
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel  = "Cancel",
  variant      = "default",
  isPending    = false,
  onConfirm,
  onClose,
}: Props) {
  const panelRef   = useRef<HTMLDivElement>(null);
  const styles     = VARIANT_STYLES[variant];

  // Focus trap + Escape close
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const focusable = (): HTMLElement[] =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      );

    // Focus cancel button on open (safer default)
    focusable().at(-1)?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const els = focusable();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
    };

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 bg-black/40 z-50 scrim-enter"
        aria-hidden
        onClick={onClose}
      />
      {/* Panel */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
      >
        <div
          ref={panelRef}
          className="card max-w-sm w-full space-y-4 pointer-events-auto modal-enter"
        >
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${styles.icon}`}>
              <AlertTriangle className="w-4 h-4" aria-hidden />
            </div>
            <div>
              <h2 id="confirm-title" className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                {title}
              </h2>
              <p id="confirm-desc" className="text-sm text-meta mt-1">
                {description}
              </p>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              disabled={isPending}
              className="btn-secondary text-sm"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={isPending}
              className={`${styles.confirm} text-sm flex items-center gap-2`}
            >
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

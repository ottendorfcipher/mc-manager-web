import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Traps keyboard focus within a container when `active` is true.
 * Also closes the container on Escape key if `onClose` is provided.
 *
 * Usage:
 *   const trapRef = useFocusTrap(isOpen, () => setIsOpen(false));
 *   <div ref={trapRef} role="dialog" aria-modal="true">...</div>
 */
export function useFocusTrap(
  active: boolean,
  onClose?: () => void
): React.MutableRefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;

    const getFocusable = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // Focus first interactive element on mount
    const focusable = getFocusable();
    if (focusable.length) focusable[0].focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;

      const els = getFocusable();
      if (!els.length) return;

      const first = els[0];
      const last  = els[els.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, onClose]);

  return ref;
}

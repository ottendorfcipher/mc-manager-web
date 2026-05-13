/**
 * Toast notification system built on @radix-ui/react-toast.
 *
 * Usage:
 *   import { toast } from '@/components/Toast';
 *   toast.success('Player approved!');
 *   toast.error('Something went wrong.');
 *   toast.info('Config saved — server restarting…');
 *
 * Render <ToastContainer /> once in App.tsx (already done).
 */

import * as ToastPrimitive from "@radix-ui/react-toast";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { create } from "zustand";

// ── Store ────────────────────────────────────────────────────────────────────

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastStore {
  items: ToastItem[];
  add:   (message: string, type?: ToastType) => void;
  remove: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  items: [],
  add: (message, type = "info") =>
    set((s) => ({
      items: [
        ...s.items,
        { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, message, type },
      ],
    })),
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

// ── Public helper — call from anywhere, no hook needed ───────────────────────

export const toast = {
  success: (msg: string) => useToastStore.getState().add(msg, "success"),
  error:   (msg: string) => useToastStore.getState().add(msg, "error"),
  info:    (msg: string) => useToastStore.getState().add(msg, "info"),
};

// ── Icon map ─────────────────────────────────────────────────────────────────

const ICONS: Record<ToastType, React.ElementType> = {
  success: CheckCircle2,
  error:   XCircle,
  info:    Info,
};

// ── Toast container (render once in App root) ─────────────────────────────────

export function ToastContainer() {
  const { items, remove } = useToastStore();

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {items.map((item) => {
        const Icon = ICONS[item.type];
        return (
          <ToastPrimitive.Root
            key={item.id}
            open
            onOpenChange={(open) => { if (!open) remove(item.id); }}
            duration={4000}
            className="toast-root"
            data-type={item.type}
            // aria-live is provided by Radix's ToastProvider region
          >
            <Icon className="w-4 h-4 flex-shrink-0" aria-hidden />
            <ToastPrimitive.Description className="flex-1 text-sm">
              {item.message}
            </ToastPrimitive.Description>
            <ToastPrimitive.Close
              aria-label="Dismiss notification"
              className="opacity-60 hover:opacity-100 transition-opacity ml-1 flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}

      {/* Radix viewport — renders as an aria-live region automatically */}
      <ToastPrimitive.Viewport className="toast-viewport" />
    </ToastPrimitive.Provider>
  );
}

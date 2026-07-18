import { type ReactNode, useRef, useState } from "react";

/**
 * Google sign-in CTA.
 *
 * NN/g H1 (visibility of status): swaps label to "Signing you in…" + spinner
 * on click. Disabled after click to prevent double-submit (H5 error prevention).
 *
 * Gamification (empowerment of feedback): brief 200ms "block break" pulse
 * before navigation, skipped under reduced-motion.
 *
 * The redirect is a real navigation to /auth/login (HTTP GET) — keeping this
 * as an <a> preserves right-click / middle-click semantics and lets browsers
 * treat it as a normal link.
 */
export function LoginButton({
  soundOn,
  onBeforeNavigate,
  href = "/auth/login",
  label = "Continue with Google",
  icon,
  variant = "primary",
  testId = "login-cta",
}: {
  soundOn: boolean;
  onBeforeNavigate?: () => void;
  href?: string;
  label?: string;
  icon?: ReactNode;
  variant?: "primary" | "secondary";
  testId?: string;
}) {
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLAnchorElement | null>(null);
  const buttonClass =
    variant === "primary"
      ? "btn-primary w-full flex items-center justify-center gap-2 mc-cta"
      : "btn-secondary w-full flex items-center justify-center gap-2";

  // We deliberately DO NOT auto-focus the CTA — the skip-link must remain
  // the first tab stop for screen-reader users (NN/g accessibility heuristic).
  // Power users can still press Enter after one Tab+Tab.

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (pending) {
      e.preventDefault();
      return;
    }
    setPending(true);
    onBeforeNavigate?.();

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (soundOn && !reduced) {
      playBlockPlace();
    }
    // Let the browser perform the navigation naturally — no preventDefault.
  };

  return (
    <a
      ref={ref}
      href={href}
      onClick={handleClick}
      className={buttonClass}
      aria-busy={pending}
      data-testid={testId}
    >
      {pending ? (
        <>
          <span
            className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
            aria-hidden
          />
          <span>Signing you in…</span>
        </>
      ) : (
        <>
          {icon ?? <GoogleGlyph />}
          <span>{label}</span>
        </>
      )}
    </a>
  );
}

function GoogleGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export function CloudflareGlyph() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M16.7 16.5H6.9a3.4 3.4 0 0 1-.5-6.72 4.7 4.7 0 0 1 8.86-1.4 3.15 3.15 0 0 1 4.34 2.98 3.35 3.35 0 0 1-2.9 5.14z"
        fill="#F38020"
      />
    </svg>
  );
}

/** Short square-wave "block place" thunk via Web Audio. No asset download. */
function playBlockPlace() {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.13);
  } catch {
    /* audio is best-effort only */
  }
}

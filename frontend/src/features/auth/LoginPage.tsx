import { useEffect, useState } from "react";
import {
  Pickaxe, Volume2, VolumeX, X, Info, ChevronDown,
  Server, Map as MapIcon, Music2, Puzzle, Users, MessageSquare,
} from "lucide-react";
import { MinecraftBackdrop } from "./MinecraftBackdrop";
import { LoginButton, CloudflareGlyph } from "./LoginButton";
import { useLoginError } from "./useLoginError";

const SOUND_KEY = "mc_login_sound";

/**
 * Sign-in buttons. Google is always the primary action; Cloudflare appears as a
 * secondary option only when the server has it configured, keeping one clear
 * primary path (Hick's law) while still offering a second provider.
 */
function ProviderCtas({
  soundOn,
  cloudflareEnabled,
}: {
  soundOn: boolean;
  cloudflareEnabled: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="relative">
        <span className="mc-cta-glow" aria-hidden />
        <LoginButton soundOn={soundOn} />
      </div>
      {cloudflareEnabled && (
        <LoginButton
          soundOn={soundOn}
          href="/auth/login/cloudflare"
          label="Continue with Cloudflare"
          icon={<CloudflareGlyph />}
          variant="secondary"
          testId="login-cta-cloudflare"
        />
      )}
    </div>
  );
}

/**
 * Login splash page — a visual, marketing-style landing with a single, highly
 * salient sign-in CTA.
 *
 * Usability foundations:
 *  - NN/g H1 (status): LoginButton swaps to "Signing you in…" + spinner.
 *  - NN/g H6 (recognition > recall): the feature grid explains the product
 *    before asking the visitor to commit.
 *  - NN/g H8 (aesthetic + minimalist): one primary action; everything else is
 *    secondary/supportive.
 *  - Hick's law: exactly one decision (sign in with Google) — no competing CTAs.
 *  - Fitts's law / KLM-GOMS: a large, glowing primary target in the hero, plus
 *    an identical CTA at the page foot, so the goal is always ≤1 click away
 *    regardless of scroll position (minimised pointer travel + operator count).
 *  - Human factors: WCAG-AA tokens, semantic landmarks/headings, decorative
 *    visuals `aria-hidden`, all motion neutralised under prefers-reduced-motion.
 *  - Responsive: hero centers and reflows; feature grid is 1→2→3 columns.
 */

interface Feature {
  Icon: typeof Server;
  title: string;
  desc: string;
  color: string;
}

const FEATURES: Feature[] = [
  { Icon: Server,         title: "Server control",  desc: "Start, stop, switch worlds, and tune gamerules from anywhere.", color: "#5B9BF0" },
  { Icon: MapIcon,        title: "Live map",        desc: "Watch every player move across the world in real time.",        color: "#36B37E" },
  { Icon: Music2,         title: "Music & events",  desc: "Queue tracks and run countdowns, bounties, and lobbies.",       color: "#F59E0B" },
  { Icon: Puzzle,         title: "Plugins",         desc: "Browse and install PaperMC plugins from Modrinth in a click.",  color: "#A78BFA" },
  { Icon: Users,          title: "Team & parties",  desc: "Invite your crew, group up, and manage roles.",                 color: "#EC4899" },
  { Icon: MessageSquare,  title: "Chat bridge",     desc: "Web, Minecraft, and Discord chat — all in one live feed.",      color: "#22D3EE" },
];

// Decorative floating pixel blocks scattered around the hero (purely visual).
const HERO_BLOCKS = [
  { top: "14%", left: "12%", size: 26, color: "#36B37E", delay: "0s"   },
  { top: "26%", left: "82%", size: 34, color: "#5B9BF0", delay: "1.1s" },
  { top: "64%", left: "8%",  size: 22, color: "#8B6F4E", delay: "0.5s" },
  { top: "72%", left: "86%", size: 30, color: "#6B6E78", delay: "1.6s" },
  { top: "44%", left: "90%", size: 18, color: "#F59E0B", delay: "0.8s" },
];

export function LoginPage() {
  const [error, dismissError] = useLoginError();
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try { return localStorage.getItem(SOUND_KEY) === "on"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off"); } catch { /* ignore */ }
  }, [soundOn]);

  // Ask the server which login providers are configured so we only show the
  // Cloudflare button when it will actually work.
  const [cloudflareEnabled, setCloudflareEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/auth/providers", { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.cloudflare === "boolean") {
          setCloudflareEnabled(data.cloudflare);
        }
      })
      .catch(() => { /* leave the Cloudflare button hidden */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <MinecraftBackdrop />

      {/* Error banner — fixed so it stays visible regardless of scroll. */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="login-error"
          className="fixed top-3 inset-x-3 z-[60] mx-auto max-w-md mc-alert mc-card"
        >
          <div className="flex items-start gap-2 text-left">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#F87171]" aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">{error.title}</p>
              <p className="text-xs text-meta mt-0.5">{error.detail}</p>
            </div>
            <button onClick={dismissError} aria-label="Dismiss error"
                    className="text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]">
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <main id="main-content" role="main" className="relative z-10">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative min-h-[92vh] flex flex-col items-center justify-center text-center px-4 py-16">
          {/* Floating decorative blocks */}
          <div className="absolute inset-0 pointer-events-none hidden sm:block" aria-hidden>
            {HERO_BLOCKS.map((b, i) => (
              <span
                key={i}
                className="absolute pixel mc-float rounded-[3px]"
                style={{
                  top: b.top, left: b.left, width: b.size, height: b.size,
                  background: b.color, opacity: 0.5, animationDelay: b.delay,
                  boxShadow: "inset -3px -3px 0 rgba(0,0,0,0.18), inset 3px 3px 0 rgba(255,255,255,0.22)",
                }}
              />
            ))}
          </div>

          <div className="mc-logo-tile flex items-center justify-center">
            <Pickaxe className="w-8 h-8 text-[#5B9BF0] mc-pickaxe" aria-hidden />
          </div>

          <h1 className="mt-6 text-4xl sm:text-5xl font-extrabold tracking-tight text-[#1C1E27] dark:text-[#EAECF0]">
            redstoneCipher
          </h1>
          <p className="mt-3 max-w-md text-base sm:text-lg text-sub">
            Your whole Minecraft server — controlled from one beautiful place.
          </p>

          {/* Primary CTA — the focal point (glow + generous whitespace). */}
          <div className="mt-9 w-full max-w-xs">
            <ProviderCtas soundOn={soundOn} cloudflareEnabled={cloudflareEnabled} />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-meta">
            <span className="mc-badge" title="Access is restricted. Ask an admin to invite your Google account."
                  data-testid="invite-badge">
              Invite-only
            </span>
            <span aria-hidden>·</span>
            <a href="/privacy" className="underline hover:text-[#5B9BF0] transition-colors">Privacy</a>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={() => setSoundOn((v) => !v)}
              aria-pressed={soundOn}
              aria-label={soundOn ? "Mute sign-in sounds" : "Enable sign-in sounds"}
              className="inline-flex items-center gap-1 hover:text-[#1C1E27] dark:hover:text-[#EAECF0] transition-colors"
              data-testid="sound-toggle"
            >
              {soundOn ? <Volume2 className="w-3.5 h-3.5" aria-hidden /> : <VolumeX className="w-3.5 h-3.5" aria-hidden />}
              <span>Sounds {soundOn ? "on" : "off"}</span>
            </button>
          </div>

          {/* Scroll affordance to the feature showcase. */}
          <a href="#features"
             className="mt-12 inline-flex flex-col items-center gap-1 text-xs text-meta hover:text-[#5B9BF0] transition-colors">
            <span>See what's inside</span>
            <ChevronDown className="w-4 h-4 mc-scroll-hint" aria-hidden />
          </a>
        </section>

        {/* ── Feature showcase ─────────────────────────────────────────────── */}
        <section id="features" className="px-4 py-16 max-w-5xl mx-auto scroll-mt-8">
          <h2 className="text-center text-2xl sm:text-3xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">
            Everything your server needs
          </h2>
          <p className="mt-2 text-center text-sm text-meta max-w-lg mx-auto">
            One portal for running the world, your team, and everything in between.
          </p>

          <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <li key={f.title}
                  className="card mc-card mc-rise text-left"
                  style={{ animationDelay: `${i * 70}ms` }}>
                <div className="mc-feature-tile"
                     style={{ backgroundColor: `${f.color}1f`, borderColor: `${f.color}55` }}>
                  <f.Icon className="w-6 h-6" style={{ color: f.color }} aria-hidden />
                </div>
                <h3 className="mt-3 font-semibold text-[#1C1E27] dark:text-[#EAECF0]">{f.title}</h3>
                <p className="mt-1 text-sm text-meta">{f.desc}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Closing CTA — goal reachable without scrolling back up ────────── */}
        <section className="px-4 pb-20 pt-4">
          <div className="card mc-card max-w-md mx-auto text-center py-10 space-y-5">
            <div className="flex justify-center">
              <div className="mc-logo-tile flex items-center justify-center">
                <Pickaxe className="w-8 h-8 text-[#5B9BF0] mc-pickaxe" aria-hidden />
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Ready to dive in?</h2>
              <p className="mt-1 text-sm text-meta">
                Sign in with the Google account your admin invited.
              </p>
            </div>
            <div className="w-full max-w-xs mx-auto">
              <ProviderCtas soundOn={soundOn} cloudflareEnabled={cloudflareEnabled} />
            </div>
            <p className="text-xs text-meta">
              By signing in you agree to our{" "}
              <a href="/privacy" className="underline hover:text-[#5B9BF0] transition-colors">Privacy Notice</a>.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}

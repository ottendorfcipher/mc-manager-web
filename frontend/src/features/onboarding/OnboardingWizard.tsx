import { useState } from "react";
import { create } from "zustand";
import {
  Pickaxe, Globe,
  ChevronRight, ChevronLeft, CheckCircle2,
  ExternalLink, X, Monitor, Smartphone, Terminal,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { useNavigate } from "react-router-dom";

// ── localStorage key ──────────────────────────────────────────────────────────
export const ONBOARDING_KEY = "rsc_onboarding_done";
export const isOnboardingComplete = () =>
  localStorage.getItem(ONBOARDING_KEY) === "1";
export const markOnboardingComplete = () =>
  localStorage.setItem(ONBOARDING_KEY, "1");

// ── Re-open control ───────────────────────────────────────────────────────────
// Lets any component (e.g. a "Setup guide" button in the Layout) re-launch the
// wizard on demand, separate from the first-login auto-show.
interface OnboardingUI {
  isOpen: boolean;
  openWizard: () => void;
  closeWizard: () => void;
}
export const useOnboardingStore = create<OnboardingUI>((set) => ({
  isOpen: false,
  openWizard: () => set({ isOpen: true }),
  closeWizard: () => set({ isOpen: false }),
}));

// ── Platform detection ────────────────────────────────────────────────────────
function detectPlatform(): "mac" | "windows" | "ios" | "android" | "linux" {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/mac/.test(ua)) return "mac";
  if (/win/.test(ua)) return "windows";
  return "linux";
}

const TAILSCALE_LINKS: Record<string, { label: string; url: string; icon: React.ElementType }> = {
  mac:     { label: "Download for macOS",  url: "https://tailscale.com/download/mac",     icon: Monitor },
  windows: { label: "Download for Windows", url: "https://tailscale.com/download/windows", icon: Monitor },
  ios:     { label: "Get on App Store",     url: "https://apps.apple.com/app/tailscale/id1470499037", icon: Smartphone },
  android: { label: "Get on Google Play",   url: "https://play.google.com/store/apps/details?id=com.tailscale.ipn.android", icon: Smartphone },
  linux:   { label: "Install on Linux",     url: "https://tailscale.com/download/linux",   icon: Terminal },
};

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: "welcome",    title: "You're in!" },
  { id: "tailscale",  title: "Install Tailscale" },
  { id: "join",       title: "Join the Network" },
  { id: "minecraft",  title: "Connect to Minecraft" },
  { id: "tour",       title: "Explore the Portal" },
];

// ── Main wizard ───────────────────────────────────────────────────────────────
export function OnboardingWizard({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep]   = useState(0);
  const { user }          = useAuthStore();
  const navigate          = useNavigate();
  const platform          = detectPlatform();
  const tsLink            = TAILSCALE_LINKS[platform];

  const isFirst  = step === 0;
  const isLast   = step === STEPS.length - 1;

  const prev = () => setStep((s) => Math.max(0, s - 1));
  const next = () => {
    if (isLast) { finish(); return; }
    setStep((s) => s + 1);
  };

  const finish = () => {
    markOnboardingComplete();
    onDismiss();
  };

  return (
    <>
      {/* Scrim */}
      <div className="fixed inset-0 bg-black/50 z-[300] scrim-enter" aria-hidden />

      {/* Wizard panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="fixed inset-0 flex items-center justify-center z-[300] p-4 pointer-events-none"
      >
        <div className="pointer-events-auto bg-white dark:bg-[#1C1E27] rounded-2xl shadow-2xl
                        w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden modal-enter">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4
                          border-b border-[#D9D5D0] dark:border-[#363944] flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <Pickaxe className="w-5 h-5 text-[#5B9BF0]" aria-hidden />
              <span className="font-bold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                redstoneCipher
              </span>
            </div>
            <button
              onClick={finish}
              aria-label="Skip onboarding"
              className="p-1.5 rounded-lg text-meta hover:text-[#1C1E27] dark:hover:text-[#EAECF0]
                         hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] transition-colors"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>

          {/* Progress bar */}
          <div className="flex gap-1 px-6 pt-4 flex-shrink-0">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`flex-1 h-1 rounded-full transition-colors duration-300 ${
                  i <= step ? "bg-[#5B9BF0]" : "bg-[#D9D5D0] dark:bg-[#363944]"
                }`}
              />
            ))}
          </div>

          {/* Step label */}
          <p className="px-6 pt-2 text-xs text-meta flex-shrink-0">
            Step {step + 1} of {STEPS.length} — {STEPS[step].title}
          </p>

          {/* Step content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {step === 0 && <StepWelcome name={user?.display_name ?? "there"} />}
            {step === 1 && <StepTailscale tsLink={tsLink} platform={platform} />}
            {step === 2 && <StepJoin />}
            {step === 3 && <StepMinecraft />}
            {step === 4 && <StepTour navigate={navigate} finish={finish} />}
          </div>

          {/* Footer navigation */}
          <div className="flex items-center justify-between px-6 py-4
                          border-t border-[#D9D5D0] dark:border-[#363944] flex-shrink-0">
            <button
              onClick={prev}
              disabled={isFirst}
              className="flex items-center gap-1.5 text-sm btn-secondary disabled:opacity-0
                         disabled:pointer-events-none px-3 py-2"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Back
            </button>
            <button
              id="onboarding-title"
              onClick={next}
              className="flex items-center gap-1.5 text-sm btn-primary px-4 py-2"
            >
              {isLast ? (
                <><CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> All done!</>
              ) : (
                <>Next <ChevronRight className="w-3.5 h-3.5" aria-hidden /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Step 1: Welcome ───────────────────────────────────────────────────────────
function StepWelcome({ name }: { name: string }) {
  return (
    <div className="space-y-4 py-2">
      <div className="text-center">
        <div className="text-5xl mb-3">🎉</div>
        <h2 className="text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">
          Welcome, {name}!
        </h2>
        <p className="text-sm text-meta mt-2 leading-relaxed">
          You've been invited to a private Minecraft server. This quick guide will
          get you connected in about 5 minutes.
        </p>
      </div>

      <div className="space-y-2">
        {[
          { icon: "📱", label: "Install Tailscale", desc: "Our secure private network" },
          { icon: "🔗", label: "Join the tailnet",  desc: "Connect to the server's network" },
          { icon: "🎮", label: "Open Minecraft",    desc: "Add the server address and play" },
          { icon: "🗺️", label: "Explore the portal", desc: "Chat, map, inventory, and more" },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-3 p-3 rounded-xl bg-[#F7F5F2] dark:bg-[#2A2D38]"
          >
            <span className="text-xl w-8 text-center" aria-hidden>{item.icon}</span>
            <div>
              <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                {item.label}
              </p>
              <p className="text-xs text-meta">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 2: Install Tailscale ─────────────────────────────────────────────────
function StepTailscale({
  tsLink,
  platform,
}: {
  tsLink: { label: string; url: string; icon: React.ElementType };
  platform: string;
}) {
  const TsIcon = tsLink.icon;
  return (
    <div className="space-y-4 py-2">
      <div>
        <h2 className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
          Install Tailscale
        </h2>
        <p className="text-sm text-meta mt-1 leading-relaxed">
          Tailscale creates a secure private network between your device and the
          Minecraft server. It's free and takes about 2 minutes to set up.
        </p>
      </div>

      {/* Primary download button (platform-detected) */}
      <a
        href={tsLink.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between gap-3 p-4 rounded-xl
                   bg-[#5B9BF0] text-white no-underline group hover:bg-[#4A8ADF]
                   transition-colors"
      >
        <div className="flex items-center gap-3">
          <TsIcon className="w-5 h-5" aria-hidden />
          <div>
            <p className="font-semibold text-sm">{tsLink.label}</p>
            <p className="text-xs opacity-75 capitalize">{platform}</p>
          </div>
        </div>
        <ExternalLink className="w-4 h-4 opacity-75" aria-hidden />
      </a>

      {/* All platforms */}
      <div>
        <p className="text-xs text-meta mb-2 font-semibold uppercase tracking-wide">
          Other platforms
        </p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(TAILSCALE_LINKS)
            .filter(([key]) => key !== platform)
            .map(([key, link]) => {
              const Icon = link.icon;
              return (
                <a
                  key={key}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2.5 rounded-lg border
                             border-[#D9D5D0] dark:border-[#363944] text-xs
                             text-[#1C1E27] dark:text-[#EAECF0] no-underline
                             hover:bg-[#F0EDE9] dark:hover:bg-[#2A2D38] transition-colors"
                >
                  <Icon className="w-3.5 h-3.5 text-meta flex-shrink-0" aria-hidden />
                  <span className="capitalize">{key}</span>
                </a>
              );
            })}
        </div>
      </div>

      <div className="rounded-xl bg-[#ECFDF5] dark:bg-[#052e16] p-3 text-xs text-[#065f46] dark:text-[#6EE7B7]">
        💡 Tailscale is free for personal use and doesn't require any configuration
        beyond signing in with Google or another provider.
      </div>
    </div>
  );
}

// ── Step 3: Join the tailnet ──────────────────────────────────────────────────
function StepJoin() {
  return (
    <div className="space-y-4 py-2">
      <div>
        <h2 className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
          Join the Tailscale Network
        </h2>
        <p className="text-sm text-meta mt-1 leading-relaxed">
          After installing Tailscale, you need to join the server's private
          network. Your admin will have sent an invite link — check your email!
        </p>
      </div>

      <div className="space-y-3">
        <Step num={1} label="Open the invite email" desc='Look for an email from "redstoneCipher" with a blue "Accept Tailscale Invite" button.' />
        <Step num={2} label="Click Accept Invite" desc="This opens Tailscale in your browser and adds you to the private network automatically." />
        <Step num={3} label="Confirm in the app" desc='Open the Tailscale app on your device — you should see "Connected" and the server address in the list.' />
      </div>

      <div className="rounded-xl bg-[#FEF3C7] dark:bg-[#3D2A00] p-3 text-xs text-warn dark:text-[#FCD34D]">
        📬 No email? Ask your admin to resend the invite via the redstoneCipher admin portal, or send you the Tailscale invite URL directly.
      </div>

      <a
        href="https://tailscale.com/kb/1080/cli"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-xs text-[#5B9BF0] hover:underline no-underline"
      >
        <ExternalLink className="w-3 h-3" aria-hidden />
        Tailscale docs — troubleshooting
      </a>
    </div>
  );
}

// ── Step 4: Connect to Minecraft ──────────────────────────────────────────────
function StepMinecraft() {
  // The Tailscale IP is the same one shown on the Dashboard
  // We don't have access to it here without an API call, so we show a placeholder
  // that the admin can customise. For now, direct them to the Dashboard.
  return (
    <div className="space-y-4 py-2">
      <div>
        <h2 className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
          Connect to Minecraft
        </h2>
        <p className="text-sm text-meta mt-1 leading-relaxed">
          Once Tailscale is running and connected, fire up Minecraft Java Edition
          and add the server.
        </p>
      </div>

      <div className="space-y-3">
        <Step num={1} label='Open Minecraft Java Edition' desc='Launch the game, go to "Multiplayer", then "Add Server".' />
        <Step num={2} label="Enter the server address" desc="You'll find the exact address on the Dashboard page of this portal." />
        <Step num={3} label="Connect!" desc="The server runs Spigot 1.21. Make sure your Minecraft client version matches." />
      </div>

      <div className="rounded-xl bg-[#F7F5F2] dark:bg-[#2A2D38] p-4 space-y-2">
        <p className="text-xs font-semibold text-meta uppercase tracking-wide">
          Where to find the address
        </p>
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-[#5B9BF0] flex-shrink-0" aria-hidden />
          <span className="text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            Dashboard page → "Connect in Minecraft" box
          </span>
        </div>
        <p className="text-xs text-meta">
          Port 25565 · Java Edition · Tailscale must be connected
        </p>
      </div>

      <div className="rounded-xl bg-[#EFF6FF] dark:bg-[#1E3A5F] p-3 text-xs text-[#1e40af] dark:text-[#93C5FD]">
        🛡️ The server is private — it's only reachable through Tailscale. If you
        can't connect, make sure Tailscale shows "Connected" in the menu bar.
      </div>
    </div>
  );
}

// ── Step 5: Portal tour ───────────────────────────────────────────────────────
function StepTour({
  navigate,
  finish,
}: {
  navigate: (path: string) => void;
  finish: () => void;
}) {
  const features = [
    {
      path: "/",
      icon: "📊",
      label: "Dashboard",
      desc: "Live server status, metrics, and your Tailscale IP.",
    },
    {
      path: "/chat",
      icon: "💬",
      label: "Chat",
      desc: "Send messages to players in-game and see chat history.",
    },
    {
      path: "/players",
      icon: "🎒",
      label: "Inventory",
      desc: "View your current in-game inventory and location.",
    },
    {
      path: "/map",
      icon: "🗺️",
      label: "Map",
      desc: "Live BlueMap 3D view of the world with player positions.",
    },
    {
      path: "/team",
      icon: "👥",
      label: "Team",
      desc: "See who else is on the server and their linked accounts.",
    },
  ];

  return (
    <div className="space-y-4 py-2">
      <div>
        <h2 className="text-lg font-bold text-[#1C1E27] dark:text-[#EAECF0]">
          You're all set! 🎉
        </h2>
        <p className="text-sm text-meta mt-1">
          Here's a quick look at what's available in the portal.
          Click any feature to jump straight there.
        </p>
      </div>

      <div className="space-y-2">
        {features.map((f) => (
          <button
            key={f.path}
            onClick={() => { finish(); navigate(f.path); }}
            className="w-full flex items-center gap-3 p-3 rounded-xl text-left
                       bg-[#F7F5F2] dark:bg-[#2A2D38] hover:bg-[#EFF6FF]
                       dark:hover:bg-[#1E3A5F] transition-colors group"
          >
            <span className="text-2xl w-8 text-center flex-shrink-0" aria-hidden>{f.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]
                           group-hover:text-[#5B9BF0] transition-colors">
                {f.label}
              </p>
              <p className="text-xs text-meta truncate">{f.desc}</p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-meta flex-shrink-0" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Shared: numbered step ─────────────────────────────────────────────────────
function Step({ num, label, desc }: { num: number; label: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div
        className="w-6 h-6 rounded-full bg-[#5B9BF0] text-white text-[11px]
                   font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
        aria-hidden
      >
        {num}
      </div>
      <div>
        <p className="text-sm font-semibold text-[#1C1E27] dark:text-[#EAECF0]">{label}</p>
        <p className="text-xs text-meta mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

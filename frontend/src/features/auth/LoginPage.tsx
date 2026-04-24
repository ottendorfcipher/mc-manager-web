import { useEffect, useState } from "react";
import { Pickaxe, Volume2, VolumeX, X, Info } from "lucide-react";
import { MinecraftBackdrop } from "./MinecraftBackdrop";
import { LoginButton } from "./LoginButton";
import { useLoginError } from "./useLoginError";

const SOUND_KEY = "mc_login_sound";

/**
 * Login splash page.
 *
 * Structure:
 *   [skip-link] -> [main landmark] -> [error banner?] -> [brand] -> [CTA] -> [microfooter]
 *
 * NN/g heuristics applied throughout — see inline comments and plan.
 * Gamification: epic meaning (tagline), empowerment of feedback (hover +
 * optional audio), scarcity (invite-only badge).
 */
export function LoginPage() {
  const [error, dismissError] = useLoginError();
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SOUND_KEY) === "on";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, [soundOn]);

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <MinecraftBackdrop />

      <main
        id="main-content"
        role="main"
        className="min-h-screen flex items-center justify-center px-4"
      >
        <div className="card mc-card max-w-sm w-full text-center space-y-6 py-10 relative z-10">
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="mc-alert"
              data-testid="login-error"
            >
              <div className="flex items-start gap-2 text-left">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-[#F87171]" aria-hidden />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
                    {error.title}
                  </p>
                  <p className="text-xs text-[#6B6E78] dark:text-[#9BA0B0] mt-0.5">
                    {error.detail}
                  </p>
                </div>
                <button
                  onClick={dismissError}
                  aria-label="Dismiss error"
                  className="text-[#9B9EA6] hover:text-[#1C1E27] dark:hover:text-[#EAECF0]"
                >
                  <X className="w-4 h-4" aria-hidden />
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-center">
            <div className="mc-logo-tile flex items-center justify-center">
              <Pickaxe className="w-8 h-8 text-[#5B9BF0] mc-pickaxe" aria-hidden />
            </div>
          </div>

          <div>
            <h1 className="text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">
              redstoneCipher
            </h1>
            <p className="mt-1 text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
              Forge your cipher. The server awaits.
            </p>
          </div>

          <LoginButton soundOn={soundOn} />

          <div className="flex items-center justify-between text-xs text-[#9B9EA6] dark:text-[#626878]">
            <span
              className="mc-badge"
              title="Access is restricted. Ask an admin to invite your Google account."
              data-testid="invite-badge"
            >
              Invite-only
            </span>

            <button
              type="button"
              onClick={() => setSoundOn((v) => !v)}
              aria-pressed={soundOn}
              aria-label={soundOn ? "Mute sign-in sounds" : "Enable sign-in sounds"}
              className="flex items-center gap-1 hover:text-[#1C1E27] dark:hover:text-[#EAECF0] transition-colors"
              data-testid="sound-toggle"
            >
              {soundOn ? (
                <Volume2 className="w-3.5 h-3.5" aria-hidden />
              ) : (
                <VolumeX className="w-3.5 h-3.5" aria-hidden />
              )}
              <span>Sounds {soundOn ? "on" : "off"}</span>
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

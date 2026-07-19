import { useMemo, useState, type FormEvent } from "react";
import { Pickaxe, Copy, Check, ChevronDown, Loader2 } from "lucide-react";
import { MinecraftBackdrop } from "@/features/auth/MinecraftBackdrop";

/**
 * First-run setup wizard. Shown before the login screen when the app is not yet
 * configured. Saves config to the server, which restarts to apply it.
 *
 * Design: one screen, one primary action. Meaning is carried by grouping and
 * color; text stays short. The one thing that must be copied exactly (the Google
 * redirect URI) is visually elevated with a copy affordance.
 */
export interface SetupStatus {
  needs_setup: boolean;
  redirect_uri: string;
  site_url: string;
  token_required: boolean;
}

const input =
  "w-full rounded-lg border border-[#E5E1DC] dark:border-[#363944] " +
  "bg-white dark:bg-[#1E212B] px-3 py-2 text-sm text-[#1C1E27] dark:text-[#EAECF0] " +
  "focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]";
const label = "block text-xs font-medium text-meta mb-1";

export function SetupWizard({ status }: { status: SetupStatus }) {
  const [siteUrl, setSiteUrl] = useState(status.site_url);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [token, setToken] = useState("");
  const [showCf, setShowCf] = useState(false);
  const [cfTeam, setCfTeam] = useState("");
  const [cfId, setCfId] = useState("");
  const [cfSecret, setCfSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const [phase, setPhase] = useState<"form" | "saving" | "applying">("form");
  const [error, setError] = useState("");

  const redirectUri = useMemo(
    () => siteUrl.replace(/\/+$/, "") + "/auth/callback",
    [siteUrl],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard may be blocked; the value is visible anyway */ }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setPhase("saving");
    try {
      const res = await fetch("/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_url: siteUrl,
          google_client_id: clientId,
          google_client_secret: clientSecret,
          bootstrap_admin_email: adminEmail,
          cloudflare_team_domain: showCf ? cfTeam : null,
          cloudflare_client_id: showCf ? cfId : null,
          cloudflare_client_secret: showCf ? cfSecret : null,
          setup_token: status.token_required ? token : null,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || "Setup failed. Check the values and try again.");
        setPhase("form");
        return;
      }
      // Saved. The server restarts; poll until it is configured, then go to login.
      setPhase("applying");
      const started = Date.now();
      const poll = async () => {
        try {
          const s: SetupStatus = await fetch("/auth/setup/status").then((r) => r.json());
          if (!s.needs_setup) { window.location.href = "/login"; return; }
        } catch { /* server mid-restart */ }
        if (Date.now() - started < 90_000) setTimeout(poll, 2000);
        else { setError("Restart is taking longer than expected. Check the server logs."); setPhase("form"); }
      };
      setTimeout(poll, 3000);
    } catch {
      setError("Could not reach the server.");
      setPhase("form");
    }
  };

  if (phase === "applying") {
    return (
      <>
        <MinecraftBackdrop />
        <main role="main" className="relative z-10 min-h-screen flex flex-col items-center justify-center text-center px-4">
          <Loader2 className="w-8 h-8 text-[#5B9BF0] animate-spin" aria-hidden />
          <h1 className="mt-6 text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Applying your settings</h1>
          <p className="mt-2 text-sm text-meta">The server is restarting. This takes a few seconds.</p>
        </main>
      </>
    );
  }

  return (
    <>
      <MinecraftBackdrop />
      <main role="main" className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-10">
        <div className="mc-logo-tile flex items-center justify-center">
          <Pickaxe className="w-8 h-8 text-[#5B9BF0]" aria-hidden />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-[#1C1E27] dark:text-[#EAECF0]">
          Set up redstoneCipher
        </h1>
        <p className="mt-1 text-sm text-meta">One time, then you are in.</p>

        <form onSubmit={submit} className="card mc-card w-full max-w-md mt-6 space-y-4 text-left">
          {error && (
            <p role="alert" className="mc-alert text-sm text-[#B91C1C] dark:text-[#F87171]">{error}</p>
          )}

          <div>
            <label className={label} htmlFor="siteUrl">Site URL</label>
            <input id="siteUrl" className={input} value={siteUrl}
                   onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://your-domain.com" />
          </div>

          {/* The exact value to paste into Google, elevated. */}
          <div className="rounded-lg border-2 border-[#5B9BF0]/40 bg-[#5B9BF0]/10 p-3">
            <p className="text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0]">
              Add this redirect URI in your{" "}
              <a className="underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
                Google OAuth client
              </a>
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate text-xs text-[#1C1E27] dark:text-[#EAECF0]">{redirectUri}</code>
              <button type="button" onClick={copy} aria-label="Copy redirect URI"
                      className="btn-secondary px-2 py-1 flex items-center gap-1 text-xs">
                {copied ? <Check className="w-3.5 h-3.5 text-[#36B37E]" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className={label} htmlFor="clientId">Google client ID</label>
              <input id="clientId" className={input} value={clientId} autoComplete="off"
                     onChange={(e) => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" />
            </div>
            <div>
              <label className={label} htmlFor="clientSecret">Google client secret</label>
              <input id="clientSecret" className={input} value={clientSecret} type="password" autoComplete="off"
                     onChange={(e) => setClientSecret(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="adminEmail">Your Google email (becomes admin)</label>
              <input id="adminEmail" className={input} value={adminEmail} type="email"
                     onChange={(e) => setAdminEmail(e.target.value)} placeholder="you@example.com" />
            </div>
          </div>

          {status.token_required && (
            <div>
              <label className={label} htmlFor="token">Setup token</label>
              <input id="token" className={input} value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
          )}

          {/* Optional Cloudflare, collapsed by default to keep the primary path short. */}
          <button type="button" onClick={() => setShowCf((v) => !v)}
                  className="flex items-center gap-1 text-xs text-meta hover:text-[#5B9BF0]">
            <ChevronDown className={"w-4 h-4 transition-transform " + (showCf ? "rotate-180" : "")} aria-hidden />
            Add Cloudflare Access sign-in (optional)
          </button>
          {showCf && (
            <div className="grid grid-cols-1 gap-3 pl-1">
              <input className={input} value={cfTeam} onChange={(e) => setCfTeam(e.target.value)} placeholder="Cloudflare team (myteam)" />
              <input className={input} value={cfId} onChange={(e) => setCfId(e.target.value)} placeholder="Cloudflare client ID" />
              <input className={input} value={cfSecret} type="password" onChange={(e) => setCfSecret(e.target.value)} placeholder="Cloudflare client secret" />
            </div>
          )}

          <button type="submit" disabled={phase === "saving"}
                  className="btn-primary w-full flex items-center justify-center gap-2">
            {phase === "saving" ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
            {phase === "saving" ? "Saving…" : "Save and start"}
          </button>
        </form>
      </main>
    </>
  );
}

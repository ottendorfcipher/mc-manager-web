import { useEffect, useState } from "react";

/**
 * Known error codes emitted by the backend callback, mapped to user-facing copy.
 * NN/g H9: speak the user's language, help them recover.
 */
const ERROR_COPY: Record<string, { title: string; detail: string }> = {
  oauth_denied: {
    title: "Sign-in canceled",
    detail: "You dismissed the Google consent screen. Try again when you're ready.",
  },
  state_mismatch: {
    title: "Security check failed",
    detail:
      "The sign-in request didn't match this browser session. Close any other sign-in tabs and try again.",
  },
  token_exchange: {
    title: "Google couldn't verify this app",
    detail:
      "Google rejected the redirect URI the backend sent. In the Google Cloud Console, open your OAuth 2.0 Client ID and add the URI that matches your backend's REDIRECT_URI under Authorized redirect URIs. For example https://your-domain.com/auth/callback in production, or http://localhost:5173/auth/callback in local dev.",
  },
  not_invited: {
    title: "Access not granted",
    detail:
      "Your Google account hasn't been whitelisted. Ask a server admin to add your email address. " +
      "Admins can whitelist users in Admin → Users → Whitelist User. The whitelist permission can also be delegated to other roles.",
  },
  unknown: {
    title: "Something went wrong",
    detail: "Please try again. If the problem persists, contact the admin.",
  },
};

export type LoginError = {
  code: string;
  title: string;
  detail: string;
};

/** Derive the initial error state from the URL synchronously — no cascading render. */
function initialError(): LoginError | null {
  if (typeof window === "undefined") return null;
  const code = new URLSearchParams(window.location.search).get("error");
  if (!code) return null;
  const copy = ERROR_COPY[code] ?? ERROR_COPY.unknown;
  return { code, ...copy };
}

export function useLoginError(): [LoginError | null, () => void] {
  const [error, setError] = useState<LoginError | null>(initialError);

  // Escape clears the banner (NN/g H3: user control & freedom).
  useEffect(() => {
    if (!error) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setError(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [error]);

  const dismiss = () => {
    setError(null);
    // Clean the URL so a refresh doesn't re-surface the error.
    const url = new URL(window.location.href);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", url.toString());
  };

  return [error, dismiss];
}

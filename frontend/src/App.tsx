import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { toast } from "@/components/Toast";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { KillSwitchBanner } from "@/components/KillSwitchBanner";
import { ErrorBoundary }    from "@/components/ErrorBoundary";
import { ToastContainer }   from "@/components/Toast";
import { DashboardPage }    from "@/features/dashboard/DashboardPage";
import { ServerPage }       from "@/features/server-control/ServerPage";
import { TeamPage }         from "@/features/team/TeamPage";
import { BackupsPage }      from "@/features/backups/BackupsPage";
import { MapPage }          from "@/features/map/MapPage";
import { ConfigurePage }    from "@/features/configure/ConfigurePage";
import { LoginPage }        from "@/features/auth/LoginPage";
import { SetupWizard, type SetupStatus } from "@/features/setup/SetupWizard";
import { AdminPage }        from "@/features/admin/AdminPage";
import { ChatPage }         from "@/features/chat/ChatPage";
import { MusicPage }        from "@/features/music/MusicPage";
import { EventsPage }       from "@/features/events/EventsPage";
import { AutomationsPage }  from "@/features/automations/AutomationsPage";
import { PlayersPage }        from "@/features/players/PlayersPage";
import { PlayerStatsPage }    from "@/features/players/PlayerStatsPage";
import { PluginsHome }        from "@/features/plugins/PluginsHome";
import { PluginDetailPage }   from "@/features/plugins/PluginDetailPage";
import { InstalledList }      from "@/features/plugins/InstalledList";
import { Loader2 }          from "lucide-react";
import { OnboardingWizard, isOnboardingComplete, useOnboardingStore } from "@/features/onboarding/OnboardingWizard";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
  // Global safety net: any mutation that fails and does NOT define its own
  // onError surfaces a default error toast, so failures are never silent.
  // Mutations with custom error handling keep it (we skip the default below).
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.onError) return;
      const msg =
        error instanceof ApiError
          ? error.message
          : "Something went wrong. Please try again.";
      toast.error(msg);
    },
  }),
});

// ── Minimal privacy page ─────────────────────────────────────────────────────

function PrivacyPage() {
  return (
    <div className="page max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Privacy Notice</h1>
      <div className="card space-y-3 text-sm text-[#6B6E78] dark:text-sub leading-relaxed">
        <p>
          redstoneCipher collects your Google email address and display name for authentication
          and team identification within this private server management portal.
        </p>
        <p>
          Your Minecraft player data (in-game name, UUID, position, and inventory snapshots)
          is stored to support server administration by the server operator.
        </p>
        <p>
          Chat messages sent via this portal or in-game are stored temporarily and visible
          to all team members with chat access.
        </p>
        <p>
          Data is not shared with third parties. To request access to or deletion of your
          data, contact the server administrator directly.
        </p>
        <p className="text-xs text-meta">Last updated: May 2026</p>
      </div>
    </div>
  );
}

// ── Age confirmation (COPPA) — shown once on first activation ────────────────

const AGE_KEY = "rsc_age_confirmed";

function AgeGate({ onConfirm }: { onConfirm: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[200]" aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="age-title"
        className="fixed inset-0 flex items-center justify-center z-[200] p-4"
      >
        <div className="card max-w-sm w-full space-y-4 modal-enter">
          <h2 id="age-title" className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
            Age confirmation
          </h2>
          <p className="text-sm text-meta">
            redstoneCipher is a private server management tool. By continuing, you confirm
            that you are 13 years of age or older.
          </p>
          <div className="flex gap-2 justify-end">
            <a href="/auth/logout" className="btn-secondary text-sm">Sign out</a>
            <button onClick={onConfirm} className="btn-primary text-sm">
              I confirm — I am 13 or older
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Auth guard ────────────────────────────────────────────────────────────────

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [ageConfirmed, setAgeConfirmed] = useState(() =>
    localStorage.getItem(AGE_KEY) === "1"
  );
  const needsAgeGate = !ageConfirmed && !!user;

  // Wizard visibility is two independent triggers:
  //   1. First login (member who hasn't completed onboarding) — auto-shows once,
  //      and `firstRunDismissed` lets the X/close actually hide it.
  //   2. Manual re-open from the "Setup guide" button (useOnboardingStore).
  const { isOpen: wizardManuallyOpen, closeWizard } = useOnboardingStore();
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);

  const firstRunWizard =
    !!user &&
    user.role === "member" &&
    !isOnboardingComplete() &&
    !firstRunDismissed;

  const showWizard = !needsAgeGate && (firstRunWizard || wizardManuallyOpen);

  const handleAgeConfirm = () => {
    localStorage.setItem(AGE_KEY, "1");
    setAgeConfirmed(true);
  };

  const handleWizardDismiss = () => {
    setFirstRunDismissed(true);
    closeWizard();
  };

  if (loading) return (
    <div className="h-screen flex items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="w-8 h-8 text-[#5B9BF0] animate-spin" aria-hidden />
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;

  return (
    <>
      {needsAgeGate && <AgeGate onConfirm={handleAgeConfirm} />}
      {showWizard && <OnboardingWizard onDismiss={handleWizardDismiss} />}
      {children}
    </>
  );
}

// ── First-run setup gate ──────────────────────────────────────────────────────
// Before anything else, ask the server whether it is configured. If not, show
// the setup wizard instead of the app or login screen.

function SetupGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetch("/auth/setup/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (!cancelled) setStatus(s); })
      .catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, []);

  if (status === undefined) {
    return (
      <div className="h-screen flex items-center justify-center" role="status" aria-label="Loading">
        <Loader2 className="w-8 h-8 text-[#5B9BF0] animate-spin" aria-hidden />
      </div>
    );
  }
  if (status && status.needs_setup) return <SetupWizard status={status} />;
  return <>{children}</>;
}

// ── App root ──────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SetupGate>
        <BrowserRouter>
          <ToastContainer />
          <Routes>
            <Route path="/login"   element={<LoginPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/*" element={
              <AuthGuard>
                <div className="flex flex-col h-screen">
                  <KillSwitchBanner />
                  <div className="flex-1 min-h-0">
                    <Layout>
                      <Routes>
                        <Route path="/"                  element={<ErrorBoundary label="Dashboard"><DashboardPage /></ErrorBoundary>} />
                        <Route path="/server"            element={<ErrorBoundary label="Server"><ServerPage /></ErrorBoundary>} />
                        <Route path="/team"              element={<ErrorBoundary label="Team"><TeamPage /></ErrorBoundary>} />
                        <Route path="/map"               element={<ErrorBoundary label="Map"><MapPage /></ErrorBoundary>} />
                        <Route path="/backups"           element={<ErrorBoundary label="Backups"><BackupsPage /></ErrorBoundary>} />
                        <Route path="/configure"         element={<ErrorBoundary label="Configure"><ConfigurePage /></ErrorBoundary>} />
                        <Route path="/players"           element={<ErrorBoundary label="Inventory"><PlayersPage /></ErrorBoundary>} />
                        <Route path="/players/:ign"      element={<ErrorBoundary label="Player Stats"><PlayerStatsPage /></ErrorBoundary>} />
                        <Route path="/chat"              element={<ErrorBoundary label="Chat"><ChatPage /></ErrorBoundary>} />
                        <Route path="/music"             element={<ErrorBoundary label="Music"><MusicPage /></ErrorBoundary>} />
                        <Route path="/events"            element={<ErrorBoundary label="Events"><EventsPage /></ErrorBoundary>} />
                        <Route path="/automations"       element={<ErrorBoundary label="Automations"><AutomationsPage /></ErrorBoundary>} />
                        <Route path="/admin"             element={<ErrorBoundary label="Admin"><AdminPage /></ErrorBoundary>} />
                        <Route path="/admin/permissions" element={<ErrorBoundary label="Admin"><AdminPage /></ErrorBoundary>} />
                        <Route path="/plugins"              element={<ErrorBoundary label="Plugins"><PluginsHome /></ErrorBoundary>} />
                        <Route path="/plugins/detail/:key"  element={<ErrorBoundary label="Plugin Detail"><PluginDetailPage /></ErrorBoundary>} />
                        <Route path="/plugins/installed"    element={<ErrorBoundary label="Installed Plugins"><InstalledList /></ErrorBoundary>} />
                      </Routes>
                    </Layout>
                  </div>
                </div>
              </AuthGuard>
            } />
          </Routes>
        </BrowserRouter>
        </SetupGate>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

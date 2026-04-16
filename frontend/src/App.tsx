import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { DashboardPage }  from "@/features/dashboard/DashboardPage";
import { ServerPage }     from "@/features/server-control/ServerPage";
import { TeamPage }       from "@/features/team/TeamPage";
import { BackupsPage }    from "@/features/backups/BackupsPage";
import { ConfigurePage }  from "@/features/configure/ConfigurePage";
import { LoginPage }      from "@/features/auth/LoginPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={
            <AuthGuard>
              <Layout>
                <Routes>
                  <Route path="/"          element={<DashboardPage />} />
                  <Route path="/server"    element={<ServerPage />} />
                  <Route path="/team"      element={<TeamPage />} />
                  <Route path="/backups"   element={<BackupsPage />} />
                  <Route path="/configure" element={<ConfigurePage />} />
                </Routes>
              </Layout>
            </AuthGuard>
          } />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

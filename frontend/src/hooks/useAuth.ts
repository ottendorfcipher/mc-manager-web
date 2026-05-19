import { useEffect } from "react";
import { useAuthStore } from "@/store/auth";
import { api } from "@/api/client";
import type { MeResponse } from "@/types";

/** Fetches /api/me on mount and populates the auth store. */
export function useAuth() {
  const { user, loading, setUser, setLoading } = useAuthStore();

  useEffect(() => {
    api
      .get<MeResponse>("/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [setUser, setLoading]);

  return { user, loading };
}

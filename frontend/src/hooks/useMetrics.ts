import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { MetricsSnapshot } from "@/types";

/** Polls GET /api/metrics every 15 s and returns the latest snapshot.
 * Returns null when the VM is offline or the response is an error payload.
 *
 * Previously this used SSE, but long-lived connections conflict with Cloud Run's
 * scale-to-zero and container recycling (429 "no available instance" errors).
 */
export function useMetrics(): MetricsSnapshot | null {
  const { data } = useQuery<MetricsSnapshot | null>({
    queryKey: ["metrics"],
    queryFn: async () => {
      try {
        const res = await api.get<Record<string, unknown>>("/metrics");
        // The backend returns { error: "unreachable" } when SSH fails.
        if (res && typeof res.service_active === "boolean") {
          return res as unknown as MetricsSnapshot;
        }
        return null;
      } catch {
        return null;
      }
    },
    refetchInterval: 15_000,
    // Don't show stale data as if it's live
    staleTime: 10_000,
  });

  return data ?? null;
}

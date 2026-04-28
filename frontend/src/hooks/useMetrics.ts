import { useEffect, useState } from "react";
import type { MetricsSnapshot } from "@/types";

/** Subscribes to the SSE /api/metrics stream and returns the latest snapshot.
 * Returns null when the VM is offline or the snapshot is an error payload.
 */
export function useMetrics(): MetricsSnapshot | null {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/metrics", { withCredentials: true });

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        // The backend sends {"error":"unreachable"} when the VM is offline.
        // Treat any payload without service_active as a non-snapshot and clear state.
        if (parsed && typeof parsed.service_active === "boolean") {
          setMetrics(parsed as MetricsSnapshot);
        } else {
          setMetrics(null);
        }
      } catch {
        // malformed payload — clear rather than keep stale data
        setMetrics(null);
      }
    };

    es.onerror = () => {
      // SSE disconnected (e.g. server stopped) — clear metrics and let
      // the browser auto-reconnect with its built-in exponential backoff.
      setMetrics(null);
    };

    return () => es.close();
  }, []);

  return metrics;
}

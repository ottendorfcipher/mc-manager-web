import { useEffect, useState } from "react";
import type { MetricsSnapshot } from "@/types";

/** Subscribes to the SSE /api/metrics stream and returns the latest snapshot. */
export function useMetrics(): MetricsSnapshot | null {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/metrics", { withCredentials: true });

    es.onmessage = (e) => {
      try {
        setMetrics(JSON.parse(e.data) as MetricsSnapshot);
      } catch {
        // malformed payload — ignore
      }
    };

    es.onerror = () => {
      // SSE disconnected (e.g. server restarting) — will auto-reconnect
    };

    return () => es.close();
  }, []);

  return metrics;
}

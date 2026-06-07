import { useEffect, useRef } from "react";

interface UseEventStreamOptions<T> {
  /** Called with each parsed event payload. */
  onMessage: (data: T) => void;
  /** Called on the underlying EventSource error (before reconnect is scheduled). */
  onError?: (err: Event) => void;
  /** When false, no connection is opened (e.g. gated behind a permission). */
  enabled?: boolean;
  /**
   * Named SSE events to listen for in addition to the default unnamed
   * `message` event. Each named event's `data` is parsed and passed to
   * `onMessage` the same way.
   */
  events?: string[];
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribe to a Server-Sent Events endpoint with automatic reconnect and
 * capped exponential backoff.
 *
 * The browser's `EventSource` auto-reconnects on transient network drops, but
 * not after the server closes the stream or the connection enters the CLOSED
 * state — in those cases it gives up silently. This hook adds:
 *   • capped exponential backoff reconnects (1s → 2s → … → 30s),
 *   • JSON parsing of each frame (malformed frames are ignored, not thrown),
 *   • clean teardown on unmount / dependency change,
 *   • stable callbacks (changing `onMessage` does not re-open the stream).
 *
 * Pass `url = null` (or `enabled = false`) to keep the stream closed.
 */
export function useEventStream<T = unknown>(
  url: string | null,
  opts: UseEventStreamOptions<T>,
): void {
  const { onMessage, onError, enabled = true, events } = opts;

  // Keep the latest callbacks in refs so they can change without forcing a
  // reconnect (the effect only depends on url/enabled/eventsKey).
  const onMessageRef = useRef(onMessage);
  const onErrorRef = useRef(onError);
  onMessageRef.current = onMessage;
  onErrorRef.current = onError;

  // Serialise named events into a stable string for the dependency array.
  const eventsKey = events?.join(",") ?? "";

  useEffect(() => {
    if (!enabled || !url) return;

    let source: EventSource | null = null;
    let retries = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const handleFrame = (ev: MessageEvent) => {
      retries = 0; // a delivered frame means the connection is healthy
      try {
        onMessageRef.current(JSON.parse(ev.data) as T);
      } catch {
        /* ignore malformed frame */
      }
    };

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(url, { withCredentials: true });
      source.onmessage = handleFrame;
      for (const name of eventsKey ? eventsKey.split(",") : []) {
        source.addEventListener(name, handleFrame as EventListener);
      }
      source.onerror = (err) => {
        onErrorRef.current?.(err);
        // EventSource transparently retries while in CONNECTING; only step in
        // once it has fully closed, to avoid a tight reconnect loop.
        if (source && source.readyState === EventSource.CLOSED) {
          source.close();
          const delay = Math.min(1000 * 2 ** retries, MAX_BACKOFF_MS);
          retries += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [url, enabled, eventsKey]);
}

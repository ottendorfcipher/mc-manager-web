import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, MessageSquare, Lock, Globe } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { useChatUnread } from "@/hooks/useHotkeys";
import { useLocation } from "react-router-dom";
import type { ChatMessage, McPlayer } from "@/types";

// ── ChatPage ───────────────────────────────────────────────────────────────────

export function ChatPage() {
  const { hasPerm, user } = useAuthStore();
  const qc = useQueryClient();
  const canSend = hasPerm("chat.send");

  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [input, setInput]       = useState("");
  const [targetIgn, setTargetIgn] = useState<string>("");
  const [sseError, setSseError]  = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const esRef      = useRef<EventSource | null>(null);
  const { clear: clearUnread } = useChatUnread();
  const location = useLocation();

  // Clear unread count whenever we land on /chat
  useEffect(() => { clearUnread(); }, [location.pathname, clearUnread]);

  // ── History (seed) ──────────────────────────────────────────────────────────

  const { data: history = [], isLoading } = useQuery<ChatMessage[]>({
    queryKey: ["chat-history"],
    queryFn: () => api.get("/chat/history"),
    staleTime: Infinity, // SSE keeps it fresh; don't re-fetch on focus
  });

  // ── Online players (for DM selector) ───────────────────────────────────────

  const { data: onlinePlayers = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn: () => api.get("/mc/players"),
    refetchInterval: 30_000,
    enabled: canSend,
  });

  // ── SSE stream ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const es = new EventSource("/api/chat/stream", { withCredentials: true });
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg: ChatMessage = JSON.parse(e.data);
        setLiveMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          // Increment unread badge when user is not looking at the chat page
          if (document.visibilityState === "hidden" || !window.location.pathname.startsWith("/chat")) {
            useChatUnread.getState().increment();
          }
          return [...prev, msg];
        });
      } catch {
        // Ignore malformed events.
      }
    };

    es.addEventListener("lagged", () => {
      // We fell behind — re-fetch history and clear live list to resync.
      qc.invalidateQueries({ queryKey: ["chat-history"] });
      setLiveMessages([]);
    });

    es.onerror = () => setSseError(true);
    es.onopen  = () => setSseError(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Merge history + live, deduplicated and sorted ───────────────────────────

  const allMessages: ChatMessage[] = (() => {
    const seen = new Set<number>();
    const merged = [...history, ...liveMessages].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    return merged.sort((a, b) => a.id - b.id);
  })();

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length]);

  // ── Send ────────────────────────────────────────────────────────────────────

  const sendMut = useMutation({
    mutationFn: () =>
      api.post("/chat/send", {
        content:    input.trim(),
        target_ign: targetIgn || null,
      }),
    onSuccess: () => setInput(""),
  });

  function handleSend() {
    if (!input.trim() || sendMut.isPending) return;
    sendMut.mutate();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Who will I appear as? ───────────────────────────────────────────────────
  // The backend resolves linked IGN → show that, else show email prefix.
  const sendAs = user?.display_name ?? user?.email ?? "you";

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-4rem)] p-4 sm:p-6 gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <MessageSquare className="w-5 h-5 text-[#5B9BF0]" aria-hidden />
        <div>
          <h1 className="text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Chat</h1>
          <p className="text-xs text-[#6B6E78] dark:text-[#A8AEBB]">
            Web ↔ Minecraft · broadcast messages and join/leave events
            {sseError && (
              <span className="ml-2 text-[#F87171]">· reconnecting…</span>
            )}
          </p>
        </div>
      </div>

      {/* Message list — role=log aria-live so screen readers receive new messages */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
        aria-relevant="additions"
        className="flex-1 overflow-y-auto card p-0 min-h-0"
      >
        {isLoading ? (
          <div
            role="status"
            aria-label="Loading chat history"
            className="flex items-center justify-center h-32"
          >
            <div className="w-5 h-5 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" aria-hidden />
          </div>
        ) : allMessages.length === 0 ? (
          <p className="text-sm text-meta text-center py-12">
            No messages yet. Say something!
          </p>
        ) : (
          <div className="divide-y divide-[#D9D5D0] dark:divide-[#363944]">
            {allMessages.map((msg) => (
              <MessageRow key={msg.id} msg={msg} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      {canSend ? (
        <div className="flex-shrink-0 card p-3 space-y-2">
          {/* Target selector row */}
          <div className="flex items-center gap-2 text-xs text-[#6B6E78] dark:text-[#A8AEBB]">
            <span>Send as <span className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">{sendAs}</span> to</span>
            <div className="relative">
              <select
                value={targetIgn}
                onChange={(e) => setTargetIgn(e.target.value)}
                className="appearance-none pl-6 pr-3 py-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                           bg-white dark:bg-[#2A2D38] text-xs font-medium text-[#1C1E27] dark:text-[#EAECF0]"
              >
                <option value="">Everyone (broadcast)</option>
                {onlinePlayers.filter((p) => p.online).map((p) => (
                  <option key={p.ign} value={p.ign}>{p.ign} (DM)</option>
                ))}
              </select>
              {targetIgn ? (
                <Lock className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-meta pointer-events-none" aria-hidden />
              ) : (
                <Globe className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-meta pointer-events-none" aria-hidden />
              )}
            </div>
            {targetIgn && (
              <span className="text-warn text-[10px]">DMs are not saved to history</span>
            )}
          </div>

          {/* Input + send */}
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={256}
              placeholder={targetIgn ? `Message ${targetIgn}…` : "Message everyone in-game…"}
              className="flex-1 resize-none rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                         bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm
                         text-[#1C1E27] dark:text-[#EAECF0] placeholder-[#9B9EA6]
                         focus:outline-none focus:ring-2 focus:ring-[#5B9BF0] min-h-[40px] max-h-32"
              style={{ fieldSizing: "content" } as React.CSSProperties}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || sendMut.isPending}
              className="btn-primary p-2.5 flex-shrink-0 disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" aria-hidden />
            </button>
          </div>
          <p className="text-[10px] text-meta text-right">{input.length}/256 · Enter to send</p>
        </div>
      ) : (
        <div className="flex-shrink-0 card p-3 text-sm text-meta text-center">
          You have read-only access to chat.
        </div>
      )}
    </div>
  );
}

// ── MessageRow ─────────────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: ChatMessage }) {
  if (msg.source === "server") {
    return (
      <div className="py-2 px-4 text-center">
        <span className="text-xs text-meta italic">{msg.content}</span>
      </div>
    );
  }

  const isMc  = msg.source === "mc";
  const isWeb = msg.source === "web";

  return (
    <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-[#F7F5F2] dark:hover:bg-[#1E212B] transition-colors">
      {/* Avatar */}
      {isMc ? (
        <img
          src={`https://mc-heads.net/avatar/${msg.display_as}/32`}
          alt=""
          className="w-8 h-8 rounded-sm flex-shrink-0 mt-0.5"
          loading="lazy"
        />
      ) : (
        <div
          className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center
                     bg-[#5B9BF0] text-white text-xs font-bold"
        >
          {msg.display_as.charAt(0).toUpperCase()}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${isMc ? "text-[#36B37E]" : "text-[#5B9BF0]"}`}>
            {msg.display_as}
          </span>
          {isWeb && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EFF6FF] dark:bg-[#1E3A5F] text-[#5B9BF0] font-medium">
              web
            </span>
          )}
          <span className="text-[10px] text-meta ml-auto flex-shrink-0">
            {formatTime(msg.sent_at)}
          </span>
        </div>
        <p className="text-sm text-[#1C1E27] dark:text-[#EAECF0] break-words mt-0.5">
          {msg.content}
        </p>
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour:   "2-digit",
    minute: "2-digit",
  });
}

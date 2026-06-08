import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, User, MapPin, CalendarClock, Users, CornerDownLeft, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface SearchHit {
  kind: string; // player | pin | event | user
  label: string;
  sublabel: string | null;
  route: string;
}

const ICONS: Record<string, typeof User> = {
  player: User,
  pin:    MapPin,
  event:  CalendarClock,
  user:   Users,
};

/**
 * Global command palette. Opens on Cmd/Ctrl+K (or "/"), debounces a query to
 * GET /search, and navigates to the chosen result. Mounted once in Layout.
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [hits, setHits]       = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive]   = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const trapRef  = useFocusTrap(open, () => setOpen(false));

  // ── Global open shortcut (Cmd/Ctrl+K) ───────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input + reset when opened; clear state when closed.
  useEffect(() => {
    if (open) {
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  // ── Debounced search ────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.get<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`);
        setHits(res);
        setActive(0);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const choose = useCallback((hit: SearchHit | undefined) => {
    if (!hit) return;
    setOpen(false);
    navigate(hit.route);
  }, [navigate]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(hits[active]); }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[120]" aria-hidden onClick={() => setOpen(false)} />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="fixed left-1/2 top-[15vh] -translate-x-1/2 z-[120] w-[92vw] max-w-xl
                   bg-white dark:bg-[#1C1E27] rounded-xl shadow-2xl border border-[#D9D5D0] dark:border-[#363944]
                   overflow-hidden modal-enter"
        onKeyDown={onKeyDown}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-4 border-b border-[#D9D5D0] dark:border-[#363944]">
          <Search className="w-4 h-4 text-meta flex-shrink-0" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players, pins, events…"
            aria-label="Search query"
            className="flex-1 bg-transparent py-3.5 text-sm text-[#1C1E27] dark:text-[#EAECF0]
                       placeholder-[#9B9EA6] focus:outline-none"
          />
          {loading && <Loader2 className="w-4 h-4 text-meta animate-spin flex-shrink-0" aria-hidden />}
          <kbd className="hidden sm:block text-[10px] text-meta border border-[#D9D5D0] dark:border-[#363944] rounded px-1.5 py-0.5">esc</kbd>
        </div>

        {/* Results */}
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox" aria-label="Search results">
          {query.trim() && !loading && hits.length === 0 && (
            <li className="px-4 py-6 text-sm text-meta text-center">No matches for “{query.trim()}”.</li>
          )}
          {!query.trim() && (
            <li className="px-4 py-6 text-xs text-meta text-center">
              Type to search across players, map pins, and events.
            </li>
          )}
          {hits.map((hit, i) => {
            const Icon = ICONS[hit.kind] ?? Search;
            return (
              <li key={`${hit.kind}-${hit.route}-${i}`} role="option" aria-selected={i === active}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(hit)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === active ? "bg-[#EFF6FF] dark:bg-[#1E3A5F]" : "hover:bg-[#F7F5F2] dark:hover:bg-[#23262F]"
                  }`}
                >
                  <Icon className="w-4 h-4 text-[#5B9BF0] flex-shrink-0" aria-hidden />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-[#1C1E27] dark:text-[#EAECF0] truncate">{hit.label}</span>
                    {hit.sublabel && <span className="block text-[11px] text-meta truncate">{hit.sublabel}</span>}
                  </span>
                  {i === active && <CornerDownLeft className="w-3.5 h-3.5 text-meta flex-shrink-0" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

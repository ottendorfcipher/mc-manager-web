import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, Home, Coins, Siren, MessageSquare, Gamepad2, Search, Download, Plus, Loader2 } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { InstallFlow } from "./InstallFlow";
import { InstalledList } from "./InstalledList";

const API = "/api";

const GOAL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield, Home, Coins, Siren, MessageSquare, Gamepad2,
};

interface CatalogSummary {
  project_key: string;
  slug: string;
  title: string;
  icon_url: string | null;
  description: string;
  downloads: number;
  compatible: boolean;
  is_installed: boolean;
}

interface BrowseResponse {
  results: CatalogSummary[];
  total: number;
}

interface PluginGoal {
  slug: string;
  title: string;
  description: string;
  icon: string;
  sort_order: number;
}

async function fetchBrowse(q?: string, goal?: string): Promise<BrowseResponse> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (goal) params.set("goal", goal);
  return api.get(`/plugins/browse?${params}`);
}

function PluginCard({
  plugin,
  onInstall,
}: {
  plugin: CatalogSummary;
  onInstall: (key: string) => void;
}) {
  return (
    <div className="card flex items-start gap-3">
      <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-[#F0EDE9] dark:bg-[#2F323D] flex items-center justify-center overflow-hidden">
        {plugin.icon_url ? (
          <img src={plugin.icon_url} alt="" className="w-full h-full object-cover rounded-lg" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[#5B9BF0] flex items-center justify-center text-white text-sm font-bold">
            {plugin.title.charAt(0)}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[#1C1E27] dark:text-[#EAECF0] text-sm truncate">
          {plugin.title}
        </p>
        <p className="text-xs text-meta line-clamp-2 mt-0.5">{plugin.description}</p>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-xs text-meta flex items-center gap-1">
            <Download className="w-3 h-3" aria-hidden />
            {plugin.downloads.toLocaleString()}
          </span>
          {plugin.compatible && (
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
              Works with your server
            </span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0">
        {plugin.is_installed ? (
          <span className="text-xs text-meta px-2 py-1 rounded-md bg-[#F0EDE9] dark:bg-[#2F323D]">
            Installed
          </span>
        ) : (
          <button
            onClick={() => onInstall(plugin.project_key)}
            className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" aria-hidden />
            Add
          </button>
        )}
      </div>
    </div>
  );
}

const HARDCODED_GOALS = [
  { slug: "protect-builds",  title: "Protect builds",             icon: "Shield"       },
  { slug: "teleport-home",   title: "Let players teleport home",  icon: "Home"         },
  { slug: "economy",         title: "Add money & shops",          icon: "Coins"        },
  { slug: "anti-cheat",      title: "Stop cheaters",              icon: "Siren"        },
  { slug: "ranks-chat",      title: "Ranks & custom chat",        icon: "MessageSquare"},
  { slug: "mini-games",      title: "Add mini-games",             icon: "Gamepad2"     },
];

export function PluginsHome() {
  const canManage = useAuthStore((s) => s.hasPerm)("plugins.manage");

  // Members and below can VIEW installed add-ons but not browse/install. Show
  // them the read-only installed list instead of the catalog.
  if (!canManage) {
    return <InstalledList readOnly />;
  }

  return <PluginsBrowser />;
}

function PluginsBrowser() {
  const [search, setSearch]         = useState("");
  const [activeGoal, setActiveGoal] = useState<string | null>(null);
  const [installKey,   setInstallKey]   = useState<string | null>(null);
  const [installTitle, setInstallTitle] = useState<string | undefined>(undefined);

  const { data, isLoading } = useQuery<BrowseResponse>({
    queryKey: ["plugins/browse", search, activeGoal],
    queryFn:  () => fetchBrowse(search || undefined, activeGoal || undefined),
    staleTime: 60_000,
  });

  function handleInstall(key: string, title?: string) {
    setInstallKey(key);
    setInstallTitle(title);
  }

  return (
    <div className="page space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Add-ons</h1>
        <p className="text-sm text-meta mt-1">Browse and install add-ons for your server.</p>
      </div>

      {/* Goal grid */}
      {!search && (
        <section>
          <p className="text-xs uppercase tracking-wider text-meta font-semibold mb-3">
            What do you want to do?
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {HARDCODED_GOALS.map((goal) => {
              const Icon = GOAL_ICONS[goal.icon] ?? Shield;
              const active = activeGoal === goal.slug;
              return (
                <button
                  key={goal.slug}
                  onClick={() => setActiveGoal(active ? null : goal.slug)}
                  className={`card text-left flex items-center gap-3 transition-all ${
                    active
                      ? "ring-2 ring-[#5B9BF0] bg-[#EFF6FF] dark:bg-[#1E3A5F]"
                      : "hover:shadow-md"
                  }`}
                >
                  <Icon className="w-5 h-5 text-[#5B9BF0] flex-shrink-0" aria-hidden />
                  <span className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0]">
                    {goal.title}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Search */}
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-meta pointer-events-none"
          aria-hidden
        />
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setActiveGoal(null); }}
          placeholder="Search add-ons…"
          className="w-full pl-9 pr-4 py-2 rounded-xl border border-[#D9D5D0] dark:border-[#363944]
                     bg-white dark:bg-[#1C1E27] text-sm text-[#1C1E27] dark:text-[#EAECF0]
                     focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
        />
      </div>

      {/* Results */}
      <section>
        {activeGoal && (
          <p className="text-xs uppercase tracking-wider text-meta font-semibold mb-3">
            {HARDCODED_GOALS.find((g) => g.slug === activeGoal)?.title}
          </p>
        )}
        {!activeGoal && !search && (
          <p className="text-xs uppercase tracking-wider text-meta font-semibold mb-3">
            Popular add-ons
          </p>
        )}

        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 text-[#5B9BF0] animate-spin" aria-label="Loading" />
          </div>
        )}

        {!isLoading && (
          <div className="space-y-2">
            {(data?.results ?? []).map((plugin) => (
              <PluginCard key={plugin.project_key} plugin={plugin} onInstall={() => handleInstall(plugin.project_key, plugin.title)} />
            ))}
            {!isLoading && (data?.results?.length ?? 0) === 0 && (
              <p className="text-sm text-meta text-center py-8">No add-ons found.</p>
            )}
          </div>
        )}
      </section>

      {/* Install flow modal */}
      {installKey && (
        <InstallFlow
          projectKey={installKey}
          pluginTitle={installTitle}
          onClose={() => { setInstallKey(null); setInstallTitle(undefined); }}
        />
      )}
    </div>
  );
}

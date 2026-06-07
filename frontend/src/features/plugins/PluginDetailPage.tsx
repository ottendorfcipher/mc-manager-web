import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, Users, ExternalLink, Loader2, CheckCircle, Circle } from "lucide-react";
import { api } from "@/api/client";
import { InstallFlow } from "./InstallFlow";
import { PLUGIN_VOCAB } from "./vocab";

interface DepSummary {
  title:        string;
  dep_type:     string;
  is_installed: boolean;
}

interface PluginDetail {
  project_key:    string;
  slug:           string;
  title:          string;
  description:    string;
  icon_url:       string | null;
  downloads:      number;
  follows:        number;
  latest_version: string | null;
  is_installed:   boolean;
  dependencies:   DepSummary[];
}

async function fetchDetail(key: string): Promise<PluginDetail> {
  return api.get(`/plugins/detail/${encodeURIComponent(key)}`);
}

function DepLine({ dep }: { dep: DepSummary }) {
  const label = dep.dep_type === "required"
    ? PLUGIN_VOCAB.dependency
    : dep.dep_type === "optional"
    ? "optional helper"
    : PLUGIN_VOCAB.incompatible;

  return (
    <li className="flex items-center gap-2 text-sm">
      {dep.is_installed ? (
        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" aria-hidden />
      ) : (
        <Circle className="w-4 h-4 text-meta flex-shrink-0" aria-hidden />
      )}
      <span className="text-[#1C1E27] dark:text-[#EAECF0]">{dep.title}</span>
      <span className="text-xs text-meta">({label})</span>
    </li>
  );
}

export function PluginDetailPage() {
  const { key = "" } = useParams<{ key: string }>();
  const [installing, setInstalling] = useState(false);

  const { data, isLoading, error } = useQuery<PluginDetail>({
    queryKey: ["plugins/detail", key],
    queryFn:  () => fetchDetail(key),
    enabled:  !!key,
  });

  if (isLoading) {
    return (
      <div className="page flex justify-center py-16">
        <Loader2 className="w-8 h-8 text-[#5B9BF0] animate-spin" aria-label="Loading" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <div className="card text-sm text-[#F87171]">
          {error instanceof Error ? error.message : "Failed to load add-on details."}
        </div>
      </div>
    );
  }

  return (
    <div className="page max-w-2xl">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-16 h-16 rounded-xl bg-[#F0EDE9] dark:bg-[#2F323D] flex items-center justify-center overflow-hidden flex-shrink-0">
          {data.icon_url ? (
            <img src={data.icon_url} alt="" className="w-full h-full object-cover rounded-xl" />
          ) : (
            <span className="text-2xl font-bold text-[#5B9BF0]">
              {data.title.charAt(0)}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">{data.title}</h1>
          {data.latest_version && (
            <p className="text-xs text-meta mt-0.5">v{data.latest_version}</p>
          )}
          <div className="flex items-center gap-4 mt-2">
            <span className="text-xs text-meta flex items-center gap-1">
              <Download className="w-3 h-3" aria-hidden />
              {data.downloads.toLocaleString()} downloads
            </span>
            <span className="text-xs text-meta flex items-center gap-1">
              <Users className="w-3 h-3" aria-hidden />
              {data.follows.toLocaleString()} followers
            </span>
          </div>
        </div>
        <div className="flex-shrink-0">
          {data.is_installed ? (
            <span className="text-xs px-3 py-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 font-medium">
              Installed
            </span>
          ) : (
            <button
              onClick={() => setInstalling(true)}
              className="btn-primary text-sm"
            >
              Add to server
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="card mb-4">
        <p className="text-sm text-[#6B6E78] dark:text-sub leading-relaxed">
          {data.description}
        </p>
      </div>

      {/* Dependencies */}
      {data.dependencies.length > 0 && (
        <div className="card mb-4">
          <p className="text-xs uppercase tracking-wider text-meta font-semibold mb-3">
            What comes with it
          </p>
          <ul className="space-y-2">
            {data.dependencies.map((dep) => (
              <DepLine key={dep.title} dep={dep} />
            ))}
          </ul>
        </div>
      )}

      {/* Modrinth link */}
      <a
        href={`https://modrinth.com/plugin/${data.slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 text-sm text-[#5B9BF0] hover:underline"
      >
        <ExternalLink className="w-4 h-4" aria-hidden />
        View on Modrinth
      </a>

      {installing && (
        <InstallFlow
          projectKey={data.project_key}
          pluginTitle={data.title}
          onClose={() => setInstalling(false)}
        />
      )}
    </div>
  );
}

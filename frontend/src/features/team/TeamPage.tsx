import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, RefreshCw } from "lucide-react";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth";
import { RoleBadge } from "@/components/Badge";
import type { User, PlayerLink, McPlayer, Gamemode } from "@/types";
import { ROLE_LEVELS } from "@/types";

const GAMEMODES: Gamemode[] = ["survival", "creative", "adventure", "spectator"];
const GM_ICONS: Record<Gamemode, string> = { survival: "⚔️", creative: "✨", adventure: "🧭", spectator: "👁" };

export function TeamPage() {
  const { user: me } = useAuthStore();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get("/users"),
  });

  const { data: mcPlayers = [] } = useQuery<McPlayer[]>({
    queryKey: ["mc-players"],
    queryFn: () => api.get("/mc/players"),
    refetchInterval: 30_000,
  });

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.display_name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">Team</h1>
        <p className="text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
          See who’s on the team and manage your linked Minecraft accounts
        </p>
      </div>

      {/* Search + refresh */}
      <div className="flex gap-2">
        <input
          type="search"
          placeholder="Search by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-[#D9D5D0] dark:border-[#363944] bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
        />
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["users", "mc-players"] })}
          className="btn-secondary p-2"
          aria-label="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* User cards */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-6 h-6 border-2 border-[#5B9BF0] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtered
            .sort((a, b) => (ROLE_LEVELS[b.role] ?? 0) - (ROLE_LEVELS[a.role] ?? 0))
            .map((u) => (
              <UserCard
                key={u.email}
                user={u}
                mcPlayers={mcPlayers}
                me={me?.email ?? ""}
                qc={qc}
              />
            ))}
        </div>
      )}
    </div>
  );
}

function UserCard({
  user,
  mcPlayers,
  me,
  qc,
}: {
  user: User;
  mcPlayers: McPlayer[];
  me: string;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const { data: links = [] } = useQuery<PlayerLink[]>({
    queryKey: ["players", user.email],
    queryFn: () => api.get(`/users/${encodeURIComponent(user.email)}/players`),
  });

  const gmMut = useMutation({
    mutationFn: ({ ign, gamemode }: { ign: string; gamemode: string }) =>
      api.patch(
        `/users/${encodeURIComponent(user.email)}/players/${encodeURIComponent(ign)}/gamemode`,
        { gamemode },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players", user.email] }),
  });

  const unlinkMut = useMutation({
    mutationFn: (ign: string) =>
      api.delete(
        `/users/${encodeURIComponent(user.email)}/players/${encodeURIComponent(ign)}`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["players", user.email] }),
  });

  const isSelf   = user.email === me;
  const initials = user.display_name.slice(0, 2).toUpperCase();
  const avatarBg = ["#9B9EA6", "#36B37E", "#5B9BF0", "#FBBF24"][
    Math.max(0, (ROLE_LEVELS[user.role] ?? 0) - 1)
  ];

  return (
    <div className="card flex gap-4">
      {/* Avatar */}
      <div
        className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm"
        style={{ backgroundColor: avatarBg }}
      >
        {user.avatar_url
          ? <img src={user.avatar_url} className="w-11 h-11 rounded-full" alt="" />
          : initials}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[#1C1E27] dark:text-[#EAECF0]">
            {user.display_name}
          </span>
          {isSelf && <span className="text-xs text-[#9B9EA6]">(you)</span>}
          <RoleBadge role={user.role} />
        </div>
        <p className="text-xs text-[#6B6E78] dark:text-[#9BA0B0]">{user.email}</p>

        {/* Player links — self-service gamemode + unlink */}
        <div className="flex flex-wrap gap-2 mt-1">
          {links.map((link) => {
            const online = mcPlayers.find((p) => p.ign === link.ign)?.online ?? false;
            return (
              <div
                key={link.ign}
                className="flex items-center gap-1.5 bg-[#F0EDE9] dark:bg-[#2A2D38] rounded-lg px-2 py-1 text-xs"
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${online ? "bg-[#36B37E]" : "bg-[#9B9EA6]"}`}
                />
                <span className="font-mono text-[#1C1E27] dark:text-[#EAECF0]">
                  {link.ign}
                </span>
                <span className="text-[#9B9EA6]">{GM_ICONS[link.gamemode]}</span>
                {isSelf && (
                  <select
                    value={link.gamemode}
                    onChange={(e) =>
                      gmMut.mutate({ ign: link.ign, gamemode: e.target.value })
                    }
                    className="text-xs bg-transparent text-[#9B9EA6] focus:outline-none"
                    aria-label={`${link.ign} gamemode`}
                  >
                    {GAMEMODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}
                {isSelf && (
                  <button
                    onClick={() => unlinkMut.mutate(link.ign)}
                    aria-label={`Unlink ${link.ign}`}
                    className="text-[#F87171] hover:text-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}
          {links.length === 0 && (
            <span className="text-xs text-[#9B9EA6]">⛏ No linked players</span>
          )}
        </div>
      </div>
    </div>
  );
}

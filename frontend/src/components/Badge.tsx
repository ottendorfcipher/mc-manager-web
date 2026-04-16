import React from "react";
import { ROLE_COLORS, ROLE_LABELS, type Role } from "@/types";

interface RoleBadgeProps { role: Role }

export function RoleBadge({ role }: RoleBadgeProps) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white"
      style={{ backgroundColor: ROLE_COLORS[role] }}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

interface StatusDotProps {
  status: "RUNNING" | "TERMINATED" | "STOPPING" | "STAGING" | string;
}

const STATUS_COLORS: Record<string, string> = {
  RUNNING:    "#36B37E",
  TERMINATED: "#F87171",
  STOPPING:   "#FBBF24",
  STAGING:    "#FBBF24",
};

export function StatusDot({ status }: StatusDotProps) {
  const color = STATUS_COLORS[status] ?? "#9B9EA6";
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ backgroundColor: color }}
      aria-label={status}
    />
  );
}

import { ROLE_COLORS, ROLE_LABELS, type Role } from "@/types";

interface RoleBadgeProps {
  role:   Role;
  /** Override label and color when using API-loaded RoleRecord data. */
  label?: string;
  color?: string;
}

/** Displays a colored pill for a role.  Accepts either:
 *  1. A static system role string (uses ROLE_LABELS / ROLE_COLORS as fallback)
 *  2. Explicit `label` + `color` from a dynamic RoleRecord loaded via /api/roles
 */
export function RoleBadge({ role, label, color }: RoleBadgeProps) {
  const displayLabel = label ?? (ROLE_LABELS as Record<string, string>)[role] ?? role;
  const displayColor = color ?? (ROLE_COLORS as Record<string, string>)[role] ?? "#6B7280";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white"
      style={{ backgroundColor: displayColor }}
    >
      {displayLabel}
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

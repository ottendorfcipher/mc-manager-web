import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UserPlus, X, Mail, Gamepad2, CheckCircle2, AlertTriangle,
  ExternalLink, Loader2, ChevronDown, ChevronUp,
} from "lucide-react";
import { api } from "@/api/client";
import { toast } from "@/components/Toast";
import type { RoleRecord, InviteResult } from "@/types";
import { useAuthStore } from "@/store/auth";
import { ROLE_LEVELS } from "@/types";

interface Props {
  onClose: () => void;
}

/**
 * Unified invite form — one action that:
 *  1. Creates the portal user
 *  2. Optionally whitelists the MC IGN
 *  3. Optionally generates a Tailscale invite (server needs TAILSCALE_API_KEY)
 *  4. Optionally sends a welcome email   (server needs RESEND_API_KEY)
 */
export function InvitePortal({ onClose }: Props) {
  const { user: me } = useAuthStore();
  const qc           = useQueryClient();
  const myLevel      = ROLE_LEVELS[me?.role ?? "user"] ?? 1;

  // ── Form state ──────────────────────────────────────────────────────────────
  const [email,         setEmail]         = useState("");
  const [displayName,   setDisplayName]   = useState("");
  const [role,          setRole]          = useState("member");
  const [ign,           setIgn]           = useState("");
  const [sendTs,        setSendTs]        = useState(true);
  const [sendEmail,     setSendEmail]     = useState(true);
  const [result,        setResult]        = useState<InviteResult | null>(null);
  const [showAdvanced,  setShowAdvanced]  = useState(false);

  const { data: roles = [] } = useQuery<RoleRecord[]>({
    queryKey: ["roles"],
    queryFn:  () => api.get<RoleRecord[]>("/roles"),
  });
  const assignableRoles = roles.filter((r) => r.level < myLevel);

  // ── Mutation ────────────────────────────────────────────────────────────────
  const inviteMut = useMutation({
    mutationFn: () =>
      api.post<InviteResult>("/onboarding/invite", {
        email:            email.trim(),
        role,
        display_name:     displayName.trim() || null,
        ign:              ign.trim()          || null,
        tailscale_invite: sendTs,
        send_email:       sendEmail,
      }),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["users"] });
      if (data.email_sent) toast.success(`Invite email sent to ${email.trim()}`);
      else if (data.warnings.length) toast.info("Invite created with warnings");
      else toast.success(`${email.trim()} added to the portal`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid = email.includes("@") && role;

  // ── Result screen ────────────────────────────────────────────────────────────
  if (result) {
    return (
      <ResultPanel
        result={result}
        onInviteAnother={() => {
          setResult(null);
          setEmail(""); setDisplayName(""); setIgn("");
        }}
        onClose={onClose}
      />
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 scrim-enter" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invite new team member"
        className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
      >
        <div className="pointer-events-auto card max-w-md w-full space-y-5 modal-enter
                        max-h-[90vh] overflow-y-auto">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#EFF6FF] dark:bg-[#1E3A5F]
                              flex items-center justify-center">
                <UserPlus className="w-4 h-4 text-[#5B9BF0]" aria-hidden />
              </div>
              <h2 className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                Invite team member
              </h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="icon-btn w-8 h-8">
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>

          {/* What happens summary */}
          <div className="rounded-xl bg-[#F7F5F2] dark:bg-[#2A2D38] px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-meta uppercase tracking-wide">
              This invite will
            </p>
            <div className="space-y-1">
              <Bullet active icon="👤" text="Create their portal account" />
              <Bullet active={!!ign.trim()} icon="🎮"
                text={ign.trim() ? `Add "${ign.trim()}" to the MC whitelist` : "Add to MC whitelist (enter IGN below)"} />
              <Bullet active={sendTs}    icon="🔗" text="Get a quick-link to share mc-server-1 via Tailscale admin" />
              <Bullet active={sendEmail} icon="📧" text="Send a welcome email with setup instructions" />
            </div>
          </div>

          {/* Email + display name */}
          <div className="space-y-3">
            <label className="block">
              <span className="block text-xs font-semibold text-sub uppercase tracking-wide mb-1">
                Email address *
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="player@gmail.com"
                autoFocus
                className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                           bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-semibold text-sub uppercase tracking-wide mb-1">
                  Display name
                </span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Alex (optional)"
                  className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                             bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-sub uppercase tracking-wide mb-1">
                  Portal role
                </span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                             bg-white dark:bg-[#2A2D38] px-3 py-2 text-sm"
                >
                  {assignableRoles.map((r) => (
                    <option key={r.name} value={r.name}>{r.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Minecraft IGN */}
          <label className="block">
            <span className="block text-xs font-semibold text-sub uppercase tracking-wide mb-1">
              Minecraft username (IGN)
              <span className="text-meta normal-case font-normal ml-1">— optional, whitelisted immediately</span>
            </span>
            <div className="relative">
              <Gamepad2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-meta" aria-hidden />
              <input
                type="text"
                value={ign}
                onChange={(e) => setIgn(e.target.value)}
                placeholder="e.g. Steve"
                className="w-full rounded-lg border border-[#D9D5D0] dark:border-[#363944]
                           bg-white dark:bg-[#2A2D38] pl-9 pr-3 py-2 text-sm font-mono
                           focus:outline-none focus:ring-2 focus:ring-[#5B9BF0]"
              />
            </div>
          </label>

          {/* Advanced toggles */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-meta hover:text-sub transition-colors"
            >
              {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-2">
                <Toggle
                  checked={sendTs}
                  onChange={setSendTs}
                  label="Generate Tailscale invite"
                  desc="Requires TAILSCALE_API_KEY on the server"
                />
                <Toggle
                  checked={sendEmail}
                  onChange={setSendEmail}
                  label="Send welcome email"
                  desc="Requires RESEND_API_KEY on the server"
                />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="btn-secondary text-sm flex-1">
              Cancel
            </button>
            <button
              onClick={() => inviteMut.mutate()}
              disabled={!valid || inviteMut.isPending}
              className="btn-primary text-sm flex-1 flex items-center justify-center gap-2"
            >
              {inviteMut.isPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Sending invite…</>
                : <><Mail className="w-3.5 h-3.5" aria-hidden /> Send Invite</>}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Result panel ──────────────────────────────────────────────────────────────

function ResultPanel({
  result,
  onInviteAnother,
  onClose,
}: {
  result: InviteResult;
  onInviteAnother: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 scrim-enter" aria-hidden onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Invite result"
        className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
      >
        <div className="pointer-events-auto card max-w-md w-full space-y-4 modal-enter">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#36B37E]" aria-hidden />
              <h2 className="font-semibold text-[#1C1E27] dark:text-[#EAECF0]">
                {result.user.display_name} invited!
              </h2>
            </div>
            <button onClick={onClose} aria-label="Close" className="icon-btn w-8 h-8">
              <X className="w-4 h-4" aria-hidden />
            </button>
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap gap-2">
            <StatusChip ok label="Portal account" />
            <StatusChip ok={result.whitelist_added} label="MC whitelist" />
            <StatusChip ok={!!result.tailscale_invite_url} label="Tailscale invite" />
            <StatusChip ok={result.email_sent} label="Email sent" />
          </div>

          {/* Tailscale node-share action for the admin */}
          {result.tailscale_invite_url && (
            <div className="rounded-xl bg-[#EFF6FF] dark:bg-[#1E3A5F] p-3 space-y-2">
              <p className="text-xs font-semibold text-[#1e40af] dark:text-[#93C5FD] flex items-center gap-1.5">
                <span aria-hidden>🔗</span> Action required — share mc-server-1
              </p>
              <p className="text-xs text-[#1e40af] dark:text-[#93C5FD] leading-relaxed">
                {result.user.display_name} needs to create a free Tailscale account first.
                Once they've signed up, open the Tailscale admin console and share
                <strong> mc-server-1</strong> directly to their email. They'll only
                see that one node — not any other devices in your network.
              </p>
              <a
                href={result.tailscale_invite_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold
                           text-white bg-[#5B9BF0] hover:bg-[#4A8ADF] px-3 py-1.5
                           rounded-lg transition-colors no-underline"
              >
                <ExternalLink className="w-3 h-3" aria-hidden />
                Open Tailscale admin → mc-server-1
              </a>
              <p className="text-[10px] text-[#3b82f6] dark:text-[#60a5fa]">
                Machines → mc-server → Share → enter {result.user.email}
              </p>
            </div>
          )}

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="rounded-xl bg-[#FEF3C7] dark:bg-[#3D2A00] p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-warn">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
                <p className="text-xs font-semibold">Non-critical warnings</p>
              </div>
              {result.warnings.map((w, i) => (
                <p key={i} className="text-xs text-warn ml-5">{w}</p>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={onInviteAnother} className="btn-secondary text-sm flex-1">
              Invite another
            </button>
            <button onClick={onClose} className="btn-primary text-sm flex-1">
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Bullet({ active, icon, text }: { active: boolean; icon: string; text: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs transition-opacity ${active ? "opacity-100" : "opacity-40"}`}>
      <span aria-hidden className="text-base w-5 text-center">{icon}</span>
      <span className={active ? "text-[#1C1E27] dark:text-[#EAECF0] font-medium" : "text-meta line-through"}>
        {text}
      </span>
      {active && <CheckCircle2 className="w-3 h-3 text-[#36B37E] flex-shrink-0" aria-hidden />}
    </div>
  );
}

function StatusChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${
      ok
        ? "bg-[#ECFDF5] dark:bg-[#052e16] text-[#36B37E]"
        : "bg-[#F0EDE9] dark:bg-[#2A2D38] text-meta line-through"
    }`}>
      {ok && <CheckCircle2 className="w-2.5 h-2.5" aria-hidden />}
      {label}
    </span>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 rounded-full transition-colors flex-shrink-0 ${
          checked ? "bg-[#5B9BF0]" : "bg-[#D9D5D0] dark:bg-[#363944]"
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow translate-y-0.5 transition-transform ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`} />
      </button>
      <div>
        <p className="text-sm font-medium text-[#1C1E27] dark:text-[#EAECF0]">{label}</p>
        <p className="text-xs text-meta">{desc}</p>
      </div>
    </div>
  );
}

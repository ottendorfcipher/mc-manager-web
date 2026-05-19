# 07 — Legal Compliance

This document covers GDPR, CCPA, COPPA, and ADA compliance as they apply to redstoneCipher. Because this is a **private, invite-only administrative tool** for a small team managing a personal Minecraft server, many consumer-facing obligations do not apply in the same way they would to a public-facing product. However, obligations still exist and are identified here.

> **Disclaimer**: This is a technical analysis for engineering purposes. It is not legal advice. Consult a qualified attorney for definitive compliance guidance.

---

## 1. GDPR (General Data Protection Regulation)

**Jurisdiction**: Applies if any user or Minecraft player is located in the EU/EEA, or if the operator (server owner) is in the EU/EEA.

### Personal data collected

| Category | Data | Storage | Purpose |
|----------|------|---------|---------|
| Identity | Google email address | SQLite `users` table | Authentication, invite list |
| Identity | Google avatar URL (cdn) | SQLite `users` table | Display in UI |
| Identity | Google `sub` (user ID) | SQLite `users` table | OAuth identity linking |
| Identity | Display name | SQLite `users` table | UI display |
| Minecraft identity | IGN (in-game name) | `player_links` table | Server linking |
| Minecraft identity | UUID | `player_links`, `pending_players` | Unique player ID |
| Behavioral | Audit log (`audit_log` table) | SQLite | Admin action tracking |
| Network | IP addresses (server log, optional) | MC server log | Minecraft server logging |
| Behavioral | Chat messages | `chat_messages` table | Chat history |
| Behavioral | Player position (X/Y/Z) | `player_snapshots` table | Inventory/location view |
| Behavioral | Inventory contents | `player_snapshots` table | Inventory view |

### GDPR requirements analysis

**Lawful basis**: For an invite-only private server, the most appropriate lawful basis is likely **legitimate interests** (operating a private gaming community) or **contract** (the terms of joining the server). Consent is not strictly required for this use case, but users should be informed.

**Right to access (Art. 15)**: Users have the right to request all their personal data. No mechanism exists in the UI for users to view or export their own data (beyond what's visible in the Team page for their own IGN links).

**Right to erasure (Art. 17)**: Users have a right to deletion. The "Remove from whitelist" function removes the user record, but:
- Audit log entries referencing their email may persist
- Chat messages authored by them persist
- Player snapshots (position, inventory) may persist as they reference UUID/IGN rather than email

**Right to portability (Art. 20)**: No export function for personal data exists.

**Data minimization (Art. 5(1)(c))**: Generally good — only data necessary for server management is collected. Player position and inventory snapshots could be considered excessive if not used frequently.

**Retention limitation (Art. 5(1)(e))**: No automatic data deletion policies exist. Chat messages accumulate indefinitely (`500-message cap in query, but older messages are never purged from DB`).

**Privacy notice**: No privacy notice or policy is displayed anywhere in the application.

### GDPR gaps and remediation

| Gap | Risk | Remediation |
|-----|------|-------------|
| No privacy notice | Medium | Add a brief "Privacy Notice" footer link on the login page and settings |
| No data access mechanism | Medium | Add "Export my data" to the Team page profile section |
| No data deletion mechanism | Medium | Ensure user removal cascades to audit log (redact email), chat messages (anonymize), snapshots |
| Chat messages accumulate | Low | Add a retention policy (e.g. 90-day TTL) and a DB cleanup job |
| IP logging in MC log | Low | Add a note to the Configure page about the `log-ips` toggle and its GDPR implications |

---

## 2. CCPA (California Consumer Privacy Act)

**Jurisdiction**: Applies if any user is a California resident and the operator meets thresholds (generally >$25M revenue, >50K consumers, or >50% revenue from selling data). For a private Minecraft server, the operator almost certainly does not meet these thresholds.

**Practical conclusion**: CCPA is unlikely to apply to a private Minecraft server administration tool. However, if the server or team grows, these thresholds should be monitored.

**Best practice regardless**:
- Do not sell or share personal data with third parties (currently not done ✓)
- Provide a way for users to request deletion (same as GDPR recommendation above)
- Be transparent about data collection (privacy notice)

---

## 3. COPPA (Children's Online Privacy Protection Act)

**Jurisdiction**: US federal law. Applies to websites/online services directed at children under 13, or that have actual knowledge they are collecting data from children under 13.

### Risk assessment

Minecraft has a significant user base under 13. This application:
- Is **invite-only** with admin approval (high barrier for minors)
- Requires **Google OAuth** login (Google requires users to be 13+ for standard accounts, or a parent/guardian managed account)
- Manages a **private Minecraft server** for a small team

The Google OAuth requirement provides a practical (though not legally sufficient) gate. Google's Family Link system for under-13 accounts would technically be permissible, but would grant a child admin access.

### COPPA gaps

| Gap | Risk | Remediation |
|-----|------|-------------|
| No age verification | Medium | Add an age confirmation checkbox on first login ("I confirm I am 13 or older") |
| Minecraft player UUIDs stored for any player who joins | Low | The MC server itself is the primary data controller for player data; the portal processes this data in aggregate |
| Chat messages stored from any in-game player | Low | In-game chat is considered server-to-server communication, not "collected from children" in the COPPA sense |
| No parental consent mechanism | Low for current scale | Consider for future growth |

**Recommendation**: Add a brief age confirmation at first login. This is a one-time ~3-second addition that substantially reduces COPPA risk.

---

## 4. ADA (Americans with Disabilities Act)

**Jurisdiction**: US federal. Title III covers "places of public accommodation." Courts have split on whether websites qualify, but the trend is toward coverage for public-facing websites. Private internal tools have a different (lower) exposure.

**Practical conclusion**: As a private admin tool, ADA Title III public accommodation claims are unlikely. However:
1. **ADA Title I** (employment): If any team member has a disability and needs the admin tool to perform their role, reasonable accommodation (which includes accessible software) may be required under employment law.
2. **Good practice**: Accessibility improvements benefit all users, not just those with disabilities.

### ADA-relevant accessibility failures

From doc 06, the failures with ADA relevance:
1. Color contrast failures (`#9B9EA6` on white/off-white) — most impactful for users with low vision or color deficiency
2. Missing `aria-live` for status messages — impacts screen reader users
3. No focus trap in modals — impacts keyboard-only users
4. Missing `role="log"` on chat — impacts screen reader users relying on real-time updates
5. Tiny touch targets (whitelist Remove button, item drawer tabs) — impacts motor-impaired users

**Bottom line**: Fixing the accessibility gaps identified in doc 06 satisfies both WCAG 2.2 AA (the practical standard) and meaningful ADA compliance.

---

## 5. Legal Compliance Summary

| Regulation | Applies? | Current status | Priority |
|------------|----------|---------------|----------|
| GDPR | Yes (if any EU users) | Partial — data is collected but rights mechanisms missing | High |
| CCPA | Probably not (sub-threshold) | N/A | Low |
| COPPA | Low risk (invite-only, OAuth gate) | Partial — no age confirmation | Medium |
| ADA Title III | Low risk (private tool) | Partial — accessibility gaps | Medium |
| ADA Title I | Yes (if team member has disability) | Partial — see a11y gaps | High |
| WCAG 2.2 AA | Best practice standard | Partial — contrast and ARIA gaps | High |

---

## 6. Recommended Privacy Notice (Minimal)

A minimal privacy notice suitable for the login page footer and a dedicated `/privacy` route:

> **Privacy Notice** — redstoneCipher collects your Google email address and display name for authentication and team identification. Your Minecraft player data (IGN, UUID, position, and inventory snapshots) is stored to support server administration. Data is not shared with third parties. To request access to or deletion of your data, contact the server administrator. Chat messages are retained for [X] days.

This notice satisfies the GDPR transparency requirement (Art. 13/14) for most low-risk private-use scenarios without requiring a full privacy policy.

---

## 7. Data Security

Beyond compliance obligations, data security practices relevant to the privacy of personal data:

- **SQLite WAL mode** with daily encrypted backups ✓ (reduces risk of data loss)
- **JWT stored in HttpOnly cookie** (`__session`) — protected from XSS ✓
- **Tailscale-only MC server** — reduces IP exposure ✓
- **Invite-only access** — minimal attack surface ✓
- **Audit log** for all admin actions ✓
- **No plaintext password storage** (Google OAuth) ✓
- **mc_ssh_key** stored with 600 permissions on the web server ✓

Gaps:
- Backup archives on mc-server-1 are not encrypted at rest — if the server is compromised, player data (including position history and inventory) is exposed
- No rate limiting on the admin portal login endpoint (handled by Google OAuth, but the callback endpoint itself could be probed)

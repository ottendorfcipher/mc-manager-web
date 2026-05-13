# 10 — Prioritized Recommendations

Recommendations from all documents consolidated into a P0–P3 backlog. Items are ordered by impact-to-effort ratio within each priority tier.

**Effort estimates**: S = 1–2 hours, M = half-day, L = 1–2 days, XL = 1+ week

---

## P0 — Critical (Accessibility / Legal / Safety)

These issues break core functionality for some users or create concrete legal exposure.

### P0-1 Fix tertiary text color contrast
**Issue**: `#9B9EA6` on `#F7F5F2` (2.8:1) and `#9BA0B0` on `#222530` (3.1:1) fail WCAG AA.
**Fix**: Replace all `text-[#9B9EA6]` with `text-[#767980]` in light mode; replace `dark:text-[#9BA0B0]` with `dark:text-[#A8AEBB]`.
**Files**: ~40 occurrences across most feature files. A global find-and-replace takes ~30 minutes; verification takes ~1 hour.
**Effort**: S
**References**: doc 06 §1, doc 09 Weaknesses

### P0-2 Add `aria-live` to all status message areas
**Issue**: Screen readers never announce operation results, loading states, or chat messages.
**Fix**:
- Wrap `statusMsg` in `<div role="status" aria-live="polite" aria-atomic="true">`
- Add `role="status" aria-label="Loading"` to all spinners
- Add `role="log" aria-live="polite" aria-label="Chat messages"` to the chat message list
- Add `role="progressbar"` with appropriate `aria-valuenow` / `aria-label` to the VM progress bar
**Effort**: S (mechanical changes, high impact)
**References**: doc 06 §2, doc 01 H1

### P0-3 Implement focus trap in modal dialogs and drawer
**Issue**: Keyboard users can Tab out of open modals. WCAG 2.1 SC 2.1.2.
**Fix**: Use `focus-trap-react` (npm) or implement a custom `useFocusTrap` hook. Apply to `ItemGiveDrawer`, all `role="dialog"` modals, and the mobile "More" drawer.
```typescript
// Example with focus-trap-react:
import FocusTrap from 'focus-trap-react';
// Wrap modal content: <FocusTrap active={isOpen}>{children}</FocusTrap>
```
Also add `Escape` key close handler to all dialogs.
**Effort**: M
**References**: doc 06 §3, doc 09 Weaknesses

### P0-4 Replace `confirm()` with in-app confirmation dialog
**Issue**: World deletion uses `window.confirm()` — inconsistent styling, Fitts's Law failure, inaccessible.
**Fix**: Use the existing confirmation modal pattern (already implemented for world switch and backup restore). A reusable `<ConfirmDialog>` component would serve all future uses.
**Effort**: S
**References**: doc 01 H3, doc 09 Weaknesses

### P0-5 Fix `text-[9px]` item tile labels
**Issue**: 9px text is below WCAG minimum readable size.
**Fix**: Change `text-[9px]` to `text-xs` (12px) in `ItemGiveDrawer.tsx`. The grid accommodates this — test on small screens.
**Effort**: S (one-line change)
**References**: doc 06 §5, doc 08 §1

---

## P1 — High (UX Quality / System Status)

These issues significantly affect usability but don't block core functionality.

### P1-1 Fix `#FBBF24` warning text on white backgrounds
**Issue**: `#FBBF24` on `#FFFFFF` (1.9:1) — used for lock warnings in Config page in light mode.
**Fix**: Use `text-[#B45309]` (amber-700) for light mode warning text: 4.8:1 on white ✓
**Effort**: S
**References**: doc 06 §1

### P1-2 Add a global error boundary
**Issue**: Uncaught React errors crash the app.
**Fix**: Wrap `<App>` with a top-level `ErrorBoundary` that renders a graceful "Something went wrong" screen with a reload button. Add per-feature error boundaries around `<ChatPage>`, `<PlayersPage>`, and `<AdminPage>` to isolate failures.
```typescript
// frontend/src/components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component<...> {
  // standard React error boundary pattern
}
```
**Effort**: S
**References**: doc 01 H9, doc 09 Weaknesses

### P1-3 Replace inline `statusMsg` with a toast notification system
**Issue**: Server page status messages are placed far from the action and are not `aria-live`.
**Fix**: Install `react-hot-toast` (lightweight, accessible, 3KB gzipped) and replace all `setStatusMsg()` calls across the app with `toast.success()` / `toast.error()`. Add `<Toaster>` to the app root with `aria-live` built in.
```bash
npm install react-hot-toast
```
**Effort**: M (plumbing + migration)
**References**: doc 01 H1, doc 05 §6, doc 09 Weaknesses

### P1-4 Add step-progress feedback for long-running operations
**Issue**: World switch and backup creation show a spinner for 90–180 s with no progress information.
**Options**:
- **Option A (simple)**: Parse the SSH log output server-side and surface step text via a polling endpoint `GET /api/jobs/:id`. ~XL effort.
- **Option B (quick win)**: Hard-code the expected steps as a time-based progress sequence in the frontend. Not accurate but provides perceived progress. ~M effort.
  ```typescript
  // Example: show "Saving current world..." for first 30s, then "Loading target world..."
  const WORLD_SWITCH_STEPS = [
    { after: 0,  text: "Stopping Minecraft server..." },
    { after: 5,  text: "Saving current world..." },
    { after: 40, text: "Loading target world..." },
    { after: 90, text: "Starting Minecraft server..." },
  ];
  ```
**Effort**: M (Option B) / XL (Option A)
**References**: doc 01 H1, doc 03 §8, doc 09 Weaknesses

### P1-5 Add `role="tablist"` / `role="tab"` ARIA to Admin and item drawer tabs
**Issue**: Tab interfaces don't communicate their structure to screen readers.
**Fix**: Wrap tab bars in `<div role="tablist">` and add `role="tab"`, `aria-selected`, `aria-controls` to each tab button. Add `role="tabpanel"` to tab content areas. Also add `ArrowLeft`/`ArrowRight` keyboard navigation.
**Effort**: M
**References**: doc 06 §2, doc 06 §3

### P1-6 Add non-color status indicators (colorblind support)
**Issue**: Online/offline, active/inactive states use color as the only differentiator.
**Fix**:
- `StatusDot` component: add a small icon (▶ running, ■ stopped, ? unknown) alongside the color dot
- World active badge: already has `CheckCircle2` icon ✓
- Online/offline player badge: already uses text "Online" / "Offline" ✓ — just needs color contrast fix
- Dashboard status tiles: add icons to the status text
**Effort**: S
**References**: doc 06 §5, doc 08 §6

---

## P2 — Medium (UX Enhancement)

These improvements meaningfully increase usability and satisfaction.

### P2-1 Add privacy notice
**Issue**: No privacy notice is shown; GDPR transparency requirement not met.
**Fix**: Add a one-line footer to the login page: "By signing in, you agree to our [Privacy Notice]" linking to `/privacy`. Create a minimal `/privacy` route with the template from doc 07 §6.
**Effort**: S
**References**: doc 07 §1

### P2-2 Add confirmation dialogs for remaining destructive actions
**Issue**: Ban, kick, removing a user from whitelist (Server page), and removing an IGN link are one-click with no confirmation.
**Fix**: Apply the standard confirmation modal pattern to: Server page "Remove" → whitelist; MCPairingCard "×" → unlink IGN. Add type-to-confirm (`type "remove" to proceed`) for the most destructive action (banning a player).
**Effort**: M
**References**: doc 01 H3, doc 04 §5

### P2-3 Add entrance animations to modals and drawer
**Issue**: Modals and the item drawer appear instantly — no visual transition.
**Fix**: Add `@keyframes` or Tailwind `transition` + `data-state` pattern:
```css
/* Drawer: slide in from right */
.drawer-enter { transform: translateX(100%); }
.drawer-enter-active { transform: translateX(0); transition: transform 200ms ease; }

/* Modal: scale + fade */
.modal-enter { opacity: 0; transform: scale(0.95); }
.modal-enter-active { opacity: 1; transform: scale(1); transition: all 150ms ease; }
```
Respect `prefers-reduced-motion`.
**Effort**: S
**References**: doc 08 §7

### P2-4 Migrate colors to CSS custom properties
**Issue**: Hardcoded hex values scattered across 40+ files make contrast fixes and theming difficult.
**Fix**:
```css
/* frontend/src/index.css */
:root {
  --color-bg:        #F7F5F2;
  --color-surface:   #FFFFFF;
  --color-text:      #1C1E27;
  --color-text-sub:  #6B6E78;
  --color-text-meta: #767980;  /* fixed from #9B9EA6 */
  --color-border:    #D9D5D0;
  --color-primary:   #5B9BF0;
  --color-success:   #36B37E;
  --color-danger:    #F87171;
  --color-warn:      #B45309;  /* fixed from #FBBF24 for light mode */
}
.dark {
  --color-bg:        #13151A;
  --color-surface:   #222530;
  --color-text-meta: #A8AEBB;  /* fixed from #9BA0B0 */
  /* ... */
}
```
This is the highest-leverage change for long-term maintainability.
**Effort**: L (systematic migration)
**References**: doc 08 §2, doc 09 Opportunities

### P2-5 Auto-expand the active world card in WorldsTab
**Issue**: The active world card is collapsed by default, requiring an extra click to see backups.
**Fix**: Initialize `expanded` state to `true` for the world where `is_active === true`.
**Effort**: S (one-line change)
**References**: doc 02 Task 4

### P2-6 Inline success feedback on gamerule toggles
**Issue**: Toggle success messages appear in the distant page header, breaking visual focus.
**Fix**: Show a brief (1.5 s) ✓ checkmark animation on the toggle row itself. Remove the page-level `statusMsg` for this flow.
**Effort**: S
**References**: doc 02 Task 5, doc 05 §7

### P2-7 Add age confirmation at first login
**Issue**: COPPA risk — no age verification.
**Fix**: After OAuth callback, on first login (when `google_sub` was previously null), show a one-time modal: "I confirm I am 13 years of age or older." Store confirmed state in the user record.
**Effort**: S
**References**: doc 07 §3

---

## P3 — Enhancement (Power User / Polish)

These features significantly improve the experience for power users or add long-term value.

### P3-1 Keyboard shortcut system / command palette
**Recommended library**: `cmdk` (radix-based, used by Vercel and many developer tools)
**Shortcuts to implement first**:
```
Cmd+K / Ctrl+K — open command palette
/ — focus global search (if applicable)
Esc — close any modal or drawer
G D — navigate to Dashboard
G S — navigate to Server
G A — navigate to Admin
G W — navigate to Admin > Worlds
? — show keyboard shortcut reference
```
**Effort**: L
**References**: doc 01 H7, doc 06 §3, doc 09 Opportunities

### P3-2 Chat unread message badge
**Fix**: Subscribe to the SSE stream across all pages. When a new message arrives and the user is not on `/chat`, increment a badge count on the Chat nav item. Clear on navigation to `/chat`.
**Effort**: M
**References**: doc 03 §7, doc 09 Opportunities

### P3-3 Add `axe-core` to Playwright tests (CI accessibility gate)
**Fix**:
```bash
npm install --save-dev @axe-core/playwright
```
Add to `frontend/e2e/*.spec.ts`:
```typescript
import AxeBuilder from '@axe-core/playwright';
test.afterEach(async ({ page }) => {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
```
**Effort**: S (install + boilerplate)
**References**: doc 06 §8, doc 09 Opportunities

### P3-4 Bulk operations for pending players queue
**Fix**: Add multi-select checkboxes to pending player cards. Add "Approve all" / "Reject all" action buttons that appear when ≥1 player is selected.
**Effort**: M
**References**: doc 01 H7

### P3-5 "How it works" explainers for complex flows
**Add to**:
- Worlds tab: "World switch saves the current world first, then loads the target. The server briefly restarts."
- Pending Players tab: "These are players who joined via Tailscale for the first time. Approve to link them to a team member."
- Chat page: "Messages here are bridged to and from the in-game chat in real time."
**Effort**: S
**References**: doc 01 H10, doc 05 §1

### P3-6 Onboarding first-run experience
**Fix**: Detect first login or first visit. Show a dismissible banner or modal: "Welcome to redstoneCipher. Here are 3 things to do first: 1. Link your Minecraft account 2. Check server status 3. Invite your first player." Store dismissed state in localStorage or the DB.
**Effort**: M
**References**: doc 01 H10, doc 09 Opportunities

### P3-7 mc-heads.net fallback avatar
**Fix**: When `<img src="https://mc-heads.net/...">` fails to load (`onError`), fall back to the initials avatar pattern already used for team members (colored circle with first letter of IGN).
**Effort**: S
**References**: doc 09 Threats

---

## Recommended Implementation Order

**Sprint 1 (1 day)**: P0-1, P0-2, P0-4, P0-5, P1-2, P1-6 — all quick wins, high impact
**Sprint 2 (1 day)**: P0-3 (focus trap), P1-1, P2-5, P2-6, P3-7 — accessibility completeness
**Sprint 3 (2 days)**: P1-3 (toast), P1-5 (tab ARIA), P2-3 (animations), P2-7 (age confirm)
**Sprint 4 (3 days)**: P2-2 (confirmations), P1-4 (step progress), P3-3 (axe CI)
**Sprint 5 (1 week)**: P2-4 (design tokens), P3-1 (keyboard shortcuts)
**Ongoing**: P3-2 (unread badge), P3-4 (bulk ops), P3-5/6 (onboarding)

---

## Recommended Tooling Summary

| Category | Tool | Justification |
|----------|------|---------------|
| Accessibility audit | axe DevTools (Chrome extension) | Immediate automated audit, free |
| Accessibility CI | @axe-core/playwright | Playwright integration, prevent regressions |
| Color contrast | Colour Contrast Analyser (TPGi) | Desktop app, instant pair checking |
| APCA / WCAG 3 | myndex.com/APCA | Forward-compatible contrast checking |
| Screen reader testing | VoiceOver (macOS built-in) | Zero-cost, Safari/Chrome |
| Focus management | focus-trap-react (npm) | 2KB, battle-tested, used by Radix/headlessui |
| Notifications/toast | react-hot-toast (npm) | 3KB, accessible, SSR-compatible |
| Command palette | cmdk (npm) | Used by Vercel/Linear, accessible, composable |
| Icons | lucide-react (already in use) | Continue — consistent stroke weights |
| A11y linting | eslint-plugin-jsx-a11y | Catches ARIA errors at code-write time |
| Design tokens | CSS custom properties (no extra dep) | No library needed — native CSS |
| Color blindness sim | Chrome DevTools (Rendering > Emulate) | Free, built-in to dev browser |
| Keyboard nav testing | Accessibility Insights (Edge extension) | Free, visualizes Tab stops |
| Performance | Chrome Lighthouse (built-in) | Accessibility + performance in one report |

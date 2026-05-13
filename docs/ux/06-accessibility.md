# 06 — Accessibility (WCAG / ADA)

This document covers WCAG 2.2 compliance (the current ratified standard), a preview of WCAG 3 APCA guidelines, ADA Title III implications, keyboard navigation, ARIA, and motor accessibility.

> **WCAG 3 note**: WCAG 3.0 is still in Working Draft as of 2026. Its core contrast model (APCA — Advanced Perceptual Contrast Algorithm) is experimentally adopted by some tooling. Both WCAG 2.2 and APCA calculations are provided where relevant.

---

## 1. Color Contrast Audit

### Method
Relative luminance formula per WCAG 2.1 § 1.4.3 (AA requires 4.5:1 for normal text, 3:1 for large text and UI components).
APCA Lc threshold for WCAG 3 candidate: Lc 60 for body text, Lc 45 for large text / UI components.

### Light Mode

| Foreground | Background | Role | Ratio | WCAG 2.2 | APCA Lc |
|------------|------------|------|-------|-----------|---------|
| `#1C1E27` | `#F7F5F2` | Primary text (page body) | 14.9:1 | ✓ AAA | ~90 ✓ |
| `#1C1E27` | `#FFFFFF` | Text on cards | 16.8:1 | ✓ AAA | ~95 ✓ |
| `#6B6E78` | `#F7F5F2` | Secondary text | 4.6:1 | ✓ AA | ~52 ⚠ |
| `#9B9EA6` | `#F7F5F2` | Tertiary / metadata text | **2.8:1** | **✗ FAIL** | ~33 ✗ |
| `#9B9EA6` | `#FFFFFF` | Tertiary on cards | **2.9:1** | **✗ FAIL** | ~35 ✗ |
| `#5B9BF0` | `#FFFFFF` | Primary button bg, links | 3.8:1 | ✓ AA (large/UI) | ~55 ⚠ |
| `#FFFFFF` | `#5B9BF0` | Text on primary button | 3.8:1 | ✓ AA (large text) | ~55 ✓ |
| `#F87171` | `#FFFFFF` | Error / danger text | 3.3:1 | ⚠ AA for large only | ~43 ⚠ |
| `#36B37E` | `#FFFFFF` | Success text/badge | 3.0:1 | ⚠ AA for large only | ~38 ✗ |
| `#FBBF24` | `#FFFFFF` | Warning text | **1.9:1** | **✗ FAIL** | ~22 ✗ |
| `#B88500` | `#FFFFFF` | mc-badge text (light) | 4.6:1 | ✓ AA | ~52 ✓ |

**Critical failure**: `#9B9EA6` on `#F7F5F2` (2.8:1) is used extensively for metadata text — backup timestamps, setting descriptions, player statuses, category tabs. This affects a large fraction of the visible text in the application. It passes for large text (≥18pt or ≥14pt bold) and UI components (≥3:1) but fails for body text.

**Fix**: Replace `text-[#9B9EA6]` with `text-[#767980]` (#767980 has a 4.5:1 ratio on #F7F5F2) for any text that is smaller than 24px normal weight or 18px bold weight.

**Yellow badge warning**: `#FBBF24` text on white backgrounds fails dramatically (1.9:1). This is used in the `mc-badge` component for warning text in light mode.

### Dark Mode

| Foreground | Background | Role | Ratio | WCAG 2.2 |
|------------|------------|------|-------|-----------|
| `#EAECF0` | `#13151A` | Primary text | 14.1:1 | ✓ AAA |
| `#EAECF0` | `#222530` | Text on cards | 11.8:1 | ✓ AAA |
| `#9BA0B0` | `#13151A` | Secondary text | **3.4:1** | **✗ FAIL (normal)** |
| `#9BA0B0` | `#222530` | Tertiary on cards | **3.1:1** | **✗ FAIL (normal)** |
| `#5B9BF0` | `#13151A` | Primary blue | 5.2:1 | ✓ AA |
| `#FBBF24` | `#13151A` | Warning yellow | 9.1:1 | ✓ AAA |
| `#F87171` | `#13151A` | Error red | 5.1:1 | ✓ AA |
| `#36B37E` | `#13151A` | Success green | 4.7:1 | ✓ AA |

**Critical failure in dark mode**: `#9BA0B0` on `#222530` (3.1:1) affects all tertiary text in dark mode, including setting descriptions in the Config page (the most information-dense page). Fix: use `#A8AEBB` (4.5:1 on `#222530`).

---

## 2. ARIA and Semantic HTML

### What's done well
- Toggle switches use `role="switch"` and `aria-checked` on `<button>` elements throughout ✓
- Modal dialogs use `role="dialog"` and `aria-label` ✓ (`aria-modal` is present on some)
- `aria-expanded` is set on the world card expand/collapse button ✓
- Remove buttons throughout use descriptive `aria-label` (e.g. `aria-label="Remove Steve from whitelist"`) ✓
- `aria-hidden` is set on decorative icons ✓
- Decorative MC avatar images use `alt=""` ✓
- The search input in `ItemGiveDrawer` uses `type="search"` which provides semantic search behavior ✓
- The whitelist add form wraps in `<form>` with `onSubmit` — keyboard Enter submission works ✓
- Skip link (`.skip-link`) is present on the login page ✓

### Missing ARIA

| Element | Missing ARIA | Impact |
|---------|-------------|--------|
| Status messages (`statusMsg`) | `role="status"` / `aria-live="polite"` | Screen readers don't announce results |
| Loading spinners | `role="status"` + `aria-label="Loading"` | No announcement when content appears |
| Progress bar during VM action | `role="progressbar"` + `aria-valuenow` | Not announced to AT |
| Mobile "More" drawer | `aria-modal="true"` | Focus not trapped for AT users |
| All modal dialogs | `aria-describedby` | Descriptive text not associated |
| Item category tabs | `role="tablist"` / `role="tab"` / `aria-selected` | Screen readers can't navigate tab structure |
| World expand/collapse | No `aria-controls` pointing to panel id | AT can't understand expand relationship |
| Chat message list | `role="log"` + `aria-live="polite"` | New messages not announced |
| Backup list | `aria-label="Backups for {world}"` | No context when navigating with AT |

The most critical missing ARIA is the chat `role="log"` — screen reader users cannot receive real-time chat messages.

---

## 3. Keyboard Navigation

### Current state
- Tab order follows DOM order (not explicitly managed) — generally correct for linear layouts
- Focus ring is defined globally: `:focus-visible { outline: 2px offset-2px solid #5B9BF0 }` ✓
- The item drawer search is focused on mount ✓
- Modal `close` button receives focus when modal opens ✓ (some modals)

### Gaps

| Feature | Keyboard issue |
|---------|---------------|
| Admin tabs | No `Arrow` key navigation (ARIA tablist pattern requires this) |
| Item category tabs | Same — no arrow key navigation |
| Mobile "More" drawer | Focus not trapped — Tab escapes the drawer |
| All modals (center dialogs) | No focus trap — Tab can reach background content |
| World card expand | `Enter` / `Space` work (button element) ✓ |
| Global nav | No keyboard shortcuts at all |
| Item grid | No keyboard navigation within the grid |

**Focus trap is the most critical keyboard gap.** WCAG 2.1 SC 2.1.2 (No Keyboard Trap) requires that keyboard users can move focus into and out of a component. However, best practice for modals is to trap focus *within* the dialog while it is open (so Tab wraps around), and `Escape` closes it. Neither is currently implemented.

### Keyboard shortcut recommendations
```
/ (or Ctrl+K) — global search / command palette
G then D — Dashboard
G then S — Server
G then A — Admin
G then W — Worlds tab
Escape — close any modal or drawer
? — keyboard shortcut help
```

---

## 4. Motor Accessibility

### Touch target compliance
See doc 04 (Human Factors) for the full table. Key failures:
- Whitelist inline "Remove" button: ~18px height (WCAG 2.5.5 failure)
- Item drawer category tabs: ~28px height (borderline)
- Range sliders: browser-default thumb size on mobile

### Pointer gesture requirements
- All interactions are achievable with a single pointer (mouse or touch) ✓
- No multi-finger gestures required ✓
- No time-limited interactions required ✓
- Drag-and-drop is not used anywhere ✓

### Tremor / motor control
- The confirm dialogs for destructive actions provide a safety net for accidental clicks ✓ (where present)
- The 1.8-second success reset in the item drawer prevents accidental double-gifts ✓
- The world card expand/collapse toggle is a 44px button ✓

---

## 5. Visual Impairment

### Color blindness
The semantic color system (green=success, red=danger, yellow=warning) is used consistently, but **color is often the only differentiator** — particularly for the online/offline badge and the active world ring.

- **Deuteranopia** (red-green blindness, ~6% of males): The green "Active" badge and the grey inactive state may be indistinguishable.
- **Protanopia** (red blindness): Same issue — red error and green success may look identical.

**Fix**: Add a non-color cue to all status indicators: a checkmark icon (✓) for active/online/success, an × or – for inactive/offline/error, in addition to the color.

The current implementation partially does this (CheckCircle2 icon in the "Sent!" state, StatusDot component), but not consistently.

### Low vision
- The maximum text size is `text-2xl` (24px) for page titles. Users who browser-zoom to 200% may find the layout breaks.
- The minimum text size is `text-[9px]` in the item grid labels — this is too small for users with low vision even at default browser zoom. WCAG recommends a minimum of 9pt (12px) for any readable text.

**Fix**: Increase item tile label text from `text-[9px]` to `text-xs` (12px) minimum.

---

## 6. Cognitive Accessibility

- **Plain language**: Settings descriptions use clear, concrete language (✓)
- **No time limits**: No timed sessions (the 8-hour JWT expiry is silent) ✓
- **Error identification**: Most error messages are presented inline near the form field ✓
- **Labels**: All form inputs have visible labels or `aria-label` ✓
- **Consistent navigation**: Sidebar/bottom tab structure is identical across all pages ✓
- **Instructions**: Available for complex flows (world switch confirmation text, RCON warning) ✓

### Gaps
- Setting descriptions use technical jargon (e.g. "epoll", "NIO", "RCON", "NBT") that may confuse less technical team members. A `?` tooltip with a plain-English summary would help.
- Some status messages use `✓` and `✗` which have no text equivalent for screen readers (`aria-label` or `aria-hidden` on the icon would fix this).

---

## 7. WCAG 3 / APCA Preview

WCAG 3.0 uses the APCA (Advanced Perceptual Contrast Algorithm) which accounts for spatial frequency, polarity, and font weight in ways WCAG 2.x cannot.

Under APCA:
- `#9B9EA6` on `#F7F5F2` scores Lc ~33. APCA recommends Lc ≥ 60 for body text — this **fails** under both standards.
- `#5B9BF0` on `#FFFFFF` scores Lc ~55. Passes for UI components and large text but is borderline for small text.
- The dark mode palette generally performs better under APCA since it uses true contrast differences rather than luminance-ratio-only calculations.

WCAG 3.0 will also introduce the concept of **Bronze/Silver/Gold conformance levels** replacing A/AA/AAA, with Silver as the expected accessible standard. Based on this review, redstoneCipher would likely achieve Bronze but would need the color contrast fixes above for Silver.

---

## 8. Testing Tools

| Tool | Purpose |
|------|---------|
| [axe DevTools](https://www.deque.com/axe/) | Automated ARIA/HTML accessibility auditing |
| [Colour Contrast Analyser](https://www.tpgi.com/color-contrast-checker/) | Manual color pair checking |
| [APCA Contrast Calculator](https://www.myndex.com/APCA/) | WCAG 3 / APCA contrast check |
| [Accessibility Insights for Web](https://accessibilityinsights.io/) | Chrome extension, Tab stops visualization |
| [NVDA](https://www.nvaccess.org/) + Firefox | Free Windows screen reader for testing |
| [VoiceOver](https://support.apple.com/guide/voiceover/) + Safari/Chrome | macOS/iOS screen reader |
| [Chrome Lighthouse](https://developer.chrome.com/docs/lighthouse/) | Automated accessibility score (CI integration) |
| [eslint-plugin-jsx-a11y](https://github.com/jsx-eslint/eslint-plugin-jsx-a11y) | Linting for common ARIA/HTML a11y errors |
| [react-aria](https://react-spectrum.adobe.com/react-aria/) | Drop-in accessible component primitives (Adobe) |

### Recommended CI Integration
Add `axe-core` to Playwright E2E tests to catch regressions automatically:
```typescript
// Add to each Playwright test
import AxeBuilder from '@axe-core/playwright';
const results = await new AxeBuilder({ page }).analyze();
expect(results.violations).toEqual([]);
```

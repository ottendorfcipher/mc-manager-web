# 03 — UX Laws Analysis

Each law is stated, then evaluated with specific evidence from the codebase and scored.

---

## 1. Fitts's Law
> The time to acquire a target is a function of the distance to, and size of, the target: T = a + b × log₂(D/W + 1)

**Score: ✓ Pass with one violation**

### Compliance
- `icon-btn` class enforces `min-w-[44px] min-h-[44px]` — the Apple HIG / WCAG 2.5.5 recommended minimum touch target (`frontend/src/index.css:20–25`). This applies to Download, Delete, Restore, and Coord Toggle buttons throughout.
- The mobile bottom tab bar has `min-h-[56px]` per tab item — well above the 44×44 minimum.
- The `btn-primary` and `btn-secondary` classes use `px-4 py-2` which yields ~40×32px for short labels (borderline).
- The sidebar nav items use `min-h-[44px]` via `py-2.5` + icon.
- Category tabs in the item drawer use `px-2.5 py-1.5 flex-shrink-0` — at font-size 12px, height is ~28px. **This is too small for reliable touch targeting.** Increasing to `py-2.5` would fix it.

### Violation
- The inline "Remove" button in the whitelist list (`text-xs text-[#F87171]`) has no minimum size class — it relies solely on its text content for its touch target, likely resulting in a ~24×18px target. This is 45% below the recommended minimum.

---

## 2. Hick's Law
> The time to make a decision increases logarithmically with the number of choices: T = b × log₂(n + 1)

**Score: ✓ Pass**

### Compliance
- The item catalog's 11-category tabs reduce the search space from 450+ items to an average of ~41 items per category. This reduces decision time by log₂(450/41) ≈ 3.4× compared to a flat list.
- Permission-gated navigation means users never see options they cannot use. A `member` sees 6 nav items; an `admin` sees 9. Both are well within the 7±2 ideal range.
- The Admin page tabs present 7–8 options, all of which are relevant to the admin's context.
- Weather presets are 3 choices; time presets are 4 — minimal decision load.

### Near-violation
- The Admin tab bar can have up to 8 visible tabs (`global_admin` sees Users, Roles, Pairing, Pending, Whitelist, Worlds, Map, Permissions). On small screens this scrolls horizontally but each tab is only briefly labeled with an icon — when collapsed, users must hover/tap to read labels, adding ~1.35 s of mental parsing per tab.

---

## 3. Jakob's Law
> Users spend most of their time on other sites, and prefer your site to work the same way as all the other sites they already know.

**Score: ✓ Pass**

### Compliance
- Standard form patterns throughout: modal dialogs, labeled inputs, submit buttons.
- The item drawer uses the established slide-in panel convention (Figma, VS Code, Shopify).
- Toggle switches use the standard pill-with-circle affordance used by iOS, Android, and all major design systems.
- The sidebar + mobile bottom tab bar follows the pattern established by Figma, Notion, Linear, Slack.
- Right-click-to-remove / trash icon for deletion follows conventions.
- `×64` and steppers follow e-commerce cart conventions.

---

## 4. Miller's Law
> The average person can only keep 7 (±2) items in their working memory at one time.

**Score: ✓ Pass**

### Compliance
- Item catalog categories: 11 tabs (slightly over Miller's range), but users scan for a recognisable category label, not memorise all options. The task is recognition, not recall — Miller's applies more strictly to recall tasks.
- Gamerule list: 6 items on the Server page.
- Weather presets: 3.
- Time presets: 4.
- Navigation items: 6–9 depending on role (within or at the ceiling of 7±2).
- World cards: No limit enforced — a server with many worlds would exceed the manageable range. Consider paginating or grouping worlds after >10 total.

---

## 5. Tesler's Law (Law of Conservation of Complexity)
> Every application has an inherent amount of irreducible complexity. The question is who deals with it — the designer or the user.

**Score: ✓ Pass**

### Compliance
- The Configure page is the best example: Minecraft's `server.properties` is inherently complex with 50+ raw key-value pairs. redstoneCipher absorbs that complexity through: (a) the SCHEMA system with human labels and descriptions; (b) locking dangerous fields; (c) grouping into 6 logical categories.
- World slug auto-derivation from name: the complexity of filesystem-safe naming is handled by the `slugify()` function, not the user.
- Gamerule toggles: RCON commands and on/off value pairs are abstracted into toggle switches with plain-English labels.
- The KLM analysis shows that the most complex tasks (give item, switch world) are under 13 s of interaction time despite their underlying SSH/RCON complexity.

---

## 6. Von Restorff Effect (Isolation Effect)
> An item that stands out from its peers is more likely to be remembered and noticed.

**Score: ✓ Pass**

### Compliance
- **Active world**: green ring `ring-2 ring-[#36B37E]` and green "Active" badge distinguish it from inactive world cards at a glance.
- **Pending saves**: yellow dot (●) on modified fields in the Configure page stands out from the grey setting rows.
- **Online vs offline badge**: green `bg-[#ECFDF5] text-[#36B37E]` vs grey `bg-[#F0EDE9] text-[#9B9EA6]` clearly differentiates player states.
- **btn-danger**: the red bordered ghost style `btn-danger` stands out from `btn-secondary` and `btn-primary`, drawing attention to destructive actions.
- **Locked fields**: 🔒 + amber warning text isolate locked settings from editable ones.

### Opportunity
- The "Backup Now" button inside a world card competes visually with other actions (Download, Delete) since all use similar sizes. Making "Backup Now" more visually prominent when the world is active would reinforce the Von Restorff principle.

---

## 7. Zeigarnik Effect
> People remember uncompleted or interrupted tasks better than completed ones.

**Score: ✓ Pass**

### Compliance
- The Config page's yellow pending-change indicator persists until the user explicitly saves or reloads — keeping the user aware of unsaved work.
- The `Save N changes` button shows the count of pending edits, reinforcing incomplete task awareness.
- The pending players badge/tab shows items waiting for admin action.

### Opportunity
- The chat page has no visual indicator when there are unread messages (if the user is on another page). Adding an unread badge to the Chat nav item would leverage the Zeigarnik Effect to draw users back.

---

## 8. Doherty Threshold
> Productivity soars when a computer and its users interact at a pace (<400 ms) that ensures that neither has to wait on the other.

**Score: ⚠ Partial**

### Compliance
- API responses for gamerule toggles, chat send, player approval, and most CRUD operations complete in <400 ms in normal conditions.
- Optimistic UI is used in the coord display toggle (badge changes color immediately before the API response confirms).
- React Query's `staleTime: 30_000` prevents excessive refetches, keeping the UI responsive.

### Violations
- World switch: 90–180 s. Unavoidable due to rsync, but the UX should communicate progress.
- Backup creation: ~90 s. Same issue.
- VM start: 1–2 min. The progress bar is shown, but indeterminate bars are less reassuring than step-based indicators.

---

## 9. Law of Proximity
> Objects that are near, or proximate, to each other tend to be grouped together.

**Score: ✓ Pass**

### Compliance
- Card containers group related controls (all world settings in one card, all whitelist controls in another).
- The item give drawer footer groups the preview, quantity stepper, and give button as a single actionable unit.
- In the Config page, the setting label + description + control are in a single row — the visual proximity establishes that all three relate to the same setting.

---

## 10. Law of Common Region
> Elements tend to be perceived as part of a group if they are located within the same closed region.

**Score: ✓ Pass**

### Compliance
- `.card` class consistently defines closed regions (white background, rounded corners, border) across all pages.
- The gamerule section uses `divide-y` within a single card rather than separate cards for each rule — this communicates that all gamerules belong to a single control group.
- The Worlds tab uses expand/collapse within each world card to reveal members and backups — all content for a world is bounded by its card.

---

## 11. Peak-End Rule
> People judge an experience largely based on how they felt at its most intense point and at its end.

**Score: ✓ Pass**

### Compliance
- The item give experience ends with a green "Sent to {ign}!" button — a satisfying, clear success state that serves as a positive end.
- The world switch ends with the worlds list updating to show the new active world with its green ring — a visible and rewarding conclusion.
- The login page backdrop (falling Minecraft blocks, pixelated terrain) creates a positive peak experience on first login.
- The pending-player approval flow ends with the player disappearing from the queue — a clean completion state.

### Opportunity
- After a long backup operation (90 s), the success feedback is a new row appearing in the backup list. Adding a brief success toast ("✓ Backup complete — 78.3 MB") would provide a more emotionally satisfying end point.

---

## 12. Goal-Gradient Effect
> People accelerate effort as they get closer to a goal.

**Score: ⚠ Partial**

### Compliance
- The item give drawer shows progress towards the give goal via the preview card: once an item is selected, the preview fills in (name, count), and the give button activates.
- The Config page shows `Save N changes` — the count reinforces how much work has been done.

### Gap
- Multi-step flows (world switch, backup) have no visible step progress. A "Step 2 of 5" indicator during the server-side operation would activate the goal-gradient effect, encouraging users to wait rather than abandon.

---

## Summary Scorecard

| Law | Score | Top issue |
|-----|-------|-----------|
| Fitts's Law | ⚠ | Inline "Remove" button too small |
| Hick's Law | ✓ | — |
| Jakob's Law | ✓ | — |
| Miller's Law | ✓ | World list has no upper limit |
| Tesler's Law | ✓ | — |
| Von Restorff | ✓ | — |
| Zeigarnik Effect | ✓ | No chat unread badge |
| Doherty Threshold | ⚠ | Long server ops lack step progress |
| Law of Proximity | ✓ | — |
| Law of Common Region | ✓ | — |
| Peak-End Rule | ✓ | Backup success feedback is weak |
| Goal-Gradient Effect | ⚠ | No step progress on long operations |

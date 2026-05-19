# 01 — NN/g Heuristic Analysis

Nielsen Norman Group's ten usability heuristics evaluated against redstoneCipher. Each heuristic is scored **Pass ✓ / Partial ⚠ / Fail ✗** with specific evidence from the codebase.

---

## H1 — Visibility of System Status
> Keep users informed about what is happening through appropriate feedback, within a reasonable time.

**Score: ⚠ Partial**

### What works
- Real-time status dots (`StatusDot` component) on the Dashboard correctly reflect VM state (`RUNNING`, `STOPPED`, `TERMINATED`) with semantic colors.
- Loading spinners are shown consistently during async operations (`border-t-transparent rounded-full animate-spin`).
- The Server page shows an indeterminate progress bar and copy text ("Starting VM… This takes 1–2 minutes") during VM actions.
- `ItemGiveDrawer` shows `"Sent to {ign}!"` with a green button on success, resetting after 1.8 s.
- Chat SSE reconnection is handled — the stream auto-reconnects if the connection drops.
- The Config page shows a yellow dot (●) next to each modified-but-unsaved field (`edits[s.key] !== undefined`).
- The active world in the Worlds tab has a green ring (`ring-2 ring-[#36B37E]`) and an "Active" badge.

### Gaps
- **`statusMsg` is inline text** in the Server page header row. It is not an `aria-live` region, so screen readers never announce it. Sighted users can also miss it if they are looking at the content area.
- **World switch** takes 1–3 minutes. The `POST /api/worlds/:id/activate` call is synchronous from the browser's perspective — the modal spinner ("Switching…") shows while the HTTP request is pending, but there is no progress indication during the SSH-and-rsync phase. A user sitting at the screen sees a spinner for 3 minutes with no sub-step feedback.
- **Backup creation** has the same pattern. The "Backing up…" state is shown but no size/progress is surfaced.
- **Chat history hydration** shows no loading indicator while the initial history is fetched, only an empty chat log.

### Recommendations
1. Wrap all `statusMsg` state in `<div role="status" aria-live="polite">` so screen readers announce updates.
2. For long-running SSH operations (world switch, backup creation), consider polling a `/api/jobs/:id/status` endpoint and surfacing step names ("Saving current world…", "Loading target world…").
3. Add a skeleton-screen or spinner to the chat history area during the initial fetch.

---

## H2 — Match Between System and Real World
> Use words, phrases, and concepts familiar to the user, rather than system-oriented terms.

**Score: ✓ Pass**

### Evidence
- Minecraft vocabulary is used throughout: IGN, whitelist, op, RCON, gamerule, NBT — all terms a Minecraft server admin knows.
- World settings use plain descriptions alongside technical keys (`"Mob Griefing"` rather than `"mobGriefing"`).
- Status labels like "Online — instant delivery" vs "Offline — queued for login" in the item drawer are concrete and accurate.
- Time-of-day presets use emoji + human labels (🌅 Sunrise, ☀️ Day) rather than raw tick numbers.
- Weather cards use animated GIFs for recognition rather than text labels alone.

### Minor gaps
- The Backups page refers to `.tar.gz` filenames in the file list. Most team members will recognise these, but consider adding a human-readable size + age alongside.
- `server.properties` key names like `network-compression-threshold` are exposed in the Configure page labels. The descriptions mitigate this well.

---

## H3 — User Control and Freedom
> Users often choose system functions by mistake; they need a clearly marked "emergency exit".

**Score: ⚠ Partial**

### What works
- World switch has a confirmation dialog warning of the server restart.
- Backup restore has a confirmation dialog warning of data loss.
- The Config page accumulates pending changes without immediately saving — the user can reload to discard all edits.
- Item give drawer can be closed by clicking the scrim (outside the panel).

### Gaps
- **Destructive admin actions with no confirmation**: removing a user from the whitelist (Server page "Remove" button), banning a player, kicking a player, removing a team member's IGN link. These are one-click with no undo.
- **World deletion**: the `DELETE /api/worlds/:id` handler has `confirm()` in the frontend but uses the browser-native `confirm()` dialog, which is modal-blocking and does not match the app's visual design — a Fitts's Law failure (the native dialog button may not be near the user's cursor).
- There is no global undo mechanism. If an admin accidentally changes a gamerule, they must remember the previous value and toggle it back.

### Recommendations
1. Replace `confirm()` calls with the in-app confirmation pattern (modal card) used for world switch and backup restore.
2. Add confirmation dialogs for: ban, kick, removing a player from the whitelist, removing an IGN link.
3. Consider soft-delete or a 30-second undo toast for irreversible single-click actions.

---

## H4 — Consistency and Standards
> Users should not have to wonder whether different words, situations, or actions mean the same thing.

**Score: ✓ Pass**

### Evidence
- `btn-primary`, `btn-secondary`, `btn-danger`, `.card`, `.page`, `.page-wide` utility classes provide a consistent component vocabulary across all pages (`frontend/src/index.css`).
- Navigation items use the same `nav-item` / `nav-item-active` classes on both the sidebar (desktop) and the bottom tab bar (mobile).
- All toggle switches use `role="switch"` with identical visual and ARIA behavior.
- Loading states are consistently shown with the same CSS spinner pattern throughout.
- Success messages use green (`#36B37E`) and checkmark icons consistently.
- Error messages use red (`#F87171`) consistently.

### Minor inconsistencies
- The `btn-danger` class is a bordered ghost style (`border border-[#F87171] text-[#F87171]`), but the "Remove" button in the whitelist is unstyled text (`text-xs text-[#F87171]`). The affordance is inconsistent.
- The `ItemGiveDrawer` uses a right-side slide-in panel, while all other modals are center-screen dialogs. This is intentional for the drawer pattern, but users encountering it for the first time may be surprised.
- Some pages use `page-header` for the title+action row; others don't. `AdminPage` has an inline `<div>` title block without `page-header`.

---

## H5 — Error Prevention
> Design carefully to prevent problems from occurring in the first place.

**Score: ⚠ Partial**

### What works
- The Config page locks dangerous fields (`server-port`, `online-mode`, `enable-rcon`) with a 🔒 icon and descriptive warning text explaining the risk.
- The world slug field auto-derives from the name (slugify) to prevent invalid directory names.
- Slug validation on the backend (`is_ascii_alphanumeric || c == '-' || c == '_'`) prevents filesystem-unsafe characters.
- The "Backup Now" button is disabled for non-active worlds (prevents creating a backup of stale data).
- The `DELETE /api/worlds/:id` endpoint refuses to delete the active world (returns 400).
- The item give drawer clamps the quantity to 1–64, matching Minecraft stack limits.

### Gaps
- **Config import** accepts arbitrary JSON and merges it directly into pending edits without validation against the SCHEMA definitions. A user could import `{ "online-mode": "false" }` and, if they have write permission, disable auth entirely.
- **Gamerule toggles** send the change immediately on click without a confirmation step, even for high-impact toggles like "Hardcore Mode" (which permanently bans players on death).
- **Server "Force Reset"** button is presented alongside "Start VM" and "Stop VM" with similar visual weight. A user intending to start may accidentally hit reset.

### Recommendations
1. Validate the import payload against the SCHEMA definition — reject (or warn on) any key that is `locked: true`.
2. Consider adding an intermediate `pending` state for high-risk gamerule toggles.
3. Visually separate "Force Reset" (danger) from "Start" and "Stop" — use a dropdown or secondary card.

---

## H6 — Recognition Rather Than Recall
> Minimize the user's memory load by making objects, actions, and options visible.

**Score: ✓ Pass**

### Evidence
- KLM-GOMS analysis (doc 02) confirms category tabs reduce average time-to-target by ~75% vs a flat list.
- Minecraft avatar images are shown alongside IGN strings throughout, aiding recognition.
- Datalist suggestions in the MC Pairing card surface known player names.
- The Config page shows current values for all settings, so the user never has to remember what a setting is set to.
- Gamerule descriptions are shown inline (not in a tooltip requiring hover to reveal).
- Backups list includes filename, size, and relative time — no need to decode timestamps.

### Minor gaps
- The chat page does not show the sender's avatar alongside messages — only `display_as` text. Adding avatars would aid recognition for servers with many players.
- The world slug field doesn't show a preview of the resulting directory path (e.g. `/opt/minecraft/worlds/creative-build/`) which would make the system model more concrete.

---

## H7 — Flexibility and Efficiency of Use
> Accelerators — unseen by novices — allow experts to speed up interactions.

**Score: ✗ Fail**

### Gaps
- **No keyboard shortcuts** anywhere in the application.
- **No bulk operations**: admins cannot select multiple pending players and approve/reject them all at once.
- **No search on the users list, whitelist, or players list** (beyond the item drawer search, which is well implemented).
- **No quick-jump from the Dashboard to the active world's backup list**.
- The item drawer search box is focused on mount (accelerator) ✓, but there are no keyboard shortcuts to navigate between categories.
- No "recently used" or "pinned items" in the item give drawer.

### Recommendations
1. Add global keyboard shortcuts: `G D` for Dashboard, `G S` for Server, etc. (GitHub-style navigation).
2. Add multi-select + bulk approve/reject for the pending players queue.
3. Add search/filter to the admin users list.
4. Add a keyboard shortcut cheatsheet accessible via `?`.

---

## H8 — Aesthetic and Minimalist Design
> Interfaces should not contain irrelevant or rarely needed information.

**Score: ✓ Pass**

### Evidence
- Permission-gated rendering means each role sees only the UI relevant to their access level — visitors don't see server controls, members don't see admin tools.
- Cards have generous whitespace and a single level of nesting.
- The configure page hides locked-but-irrelevant fields behind the section structure rather than removing them.
- The dashboard shows only 4 metrics, not a wall of server stats.

### Minor concerns
- Emoji are used heavily throughout (🎒🔥💥👾🏆 in gamerules; 🛡️🎮🌍 in server page). For sighted users this adds visual variety, but for screen readers each emoji is read as its description ("backpack emoji", "fire emoji"), creating noise.
- The login backdrop animation (falling Minecraft blocks) is charming but adds visual weight. `prefers-reduced-motion` removes it correctly ✓, but it may be too prominent for a password-focused login page.

---

## H9 — Help Users Recognize, Diagnose, and Recover from Errors
> Error messages should be expressed in plain language, indicate the problem, and suggest a solution.

**Score: ⚠ Partial**

### What works
- Form errors show inline next to the relevant field.
- API errors bubble up via the `onError` React Query callback and display the error message.
- The item give drawer shows the raw API error message below the give button.
- The world create modal shows the error inline.

### Gaps
- Error messages are often raw API text: `"Conflict: A world with slug 'survival' already exists"`. This is accurate but not user-friendly — there is no guidance on how to fix the issue.
- Network errors from React Query display generic messages that expose API details (e.g. HTTP status codes).
- The Config page save mutation has no error display — if saving fails, nothing is shown to the user.
- There is no global error boundary — an uncaught React rendering error will crash the entire application.

### Recommendations
1. Add an error boundary (`<ErrorBoundary>`) at the app root and per-feature level.
2. Write a thin error message translation layer: map common error codes to friendly strings with remediation steps.
3. Add error display to the Config page save mutation.

---

## H10 — Help and Documentation
> It's best if the system can be used without documentation, but sometimes it may be necessary to provide help.

**Score: ⚠ Partial**

### What works
- Every setting in the Configure page has an inline description explaining what it does and its default value.
- Locked fields include `lockMsg` explaining why they are locked.
- World switch confirmation dialog explains the restart behavior.
- Tooltips (`title` attributes) provide additional context on hover for icon buttons.

### Gaps
- There is no contextual help panel or "?" button anywhere in the application.
- First-time users have no onboarding — opening the admin panel with no users whitelisted shows an empty state with no guidance on what to do next.
- The pending players tab explains the admission flow, but only after a player has appeared in the queue.
- No in-app link to documentation or the project README.

### Recommendations
1. Add a collapsible "How it works" section to the Worlds tab, Chat page, and Pending Players tab explaining the underlying mechanics.
2. Add empty-state illustrations with call-to-action text for first-time use of each major feature.
3. Add a `?` help link to the page header that opens the relevant section of the README or DEPLOYMENT.md.

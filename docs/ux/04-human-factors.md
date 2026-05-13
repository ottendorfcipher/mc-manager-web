# 04 — Human Factors & Ergonomics

Human Factors (HF/E) examines the interaction between humans and systems from physical, cognitive, and environmental perspectives.

---

## 1. Physical Ergonomics

### Touch Target Sizes
Recommended minimums: WCAG 2.5.5 (44×44 CSS px), Apple HIG (44×44 pt), Material Design (48×48 dp), Google Touch Target guidance.

| Component | Actual size | Compliant? |
|-----------|------------|------------|
| `icon-btn` | min 44×44 px | ✓ |
| Mobile tab bar items | 56 px height | ✓ |
| `btn-primary` short labels | ~40×32 px | ⚠ borderline |
| Item drawer category tabs | ~28 px height | ✗ |
| Whitelist "Remove" text button | ~24×18 px | ✗ |
| Gamerule toggle switches | 20×36 px | ⚠ (thumb width OK, height small) |
| Slider `<input type=range>` | varies by browser | ⚠ (no min enforced) |

The `<input type="range">` sliders on the Config page and Server page have no explicit height — they render at browser default, which is often as small as 14 px on mobile. This is a significant touch-target failure for the most finger-intensive controls.

**Fix**: Add `class="h-6 w-full cursor-pointer"` to all sliders; the thumb should be styled to `min-w-[44px] min-h-[44px]` via custom CSS or a range slider component.

### Reach Zones on Mobile
On a standard phone held with one hand, the comfortable single-thumb reach zone is roughly the bottom 60% of the screen. The mobile bottom tab bar places primary navigation in this zone ✓. However, page headers with action buttons (e.g. "New World", "Create Backup") are placed at the top of the content area, requiring a stretch or grip re-adjustment.

**Recommendation**: For the highest-frequency admin action buttons, consider floating action buttons (FABs) in the bottom-right of the screen on mobile, or moving action buttons to the bottom of page content.

### Pointer Precision
The minimum pointer target size for mouse-based use (not touch) is generally 24×24 px. All interactive elements meet this threshold except the Whitelist inline "Remove" text button (~18 px height).

---

## 2. Cognitive Ergonomics

### Working Memory Load
Human working memory capacity: 7±2 items (Miller, 1956). More recent research by Cowan (2001) suggests the true limit is closer to 4 items for unfamiliar content.

| Page | Item count in primary view | Assessment |
|------|---------------------------|------------|
| Dashboard | 2 status tiles + 4 metric tiles = 6 | ✓ |
| Server | 3 VM buttons + 4 time + 3 weather + 6 gamerules = visible all at once | ⚠ Long scroll, but sections reduce cognitive grouping |
| Config | 6 categories × avg 7 settings = 42 total | ✓ Pagination by category reduces working memory |
| Admin Users | User list (potentially many) + detail panel | ⚠ No pagination or virtualization |
| Item Drawer | 4-wide grid, category-filtered (~41 avg) | ✓ |
| Worlds | Collapsed world cards (2–10+) | ✓ Collapse helps |

### Cognitive Switching Costs
The Admin page uses a tab interface with 7–8 tabs. Switching between tabs (e.g. from Users to Worlds) clears the in-progress state of the previous tab — a user editing a role and accidentally clicking the Worlds tab loses their context. This is a moderate cognitive switching cost.

**Mitigation**: Persist unsaved tab state (or warn before navigating away) when a form is in a modified state.

### Skill Acquisition (Fitts-Anderson Model)
- **Cognitive stage** (new users): Users read every label before acting. The descriptive text on all settings is invaluable here.
- **Associative stage** (practiced users): Users identify patterns — all toggles on the left of rows, all action buttons on the right. The consistent layout supports this.
- **Autonomous stage** (expert users): Users use muscle memory and peripheral vision. Keyboard shortcuts are absent, preventing users from reaching the autonomous stage for navigation.

---

## 3. Perceptual Ergonomics

### Luminance and Contrast
(Detailed contrast calculations in doc 06 — Accessibility.)

- Background `#F7F5F2` is a warm off-white rather than pure `#FFFFFF`. This reduces the harsh luminance contrast of pure white, which is physiologically easier on the eyes for prolonged use (reduces glare adaptation strain).
- Dark mode background `#13151A` is near-black with a slight warm hue — appropriate for low-light environments and OLED screens (true black pixels are off = zero power).
- The red error color `#F87171` is desaturated slightly (vs pure `#FF0000`) — this reduces chromatic aberration for users with astigmatism who struggle with high-saturation red.

### Flicker and Motion
- The falling Minecraft blocks on the login screen animate at `linear` timing with CSS `transform: translate3d` (GPU-accelerated, no repaints). This is the correct implementation for smooth animation.
- `prefers-reduced-motion: reduce` stops all animations ✓ — essential for users with vestibular disorders.
- The indeterminate progress bar on the Server page uses `animate-[progress_1.4s_ease-in-out_infinite]` — this creates a lateral scanning motion. Some users with photosensitive epilepsy may be sensitive to horizontal oscillating motion, though the bar is narrow and the frequency is below the 3 Hz photosensitive threshold.

### Reading and Scanning Patterns
- The F-pattern of reading (users scan left-aligned headers, then scan horizontally left) is respected: all page titles are left-aligned, the most important information in each row is on the left.
- The Z-pattern (diagonal scanning of sparse content) is used effectively on the Dashboard — status tiles flow left-to-right, then the metrics grid continues the Z.
- Card grids use a left-to-right, top-to-bottom scan order consistent with western reading direction.

---

## 4. Environmental Factors

### Lighting Conditions
- The app will often be used in gaming/home-office environments with variable lighting.
- Dark mode support ✓ — appropriate for low-light gaming setups.
- The color palette avoids pure white and pure black — good contrast without excessive glare.

### Device Context
The primary use cases:
1. **Desktop admin** (likely most frequent): Full sidebar, wide cards, hover effects. Well-optimized.
2. **Tablet admin**: Medium screen. The `sm:` breakpoints activate at 640px — most tablets exceed this. Generally well-handled.
3. **Mobile admin** (emergency access): Bottom tab bar, stacked layouts. The responsive `.page` class (`p-4 max-w-4xl`) and flex-column fallbacks work correctly.
4. **Mobile player** (members checking their inventory or chat): Players are more likely to use mobile. The Inventory page's two-panel layout (player roster + snapshot) may be too cramped on small screens.

### Network Conditions
- React Query's `staleTime: 30_000` and `retry: 1` settings are reasonable for a private admin tool on a reliable home network.
- SSE (Server-Sent Events) for chat requires a persistent connection — on mobile networks with aggressive timeout behavior, this connection may drop frequently. The auto-reconnect logic should be verified to handle mobile network switching.
- The large backup download (via streaming) has no progress indicator — users on slower connections may not know whether the download is progressing or stalled.

---

## 5. Error-Prone Interactions

Using James Reason's error taxonomy (slips, lapses, mistakes):

| Interaction | Error type | Risk | Mitigation present? |
|-------------|-----------|------|---------------------|
| "Force Reset" VM | Slip (adjacent to "Stop VM") | High | No ✗ |
| Whitelist "Remove" | Slip (tiny target) | Medium | No ✗ |
| Gamerule toggle (immediate) | Slip | Medium | No ✗ |
| Config import (unsafe JSON) | Mistake | High | Partial ⚠ |
| World deletion (native confirm()) | Slip | Low (non-active only) | Native confirm ⚠ |
| Ban player (one-click) | Slip/Lapse | High | No ✗ |
| Give item wrong quantity | Slip | Low | Clamped 1–64 ✓ |

**Slips** are automatic-behavior errors caused by inattention. They are best prevented through spatial separation, confirmation dialogs, and undo.

**Mistakes** are plan-based errors. They are best prevented through guidance text, locked fields, and validation.

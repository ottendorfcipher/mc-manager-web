# 08 — Visual Hierarchy & Color Theory

---

## 1. Typography Scale

### Current hierarchy (Tailwind defaults)

| Class | px equivalent | Weight | Usage |
|-------|--------------|--------|-------|
| `text-2xl` | 24px | `font-bold` | Page titles (`<h1>`) |
| `text-xl` | 20px | — | Not used explicitly |
| `text-base` | 16px | — | Not used explicitly |
| `text-sm` | 14px | `font-semibold` / `font-medium` | Card titles, body content |
| `text-xs` | 12px | `font-semibold` / `font-medium` | Labels, meta, descriptions |
| `text-[10px]` | 10px | `font-semibold` | Badges, tiny labels |
| `text-[9px]` | 9px | `font-medium` | Item grid tile labels |

### Analysis

**Strengths**:
- Clear 3-level hierarchy: `2xl` (page) → `sm` (section/card) → `xs` (meta) is immediately legible
- Font weight compensates for small size: `xs` with `font-semibold` reads more clearly than `xs` with `font-normal`
- Monospace (`font-mono`) is used consistently for technical identifiers (IGN, UUID, slugs, file paths)

**Weaknesses**:
- No explicit `<h2>` / `<h3>` heading hierarchy on pages like Configure (section headers use `text-base font-bold` but are `<h2>` elements ✓) — the Admin page header section cards use `text-xs font-semibold uppercase tracking-wider` styled `<p>` elements rather than `<h2>` elements, breaking semantic heading structure
- `text-[9px]` for item tile labels is below the WCAG minimum readable size (12px)
- There is no `text-xl` usage — the jump from 24px to 14px is large, creating visual weight gaps

**Recommendations**:
1. Replace `<p>` section headers in Admin tabs with `<h2>` / `<h3>` — preserves visual style, adds semantic structure
2. Increase item tile labels from `text-[9px]` to `text-xs` (12px)
3. Consider adding `text-lg` (18px) for card section titles that currently compete with 14px body text

### Line length and readability
- The `.page` class constrains to `max-w-4xl` (896px) and `.page-wide` to `max-w-5xl` (1024px) — appropriate line lengths for readability (optimal: 50–75 characters, roughly 600–900px at 16px)
- Content within cards wraps naturally without overflow
- The Configure page has the longest text content (setting descriptions) — these stay within the card width and don't exceed 75 characters at normal viewport widths ✓

---

## 2. Color Theory

### Primary Palette

| Color | Hex | Role | Theory notes |
|-------|-----|------|--------------|
| Blue | `#5B9BF0` | Primary CTA / active state | Mid-range blue — trustworthy, professional. In the HSL model: H≈215, S≈81%, L≈65% — bright but not saturated. Aligns with "technology/competence" color associations |
| Green | `#36B37E` | Success / active / online | Analogous to the Minecraft grass color. H≈152, S≈52%, L≈45%. Mid-green avoids both the "traffic light red-green" cliché and the garish lime of pure game UI |
| Red | `#F87171` | Danger / error / offline | Desaturated red (H≈0, S≈90%, L≈70%) — attention-getting but less aggressive than pure red, reducing emotional alarm for minor errors |
| Amber | `#FBBF24` | Warning / pending changes | High-luminance yellow-amber (H≈43, S≈96%, L≈55%) — works on dark backgrounds (9.1:1) but fails on white. Consider `#B45309` (dark amber) for light mode warning text |
| Off-white | `#F7F5F2` | Page background | Warm off-white (H≈30, S≈11%, L≈96%) — this is a design choice that distinguishes the app from clinical all-white tools. Reduces glare and adds warmth |
| Near-black | `#1C1E27` | Primary text / dark surface | Slightly blue-shifted black (H≈228, S≈18%, L≈13%) — warmer than pure black, consistent with the overall blue-shifted dark palette |

### Color Harmony
The palette uses a **split-complementary** scheme:
- **Dominant**: Blues (`#5B9BF0`) — cool, professional
- **Secondary**: Green (`#36B37E`) — warm complement to blue (analogous, slightly opposite on the wheel)
- **Accent**: Amber (`#FBBF24`) — warm complement to blue (near-complementary)
- **Neutrals**: Warm greys with slight blue cast (`#1C1E27`, `#6B6E78`, `#9B9EA6`) maintain harmony

This is a coherent, professional palette. The warm neutrals (`#F7F5F2`, `#D9D5D0`) prevent the blues from feeling cold.

### Color Semantics
The semantic mapping is consistent and follows established conventions:

| Color | Semantic meaning | Examples |
|-------|----------------|---------|
| Blue | Interactive / selected | Primary button, nav active, focus ring, links |
| Green | Operational / success | Active world, online players, success states |
| Red | Danger / error | Danger buttons, error messages, offline states |
| Amber / Yellow | Warning / pending | Unsaved changes dot, locked field warnings |
| Grey | Inactive / metadata | Disabled controls, secondary text, borders |

### What the color palette communicates (color psychology)
- The blue-dominant palette signals: trustworthiness, technology, competence — appropriate for a management tool
- Green for "active" mirrors the Minecraft grass aesthetic, creating a domain-appropriate emotional connection
- The warm off-white background signals: approachability, warmth, craftsmanship — contrasting with "corporate" pure white and softening the technical nature of the content

---

## 3. Visual Hierarchy Principles

### Size hierarchy
```
Page title (24px bold) ──────────── Most important
Section / card title (14px semibold)
Body / row label (14px medium)
Description / metadata (12px regular) ──── Supporting
Tiny badges / codes (10px semibold)
```

The hierarchy is readable at a glance. The critical missing tier is `18px` semi-bold — there's no intermediate weight between page title and card content. This means the Admin page tabs visually compete with the page title.

### Weight hierarchy
- `font-bold` — reserved for page titles and section headers
- `font-semibold` — card titles, active states, emphasis
- `font-medium` — interactive labels (buttons, nav items)
- `font-normal` — descriptions, metadata, secondary content

This is clean and well-applied.

### Spatial hierarchy (whitespace)
- Cards use `p-4` (16px) padding — adequate breathing room
- Page-level spacing uses `space-y-5 sm:space-y-6` — consistent vertical rhythm
- Row-level spacing uses `py-2` / `py-3` in divider lists — consistent density

The consistent spacing creates a clear visual rhythm that guides the eye from top (primary info) to bottom (supporting info) through each card.

### Z-axis hierarchy (depth)
- Background: `#F7F5F2` (page)
- Mid-ground: `#FFFFFF` (cards)
- Foreground: Modals + drawers (`shadow-2xl`) with scrim overlay
- Critical: `z-50` for modals, `z-40` for scrims, `z-40` for mobile nav

The z-index layering is deliberate and avoids conflicts. The shadow-only elevation model (no hard borders or gradients) keeps depth subtle.

---

## 4. Gestalt Principles Applied

### Figure-Ground
- Dark overlay scrim on modals clearly separates the modal (figure) from the background content (ground) ✓
- White cards on the warm `#F7F5F2` background create a subtle but effective figure-ground separation

### Similarity
- All interactive buttons share the same rounded-lg shape and height
- All cards share identical styling
- All spinners use identical CSS animation

This similarity allows users to instantly recognize interactive vs static elements.

### Continuity
- The sidebar nav items flow top-to-bottom in order of information architecture depth (dashboard → operational → management → admin)
- The Config page sections flow logically: Identity → World → Gameplay → Performance → Resource Pack → Security

### Symmetry
- Two-column layouts (Dashboard status row, Config label+control rows) create symmetric balance
- The item give drawer's 4-column grid is symmetric and predictable

### Closure
- Cards with rounded corners + drop shadow provide strong closure — the eye perceives each card as a complete, bounded object
- The item tile selection state (blue border) creates visual closure around the selected item

### Common fate
- All tiles in the item grid respond to hover simultaneously (border appears) — creating a visual group through shared behavior

---

## 5. Dark Mode Analysis

### Implementation approach
The dark mode uses Tailwind's `dark:` variant triggered by a class on the `<html>` element (via `useThemeStore`). Three modes: `light`, `dark`, `system` (respects `prefers-color-scheme`).

### Palette shifts in dark mode

| Light | Dark | Notes |
|-------|------|-------|
| `#F7F5F2` bg | `#13151A` bg | Near-black with blue shift — premium feel, great for OLED |
| `#FFFFFF` card | `#222530` card | 1 step lighter than bg — subtle but visible elevation |
| `#1C1E27` text | `#EAECF0` text | Near-white — high contrast ✓ |
| `#9B9EA6` meta | `#9BA0B0` meta | Slightly cooler to match dark bg — but both fail contrast |
| `#5B9BF0` blue | `#5B9BF0` blue | Unchanged — maintains identity ✓ |
| `#D9D5D0` border | `#363944` border | Dark borders subtle against dark bg ✓ |
| Warm hover | `#2A2D38` hover | Cool hover appropriate for dark context ✓ |

### Dark mode strengths
- The near-black background with blue shift creates a premium, gaming-appropriate aesthetic
- OLED-friendly: true near-black pixels reduce power consumption on mobile OLED screens
- The two-tone elevation (background vs card) is subtle but effective — cards don't float too dramatically
- Semantic colors (blue, green, red) have better contrast ratios in dark mode overall

### Dark mode gaps
- The `#9BA0B0` on `#222530` contrast failure (3.1:1) affects the most information-dense text in dark mode
- A "system" mode correctly respects OS preference ✓, but there is no smooth transition animation between modes (page re-renders instantly)

---

## 6. Iconography

All icons use the Lucide React library — a clean, consistent icon set with 2px strokes, rounded line caps, and consistent optical sizing.

### Strengths
- All icons use `aria-hidden` when decorative ✓
- Icon sizes are consistent: `w-4 h-4` for inline icons, `w-3.5 h-3.5` for compact contexts, `w-5 h-5` for mobile nav
- Icon + text labels are used for all major navigation items — icons alone are only used where `aria-label` or `title` provides the text alternative

### Gap
- The `StatusDot` component uses CSS-only dot states — no icon. Colorblind users relying solely on the status dot cannot distinguish RUNNING (green) from STOPPED (grey). Adding an icon glyph (▶ for running, ■ for stopped) would address this.

---

## 7. Motion and Animation Design

| Animation | Type | Duration | Easing | Appropriate? |
|-----------|------|---------|--------|-------------|
| Login backdrop blocks | CSS keyframe | Loop / linear | Linear | ✓ (GPU layer) |
| Spinner | CSS animation | Infinite | Linear | ✓ |
| Toggle switch | CSS transition | 150ms | Default | ✓ |
| Button hover | CSS transition | 150ms | Default | ✓ |
| Drawer open | No animation | — | — | ⚠ Drawer appears instantly — could benefit from 200ms slide-in |
| Modal appear | No animation | — | — | ⚠ Modal appears instantly — could benefit from 150ms fade/scale-in |
| Progress bar | CSS animation | 1.4s | ease-in-out | ✓ |
| Pickaxe swing | CSS keyframe | 480ms | ease-in-out | ✓ |

**Recommendation**: Add `transition-opacity duration-150` + `translate-x` to the drawer and `scale-95 → scale-100 opacity-0 → opacity-100` to modals. These are 1-line CSS additions that significantly improve perceived quality. Both should be suppressed under `prefers-reduced-motion`.

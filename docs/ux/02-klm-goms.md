# 02 — KLM-GOMS Task Analysis

Keystroke-Level Model (KLM) operators with standard timings, applied to critical redstoneCipher workflows. Goals, Operators, Methods, and Selection rules (GOMS) provide the structural breakdown.

## KLM Operators Used

| Symbol | Operator | Time (s) |
|--------|----------|----------|
| K | Keystroke (typing one character) | 0.12 |
| P | Pointing to target with mouse | 1.10 |
| B | Button press (mouse click) | 0.10 |
| BB | Button press + release | 0.20 |
| H | Home (hand moves to keyboard or mouse) | 0.40 |
| M | Mental preparation (recognise, decide) | 1.35 |
| W | Wait for system response | actual time |

> **Reference times** from Card, Moran & Newell (1980) for an average skilled user.
> Mobile touch targets use P = 0.80 s (shorter reach distances) and K = 0.20 s (touch keyboard).

---

## Task 1 — Give an Item to an Online Player

**Goal**: Admin gifts 64 diamonds to an online player.

**Starting state**: Dashboard is open; user navigates with mouse.

```
GOAL: give-item
  GOAL: navigate-to-players
    M (decide to go to Inventory) ......... 1.35
    P (sidebar Inventory link) ............ 1.10
    BB ..................................... 0.20
    W (page load, cached) ................. 0.10
  GOAL: open-give-drawer
    M (scan player list) .................. 1.35
    P (target player card) ................ 1.10
    BB (click Give button) ................ 0.20
  GOAL: find-item
    [search is focused on mount — no H needed]
    K×8 ("diamonds") ...................... 0.96
    M (recognise Diamond in results) ...... 1.35
    P (click Diamond tile) ................ 1.10
    BB ..................................... 0.20
  GOAL: set-quantity
    P (×64 button) ........................ 1.10
    BB ..................................... 0.20
  GOAL: confirm-give
    P (Give button) ....................... 1.10
    BB ..................................... 0.20
    W (API call ~300ms) ................... 0.30
    M (read success state "Sent!") ........ 1.35
                                         --------
  TOTAL (desktop) ........................ 11.96 s
  TOTAL (mobile, adjusted P=0.80) ........ 10.41 s
```

**Assessment**: Under 12 seconds for a non-trivial find-and-give workflow is excellent. The auto-focus on the search input eliminates one `H` + `P` (saving ~1.5 s). The `×64` quick button avoids 4 pointer clicks to increment the count.

**Opportunity**: Adding keyboard navigation between category tabs (`Tab` + `Enter`) would reduce `P` time for experienced users by ~1.1 s per category switch.

---

## Task 2 — Switch the Active World

**Goal**: Admin switches from the Survival world to a new Creative world.

```
GOAL: switch-world
  GOAL: navigate-to-admin-worlds-tab
    M ..................................... 1.35
    P (Admin nav item) .................... 1.10
    BB ..................................... 0.20
    W (page load) ......................... 0.15
    M (locate Worlds tab) ................. 1.35
    P (Worlds tab button) ................. 1.10
    BB ..................................... 0.20
  GOAL: find-target-world
    M (scan world cards) .................. 1.35
    P (Switch button on Creative card) .... 1.10
    BB ..................................... 0.20
  GOAL: confirm-switch
    M (read warning dialog) ............... 2.70  [2× M for important decision]
    P (Yes, Switch World button) .......... 1.10
    BB ..................................... 0.20
    W (SSH + rsync: ~90 seconds) .......... 90.00
    M (observe spinner / wait) ............ 1.35
                                         --------
  TOTAL (interaction only, excl. server).. 11.20 s
  TOTAL (including server wait) ......... 101.20 s
```

**Assessment**: The interaction portion is efficient. The server wait (90–180 s) dominates the total time. The spinner is present but provides no sub-step progress. This creates a high **perceived wait time** amplified by uncertainty — users don't know if the operation is progressing normally or has stalled.

**Opportunity**: A step log ("1/5 — Flushing saves...", "2/5 — Saving current world...") would reduce perceived wait time by ~40% (Maister's Law: uncertainty makes waits feel longer).

---

## Task 3 — Approve a Pending Player and Link to a Team Member

**Goal**: Admin approves a new player and links them to their site account.

```
GOAL: approve-pending-player
  GOAL: navigate-to-admin-pending
    M ..................................... 1.35
    P (Admin nav) ......................... 1.10
    BB ..................................... 0.20
    P (Pending Players tab) ............... 1.10
    BB ..................................... 0.20
  GOAL: initiate-approval
    M (read player card, recognise IGN) ... 1.35
    P (Approve button) .................... 1.10
    BB ..................................... 0.20
  GOAL: select-team-member
    M (read modal) ........................ 1.35
    P (dropdown) .......................... 1.10
    BB ..................................... 0.20
    [scrolling through dropdown if many members]
    M (scan options) ...................... 1.35
    P (target member) ..................... 1.10
    BB ..................................... 0.20
  GOAL: confirm
    P (Approve & Link button) ............. 1.10
    BB ..................................... 0.20
    W (API call) .......................... 0.40
                                         --------
  TOTAL ................................... 12.50 s
```

**Assessment**: Acceptable for a security-critical action. The two-click modal design (Approve → pick member → Approve & Link) adds ~2.7 s over a single-click but prevents accidental linkage — a worthwhile tradeoff.

**Opportunity**: If a player's name closely matches a team member's linked IGN, pre-selecting the likely match would save 1.35 s (one M + 1.1 s P + 0.2 BB = 2.65 s vs typing + scanning).

---

## Task 4 — Create a World Backup

**Goal**: Admin creates an on-demand backup of the active Survival world.

```
GOAL: create-world-backup
  GOAL: navigate-to-admin-worlds
    [same as Task 2 nav: 4.25 s]
  GOAL: expand-world-card
    M (locate card) ....................... 1.35
    P (chevron expand button) ............. 1.10
    BB ..................................... 0.20
  GOAL: trigger-backup
    M (locate Backup Now button) .......... 1.35
    P ...................................... 1.10
    BB ..................................... 0.20
    W (backup script: ~90 seconds) ........ 90.00
    M (read result row in backup list) .... 1.35
                                         --------
  TOTAL (interaction only) ............... 10.90 s
  TOTAL (incl. server) .................. 100.90 s
```

**Opportunity**: If the Worlds tab auto-expands the active world on first render (currently collapsed by default), the expand step is eliminated, saving 2.65 s.

---

## Task 5 — Change a Server Gamerule

**Goal**: Admin disables mob griefing.

```
GOAL: toggle-gamerule
  M ....................................... 1.35
  P (Server nav) .......................... 1.10
  BB ...................................... 0.20
  W ....................................... 0.10
  M (scroll to World Settings > Gamerules) 1.35
  P (Mob Griefing toggle) ................. 1.10
  BB ...................................... 0.20
  W (API call + RCON ~200ms) .............. 0.20
  M (read status msg "✓ mobGriefing → false") 1.35
                                         --------
  TOTAL ................................... 6.95 s
```

**Assessment**: Excellent — under 7 seconds for a direct toggle. The always-visible gamerule list eliminates discovery overhead.

**Gap**: The `statusMsg` appears in the page header, requiring the user to look away from the World Settings area where the toggle is. Inline feedback (a brief ✓ flash next to the toggle itself) would reduce the final `M` to 0 since no gaze shift is needed.

---

## Task 6 — Invite a New User

**Goal**: Admin invites a new team member by email.

```
GOAL: invite-user
  M ....................................... 1.35
  P (Admin nav) ........................... 1.10
  BB ...................................... 0.20
  [Users tab is default — no tab click needed]
  M (locate Whitelist User button) ........ 1.35
  P ...................................... 1.10
  BB ...................................... 0.20
  M (modal appears) ....................... 1.35
  H (hands to keyboard) ................... 0.40
  K×20 (type email address) ............... 2.40
  H (to mouse, select role) ............... 0.40
  P (role dropdown) ....................... 1.10
  BB ...................................... 0.20
  M (verify role selection) ............... 1.35
  P (Add to Whitelist) .................... 1.10
  BB ...................................... 0.20
  W (API + email availability check) ...... 0.30
                                         --------
  TOTAL ................................... 13.10 s
```

**Assessment**: Good. Adding autocompletion for previously-invited email domains (e.g. `@gmail.com`) would save ~0.72 s (6 fewer keystrokes).

---

## Task 7 — Download a World Backup

**Goal**: Admin downloads the most recent Survival backup as a `.tar.gz` file.

```
GOAL: download-backup
  [navigate to Admin → Worlds: 4.25 s]
  M (expand Survival card) ............... 1.35
  P (expand chevron) ...................... 1.10
  BB ...................................... 0.20
  M (locate most recent backup row) ....... 1.35
  P (Download ↓ button) ................... 1.10
  BB ...................................... 0.20
  W (file starts streaming) ............... 0.50
                                         --------
  TOTAL ................................... 10.05 s
```

---

## Task 8 — Toggle Coordinate HUD for a Player

**Goal**: Admin enables the coordinate display for a team member.

```
GOAL: toggle-coord-hud
  M ....................................... 1.35
  P (Team nav) ............................ 1.10
  BB ...................................... 0.20
  M (scan player list, locate member card). 1.35
  P (XYZ toggle badge) .................... 1.10
  BB ...................................... 0.20
  W (API + RCON or NBT write) ............. 0.30
  M (observe badge colour change) ......... 1.35
                                         --------
  TOTAL ................................... 6.95 s
```

---

## Summary

| Task | Interaction time | Dominant cost |
|------|-----------------|---------------|
| Give item | 12.0 s | Search + click-to-select item |
| Switch world | 11.2 s + 90–180 s server | SSH rsync wait |
| Approve player | 12.5 s | Modal + dropdown scan |
| Create backup | 10.9 s + ~90 s server | Server-side compression |
| Toggle gamerule | 7.0 s | Page nav + toggle |
| Invite user | 13.1 s | Email typing |
| Download backup | 10.1 s | Expand + locate row |
| Toggle coord HUD | 7.0 s | Page nav + badge click |

### GOMS selection rules

**Expert users** (>50 sessions): use keyboard shortcuts for navigation when available (currently none — see H7 fail).

**Novice users** (<5 sessions): rely on visible labels; the permission-gated UI reduces cognitive load significantly since they never see controls they can't use.

**Mobile users**: P times reduced to 0.80 s; K times increased to 0.20 s. Interaction times for touch are 5–10% lower than desktop for pointer-heavy tasks, but 15–20% higher for text input tasks.

# 05 — Psychology of Human-Computer Interaction

This document covers the psychological underpinnings of the redstoneCipher interface: mental models, affordances, cognitive load, trust, motivation, and flow state.

---

## 1. Mental Models

A mental model is the user's internal representation of how the system works. The goal is to align the system image with the user's mental model.

### Alignment — What works
- **Minecraft vocabulary** throughout the interface matches the mental model of every Minecraft server admin: whitelist, ops, gamerules, RCON, NBT, IGN. Users arrive with existing mental models that the UI reinforces.
- **World-as-folder metaphor**: The slug is visibly tied to a directory path — users familiar with Linux server management have an accurate model.
- **Backup-as-archive**: `.tar.gz` filenames and "7 daily / 4 weekly" retention matches how server admins think about backups.
- **Toggle-as-switch**: The pill toggle affordance has a near-universal mental model: left=off (grey), right=on (blue).

### Mismatches — What doesn't
- **World switch ≠ instant**: Users may expect "Switch" to be instantaneous (like switching a tab or a file). The underlying rsync + service restart is a very different mental model. The confirmation dialog helps, but the step details in DEPLOYMENT.md are invisible to the user.
- **Config "Save" restarts the server**: Minecraft's `server.properties` is only read on startup, so saving triggers a restart. This is a well-known fact to experienced admins, but the warning text ("Save applies changes and restarts the game process") may not be prominent enough for newer team members.
- **Pending players ≠ whitelist**: The distinction between the Tailscale admission queue (pending players) and the MC whitelist is conceptually complex. New admins may be confused about why there are two separate player-approval mechanisms.

### Improving Mental Model Alignment
1. Add a "How it works" explainer to the Worlds tab: a 3-step visual showing current-world → saved → target-world loaded.
2. Add a visual link between the Pending Players tab and the Whitelist tab showing the relationship.
3. Consider a "World folder: `/opt/minecraft/worlds/survival/`" line under each world card to make the directory metaphor explicit.

---

## 2. Affordances and Signifiers

Affordances are the perceived and actual properties that determine how a thing could possibly be used. Signifiers indicate where the action should happen.

### Good affordances
- **Toggle switches** with `role="switch"`: The visual affordance (pill + thumb) matches the semantic role. Thumb position (left/right) is the signifier of state.
- **Chevron expand/collapse** in world cards: The up/down chevron is a universal expand signifier.
- **Locked fields** (🔒): The padlock is a well-established "not changeable" signifier with `disabled` prop making it uninteractive.
- **Scrim (backdrop)**: The dark overlay on modals signals that the background is non-interactive (perceived affordance of the modal as a focused context).
- **Drag handle on mobile "More" drawer**: The grey bar at the top of the slide-up sheet is a standard mobile drag-handle signifier.

### Weak affordances
- **Item grid tiles**: The item tiles in the give drawer have no affordance other than a border-change on hover. A subtle pressed/depressed state on click would reinforce the selection affordance.
- **Category tabs**: Pills with text look like filters (correct) but don't signal that they are mutually exclusive (only one active at a time). A more distinct active state with a bottom border or background fill would be clearer.
- **Config sliders**: Browser-default range sliders have variable affordance across platforms. On some mobile browsers, they look like static bars rather than interactive controls.

---

## 3. Cognitive Load

Cognitive load theory (Sweller, 1988) distinguishes intrinsic load (complexity of the subject matter), extraneous load (poor design), and germane load (useful pattern formation).

### Intrinsic load reduction
The admin UI handles Minecraft server management — inherently complex. The design reduces intrinsic load effectively:
- Permission gating removes irrelevant controls entirely
- SCHEMA categorization in Configure reduces the 50+ raw settings to 6 mental chunks
- The KLM-GOMS times (7–13 s for most tasks) demonstrate low extraneous load

### Extraneous load sources
- **Emoji density**: Heavy emoji use on the Server page (🎒🔥💥👾🏆⏰🌤️🛡️🎮) creates visual noise. Each emoji requires a small additional parse step: users must decode the icon in context. Plain text labels with optional emoji prefixes (rather than emoji-as-primary-label) would reduce this load.
- **Global status message** in the Server page header: The `statusMsg` string can contain any success or error text, and it's placed in the top-right of the header — far from where the user's attention is (near the toggle they just clicked). This increases extraneous load because users must move their gaze to understand the result.
- **Inline `confirm()` dialog**: The browser-native confirmation dialog has a different visual language than the rest of the app, creating a context switch that increases extraneous cognitive load.

### Germane load (positive pattern formation)
- The consistent card + action-button pattern across every feature allows users to build reusable interaction schemas ("find the card, find the button, click, see result").
- The color system (blue = action, green = success, red = danger, yellow = warning) is used consistently enough that users can infer meaning without reading text.

---

## 4. Trust and Credibility

Fogg's (2003) technology trust framework identifies four types of credibility.

### Presumed credibility
- The app has a professional, polished design consistent with high-quality developer tools (Linear, Vercel, Netlify). This creates an initial trust impression.
- Google OAuth login is a trusted known pattern for team tools.
- The Tailscale-only Minecraft access and invite-only system signals "security-forward" which builds trust with technical users.

### Surface credibility
- The landing page backdrop (Minecraft blocks) is fun but could read as "amateur project" to new team members if overdone. Currently balanced well.
- Dark mode support signals attention to developer preferences.

### Earned credibility
- Live server metrics on the Dashboard ("here's what's actually happening") build earned trust by being honest about system state, including when the server is offline or metrics are unavailable.
- The Config page's inline descriptions build trust through transparency about what each setting actually does.
- The `locked` field pattern builds trust — rather than hiding dangerous fields, it shows them but explains why they can't be changed.

### Trust-eroding patterns
- Raw API error messages (`"Bad request: Slug must be non-empty and..."`) break the professional voice and remind users they're interacting with a developer tool rather than a polished product.
- The browser-native `confirm()` dialog breaks visual consistency and signals incomplete polish.

---

## 5. Motivation and Self-Determination Theory

Self-Determination Theory (Deci & Ryan) identifies three intrinsic motivators: competence, autonomy, and relatedness.

### Competence
- Permission gating means users only see what they can do — no frustrating "you don't have permission" rejections mid-workflow.
- Clear success states (`"✓ Sent to {ign}!"`) reinforce feelings of competence.
- The Config page's rich descriptions empower users to make informed decisions rather than guessing.

### Autonomy
- Admins have full control over server settings, world management, user access, and item giving.
- The `Export` and `Import` functions on the Config page give users data portability — a meaningful expression of autonomy.
- Dark mode gives users control over their visual environment.

### Relatedness
- Player avatars (mc-heads.net) create a sense of connection to the people behind the IGNs.
- The Chat page directly supports social connection between web admins and in-game players.
- The Team page creates a social layer around the technical admin functions.

---

## 6. Flow State

Csikszentmihalyi's flow theory: users achieve flow when challenge matches skill, goals are clear, feedback is immediate, and distractions are eliminated.

### Conditions supporting flow
- For experienced admins: permission-gated UI eliminates irrelevant distractions
- Clear mental model from Minecraft domain knowledge
- Most interactions under 13 s (before server waits)
- Auto-focus on search inputs removes friction at critical moments

### Flow-breaking conditions
- Long server operations (world switch, backup) with no step progress break flow — users lose the sense of momentum and feel helpless
- No keyboard shortcuts force mouse re-engagement, breaking keyboard-flow for technical users
- Global status messages require gaze shifts that interrupt the local workflow
- The browser `confirm()` dialog creates a jarring visual context switch

---

## 7. The Gulf of Execution and Gulf of Evaluation

Norman's two gulfs describe the gap between user intentions and system response.

### Gulf of Execution (intention → action)
- Generally narrow: controls are visible, labeled, and permission-appropriate
- Exception: Users cannot discover keyboard shortcuts because none exist
- Exception: The world backup flow requires navigating Admin → Worlds → expand → Backup Now — four steps for a frequently-needed admin task

### Gulf of Evaluation (action → understanding result)
- Generally narrow: success/error states are shown for most operations
- Exception: Long-running operations (world switch, backup) show only a spinner — the user cannot evaluate whether the system is working correctly
- Exception: `statusMsg` is placed far from the interaction point — the gulf of evaluation is spatially wide

---

## 8. Emotional Design (Norman's Three Levels)

### Visceral (appearance)
- The warm off-white background (`#F7F5F2`) and Minecraft-themed login backdrop create a positive visceral response aligned with the game's aesthetic.
- Dark mode uses deep near-black (`#13151A`) — associated with power and focus in gaming contexts.
- The `Pickaxe` brand icon and consistent green/blue palette feel coherent with the Minecraft universe.

### Behavioral (use)
- The item give drawer's clear preview and quantity stepper make the giving interaction feel smooth and satisfying.
- The pending-player queue disappearing after approval gives a satisfying "cleared" feeling.
- The Config page's save counter (`Save 3 changes`) creates a sense of productive accumulation.

### Reflective (meaning)
- The invite-only design communicates "this is a private, trusted space for our team."
- The admin portal positions team members as stewards of the server, not just players — this is a meaningful identity shift.
- The world management system gives admins a sense of creative control — they can build and switch entire worlds with a few clicks.

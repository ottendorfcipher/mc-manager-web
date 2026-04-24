# Permission model

Permissions are first-class string keys. The UI, API middleware and database
layer all speak the same vocabulary:

- `server.*` — control the Compute Engine VM and Minecraft service
- `backups.*` — create / restore / delete / download world backups
- `config.*` — read / write `server.properties`
- `users.*` — invite, remove, change role, edit the role→permission map
- `players.*` — link IGNs and change per-player gamemodes
- `killswitch.*` — view / engage / release the budget kill-switch
- `nav.*` — whether a sidebar entry is visible for a role

The complete catalog is seeded by migration `0004_permissions.sql` and
exposed at `GET /api/permissions` (requires `users.permissions.edit`).

## Roles

| Role           | Level | Default intent                                             |
|----------------|:-----:|------------------------------------------------------------|
| `global_admin` |   4   | Everything, including the permission editor itself         |
| `admin`        |   3   | Everything except `users.permissions.edit` and `nav.admin` |
| `member`       |   2   | Day-to-day server control + basic backups                  |
| `user`         |   1   | Read-only with their own gamemode                          |
| `visitor`      |   0   | Dashboard only — default for unverified invitees           |

Assignments are stored in the `role_permissions` table; the defaults live in
`backend/migrations/0004_permissions.sql`. Global admins edit them at
`/admin/permissions` in the SPA.

## Enforcement

Every API handler calls `require_perm(&actor, "key")` (or delegates to the
five legacy `can_*` helpers on `AuthUser`, which now map onto the new
permission set). The UI hides controls for permissions the user doesn't
hold, but the server is the source of truth — a client that bypasses the UI
still gets a `403 Forbidden` with a human-readable reason.

## Navigation

`frontend/src/components/Layout.tsx` filters `NAV` entries through
`hasPerm(entry.perm)`. To add a new sidebar item:

1. Add a `nav.<name>` row to `permissions` (migration or via the admin UI).
2. Grant it to the roles that should see it (`role_permissions`).
3. Add the entry to `NAV` with `perm: "nav.<name>"`.

## Per-user overrides

Not implemented today; the schema reserves `user_permissions` for a future
"grant extra or deny specific" layer. Adding it requires only a follow-up
migration plus a small change in `db::permissions::effective_for`.

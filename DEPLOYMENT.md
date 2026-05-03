# redstoneCipher — Deployment Reference

Last updated: 2026-05-03

> **Migration note**: This project was migrated from Google Cloud (Firebase Hosting +
> Cloud Run + GCE) to Hetzner-hosted bare servers in May 2026. All GCP projects
> (`redstonecipher-web`, `minecraft-493201`, `g-bridges`) are decommissioned.

## Architecture

```
                        Internet
                            │
                   ┌────────▼────────┐
                   │  Web Server      │  178.105.43.199
                   │  Hetzner (38 GB) │  redstonecipher.com
                   │  nginx + Rust    │
                   └────────┬────────┘
                            │ Tailscale (WireGuard)
                   ┌────────▼────────┐
                   │  MC Server       │  5.161.212.29
                   │  Hetzner (75 GB) │  Tailscale: 100.123.253.30
                   │  PaperMC 1.21.11 │
                   └─────────────────┘
```

All Minecraft traffic is private — port 25565 is **not** open to the public internet.
The web server reaches the MC server over Tailscale SSH.

---

## Servers

### Web server — `178.105.43.199`

| Property | Value |
|---|---|
| Provider | Hetzner |
| Tailscale IP | `100.67.225.12` |
| Disk | 38 GB total / 4.1 GB used |
| Domain | `redstonecipher.com`, `www.redstonecipher.com` |
| SSL | Let's Encrypt — expires **2026-08-01** (auto-renews via certbot) |

**Services**

| Service | State | Uptime |
|---|---|---|
| `nginx` | active | 1 hr 13 min |
| `redstonecipher` | active | 1 hr |

**Key paths**

| Path | Purpose |
|---|---|
| `/opt/redstonecipher/redstonecipher-server` | Rust backend binary |
| `/opt/redstonecipher/.env` | Environment / secrets |
| `/opt/redstonecipher/www/` | Built React frontend (static files) |
| `/etc/nginx/sites-enabled/redstonecipher` | nginx vhost config |
| `/etc/letsencrypt/live/redstonecipher.com/` | TLS certificates |

**nginx routing**

| Path pattern | Target |
|---|---|
| `/api/*`, `/auth/*` | `http://127.0.0.1:8080` (Rust backend) |
| `/*` | `/opt/redstonecipher/www` (SPA, `try_files … /index.html`) |
| HTTP → HTTPS | 301 redirect (managed by Certbot) |

---

### MC server — `5.161.212.29`

| Property | Value |
|---|---|
| Provider | Hetzner |
| Tailscale IP | `100.123.253.30` |
| Disk | 75 GB total / 7.4 GB used |
| Java | OpenJDK 21.0.11 |
| Server software | PaperMC 1.21.11 |
| Game port | `25565` (Tailscale interface only) |
| RCON | `127.0.0.1:25575` (localhost only) |
| World size | 82 MB |

**Services**

| Service | State | Uptime |
|---|---|---|
| `minecraft` | active | 35 min |
| `mc-fifo-bridge` | active | 35 min |

**Key paths**

| Path | Purpose |
|---|---|
| `/opt/minecraft/server/` | Server root |
| `/opt/minecraft/server/server.properties` | Server configuration |
| `/opt/minecraft/server/whitelist.json` | Whitelist entries |
| `/opt/minecraft/server/ops.json` | Operator list |
| `/opt/minecraft/server/logs/latest.log` | Live server log |
| `/opt/minecraft/console.fifo` | FIFO for RCON command bridge |
| `/usr/local/bin/mcrcon` | RCON client |

**Backup**

| Property | Value |
|---|---|
| Schedule | Daily at **04:00 UTC** (systemd timer: `minecraft-backup.timer`) |
| Timer state | Persistent (catches up missed runs) |

---

## Firewall (mc-server UFW)

| Rule | Action |
|---|---|
| `22/tcp` (SSH) | ALLOW IN |
| `41641/udp` (Tailscale WireGuard) | ALLOW IN |
| All traffic on `tailscale0` | ALLOW IN / OUT |
| Everything else | DENY (default) |

Minecraft port 25565 is intentionally absent from the public ruleset.
Access to the server requires being on the Tailscale network.

---

## Whitelist

Whitelist enforcement is **enabled** (`white-list=true`, `enforce-whitelist=true`).
`enforce-whitelist=true` takes full effect after the next server restart —
players already online will be kicked if removed from the whitelist mid-session.

> **The whitelist is currently empty.** No players can connect until you add them.

Add a player (requires a valid Mojang/Microsoft account username):

```bash
ssh mc-server
RCON_PASS=$(grep '^rcon.password=' /opt/minecraft/server/server.properties | cut -d= -f2)
/usr/local/bin/mcrcon -H 127.0.0.1 -P 25575 -p "$RCON_PASS" 'whitelist add <username>'
```

Or via the web console at **https://redstonecipher.com** → Server → Whitelist.

---

## Auth & Permissions

**Authentication**: Google OAuth, invite-only.

| Role | Level | Description |
|---|---|---|
| `global_admin` | 4 | Permanent seed account — `nicholasaweiner@gmail.com` |
| `admin` | 3 | Full management, cannot elevate to global_admin |
| `member` | 2 | Standard access |
| `user` | 1 | Limited access |
| `visitor` | 0 | Read-only |

- System roles cannot be deleted or have their level changed.
- Custom roles can be created via the admin UI with a level strictly below the creator's.
- Per-user permission overrides are additive (grant extra permissions beyond the role).
- Permissions are re-checked from the DB on every request — changes take effect immediately without requiring re-login.
- Any Google account not in the users table (and not the `global_admin` email) is rejected at the OAuth callback with `?error=not_invited`.

**JWT**: HS256, 8-hour expiry, stored in `__session` cookie (HttpOnly, Secure, SameSite=Lax).

---

## Common Runbooks

### Restart the Minecraft server

```bash
ssh mc-server 'systemctl restart minecraft'
```

### Deploy a new backend build

```bash
# Build on the local machine, then:
cargo build --release -p redstonecipher-server
scp target/release/redstonecipher-server redstonecipher-web:/opt/redstonecipher/redstonecipher-server
ssh redstonecipher-web 'systemctl restart redstonecipher'
```

### Deploy a new frontend build

```bash
# From mc-manager-web/frontend:
npm run build
rsync -av dist/ redstonecipher-web:/opt/redstonecipher/www/
```

### Renew SSL certificate (manual)

Certbot auto-renews twice daily via its own systemd timer; manual renewal is only needed for troubleshooting.

```bash
ssh redstonecipher-web 'certbot renew --nginx'
```

### View live server logs

```bash
# Minecraft
ssh mc-server 'journalctl -u minecraft -f'

# Backend
ssh redstonecipher-web 'journalctl -u redstonecipher -f'
```

### Invite a new user

Sign in at **https://redstonecipher.com** with a `global_admin` or `admin` account and use the Users page to invite the new user.

### Add a player to the Minecraft whitelist

See [Whitelist](#whitelist) above.

---

## Service Dependencies

```
minecraft-backup.timer  →  minecraft-backup.service
mc-fifo-bridge.service  →  /opt/minecraft/console.fifo  →  minecraft.service
redstonecipher.service  →  network.target, tailscaled.service
nginx                   →  redstonecipher.service (proxy_pass 127.0.0.1:8080)
```

---

## Deployment History

### 2026-05-03 — Hetzner migration

- Migrated from Google Cloud (Firebase + Cloud Run + GCE) to Hetzner bare servers.
- All GCP projects decommissioned (`redstonecipher-web`, `minecraft-493201`, `g-bridges`).
- Rust/Axum backend deployed as a systemd service on `178.105.43.199`.
- PaperMC server running on `5.161.212.29`, accessible only via Tailscale.
- SSL via Let's Encrypt / certbot; nginx reverse proxy.
- Auth: invite-only Google OAuth with role-based permission model.
- Whitelist enforcement enabled (`white-list=true`, `enforce-whitelist=true`).
- Daily backup at 04:00 UTC via `minecraft-backup.timer`.


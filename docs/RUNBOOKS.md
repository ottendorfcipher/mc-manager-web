# Operational Runbooks

Emergency procedures for the redstoneCipher web stack. Hosts:
- **web** — `root@178.105.43.199` (nginx + the Rust backend, systemd unit
  `redstonecipher`, binary `/opt/redstonecipher/redstonecipher-server`, DB
  `/opt/redstonecipher/data/mc-manager.db`).
- **mc-server-1** — Tailscale `100.123.253.30` (PaperMC, systemd unit
  `minecraft`).

Health probes (unauthenticated, localhost): `curl -fsS localhost:8080/health`
and `/ready` (DB ping); `/metrics` for Prometheus gauges.

---

## 1. Roll back a bad backend deploy

`scripts/deploy-backend.sh` already health-gates and **auto-rolls back** to
`…-server.prev` if the new binary fails `/health`. To roll back manually after
the fact:

```bash
ssh root@178.105.43.199
ls -l /opt/redstonecipher/redstonecipher-server*        # .prev is the previous binary
systemctl stop redstonecipher
cp /opt/redstonecipher/redstonecipher-server.prev /opt/redstonecipher/redstonecipher-server
chown redstonecipher:redstonecipher /opt/redstonecipher/redstonecipher-server
systemctl start redstonecipher
curl -fsS localhost:8080/health && echo OK
```

If `.prev` is gone, redeploy a known-good commit:
`scripts/deploy-backend.sh <good-sha>` (downloads + checksum-verifies the CI
artifact for that commit).

---

## 2. Roll back a bad database migration

Migrations are **forward-only** (SQLx) and run automatically on startup, so a
bad migration that panics will keep the service from booting. Recovery:

```bash
ssh root@178.105.43.199
systemctl stop redstonecipher

# Restore the most recent good DB snapshot (see runbook 3 for the path).
cp /opt/redstonecipher/data/backups/mc-manager-<TIMESTAMP>.sqlite3 \
   /opt/redstonecipher/data/mc-manager.db
chown redstonecipher:redstonecipher /opt/redstonecipher/data/mc-manager.db

# Deploy the binary BUILT BEFORE the bad migration (runbook 1), so it doesn't
# immediately re-apply it. Then author a corrective forward migration rather
# than editing an already-applied one.
systemctl start redstonecipher
```

Prevention: test new migrations against a copy first —
`DATABASE_URL=sqlite:////tmp/staging.db cargo run` (it applies all migrations on
boot) before deploying.

---

## 3. Recover a corrupted SQLite database

```bash
ssh root@178.105.43.199
sqlite3 /opt/redstonecipher/data/mc-manager.db "PRAGMA integrity_check;"
```

If it does **not** print `ok`:

```bash
systemctl stop redstonecipher

# Newest local snapshot first (backup-db.sh writes these + an offsite copy on
# mc-server-1 at /opt/minecraft/backups/db-snapshots/). Verify before using:
latest=$(ls -t /opt/redstonecipher/data/backups/mc-manager-*.sqlite3 | head -1)
sqlite3 "$latest" "PRAGMA integrity_check;"      # must print ok

cp "$latest" /opt/redstonecipher/data/mc-manager.db
chown redstonecipher:redstonecipher /opt/redstonecipher/data/mc-manager.db
# Clear any stale WAL/SHM sidecars from the corrupted DB:
rm -f /opt/redstonecipher/data/mc-manager.db-wal /opt/redstonecipher/data/mc-manager.db-shm
systemctl start redstonecipher
curl -fsS localhost:8080/ready
```

Last resort salvage of the corrupted file:
`sqlite3 broken.db ".recover" | sqlite3 recovered.db`.

---

## 4. Backend is up but unhealthy (`/ready` returns 503)

`/ready` failing means the DB ping failed. Check:

```bash
journalctl -u redstonecipher -n 50 --no-pager
ls -l /opt/redstonecipher/data/mc-manager.db          # exists? permissions?
df -h /opt/redstonecipher/data                         # disk full?
curl -s localhost:8080/metrics | grep db_pool          # pool exhausted?
```

Disk-full is the usual cause — prune `data/backups/` and the journal
(`journalctl --vacuum-size=200M`), then restart.

---

## 5. World switch left the server down

`scripts/world-switch.sh` now auto-rolls back to the previous world if the
target fails to boot. If it's still down:

```bash
ssh -i /opt/redstonecipher/mc_ssh_key root@100.123.253.30
systemctl status minecraft
journalctl -u minecraft -n 80 --no-pager
ls /opt/minecraft/worlds/                               # stored world slots
# Manually restore a slot into the server dir:
rsync -a --delete /opt/minecraft/worlds/<slug>/world/ /opt/minecraft/server/world/
chown -R minecraft:minecraft /opt/minecraft/server
systemctl start minecraft
```

The DB active-world flag only flips on a successful switch, so it already points
at the last-good world — no DB change needed after a manual restore.

---

## 6. Useful one-liners

```bash
# Tail backend logs
journalctl -u redstonecipher -f
# Backend liveness / readiness / metrics
curl -fsS localhost:8080/health; curl -fsS localhost:8080/ready
curl -s  localhost:8080/metrics
# TLS expiry safety net (runbook script)
/opt/redstonecipher/scripts/check-tls-expiry.sh
# Manual DB backup (verifies integrity, prunes, offsite-copies)
/opt/redstonecipher/scripts/backup-db.sh
```

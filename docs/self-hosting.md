# Self-hosting redstoneCipher

This guide takes you from nothing to a running server. The fastest path is Docker
Compose, which runs the whole stack (web frontend, Rust backend, and a PaperMC
server) in one command.

## Fastest start

Run the guided setup and follow the prompts:

```bash
./start-here.sh
```

It checks prerequisites, collects your settings (with an auto-generated session
key), walks you through Google sign-in, writes `.env`, and brings the stack up
with a live progress bar. Pick the console path to set everything in the
terminal, or the web path to boot straight into a browser setup wizard. Re-run it
any time to change values.

The sections below do the same steps by hand.

## What you need

Docker with the Compose plugin, and a Google account to create an OAuth client.
That is the only required identity provider. Cloudflare login is optional and
covered near the end.

## 1. Configure

Copy the example environment file and open it.

```bash
cp .env.example .env
```

Set these values. The rest have working defaults.

```
JWT_SECRET=              # openssl rand -hex 32
GOOGLE_CLIENT_ID=        # from step 2
GOOGLE_CLIENT_SECRET=    # from step 2
BOOTSTRAP_ADMIN_EMAIL=   # your Google address; becomes the first admin
SITE_URL=http://localhost:8080
REDIRECT_URI=http://localhost:8080/auth/callback
COOKIE_SECURE=false      # local plain HTTP only; set true once you have HTTPS
```

`COOKIE_SECURE=false` is only for a local HTTP trial. A browser drops the secure
session cookie over plain HTTP, so login would fail without it. Set it back to
`true` the moment you serve the site over HTTPS.

## 2. Create the Google OAuth client

1. Open the Google Cloud Console, then APIs and Services, then Credentials.
2. Create an OAuth 2.0 Client ID of type Web application.
3. Under Authorized redirect URIs, add the value of your `REDIRECT_URI`. For a
   local run that is `http://localhost:8080/auth/callback`. Add your production
   URL too when you have one.
4. Copy the Client ID and Client Secret into `.env`.

Google will reject any redirect URI that is not listed here, so the value must
match `REDIRECT_URI` exactly.

## 3. Start it

```bash
docker compose up --build
```

The first build compiles the backend and downloads PaperMC, so it takes a few
minutes. When it settles, open http://localhost:8080 and sign in with the admin
account. The backend generates its SSH key and connects to the Minecraft
container automatically.

Join the game at `localhost:25565`.

## 4. Invite the rest of your group

Sign in as the admin, open the Admin area, and invite users by their Google
email. Only invited accounts can sign in. New in-game players appear in the
pending queue for approval.

## 5. Optional: Sign in with Cloudflare

If you use Cloudflare Zero Trust, you can add a second login button.

1. In Cloudflare Zero Trust, open Access, then Applications, and add a SaaS
   application of type OIDC.
2. Set the redirect URL to `https://your-domain.com/auth/callback/cloudflare`.
3. Select the scopes openid, email, and profile.
4. Copy the Client ID, Client Secret, and your team name into `.env`:

```
CLOUDFLARE_TEAM_DOMAIN=myteam        # or myteam.cloudflareaccess.com
CLOUDFLARE_CLIENT_ID=
CLOUDFLARE_CLIENT_SECRET=
```

Restart the stack. The Cloudflare button appears only when all three values are
set. Access still follows the invite list, so a Cloudflare identity must match an
invited email.

## 6. Going to production

Serve the site over HTTPS on a real domain. The simplest options are a reverse
proxy such as Caddy or nginx with a certificate, or a Cloudflare Tunnel in front
of the `web` container.

Then update `.env`:

```
SITE_URL=https://your-domain.com
REDIRECT_URI=https://your-domain.com/auth/callback
COOKIE_SECURE=true
CORS_ORIGINS=https://your-domain.com
```

Add the production redirect URI to your Google OAuth client, and to the
Cloudflare application if you use it.

## 7. Backups and updates

The database lives in the `db` Docker volume and the world in the `mcdata`
volume. Back them up with `docker run --rm -v` snapshots or your host's backup
tool. To update, pull the latest code and run `docker compose up --build` again.
Migrations apply automatically on backend start.

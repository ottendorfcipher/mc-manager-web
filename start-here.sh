#!/usr/bin/env bash
# start-here.sh — guided setup for redstoneCipher.
#
# Sets your environment variables and brings the stack up with Docker. Meaning is
# carried by color and layout; text is kept short on purpose.
#   green = done      yellow = your turn      red = missing      cyan = working
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/.env"

# ── Palette ───────────────────────────────────────────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\e[1m'; DIM=$'\e[2m'; R=$'\e[0m'
  RED=$'\e[38;5;203m'; GRN=$'\e[38;5;114m'; YEL=$'\e[38;5;221m'
  CYN=$'\e[38;5;81m'; BLU=$'\e[38;5;75m'; MAG=$'\e[38;5;176m'; GRY=$'\e[38;5;245m'
else B=; DIM=; R=; RED=; GRN=; YEL=; CYN=; BLU=; MAG=; GRY=; fi
OK="${GRN}✓${R}"; NO="${RED}✗${R}"; DO="${YEL}➤${R}"; INFO="${CYN}›${R}"

# ── UI kit ────────────────────────────────────────────────────────────────────
rule(){ printf "${GRY}%s${R}\n" "──────────────────────────────────────────────────────────────"; }
title(){ printf "\n${B}${CYN}%s${R}\n" "$1"; rule; }
step(){ printf "\n${B}${BLU}%s${R}  ${B}%s${R}\n" "$1" "$2"; }
say(){ printf "  %b %s\n" "$1" "$2"; }
hint(){ printf "    ${GRY}%s${R}\n" "$1"; }
show(){ printf "    ${MAG}%s${R} ${DIM}=${R} %s\n" "$1" "$2"; }
paste_me(){ printf "    ${B}${YEL}%s${R}\n" "$1"; }

ask(){ local __v="$1" label="$2" def="${3:-}" in
  if [ -n "$def" ]; then printf "  ${DO} %s ${DIM}[%s]${R}: " "$label" "$def"
  else printf "  ${DO} %s: " "$label"; fi
  read -r in || true; printf -v "$__v" '%s' "${in:-$def}"; }
ask_secret(){ local __v="$1" label="$2" in; printf "  ${DO} %s ${DIM}(hidden)${R}: " "$label"
  read -rs in || true; echo; printf -v "$__v" '%s' "$in"; }
confirm(){ local a; printf "  ${DO} %s ${DIM}[y/N]${R}: " "$1"; read -r a || true; [[ "${a:-}" =~ ^[Yy] ]]; }
valid_email(){ [[ "$1" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; }
gen_secret(){ openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# Indeterminate spinner around a background pid.
spin(){ local pid="$1" msg="$2" frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' i=0
  while kill -0 "$pid" 2>/dev/null; do i=$(((i+1)%10))
    printf "\r  ${CYN}%s${R} %s" "${frames:$i:1}" "$msg"; sleep 0.1; done
  printf "\r\033[K"; }

# Determinate bar: bar CURRENT TOTAL "message"
bar(){ local cur="$1" tot="$2" msg="${3:-}" w=30 fill i
  fill=$(( cur*w/tot )); printf "\r  ${CYN}["
  for ((i=0;i<w;i++)); do if ((i<fill)); then printf "█"; else printf "${GRY}·${CYN}"; fi; done
  printf "]${R} ${DIM}%3d%%${R} %s" "$((cur*100/tot))" "$msg"; }

read_env(){ [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- ; }

# ── Compose shim (plugin or standalone) ───────────────────────────────────────
dc(){ if docker compose version >/dev/null 2>&1; then docker compose "$@"
      else docker-compose "$@"; fi; }

# ── Banner ────────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
printf "\n${B}${CYN}  redstoneCipher${R} ${DIM}· guided setup${R}\n"
printf "  ${GRY}%s = done   %s = your turn   %s = missing${R}\n" "$OK" "$DO" "$NO"

# ── Prerequisites ─────────────────────────────────────────────────────────────
title "Prerequisites"
have(){ command -v "$1" >/dev/null 2>&1; }
miss=0
if have docker; then say "$OK" "Docker"; else say "$NO" "Docker ${GRY}(install: https://docs.docker.com/get-docker)${R}"; miss=1; fi
if docker compose version >/dev/null 2>&1 || have docker-compose; then say "$OK" "Docker Compose"
  else say "$NO" "Docker Compose"; miss=1; fi
if have openssl; then say "$OK" "openssl"; else say "$YEL!${R}" "openssl ${GRY}(optional; used to generate secrets)${R}"; fi
if docker info >/dev/null 2>&1; then say "$OK" "Docker engine running"
  else say "$NO" "Docker engine not running ${GRY}(start Docker Desktop / colima start)${R}"; miss=1; fi
if [ "$miss" = 1 ]; then printf "\n  ${RED}Resolve the items above, then re-run.${R}\n\n"; exit 1; fi

# ── Existing config ───────────────────────────────────────────────────────────
if [ -f "$ENV_FILE" ]; then
  title "Existing .env found"
  say "$INFO" "$ENV_FILE"
  printf "\n  ${DIM}1${R} Start now   ${DIM}2${R} Edit values   ${DIM}3${R} Start fresh\n"
  ask CHOICE "Choose" "1"
  case "$CHOICE" in
    1) LAUNCH_ONLY=1 ;;
    3) ts=$(date +%Y%m%d%H%M%S); cp "$ENV_FILE" "$ENV_FILE.bak.$ts"; say "$OK" "Backed up to .env.bak.$ts"; rm -f "$ENV_FILE"; LAUNCH_ONLY=0 ;;
    *) LAUNCH_ONLY=0 ;;
  esac
else LAUNCH_ONLY=0; fi

# ── Mode ──────────────────────────────────────────────────────────────────────
if [ "${LAUNCH_ONLY:-0}" != 1 ]; then
  title "How do you want to set up?"
  printf "  ${DIM}1${R} ${B}Console${R} ${GRY}right here in the terminal${R}\n"
  printf "  ${DIM}2${R} ${B}Web${R} ${GRY}a setup page in your browser, served by the app${R}\n"
  ask MODE "Choose" "1"
else MODE=console; fi

# Load current values as defaults (edit mode / re-run).
SITE_URL="$(read_env SITE_URL)"; REDIRECT_URI="$(read_env REDIRECT_URI)"
GOOGLE_CLIENT_ID="$(read_env GOOGLE_CLIENT_ID)"; GOOGLE_CLIENT_SECRET="$(read_env GOOGLE_CLIENT_SECRET)"
BOOTSTRAP_ADMIN_EMAIL="$(read_env BOOTSTRAP_ADMIN_EMAIL)"; JWT_SECRET="$(read_env JWT_SECRET)"
COOKIE_SECURE="$(read_env COOKIE_SECURE)"; CORS_ORIGINS="$(read_env CORS_ORIGINS)"
CF_TEAM="$(read_env CLOUDFLARE_TEAM_DOMAIN)"; CF_ID="$(read_env CLOUDFLARE_CLIENT_ID)"; CF_SECRET="$(read_env CLOUDFLARE_CLIENT_SECRET)"
GUEST_LOGIN="$(read_env GUEST_LOGIN)"
WEB_PORT="8080"

write_env(){
  [ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  umask 077
  {
    echo "# Generated by start-here.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "DATABASE_URL=sqlite://data/mc-manager.db"
    echo "JWT_SECRET=$JWT_SECRET"
    echo "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
    echo "GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET"
    echo "BOOTSTRAP_ADMIN_EMAIL=$BOOTSTRAP_ADMIN_EMAIL"
    echo "SITE_URL=$SITE_URL"
    echo "REDIRECT_URI=$REDIRECT_URI"
    echo "COOKIE_SECURE=$COOKIE_SECURE"
    [ -n "$CORS_ORIGINS" ] && echo "CORS_ORIGINS=$CORS_ORIGINS"
    [ -n "$CF_TEAM" ]   && echo "CLOUDFLARE_TEAM_DOMAIN=$CF_TEAM"
    [ -n "$CF_ID" ]     && echo "CLOUDFLARE_CLIENT_ID=$CF_ID"
    [ -n "$CF_SECRET" ] && echo "CLOUDFLARE_CLIENT_SECRET=$CF_SECRET"
    [ -n "$GUEST_LOGIN" ] && echo "GUEST_LOGIN=$GUEST_LOGIN"
    [ -n "${SETUP_MODE:-}" ] && echo "SETUP_MODE=$SETUP_MODE"
  } > "$ENV_FILE"
  say "$OK" "Wrote $ENV_FILE ${GRY}(secrets hidden, file is chmod 600)${R}"
}

if [ "${LAUNCH_ONLY:-0}" != 1 ] && [ "$MODE" = 2 ]; then
  # ── Web setup: boot the app straight into its /setup wizard ──────────────────
  title "Web setup"
  [ -n "$JWT_SECRET" ] || JWT_SECRET="$(gen_secret)"
  SITE_URL="http://localhost:$WEB_PORT"; REDIRECT_URI="$SITE_URL/auth/callback"
  COOKIE_SECURE="false"; SETUP_MODE="true"
  GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-setup}"; GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-setup}"
  BOOTSTRAP_ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@example.com}"
  write_env
  say "$INFO" "The app will open a setup page in your browser before the login screen."
else
  # ── Console setup ────────────────────────────────────────────────────────────
  if [ "${LAUNCH_ONLY:-0}" != 1 ]; then
    step "Step 1/5" "Deployment"
    hint "Where will people reach this? Use localhost to try it on this machine."
    ask DEPLOY "localhost or your domain (e.g. mc.example.com)" "${SITE_URL:+$(echo "$SITE_URL" | sed -E 's#https?://##')}"
    DEPLOY="${DEPLOY:-localhost}"
    if [ "$DEPLOY" = "localhost" ] || [[ "$DEPLOY" == localhost:* ]]; then
      SITE_URL="http://localhost:$WEB_PORT"; COOKIE_SECURE="false"; CORS_ORIGINS=""
    else
      SITE_URL="https://$DEPLOY"; COOKIE_SECURE="true"; CORS_ORIGINS="$SITE_URL"
    fi
    REDIRECT_URI="$SITE_URL/auth/callback"
    show "SITE_URL" "$SITE_URL"; show "REDIRECT_URI" "$REDIRECT_URI"

    step "Step 2/5" "Google sign-in ${DIM}(required)${R}"
    hint "1. Open  https://console.cloud.google.com/apis/credentials"
    hint "2. Create Credentials → OAuth client ID → Web application"
    hint "3. Under Authorized redirect URIs, add exactly this:"
    paste_me "$REDIRECT_URI"
    until confirm "Added that redirect URI in Google?"; do hint "Add it, then confirm. Google rejects any URI not listed."; done
    until [ -n "$GOOGLE_CLIENT_ID" ]; do ask GOOGLE_CLIENT_ID "Client ID" "$GOOGLE_CLIENT_ID"; done
    until [ -n "$GOOGLE_CLIENT_SECRET" ]; do ask_secret GOOGLE_CLIENT_SECRET "Client secret"; done
    say "$OK" "Google configured"

    step "Step 3/5" "First admin + secrets"
    until valid_email "${BOOTSTRAP_ADMIN_EMAIL:-}"; do ask BOOTSTRAP_ADMIN_EMAIL "Your Google email (becomes admin)" "$BOOTSTRAP_ADMIN_EMAIL"; done
    [ -n "$JWT_SECRET" ] || { JWT_SECRET="$(gen_secret)"; }
    say "$OK" "Session key ready ${GRY}(auto-generated)${R}"

    step "Step 4/5" "Optional"
    if confirm "Add Cloudflare Access sign-in too?"; then
      ask CF_TEAM "Cloudflare team (myteam or myteam.cloudflareaccess.com)" "$CF_TEAM"
      ask CF_ID "Cloudflare client ID" "$CF_ID"; ask_secret CF_SECRET "Cloudflare client secret"
    fi
    GUEST_LOGIN=""
    write_env
  fi
fi

# ── Launch ────────────────────────────────────────────────────────────────────
title "Launch"
say "$INFO" "Building images and starting the stack. First run pulls PaperMC and compiles the backend, so it takes a few minutes."
( dc up -d --build ) >/tmp/rc-up.log 2>&1 &
UP_PID=$!
spin "$UP_PID" "building + starting containers ${GRY}(tail: /tmp/rc-up.log)${R}"
wait "$UP_PID"; UP_RC=$?
if [ "$UP_RC" != 0 ]; then say "$NO" "Startup failed. Last lines:"; tail -n 20 /tmp/rc-up.log | sed 's/^/    /'; exit 1; fi
say "$OK" "Containers up"

# Health poll with a real progress bar.
URL="http://localhost:$WEB_PORT/auth/providers"
TRIES=40
for ((i=1;i<=TRIES;i++)); do
  if curl -fsS "$URL" >/dev/null 2>&1; then bar "$TRIES" "$TRIES" "ready"; echo; READY=1; break; fi
  bar "$i" "$TRIES" "waiting for the app"; sleep 3
done
echo
if [ "${READY:-0}" != 1 ]; then say "$YEL!${R}" "App did not answer yet. Check: dc logs -f backend"; fi

# ── Done ──────────────────────────────────────────────────────────────────────
title "Ready"
OPEN_URL="http://localhost:$WEB_PORT"
[ "$MODE" = 2 ] && say "$DO" "Finish setup in the browser:" || say "$OK" "Open the portal:"
paste_me "$OPEN_URL"
hint "Minecraft: connect to  localhost:25565"
hint "Manage:  edit .env or re-run ./start-here.sh   ·   stop: docker compose down"
if command -v open >/dev/null 2>&1; then open "$OPEN_URL" 2>/dev/null || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$OPEN_URL" 2>/dev/null || true; fi
echo

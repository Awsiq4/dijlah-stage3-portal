#!/usr/bin/env bash
# Safe local setup for the Telegram notification bot.
# Writes a local .env (gitignored) and NEVER prints secret values.
# Run from the repo root on YOUR machine:  bash scripts/setup-telegram-env.sh
set -euo pipefail

ENV_FILE=".env"
if [ -f "$ENV_FILE" ]; then
  echo "$ENV_FILE already exists — refusing to overwrite. Edit it manually."
  exit 1
fi

echo "== Telegram bot env setup (local .env only, gitignored) =="
echo "1) Create the bot in Telegram: @BotFather -> /newbot -> copy the token."
read -s -p "   Bot token (hidden): " BOT_TOKEN; echo
read -p "   Bot username (no @): " BOT_USERNAME
read -s -p "   Postgres DATABASE_URL (Neon; hidden): " DATABASE_URL; echo
read -p "   Portal base URL [https://dijlah-stage3-portal.vercel.app]: " PORTAL_BASE_URL
PORTAL_BASE_URL="${PORTAL_BASE_URL:-https://dijlah-stage3-portal.vercel.app}"

rand() { openssl rand -hex 32; }

cat > "$ENV_FILE" <<EOF
# Generated locally by scripts/setup-telegram-env.sh — NEVER commit or share.
TELEGRAM_BOT_ENABLED=false
TELEGRAM_BOT_TOKEN=$BOT_TOKEN
TELEGRAM_BOT_USERNAME=$BOT_USERNAME
TELEGRAM_WEBHOOK_SECRET=$(rand)
SUBSCRIPTION_SECRET=$(rand)
ADMIN_API_SECRET=$(rand)
WORKER_SECRET=$(rand)
DATABASE_URL=$DATABASE_URL
PORTAL_BASE_URL=$PORTAL_BASE_URL
# QSTASH_TOKEN=
# QSTASH_URL=https://qstash.upstash.io
EOF
chmod 600 "$ENV_FILE"

echo
echo "== .env written (chmod 600, gitignored). Secrets were NOT printed. =="
echo "Next steps:"
echo "  1) Apply DB schema:  psql \"\$DATABASE_URL\" -f database/telegram-notifications.sql"
echo "  2) Add the same vars in Vercel: Project -> Settings -> Environment Variables"
echo "     (or: vercel env pull .env.production  /  vercel env add TELEGRAM_BOT_TOKEN ...)"
echo "  3) Deploy, then set the webhook:"
echo "     curl \"https://api.telegram.org/bot<TOKEN>/setWebhook\" -d url=\"$PORTAL_BASE_URL/api/telegram/webhook\" -d secret_token=\"\$TELEGRAM_WEBHOOK_SECRET\""
echo "  4) Set TELEGRAM_BOT_ENABLED=true in Vercel, redeploy, check /api/telegram/health"
echo "  5) Test from the site card, then the checklist in docs/TELEGRAM_BOT_SETUP.md"
echo
echo "SECURITY: never paste token/secrets into chat or GitHub. .env is gitignored."

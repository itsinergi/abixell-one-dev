#!/usr/bin/env bash
#
# Reference source for the staging VPS alert notification helper.
#
# Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from /protected/staging.conf.
# If either is unset, degrades gracefully to stderr log-only (no crash).
# If both are set, sends a Telegram message via sendMessage API.
#
# Wave 9.3: staging.conf holds operational config only (no secrets covered by
# SOPS). Telegram credentials live here, not in the encrypted secrets file,
# because they are operator-supplied and must survive every CD deploy without
# requiring re-encryption (see abixell-staging-deploy-wrapper header).
#
# This is NOT deployed automatically. An operator installs it once during
# VPS bootstrap (WP-ENV-02 Wave 7, CP-ENV-07):
#
#   sudo install -o root -g root -m 0755 \
#     infra/deployment/vps/abixell-alert-notify.sh \
#     /usr/local/sbin/abixell-alert-notify
#
# Usage (called by alert probes):
#   abixell-alert-notify "<message>"
#
# Arguments:
#   $1   Message text (alert summary). Newlines and special characters OK.
#
# Returns:
#   0 on success or graceful degradation (no creds → log only);
#   1 on Telegram API error.
#
# Operator setup (Wave 7; path updated Wave 9.3):
#   1. Get Telegram bot token from BotFather (t.me/BotFather).
#   2. Get chat ID by adding bot to a Telegram channel, sending a message,
#      and reading the update at https://api.telegram.org/bot<TOKEN>/getUpdates
#   3. Add to /protected/staging.conf:
#      TELEGRAM_BOT_TOKEN=<token>
#      TELEGRAM_CHAT_ID=<chat-id>
#   4. Reload: systemctl reload abixell-disk-check.timer (or run probes manually).
#
# Graceful degradation:
#   Missing TELEGRAM_BOT_TOKEN → log to stderr, return 0 (no crash).
#   Missing TELEGRAM_CHAT_ID  → log to stderr, return 0 (no crash).
#   Telegram API error         → log to stderr, return 1.
#

set -euo pipefail
IFS=$'\n\t'

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  echo "Arbitrary commands are not accepted on this key." >&2
  exit 1
fi

readonly PROTECTED_CONF="/protected/staging.conf"
readonly MESSAGE="${1:-No message provided}"
readonly TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ ! -f "$PROTECTED_CONF" ]]; then
  echo "[ALERT] $TIMESTAMP | $MESSAGE | config unavailable" >&2
  exit 0
fi

# Extract config vars without sourcing the whole file.
env_value() {
  grep -E "^$1=" "$PROTECTED_CONF" | tail -1 | cut -d= -f2- | tr -d "'\""
}

TELEGRAM_BOT_TOKEN=$(env_value TELEGRAM_BOT_TOKEN 2>/dev/null || echo "")
TELEGRAM_CHAT_ID=$(env_value TELEGRAM_CHAT_ID 2>/dev/null || echo "")

# Graceful degradation: if credentials missing, log and return success.
if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
  echo "[ALERT] $TIMESTAMP | $MESSAGE | Telegram not configured (log-only mode)" >&2
  exit 0
fi

# Send via Telegram API.
ALERT_TEXT="🚨 Abixell One Staging Alert

$MESSAGE

Timestamp: $TIMESTAMP"

# Use curl to POST to Telegram sendMessage API.
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "chat_id": ${TELEGRAM_CHAT_ID},
  "text": "$(echo "$ALERT_TEXT" | sed 's/"/\\"/g')",
  "parse_mode": "Markdown"
}
EOF
)

# Check for Telegram API success (ok: true in JSON response).
if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "[ALERT] $TIMESTAMP | $MESSAGE | Sent via Telegram" >&2
  exit 0
else
  echo "[ALERT] $TIMESTAMP | $MESSAGE | Telegram API error: $RESPONSE" >&2
  exit 1
fi

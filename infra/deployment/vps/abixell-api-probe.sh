#!/usr/bin/env bash
#
# Reference source for the staging VPS API health alert probe.
#
# Fires every 30 seconds. Each run probes /api/health (liveness check).
# On every other run (30s cadence → 60s effective), also probes /api/health/db.
#
# API liveness alert window: if /api/health fails and 120+ seconds have passed
# since first down, sends an alert. On recovery, sends a recovery alert.
#
# DB alert: if /api/health/db returns non-200, sends alert immediately (no window).
# Recovery: sends alert and clears sentinel.
#
# State sentinels under /var/lib/abixell-one/:
#   - api-down-since (epoch timestamp when API first went down)
#   - api-alert-sent (marker: alert already sent)
#   - api-db-alert-sent (marker: DB alert already sent)
#
# This is NOT deployed automatically. An operator installs it once during
# VPS bootstrap (WP-ENV-02 Wave 7, CP-ENV-07):
#
#   sudo install -o root -g root -m 0755 \
#     infra/deployment/vps/abixell-api-probe.sh \
#     /usr/local/sbin/abixell-api-probe
#
# Installed as a systemd service + timer that runs every 30 seconds.
#

set -euo pipefail
IFS=$'\n\t'

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  echo "Arbitrary commands are not accepted on this key." >&2
  exit 1
fi

readonly PROTECTED_CONF="/protected/staging.conf"
readonly STATE_DIR="/var/lib/abixell-one"
readonly DOWN_SINCE_FILE="${STATE_DIR}/api-down-since"
readonly ALERT_SENT_FILE="${STATE_DIR}/api-alert-sent"
readonly DB_ALERT_SENT_FILE="${STATE_DIR}/api-db-alert-sent"
readonly API_LIVENESS_WINDOW=120  # seconds

mkdir -p "$STATE_DIR"

if [[ ! -f "$PROTECTED_CONF" ]]; then
  exit 0
fi

# Extract WEB_PORT from config (used to probe /api/health). Wave 9.3:
# WEB_PORT is operational config, not a secret, so it lives in staging.conf.
env_value() {
  grep -E "^$1=" "$PROTECTED_CONF" | tail -1 | cut -d= -f2- | tr -d "'\""
}
WEB_PORT=$(env_value WEB_PORT || echo "8080")
readonly WEB_URL="http://127.0.0.1:${WEB_PORT}"

NOW=$(date +%s)
PROBE_COUNTER_FILE="${STATE_DIR}/api-probe-counter"
COUNTER=$(cat "$PROBE_COUNTER_FILE" 2>/dev/null || echo "0")
COUNTER=$((COUNTER + 1))
echo "$COUNTER" > "$PROBE_COUNTER_FILE"

# Probe liveness every 30s.
LIVENESS_OK=false
if curl -s -m 5 "${WEB_URL}/api/health" >/dev/null 2>&1; then
  LIVENESS_OK=true
fi

if [[ "$LIVENESS_OK" == "true" ]]; then
  # API responding: clear down-since, send recovery if previously alerted.
  if [[ -f "$ALERT_SENT_FILE" ]]; then
    MESSAGE="API recovered: /api/health responding"
    /usr/local/sbin/abixell-alert-notify "$MESSAGE"
    rm "$ALERT_SENT_FILE" "$DOWN_SINCE_FILE" 2>/dev/null || true
  fi
else
  # API not responding: track time, alert if window exceeded.
  if [[ ! -f "$DOWN_SINCE_FILE" ]]; then
    # First down: record timestamp.
    echo "$NOW" > "$DOWN_SINCE_FILE"
  else
    # Subsequent down: check if window exceeded.
    DOWN_SINCE=$(cat "$DOWN_SINCE_FILE")
    ELAPSED=$((NOW - DOWN_SINCE))
    if [[ $ELAPSED -gt $API_LIVENESS_WINDOW ]] && [[ ! -f "$ALERT_SENT_FILE" ]]; then
      MESSAGE="API down for ${ELAPSED}s (threshold: ${API_LIVENESS_WINDOW}s)"
      /usr/local/sbin/abixell-alert-notify "$MESSAGE"
      touch "$ALERT_SENT_FILE"
    fi
  fi
fi

# DB probe every other run (60s effective cadence).
if [[ $((COUNTER % 2)) -eq 0 ]]; then
  DB_OK=false
  if curl -s -m 5 "${WEB_URL}/api/health/db" | grep -q '"database":"connected"'; then
    DB_OK=true
  fi

  if [[ "$DB_OK" == "true" ]]; then
    # DB responding: clear alert sentinel if previously alerted.
    if [[ -f "$DB_ALERT_SENT_FILE" ]]; then
      MESSAGE="Database connection recovered"
      /usr/local/sbin/abixell-alert-notify "$MESSAGE"
      rm "$DB_ALERT_SENT_FILE"
    fi
  else
    # DB not responding: alert immediately if not already sent.
    if [[ ! -f "$DB_ALERT_SENT_FILE" ]]; then
      MESSAGE="Database connection alert: /api/health/db not responding or not connected"
      /usr/local/sbin/abixell-alert-notify "$MESSAGE"
      touch "$DB_ALERT_SENT_FILE"
    fi
  fi
fi

exit 0

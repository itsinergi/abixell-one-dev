#!/usr/bin/env bash
#
# Reference source for the staging VPS disk usage alert probe.
#
# Checks whether /srv (deployment directory) usage exceeds 80%. If yes and no
# alert has been sent yet (state sentinel), sends an alert. When usage returns
# to ≤80%, clears the sentinel and sends a recovery alert.
#
# This is NOT deployed automatically. An operator installs it once during
# VPS bootstrap (WP-ENV-02 Wave 7, CP-ENV-07):
#
#   sudo install -o root -g root -m 0755 \
#     infra/deployment/vps/abixell-disk-check.sh \
#     /usr/local/sbin/abixell-disk-check
#
# Installed as a systemd service + timer that runs every 15 minutes.
#
# State sentinel: /var/lib/abixell-one/disk-alert-sent (touch to mark alert sent)
#

set -euo pipefail
IFS=$'\n\t'

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  echo "Arbitrary commands are not accepted on this key." >&2
  exit 1
fi

readonly MOUNT_POINT="/srv"
readonly STATE_DIR="/var/lib/abixell-one"
readonly ALERT_SENT_FILE="${STATE_DIR}/disk-alert-sent"
readonly ALERT_THRESHOLD=80

mkdir -p "$STATE_DIR"

# Get current usage percentage (integer only).
USAGE_PCT=$(df --output=pcent "$MOUNT_POINT" | tail -1 | sed 's/%//g' | tr -d ' ')

if [[ "$USAGE_PCT" -gt "$ALERT_THRESHOLD" ]]; then
  # Disk > 80%: alert if not already sent.
  if [[ ! -f "$ALERT_SENT_FILE" ]]; then
    MESSAGE="Disk usage on $MOUNT_POINT is ${USAGE_PCT}% (threshold: ${ALERT_THRESHOLD}%)"
    /usr/local/sbin/abixell-alert-notify "$MESSAGE"
    touch "$ALERT_SENT_FILE"
  fi
else
  # Disk ≤ 80%: recovery alert if previously alerted.
  if [[ -f "$ALERT_SENT_FILE" ]]; then
    MESSAGE="Disk usage on $MOUNT_POINT recovered to ${USAGE_PCT}% (below threshold: ${ALERT_THRESHOLD}%)"
    /usr/local/sbin/abixell-alert-notify "$MESSAGE"
    rm "$ALERT_SENT_FILE"
  fi
fi

exit 0

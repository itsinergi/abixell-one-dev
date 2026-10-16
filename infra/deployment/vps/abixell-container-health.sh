#!/usr/bin/env bash
#
# Reference source for the staging VPS container health alert probe.
#
# Runs `docker compose ps` against the live deployment and checks for
# unhealthy or non-running required services (postgres, api, web). If any
# is not healthy, sends an alert. When all required services are healthy,
# clears the alert sentinel and sends a recovery alert.
#
# This is NOT deployed automatically. An operator installs it once during
# VPS bootstrap (WP-ENV-02 Wave 7, CP-ENV-07):
#
#   sudo install -o root -g root -m 0755 \
#     infra/deployment/vps/abixell-container-health.sh \
#     /usr/local/sbin/abixell-container-health
#
# Installed as a systemd service + timer that runs every 60 seconds.
# Service runs as root (required for docker socket access).
#
# State sentinel: /var/lib/abixell-one/container-alert-sent
#

set -euo pipefail
IFS=$'\n\t'

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  echo "Arbitrary commands are not accepted on this key." >&2
  exit 1
fi

readonly DEPLOY_ROOT="/home/deploy/apps/abixell-one-dev"
readonly PROTECTED_ENV="/protected/staging.env"
readonly STATE_DIR="/var/lib/abixell-one"
readonly ALERT_SENT_FILE="${STATE_DIR}/container-alert-sent"

mkdir -p "$STATE_DIR"

if [[ ! -f "$PROTECTED_ENV" ]]; then
  echo "Protected env not found: $PROTECTED_ENV" >&2
  exit 1
fi

cd "$DEPLOY_ROOT"

# Run docker compose ps and check required services.
# Format: SERVICE HEALTH STATE
PS_OUTPUT=$(docker compose --env-file "$PROTECTED_ENV" -f infra/deployment/compose.yml ps --format 'table {{.Service}}\t{{.Health}}\t{{.State}}' 2>&1 || echo "ERROR")

# Check for required services that are not healthy or running.
# Required: postgres, api, web
UNHEALTHY_SERVICES=""

for service in postgres api web; do
  SERVICE_STATUS=$(echo "$PS_OUTPUT" | grep "^${service}" || echo "")

  if [[ -z "$SERVICE_STATUS" ]]; then
    UNHEALTHY_SERVICES+="$service (not found) "
  else
    STATE=$(echo "$SERVICE_STATUS" | awk '{print $NF}')
    HEALTH=$(echo "$SERVICE_STATUS" | awk '{print $2}')

    # Healthy states: "running" for services without healthcheck,
    # "(healthy)" for services with healthcheck.
    if [[ "$STATE" != "running" ]] || ([[ "$HEALTH" != "" ]] && [[ "$HEALTH" != "(healthy)" ]]); then
      UNHEALTHY_SERVICES+="$service ($HEALTH $STATE) "
    fi
  fi
done

if [[ -n "$UNHEALTHY_SERVICES" ]]; then
  # Unhealthy: alert if not already sent.
  if [[ ! -f "$ALERT_SENT_FILE" ]]; then
    MESSAGE="Container health alert: $UNHEALTHY_SERVICES"
    /usr/local/sbin/abixell-alert-notify "$MESSAGE"
    touch "$ALERT_SENT_FILE"
  fi
else
  # All healthy: recovery alert if previously alerted.
  if [[ -f "$ALERT_SENT_FILE" ]]; then
    MESSAGE="Container health recovered: all required services healthy"
    /usr/local/sbin/abixell-alert-notify "$MESSAGE"
    rm "$ALERT_SENT_FILE"
  fi
fi

exit 0

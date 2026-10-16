#!/usr/bin/env bash
#
# Reference source for the staging VPS container health alert probe.
#
# Checks the live deployment for unhealthy or non-running required services
# (postgres, api, web). If any is not healthy, sends an alert. When all
# required services are healthy, clears the alert sentinel and sends a
# recovery alert.
#
# Wave 9.3: this probe deliberately does NOT invoke `docker compose`. Compose
# always loads and interpolates compose.yml, and compose.yml uses `${VAR:?}`
# for secrets and required config; a monitoring probe on a 60-second timer has
# no business holding those values. `docker ps` with the Compose project and
# service labels reads the same container state without loading compose.yml.
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
# Config read: /protected/staging.conf — operational config only, no secrets.
# State sentinel: /var/lib/abixell-one/container-alert-sent
#

set -euo pipefail
IFS=$'\n\t'

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  echo "Arbitrary commands are not accepted on this key." >&2
  exit 1
fi

readonly PROTECTED_CONF="/protected/staging.conf"
readonly STATE_DIR="/var/lib/abixell-one"
readonly ALERT_SENT_FILE="${STATE_DIR}/container-alert-sent"

mkdir -p "$STATE_DIR"

if [[ ! -f "$PROTECTED_CONF" ]]; then
  echo "Protected config not found: $PROTECTED_CONF" >&2
  exit 1
fi

env_value() {
  grep -E "^$1=" "$PROTECTED_CONF" | tail -1 | cut -d= -f2- | tr -d "'\""
}

COMPOSE_PROJECT_NAME=$(env_value COMPOSE_PROJECT_NAME)
if [[ -z "$COMPOSE_PROJECT_NAME" ]]; then
  echo "Could not read COMPOSE_PROJECT_NAME from $PROTECTED_CONF" >&2
  exit 1
fi

# One line per container of this Compose project:
#   <compose-service>|<state>|<status>
# `docker ps -a` is used so a stopped container is reported as stopped rather
# than silently missing. Containers belonging to any other project are
# excluded by the project label.
PS_OUTPUT=$(docker ps -a \
  --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
  --format '{{.Label "com.docker.compose.service"}}|{{.State}}|{{.Status}}' 2>&1 \
  || echo "ERROR")

UNHEALTHY_SERVICES=""

for service in postgres api web; do
  SERVICE_STATUS=$(printf '%s\n' "$PS_OUTPUT" | grep "^${service}|" | tail -1 || true)

  if [[ -z "$SERVICE_STATUS" ]]; then
    UNHEALTHY_SERVICES+="$service (not found) "
    continue
  fi

  STATE="${SERVICE_STATUS#*|}"
  STATE="${STATE%%|*}"
  STATUS="${SERVICE_STATUS##*|}"

  if [[ "$STATE" != "running" ]]; then
    UNHEALTHY_SERVICES+="$service ($STATE) "
    continue
  fi

  # All three services declare a healthcheck, so Docker reports health inline
  # in the status text: "Up 2 minutes (healthy)", "(unhealthy)", or
  # "(health: starting)". Anything other than "(healthy)" alerts, matching the
  # previous `docker compose ps` behaviour.
  if [[ "$STATUS" != *"(healthy)"* ]]; then
    UNHEALTHY_SERVICES+="$service ($STATUS) "
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

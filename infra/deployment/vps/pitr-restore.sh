#!/usr/bin/env bash
#
# Reference source for the staging VPS PITR (point-in-time recovery) drill.
#
# Restores PostgreSQL to a specific timestamp from a physical base backup
# (pg_basebackup, NOT the logical pg_dump produced by backup-postgres.mjs —
# logical dumps cannot be replayed against WAL) plus archived WAL segments,
# inside a disposable container of the immutable deployment POSTGRES_IMAGE.
# Never touches the live deployment's postgres-data volume.
#
# This is NOT deployed automatically. An operator installs it once during
# VPS bootstrap (WP-ENV-02 Wave 8):
#
#   sudo install -o root -g root -m 0755 \
#     infra/deployment/vps/pitr-restore.sh \
#     /usr/local/sbin/abixell-pitr-restore
#
# Usage (operator incident response, or invoked by the monthly drill timer):
#   abixell-pitr-restore <target-timestamp-iso> [--skip-offsite-sync]
#
# Arguments:
#   target-timestamp-iso   ISO 8601 UTC timestamp, e.g. 2026-10-16T14:30:00Z
#                          WAL replay stops at or before this time.
#   --skip-offsite-sync    Skip the rclone WAL pull (local WAL already current).
#
# Fixed paths (do not parameterize):
#   PROTECTED_ENV   = /protected/staging.env (read-only; sourced for
#                     WAL_ROOT, POSTGRES_IMAGE, POSTGRES_USER)
#   DEPLOY_AUDIT_LOG = /var/lock/abixell-one/<COMPOSE_PROJECT_NAME>/deploy-audit.log
#   Base backups     = $WAL_ROOT/base/<UTC-compact-ts>/base.tar.gz
#                       (produced by abixell-pitr-basebackup)
#
# Required confirmation:
#   PITR_RESTORE_CONFIRM=PITR_RESTORE   must be set by the caller.
#
# Returns:
#   0 on success (recovery verified); 1 on failure. The disposable recovery
#   container and its PGDATA are removed in both cases — on failure, the
#   container's last log lines are printed to stderr before cleanup so the
#   operator can diagnose without a lingering container.
#
# Evidence (appended to DEPLOY_AUDIT_LOG):
#   PITR_DRILL | <iso-timestamp> | <base-backup-id> | <target-time> | <outcome> | <detail>
#

set -euo pipefail
IFS=$'\n\t'

if [[ -n "${SSH_ORIGINAL_COMMAND:-}" ]]; then
  echo "Arbitrary commands are not accepted on this key." >&2
  exit 1
fi

readonly PROTECTED_ENV="/protected/staging.env"

if [[ "${PITR_RESTORE_CONFIRM:-}" != "PITR_RESTORE" ]]; then
  echo "ERROR: Set PITR_RESTORE_CONFIRM=PITR_RESTORE to acknowledge this destructive operation." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <target-timestamp-iso> [--skip-offsite-sync]" >&2
  exit 1
fi

readonly TARGET_TIMESTAMP="$1"
readonly OFFSITE_SYNC="${2:-}"

if [[ ! -f "$PROTECTED_ENV" ]]; then
  echo "ERROR: Protected environment file not found: $PROTECTED_ENV" >&2
  exit 1
fi

if [[ ! "$TARGET_TIMESTAMP" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  echo "ERROR: Target timestamp must be UTC ISO 8601 (YYYY-MM-DDTHH:MM:SSZ)." >&2
  exit 1
fi
if [[ -n "$OFFSITE_SYNC" && "$OFFSITE_SYNC" != "--skip-offsite-sync" ]]; then
  echo "ERROR: Unknown argument: $OFFSITE_SYNC" >&2
  exit 1
fi

# Pull only the variables this script needs; do not export the whole file
# (it also holds JWT/DB secrets this script has no reason to hold).
env_value() {
  grep -E "^$1=" "$PROTECTED_ENV" | tail -1 | cut -d= -f2- | tr -d "'\""
}
WAL_ROOT=$(env_value WAL_ROOT)
POSTGRES_IMAGE=$(env_value POSTGRES_IMAGE)
POSTGRES_USER_NAME=$(env_value POSTGRES_USER)
POSTGRES_DB_NAME=$(env_value POSTGRES_DB)
COMPOSE_PROJECT_NAME=$(env_value COMPOSE_PROJECT_NAME)

for pair in "WAL_ROOT:$WAL_ROOT" "POSTGRES_IMAGE:$POSTGRES_IMAGE" \
  "POSTGRES_USER:$POSTGRES_USER_NAME" "POSTGRES_DB:$POSTGRES_DB_NAME" \
  "COMPOSE_PROJECT_NAME:$COMPOSE_PROJECT_NAME"; do
  if [[ -z "${pair#*:}" ]]; then
    echo "ERROR: Could not read ${pair%%:*} from $PROTECTED_ENV" >&2
    exit 1
  fi
done

readonly WAL_ROOT POSTGRES_IMAGE POSTGRES_USER_NAME POSTGRES_DB_NAME COMPOSE_PROJECT_NAME
readonly BASE_BACKUP_ROOT="$WAL_ROOT/base"
readonly DEPLOY_AUDIT_LOG="/var/lock/abixell-one/${COMPOSE_PROJECT_NAME}/deploy-audit.log"

readonly RECOVERY_PGDATA="/tmp/abixell-pitr-recovery-$$"
readonly RECOVERY_CONTAINER="abixell-pitr-recovery-$$"

cleanup() {
  docker rm -f "$RECOVERY_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$RECOVERY_PGDATA" || true
}
trap cleanup EXIT

if [[ "$OFFSITE_SYNC" != "--skip-offsite-sync" ]]; then
  if command -v rclone &>/dev/null; then
    # Use `copy`, not `sync`: sync would delete newer local WAL files that
    # have not yet been uploaded. copy only pulls missing files.
    echo "Pulling WAL from offsite (gdrive-abixell:abixell-one-staging-wal/)..." >&2
    rclone copy "gdrive-abixell:abixell-one-staging-wal/" "$WAL_ROOT/" --checksum \
      || echo "WARNING: offsite WAL pull failed; continuing with local WAL." >&2
  else
    echo "WARNING: rclone not found; continuing with local WAL only." >&2
  fi
fi

if [[ ! -d "$BASE_BACKUP_ROOT" ]]; then
  echo "ERROR: No base backup directory: $BASE_BACKUP_ROOT (run abixell-pitr-basebackup first)." >&2
  exit 1
fi

# Base backup dirs are named YYYYMMDDTHHMMSS<frac>Z (UTC, sortable). Pick the
# newest one taken at or before the target: PostgreSQL cannot recover to a
# time earlier than the backup's consistency point. Compare on the first 15
# chars (YYYYMMDDTHHMMSS) against the normalized target.
TARGET_COMPACT=$(printf '%s' "$TARGET_TIMESTAMP" | tr -d ':-' | cut -c1-15)
LATEST_BACKUP=""
for dir in $(find "$BASE_BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '*T*Z' | sort -r); do
  dir_compact=$(basename "$dir" | cut -c1-15)
  if [[ -f "$dir/base.tar.gz" && ! "$dir_compact" > "$TARGET_COMPACT" ]]; then
    LATEST_BACKUP="$dir"
    break
  fi
done
if [[ -z "$LATEST_BACKUP" ]]; then
  echo "ERROR: No complete base backup (base.tar.gz) taken at or before $TARGET_TIMESTAMP found under $BASE_BACKUP_ROOT." >&2
  exit 1
fi
readonly BASE_BACKUP_ID="$(basename "$LATEST_BACKUP")"
echo "Using base backup: $BASE_BACKUP_ID" >&2

mkdir -p "$RECOVERY_PGDATA"
chmod 0700 "$RECOVERY_PGDATA"
tar -xzf "$LATEST_BACKUP/base.tar.gz" -C "$RECOVERY_PGDATA"

touch "$RECOVERY_PGDATA/recovery.signal"
cat > "$RECOVERY_PGDATA/postgresql.auto.conf" <<EOF
restore_command = 'cp /var/lib/postgresql/wal/%f %p'
recovery_target_timeline = 'latest'
recovery_target_time = '$TARGET_TIMESTAMP'
recovery_target_action = 'promote'
EOF

# The base backup's file ownership reflects the container-internal postgres
# uid/gid at backup time. The official image's entrypoint only fixes up
# ownership on an *empty* PGDATA (fresh initdb); ours is pre-populated, so
# fix it explicitly using the image's own postgres user (avoids hardcoding a
# numeric uid that differs between the alpine and debian variants).
docker run --rm --user root \
  --volume "$RECOVERY_PGDATA:/var/lib/postgresql/data" \
  "$POSTGRES_IMAGE" chown -R postgres:postgres /var/lib/postgresql/data

echo "Starting recovery container (target: $TARGET_TIMESTAMP)..." >&2
docker run --detach --name "$RECOVERY_CONTAINER" \
  --network=none \
  --volume "$RECOVERY_PGDATA:/var/lib/postgresql/data" \
  --volume "$WAL_ROOT:/var/lib/postgresql/wal:ro" \
  "$POSTGRES_IMAGE" postgres >/dev/null

echo "Waiting for WAL replay to complete..." >&2
RECOVERY_DONE=0
for _ in $(seq 1 300); do
  if docker exec "$RECOVERY_CONTAINER" pg_isready -U "$POSTGRES_USER_NAME" -d "$POSTGRES_DB_NAME" -h localhost >/dev/null 2>&1; then
    STATE=$(docker exec "$RECOVERY_CONTAINER" psql -U "$POSTGRES_USER_NAME" -d "$POSTGRES_DB_NAME" -h localhost -t -A \
      -c "SELECT pg_is_in_recovery();" 2>/dev/null || echo "error")
    if [[ "$STATE" == "f" ]]; then
      RECOVERY_DONE=1
      break
    fi
  fi
  sleep 1
done

if [[ "$RECOVERY_DONE" -ne 1 ]]; then
  echo "ERROR: WAL replay did not reach the target timestamp within 300s." >&2
  echo "--- recovery container log (last 30 lines) ---" >&2
  docker logs --tail 30 "$RECOVERY_CONTAINER" >&2 || true
  echo "PITR_DRILL | $(date -u +%Y-%m-%dT%H:%M:%SZ) | $BASE_BACKUP_ID | $TARGET_TIMESTAMP | failed | replay-timeout" \
    >> "$DEPLOY_AUDIT_LOG" 2>/dev/null || true
  exit 1
fi

MIGRATION_HEAD=$(docker exec "$RECOVERY_CONTAINER" psql -U "$POSTGRES_USER_NAME" -d "$POSTGRES_DB_NAME" -h localhost -t -A \
  -c "SELECT COALESCE(max(name), 'NONE') FROM pgmigrations;" 2>/dev/null || echo "FAILED")
TENANT_COUNT=$(docker exec "$RECOVERY_CONTAINER" psql -U "$POSTGRES_USER_NAME" -d "$POSTGRES_DB_NAME" -h localhost -t -A \
  -c "SELECT count(*) FROM tenants;" 2>/dev/null || echo "FAILED")

if [[ "$MIGRATION_HEAD" == "FAILED" || "$TENANT_COUNT" == "FAILED" ]]; then
  echo "ERROR: Post-recovery verification query failed." >&2
  echo "PITR_DRILL | $(date -u +%Y-%m-%dT%H:%M:%SZ) | $BASE_BACKUP_ID | $TARGET_TIMESTAMP | failed | verification-query-failed" \
    >> "$DEPLOY_AUDIT_LOG" 2>/dev/null || true
  exit 1
fi

DETAIL="migrationHead=$MIGRATION_HEAD, tenants=$TENANT_COUNT"
mkdir -p "$(dirname "$DEPLOY_AUDIT_LOG")" 2>/dev/null || true
echo "PITR_DRILL | $(date -u +%Y-%m-%dT%H:%M:%SZ) | $BASE_BACKUP_ID | $TARGET_TIMESTAMP | success | $DETAIL" \
  >> "$DEPLOY_AUDIT_LOG" || {
    echo "ERROR: recovery verified ($DETAIL) but CP-ENV-08 evidence line could not be written to $DEPLOY_AUDIT_LOG." >&2
    exit 1
  }

echo "PITR drill succeeded: $DETAIL" >&2
exit 0

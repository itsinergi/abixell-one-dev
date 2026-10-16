# Backup, Restore, and Disaster Recovery Runbook

| Item | Value |
|---|---|
| Roadmap unit | PH-3 |
| Applies to | Each dedicated staging or production deployment |
| Backup unit | PostgreSQL database + document storage + manifest/checksums |
| Secrets | Supplied through deployment environment or secret manager; never stored here |
| Validation commands | `npm run backup`, `npm run restore`, `npm run verify:restore` |

## 0. Deployment auto-recovery vs database restore (do not confuse these)

The staging CD pipeline ([deployment-runbook §6/§9](deployment-runbook.md)) has two automatic recovery paths. Both are image/container recovery, not database recovery — no restore script runs, no database rows are restored, and no backup set is consulted:

- **Pre-migration:** if a deployment fails before its migration starts, the automation restarts the prior release's API/Web images against the *unchanged, unmigrated* database.
- **Post-migration (FD-ENV-04 Option A):** if the post-migration smoke check fails, the automation restarts the prior release's API/Web images from `last-success.json` against the *already-migrated* database and re-runs the smoke check once. The audit log records `DEPLOYMENT_FAILED_ROLLBACK_SUCCESS` or `DEPLOYMENT_FAILED_ROLLBACK_FAILED`. Migrations are forward-only, so this is safe only while the prior release stays compatible with the new schema; a `ROLLBACK_FAILED` outcome is an operator incident.

The procedures in this runbook are a separate, always-operator-driven decision:

- Deployment automation **never** invokes `migrate:down` and **never** triggers a restore from this runbook, at any phase, pre- or post-migration.
- Auto-rollback never restores the database. If the migrated database itself must be rolled back, only an operator — using the logical restore (§5) or point-in-time recovery (§7A) below — can decide whether to repair forward or restore.
- A restore from this runbook is always a deliberate, reviewed incident action; it is never a side effect of a failed deployment.

## 1. Scope and ownership

A recoverable Abixell One backup set includes both:

1. the PostgreSQL database, including the ordered migration history; and
2. the complete `FILE_STORAGE_ROOT`, because the `documents` table stores metadata and paths while the bytes live outside PostgreSQL.

A database-only dump is not a valid application backup. Source code and container images are not copied into the set; current format-2 manifests record `APPLICATION_RELEASE` plus the immutable API, operations, and Web image digests, and those release artifacts must be retained independently. Legacy format-1/early format-2 sets without image identities require separate operator evidence tying retained digests to the recorded release. Deployment secrets are neither dumped nor copied into a backup set.

The deployment operator owns scheduled execution, encrypted off-host transfer, retention, alerting, and restore drills. Application engineering owns these generic scripts and schema compatibility. Each dedicated deployment keeps its data and backup namespace separate from every other deployment.

## 2. Recovery objectives

The default assumptions below are a production starting point and must be approved per deployment before go-live:

| Objective | Default assumption | How to meet it |
|---|---:|---|
| RPO (logical sets) | 24 hours | At least one successful full logical backup per day. |
| RPO (database, staging with WAL archiving) | ≤5 seconds | `archive_timeout=5s` in `infra/deployment/compose.yml` plus a physical base backup and offsite WAL copy (§7A). Covers PostgreSQL only; document bytes still follow the logical-set RPO. |
| RTO | 4 hours | Pre-provisioned host access, retained matching images, documented secrets, tested restore, and an operator available. |
| Retention | 30 daily + 12 monthly sets | Enforce in encrypted off-host storage only after upload and checksum verification. |
| Restore drill | Logical: at least quarterly and before a Production Gate. PITR: monthly (systemd timer, §7A). | Restore into an isolated database/storage target and retain evidence. |

The logical scripts (§4–§5) implement complete sets and verification but not point-in-time recovery. Point-in-time recovery of PostgreSQL is a separate path (§7A) built on a physical base backup and archived WAL; it must be drilled separately and does not recover `FILE_STORAGE_ROOT`.

## 3. Required environment

Do not put credentials on a command line that will be logged. Supply variables from a protected environment file or secret manager.

### Backup

```text
DATABASE_URL                 Source PostgreSQL URL
BACKUP_ROOT                  Protected local staging directory for backup sets
FILE_STORAGE_ROOT            Source document directory
DEPLOYMENT_ENVIRONMENT       staging or production
APPLICATION_RELEASE          Immutable image digest or Git release identifier
BACKUP_API_IMAGE             Immutable runtime API image digest
BACKUP_OPERATIONS_IMAGE      Immutable operations image digest
BACKUP_WEB_IMAGE             Immutable Web image digest
BACKUP_ID                    Optional safe identifier; generated UTC value by default
```

### Restore/verification

```text
RESTORE_BACKUP_DIR           Complete backup-set directory
RESTORE_POSTGRES_IMAGE       Immutable PostgreSQL 16 recovery image
RESTORE_POSTGRES_*           Recovery-only user/password/database
RESTORE_DATABASE_URL         Fresh recovery-postgres database URL
RESTORE_FILE_STORAGE_ROOT    Fresh target document directory
RESTORE_CONFIRM=RESTORE      Required destructive acknowledgement for restore only
RESTORE_APPLICATION_RELEASE  Exact applicationRelease from the selected manifest
RESTORE_HEALTH_URL           Required in-Compose recovery-web /api/health URL
RESTORE_DB_HEALTH_URL        Required in-Compose recovery-web /api/health/db URL
```

For direct host execution, the host must provide Node.js 20+, PostgreSQL 16 client tools (`pg_dump`, `pg_restore`, `psql`), and `tar`. The deployment operations image already contains those tools and the scripts, allowing backup/restore to run on the internal Compose network without publishing PostgreSQL or exposing the document volume to an unrelated host path.

## 4. Backup procedure

1. Confirm the most recent backup and off-host upload status.
2. Confirm available disk space for a database dump plus compressed document archive.
3. Stop Web/API write traffic for a strict cross-store consistency point. PostgreSQL's dump is internally consistent, but database metadata and local document bytes are separate stores. The automated pre-migration path does this before invoking the backup service; an operator-run backup must enforce the same quiescence when it will be used as a recovery point.
4. Set the protected environment variables and run the deployment-topology path:

```bash
docker compose --env-file /protected/path/deployment.env -f infra/deployment/compose.yml --profile operations run --rm backup
```

For a directly reachable local/staging database and document directory, `npm run backup` remains the equivalent host path.

5. The script writes to `<BACKUP_ID>.partial`, rejects symlinks and unsupported filesystem entries in the source document tree, runs `pg_dump` in custom zstd format, validates the dump catalogue, validates the document tar entry names/types, writes SHA-256 values, migration head, release, and immutable application image identities to `manifest.json`, then atomically renames the directory.
6. Copy the completed directory to encrypted off-host storage. Do not retain only the host-local copy.
7. Verify the off-host object's size and checksum before applying retention.
8. Re-enable write traffic and record backup ID, start/end time, release, operator, outcome, and off-host location without credentials.

If any step fails, the script removes the partial set and exits non-zero. Re-enable the application, preserve logs, fix the cause, and run a new backup. Never promote or manually rename a partial set.

## 5. Restore procedure

Restoration is destructive and must target a fresh database. Do not run it over an active database.

1. Declare the incident, freeze writes, and preserve the current database/document state for investigation.
2. Select the newest complete backup that satisfies incident timing and integrity requirements.
3. Retrieve the matching immutable application release from `manifest.json`.
4. Provision an empty PostgreSQL database and an unused document target. Keep them isolated from the source deployment.
5. Create a separate protected restore environment file from [`infra/deployment/.env.restore.example`](../../infra/deployment/.env.restore.example). Use a unique recovery `COMPOSE_PROJECT_NAME`, immutable PostgreSQL 16 image, recovery-only PostgreSQL user/password/database and matching `RESTORE_DATABASE_URL`, selected host `RESTORE_BACKUP_DIR`, empty host `RESTORE_FILE_STORAGE_PARENT`, recovery-only application secrets/origin, `RESTORE_CONFIRM=RESTORE`, exact `RESTORE_APPLICATION_RELEASE`, and the immutable operations/API/Web images retained for the manifest release. Current manifests are machine-compared to the supplied application images; a legacy manifest without image identities emits a warning and requires retained operator evidence. Validate and restore with the dedicated recovery model:

```bash
npm run restore:validate -- /protected/path/restore.env
```

The recovery Compose model provisions its own PostgreSQL service and named volume on the isolated `recovery-backend`; it does not reuse the live deployment's database, credentials, application services, or document volume. Start the fresh recovery database, then run restore:

```bash
docker compose --env-file /protected/path/restore.env -f infra/deployment/compose.restore.yml up -d recovery-postgres
```

```bash
docker compose --env-file /protected/path/restore.env -f infra/deployment/compose.restore.yml --profile operations run --rm restore
```

For direct local/staging targets, `npm run restore` remains equivalent, but the target database must still be pristine and isolated.

6. Before database mutation, the script requires regular in-set manifest/archive files, verifies both checksums and the dump catalogue, pre-lists the document archive, rejects absolute/traversal/ambiguous paths and link/device/FIFO/socket entries, extracts to staging, rejects symlinks and unsupported restored filesystem entries, and checks the file count. It then refuses any target with user schemas/objects, restores with `--single-transaction --exit-on-error`, checks the migration head, and atomically swaps the isolated document directory. A prior document directory is retained as `.pre-restore`.
7. With `RESTORE_OPERATIONS_IMAGE`, `RESTORE_API_IMAGE`, and `RESTORE_WEB_IMAGE` already validated as immutable digests for the manifest release, start the isolated recovered API and Web proxy against `RESTORE_DATABASE_URL` and the restored document bind:

```bash
docker compose --env-file /protected/path/restore.env -f infra/deployment/compose.restore.yml up -d recovery-api recovery-web
```

`recovery-api` has Scheduler timers disabled, never mounts the source deployment's named document volume, and shares only the isolated `recovery-backend` network with `recovery-web`; the ordinary `api` service cannot satisfy the recovery proxy's `api` DNS name. Only `recovery-web` is published at `${RESTORE_WEB_BIND_ADDRESS:-127.0.0.1}:${RESTORE_WEB_PORT:-18080}` for operator access. The `verify-restore` container must use service DNS: `RESTORE_HEALTH_URL=http://recovery-web:8080/api/health` and `RESTORE_DB_HEALTH_URL=http://recovery-web:8080/api/health/db`. Both are mandatory, and `/health` must report the manifest's exact release. Do not immediately run newer migrations; first prove the base recovery with the matching release.
8. Run:

```bash
docker compose --env-file /protected/path/restore.env -f infra/deployment/compose.restore.yml --profile operations run --rm verify-restore
```

The direct-target equivalent is `npm run verify:restore`. Verification recomputes every active document byte stream against its database checksum and compares the complete restored file count with the manifest; missing, extra, escaping, absolute, or corrupt paths fail the drill.

9. Perform the checklist below and obtain incident/recovery acceptance.
10. Only after the recovered baseline is accepted may a separately reviewed deployment upgrade it to a newer release.

## 6. Restore verification checklist

- [ ] Manifest and both SHA-256 checksums pass.
- [ ] `pg_restore --list` passes.
- [ ] Target database was fresh and empty before restore.
- [ ] Restored migration head equals the manifest.
- [ ] `/health` returns HTTP 200.
- [ ] `/health/db` returns HTTP 200 with `database=connected`.
- [ ] Tenant count and representative business-row counts are plausible.
- [ ] An administrator can authenticate with a recovery-approved, non-demo credential.
- [ ] Every active document path exists and its database SHA-256 matches the restored bytes; restored file count equals the manifest.
- [ ] Tenant A cannot read Tenant B records or documents.
- [ ] Scheduler run history and Integration outbox status are present.
- [ ] Measured backup age is within RPO.
- [ ] Measured time from recovery start to accepted service is within RTO.
- [ ] Evidence records backup ID, release, environment class, operator/reviewer, timestamps, outcome, and exceptions—never secrets or client free-text.

## 7. Local/staging logical restore drill path

A quarterly logical restore drill must not point at the live source database or storage path:

1. Create a fresh PostgreSQL database, for example `abixell_restore_drill_<date>`.
2. Create an empty temporary document directory outside the source storage tree.
3. Run backup against staging or approved synthetic local data.
4. Run restore into the fresh targets.
5. Start the matching application release on non-production ports.
6. Set `RESTORE_HEALTH_URL` and `RESTORE_DB_HEALTH_URL`, then run restore verification.
7. Confirm the automated complete active-document checksum passes, then validate a tenant-isolation case manually.
8. Save evidence before dropping only the disposable drill database and directory.

## 7A. Point-in-time recovery (WAL archiving, staging)

PITR recovers PostgreSQL only, to a chosen UTC timestamp, from a physical base backup plus archived WAL. A logical `pg_dump` set cannot be replayed against WAL, so PITR has its own base backup. All helpers below are reference sources in `infra/deployment/vps/`; none is deployed automatically.

### 7A.1 One-time VPS setup (operator)

**Wave 9.3 amendment:** As of Wave 9 (Container & Secrets Hardening, 2026-10-16), `/protected/staging.env` no longer persists on disk after deployment. The `WAL_ROOT` value is now read from `/protected/staging.conf` (plaintext configuration). The step below still applies; just read `WAL_ROOT` from `staging.conf` instead.

1. Create the WAL directory named by `WAL_ROOT` in `/protected/staging.conf` (default `/srv/abixell-one/wal`), owned by the container's postgres uid, mode `0700`. Confirm the uid with `docker compose --env-file /protected/staging.conf -f infra/deployment/compose.yml exec postgres id -u postgres`.
2. Redeploy or restart the `postgres` service so `archive_mode=on`, `archive_command`, and `archive_timeout=5s` from `compose.yml` take effect. Confirm with `SHOW archive_mode;` and that new files appear in `WAL_ROOT`.
3. Install the helpers:

```bash
sudo install -o root -g root -m 0755 infra/deployment/vps/abixell-pitr-basebackup /usr/local/sbin/abixell-pitr-basebackup
```

```bash
sudo install -o root -g root -m 0755 infra/deployment/vps/pitr-restore.sh /usr/local/sbin/abixell-pitr-restore
```

4. Install and enable the monthly drill timer (commands in the header of `abixell-pitr-drill.service`), and the audit-log rotation `abixell-one-logrotate` into `/etc/logrotate.d/abixell-one`.

### 7A.2 Physical base backup

Run `abixell-pitr-basebackup` as the deploy user. It streams `pg_basebackup -Ft -z -X none` from the running container to `$WAL_ROOT/base/<UTC-ts>/base.tar.gz`, verifies the archive is a readable gzip tar containing `backup_label`, discards it on any failure, and appends a `BASE_BACKUP` line to the deployment audit log.

Take a fresh base backup at least as often as the drill timer fires; WAL replay time grows with the age of the base backup.

### 7A.3 Offsite WAL and base backups

Copy `WAL_ROOT` (WAL segments and `base/`) to the offsite remote `gdrive-abixell:abixell-one-staging-wal/`. Offsite copies fall under the §9 encryption rule. Upload with `rclone copy`/`rclone sync` from the host to the remote; when pulling back for recovery, use `rclone copy` only, never `rclone sync`, so newer local WAL that was not yet uploaded is never deleted.

`WAL_ROOT` grows continuously: with `archive_timeout=5s`, every 5-second window with any write activity closes a full 16 MB segment. Monitor free disk space, and prune WAL older than the oldest base backup you still intend to restore from, only after that WAL is confirmed offsite.

### 7A.4 PITR procedure

```bash
PITR_RESTORE_CONFIRM=PITR_RESTORE abixell-pitr-restore 2026-10-16T14:30:00Z
```

The script pulls missing WAL from offsite (skip with `--skip-offsite-sync`), selects the newest base backup, extracts it to a temporary directory, writes `recovery.signal` and the recovery target into `postgresql.auto.conf`, and starts a disposable `POSTGRES_IMAGE` container with `--network=none`. It never touches the live `postgres-data` volume. After replay promotes, it checks the `pgmigrations` head and `tenants` count, appends a `PITR_DRILL` line to the audit log, and removes the container and its data directory whether it succeeds or fails.

The script proves that the database can be recovered to the target time. To serve a recovered database to users, an operator must take a separately reviewed incident decision; that cutover is not automated.

### 7A.5 Monthly drill and CP-ENV-08 evidence

`abixell-pitr-drill.timer` runs `abixell-pitr-restore` on the first day of each month with a target of 10 minutes before run time. CP-ENV-08 evidence for each drill:

- [ ] WAL files present in `WAL_ROOT` and offsite.
- [ ] `BASE_BACKUP | ... | success` line for the base backup used.
- [ ] `PITR_DRILL | ... | success | migrationHead=..., tenants=...` line.
- [ ] Measured RPO: newest archived WAL timestamp versus target time ≤5 seconds.
- [ ] Logical `verify-restore` PASS from the most recent §7 drill.

Read the outcome with `systemctl status abixell-pitr-drill.service` and `journalctl -u abixell-pitr-drill.service`. A failed drill prints the recovery container's last log lines to the journal.

## 8. Failure, rollback, and incident handling

- **Backup fails:** keep the application serving unless it was intentionally quiesced, remove only `.partial` output, alert the operator, and retry after correction. Do not delete the previous known-good set.
- **Checksum or archive validation fails:** quarantine that set; never restore it. Select another known-good set or escalate.
- **Database restore fails:** leave the source untouched, discard the fresh failed target, diagnose, and retry into another fresh target.
- **Document swap fails:** the restore script attempts to put the prior document directory back. Verify filesystem state manually before starting the API.
- **Health or data verification fails:** do not direct users to the target. Preserve evidence and either retry from a prior set or repair under an approved incident plan.
- **Release rollback after deployment:** automated post-migration image rollback (FD-ENV-04 Option A, §0) assumes the prior release is compatible with the migrated schema. If it records `DEPLOYMENT_FAILED_ROLLBACK_FAILED`, treat it as an incident. Never automate `migrate:down`; schema reversal or data restore is an explicit reviewed recovery decision.
- **PITR drill fails:** check `journalctl -u abixell-pitr-drill.service` for the recovery container log. Common causes: no base backup older than the target, a gap in WAL, or replay exceeding the 300-second wait. The live database is unaffected; fix the cause and re-run manually.
- **Suspected compromise:** do not overwrite evidence. Isolate the deployment, rotate secrets outside source control, restore from a known-good point, and review all external integration endpoints before reopening traffic.

## 9. Security rules

- Backup directories and environment files must be readable only by the deployment operator/service account.
- Encrypt off-host copies and manage keys outside this repository.
- Never embed database passwords, bootstrap keys, JWT secrets, client names, domains, or storage credentials in scripts or evidence.
- Keep backup sets physically/logically separated by dedicated deployment.
- Test restoration regularly; successful creation alone is not evidence of recoverability.

## 9A. Wave 9.3 — SOPS + age secrets (staging)

**Authority:** WP-ENV-02 Wave 9 (Container & Secrets Hardening), DEC-ENV-SOPS Option A (deploy-user-owned key), ratified 2026-10-16. The CD wrapper (`infra/deployment/vps/abixell-staging-deploy-wrapper`) performs the split/encrypt/merge described here automatically on every deploy; this section covers operator setup and manual procedures the wrapper does not do for you.

### 9A.1 One-time setup (operator)

1. Install `sops` ≥ 3.7 on the VPS (binary release from the SOPS project, placed at `/usr/local/bin/sops`, mode `0755`).
2. Generate the age key pair once: `age-keygen -o /protected/age-key.txt && chmod 600 /protected/age-key.txt && chown deploy:deploy /protected/age-key.txt`.
3. Back up the age private key **offsite, in a location separate from the WAL/backup offsite remote** (`gdrive-abixell:...`, §7A.3). This is the two-lock requirement behind DEC-ENV-SOPS Option A: a single storage loss must never compromise both the encrypted secrets and the key that decrypts them.
4. Migration from a pre-Wave-9 host (one-time, only if `/protected/staging.env` still exists): copy any operator-only variables into the new config file, then remove the old file:
   ```bash
   grep -E '^TELEGRAM_' /protected/staging.env >> /protected/staging.conf 2>/dev/null || true
   chmod 600 /protected/staging.conf
   shred -u /protected/staging.env
   ```
   The next CD deploy writes `staging.conf` and `staging.secrets.enc.env` from the wrapper; `/protected/staging.env` is not recreated.
5. Reinstall the Wave 9.3 scripts per each file's own install header: `abixell-staging-deploy-wrapper`, `abixell-container-health.sh`, `abixell-api-probe.sh`, `abixell-alert-notify.sh`, `abixell-pitr-basebackup`, `pitr-restore.sh`. All six were changed to read `/protected/staging.conf` instead of the old `staging.env`.

### 9A.2 Manual `docker compose` invocation (operator)

Compose always loads `compose.yml` and interpolates every `${VAR:?}` placeholder, so any manual compose command (debugging, an ad hoc `exec`) needs the full merged environment, not just `staging.conf`. Build it in `/tmp`, use it, then shred it — never leave a merged plaintext file on disk:

```bash
SOPS_AGE_KEY_FILE=/protected/age-key.txt sops --decrypt --input-type json --output-type dotenv /protected/staging.secrets.enc.env > /tmp/.secrets.$$.env
cat /protected/staging.conf /tmp/.secrets.$$.env > /tmp/.merged.$$.env
chmod 600 /tmp/.secrets.$$.env /tmp/.merged.$$.env
docker compose --env-file /tmp/.merged.$$.env -f infra/deployment/compose.yml <command>
shred -u /tmp/.secrets.$$.env /tmp/.merged.$$.env
```

### 9A.3 Verification

```bash
SOPS_AGE_KEY_FILE=/protected/age-key.txt sops --decrypt /protected/staging.secrets.enc.env
```

Expect the 4 secret `KEY=value` lines (`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `PLATFORM_BOOTSTRAP_KEY`, `DATABASE_URL`).

### 9A.4 Rotation

The wrapper re-encrypts the full secret set on every deploy from whatever key `/protected/age-key.txt` currently holds, so rotation is: generate a new age key pair, replace `/protected/age-key.txt` with it, run one CD deploy, then confirm decrypt (§9A.3) with the new key. Keep the old key backed up until the first successful decrypt with the new key is confirmed.

### 9A.5 Key-loss recovery

If `/protected/age-key.txt` is lost with no offsite backup, `staging.secrets.enc.env` is permanently undecryptable. Recovery requires rotating all 4 secret values at their source (PostgreSQL password, JWT secret, bootstrap key, `DATABASE_URL`), generating a fresh age key, and running CD once to re-encrypt. There is no way to recover the old values from the encrypted file without the matching private key.

### 9A.6 Known gap

`sops --output-type dotenv` quotes decrypted values (`KEY="value"`). This only affects the manual decrypt path in §9A.2 — the CD wrapper never re-serializes through that format, so `validate-env.mjs`/`deploy.mjs` never see the quoting. Strip quotes manually if piping the manual decrypt output into a tool that does not expect them.

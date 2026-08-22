# Backup, Restore, and Disaster Recovery Runbook

| Item | Value |
|---|---|
| Roadmap unit | PH-3 |
| Applies to | Each dedicated staging or production deployment |
| Backup unit | PostgreSQL database + document storage + manifest/checksums |
| Secrets | Supplied through deployment environment or secret manager; never stored here |
| Validation commands | `npm run backup`, `npm run restore`, `npm run verify:restore` |

## 1. Scope and ownership

A recoverable Abixell One backup set includes both:

1. the PostgreSQL database, including the ordered migration history; and
2. the complete `FILE_STORAGE_ROOT`, because the `documents` table stores metadata and paths while the bytes live outside PostgreSQL.

A database-only dump is not a valid application backup. Source code and container images are not copied into the set; the manifest records `APPLICATION_RELEASE`, and immutable release artifacts must be retained independently. Deployment secrets are neither dumped nor copied into a backup set.

The deployment operator owns scheduled execution, encrypted off-host transfer, retention, alerting, and restore drills. Application engineering owns these generic scripts and schema compatibility. Each dedicated deployment keeps its data and backup namespace separate from every other deployment.

## 2. Recovery objectives

The default assumptions below are a production starting point and must be approved per deployment before go-live:

| Objective | Default assumption | How to meet it |
|---|---:|---|
| RPO | 24 hours | At least one successful full logical backup per day. A shorter RPO requires more frequent dumps or provider-native continuous backup/WAL archiving. |
| RTO | 4 hours | Pre-provisioned host access, retained matching images, documented secrets, tested restore, and an operator available. |
| Retention | 30 daily + 12 monthly sets | Enforce in encrypted off-host storage only after upload and checksum verification. |
| Restore drill | At least quarterly and before a Production Gate | Restore into an isolated database/storage target and retain evidence. |

The scripts implement complete logical sets and verification. They do not claim point-in-time recovery. If an approved RPO is shorter than the dump interval, add a PostgreSQL-provider or WAL-archive control and test that path separately.

## 3. Required environment

Do not put credentials on a command line that will be logged. Supply variables from a protected environment file or secret manager.

### Backup

```text
DATABASE_URL                 Source PostgreSQL URL
BACKUP_ROOT                  Protected local staging directory for backup sets
FILE_STORAGE_ROOT            Source document directory
DEPLOYMENT_ENVIRONMENT       staging or production
APPLICATION_RELEASE          Immutable image digest or Git release identifier
BACKUP_ID                    Optional safe identifier; generated UTC value by default
```

### Restore/verification

```text
RESTORE_BACKUP_DIR           Complete backup-set directory
RESTORE_DATABASE_URL         Fresh, empty target PostgreSQL database
RESTORE_FILE_STORAGE_ROOT    Fresh target document directory
RESTORE_CONFIRM=RESTORE      Required destructive acknowledgement for restore only
RESTORE_HEALTH_URL           Optional API /health URL after application start
RESTORE_DB_HEALTH_URL        Optional API /health/db URL after application start
```

For direct host execution, the host must provide Node.js 20+, PostgreSQL 16 client tools (`pg_dump`, `pg_restore`, `psql`), and `tar`. The deployment operations image already contains those tools and the scripts, allowing backup/restore to run on the internal Compose network without publishing PostgreSQL or exposing the document volume to an unrelated host path.

## 4. Backup procedure

1. Confirm the most recent backup and off-host upload status.
2. Confirm available disk space for a database dump plus compressed document archive.
3. For a strict cross-store consistency point, put the API in maintenance mode or stop write traffic briefly. PostgreSQL's dump is internally consistent, but database metadata and local document bytes are separate stores.
4. Set the protected environment variables and run the deployment-topology path:

```bash
docker compose --env-file /protected/path/deployment.env -f infra/deployment/compose.yml --profile operations run --rm backup
```

For a directly reachable local/staging database and document directory, `npm run backup` remains the equivalent host path.

5. The script writes to `<BACKUP_ID>.partial`, runs `pg_dump` in custom zstd format, validates the archive with `pg_restore --list`, archives the same named document volume mounted by the API, writes SHA-256 values and the migration head to `manifest.json`, then atomically renames the directory.
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
5. Create a separate protected restore environment file with a fresh internal `RESTORE_DATABASE_URL`, the selected host `RESTORE_BACKUP_DIR`, an empty host `RESTORE_FILE_STORAGE_PARENT`, and `RESTORE_CONFIRM=RESTORE`, then run:

```bash
docker compose --env-file /protected/path/restore.env -f infra/deployment/compose.yml --profile restore run --rm restore
```

For direct local/staging targets, `npm run restore` remains equivalent.

6. The script verifies both archive checksums and the dump catalogue before any restore, refuses a non-empty database, restores with `--exit-on-error`, checks the migration head, extracts documents to staging, and atomically swaps the isolated document directory. A prior document directory is retained as `.pre-restore`.
7. Start the application version recorded in the manifest. Do not immediately run newer migrations; first prove the base recovery with the matching release.
8. Run:

```bash
docker compose --env-file /protected/path/restore.env -f infra/deployment/compose.yml --profile restore run --rm verify-restore
```

The direct-target equivalent is `npm run verify:restore`. Verification automatically recomputes the bytes of one representative active document against its database checksum when an active document exists.

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
- [ ] A representative document downloads and its database SHA-256 matches the restored bytes.
- [ ] Tenant A cannot read Tenant B records or documents.
- [ ] Scheduler run history and Integration outbox status are present.
- [ ] Measured backup age is within RPO.
- [ ] Measured time from recovery start to accepted service is within RTO.
- [ ] Evidence records backup ID, release, environment class, operator/reviewer, timestamps, outcome, and exceptions—never secrets or client free-text.

## 7. Local/staging drill path

A quarterly drill must not point at the live source database or storage path:

1. Create a fresh PostgreSQL database, for example `abixell_restore_drill_<date>`.
2. Create an empty temporary document directory outside the source storage tree.
3. Run backup against staging or approved synthetic local data.
4. Run restore into the fresh targets.
5. Start the matching application release on non-production ports.
6. Set `RESTORE_HEALTH_URL` and `RESTORE_DB_HEALTH_URL`, then run restore verification.
7. Confirm the automated representative document checksum passes, then validate a tenant-isolation case manually.
8. Save evidence before dropping only the disposable drill database and directory.

## 8. Failure, rollback, and incident handling

- **Backup fails:** keep the application serving unless it was intentionally quiesced, remove only `.partial` output, alert the operator, and retry after correction. Do not delete the previous known-good set.
- **Checksum or archive validation fails:** quarantine that set; never restore it. Select another known-good set or escalate.
- **Database restore fails:** leave the source untouched, discard the fresh failed target, diagnose, and retry into another fresh target.
- **Document swap fails:** the restore script attempts to put the prior document directory back. Verify filesystem state manually before starting the API.
- **Health or data verification fails:** do not direct users to the target. Preserve evidence and either retry from a prior set or repair under an approved incident plan.
- **Release rollback after deployment:** roll application images back only when their schema compatibility is known. Never automate `migrate:down`; schema reversal or data restore is an explicit reviewed recovery decision.
- **Suspected compromise:** do not overwrite evidence. Isolate the deployment, rotate secrets outside source control, restore from a known-good point, and review all external integration endpoints before reopening traffic.

## 9. Security rules

- Backup directories and environment files must be readable only by the deployment operator/service account.
- Encrypt off-host copies and manage keys outside this repository.
- Never embed database passwords, bootstrap keys, JWT secrets, client names, domains, or storage credentials in scripts or evidence.
- Keep backup sets physically/logically separated by dedicated deployment.
- Test restoration regularly; successful creation alone is not evidence of recoverability.

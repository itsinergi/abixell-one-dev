# ADR-0024: Staging Continuous Deployment and Pre-Migration Recovery Boundary

**Date:** 2026-10-13

**Status:** DECIDED (WP-ENV-02 Wave 6)

**Author:** Abixell One Implementation

## Context

Staging deployment is currently manual. Operators download image digests from a successful build run, render an environment file, validate locally, and SSH into the VPS to run the deploy command. The process is error-prone and blocks rapid iteration.

Additionally, failed deployments lack an automated recovery path. If a deployment fails partway through—before a migration runs—the prior healthy release should be automatically restored. Once a migration has started, however, automatic recovery is dangerous: the database has been mutated and may no longer be compatible with the old API code. The system must distinguish these two cases with a durable marker.

## Decision

### D1 — Continuous Deployment Protocol

Staging deployment is **fully automated** via GitHub Actions ([`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)):

1. **Trigger:** successful `Build and Push Images` run on `master` or manual `workflow_dispatch` with an explicit build run ID.
2. **Provenance check:** GitHub API validates the run's conclusion (`success`), workflow name (`Build and Push Images`), and head branch (`master` or a version tag). A `workflow_dispatch` input pointing at a failed or unrelated run is rejected.
3. **Artifact download:** pinned `actions/download-artifact` SHA downloads the `image-digests` artifact from the verified run.
4. **Digest parsing:** strictly parse required fields; tags and malformed digests are rejected.
5. **Environment rendering:** render `infra/deployment/.env` from the template, parsed digests, and the `staging` GitHub Environment's secrets/variables.
6. **Local validation:** run `deploy:validate` against the temp environment file without printing its contents.
7. **SSH authentication:** use a dedicated deploy key (no CI credentials on VPS) with a **pinned** `known_hosts` entry (captured by the operator at VPS bootstrap, not trust-on-first-use).
8. **Pipeline over stdin:** pipe the rendered environment to the static VPS wrapper (`/usr/local/sbin/abixell-staging-deploy-wrapper`) via stdin. The wrapper validates the protocol, atomically replaces the protected environment file, and runs the fixed deploy command.
9. **Cleanup:** always shred the temp environment file and remove the deploy key from the runner.
10. **Concurrency:** serialize staging deploys (`concurrency: group: staging-deploy`); a second trigger queues instead of racing.

**Rationale:** GitHub Actions CI already has the build artifacts and runs in a trusted context. Automating the render/validate/deploy pipeline eliminates manual steps and removes secrets from VPS state.

### D2 — Recovery Boundary: Pre-Migration vs Post-Migration

The deployment is protected by a **durable `migrationStarted` marker** written to the deployment state root (alongside `last-success.json`). This marker separates two failure regimes:

#### Pre-Migration Failures (marker not yet written)

If a deployment fails during validation, image pull, image scanning, PostgreSQL setup, quiesce, or pre-migration backup—**before the marker is written**—the system **automatically recovers the prior successful release**:

1. Read `last-success.json` (immutable images, release string, timestamps from the prior successful deployment).
2. Start the prior API/Web images against the existing (unchanged) database.
3. Wait for services and run smoke expecting the **prior** `APPLICATION_RELEASE`.
4. If recovery smoke passes: record `PRE_MIGRATION_RECOVERY` outcome in the audit log, exit with code 1 (indicating recovery, not new deployment success). The previous release remains running.
5. If recovery fails or prior state is missing: exit fail-closed (operator must intervene).

**Pre-migration recovery is safe because:**
- The database has not been mutated (no migrations have run).
- The prior release was recently proven healthy (`last-success.json` was written only after smoke passed).
- Web/API write traffic was already quiesced before the failure occurred.
- Smoke for the prior release using `--expected-release` confirms the old service is actually working, not just a lucky image reference.

#### Post-Migration Failures (marker written)

Once the durable `migrationStarted` marker is written—**before the migration command runs**—**no automatic recovery occurs**. Any failure (migration itself, permission sync, release startup, or post-migration smoke) results in fail-closed:

1. Web/API are stopped; the database has been migrated.
2. Preserve logs, the pre-migration backup, and post-migration state for investigation.
3. Do not automatically run `migrate:down`.
4. Operator determines whether the schema change is transactional (safe to retry), requires a forward repair, or requires a complete restore from the pre-migration backup.

**Rationale:** Once a migration has run and committed, the database state no longer matches any previous release. Rolling back API images blindly against a forward-migrated schema corrupts data. Schema reversal, if needed, is a separate reviewed operator decision, not automation.

### D3 — Release-Aware Smoke

The smoke command is release-aware: pass `--expected-release=<APPLICATION_RELEASE>` (or set the env var) and smoke asserts that `/api/health` reports the exact expected release. This prevents a healthy prior release from satisfying a new deployment's smoke gate.

**Rationale:** A deployable old API may report `status: "ok"` even when running against a forward-migrated schema. The release check catches this case: if the old API is still running, it reports the old release string, causing the new deployment's smoke to fail as intended.

### D4 — Append-Only Audit Log

Every deployment phase transition is appended to `deploy-audit.log` (mode `0600`, append-only) in the deployment state root. Records are JSON Lines with hash-chain tamper evidence, secret redaction, and key fields:

- `timestamp`, `deploymentId`, `phase`, `outcome`, `applicationRelease`, `migrationStarted` (on failure records).

The `migrationStarted` field on a failure record explicitly indicates whether automatic recovery is permitted (false) or forbidden (true).

**Rationale:** Auditing every phase transition creates a durable trace of deployment decisions and failures. The `migrationStarted` field is explicit evidence of the recovery boundary in effect at the time of the failure.

### D5 — VPS Wrapper Protocol

The VPS does not hold build credentials or rendering logic. A static, forced-command SSH wrapper enforces a strict stdin protocol:

1. SSH key can only execute `/usr/local/sbin/abixell-staging-deploy-wrapper` (enforced by `authorized_keys` `command="..."` restriction).
2. Wrapper reads stdin (hard max ~10KB), validates the protocol (rejects NUL, malformed, unknowns, duplicates, templates, excess).
3. Wrapper runs `deploy:validate` against the received environment.
4. Wrapper atomically writes the protected environment file (temp + rename, no symlink follow).
5. Wrapper invokes `node infra/deployment/deploy.mjs /protected/staging.env`.
6. Exit code is the deployment outcome; cleanup on all paths.

> **Wave 9.3 amendment (2026-10-16):** steps 4–5 are superseded. The wrapper now splits the validated env into `/protected/staging.secrets.enc.env` (SOPS+age, 4 secrets) and `/protected/staging.conf` (plaintext config, operator-only keys preserved), passes an ephemeral `/tmp` plaintext copy (mode 0600) to `deploy.mjs`, and shreds it after deploy exits. `/protected/staging.env` is no longer written. See the wrapper header and `docs/operations/backup-restore-dr-runbook.md` §9A.

**Rationale:** The VPS is a runtime host, not a build/configuration host. All logic (provenance check, environment rendering, validation) runs in GitHub Actions (trusted CI context). The VPS wrapper is minimal, static, and cannot be updated during a deployment.

## Alternatives Considered

### A1 — Manual SSH+`scp`
**Rejected:** Requires human action, slow, error-prone. Does not eliminate manual steps.

### A2 — Automatic `migrate:down` on post-migration failure
**Rejected:** Schema reversals are unsafe without explicit review. The database may have received backward-incompatible data; rolling back code against a forward-mutated schema corrupts data.

### A3 — Auto-recover all failures (pre- and post-migration)
**Rejected:** Post-migration recovery of a prior release against a forward-migrated schema is data corruption. The durable marker is necessary to prevent this.

### A4 — Trust-on-first-use for VPS host key
**Rejected:** TOFU is a MITM vulnerability. The operator captures the host key at bootstrap (`ssh-keyscan -H <host>`), and GitHub Actions uses the pinned value from a secret.

## Consequences

### Positive

1. **Rapid iteration:** staging deploys are fully automated, reducing cycle time.
2. **Auditability:** every phase transition is logged with hash-chain tamper evidence.
3. **Safe pre-migration recovery:** a deployment failure before migration are automatically recovers the prior release, minimizing downtime.
4. **Clear recovery boundary:** the durable marker explicitly separates recoverable (pre-migration) failures from fail-closed (post-migration) failures.
5. **Release-aware smoke:** prevents false positives when a prior release is still running.
6. **No secrets on VPS:** the VPS holds only the protected environment file; all CI credentials stay in GitHub Actions.

### Negative

1. **Post-migration failures require operator intervention:** no automatic rollback after a migration runs. This is intentional (see D2 rationale) but requires operator readiness.
2. **CD workflow complexity:** the GitHub Actions workflow is larger than a manual SSH invocation. The complexity is justified by automation, but adds maintenance burden.
3. **Safe recovery drills required:** pre-migration recovery and post-migration fail-closed behavior must be proven in staging before production use. Testing via automation alone is insufficient.

## Evidence / Testing

**Gate CP-ENV-06** requires:

- [ ] GitHub Environment `staging` configured with secrets and variables.
- [ ] Dedicated SSH key forced-command-only in `authorized_keys`.
- [ ] VPS wrapper rejects arbitrary SSH commands.
- [ ] Stdin protocol rejects malformed/oversized/unknown input.
- [ ] Env validated before atomic replacement.
- [ ] No secret in workflow logs/artifacts/job summaries.
- [ ] CD consumes only successful, provenance-checked digest artifacts.
- [ ] All GitHub Actions pinned to verified SHA.
- [ ] Concurrent deploys serialize (no race condition).
- [ ] Release-aware smoke rejects healthy old release.
- [ ] `last-success.json` changes only after new release smoke passes.
- [ ] Audit log records every phase, is hash-chained, and contains no secrets.
- [ ] Pre-migration failure triggers automatic recovery (safe drill).
- [ ] Automatic recovery smoke expects the prior release (not the new one).
- [ ] Migration-started marker is durable before migration runs.
- [ ] Migration/post-migration failure results in fail-closed (safe drill, disposable staging only).
- [ ] No code path invokes `migrate:down`.
- [ ] Runbook and registers reflect the actual recovery boundary.

Safe recovery drills (staging disposable only):

**Drill A—Pre-Migration Recovery:** Force failure after quiesce, before migration marker. Verify prior release restarts, smoke observes the prior `APPLICATION_RELEASE`, exit code 1, audit hash chain intact, no secrets leaked.

**Drill B—Post-Migration Fail-Closed:** Force migration or post-migration smoke failure. Verify no prior restart, no DB rollback, no `migrate:down`, audit records `migrationStarted: true`, API/Web unavailable.

## References

- [`infra/deployment/deploy.mjs`](../../infra/deployment/deploy.mjs) — deployment state machine, recovery executor, durable marker, release-aware smoke.
- [`infra/deployment/deployment-state.mjs`](../../infra/deployment/deployment-state.mjs) — state file I/O, durable markers, atomic writes.
- [`infra/deployment/audit-log.mjs`](../../infra/deployment/audit-log.mjs) — append-only JSON Lines, hash-chain, redaction.
- [`infra/deployment/recovery.mjs`](../../infra/deployment/recovery.mjs) — prior release restoration logic.
- [`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml) — GitHub Actions CD trigger, artifact download, env render, SSH pipe, cleanup.
- [`docs/operations/deployment-runbook.md`](../../docs/operations/deployment-runbook.md) — operational procedures, state machine, recovery boundary, audit schema.
- [`docs/operations/backup-restore-dr-runbook.md`](../../docs/operations/backup-restore-dr-runbook.md) — DB recovery procedures (distinct from image recovery; deployment never auto-restores DB).

---

**Ringkasan Indonesia**

Wave 6 mengotomasi staging rilis via GitHub Actions CD. Setelah CI build sukses, workflow me-render staging.env dengan digest baru, validate lokal, SSH-pipe ke VPS wrapper statis yang validate lagi + atomik replace env + jalankan fixed deploy. Jika smoke gagal *sebelum* migrasi jalan, sistem otomatis restart release sebelumnya dari `last-success.json` dan smoke expecting prior release (release-aware). Jika migrasi sudah jalan (marker `migrationStarted=true` written), sistem fail-closed (tidak ada migrate:down, tidak ada restore DB otomatis) dan minta operator perbaiki forward. Setiap deploy dicatat di append-only audit log dengan hash-chain. Recovery boundary dipegang oleh durable marker: sebelum marker = recovery otomatis aman; sesudah marker = fail-closed. Safe recovery drills (staging disposable) membuktikan pre-migration recovery + post-migration fail-closed sebelum production.

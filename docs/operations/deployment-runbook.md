# Repeatable Deployment and Environment Provisioning Runbook

| Item | Value |
|---|---|
| Roadmap unit | PH-4 |
| Model | One dedicated Compose project per deployment |
| External service | Web proxy only; TLS at approved host/cloud ingress |
| Internal services | API and PostgreSQL on an internal network |
| Automation | `npm run deploy:validate`, `npm run deploy`, `npm run deploy:smoke` |

## 1. Topology and release artifacts

The generic production topology is:

1. `web`: unprivileged Nginx serving the built SPA, `/healthz`, and same-origin `/api/*` proxying;
2. `api`: non-root Node.js runtime with a persistent `/data/documents` volume;
3. `postgres`: PostgreSQL 16 with a persistent database volume and no published host port;
4. one-shot `migrate`: operations image running the ordered migration stream; and
5. one-shot `sync-permissions`: idempotently granting new permissions to full-access roles.

Files:

- [`infra/deployment/compose.yml`](../../infra/deployment/compose.yml)
- [`apps/api/Dockerfile`](../../apps/api/Dockerfile)
- [`apps/web/Dockerfile`](../../apps/web/Dockerfile)
- [`infra/deployment/nginx.conf`](../../infra/deployment/nginx.conf)
- [`infra/deployment/.env.example`](../../infra/deployment/.env.example)

API/Web releases should be built in CI, pushed, and referenced by immutable SHA-256 image digests. Validation rejects tags, including Git-SHA-shaped tags, because registries can retag them. Do not build a mutable checkout on a production host and do not deploy `latest`. The API Dockerfile exposes distinct `operations` and `runtime` targets. Publish both: `API_OPERATIONS_IMAGE` contains migration, permission-sync, PostgreSQL client, and PH-3 backup/restore tooling; `API_IMAGE` is the smaller non-root runtime. Compose deliberately requires separate immutable references and never runs the operations image as the public API.

## 2. First environment provisioning

1. Provision a supported host with Docker Engine + Compose, TLS ingress, protected environment/backup directories, and off-host backup access.
2. Create a deployment-specific environment file from the example outside source control. Fill secrets from a secret manager and keep permissions `0600`.
3. Build and publish immutable images from the approved commit:

```bash
docker build --target operations -f apps/api/Dockerfile -t registry.example/abixell-one-api-operations:<release> .
```

```bash
docker build --target runtime -f apps/api/Dockerfile -t registry.example/abixell-one-api:<release> .
```

```bash
docker build -f apps/web/Dockerfile -t registry.example/abixell-one-web:<release> .
```

4. Record immutable digests after push and place those references in the environment file.
5. Validate without rendering secrets:

```bash
npm run deploy:validate -- /protected/path/deployment.env
```

6. Deploy:

```bash
npm run deploy -- /protected/path/deployment.env
```

7. Automation acquires a PID-validated, host-global lock keyed by `COMPOSE_PROJECT_NAME`, validates configuration, pulls immutable images, starts/waits for PostgreSQL, and detects whether application tables exist. For an existing deployment it stops Web/API write traffic, creates a complete PH-3 backup labelled with the prior successful `APPLICATION_RELEASE`, then applies migrations, synchronizes full-access roles, starts API/Web, waits for health, runs smoke checks, and records only non-secret release metadata in the deployment state root. PostgreSQL/API use the internal backend network; Web is dual-homed onto that network plus a dedicated ingress network so Docker can publish only the Web port.
8. Point the approved TLS ingress at `WEB_BIND_ADDRESS:WEB_PORT` and verify the public same-origin paths.
9. Bootstrap initial Tenant/admin through the approved protected procedure. Never run `npm run seed` in staging/production.
10. Rotate or restrict the bootstrap secret after initial provisioning according to the deployment's secret-management policy.
11. Take and verify the first backup, then complete an isolated restore drill before Production Gate acceptance.

## 3. Repeatable release deployment

Before every deployment:

- approved commit and CI validation are green;
- image references, including PostgreSQL, are immutable SHA-256 digests;
- release notes include migration compatibility;
- protected `BACKUP_ROOT` is writable and off-host retention is operational; the deployment command quiesces Web/API writes and creates a fresh complete pre-migration set whenever application tables already exist;
- the prior successful state exists in the host-global state root so the backup is labelled with the release it actually captures;
- single-quote environment values containing a literal `$`, and require `deploy:validate` to compare them with the rendered Compose model;
- only one operator/automation run holds the deployment lock for this `COMPOSE_PROJECT_NAME`; and
- `SCHEDULER_DISABLED=false` is set on exactly one API process.

Use the same command as provisioning:

```bash
npm run deploy -- /protected/path/deployment.env
```

On staging this command is invoked by the CD pipeline over SSH (§9) rather than typed by an operator; the VPS wrapper runs exactly this invocation against the protected environment file. Manual execution remains the fallback for production or when CD is unavailable.

Migration and permission sync are safe to rerun: `node-pg-migrate up` applies only pending files, and permission sync adds only missing grants. Running the same immutable release again should therefore be an operational no-op apart from health verification.

## 4. Build, migrate, and start order

The required order is intentionally fixed:

1. build/test and publish immutable API/Web images;
2. validate deployment environment and Compose model;
3. pull artifacts before changing running services;
4. ensure PostgreSQL is healthy;
5. when an existing deployment is present, stop Web/API write traffic and create/verify a backup labelled with the prior successful release;
6. run ordered forward migrations;
7. run full-access permission sync;
8. replace/start API;
9. wait for API `/health/db` readiness;
10. replace/start Web proxy;
11. run Web, API liveness, and database-readiness smoke;
12. record deployment evidence.

Do not start an API image against an older incompatible schema. Do not run demo seed as part of this sequence.

## 5. Health verification

The smoke command checks through the same-origin Web proxy:

- `/healthz` — static Web/proxy liveness;
- `/api/health` — API liveness; and
- `/api/health/db` — API database readiness.

Run it independently after ingress/network changes:

```bash
npm run deploy:smoke -- /protected/path/deployment.env
```

For a remote TLS ingress, set `DEPLOYMENT_SMOKE_ORIGIN=https://approved-host` without placing client-specific hostnames in source.

The smoke command is release-aware. Pass `--expected-release=<APPLICATION_RELEASE>` (or set `APPLICATION_RELEASE` in the environment) and smoke asserts that `/api/health` reports the exact expected release string, not merely `status === "ok"`. This prevents a healthy prior release from satisfying a new deployment's smoke gate: the API exposes `process.env.APPLICATION_RELEASE` at `/api/health`, and a release mismatch fails the deployment even if the old service is otherwise healthy. The automated deploy pipeline always passes `--expected-release` during both initial smoke and pre-migration recovery smoke.

Production acceptance also verifies authentication with a non-demo account, representative read paths, document upload/download, Scheduler job visibility, and no cross-Tenant access.

## 6. Failure and recovery boundary

The deployment is divided by a **durable migration-started marker**. Before the marker is written, any failure triggers automatic recovery of the prior successful release. Once the marker is written, the deployment is fail-closed: operator decisions drive recovery, never automation.

### Validation or image pull failure

No running service is changed. Correct the environment/reference and retry.

### Pre-migration phase failure (before `migrationStarted` marker)

Failures in quiesce, backup, or image verification — before the durable marker is written — trigger automatic pre-migration recovery:

1. Stop the failed deployment.
2. Read the prior successful deployment state from `last-success.json` (immutable images, release string, timestamps).
3. Start the prior API/Web images against the existing (unchanged) database.
4. Wait for services and run smoke expecting the **prior** `APPLICATION_RELEASE`.
5. If recovery smoke passes, exit with code 1 (indicating recovery occurred, not new deployment success) and record `PRE_MIGRATION_RECOVERY` outcome in the audit log. The previous release remains running.
6. If recovery fails or prior state is missing, exit fail-closed (operator must intervene).

Pre-migration recovery is safe because:
- The database has not been mutated (no migrations have run).
- The prior release was recently proven healthy (recorded in `last-success.json`).
- Web/API write traffic was already quiesced before the failure occurred.

### Migration, permission-sync, or post-migration smoke failure

Once the durable `migrationStarted` marker is written, **no automatic recovery occurs**. Stop the deployment:

1. Web/API are stopped; the database has been migrated and is not automatically rolled back.
2. Preserve logs, the pre-migration backup, and post-migration state for investigation.
3. Do not automatically run `migrate:down` (schema reversal is an explicit operator decision, not automation).
4. Operator determines whether the schema change was transactional (safe to retry), requires a forward repair, or requires a complete restore from the pre-migration backup.
5. Redeploy the same or a corrected release once fixed.

**Rationale:** After a migration has run and committed, the database state is no longer guaranteed to match any previous release. Rolling back API images blindly against a forward-migrated schema causes data corruption. Schema reversal, if needed, is a separate reviewed decision outside the deployment automation.

### Scheduler ownership

Scheduler execution is fenced by a renewable PostgreSQL lease, and durable Integration outbox claims have their own token-fenced leases. Still designate one timer owner to avoid redundant polling and conflict noise. Additional API replicas set `SCHEDULER_DISABLED=true`. If ownership changes, disable the old owner before enabling the new one; the database lease remains the cross-replica safety boundary.

## 7. Evidence checklist

- [ ] CI commit and validation result.
- [ ] API/Web/PostgreSQL immutable references.
- [ ] Environment class (`staging`/`production`) without client secret values.
- [ ] `deploy:validate` PASS.
- [ ] Migration head and permission-sync result.
- [ ] PostgreSQL, API, Web health PASS, with `/api/health` release matching the expected `APPLICATION_RELEASE`.
- [ ] Repeated same-release deployment PASS/idempotent.
- [ ] Backup ID and restore-drill evidence.
- [ ] Audit log records every phase transition with a valid hash chain and no secret values.
- [ ] Recovery boundary decision recorded (pre-migration recovery vs post-migration fail-closed) with the `migrationStarted` marker state at the point of any failure.
- [ ] Operator/reviewer and timestamps.
- [ ] No Advanced, client-extension, or client-specific deployment customization mixed into the release.

## 8. Scope and security boundaries

This automation preserves dedicated deployment per client while keeping architecture multi-Tenant-ready. It does not choose a client host, cloud provider, ingress, certificate, data residency, or integration credential. Those values are deployment configuration outside source. SSO/MFA, business modules, Advanced waves, and client extensions are not part of PH-4.

## 9. Continuous deployment over SSH (staging)

Staging deployment is automated via GitHub Actions ([`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)), triggered by a successful `Build and Push Images` run on `master` or by manual `workflow_dispatch` with an explicit build run ID. The VPS stays clean: GitHub Actions holds the deploy key and renders the environment; no CI credentials or build tooling live on the VPS.

Protocol:

1. The workflow resolves the triggering (or operator-supplied) build run ID and verifies its provenance via the GitHub API: conclusion `success`, workflow name `Build and Push Images`, and head branch `master` or a version tag. A `workflow_dispatch` input that points at a cancelled, failed, or unrelated run is rejected before any artifact is trusted.
2. It downloads the `image-digests` artifact from that exact run (pinned `actions/download-artifact` SHA) and strictly parses required digest fields; tags and malformed digests are rejected.
3. It renders a complete staging environment file ([`infra/deployment/render-env.mjs`](../../infra/deployment/render-env.mjs)) from the `.env.example` template, the parsed digests, and the `staging` GitHub Environment's secrets/variables, then validates it locally (`deploy:validate`) without ever printing its contents.
4. It configures OpenSSH with a dedicated deploy key (`secrets.DEPLOY_SSH_KEY`), a dedicated checkout-sync key (`secrets.DEPLOY_SSH_KEY_SYNC`, step 5 below), and a **pinned** `known_hosts` entry (`secrets.VPS_HOST_KEY`, captured by the operator during VPS bootstrap via `ssh-keyscan`) — not trust-on-first-use. Both keys share that one pinned host entry.
5. Before touching the deploy wrapper, it syncs the VPS checkout to the exact commit the verified build run was built from (`head_sha`, extracted and format-validated — 40 lowercase hex — from the same provenance check in step 1). It pipes that commit SHA over stdin to a second, separate forced-command script on the VPS (`/usr/local/sbin/abixell-staging-checkout-sync`, [ADR-0025](../adr/0025-vps-checkout-sync.md)), bound to the sync key on its own `authorized_keys` line. The sync script re-validates the SHA independently, confirms the checkout's remote origin is the expected repository, fetches (read-only), confirms the commit is reachable from `origin/master` or tagged by origin, then checks it out (`git checkout --detach`, no `--force`/`--hard`). If this step fails, the workflow fails immediately and the deploy step below never runs — this closes the gap where the deploy wrapper (step 6) would otherwise execute the fixed deploy command against whatever stale code happened to be checked out.
6. It pipes the rendered environment over stdin to a static, forced-command SSH wrapper on the VPS (`/usr/local/sbin/abixell-staging-deploy-wrapper`). The wrapper is the only command the deploy key can execute (`restrict,no-pty,...,command="..."` in `authorized_keys`); arbitrary SSH commands are rejected by SSH itself before the wrapper runs. The wrapper validates the stdin protocol, atomically replaces the protected environment file, and runs the fixed `node infra/deployment/deploy.mjs /protected/staging.env` invocation against the checkout just synced in step 5. Its exit code is the deployment outcome.
7. The workflow always shreds its local temp environment file and removes both SSH keys from the runner, on every exit path.
8. `concurrency: group: staging-deploy, cancel-in-progress: false` serializes staging deploys; a second trigger while one is running queues rather than racing it.

No secret value is ever written to workflow logs, job summaries, artifacts, or the audit log (see §10); only non-secret release metadata (run ID, source commit, release string, image digests, outcome) appears in the job summary.

### 9.1 VPS bootstrap: installing the checkout-sync script and key

One-time, operator-performed, alongside the existing deploy-wrapper bootstrap. Skipping this step reproduces the gap ADR-0025 closes: the checkout will never update itself.

1. Install the script (reference source: [`infra/deployment/vps/abixell-staging-checkout-sync`](../../infra/deployment/vps/abixell-staging-checkout-sync)):

   ```bash
   sudo install -o root -g root -m 0755 \
     infra/deployment/vps/abixell-staging-checkout-sync \
     /usr/local/sbin/abixell-staging-checkout-sync
   ```

2. Generate a dedicated key pair for the sync capability (do not reuse the deploy key — sshd binds one forced command per `authorized_keys` line):

   ```bash
   ssh-keygen -t ed25519 -f abixell-vps-sync -N "" -C "abixell-staging-checkout-sync"
   ```

3. Add the public half as its own line in the `deploy` user's `authorized_keys`, restricted to the sync script only:

   ```text
   restrict,no-pty,no-agent-forwarding,no-port-forwarding,no-X11-forwarding,command="/usr/local/sbin/abixell-staging-checkout-sync" ssh-ed25519 AAAA... abixell-staging-checkout-sync
   ```

4. Store the private half as the `DEPLOY_SSH_KEY_SYNC` secret in the `staging` GitHub Environment. The existing `VPS_HOST_KEY` pinned `known_hosts` secret is reused unchanged — both keys connect to the same host.

5. Verify in isolation before the next scheduled deploy: pipe a known-good commit SHA from `master` over the sync key and confirm `Checkout sync to <sha> PASS`; then pipe a malformed value and a commit not reachable from `master`/tags, and confirm both are rejected without changing the checkout (see ADR-0025 evidence checklist).

## 10. Deployment audit log

Every deployment phase transition is appended to a JSON Lines audit log (`deploy-audit.log`, mode `0600`, append-only, never truncated/rotated/deleted by deployment tooling) in the deployment state root. Each record carries:

```json
{
  "timestamp": "2026-10-13T12:00:00.000Z",
  "deploymentId": "<uuid>",
  "phase": "PRE_MIGRATION_BACKUP",
  "outcome": "succeeded",
  "applicationRelease": "...",
  "previousRecordHash": "...",
  "recordHash": "..."
}
```

Records are hash-chained (`recordHash` depends on the record content and `previousRecordHash`) for tamper evidence, and values matching secret/credential patterns are redacted before a record is written. Key phases: `DEPLOYMENT_ACCEPTED`, `VALIDATING`, `IMAGE_VERIFICATION`, `PRE_FLIGHT_CHECKS_PASSED`, `PULLING_IMAGES`, `SCANNING_IMAGES`, `POSTGRES_READY`, `QUIESCING`, `PRE_MIGRATION_BACKUP`, `MIGRATION_STARTED`, `MIGRATING`, `PERMISSION_SYNC`, `RELEASE_STARTED`, `RELEASE_SMOKE`, `SUCCESS_RECORDED`, `DEPLOYMENT_SUCCEEDED`, `PRE_MIGRATION_RECOVERY`, `DEPLOYMENT_FAILED`. The `migrationStarted` field on failure records distinguishes recoverable pre-migration failures from fail-closed post-migration failures per §6.

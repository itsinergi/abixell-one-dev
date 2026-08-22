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

Production acceptance also verifies authentication with a non-demo account, representative read paths, document upload/download, Scheduler job visibility, and no cross-Tenant access.

## 6. Failure and rollback

### Validation or image pull failure

No running service is changed. Correct the environment/reference and retry.

### Migration failure

Stop deployment. Web/API remain quiesced; preserve logs and the pre-migration backup. Do not start the new API and do not automatically run `migrate:down`. Determine whether the failed migration was transactional/no-op; if data changed, use an approved forward repair or PH-3 restore procedure. Reopening the old release is an explicit compatibility/recovery decision, not an automatic step.

### API/Web startup or smoke failure

1. Keep public traffic on the previous healthy release where the ingress/runtime permits.
2. Inspect service logs without publishing secrets.
3. If schema compatibility is explicitly backward-compatible, restore the prior immutable API/Web image references and rerun deployment/smoke.
4. If compatibility is not guaranteed, do not image-roll back blindly. Recover the matching database/documents via the backup/restore runbook or apply an approved forward fix.

Application rollback and database rollback are different decisions. The automation never invokes `migrate:down`.

### Scheduler ownership

Scheduler execution is fenced by a renewable PostgreSQL lease, and durable Integration outbox claims have their own token-fenced leases. Still designate one timer owner to avoid redundant polling and conflict noise. Additional API replicas set `SCHEDULER_DISABLED=true`. If ownership changes, disable the old owner before enabling the new one; the database lease remains the cross-replica safety boundary.

## 7. Evidence checklist

- [ ] CI commit and validation result.
- [ ] API/Web/PostgreSQL immutable references.
- [ ] Environment class (`staging`/`production`) without client secret values.
- [ ] `deploy:validate` PASS.
- [ ] Migration head and permission-sync result.
- [ ] PostgreSQL, API, Web health PASS.
- [ ] Repeated same-release deployment PASS/idempotent.
- [ ] Backup ID and restore-drill evidence.
- [ ] Rollback/recovery compatibility decision recorded.
- [ ] Operator/reviewer and timestamps.
- [ ] No Advanced, client-extension, or client-specific deployment customization mixed into the release.

## 8. Scope and security boundaries

This automation preserves dedicated deployment per client while keeping architecture multi-Tenant-ready. It does not choose a client host, cloud provider, ingress, certificate, data residency, or integration credential. Those values are deployment configuration outside source. SSO/MFA, business modules, Advanced waves, and client extensions are not part of PH-4.

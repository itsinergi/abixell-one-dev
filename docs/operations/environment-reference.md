# Staging and Production Environment Reference

This is the generic environment contract for one dedicated Abixell One deployment. No client identity, domain, credential, or hosting-provider value belongs in source control. Copy [`infra/deployment/.env.example`](../../infra/deployment/.env.example) to a protected deployment environment file outside the repository or populate equivalent values through a secret manager.

## Required values

| Variable | Secret | Requirement |
|---|---|---|
| `DEPLOYMENT_ENVIRONMENT` | No | `staging` or `production`. |
| `COMPOSE_PROJECT_NAME` | No | Unique per dedicated deployment; generic environment identifier, not source-code configuration. |
| `API_IMAGE` | No | Immutable API runtime image SHA-256 digest; tags are rejected. |
| `API_OPERATIONS_IMAGE` | No | Immutable API `operations` image SHA-256 digest containing migration, permission-sync, and recovery tooling. |
| `WEB_IMAGE` | No | Immutable Web image SHA-256 digest; tags are rejected. |
| `POSTGRES_IMAGE` | No | Immutable PostgreSQL 16 image SHA-256 digest; tags alone are rejected. |
| `POSTGRES_USER` | No | Deployment-local database role. |
| `POSTGRES_PASSWORD` | Yes | Random secret; URL-encode separately inside `DATABASE_URL`. |
| `POSTGRES_DB` | No | Deployment-local database name. |
| `DATABASE_URL` | Yes | PostgreSQL URL using Compose host `postgres`, never a public host port. |
| `JWT_ACCESS_SECRET` | Yes | At least 32 random characters, unique per deployment. |
| `PLATFORM_BOOTSTRAP_KEY` | Yes | At least 32 random characters, unique per deployment. Rotate/remove access after initial bootstrap where operationally possible. |
| `CORS_ORIGINS` | No | Comma-separated exact approved frontend origins; no wildcard or localhost in staging/production. |

## Tunable values

| Variable | Default | Note |
|---|---:|---|
| `LOG_LEVEL` | `info` | Raise temporarily for diagnosis; avoid logging sensitive payloads. |
| `RATE_LIMIT_GLOBAL_MAX` | `1200` | Requests per window; tune from observed dedicated-deployment traffic. |
| `RATE_LIMIT_WINDOW` | `1 minute` | Fastify rate-limit window. |
| `AUTH_RATE_LIMIT_MAX` | `10` | Login attempts per window and IP. |
| `AUTH_RATE_LIMIT_WINDOW` | `1 minute` | Login window. |
| `WEB_BIND_ADDRESS` | `127.0.0.1` | Keep loopback when a host ingress terminates TLS. Use `0.0.0.0` only with an approved firewall/ingress design. |
| `WEB_PORT` | `8080` | Host ingress target. Only the Web proxy is published. |
| `SCHEDULER_DISABLED` | `false` | Exactly one API process must own in-process Scheduler timers. Set `true` on additional API replicas. |
| `INTEGRATION_OUTBOX_BATCH_SIZE` | `100` | Due deliveries claimed per batch and Tenant. |
| `INTEGRATION_OUTBOX_MAX_ATTEMPTS` | `5` | Terminal-failure threshold. |
| `INTEGRATION_OUTBOX_RETRY_BASE_SECONDS` | `30` | Exponential retry base. |
| `INTEGRATION_OUTBOX_CLAIM_TIMEOUT_SECONDS` | `300` | A processing claim older than this is recovered as interrupted. |

The API container fixes `FILE_STORAGE_ROOT=/data/documents` and mounts a persistent deployment-local document volume there. The operations image contains PostgreSQL 16 clients, `tar`, and the PH-3 scripts. The Compose `backup` service mounts that same document volume read-only and writes complete sets to the protected host `BACKUP_ROOT`; the manifest records `APPLICATION_RELEASE` and the immutable API/operations/Web image identities. Existing deployments stop Web/API write traffic and take a verified-script pre-migration backup labelled with the prior successful release before migration. Restore uses the separate [`compose.restore.yml`](../../infra/deployment/compose.restore.yml) and [`.env.restore.example`](../../infra/deployment/.env.restore.example), its own isolated PostgreSQL named volume and document target, immutable `RESTORE_POSTGRES_IMAGE`/`RESTORE_OPERATIONS_IMAGE`/`RESTORE_API_IMAGE`/`RESTORE_WEB_IMAGE`, exact `RESTORE_APPLICATION_RELEASE`, and mandatory service-DNS health URLs; see the backup/restore runbook.

## Secret and file rules

- Keep environment files mode `0600` or stricter on POSIX hosts.
- Never run `docker compose config` into a ticket or shared log; rendered output may include secrets. `deploy:validate` uses quiet validation.
- Never reuse development/demo credentials, `Admin12345!`, or values containing `replace-`, `change-me`, `dev-only`, or `abixell_dev_password`.
- Rotate secrets per deployment. A compromise or client offboarding does not rotate any other deployment.
- Single-quote protected environment values containing a literal `$`. Validation compares the parsed values with the rendered Compose model and rejects interpolation changes.
- The deployment lock/state root defaults to a host-global location keyed by `COMPOSE_PROJECT_NAME` (`/var/lock/abixell-one` on POSIX, `%ProgramData%/AbixellOne/deployments` on Windows). If `DEPLOYMENT_STATE_ROOT` is overridden, every checkout/automation path for that deployment must use the same protected host-global root.
- TLS is terminated by the approved host/cloud ingress. Only Web is published and dual-homed onto a dedicated ingress network; API and PostgreSQL remain exclusively on the internal backend network.
- Do not run the demo seed in staging or production. Bootstrap the first Tenant using the protected platform flow, then run permission sync after every migration.

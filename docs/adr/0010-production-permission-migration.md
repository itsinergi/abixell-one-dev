# ADR-0010: Production Permission Migration via `is_full_access` Role Sync

- **Status:** APPROVED for Checkpoint 0F
- **Date:** 2026-08-18
- **Source:** Recurring gap flagged in `docs/decision-log.md`/
  `docs/implementation-notes.md` at the end of Checkpoints 0C, 0D, and
  0E — three checkpoints in a row where a new Product Core migration
  added permission codes, and the only way demonstrated to get them onto
  an existing Role was delete-and-reseed the demo Tenant, each time
  documented explicitly as "khusus demo/dev, bukan pola migrasi
  produksi".

## Context

Product Core evolves: 0C added `config.*` permissions, 0D added
`workflow.*`, 0E added `notification.*`/`document.*`/`scheduler.*`/
`integration.*`/`observability.*`. Every time, a NEW permission code
appearing in the `permissions` catalog (via migration) does not
retroactively appear in any existing Role's `role_permissions` grants —
by design, since a Tenant's Roles are decided by that Tenant's
Configuration, not dictated by Product Core. For a demo/dev tenant with
no real data to protect, deleting and reseeding is a fine shortcut. For
a LIVE production tenant — the state every pilot client tenant will be
in starting Phase 1 — deleting and reseeding means deleting real Users,
real Workflow history, real Documents. That is not an acceptable
migration strategy, and every checkpoint said so explicitly rather than
letting the pattern silently stand as "how it's done".

Three options were considered:

1. **Do nothing** — leave it as a manual, tenant-by-tenant task (a human
   runs `INSERT INTO role_permissions ...` by hand after every Product
   Core migration). Works, but error-prone and non-repeatable, and still
   the practice actually followed in dev is reseed, which is the exact
   anti-pattern flagged as dangerous.
2. **Fully automatic sync for every Role** — whenever a new permission
   appears, grant it to every Role that currently holds "most"
   permissions, using some heuristic (e.g. >80% of existing permissions).
   Rejected: which permissions a curated Role should get is a genuine
   business decision (should a `SUPERVISOR` Role automatically gain
   `scheduler.manage`? No — that's not implied by anything), and a
   heuristic here would silently over-grant access, which is a security
   regression, not a fix.
3. **Explicit opt-in `is_full_access` flag on Role** — a Role can declare
   "my intent is to always hold every permission that exists" (the
   natural shape of a platform Administrator role). Only Roles with this
   flag participate in an idempotent, additive-only sync.

## Decision

Option 3. `roles.is_full_access boolean NOT NULL DEFAULT false` (migration
`1756000000000_phase0-stabilization`). `scripts/sync-role-permissions.ts`
(new, `npm run sync-permissions -w apps/api`) runs:

```sql
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
  WHERE r.is_full_access = true
ON CONFLICT DO NOTHING
```

Additive only (`ON CONFLICT DO NOTHING` — never deletes an existing
grant), idempotent (safe to run any number of times; a no-op once
everything is in sync, reports `0 new grants` rather than erroring), and
safe against a live Tenant's real data (touches only `role_permissions`
rows, never `users`, `workflow_*`, `documents`, or any business data).

The demo seed's `ADMIN` Role is now created with `is_full_access = true`
(`apps/api/scripts/seed.ts`), replacing its dependence on the reseed
pattern. Verified end-to-end in this checkpoint: one permission grant
was manually removed from the demo tenant's ADMIN Role, the sync script
was run, and the grant was restored — with `0 new grants` reported on
a second run, confirming idempotency.

Curated (non-full-access) Roles are explicitly OUT of scope for this
mechanism — a new permission being relevant to `SUPERVISOR`, `REVIEWER`,
or any future curated Role remains a deliberate decision an
Administrator makes through the RBAC administration surface, not
something this script decides on their behalf.

## Consequences

- **Resolves the specific, repeated risk** ("Reseed tenant demo ...
  pola ketiga kalinya berturut-turut") — future Product Core permission
  additions no longer require choosing between "stale ADMIN Role" and
  "delete a live Tenant's data" for the common Administrator-role case.
- **Does not solve permission migration for curated Roles.** A Tenant
  whose `SUPERVISOR` Role should gain a new permission still needs a
  human decision, made through the existing role/permission
  administration path — this ADR intentionally does not build automation
  for a decision that isn't mechanical.
- **Operational step, not automatic.** `sync-permissions` must be run
  once per deployment after `npm run migrate` whenever a migration adds
  new permission codes — it is not wired into the migration itself
  (kept as a separate, explicit, auditable step, the same posture as
  `npm run seed` already had).
- **No RBAC administration UI exists yet to toggle `is_full_access`** on
  a Role after creation — currently set only at Role-creation time (seed
  or a future "create Role" endpoint would need to accept it). Tracked
  in the Checkpoint 0F Technical Debt Register as a Future Enhancement,
  not a blocker — the flag defaults to `false`, so no Role is
  accidentally over-privileged by its absence.

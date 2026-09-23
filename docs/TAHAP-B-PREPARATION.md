# Tahap B Preparation: Lifecycle & Soft-Delete Contract for Administration Domains

**Date:** 2026-09-22
**Status:** FOUNDER-APPROVED PREPARATION — Implementation Not Authorized
**Scope:** Read-only analysis. This document proposes a contract. It does not authorize implementation.

> **Correction notice (2026-09-22).** An earlier revision of this document contained
> claims that do not match the code. Those claims have been replaced with verified
> findings, each carrying a `file:line` citation. Every item still marked PROPOSAL or
> OPEN is undecided and must not be treated as agreed. See
> [Corrections to the Previous Revision](#corrections-to-the-previous-revision) and
> [Partial Implementation Artifacts Already on Disk](#partial-implementation-artifacts-already-on-disk).

---

## Executive Summary

Tahap A standardized read-only UI/UX for eight Administration panels using only existing
backend operations. Tahap B adds an approved preparation contract for **active/inactive
lifecycle** on Organization Units, Legal Entities, Users, and Reference Data, plus
**soft-delete only for Users**. Organization Units and Legal Entities are never deleted.

Three things narrow the scope compared to the earlier revision:

1. **Authentication lifecycle is already done.** Login, refresh, and per-request access-token
   validation all reject inactive and deleted users today. No auth work is required.
2. **Reference-data toggle is already done below the HTTP layer.** The table column, the
   repository method, the service method, the permission gate, and the audit record all
   exist. Only the route and the web client method are missing.
3. **The remaining real work is OU, LE, and User lifecycle** — schema, domain, repository,
   service, routes, tests, then UI.

---

## Current Backend State (Verified)

### Organization Units

**Entity** — `apps/api/src/domain/organization-unit/organization-unit.entity.ts`
- Committed shape: `id`, `tenantId`, `legalEntityId`, `parentId`, `name`, `unitType`,
  `createdAt`, `updatedAt`.
- No activation flag. `deleted_at` / `deleted_by` exist in the schema and are filtered by
  the repository, but are not exposed on the domain contract.
- The working tree currently contains uncommitted edits to this file. See
  [Partial Implementation Artifacts Already on Disk](#partial-implementation-artifacts-already-on-disk).

**Service** — `apps/api/src/application/organization-unit/organization-unit.service.ts`
- Methods: `create()`, `listForTenant()`.
- No update, activate, deactivate, or delete.
- `listForTenant()` filters visibility with an in-memory ancestor walk
  (`organization-unit.service.ts:54-82`).

**Routes** — `apps/api/src/interfaces/http/routes/organization-units.ts:12-25`
- `POST /organization-units`, `GET /organization-units`. Nothing else.

**Repository** — `apps/api/src/infrastructure/persistence/repositories/organization-unit.repository.pg.ts`
- `create`, `findById`, `listByTenant`, `listAncestorIds`. All reads filter `deleted_at IS NULL`.
- `listAncestorIds` is a recursive CTE, tenant-bounded (`organization-unit.repository.pg.ts:62-81`).
- `mapRow` (lines 9-20) returns only the committed field set.

**Schema** — migration `1755600000000_identity-organization-rbac-audit.cjs`
- `id`, `tenant_id`, `legal_entity_id`, `parent_id`, `name`, `unit_type`, `created_by`,
  `created_at`, `updated_by`, `updated_at`, `deleted_by`, `deleted_at`.
- Indexed on `tenant_id` and `parent_id`.

### Legal Entities

**Entity** — `apps/api/src/domain/legal-entity/legal-entity.entity.ts`
- Committed shape: `id`, `tenantId`, `name`, `registrationNo`, `createdAt`, `updatedAt`.
- No activation flag. This file also has uncommitted edits in the working tree.

**Service** — `apps/api/src/application/legal-entity/legal-entity.service.ts`
- Methods: `create()`, `listForTenant()`.

**Routes** — `apps/api/src/interfaces/http/routes/legal-entities.ts:10-23`
- `POST /legal-entities`, `GET /legal-entities`.

**Repository** — `apps/api/src/infrastructure/persistence/repositories/legal-entity.repository.pg.ts:20-51`
- `create`, `findById`, `listByTenant`. All reads filter `deleted_at IS NULL`.

### Users

**Entity** — `apps/api/src/domain/identity/user.entity.ts`
- `id`, `tenantId`, `email`, `fullName`, `status`, `createdAt`, `updatedAt`.
- `status TEXT` already exists and **is** enforced for lifecycle control at the
  authentication boundary (see below). It is not yet mutable through any route.
- This file is **unmodified** in the working tree.

**Service** — `apps/api/src/application/identity/user.service.ts`
- `createWithRole()`, `listForTenant()`.
- `createWithRole()` already refuses to grant a scope wider than the actor holds, and
  handles customer-scope assignment.

**Routes** — `apps/api/src/interfaces/http/routes/users.ts:16-29`
- `POST /users`, `GET /users`.

**Repository** — `apps/api/src/infrastructure/persistence/repositories/user.repository.pg.ts:34-60`
- `create`, `findById`, `findByEmailInTenant`, `listByTenant`. Reads filter `deleted_at IS NULL`;
  they do **not** filter `status`, which is correct — status is enforced at the auth boundary
  and in the authorization view, not in the admin listing.

**Authentication & token behavior — ALREADY IMPLEMENTED, no Tahap B work required:**

| Path | Behavior | Evidence |
|---|---|---|
| Login | Rejects any user whose `status !== "active"` | `auth.service.ts:73` |
| Refresh | If the user is missing or not active, **all** refresh tokens for that user are revoked and the refresh fails | `auth.service.ts:104-127` |
| Every authenticated request | The actor row is re-fetched and re-checked (`deleted_at IS NULL`, `status = 'active'`, tenant match) on every call; a single generic 401 hides which check failed | `auth-plugin.ts:49-56` |

The earlier revision of this document listed this as a gap. It is not a gap.

Separately, the authorization view `authorization_effective_user_role_assignments` already
joins `users` with `u.deleted_at IS NULL AND u.status = 'active'`
(`1775000000000_phase-11f-stale-scope-invalidation.cjs:238-241`). A deactivated user
therefore loses effective role assignments automatically, with no extra code.

### Reference Data (Configuration)

The real schema is **two tables**, not one flat table:

- `reference_data_types` — global catalog: `id`, `code` (unique), `name`, `description`, `created_at`
  (`1755700000000_configuration-metadata-foundation.cjs:137-143`).
- `tenant_reference_data_items` — tenant rows: `id`, `tenant_id`, `reference_data_type_id`,
  `code`, `label`, `sort_order`, **`is_active BOOLEAN NOT NULL DEFAULT true`**, `created_by`,
  `created_at`, `updated_by`, `updated_at`, unique on `(tenant_id, reference_data_type_id, code)`
  (`1755700000000_configuration-metadata-foundation.cjs:145-162`).

**`is_active` already exists.** No migration is needed for reference data.

**Service** — `configuration.service.ts:292-331` already implements:
- `setReferenceDataItemActive(actor, typeCode, itemId, isActive)` gated on `config.manage`,
- `setReferenceDataItemActiveForTrustedCaller(...)` for module callers that already authorized,
- a shared internal path that throws `NotFoundError` and records the audit action
  `config.reference_data_item.activated` / `.deactivated`.

**Routes** — `config.ts:111-148` has `GET /config/reference-data-types`,
`GET /config/reference-data/:typeCode`, `POST /config/reference-data/:typeCode`.
**The toggle route is the only missing piece.**

---

## Proposed Lifecycle Contract

### Organization Units & Legal Entities

#### State machine (DECIDED)

```
ACTIVE     --[deactivate]--> INACTIVE
INACTIVE   --[activate]----> ACTIVE
```

Organization Units and Legal Entities are **never deleted**, physically or through
soft-delete. Their rows remain available for historical and audit purposes.

#### Permissions (DECIDED)

```
organization_unit.update      edit name / unitType
organization_unit.activate    INACTIVE -> ACTIVE
organization_unit.deactivate  ACTIVE   -> INACTIVE

legal_entity.update            edit name / registrationNo
legal_entity.activate          INACTIVE -> ACTIVE
legal_entity.deactivate        ACTIVE   -> INACTIVE
```

There are no `organization_unit.delete` or `legal_entity.delete` operations in Tahap B.

#### Immutable fields

- `parentId` on Organization Units — no reparenting.
- `legalEntityId` on Organization Units.
- `tenantId` on both.

### Users

#### State machine (PROPOSAL)

```
ACTIVE   --[deactivate]--> INACTIVE      (users.status)
INACTIVE --[activate]----> ACTIVE
any      --[soft-delete]-> DELETED       (deleted_at set; physical delete is never permitted)
```

#### Account editing and permissions

**DECIDED:** authorized roles may edit the user's name, email, and password. The stable
user identifier (`users.id`, referred to as `user_id` in the interview) cannot be changed.
This decision does not permit tenant reassignment or bypassing separate lifecycle actions.

Permission separation is approved; the exact granular account-edit codes below are a
**technical proposal**, not separately approved names:

```
user.update           edit fullName only
user.email.update     change email
user.password.reset   set a replacement password
user.activate         INACTIVE -> ACTIVE
user.deactivate       ACTIVE   -> INACTIVE
user.delete           soft-delete only (retained proposal)
```

The earlier blanket `user.update` proposal must not grant email/password changes by itself.
Each supplied field must pass its corresponding permission check. The final permission
catalog must be reconciled before implementation; the old twelve-code catalog is obsolete.

**Security requirements for the proposed credential-edit implementation:** passwords are
write-only, hashed before persistence, and never returned or recorded in audit payloads
(including hashes). Audit records identify the actor, target, action, and outcome without
recording the password. Email uniqueness and normalization must match existing identity
rules. Email verification and session revocation following email/password changes still
need a concrete security contract; they were not decided in the interview. Existing
inactive-user authentication protections do not settle these new credential-edit behaviors.

#### Self-deactivation ban and last-admin protection

Both are required. The concrete precedent already in the codebase is
`PgRbacRepository.removeGovernedRoleAssignment` (`rbac.repository.pg.ts:490-517`), which:

- refuses the operation when the actor is the target (self-removal ban), and
- counts the **remaining** distinct users who hold `user.role.manage` at tenant scope
  via `authorization_effective_user_role_assignments`, excluding the target, and refuses
  when that count reaches zero.

The count is **capability-based, not role-name-based** — it asks who still holds the
managing permission, not who is called "admin". Tahap B should reuse exactly this shape.
Because the view already excludes deleted and non-active users, the count does not need
its own status filter.

#### Authentication & tokens

No change required. Deactivating a user is already sufficient to (a) block login,
(b) fail and mass-revoke refresh tokens on next use, and (c) reject every in-flight access
token on its next request. Explicitly revoking refresh tokens inside the deactivate
transaction is still worth doing as defence in depth, but it is an addition, not a fix.

### Reference Data

#### Missing route (PROPOSAL)

```
PATCH /config/reference-data/:typeCode/:itemId
{ "isActive": boolean }
```

Delegates straight to the existing `ConfigurationService.setReferenceDataItemActive`.
Permission `config.manage` and the audit record are already enforced inside that service.
Note the path parameter is the item **id** (a UUID), matching the existing service
signature — not the item code.

Also needed: one client method in `apps/web/src/lib/api.ts`.

---

## Migration Design (PROPOSAL)

### Convention

The project convention for an activation flag is **`is_active BOOLEAN NOT NULL DEFAULT true`**
(used by `service_definitions`, `positions`, `items`, `suppliers`, `finance_accounts`,
`integration_endpoints`, and `tenant_reference_data_items`). Users remain the established
exception, keeping `status TEXT`.

The earlier revision proposed `status TEXT` for OU and LE. That is inconsistent with the
codebase and should not be used.

### Columns

```sql
-- organization_units (activation only; existing deleted_at is historical legacy data,
-- not a new user-facing delete operation)
ADD COLUMN is_active       BOOLEAN NOT NULL DEFAULT true;
ADD COLUMN deactivated_at  TIMESTAMPTZ;
ADD COLUMN deactivated_by  UUID;

-- legal_entities (activation only; same historical-data rule)
ADD COLUMN is_active       BOOLEAN NOT NULL DEFAULT true;
ADD COLUMN deactivated_at  TIMESTAMPTZ;
ADD COLUMN deactivated_by  UUID;

-- users   (status TEXT already exists; user soft-delete remains allowed)
ADD COLUMN deactivated_at  TIMESTAMPTZ;
ADD COLUMN deactivated_by  UUID;
```

`deactivated_at` is kept separate from `deleted_at` so that "paused" and historical
records stay distinguishable in queries and in the audit trail. No new OU/LE soft-delete
path is to be implemented.

**No reference-data migration.** `tenant_reference_data_items.is_active` already exists.

### Migration file

A migration file **already exists on disk** at
`apps/api/migrations/1785000000000_tahap-b-lifecycle-soft-delete.cjs`. It is untracked and
**has not been run**. See
[Partial Implementation Artifacts Already on Disk](#partial-implementation-artifacts-already-on-disk).

### Backfill

Every existing row becomes `is_active = true`, `deactivated_at = NULL`,
`deactivated_by = NULL` by column default. No data correction step is required.

---

## Soft-Delete and Deactivation Guards

Most guards below are now **DECIDED** per the preparation interview. A few remain **PROPOSAL**
and are deferred to implementation phase. These deferred items do not block approval or
beginning implementation; they are settled in code review before merge.

### Organization Unit

1. **Child units on deactivation (DECIDED).** A parent must not be deactivated while it still
   has active children. Inactive children do not block parent deactivation.
   - Query: `SELECT COUNT(*) FROM organization_units WHERE parent_id = $1 AND deleted_at IS NULL AND is_active = true`
   - Guard: if count > 0, throw ConflictError.
   - Consequence: deactivation cascades from the bottom up (children first). No automatic cascade.

2. **Scope assignments (PROPOSAL).** Role assignments referencing the unit must be considered
   when planning deactivation scope access. The query to check if assignments exist:
   - `SELECT COUNT(*) FROM user_role_assignments WHERE scope_organization_unit_id = $1`
   - Whether to count raw assignments or only effective ones remains a **PROPOSAL**, not a
     blocking decision for Tahap B — the choice is policy, not required for deactivation
     to be functional. Can be deferred to a later phase.

### Legal Entity

1. **Has Organization Units on deactivation (DECIDED).** A Legal Entity must not be deactivated
   while it still has active Organization Units. Inactive units do not block LE deactivation.
   - Query: `SELECT COUNT(*) FROM organization_units WHERE legal_entity_id = $1 AND deleted_at IS NULL AND is_active = true`
   - Guard: if count > 0, throw ConflictError.
   - Consequence: all child OUs must be deactivated first (matching the parent-child rule above).

2. ~~Pending workflow instances referencing the Legal Entity.~~ **REMOVED — not implementable
   as described.** There is no `legal_entity_id` column on `workflow_instances`; the only
   migrations defining a `legal_entity_id` column are
   `1755600000000_identity-organization-rbac-audit.cjs` (on `organization_units`),
   `1764000000000_workforce_core_schema.cjs`, and `1767000000000_finance_core_schema.cjs`.
   A workflow guard for Legal Entities would need a new link that does not currently exist.
   If such a guard is wanted, it must be specified as new work, not as an existing query.

### User

1. **Last remaining tenant manager.** Required — see the capability-based count above.
2. **Self-deactivation and self-deletion.** Forbidden.
3. **Pending workflow assignments (DECIDED).**
   
   The real table is `workflow_instance_assignments`
   (`1755800000000_workflow-approval-engine-foundation.cjs:251-292`), with `assignment_type`
   constrained to `'role' | 'specific_user'`, and the columns `assigned_role_code`,
   `assigned_organization_unit_id`, `assigned_user_id`, plus `status` defaulting to
   `'pending'`.

   **Item 8 (DECIDED): Deactivation is rejected if pending specific-user assignments exist.**
   Query to check:
   ```sql
   SELECT 1 FROM workflow_instance_assignments wia
   JOIN workflow_instances wi ON wi.id = wia.workflow_instance_id
   WHERE wi.tenant_id = $1
     AND wia.assigned_user_id = $2
     AND wia.status = 'pending'
   LIMIT 1;
   ```
   If a row is found, throw ConflictError. The user must resolve or reassign these tasks
   before deactivation proceeds. This applies to deactivation only; deletion is covered
   separately.

   **Item 9 (DECIDED): Role-queue assignments do not block user deactivation.**
   A user who is the sole eligible holder of a role may still be deactivated. The task
   will remain in queue until another eligible actor claims it. This is an accepted
   operational risk.

   **Item 10 & Workflow consequence (DECIDED): Deactivating an OU does not cascade to
   workflow assignments.** For a `role` queue assigned to an OU, eligibility is resolved
   dynamically through `RbacService.hasRoleCoveringScope`. Do not assume deactivating the
   assigned OU makes the task inaccessible to everyone: `doAssignmentsCoverRoleScope`
   explicitly accepts a tenant-scoped holder of the matching role even when the ancestor
   set is empty (`rbac.service.ts:154-161`). OU-scoped coverage and tenant-wide coverage
   must be tested separately. This predicate does not inspect an OU activation flag;
   deactivation must not silently become a new RBAC revocation rule. The task assignment
   is preserved; it remains in queue. Any workflow state change tied to OU lifecycle must
   be specified and verified separately. Historical workflow and assignment rows keep
   referring to the OU by id. No cascading deletion.

### Workflow Claim Lock Boundary

- **No lifecycle lock is provided by workflow claims.** `claimed_by_user_id` and
  `claimed_at` are a separate, optional 15-minute reservation mechanism. They do not
  serialize tenant lifecycle mutations and must not be cited as a substitute for the
  tenant-row `FOR UPDATE` protocol.

### Workflow Dependency Policy (PROPOSAL)

The current workflow schema has no `workflow_instances.assigned_user_id` and no
`workflow_instances.legal_entity_id`. Assignment ownership is stored in
`workflow_instance_assignments`, joined to `workflow_instances` for tenant filtering.
Consequently, any future pending-assignment query must use the real shape, for example:

```sql
SELECT 1
  FROM workflow_instance_assignments wia
  JOIN workflow_instances wi ON wi.id = wia.workflow_instance_id
 WHERE wi.tenant_id = $1
   AND wia.assigned_user_id = $2
   AND wia.status = 'pending'
 LIMIT 1;
```

That query covers only `specific_user` assignments. A role-queue dependency would need a
separate policy and eligibility query; it cannot be inferred from `assigned_user_id` because
role assignments have that column null. Founder approval is required before either category
blocks user lifecycle operations.

### Reference Data Item

**Item 11 (DECIDED): No in-use guard for reference-data deactivation in Tahap B.**
Deactivation proceeds without checking whether the item is still referenced by open
records. Existing rows that reference the item (e.g., a transaction with category = the
deactivated category) retain that value. The deactivated item simply becomes unavailable
for selection in new transactions. Any comprehensive cross-table in-use check is deferred
to a later phase. The service method `setReferenceDataItemActive` already enforces
`config.manage` permission and records the audit action correctly.

---

## Transaction and Concurrency Design

### The existing precedent

`PgRbacRepository` is the only place in the codebase that uses the governed-transaction
pattern (`rbac.repository.pg.ts:536-561`):

```
BEGIN
SELECT id FROM tenants WHERE id = $1 AND deleted_at IS NULL FOR UPDATE   -- tenant row lock
  ... revalidate actor authority inside the transaction ...
  ... perform the mutation ...
  ... append the audit row on the same client ...
COMMIT   (ROLLBACK on error; client released in finally)
```

Authority is revalidated **inside** the transaction rather than trusted from before it
(`requireTransactionActorAuthority`, `rbac.repository.pg.ts:563-602`), and the audit row is
written on the same client (`recordGovernedAudit`, `rbac.repository.pg.ts:604-633`).

**Verified Serialization Guarantee** (per agent audit of `rbac.repository.pg.ts:406-517`):
1. BEGIN transaction
2. SELECT ... FROM tenants WHERE id = $1 FOR UPDATE — locks the tenant row
3. If tenant not found → throw NotFoundError, ROLLBACK
4. Call operation callback: requireTransactionActorAuthority inside lock
   - Verifies actor is active, not deleted, in tenant
   - Verifies actor holds admin.console.read permission
   - Verifies actor holds user.role.manage at tenant scope (both scope IDs NULL)
5. Fetch target row; revalidate tenant ID
6. Compute remaining-manager count (only for tenant-scoped user.role.manage removals):
   ```sql
   SELECT COUNT(DISTINCT ua.user_id) FROM authorization_effective_user_role_assignments ua
   JOIN role_permissions rp ON rp.role_id = ua.role_id
   JOIN permissions p ON p.id = rp.permission_id
   WHERE ua.tenant_id = $1 AND ua.scope_type = 'tenant'
     AND ua.scope_organization_unit_id IS NULL AND ua.scope_customer_id IS NULL
     AND p.code = 'user.role.manage' AND ua.user_id <> $2
   ```
   (Count is zero if the only remaining manager would be the target user. Self-removal is separately blocked.)
7. If count is zero, throw ConflictError, ROLLBACK
8. Perform the mutation (DELETE row)
9. recordGovernedAudit on same client
10. COMMIT
11. Release client connection

**Serialization boundary:** cooperating transactions acquire the same tenant-row lock
before rechecking authority and the remaining-manager count. A later transaction evaluates
the state after the earlier transaction commits or rolls back. Depending on that state,
it may fail authority, target/assignment lookup, or the remaining-manager check; it does
not necessarily fail the count check. This protects the governed removal path against
other writers using the same protocol, not against arbitrary concurrent writers.
User deactivation and soft-delete must participate too: changing user status or
`deleted_at` changes effective manager membership even without deleting an assignment.

**Remaining-Manager Semantics** (verified lines 490–517):
- Counts DISTINCT effective users holding the permission (not role-name-based, not
  is_full_access metadata, not raw assignment counts)
- Excludes the entire target user from the count (so a user with two manager assignments
  cannot remove one of them if no other user holds the permission)
- Runs only when removal would revoke user.role.manage at a tenant-scope assignment
  (scope_type='tenant', both scope IDs NULL, assignment.scope_state='available')
- Is independent from self-manager block (both predicates must be checked; either can fail)

### What this does and does not guarantee

The tenant-row `FOR UPDATE` serializes **only those mutations that take the same lock**.
It does not make the last-manager check race-free across the system as a whole: any code
path that changes manager membership without taking that lock can still interleave.

So the accurate statement for Tahap B is conditional: *if every lifecycle mutation that can
affect manager membership goes through the same tenant-row lock, those mutations serialize
against each other.* Claiming more than that would be unverified. The earlier revision's
"pessimistic lock on the admin count; or use advisory lock" was too vague to implement and
is replaced by the concrete pattern above.

A `CHECK` constraint or unique partial index is **not** a usable alternative here: the
"at least one manager" invariant spans `user_role_assignments`, `roles`, `role_permissions`,
and `permissions`, and Postgres cannot express a cross-table constraint of that shape.

### Audit is not transactional today, except in the RBAC path

`AuditService` is a separate application-layer call. Only the governed RBAC assignment path
writes its audit row inside the mutation's transaction. If Tahap B wants "the mutation and
its audit row commit together" as a general rule, that is a **new** guarantee to build, not
an existing pattern to reuse. Stating it as existing would be wrong.

---

## Layer & File Changes (PROPOSAL)

| Layer | File | Change |
|---|---|---|
| Migration | `apps/api/migrations/1785000000000_tahap-b-lifecycle-soft-delete.cjs` | exists, unrun |
| Domain | `domain/organization-unit/organization-unit.entity.ts` | lifecycle fields + repo methods |
| Domain | `domain/legal-entity/legal-entity.entity.ts` | lifecycle fields + repo methods |
| Domain | `domain/identity/user.entity.ts` | `deactivatedAt`, `deactivatedBy` + repo methods |
| Repository | `…/repositories/organization-unit.repository.pg.ts` | `mapRow` fields; update/setActive; no delete |
| Repository | `…/repositories/legal-entity.repository.pg.ts` | same; no delete |
| Repository | `…/repositories/user.repository.pg.ts` | updateProfile/setActive/softDelete |
| Service | `application/organization-unit/organization-unit.service.ts` | permission + scope wrappers |
| Service | `application/legal-entity/legal-entity.service.ts` | same |
| Service | `application/identity/user.service.ts` | same + self-ban + last-manager |
| Route | `interfaces/http/routes/organization-units.ts` | PATCH + lifecycle verbs |
| Route | `interfaces/http/routes/legal-entities.ts` | same |
| Route | `interfaces/http/routes/users.ts` | same |
| Route | `interfaces/http/routes/config.ts` | **only** the reference-data toggle route |
| Web | `apps/web/src/lib/api.ts` | client methods |
| Web | `apps/web/src/pages/DashboardPage.tsx` | OU / LE / User lifecycle dialogs |
| Web | `apps/web/src/pages/ConfigurationPanel.tsx` | reference-data toggle |

**No configuration service or repository change is needed** — `setReferenceDataItemActive`
already exists end to end below HTTP.

The general reference-data toggle belongs in `ConfigurationPanel.tsx`, which owns the
general Reference Data panel. `admin/ComplaintConfigPage.tsx` is a **style reference** for
the confirm-dialog pattern; it owns complaint-specific configuration only. The earlier
revision placed the general toggle there, which would put it on the wrong page.

---

## Tenant Isolation & Scope Guarantees

- Every query filters `tenant_id`, and every mutation revalidates the fetched row's
  `tenantId` against `actor.tenantId` before writing.
- Organization Unit scope stays ancestor-aware through `listAncestorIds`
  (`organization-unit.repository.pg.ts:62-81`), consumed by
  `RbacService.requireOrganizationUnitScope` (`rbac.service.ts:78-111`). Tahap B reuses this;
  it must not re-derive hierarchy locally.
- **OPEN:** when a parent Organization Unit is INACTIVE, are its descendants hidden from
  non-tenant-wide users, or shown but non-selectable? This affects list output and must be
  decided before UI work.
- Deactivation is a master-data state. It must not be treated as a silent RBAC revocation
  beyond what the effective-assignment view already does for users.

---

## Audit

**DECIDED:** Every Tahap B mutation and its audit record must commit together or roll back
together. The governed-transaction pattern is the required implementation model, not merely
an optional optimization.

Proposed action codes:

```
organization_unit.updated | .activated | .deactivated
legal_entity.updated      | .activated | .deactivated
user.updated              | .activated | .deactivated | .deleted
```

Reference data already emits `config.reference_data_item.activated` / `.deactivated`
(`configuration.service.ts:325`); no new code is needed there.

Organization Unit and Legal Entity rows are never deleted by Tahap B; historical workflow,
assignment, and audit rows continue referring to their stable ids. User soft-deleted rows
stay queryable for audit. No cascading deletion of audit history.

---

## Test Plan (PROPOSAL)

**Integration** (`apps/api/tests/integration/`): OU lifecycle with child and scope guards;
LE lifecycle with unit guard; User lifecycle covering self-ban, last-manager protection, and
token revocation; the reference-data toggle route; and a concurrency test asserting that two
competing deactivations of the last manager cannot both succeed.

**Security:** permission gates per verb, cross-tenant rejection, and guard error messages
that do not disclose counts or ids from another tenant.

**Existing coverage to reuse rather than duplicate:**
`apps/api/tests/integration/access-lifecycle-hardening.test.ts` already covers the
login / refresh / access-token behavior for inactive and deleted users.

**Development/test environment authorization.** The entire `abixell-one-dev` environment is
explicitly available for development and testing because it is a trial environment. Integration
tests may mutate and reset its data as needed; this authorization is not limited to creating a
separate disposable database. When work is later committed to `core` or `prd`, reconcile the
structure to those targets; no content-level alignment is required by this decision.

---

## UI Plan (PROPOSAL, after backend is merged and tested)

Edit, Activate, and Deactivate dialogs for OU / LE / Users in `DashboardPage.tsx`,
and an active toggle in the Reference Data panel of `ConfigurationPanel.tsx`. There is no
OU/LE Delete control. User soft-delete, if retained after implementation review, requires
an explicit confirmation.

Inactive entities must be visibly distinct from active entities. The Founder suggested a
status flag and/or grey text or italic styling. The exact visual treatment is deferred to
UI design and must be based on real API status data; it must not imply deletion.

All UI work is deferred. Before generating or editing UI, ask whether the antislop filter
should apply **during** the UI work or **after** it. No control is rendered unless the
backend supports it; guard failures surface the server's message.

Copy for dialogs is not drafted here. It should be written against the project's UI-writing
rules when UI work is actually authorized.

---

## Corrections to the Previous Revision

| Previous claim | Verified reality |
|---|---|
| "Gap: no defined behavior for active/inactive on token refresh and access-token use" | Implemented: `auth.service.ts:73`, `auth.service.ts:104-127`, `auth-plugin.ts:49-56`; covered by `access-lifecycle-hardening.test.ts` |
| "`createReferenceDataItem()` supported… no toggle or deactivate route" | `setReferenceDataItemActive` exists with permission gate and audit at `configuration.service.ts:292-331`; only the HTTP route is missing |
| Flat `reference_data` table, "add column `is_active`" | Real schema is `reference_data_types` + `tenant_reference_data_items`; `is_active` already exists (`1755700000000:145-157`) |
| `ADD COLUMN status TEXT` for OU and LE | Convention is `is_active BOOLEAN NOT NULL DEFAULT true` |
| Migration `17XX000000000`, "timestamp assigned at implementation time" | File already exists at `1785000000000_tahap-b-lifecycle-soft-delete.cjs`, unrun |
| LE guard: "check `workflow_instances` for `legal_entity_id`" | No such column exists; guard removed |
| User guard: "active or pending workflow assignments" | Real table `workflow_instance_assignments`; `assigned_user_id` is null for role-queue assignments, so a user-id-only guard is incomplete |
| "Pessimistic lock on the admin count; or advisory lock" | Concrete precedent: `inGovernedTransaction` tenant-row `FOR UPDATE` plus capability-based count, `rbac.repository.pg.ts:490-561` |
| Child-OU guard stated as settled | The interview has now settled the rule: active children block parent deactivation; inactive children do not. Deactivation proceeds bottom-up with no automatic cascade. |
| OU/LE soft-delete and delete permissions treated as part of Tahap B | Superseded by the interview: Organization Units and Legal Entities are never deleted; they support activate/deactivate only. |
| The migration's seeded 12-permission catalog treated as final | Superseded by the interview: permission separation is approved, but the exact catalog must be reconciled; the on-disk 12-code seed is obsolete. |
| Reference-data toggle placed in `admin/ComplaintConfigPage.tsx` | Belongs in `ConfigurationPanel.tsx` |
| Implicit "transaction owns the audit row" as an existing pattern | True only in the governed RBAC path; not a general guarantee |

---

## Errors Found in the Prior Implementation Plan (`stateless-growing-mitten.md`)

That plan document is **not authorized** and must not be executed. It is referenced here
only because it contains specific mistakes that would resurface if copied into real code.

| Plan text | Problem | Correction |
|---|---|---|
| Manager-count guard subquery: `... NOT IN (SELECT user_id FROM users WHERE status != 'active' OR deleted_at IS NOT NULL)` | `users` has no `user_id` column; its primary key is `id`. The subquery is invalid SQL and would fail at execution. | Use `users.id`, or drop the subquery entirely — `authorization_effective_user_role_assignments` already excludes inactive/deleted users, so the count needs no extra filter. |
| OU delete guard stated as "no child OUs exist (active or inactive)" using `WHERE parent_id = $1 AND deleted_at IS NULL`, immediately followed by "inactive child OUs are not checked and do not block deletion" | Self-contradictory: the query filters only `deleted_at`, so it counts inactive children too. It cannot simultaneously mean both things. | **DECIDED per the interview:** Active children block deactivation, inactive children do not. Query: `WHERE parent_id = $1 AND deleted_at IS NULL AND is_active = true`. See [Guard: Child units on deactivation](#organization-unit). |
| Same contradiction repeated for the Legal-Entity → Organization-Unit guard | Same defect | **DECIDED per the interview:** Active OU children block LE deactivation, inactive do not. Query: `WHERE legal_entity_id = $1 AND deleted_at IS NULL AND is_active = true`. See [Guard: Has Organization Units on deactivation](#legal-entity). |
| User pending-assignment guard: `workflow_instances.assigned_user_id = $1 AND status = 'pending'` | `workflow_instances` has no `assigned_user_id` or `status` column of that shape; assignment ownership lives on `workflow_instance_assignments`, joined by `workflow_instance_id`. | **DECIDED per the interview:** Only `specific_user` assignments block deactivation. Query and consequences shown under [User: Pending workflow assignments](#pending-workflow-assignments). |
| Method names inconsistent across layers: domain declares `update`/`setActive`/`softDelete` on the repository interface (matching what is already on disk), while the plan's service/route sections use `updateOrganizationUnit`/`activateOrganizationUnit`/`deleteOrganizationUnit` and the user layer uses yet another pair (`updateProfile`/`setActive` vs. `updateUserProfile`/`setUserActive`) | Divergent naming between domain, repository, and service sections in the same plan | Pick one naming convention before writing any code; the domain interface already committed to disk uses `update`, `setActive`, `softDelete` — match callers to that instead of inventing new names per layer. |
| "Pessimistic lock on the admin count, or a CHECK/UNIQUE constraint" floated as an alternative | A cross-table invariant ("at least one manager") spans `user_role_assignments`, `roles`, `role_permissions`, `permissions` — Postgres cannot express that as a `CHECK` or unique index. | Use the tenant-row lock plus capability-count pattern only; do not add a database constraint for this invariant. |

---

## Partial Implementation Artifacts Already on Disk

An earlier implementation attempt wrote code before preparation was complete. **Nothing has
been run, staged, committed, or applied to any database.** The artifacts are listed here so
they are not mistaken for finished work.

| Path | State |
|---|---|
| `apps/api/migrations/1785000000000_tahap-b-lifecycle-soft-delete.cjs` | Untracked. Adds `is_active` / `deactivated_at` / `deactivated_by` to `organization_units` and `legal_entities`, `deactivated_at` / `deactivated_by` to `users`, and seeds the old 12-permission catalog. Has a matching `down()`. **Not executed.** The seeded permission catalog is now obsolete and must be rewritten when implementation is authorized. |
| `apps/api/src/domain/organization-unit/organization-unit.entity.ts` | Modified, uncommitted. Adds `isActive` / `deactivatedAt` / `deactivatedBy` to the entity, adds `UpdateOrganizationUnitInput`, and declares `update`, `setActive`, `softDelete` on `OrganizationUnitRepository`. The `softDelete` declaration conflicts with the new no-delete decision and must be removed or rewritten when implementation is authorized. |
| `apps/api/src/domain/legal-entity/legal-entity.entity.ts` | Modified, uncommitted. Adds the same three fields plus `UpdateLegalEntityInput`. The repository interface is **not** extended. Any LE soft-delete design from the prior attempt is superseded by the new no-delete decision. |

### These edits currently break the build

- `PgOrganizationUnitRepository` does not implement `update`, `setActive`, or `softDelete`,
  which the interface now requires.
- Neither `organization-unit.repository.pg.ts:9-20` nor `legal-entity.repository.pg.ts:9-18`
  returns the new `isActive` / `deactivatedAt` / `deactivatedBy` fields from `mapRow`.

`npm run typecheck` in `apps/api` is therefore expected to fail until either the repositories
are completed or the entity edits are reverted. This is stated rather than silently fixed,
because preparation mode requires preserving existing uncommitted changes.

`apps/api/src/domain/identity/user.entity.ts` is untouched.

---

## Decisions Made & Interview Record (Tahap B Preparation Interview)

**Format:** Each decision was presented as a scenario with a recommendation and reasoning,
following the format: (1) plain-language business example, (2) recommended approach,
(3) rationale, (4) consequences. The Founder answered with acceptance, override, or
clarification. All decisions below represent the Founder's confirmed choice.

### Approval Chain (Interview Rounds)

**Round 1 — Account and Permissions**
1. ✓ **Permission separation is approved; the final catalog is not yet frozen.** The old
   twelve-code catalog is obsolete. The exact granular codes must be reconciled before
   implementation; in particular, email and password changes must not be granted by a
   blanket `user.update` permission.
2. ✓ **Account editing (name, email, password) is gated by role.** The mutable user
   profile fields are decided: `fullName`, `email`, `password`. Only `users.id` is immutable.
   Granular permission codes such as `user.email.update` and `user.password.reset` remain
   technical proposals awaiting reconciliation before implementation.
3. ✓ **Audit atomicity is required.** A mutation and its audit record must either both
   succeed or both fail—no partial audit. This is enforced in the governed-transaction pattern.

**Round 2 — Lifecycle of Organization Units, Legal Entities, and Deactivation Cascades**
4. ✓ **Organization Units and Legal Entities are never deleted.** Both entities support
   `activate` and `deactivate` only; there is no `.delete` operation in Tahap B. Rows are
   preserved forever for audit and historical reference.
5. ✓ **Parent deactivation requires child deactivation (bottom-up).** A parent OU or LE
   cannot be deactivated if it has active children. All children must be deactivated first
   (from leaf to root; no automatic cascade). Inactive children do not block parent
   deactivation.
6. ✓ **UI rendering of inactive entities.** Active/inactive status is visually distinguished
   (grey text or italic font) in the Administration UI.

**Round 3 — Workflow Assignment Blocking & Reference Data**
7. ✓ **Pending specific-user assignments block user deactivation.** A user with pending
   workflow tasks routed specifically to them cannot be deactivated; those tasks must be
   resolved or reassigned first. This guard applies only to `specific_user` assignments
   (where `assigned_user_id` is the target user).
8. ✓ **Role-queue assignments do not block deactivation.** If a user is the sole eligible
   holder of a role queue, they may still be deactivated. The task remains in queue until
   another eligible actor claims it.
9. ✓ **OU deactivation does not cascade to workflow eligibility.** An OU-targeted role-queue
   assignment persists after the OU is deactivated. Tenant-scoped role holders may still act
   on the queue (eligibility is resolved dynamically; deactivation is not a new RBAC
   revocation). Any workflow state change tied to OU lifecycle is out of scope for Tahap B.
10. ✓ **Reference-data deactivation requires no in-use check.** Existing records referencing
    the deactivated item retain that value; the item simply becomes unavailable for new
    selections. A comprehensive cross-table dependency check is deferred.

**Round 4 — Testing Environment & Partial Artifacts**
11. ✓ **The entire `abixell-one-dev` environment is free for development and testing.** It is
    specifically a trial environment, not limited to a disposable database. When work is later
    committed to `core` or production, only the structure needs to be reconciled to those
    targets; the content does not.
12. ✓ **Partial artifacts are retained, then reconciled at implementation.** The uncommitted
    migration file and entity edits on disk are kept in place (not reverted, not completed,
    not staged/committed). When implementation is authorized, each part is reviewed against
    the final decisions: correct parts are kept, wrong parts are rewritten, build errors are
    resolved.

### Decisions Still Pending (Not Blocked, Just Deferred)

These remain **PROPOSAL** status. They do not block implementation but must be settled before
relevant code is deployed:

- **Scope-assignment count query:** whether to count raw `user_role_assignments` (includes
  history) or only effective assignments. This is a policy decision deferred to implementation
  phase; it does not block deactivation.
- **Descendant visibility when parent is inactive:** whether to hide inactive children from
  the list, or show them but make them non-selectable. This is a UI rendering concern,
  deferred to the UI-design phase.
- **Email verification and session revocation:** after a user's email or password is changed,
  whether to require email verification and/or revoke active sessions. These are security
  concerns documented in the [Account editing](#account-editing-and-permissions) section as
  still needing a concrete contract.
- **Audit transaction atomicity as a general rule:** whether the new requirement (mutation +
  audit row commit together) should be extended beyond the governed RBAC path to all
  mutations, or remain Tahap B-specific. This is an architectural decision for later phases.
- **Feature flag (`TAHAP_B_LIFECYCLE_ENABLED`):** not decided and does not exist. Tahap B
  operations are always-on once implemented.

---

## Implementation Order (once approved)

1. Run the migration against a disposable database and verify the columns and permissions.
2. Complete the domain entity contracts.
3. Implement repository methods on the governed-transaction pattern with the guards.
4. Implement service methods (permission and scope gates, self-ban, last-manager count).
5. Add HTTP routes with Zod validation.
6. Add the reference-data toggle route and the web client method.
7. Integration, permission, and concurrency tests; typecheck; full suite.
8. UI dialogs and status display, only after the backend is verified.

---

## Out of Scope

Reference item rename and delete; numbering sequence management; workflow designer and
publish UI; bulk lifecycle operations; hard deletion of any user; password reset; tenant-level
lifecycle; archive and purge policy for soft-deleted rows.

---

## Status

**FOUNDER-APPROVED PREPARATION.** No migration has been run. No database has been changed.
Nothing has been staged, committed, or pushed. The uncommitted artifacts described above
predate this document and were left untouched. The Founder has approved the preparation
contract and confirmed the entire `abixell-one-dev` environment is free for development and
testing, since it is specifically a trial environment; only the structure (not the content)
needs to be reconciled when work is later committed to `core` or production. This does **not**
authorize implementation in this session. Separate explicit implementation authorization is
still required. Deferred technical and UI decisions remain proposals until resolved.

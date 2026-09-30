# Epic 5 Phase 4 — Legacy Re-parent: Operator Task Specification

**Date:** 2026-09-30  
**Status:** NOT AUTO-EXECUTED (requires manual DB operator run)  
**Scope:** Operator/DBA only; not part of automated migration pipeline  

---

## Context

Epic 5 Gelombang 2 migration `1789399600000_epic-5-g2-root-central-backfill.cjs` inserted one Central root for every Legal Entity lacking one. This resolved the invariant "every Legal Entity must have at least one root Organization Unit named Central."

However, the backfill was **deliberately additive only**: it did not re-parent legacy parentless units. Result:
- **309 live Legal Entities** all now have a Central root ✓
- **45 Legal Entities** have **two or more parentless units** (legacy orphans + new Central)
- **264 Legal Entities** have **two parentless units** (legacy root + new Central)

Phase 4 re-parents those legacy roots under the newly created Central, consolidating to one active root per LE.

---

## Task: Re-parent Legacy Orphans

### Objective
Move all parentless Organization Units (except the `unit_type='Central'` root) under the Central root **of the same Legal Entity**. Preserve original `unit_type` and other fields.

### Precondition Check

Before running the operator task, verify:

```sql
-- Should return 309 (one Central per LE)
SELECT COUNT(DISTINCT legal_entity_id)
  FROM organization_units
 WHERE unit_type = 'Central'
   AND deleted_at IS NULL;

-- Should return 309 (count of live LEs)
SELECT COUNT(*) FROM legal_entities WHERE deleted_at IS NULL;

-- Should match (all LEs have Central)
-- If not, backfill was not run or incomplete.
```

---

## SQL Operator Task

### Step 1: Identify Legacy Roots to Re-parent

```sql
-- Census: which LEs have parentless units other than Central
SELECT 
  ou.legal_entity_id,
  COUNT(*) AS orphan_count,
  STRING_AGG(DISTINCT ou.unit_type, ', ' ORDER BY ou.unit_type) AS unit_types,
  COUNT(CASE WHEN ou.unit_type = 'Central' THEN 1 END) AS central_count
FROM organization_units ou
WHERE ou.parent_id IS NULL
  AND ou.deleted_at IS NULL
GROUP BY ou.legal_entity_id
HAVING COUNT(*) > 1  -- More than one parentless unit (includes new Central)
ORDER BY orphan_count DESC;
```

Expected result: ~45 Legal Entities with 2+ parentless units.

### Step 2: Re-parent Orphans in Governed Transaction

Run once per Legal Entity (or batch), inside a governed transaction to ensure audit trail:

```sql
-- For a single LE (example: legal_entity_id = :le_id)
-- Transaction start
BEGIN;

-- Get the Central root for this LE
WITH central AS (
  SELECT id FROM organization_units
   WHERE legal_entity_id = :le_id
     AND unit_type = 'Central'
     AND deleted_at IS NULL
   LIMIT 1
), orphans AS (
  -- All parentless units of this LE EXCEPT Central
  SELECT id, unit_type FROM organization_units
   WHERE legal_entity_id = :le_id
     AND parent_id IS NULL
     AND unit_type != 'Central'
     AND deleted_at IS NULL
)
UPDATE organization_units ou
   SET parent_id = (SELECT id FROM central),
       updated_at = now()
 WHERE ou.id IN (SELECT id FROM orphans)
RETURNING id, parent_id, unit_type;

-- Record audit for the LE
INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
VALUES (
  (SELECT tenant_id FROM legal_entities WHERE id = :le_id),
  :actor_user_id,  -- operator ID or NULL if system
  'organization_unit.legacy_reparent_batch',
  'legal_entity',
  :le_id,
  jsonb_build_object(
    'reason', 'Epic 5 Phase 4 — consolidate legacy orphan roots under new Central',
    'batch', :batch_tag,  -- e.g. 'phase-4-20260930'
    'timestamp', now()::text
  )
);

COMMIT;
```

### Step 3: Bulk Re-parent (All Remaining LEs)

Alternatively, run as a single batch (preferred for auditability):

```sql
BEGIN;

-- Update all legacy orphans across all LEs in one statement
UPDATE organization_units ou
   SET parent_id = (
         SELECT id FROM organization_units c
          WHERE c.legal_entity_id = ou.legal_entity_id
            AND c.unit_type = 'Central'
            AND c.deleted_at IS NULL
       ),
       updated_at = now()
 WHERE ou.parent_id IS NULL
   AND ou.unit_type != 'Central'
   AND ou.deleted_at IS NULL;

-- Record batch audit
WITH moved_batch AS (
  SELECT DISTINCT legal_entity_id, tenant_id
    FROM organization_units ou
   WHERE ou.parent_id IS NOT NULL
     AND ou.unit_type != 'Central'
     -- Can add AND updated_at = now() if DB precision allows same-second detection
)
INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
SELECT 
  mb.tenant_id,
  :actor_user_id,  -- operator ID or system user
  'organization_unit.legacy_reparent_batch',
  'legal_entity',
  mb.legal_entity_id,
  jsonb_build_object(
    'reason', 'Epic 5 Phase 4 — consolidate all legacy orphan roots under new Central',
    'batch', 'phase-4-'::text || to_char(now(), 'YYYYMMDD'),
    'timestamp', now()::text
  )
FROM moved_batch mb;

COMMIT;
```

---

## Postcondition Check

After re-parententing, verify:

```sql
-- Should return 0 (no orphan roots except Central per LE)
SELECT ou.legal_entity_id, COUNT(*) AS orphan_count
  FROM organization_units ou
 WHERE ou.parent_id IS NULL
   AND ou.deleted_at IS NULL
   AND ou.unit_type != 'Central'
 GROUP BY ou.legal_entity_id;

-- Should return 309 (one Central per LE, all parentless)
SELECT COUNT(DISTINCT legal_entity_id) 
  FROM organization_units
 WHERE parent_id IS NULL
   AND unit_type = 'Central'
   AND deleted_at IS NULL;

-- Audit trail should show batch entry
SELECT COUNT(*) FROM audit_log
 WHERE action = 'organization_unit.legacy_reparent_batch'
   AND created_at >= now() - interval '1 hour';
```

---

## Guardrails

1. **Transaction Boundary**: Entire re-parent must be in one transaction; no partial commits.
2. **Audit Mandatory**: Every re-parent must record a `legacy_reparent_batch` audit entry with batch tag and operator ID.
3. **No Data Loss**: Original `unit_type` is preserved; only `parent_id` changes.
4. **Idempotency**: If a unit already has a parent (non-NULL `parent_id`), it is not touched.
5. **Operator Accountability**: Record which operator ran this task, when, and under which batch tag for future traceability.

---

## Rollback (if needed)

If re-parent must be reversed, delete audit entries and restore `parent_id = NULL` for units matching the batch:

```sql
-- Identify units moved in batch :batch_tag
WITH batch_units AS (
  SELECT entity_id FROM audit_log
   WHERE action = 'organization_unit.legacy_reparent_batch'
     AND metadata->>'batch' = :batch_tag
     AND entity_type = 'legal_entity'
)
SELECT id, legal_entity_id FROM organization_units
 WHERE legal_entity_id IN (SELECT entity_id FROM batch_units)
   AND parent_id IS NOT NULL
   AND unit_type != 'Central'
   AND deleted_at IS NULL;

-- Verify list, then revert (wrapped in transaction):
BEGIN;
UPDATE organization_units
   SET parent_id = NULL, updated_at = now()
 WHERE legal_entity_id IN (SELECT entity_id FROM batch_units)
   AND unit_type != 'Central'
   AND deleted_at IS NULL;

DELETE FROM audit_log
 WHERE metadata->>'batch' = :batch_tag;

COMMIT;
```

---

## Who Runs This

**Operator**: Database Administrator or Founder with direct DB access.  
**When**: After Phase 5 QA sign-off on Epic 5 Phases 1-3.  
**Authority**: Founder decision required; migration spec complete for operator to execute.  
**Effort**: ~30 minutes (query + execution + verification).

---

## Out of Scope

- Automated execution in CI/CD pipeline (manual operator decision each time)
- Rollback UI (operator uses SQL only)
- Audit report generation (captured in `audit_log` action)

---

**Related**
- Epic 5 Progress: `docs/plans/epic-5-progress.md`
- Root Central Backfill: `apps/api/migrations/1789399600000_epic-5-g2-root-central-backfill.cjs`
- Organization Unit Lifecycle: `docs/contracts/epic-5-g1-organization-unit-lifecycle.md`

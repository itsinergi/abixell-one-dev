# E2E-014 Catering Pilot — Staging Initialization Runbook

This runbook initializes the synthetic `UNIT-CAT-PILOT-01` tenant on staging with the foundation data the four UAT scenarios need. It does **not** create the 29 live transactions — those are run by the operator during FASE 1 so they emit outbox events and post GL journals through the real consumer.

Reference: `08_uat/UAT_SCENARIO_E2E-014_CATERING_PILOT.md`, `08_uat/G7_E2E-014_PILOT_DATA_SPECIFICATION.md`, and the engineering proof at `apps/api/tests/integration/wave-ver-01-pilot.test.ts` (WP-VER-01, PR #18).

## Prerequisites

1. Staging is live and migrated to the current release (`npm run migrate` against the staging database).
2. `PLATFORM_BOOTSTRAP_KEY` is set in the staging API environment.
3. Period Oktober 2026 will be opened by this seed — confirm no real accounting period overlaps `2026-10-01 .. 2026-10-31` for the pilot legal entity.
4. Operator has two strong staging passwords ready (one admin, one shared pilot-user password). The seed reads them from the environment and never prints them.
5. A pre-migration backup of the staging database exists and a restore drill has passed (CP-ENV-02/03).

## What the seed creates

| Group | Created |
|---|---|
| Tenant | `UNIT-CAT-PILOT-01` (synthetic), legal entity, Head Office + Pilot Site org units |
| Roles | `ADMIN` (full access), `COORD_OPS`, `EXEC_OPS`, `VERIFY_OPS`, `BILL_OPS` |
| Users | 1 admin + 4 pilot users (one per operational role), tenant-scoped assignments |
| Workflow | `service_operations_work_order` v1: PLANNED → IN_PROGRESS → DONE → CLOSED, published |
| Service | `catering_pilot_service` definition |
| Numbering | `WO-{SEQ:5}`, `INV-{SEQ:5}` |
| Catering | `catering` pack active; `KG`/`G` units + KG→G conversion; `RICE-PILOT` + `COOKED-RICE-PILOT` items; valuation layer 100 KG @ 12.000 IDR; menu `MENU-PILOT`, recipe `RC-PILOT` (500 G rice → 2 KG cooked, cost 6.000/portion) |
| Accounting | Legal entity; period `OCT-2026` (open); COA `FY2026`; GL accounts 1210 / 2410 / 2500 / 4100 / 6200; posting rules `RULE_WO_COST_ACCUMULATED`, `RULE_WO_INVOICED`, `RULE_WO_INVOICE_TAX` (v1, no approval, effective 2026-01-01) |
| Config | Tenant-level markup `0.15` via `app_parameter_values` |

What the seed does **not** create: customers/sites are seeded (CUST-PILOT / SITE-PILOT) but the 29 transactions (work orders, cost items, invoices, journals) are operator-run in FASE 1.

## Run on staging

Run from the API checkout on the staging host (or wherever the API container can reach the staging database):

```bash
# 1. Set the two pilot passwords in the environment (do not commit these).
export PILOT_ADMIN_PASSWORD="<strong-admin-password>"
export PILOT_USER_PASSWORD="<strong-pilot-user-password>"
export PLATFORM_BOOTSTRAP_KEY="<staging-bootstrap-key>"
export DATABASE_URL="<staging-database-url>"

# 2. Run the seed.
npm run seed:pilot -w apps/api
```

The seed is idempotent: if `UNIT-CAT-PILOT-01` already exists, it logs "Skipped" and exits without touching data. Re-running after a partial failure requires deleting the tenant first (see Rollback below).

## Verify (FASE 0 item 3 evidence)

The seed prints a `SELECT COUNT(*)` summary block. Confirm the printed counts, then capture the screenshot/CSV evidence required by `G7_E2E-014_PILOT_DATA_SPECIFICATION.md`:

```sql
-- Expected counts after a successful seed:
SELECT count(*) FROM users WHERE tenant_id = (SELECT id FROM tenants WHERE code='UNIT-CAT-PILOT-01');             -- 6 (1 kernel actor + 1 admin + 4 pilot)
SELECT count(*) FROM roles  WHERE tenant_id = (SELECT id FROM tenants WHERE code='UNIT-CAT-PILOT-01');             -- 5
SELECT count(*) FROM accounting_accounts WHERE tenant_id = (SELECT id FROM tenants WHERE code='UNIT-CAT-PILOT-01'); -- 5
SELECT count(*) FROM posting_rules WHERE tenant_id = (SELECT id FROM tenants WHERE code='UNIT-CAT-PILOT-01');      -- 3
SELECT count(*) FROM accounting_periods WHERE tenant_id = (SELECT id FROM tenants WHERE code='UNIT-CAT-PILOT-01') AND status='open'; -- 1
SELECT count(*) FROM service_pack_activations WHERE tenant_id = (SELECT id FROM tenants WHERE code='UNIT-CAT-PILOT-01') AND is_active; -- 1
SELECT count(*) FROM items WHERE tenant_id = (SELECT id FROM tenants WHERE code='UNIT-CAT-PILOT-01');              -- 2
SELECT count(*) FROM catering_recipes WHERE tenant_id = (SELECT id FROM tenants WHERE code='UNIT-CAT-PILOT-01');   -- 1

-- Recipe cost must equal 6000.000000 per portion (500 G rice @ 12.000/KG).
```

Save the seed stdout and the SQL output to `UAT-014-Evidence/FASE-0-staging-init.txt`.

## Rollback

The pilot tenant is synthetic and isolated. To tear it down and re-seed:

```sql
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM tenants WHERE code = 'UNIT-CAT-PILOT-01';
COMMIT;
```

`SET LOCAL session_replication_role = replica` bypasses the immutable-event trigger on tenant deletion (same pattern the integration tests use for cleanup). CASCADE removes dependent rows. Re-run the seed afterwards.

## Credentials

- The seed never writes passwords to disk or stdout. It reads `PILOT_ADMIN_PASSWORD` and `PILOT_USER_PASSWORD` from the environment.
- Rotate both passwords before the pilot opens (FD-009-S1: no credentials in pilot documents — do not paste the actual values into tickets, the runbook, or evidence files).
- Pilot accounts are synthetic (`@pilot.local`); no production PII is involved.

## After init

Proceed to FASE 1: run UAT-014-01 (×20), UAT-014-02 (×3), UAT-014-03 (×3), UAT-014-04 (×3) through the API/UI, capturing screenshots and CSV exports into `UAT-014-Evidence/` with a `SUMMARY.txt`. Each transaction must emit outbox events and post GL journals through the real consumer — that is the point of running them live rather than seeding them.

# Epic 6 Gelombang 2-4 — Preparation & Readiness

**Date**: 2026-10-01  
**Status**: Siap untuk dimulai; Gelombang 0-1 (Business Partner foundation) SELESAI 2026-09-30  
**Next**: Mulai Gelombang 2 (Employee placement) atau tunggu keputusan founder tentang prioritas

---

## Recap: Apa yang Sudah Selesai (Gelombang 0-1)

| Item | Selesai | Evidence |
|---|---|---|
| Kontrak canonical + migrasi aman | ✅ 2026-09-30 | 9 migrations (1790000000000–1790800000000) |
| Business Partner foundation (Individual/Organization/roles) | ✅ 2026-09-30 | 435 tests lulus; 9 migrations |
| Contact, Address, Contact, BP Group, classifications | ✅ 2026-09-30 | Entity + routes + service + repository |
| Tenant isolation (composite FK + app-layer filter) | ✅ 2026-09-30 | All queries filter `tenant_id` explicitly |
| Typecheck | ✅ | 0 errors (apps/api + apps/web) |
| Test database isolation | ✅ | Setiap test suite isolate ke own DB |

**Deliverable**: `docs/plans/epic-6-progress.md` (baris 1–50)

---

## Scope Gelombang 2-4 (Dari §4.6 CORE-ROADMAP.md)

### Gelombang 2 — Employee Placement (Effective-Dated)

**Deliverable**: Employee table + placement history + rules engine

| # | Work Item | Detail | Gate |
|---|---|---|---|
| 1 | Employee Profile table | Migrasi baru: `app_employee_profiles` (Business Partner Individual link, primary effective-dated placement, secondary placement list) | Schema complies AD-0009 (hierarchical scope), composite FK tenant-safe |
| 2 | Placement history | Effective-date tracking: `employee_placements(tenant, employee, placement_start, placement_end, organization_unit_id, department_id, role_code, effective_from)` | Placement audit immutable; backdate via governance only |
| 3 | Primary + Secondary placement | One primary (business-active) placement per employee, with optional secondary (temporary/dotted-line) placements, all effective-dated | Test: can read hierarchy at any point-in-time via `date_at` parameter |
| 4 | Placement rules engine | Validation: no placement without valid active Employee; no placement to inactive Organization Unit; no placement to Organization Unit across Legal Entity; dates don't overlap on same level | Test: all invalid combos rejected; valid combos accepted |
| 5 | Department link | Employee can be assigned Department per placement, but Department is **not** a Data Scope (permission check does NOT use Department) | Test: permission check ignores Department; only role + org-unit + le scope matter |
| 6 | Active placement query | Service to resolve active placement for employee at given date; used by reporting, access context, UI | Test: return correct placement for date range before, inside, after history |

**Assumptions**:
- Employee Profile links to Business Partner (Individual only; Organization type BP cannot be Employee)
- Placement effective-date model reuses `AD_SysConfig` pattern from Epic 8 ✅ **FOUNDER LOCKED 2026-10-01**
- Department is **reporting dimension only**; authorization remains role + org-unit + legal-entity scope

**Blocking decisions**: None — design locked in §4.6; scope clear. ✅ All founder decisions captured 2026-10-01

---

### Gelombang 3 — User + Role Assignment Chain

**Deliverable**: User type + invitation + Role Category + delegation guardrail + same-assignment enforcement

| # | Work Item | Detail | Gate |
|---|---|---|---|
| 1 | User type enum | `type: internal | external | system` (locked in contract; no addition) | Mutation rejects unknown type; query filters per visibility |
| 2 | User <-> Business Partner link | User can be linked to Business Partner (Individual); not every User = Employee, not every Employee = User | Test: create User without BP link (system user); create Employee without login user; both valid |
| 3 | Invitation lifecycle | Create User → send invite code → user accepts/sets password; optional step for internal user; wajib for external | Test: invite sent; invite expired after N days (configurable); used once; second use rejected |
| 4 | Role Category (optional grouping) | Category: e.g. "Finance", "Operations", "Support" (tenant-configurable; bukan scope); category is UI organization only | Mutation allows role without category; UI can group role by category; permission check doesn't use category |
| 5 | Delegation guardrail | Admin Tenant cannot assign role/scope beyond their own authority bounds (inherited from Epic 1/4 pattern) | Test: Admin OU1 cannot assign scope OU2 or higher scope; rejection 403 |
| 6 | Same-assignment enforcement | Permission + scope must come from **same** `user_role_assignment` row. Never combine perm from role A + scope from role B | Test: permission from role A (scope OU1) + scope from role B (scope OU2) rejected as mismatched; both from same assignment accepted |
| 7 | Authorization-effective view (expanded) | Session context carries user type, active role, **and all active placement data** (organization_unit, department, effective_from date) | Test: session context resolves correctly when placement changes mid-day (reads correct hierarchy for time-of-query) |
| 8 | User + assignment UI (Epic 4 sync) | Update Epic 4 User/Assignment screens to show new scope type (legal_entity) + Department (display-only); no role categorization needed for UI yet | Coordinate with Epic 4 review; test UI doesn't break on new fields |

**Assumptions**:
- User invitation is optional (internal user can be created active immediately)
- Role Category is **display grouping**, not authorization boundary
- Same-assignment enforcement applies retroactively to all existing assignments

**Blocking decisions**: 
- User invitation flow may require email backend (check if already available) ⏳ **TBD during implementation**
- Role Category display may need UI update (minor, not core to authorization) — **deferred to after Epic 4 review**

---

### Gelombang 4 — Tax Registration + Import/Export + Merge/Split

**Deliverable**: Tax ID collection + Excel import + merge/split with audit

| # | Work Item | Detail | Gate |
|---|---|---|---|
| 1 | Tax Registration collection (expanded) | Migrasi: `app_tax_registrations(tenant, business_partner, tax_type_code, tax_id, jurisdiction, effective_from, effective_to, status, verified_at, verified_by)` | Supports NPWP, NITKU, PPN, BPJS, custom per jurisdiction; no single tax_id field |
| 2 | NPWP/NITKU default (Indonesia) | Seed `tax_types` table with NPWP, NITKU; validation: NPWP 15 digit, NITKU 16 digit (or regex per locale) | Validation rejects malformed NPWP/NITKU; lookup by type+country+id |
| 3 | Excel/CSV import template | Template: BP code, name, type, NPWP, NITKU, address, other fields matching import config | Test: valid aggregates imported; invalid aggregates fail with source location + reason |
| 4 | Partial success per aggregate | Kontrak §4.6 terkunci: transaction per aggregate. Satu aggregate gagal rollback; aggregate lain tetap dapat berhasil. File hasil validasi mengembalikan lokasi sumber dan error terarah. | Test: satu aggregate invalid tidak tersimpan; aggregate valid tetap tersimpan; hasil validasi lengkap dan teraudit |
| 5 | Merge BP (preview + audit) | UI preview: select source + target BP; show: data conflicts, assigned users, placed employees, permissions that will consolidate, transactions that will re-link. User confirms → execute | Test: merge writes audit event; source BP becomes tombstone/alias; all FK points to target; transaction re-link visible in audit |
| 6 | Split BP (undo-merge + new) | Create new BP from partial data of existing; e.g. split Organization into sub-divisions. Historic transactions stay with original; future can choose | Test: split writes audit; creates new BP; FK from future date onwards points to new BP; old data readable via alias |
| 7 | Tombstone/alias on merge/split | Merged BP marked `deleted` + `merge_target_id`; split BP marked with `split_source_id`. History immutable; lookups can follow alias for reporting | Test: historical query finds old BP via alias; current query finds new/current BP |
| 8 | Audit trail for merge/split | Records: actor, effective date, before-data summary, after-data summary, transaction re-link count, user reassignment count, reason | Test: audit entries show in chronological order; reason and actor recorded; no silent changes |

**Assumptions**:
- Excel import is done in batches; no streaming large file; timeout ~30s per batch ✅ **FOUNDER LOCKED 2026-10-01: 5000 rows, 30s timeout**
- Merge/split follows locked contract: Admin Tenant can propose split; Super Admin executes merge/split ✅ **LOCKED in §4.6**
- Tax type definitions are platform-owned (NPWP, NITKU, etc.); tenant can add custom types ✅ **FOUNDER LOCKED 2026-10-01: Indonesia only (NPWP, NITKU)**

**Blocking decisions**: 
✅ **ALL RESOLVED 2026-10-01**
- Batch size and timeout: **5000 rows, 30s timeout**
- Tax type localization: **Indonesia first (NPWP, NITKU)**
- Import validation result file format: Standard Excel validation report (TBD implementation detail, not blocking start)

---

## Gate Before Each Gelombang Starts

### Pre-Gelombang 2
- [x] ✅ Confirm Employee placement effective-date model with founder → **Epic 8 pattern (locked 2026-10-01)**
- [x] ✅ Confirm Department role in reporting/scope → **Flat hierarchy, reporting-only, no scope impact (locked 2026-10-01)**
- [ ] Database isolated test ready (`abixell_one_epic6_g2` or similar)

### Pre-Gelombang 3
- [ ] User invitation backend available (email service, or mock for test?)
- [ ] Same-assignment enforcement audit ready (can track violations retroactively)
- [ ] Epic 4 review completed + UI sync window scheduled

### Pre-Gelombang 4
- [x] Merge/split approval owner — **sudah terkunci di §4.6**: Merge hanya Super Admin; Split: Admin Tenant mengusulkan, Super Admin mengeksekusi
- [x] ✅ Localization for tax types → **Indonesia only: NPWP, NITKU (locked 2026-10-01)**
- [x] ✅ Import batch size + timeout → **5000 rows, 30s timeout (locked 2026-10-01)**
- [ ] Excel import template finalized; test with sample data

---

## Recommended Work Order

1. **Gelombang 2 first** (Employee placement)
   - Least dependent on external decisions
   - Foundation for Gelombang 3 (placement data in context)
   - Estimate: 3-4 sprint cycles (~9 migrations, ~200 tests)

2. **Gelombang 3 next** (User + Role Assignment)
   - Builds on Gelombang 2 placement
   - Coordinate with Epic 4 UI (low risk, mostly read-only display)
   - Estimate: 4-5 sprint cycles (~6 migrations, ~150 tests)

3. **Gelombang 4 last** (Tax Registration + import/merge)
   - Least critical path item (import/merge are admin-only)
   - Highest dependency on founder decision (approval model)
   - Estimate: 3-4 sprint cycles (~3 migrations, ~120 tests)

---

## Risk Mitigation

| Risk | Mitigated By |
|---|---|
| Placement dates overlap or invalid | Validation rule + trigger; test coverage |
| Department used as scope (mistake) | Code review + no Department in authorization check; test isolates Department data |
| User without Business Partner / Employee without User | Schema design + validation; both are optional; test covers each case |
| Merge silently breaks transactions | Relink audit event + FK constraint + test historical query |
| Import batch corrupts BP data | All-or-nothing rollback + validation before write |

---

## Deliverables (After All Gelombang 2-4 Complete)

1. `epic-6-g2-employee-placement.md` — implementation notes + gate verification
2. `epic-6-g3-user-role-assignment.md` — implementation notes + gate verification  
3. `epic-6-g4-tax-import-merge.md` — implementation notes + gate verification
4. Update `docs/plans/CORE-ROADMAP.md` §4.6 with final **DONE** status + gate checklist
5. Update `FINAL-REPORT.md` with Epic 6 final status

---

## Founder Decisions — LOCKED 2026-10-01

| # | Question | Decision | Source |
|---|---|---|---|
| 1 | Placement effective-date model | Epic 8 pattern (System→Client→Organization) | ✅ Founder 2026-10-01 |
| 2 | Department hierarchy | Flat (single level) | ✅ Founder 2026-10-01 |
| 3 | Tax type localization | Indonesia only (NPWP, NITKU) | ✅ Founder 2026-10-01 |
| 4 | Import batch size & timeout | 5000 rows, 30s timeout | ✅ Founder 2026-10-01 |
| 5 | Merge/split approval | Super Admin executes (Admin Tenant proposes split) | Locked in §4.6 |

---

**Next action**: Begin Gelombang 2 (Employee Placement) implementation immediately. All blocking questions resolved.


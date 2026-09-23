# HANDOFF — Abixell One (Current)

| | |
|---|---|
| **Tanggal Handoff** | 2026-09-15 |
| **Project** | Abixell One |
| **Organisasi** | Insting Tekno Sinergi |
| **Current Branch / HEAD** | `master` @ `7b66c65` — feat(scm): decompose SCM monolith into WMS and Procurement modules |
| **Previous Baseline** | `master` @ `63e43d1` — Phase 11F access-lifecycle runtime closure |
| **Runtime Evidence** | `master` @ `7b66c65` — 586/586 API tests · 39 test files · Platform boundary validation: 0 blockers · 1 advisory · 149 migration-owned permissions |
| **Canonical Baseline** | Product Roadmap / Progress **v1.19** |
| **Progress** | Core Product Readiness **100.0%** · Full Approved Roadmap **51.0%** |
| **Active Phase** | Wave A5.1 SCM Decomposition — **COMPLETED and MERGED** |
| **Status workspace** | Clean working tree — no uncommitted changes |
| **Primary Source** | `docs/canonical/product-roadmap.md` · `docs/canonical/product-progress.md` |

> **Operational Database Constraint (Preserved Verbatim):**
> Do not stop or modify native PostgreSQL and do not use docker compose down -v.

---

## Executive Summary

**Wave A5.1 Supply Chain Module Decomposition** has been completed, tested, committed, and merged into `master`. The monolithic Supply Chain Advanced service and repository have been decomposed into two domain-driven bounded contexts:

1. **Warehouse Management (WMS)** — 36 tables, 12 domain services, canonical `/wms/*` routes
2. **Procurement Management** — 12 tables, 5 domain services, canonical `/procurement/*` routes

Legacy `/supply-chain/advanced/*` routes remain operational with RFC-8594 deprecation headers. Frontend navigation and API client have been migrated to canonical routes with workflow-envelope response normalization.

**All verification gates have passed:**
- 586/586 automated tests ✅
- Platform boundary validation: 0 blockers ✅
- TypeScript typecheck: passed ✅
- Lint: 0 errors, 45 warnings ✅
- Production build: passed ✅
- PWA validation: passed ✅
- E2E smoke: all 10 journeys ✅
- Browser console: no errors ✅

---

## 1. Project Goals and Positioning

**Abixell One** is an **Integrated Enterprise Management System** positioned internally as a whitelabel product, multi-tenant-ready, but deployed as dedicated per client.

**Binding principle:**
> Build Once. Configure Per Client. Deploy Exclusively.

The platform consolidates business domains into five approved layers:

1. **Platform Core** — technical foundation and client-agnostic platform contracts
2. **Business Core** — minimum usable business capabilities (100% complete)
3. **Advanced Capability** — optional per-module depth (51% complete, 180/353 points)
4. **Client Configuration** — configuration without source code changes
5. **Client Extension** — single-client code/integration outside product denominator

**Client-facing positioning:** *Designed Around Your Business.*

Internal terminology (whitelabel, shared core, reusable platform, product core, multi-tenant) must never appear in client-facing UI, email, reports, PDFs, domains, or documentation (ADR-0003).

---

## 2. Wave A5.1 SCM Decomposition — Technical Details

### Bounded Contexts and Database Ownership

The previous monolithic Supply Chain Advanced service managed 55 SCM-related tables across three conceptual domains. Wave A5.1 decomposes these into explicit bounded contexts:

| Bounded Context | Tables | Services | Canonical Route |
|---|---:|---:|---|
| **Warehouse Management (WMS)** | 36 | 12 | `/wms/*` |
| **Procurement Management** | 12 | 5 | `/procurement/*` |
| **Shared Master Data** | 7 (read-only ports) | — | `/items`, `/suppliers`, `/purchase-requests`, `/purchase-orders` |
| **Legacy Compatibility Shim** | — | — | `/supply-chain/advanced/*` (RFC-8594 deprecation) |

### Warehouse Management (WMS) Module

**Domain Services** (`apps/api/src/modules/supply-chain/warehouse/application/`):
- `warehouse-topology.service.ts` — physical warehouse topology, zones, locations
- `item-tracking.service.ts` — batches, serials, SKU tracking
- `stock-ledger.service.ts` — immutable append-only movement ledger (19 movement types)
- `reorder-reservation.service.ts` — reservations, reorder points, policies
- `transfer-opname.service.ts` — inter-warehouse transfers, physical stock count
- `valuation.service.ts` — FIFO valuation, landed-cost allocation (exact arithmetic)
- `receiving-inspection.service.ts` — goods receipt, acceptance, quality checks
- `returns-reversals.service.ts` — returns, reversals, replacements with ledger compensation
- `consignment.service.ts` — consignment stock tracking
- `disposal.service.ts` — disposal, write-off, scrap
- `warehouse-task.service.ts` — picking, packing, shipping tasks
- `accounting-event.service.ts` — accounting-ready event emission (ADR-0023 boundary)

**Domain Policies:**
- `valuation-policy.ts` — FIFO exact-value arithmetic, landed-cost allocation
- Immutable ledger: corrections via compensating transactions
- No negative stock in Core (overdraft is Advanced policy)

**Route Registrar:**
```ts
export function registerWmsRoutes(
  app: FastifyInstance,
  deps: WmsRouteDeps,
  prefix = "/wms"
): void
```

### Procurement Management Module

**Domain Services** (`apps/api/src/modules/supply-chain/procurement/application/`):
- `rfq-bidding.service.ts` — RFQs, tendering, supplier invitations, bid submission, bid scoring
- `supplier-governance.service.ts` — quarterly supplier KPI evaluations, scorecard weighting, rating grades
- `supplier-contract.service.ts` — blanket/master purchase contracts, spend tracking
- `service-acceptance.service.ts` — Service Entry Sheets (non-goods procurement), accounting dimension freeze
- `spend-analytics.service.ts` — spend analysis, trend reporting

**Domain Policies:**
- `evaluation-policy.ts` — supplier weighted scorecard:
  - Quality: 35%, Delivery: 30%, Pricing: 20%, Service: 15%
  - Maps scores 0–100 to rating grades A–E

**Route Registrar:**
```ts
export function registerProcurementRoutes(
  app: FastifyInstance,
  deps: ProcurementRouteDeps,
  prefix = "/procurement"
): void
```

### Anti-Corruption Ports

Created under `apps/api/src/modules/supply-chain/ports/`:
- **`shared-master-data-read-port.ts`** — WMS and Procurement read from shared master data
- **`accounting-event-write-port.ts`** — WMS and Procurement emit accounting-ready events (ADR-0023)
- **`unit-of-work.ts`** — transactional persistence coordination
- Implementations: `shared-master-data.port.pg.ts`, `accounting-event.port.pg.ts`

### Legacy Compatibility Shim

**File:** `apps/api/src/modules/supply-chain/advanced/api/supply-chain-advanced.routes.ts`

The shim:
1. Registers WMS and Procurement registrars under `/supply-chain/advanced` prefix
2. Adds RFC-8594 deprecation headers **only** to legacy requests:
   - `Deprecation: true`
   - `Sunset: Wed, 31 Dec 2026 23:59:59 GMT`
   - `Link: </wms>; rel="successor-version", </procurement>; rel="successor-version"`
3. Preserves account-assignment configuration routes (cross-cutting shared master data)

**Semantic guarantee:** Canonical and legacy URLs execute identical handlers.

### Frontend API Migration

**File:** `apps/web/src/lib/api.ts`

Migrated client bindings from `/supply-chain/advanced/*` to canonical `/wms/*` and `/procurement/*` routes.

**Workflow Response Normalization:**
Backend returns envelopes; frontend unwraps before components:
```ts
// Backend response
{ rfq?: ScmRfq, status: EntityWorkflowStatus | null }[]

// Frontend normalized output
ScmRfq[]
```

**Applied to:** RFQs, stock transfers, opnames, supplier evaluations, supplier contracts, and related operations.

### Frontend Navigation

**File:** `apps/web/src/lib/capabilities.ts`

Added capability modules:
- `warehouse_management` (activated: true)
- `procurement_management` (activated: true)

Master data remains under `supply_chain`.

---

## 3. Verification Results

### API Test Suite

```
39 test files
586 tests
0 failures
✅ PASSED
```

### Platform Boundary Validation

```
Blocking findings: 0
Advisory findings: 1 (expected Manifest advisory — ADR-0014)
Migration-owned permissions: 149
✅ PASSED
```

### Quality Gates

```
TypeScript typecheck:  ✅ PASSED
Lint:                  ✅ PASSED (0 errors, 45 warnings)
Production build:      ✅ PASSED
PWA validation:        ✅ PASSED
E2E smoke tests:       ✅ PASSED (all 10 journeys)
Browser console:       ✅ CLEAN (0 errors)
```

---

## 4. Git History and Merge

| | |
|---|---|
| **Feature Branch** | `feat/scm-wms-procurement-decomposition` |
| **Commit SHA** | `7b66c65a9a595c970abcb869bc12ffa1e36456db` |
| **Changes** | 75 files, 11,966 insertions(+), 1,324 deletions(-) |
| **Merge Operation** | Fast-forward from `d9a5e82` to `7b66c65` |
| **Conflicts** | None |
| **Branch Status** | Deleted after merge |
| **Working Tree** | **Clean** |

---

## 5. Issues Encountered and Fixed

| Issue | Cause | Resolution | Status |
|---|---|---|---|
| RFQ numbering sequence missing | Format validation expected `{SEQ}` or `{SEQ:n}` | Created sequence: `RFQ-{YYYY}-{SEQ:5}` | ✅ Fixed |
| RFQ workflow undefined | `stepType: "terminal"` invalid; no published version | Fixed step types; published version 1 | ✅ Fixed |
| Modules inactive | `isActive: false` in module catalog | Activated via configuration API | ✅ Fixed |
| DataTable crash | Backend envelopes reached flat-array formatters | Unwrapped in API client normalization | ✅ Fixed |

All issues resolved before merge.

---

## 6. Architecture Decisions (Binding)

Wave A5.1 adheres to existing architectural decisions:

| Decision | Summary | Reference |
|---|---|---|
| **Bounded Contexts** | WMS and Procurement are explicit DDD contexts | ADR-0013, ADR-0014 |
| **Immutable Ledger** | Stock movements append-only; corrections via compensating transactions | Phase 4 §19 |
| **FIFO Valuation** | Exact-value scaled-integer arithmetic | Phase 5 §41 |
| **Supplier Scoring** | Weighted scorecard (Quality 35%, Delivery 30%, Pricing 20%, Service 15%) | Procurement policy |
| **RFC-8594 Deprecation** | Legacy routes marked with Deprecation, Sunset, Link headers | HTTP standard |
| **Workflow Engine Generic** | All domain lifecycles use centralized Workflow Engine | ADR-0013 |
| **Accounting Events** | WMS and Procurement emit to accounting outbox (ADR-0023) | ADR-0023, Phase 6 |
| **No Negative Stock in Core** | Overdraft is Advanced capability, not default | Phase 4 §19 |

---

## 7. New and Modified Files

### New Modules

```
apps/api/src/modules/supply-chain/warehouse/         (36 tables, 12 services)
apps/api/src/modules/supply-chain/procurement/       (12 tables, 5 services)
apps/api/src/modules/supply-chain/ports/             (anti-corruption interfaces)
```

### Database Migrations

```
apps/api/migrations/1783000000000_wave-a5-1-stage-2.cjs
apps/api/migrations/1784000000000_wave-a5-1-stage-3-module-catalog.cjs
```

### Frontend Updates

```
apps/web/src/lib/api.ts                      (canonical routes, response normalization)
apps/web/src/lib/capabilities.ts             (WMS and Procurement modules)
apps/web/e2e/smoke.mjs                       (added canonical page tests)
```

### Composition and Configuration

```
apps/api/src/app.ts                          (route registrar imports and registration)
apps/api/src/composition-root.ts             (service/repository composition)
```

### Tests

```
apps/api/tests/integration/                  (WMS and Procurement test coverage)
apps/api/tests/procurement-evaluation-policy.test.ts
apps/api/tests/wms-valuation-policy.test.ts
```

---

## 8. Runtime Stack

| Layer | Technology |
|---|---|
| **Runtime** | Node.js ≥ 20 |
| **Language** | TypeScript (strict mode) |
| **API** | Fastify 5 |
| **Frontend** | React 18 + Vite 5 |
| **Database** | PostgreSQL 16 |
| **Data Access** | node-postgres + node-pg-migrate |
| **Testing** | Vitest + Playwright |
| **Validation** | ESLint, TypeScript, platform-boundary validator, PWA validator |

---

## 9. Testing and Validation Commands

### Fresh Setup

```bash
npm ci
npm run db:up
cp apps/api/.env.example apps/api/.env
npm run migrate -w apps/api
npm run seed -w apps/api
npm run sync-permissions -w apps/api
```

### Development

```bash
npm run dev:api      # http://localhost:4000
npm run dev:web      # http://localhost:5173
```

### Validation Gate

```bash
npm run validate     # runs: boundaries · lint · typecheck · test · build · pwa · security
```

### E2E Smoke

```bash
npm run e2e -w apps/web
```

---

## 10. Next Steps

No active phase. Wave A5.1 is complete and merged.

**Founder must authorize:**
1. **Advanced Wave A1–A8** — per business priority
2. **Governed administration increment** — user provisioning, role UI
3. **Builder/package/installer runtime** — requires separate authorization (ADR-0014)
4. **Client-specific configuration** — not counted toward progress
5. **Documentation reconciliation** — README, Blueprint, Debt Register

---

## 11. Unchangeable Items

### ❌ Must Not Change Without Authorization

- Five-layer product model and dedicated-per-client principle
- Denominator roadmap and canonical progress metrics
- Tenant isolation, permission, and Data Scope semantics
- Workflow-owned business lifecycles
- Single ordered migration stream
- Decimal-string money representation (no IEEE-754 binary floating point)
- Finance/Asset immutable-ledger behavior
- Static, explicit, reviewable composition
- Business Admin/Builder trust-plane separation

### ❌ Specifically Forbidden

- Runtime plugin loading from Manifest
- Dynamic code loading without authorization
- Package-owned independent migration streams
- Direct production schema editing
- Arbitrary SQL/query/script/expression-DSL Builder surface
- Authorization bypass or cross-client admin access

### ⚠️ High-Risk Areas

- **Migration stream** — Single ordered sequence; use `migrate:create` only
- **Composition-root.ts** — All runtime registrations must be explicit
- **WMS/Procurement ports** — Anti-corruption boundaries must be respected
- **Workflow engine** — All domain lifecycles must route through centralized engine
- **Event/outbox** — Business mutation + event write not all transactional

### ✅ Safe to Do

- Add test coverage without changing behavior
- Fix documentation drift
- Complete UX/technical debt additively
- Migrate code Phase 0–1 to module-first layout (one module at a time)
- Activate Advanced capabilities per Founder authorization
- Run `sync-permissions` after adding permissions

---

## 12. Key Reference Files

### Canonical Documents (Authority)

| File | Purpose | Version |
|---|---|---|
| `docs/canonical/product-blueprint.md` | Binding architecture and layer model | v1.1 |
| `docs/canonical/product-roadmap.md` | Phase/gate status, unit definitions | v1.19 |
| `docs/canonical/product-progress.md` | Official progress metrics, evidence | v1.19 |
| `docs/canonical/documentation-map.md` | Documentation authority ordering | Current |

### Architecture Decisions

| File | Scope |
|---|---|
| `docs/adr/0001-*.md` through `0014-*.md` | Binding decisions (ADR-0014: Platform Kernel, static packages, governed builder) |
| `docs/decision-log.md` | Checkpoint-by-checkpoint decisions (referenced by 15+ source comments) |

### Wave A5.1 Artifacts

- `apps/api/src/modules/supply-chain/warehouse/` — WMS bounded context
- `apps/api/src/modules/supply-chain/procurement/` — Procurement bounded context
- `apps/api/src/modules/supply-chain/ports/` — Anti-corruption port interfaces
- `apps/api/migrations/1783000000000_*.cjs`, `1784000000000_*.cjs` — Database migrations

---

## Handoff Sign-Off

✅ Wave A5.1 SCM Decomposition scope and implementation  
✅ Canonical WMS and Procurement bounded contexts  
✅ RFC-8594 legacy deprecation compatibility  
✅ Frontend workflow response normalization  
✅ 586/586 automated tests passing  
✅ Platform boundary validation: 0 blockers  
✅ Commit `7b66c65` fast-forward merged to `master`  
✅ Clean working tree  
✅ PostgreSQL constraint preserved  
✅ Phase 11F governance foundation intact  

**Status:** Ready for next phase authorization.

---

**Last Updated:** 2026-09-15  
**Prepared by:** Claude Code  
**Repository:** abixell-one (D:\Abixell One - By Insting Tekno Sinergi\abixell-one)  
**Master Commit:** `7b66c65a9a595c970abcb869bc12ffa1e36456db`

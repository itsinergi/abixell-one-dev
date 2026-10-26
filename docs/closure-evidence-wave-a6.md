# Wave A6 Closure Evidence: WP-FIN-A6-01 through WP-FIN-A6-06

**Status:** All seven A6 build units merged. API-first closure complete.  
**Date:** 2026-10-26  
**Scope:** Finance Advanced, six work packages across seven build units (ADR-0016, ADR-0019, ADR-0021, ADR-0022).

## Delivered

| Unit | Work package | Commit | PR | Migrations |
|---|---|---|---|---|
| A6-01 | Fiscal close and ledger governance | `e54d76c` | #42 | `1795100000000`, `1795100000010` |
| A6-02 | Open item settlement and aging | `010ba93` | #57 | `1795200000000`, `1795200000010` |
| A6-03 | Budget control | `009c8a4` | #58 | `1795300000000`, `1795300000010` |
| A6-04 | Bank reconciliation | `0ed302c` | #59 | `1795400000000`, `1795400000010` |
| A6-05 | Fixed asset depreciation | `f394209` | #61 | `1795500000000`, `1795500000010`, `1795500000020` |
| A6-06a | Indonesia tax baseline | `7f87018` | #62 | `1795600000000`, `1795600000010` |
| A6-06b | Consolidation | `8bb062a` | #63 | `1795700000000`, `1795700000010` |

Migration head after Wave A6 closure: `1795700000010_wave-a6-06b-dictionary-seed`. The 15 migrations listed above are Wave A6's own. Wave A6.1 adds one more, `1795800000000_wave-a6-1-finance-advanced-routes`, which is now the head.

Capabilities delivered per unit:

- **A6-01**: Month-end and year-end close with runbook attestations, fiscal closing records, and multi-ledger governance per legal entity.
- **A6-02**: Open items by side, partial and full allocation, allocation reversal, and aging buckets.
- **A6-03**: Budget versions, budget lines, consumption and release, utilization reporting, and budget policy gates.
- **A6-04**: Bank accounts, statement import, statement lines, match candidates, matches with reversal, period movement, and reconciliation close.
- **A6-05**: Asset books with one book per asset and book code, draft to active to disposed lifecycle, append-only capitalization, transfer, impairment, and disposal events, versioned straight-line depreciation with integer-cent arithmetic, immutable depreciation runs with idempotency and period guards, and linked reversal runs.
- **A6-06a**: Tax registrations, tax rules with version actions, and tax calculations.
- **A6-06b**: Consolidation groups with members and actions, FX rate sets with rates, translation runs, eliminations with actions, and financial statement version lines.

Cross-cutting invariants held by every unit:

- The Accounting Kernel remains the sole GL writer. No A6 module writes journals directly.
- Money is a string in and out. Dates follow `YYYY-MM-DD`. All amounts settle at two decimal integer cents.
- Every mutation is authorized through the existing `finance.accounting.*` permission family and audited.
- Tenant isolation and organization Data Scope reuse existing paths. No A6 service reads another module's tables directly.
- Every route is registered in the Finance capability catalog and mapped to an existing Window. No new Window code was introduced by Wave A6.

## Evidence

| Check | Result |
|---|---|
| API typecheck (`apps/api`, `npx tsc --noEmit`) | PASS |
| Focused integration suite, `accounting-kernel-fiscal-close.test.ts` | PASS, 8/8 |
| Focused integration suite, `accounting-open-item-settlement.test.ts` | PASS, 13/13 |
| Focused integration suite, `accounting-budget-control.test.ts` | PASS, 12/12 |
| Focused integration suite, `accounting-bank-reconciliation.test.ts` | PASS, 22/22 |
| Focused integration suite, `accounting-asset-depreciation.test.ts` | PASS, 36/36 |
| Focused integration suite, `accounting-tax-baseline.test.ts` | PASS, 21/21 |
| Focused integration suite, `accounting-consolidation.test.ts` | PASS, 32/32 |
| **Focused integration total** | **PASS, 144/144** |
| Route registrations under `/accounting/*` | 88 across 81 unique paths, all mapped to an existing Window |
| Database migrations | PASS, 15 migration files applied in order through `1795700000010` |
| Platform boundary validator | PASS, no blocking findings |
| Route registry parity (`route-registry-parity.test.ts`) | PASS, 8/8 |
| Menu seed parity (`menu-seed-parity.test.ts`) | PASS, 10/10 |

## Menu catalog entries (Wave A6.1)

Wave A6 shipped API-first, so every `/accounting/*` route existed but nothing in the product pointed at it. A6.1 adds the two pages that read the kernel back, plus their catalog rows.

| Page | Path | Permissions | Menu code | Window code |
|---|---|---|---|---|
| Accounting | `/finance/accounting` | `finance.accounting.read`, `finance.accounting.configure` | `nav-finance-finance-accounting` | `route:/finance/accounting` |
| Financial Statements | `/finance/statements` | `finance.accounting.read` | `nav-finance-finance-statements` | `route:/finance/statements` |

Both hang under the existing Finance folder (`nav-finance`) at sequence 40 and 50, after Cash & Bank at 30. Order here is the order `NAV_SECTIONS` declares, and the parity test compares the two.

Four artifacts have to agree, and each pair is enforced by a test:

| Layer | File | Enforced by |
|---|---|---|
| React route | `apps/web/src/App.tsx` | route registry parity |
| Browser mirror | `apps/web/src/lib/routeRegistry.ts` | `tests/route-registry-parity.test.ts` |
| Server registry | `apps/api/src/domain/configuration/route-registry.ts` | `tests/route-registry-parity.test.ts` |
| Window catalog | `config_route_window_seed()` via `1795800000000` | route registry parity |
| Menu catalog + nav | `config_menu_seed()` via `1795800000000`, `NAV_SECTIONS` in `apps/web/src/lib/capabilities.ts` | `tests/menu-seed-parity.test.ts` |

What the two pages read, all read-only:

- **Accounting**: periods, fiscal closings, ledgers, chart versions, accounts. Legal entity is a required picker because kernel records are per-entity and `/accounting/ledgers` rejects a call without one.
- **Financial Statements**: aging (AR/AP by side, as-of date, currency), journals, posted GL entries, consolidation groups, translation runs, eliminations, and statement line versions.

Every mutation stays on the API. These are read surfaces; no screen in A6.1 writes a journal, closes a period, or posts an elimination.

Deliberate details in `1795800000000`:

- No permission is introduced. `finance.accounting.read` and `finance.accounting.configure` already exist (`1792000000000`) and are what the kernel services actually check, so the client gate matches the server.
- Both catalogues keep their prior version under a dated name (`config_route_window_seed_epic4`, `config_menu_seed_epic3`) and the canonical name is redefined as that snapshot UNIONed with the new rows. `UNION`, not `UNION ALL`, so a duplicate code cannot be silently absorbed by `ON CONFLICT DO NOTHING` and stay invisible.
- Existing tenants are backfilled by two scoped statements keyed on the two new codes, not by replaying `config_seed_menus_for_tenant()`. The dev database holds 2617 tenants and 165,243 `app_menus` rows, where the full replay does not finish. New tenants still seed complete, because both tenant triggers call the catalogue by name at execution time.
- The terminology seed (`1787500000000`) wrote one key per menu code as the catalogue stood then. These two menus get no terminology key and no allowlist entry, so no tenant can rename them yet. That is deliberate: which labels are tenant-overridable is a separate decision.

## Deliberate boundary

Finance Advanced screens were not part of Wave A6 API-first scope. Wave A6.1 answers that with two read-only pages, recorded above. What A6.1 still does not do: no mutation UI (period close, journal entry, elimination posting, budget setup, bank statement import, asset lifecycle), no per-page deep links into a single period or journal, and no consolidation group editing. Those remain open. Wave A6's own boundary is the API, persistence, authorization, ledger, and verification surface delivered by the seven build units.

## Closure status

Every A6 unit is merged to `master`. Documentation reconciliation landed as `a8e6ed5` (#64) and `00c9764` (#65). No A6 code remains uncommitted.

**Kesimpulan Indonesia:** Seluruh tujuh unit Wave A6 (A6-01 sampai A6-06b) sudah digabung ke `master` dengan SHA dan nomor PR tercatat di atas. Total 144 tes integrasi terfokus lulus, 88 pendaftaran rute `/accounting/*` pada 81 path unik sudah punya Window, dan 15 berkas migrasi terpasang sampai kepala `1795700000010`. Wave A6.1 kemudian menambahkan dua halaman baca-saja, `/finance/accounting` dan `/finance/statements`, beserta entri menu katalognya lewat migrasi `1795800000000`; menu katalog yang dilayani naik dari 57 ke 59 baris dan katalog Window dari 71 ke 73 baris. Dua uji paritas lulus (8/8 dan 10/10) dan kedua typecheck bersih. Yang belum ada: antarmuka mutasi, tautan dalam ke satu periode atau jurnal, dan penyuntingan grup konsolidasi.

## For future agent

Wave A6 API-first closure is complete and merged; the merged commits are the authority, not this document. Wave A6.1 is now partly built: two read-only pages exist and the catalog rows that point at them exist, but the mutation surface does not, so do not describe Finance Advanced as operational.

When adding a Finance Advanced page, five artifacts must change together: `ROUTE_REGISTRY` in `apps/api/src/domain/configuration/route-registry.ts`, `routeRegistry.ts` in the web mirror, `App.tsx`, the route window seed, and the menu seed. The last two live in a migration that follows the snapshot pattern in `1795800000000`: rename the current canonical function to a dated name, then redefine the canonical name as that snapshot UNIONed with the new `VALUES` rows. Miss any one of the five and a parity test fails.

Two traps that cost time here:

- A page menu cannot precede its route window. `app_menus_summary_target_check` requires a non-summary menu to carry a `window_id`, and the seed resolves that by joining the route window code.
- Do not backfill existing tenants by calling `config_seed_menus_for_tenant()`. It replays the whole catalogue once per tenant. The dev database has 2617 tenants, and the statement does not finish. Write two scoped INSERTs keyed on the new codes instead.

`npm run migrate` is broken on this machine for an unrelated reason: node-pg-migrate cannot parse a Windows drive-letter path (`ParseError: D:\: Unexpected token, expected ","`). It fails from any working directory, so it is not a cwd problem. A short runner that `require`s the migration module, collects the strings passed to `pgm.sql()`, and executes them through `pg` works. Run it from the repository root as a scratch file and delete it afterwards; it is not part of the tree.

```js
const { Client } = require("pg");
require("dotenv").config({ path: "apps/api/.env" });
const mod = require(process.cwd() + "/apps/api/migrations/<file>.cjs");
const stmts = [];
mod.up({ sql: (s) => stmts.push(s) });
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  for (const s of stmts) await c.query(s);
  await c.query("INSERT INTO pgmigrations(name, run_on) VALUES ($1, now())", ["<file>"]);
  await c.end();
})();
```

Wrap the statement loop in a transaction if the migration must be all-or-nothing; the version above does not, which is why a killed run can leave the functions renamed but the catalogue not extended. If a run is abandoned, check `pg_stat_activity` for a still-connected backend before retrying, and terminate it, since it holds locks on the tables the retry needs.

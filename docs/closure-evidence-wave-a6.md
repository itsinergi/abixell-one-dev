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

Migration head after Wave A6 closure: `1795700000010_wave-a6-06b-dictionary-seed`. The 15 migrations listed above are Wave A6's own. Wave A6.1 adds `1795800000000_wave-a6-1-finance-advanced-routes` and Wave A6.2 adds `1795900000000_wave-a6-2-finance-advanced-write-routes`; the latter is now the head.

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
- The terminology seed (`1787500000000`) wrote one key per menu code in the catalogue as it stood then, and `tests/menu-terminology.test.ts` asserts that the allowlist and the catalogue hold the same number of rows. That assertion is the point: a menu with no key would be a label no tenant could ever override, and a key with no menu would be a term pointing at nothing. So these two menus get `menu.<code>.name` and `menu.<code>.description` keys and their allowlist rows, and they are tenant-overridable exactly like every other menu. This was caught by CI on the first push, not by review: the first version of the migration extended the catalogue alone and the test failed on `expected 57 to be 59`. The same migration must extend both catalogues or neither.

## Menu catalog entries (Wave A6.2)

A6.1 left the mutation surface open, which is six of the six FIN-ADV write units. A6.2 adds one page per unit and the catalog rows that point at them.

| Page | Path | Unit | Permissions | Menu code | Seq |
|---|---|---|---|---|---|
| Journals | `/finance/journals` | FIN-ADV-001 | `finance.accounting.read`, `.manage` | `nav-finance-finance-journals` | 60 |
| Open Items | `/finance/open-items` | FIN-ADV-002 | `finance.accounting.read`, `.configure` | `nav-finance-finance-open-items` | 70 |
| Budgets | `/finance/budgets` | FIN-ADV-003 | `finance.accounting.read`, `.configure` | `nav-finance-finance-budgets` | 80 |
| Bank Reconciliation | `/finance/bank-recon` | FIN-ADV-004 | `finance.accounting.read`, `.configure` | `nav-finance-finance-bank-recon` | 90 |
| Fixed Assets | `/finance/fixed-assets` | FIN-ADV-005 | `finance.accounting.read`, `.configure` | `nav-finance-finance-fixed-assets` | 100 |
| Tax | `/finance/tax` | FIN-ADV-006 | `finance.accounting.read`, `.configure` | `nav-finance-finance-tax` | 110 |

All six hang under the existing Finance folder (`nav-finance`), continuing after the A6.1 pair at 40 and 50, so the folder reads Transactions, Cashflow, Cash & Bank, Accounting, Financial Statements, Journals, Open Items, Budgets, Bank Reconciliation, Fixed Assets, Tax.

Each permission pair is the one the service layer actually checks, not a broader one that happens to imply it: `finance.accounting.manage` for the kernel, `finance.accounting.configure` for open items, budgets, bank reconciliation, asset books, and tax. Every row also accepts `finance.accounting.read`, because every one of the six lists before it writes. No permission was introduced and no `role_permissions` row was written; these five were seeded by `1792000000000`.

`FIN-ADV-007` (consolidation) and `FIN-ADV-008` (financial statements) stay read-only surfaces on `/finance/statements`. That is the boundary, not a gap: ADR-0022 puts consolidation posting behind the kernel with approval runtime ownership, and no page writes it.

## Evidence (Wave A6.2)

| Check | Result |
|---|---|
| Web typecheck (`apps/web`, `npx tsc -p apps/web/tsconfig.json --noEmit`) | PASS |
| API typecheck (`apps/api`, `npx tsc -p apps/api/tsconfig.json --noEmit`) | PASS |
| Route registry parity (`route-registry-parity.test.ts`) | PASS, 8/8 |
| Menu seed parity (`menu-seed-parity.test.ts`) | PASS, 10/10 |
| Menu terminology (`menu-terminology.test.ts`) | PASS, 9/9 |
| Menu filter (`menu-filter.test.ts`) | PASS, 5/5 |
| Route window catalogue after A6.2 | 79 rows (73 after A6.1, +6) |
| Menu catalogue after A6.2 | 65 rows (59 after A6.1, +6) |
| Terminology allowlist vs catalogue | equal, 65 = 65 |
| Tenant backfill, new menus with NULL `window_id` | 0 |
| Tenant backfill, new menus with no tree row | 0 |

## Deliberate boundary

Finance Advanced screens were not part of Wave A6 API-first scope. A6.1 answers that with two read-only pages and A6.2 with six write pages, all recorded above. What remains open: no per-page deep links into a single period, journal, or asset; no consolidation group editing; no reporting surface for the nine `/accounting/*` analytics routes beyond what `/finance/statements` already reads. Wave A6's own boundary is the API, persistence, authorization, ledger, and verification surface delivered by the seven build units.

## Closure status

Every A6 unit is merged to `master`. Documentation reconciliation landed as `a8e6ed5` (#64) and `00c9764` (#65). A6.1 landed as `08e2ea5` (#66), which is the squash-merge of the pages commit `b3e741b` and the terminology fix `9549709` — that fix was authored on the A6.1 branch and never pushed as its own commit, so `9549709` is not reachable from `master` and only `08e2ea5` should be cited as the merged artifact. A6.2 lands as #67.

**Kesimpulan Indonesia:** Seluruh tujuh unit Wave A6 (A6-01 sampai A6-06b) sudah digabung ke `master` dengan SHA dan nomor PR tercatat di atas. Total 144 tes integrasi terfokus lulus, 88 pendaftaran rute `/accounting/*` pada 81 path unik sudah punya Window, dan 15 berkas migrasi terpasang sampai kepala `1795700000010`. Wave A6.1 kemudian menambahkan dua halaman baca-saja, `/finance/accounting` dan `/finance/statements`, beserta entri menu katalognya lewat migrasi `1795800000000`; menu katalog yang dilayani naik dari 57 ke 59 baris dan katalog Window dari 71 ke 73 baris. Katalog istilah juga ikut diperluas: kunci `menu.<kode>.name` dan `.description` beserta baris allowlist-nya, karena uji `menu-terminology` menuntut jumlah baris allowlist sama dengan jumlah baris katalog; versi pertama migrasi hanya memperluas katalog dan CI menangkapnya dengan kegagalan `expected 57 to be 59`. Tiga uji lulus (27/27 gabungan) dan kedua typecheck bersih.

Wave A6.2 kemudian menutup sisa antarmuka mutasi: enam halaman tulis, satu per unit FIN-ADV-001 sampai 006, di rute `/finance/journals`, `/finance/open-items`, `/finance/budgets`, `/finance/bank-recon`, `/finance/fixed-assets`, dan `/finance/tax`, beserta entri menu katalognya lewat migrasi `1795900000000`. Katalog menu yang dilayani naik dari 59 ke 65 baris dan katalog Window dari 73 ke 79 baris; allowlist istilah tetap sama jumlahnya dengan katalog (65 = 65). Setiap pasangan izin yang dicantumkan adalah izin yang benar-benar diperiksa lapisan layanan, bukan izin yang lebih luas: `finance.accounting.manage` untuk kernel, `finance.accounting.configure` untuk open item, anggaran, rekonsiliasi bank, buku aset, dan pajak. Tidak ada izin baru dan tidak ada baris `role_permissions` yang ditulis. Empat uji lulus (32/32) dan kedua typecheck bersih. Yang belum ada: tautan dalam ke satu periode, jurnal, atau aset; penyuntingan grup konsolidasi; dan antarmuka untuk sembilan rute analitik `/accounting/*` di luar apa yang sudah dibaca `/finance/statements`.

## For future agent

Wave A6 API-first closure is complete and merged; the merged commits are the authority, not this document. A6.1 and A6.2 are both built: eight Finance Advanced pages exist and the catalog rows that point at them exist. The mutation surface is now present for the six write units; consolidation and statement editing are still read-only by design, so do not describe Finance Advanced as complete.

When adding a Finance Advanced page, six artifacts must change together: `ROUTE_REGISTRY` in `apps/api/src/domain/configuration/route-registry.ts`, `routeRegistry.ts` in the web mirror, `App.tsx`, the route window seed, the menu seed, and the terminology keys plus allowlist rows. The middle two of those live in a migration that follows the snapshot pattern in `1795800000000`. Miss any one and a parity test fails.

Four traps that cost time here:

- **Each migration must snapshot the name its own predecessor published, under a name of its own.** A6.2 first renamed to `config_menu_seed_epic3` and `config_route_window_seed_epic4` — the names A6.1 itself had already taken — so both renames were silent no-ops and the migration re-UNIONed onto the epic-3 catalogue, dropping A6.1's two pages from the seed while their tenant rows stayed behind. The symptom was `catalogue: 63` where 65 was expected, and an allowlist count that no longer matched. Each migration gets a fresh suffix (`_a61` here); reusing a predecessor's snapshot name is the failure.
- A page menu cannot precede its route window. `app_menus_summary_target_check` requires a non-summary menu to carry a `window_id`, and the seed resolves that by joining the route window code.
- Do not backfill existing tenants by calling `config_seed_menus_for_tenant()`. It replays the whole catalogue once per tenant. The dev database has 2617 tenants, and the statement does not finish. Write two scoped INSERTs keyed on the new codes instead.
- Adding a menu means adding its terminology key and allowlist row in the same migration. `tests/menu-terminology.test.ts` asserts `count(menu_terminology_allowlist where field='name') == count(config_menu_seed())`, and the description pair likewise against menus with a non-null description. Extend the catalogue alone and that test fails. The allowlist is seeded from `config_menu_seed()`, so a menu with no key is a label no tenant could override.

`npm run migrate` is broken on this machine for an unrelated reason: node-pg-migrate cannot parse a Windows drive-letter path (`ParseError: D:\: Unexpected token, expected ","`). It fails from any working directory, so it is not a cwd problem. A short runner that `require`s the migration module, collects the strings passed to `pgm.sql()`, and executes them through `pg` works. Run it from the repository root as a scratch file and delete it afterwards; it is not part of the tree.

A consequence worth knowing before the next migration: because `npm run migrate` never runs here, the dev database can sit at an older head than `master` and say nothing. When A6.2 was first applied, the dev database was still pre-A6.1, so the rename guard found no `_epic3`/`_epic4` snapshot to protect and A6.1's catalogue was simply absent. Check the actual catalogue (`SELECT count(*) FROM config_menu_seed()`) against the expected count from the ledger before trusting a parity result here. `pgmigrations` is not maintained by the scratch runner either, so the table understates the real head.

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

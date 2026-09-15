# HANDOFF — Abixell One (9Router-CC)

| | |
|---|---|
| **Tanggal Handoff** | 2026-08-25 |
| **Project** | Abixell One |
| **Organisasi** | Insting Tekno Sinergi |
| **Branch / HEAD** | `master` @ `af697d3` — Phase 11F: finalize master integration metadata |
| **Runtime evidence** | `master` @ `63e43d1` — 354/354 API tests · 27 test files · 85 tabel · 27 migrasi · 77 permissions |
| **Canonical baseline** | Product Roadmap / Progress **v1.19** |
| **Progress** | Core Product Readiness **100.0%** · Full Approved Roadmap **51.0%** |
| **Active phase** | Tidak ada — Phase 0–10, H, H2, dan 11A–11F telah ditutup |
| **Status workspace saat audit dimulai** | Tiga dokumen handoff untracked; tidak ada staged atau modified tracked file — lihat §4 |
| **Sumber status utama** | `docs/canonical/product-roadmap.md` · `docs/canonical/product-progress.md` |

> **Catatan otoritas:** Untuk status delivery dan angka progress, gunakan Roadmap/Progress v1.19. `README.md`, sebagian `product-blueprint.md`, `documentation-map.md`, PRD summary, `technical-debt-register.md`, `decision-log.md`, dan `implementation-notes.md` memuat bagian yang tertinggal; konflik dokumentasi dirinci di §7.

---

## 1. Tujuan Project

**Abixell One** adalah **Integrated Enterprise Management System** yang secara internal diposisikan sebagai produk whitelabel, multi-tenant-ready, tetapi dioperasikan dengan **deployment dedicated per klien**. Prinsip produk yang binding:

> **Build Once. Configure Per Client. Deploy Exclusively.**

Produk mengonsolidasikan domain bisnis ke dalam lima lapisan yang disetujui:

1. **Platform Core** — fondasi teknis dan kontrak platform yang client-agnostic.
2. **Business Core** — kapabilitas bisnis minimum yang usable.
3. **Advanced Capability** — kedalaman opsional per modul.
4. **Client Configuration** — konfigurasi tanpa perubahan source code.
5. **Client Extension** — kode/integrasi khusus satu klien, di luar denominator roadmap produk.

**Posisi client-facing:** *Designed Around Your Business.* Istilah internal seperti *whitelabel*, *shared core*, *reusable platform*, *product core*, dan *multi-tenant product* tidak boleh muncul pada UI, email, laporan, PDF, domain, atau dokumentasi client-facing (ADR-0003).

Abixell One adalah penerus IGSEP. Corpus IGSEP di `docs/history/igsep/` hanya menjadi sumber requirement historis, bukan implementation source of truth.

### Platform Kernel saat ini

Platform Kernel adalah batas kontrak stabil **di dalam Platform Core** — bukan lapisan keenam, microservice, tenant module, atau control plane lintas-klien. Composition tetap statis dan eksplisit. Module Manifest v1 adalah artefak dokumentasi/governance, **bukan** runtime plugin/package loader (ADR-0014).

---

## 2. Arsitektur dan Teknologi

### Stack Teknis

| Lapisan | Teknologi / pola |
|---|---|
| **Backend API** | Node.js ≥20, TypeScript, Fastify 5 |
| **Frontend** | React 18, Vite 5, TypeScript, Tailwind CSS |
| **Database** | PostgreSQL 16 |
| **Data access / migrasi** | `pg` + `node-pg-migrate`; **bukan Prisma** |
| **Testing** | Vitest untuk API/integrasi; Node test untuk boundary validator; Playwright untuk real-browser smoke |
| **Validation** | ESLint, TypeScript strict, platform-boundary validator, PWA validator, `npm audit --omit=dev` |
| **Monorepo** | npm workspaces: `apps/api`, `apps/web`, `packages/contracts` |
| **Deployment** | Docker images + Docker Compose deployment path tervalidasi |
| **Runtime API produksi** | `node dist/main.js` |

### Arsitektur Lapisan Produk

```text
┌─────────────────────────────────────────────────────────┐
│ CLIENT EXTENSION      khusus satu klien, di luar produk  │
├─────────────────────────────────────────────────────────┤
│ CLIENT CONFIGURATION  metadata/data, tanpa ubah kode     │
├─────────────────────────────────────────────────────────┤
│ ADVANCED CAPABILITY   opsional, per modul                │
├─────────────────────────────────────────────────────────┤
│ BUSINESS CORE         domain minimum yang usable         │
├─────────────────────────────────────────────────────────┤
│ PLATFORM CORE         fondasi + Platform Kernel          │
└─────────────────────────────────────────────────────────┘
```

### Struktur Source Code Aktual

```text
apps/api/src/
├── application/                    # Phase 0/1 + Platform Core, layer-first
│   ├── admin-console/
│   ├── identity/
│   ├── rbac/
│   ├── workflow/
│   ├── configuration/
│   ├── notification/
│   ├── event/
│   ├── integration/
│   ├── scheduler/
│   └── survey-integration/
├── domain/
├── infrastructure/
├── interfaces/
├── modules/                        # Business Core, module-first
│   ├── asset/core/
│   ├── finance/core/
│   ├── hse/core/
│   ├── project-delivery/core/
│   ├── reporting-insight/core/
│   ├── service-operations/core/
│   ├── supply-chain/core/
│   └── workforce/core/
├── composition-root.ts             # manual dependency composition
├── app.ts                          # Fastify plugin/route composition
└── main.ts

apps/web/src/
├── auth/
├── lib/
├── modules/                        # 9 module UI directories
├── pages/
│   └── admin/console/
├── shared/
├── shell/
└── App.tsx

packages/contracts/src/index.ts     # workspace placeholder; belum berisi kontrak bersama
apps/api/migrations/                # satu stream migrasi deterministik
docs/architecture/                  # kontrak Kernel/Package/Admin/Builder/UX
infra/deployment/                   # production Compose + deploy validation/smoke
docs/operations/                    # deployment dan backup/restore/DR runbooks
```

Arsitektur saat ini **hybrid secara disengaja**. Delapan Business Core Phase 2+ memakai `modules/<module>/core/`; kode Phase 0/1 masih layer-first. Migrasi menuju target module-first harus incremental dan opportunistic, bukan big-bang. Top-level target `core/`, `orchestration/`, dan `shared/` di API belum diwujudkan seluruhnya.

### Baseline Teknis Terkini

| Artefak | Jumlah |
|---|---:|
| Migration files | **27** |
| Application-created tables | **84** |
| Total database tables termasuk `pgmigrations` | **85** |
| Migration-owned permissions | **77** |
| API test files / tests | **27 / 354** |
| Boundary-validator tests | **23** |
| Total automated declarations (API + boundary) | **377 dalam 28 file** |

Angka kanonis 354/354 hanya menghitung API suite; 23 boundary tests dijalankan terpisah.

---

## 3. Pekerjaan yang Sudah Selesai

### Ringkasan Progress — v1.19

| Layer / metrik | Selesai / Total | Status |
|---|---:|---:|
| Platform Core | 41 / 41 | **100%** |
| Platform Hardening | 16 / 16 | **100%** |
| Business Core | 117 / 117 | **100%** |
| Advanced Capabilities | 6 / 179 | **3.4%** |
| **Core Product Readiness** | **174 / 174** | **100.0%** |
| **Full Approved Roadmap** | **180 / 353** | **51.0%** |

### Business Core per Modul

| Modul | Selesai / Total | Status |
|---|---:|---:|
| Customer & Commercial | 9 / 9 | **100%** |
| Service Quality (Complaint) | 15 / 15 | **100%** |
| Survey & Assessment | 9 / 9 | **100%** |
| Service Operations & Work Management | 13 / 13 | **100%** |
| Workforce / HR | 10 / 10 | **100%** |
| Supply Chain | 14 / 14 | **100%** |
| Asset | 8 / 8 | **100%** |
| Finance | 12 / 12 | **100%** |
| HSE | 9 / 9 | **100%** |
| Project Delivery | 8 / 8 | **100%** |
| Reporting & Operational Insight | 10 / 10 | **100%** |

### Riwayat Fase

| Fase | Nama | Status |
|---|---|---|
| Phase 0 | Enterprise Core Foundation | **COMPLETED** |
| Phase 1 | Customer Experience, Complaint, Survey, Survey-to-Action | **COMPLETED** |
| Phase 2 | Service Operations & Work Management Core | **COMPLETED** |
| Phase 3 | Workforce / HR Core | **COMPLETED** |
| Phase 4 | Supply Chain Core | **COMPLETED** |
| Phase 5 | Asset Core | **COMPLETED** |
| Phase 6 | Finance Core | **COMPLETED** |
| Phase 7 | HSE Core | **COMPLETED** |
| Phase 8 | Project Delivery Core | **COMPLETED** |
| Phase 9 | Reporting & Operational Insight | **COMPLETED** |
| Phase 10 | Customer & Commercial completion | **COMPLETED** |
| Phase H | Platform Hardening — Pilot Gate | **COMPLETED** |
| Phase H2 | Platform Hardening — Production Gate | **COMPLETED** |
| Phase 11A | Platform Kernel & Builder Architecture Foundation | **COMPLETED — unweighted** |
| Phase 11B | Platform Boundary Enforcement | **COMPLETED — unweighted** |
| Phase 11C | Business Admin Console Foundation | **COMPLETED — unweighted** |
| Phase 11D | Platform Experience System & Admin Console UX Direction | **COMPLETED — unweighted** |
| Phase 11E | Platform Shell & Admin Console UX Implementation Foundation | **COMPLETED — unweighted** |
| Phase 11F | Governed Access Management + Access-Lifecycle Hardening | **COMPLETED — unweighted** |

Phase 11A–11F adalah governance/admin/platform work yang tidak menambah numerator/denominator roadmap kecuali suatu pekerjaan mengirim unit berbobot yang sudah disetujui.

### Phase 11F yang Telah Delivered

- Tenant-local, privacy-minimized access review.
- Assignment/removal role yang sudah ada dengan permission governance.
- Tenant, organization-unit, dan customer scopes.
- Exact-assignment uniqueness.
- Correction-only removal untuk assignment yang tidak lagi tersedia.
- Penolakan aktor inactive/deleted saat login, refresh, dan protected request.
- Revokasi sibling refresh tokens.
- Invalidation monotonic untuk stale scoped assignments.
- Reporting scope yang permission-coupled.
- Privacy-safe audit dan manager-survival safeguards.

### Commit History Kunci Setelah Phase 6

Terdapat **39 commit** setelah `05a6b5a`.

```text
463b94d..90456ac  Phase 7 — HSE Core, UX, correction, closure
fc6e4a2..99b7a54  Phase 8 — Project Delivery Core + metadata
81df359..50d0a6c  Phase 9 — Reporting Insight Core + metadata
7ee5d88..b59d832  Phase 10 — Customer Commercial completion
05c3a11..a7db0ed  Phase H — Pilot hardening
9fd682e..1517baf  Pilot UI guide/smoke + roadmap-to-100
0e24edb..3df1718  Phase H2 — production hardening/outbox/metadata
7ba7ff2            Phase 11A — Kernel/Builder architecture
49afb6f            Phase 11B — platform boundary enforcement
3145627..0e36fef  Phase 11C — Business Admin Console
f302146            Phase 11D — Platform Experience System
26fc99f..a8e762d  Phase 11E — shell/Admin UX
fc01876..04b9339  Phase 11F — governed access management
63e43d1            Phase 11F — access-lifecycle runtime closure
2d33b64            Phase 11F — runtime metadata baseline
af697d3            Phase 11F — master integration metadata (HEAD)
```

Dua commit setelah `63e43d1` hanya memperbarui metadata Roadmap/Progress; runtime evidence tetap dipin pada `63e43d1`.

---

## 4. Perubahan yang Belum Di-commit

Pada awal audit active checkout:

```text
?? docs/HANDOFF-9ROUTER-CC.md
?? docs/HANDOFF-9ROUTER-CX.md
?? docs/HANDOFF-OMNIROUTE.md
```

- Tidak ada staged file.
- Tidak ada modified tracked file.
- Ketiga dokumen handoff tersebut untracked dan tidak boleh di-commit tanpa keputusan dokumentasi eksplisit.
- `TOOL_TEST_OMNIROUTE.txt` yang disebut handoff lama sudah tidak ada.
- Pembaruan sesi ini hanya menulis ulang `docs/HANDOFF-9ROUTER-CC.md`; dua handoff lain tidak disentuh.

---

## 5. File Penting dan Fungsinya

### Sumber Otoritatif untuk Status Terkini

| File | Fungsi / catatan |
|---|---|
| `docs/canonical/product-progress.md` | Metrik v1.19, runtime evidence, dan basis perhitungan terkini |
| `docs/canonical/product-roadmap.md` | Status fase/gate terkini dan Advanced backlog |
| `docs/canonical/product-blueprint.md` | Arsitektur produk; **beberapa tabel/status delivery di dalamnya stale** |
| `docs/canonical/documentation-map.md` | Urutan otoritas; baris versi baseline di dalamnya sendiri tertinggal |
| `docs/prd/abixell-one/` | Requirements kanonis; beberapa summary/index tertinggal dari module evidence |
| `docs/adr/0001-*.md` s/d `0014-*.md` | Keputusan arsitektur binding; ADR-0005 sudah superseded oleh ADR-0009 |
| `docs/architecture/` | Kontrak normatif Platform Kernel, package, Admin, Builder, UX, dan installation |
| `docs/ROADMAP-TO-100.md` | Derivatif non-kanonis untuk sequencing Advanced Wave A1–A8 |

### Runtime dan Enforcement

| File / direktori | Fungsi |
|---|---|
| `apps/api/src/main.ts` | Entry point API |
| `apps/api/src/app.ts` | Registrasi plugin dan routes; composition point manual |
| `apps/api/src/composition-root.ts` | Dependency wiring manual dan auditable |
| `apps/api/src/application/admin-console/` | Admin Console read model + governed access services |
| `apps/api/src/application/rbac/` | Permission dan Data Scope enforcement |
| `apps/api/src/application/workflow/` | Generic Workflow & Approval Engine |
| `apps/api/src/application/configuration/` | Configuration & Metadata Engine |
| `apps/api/src/application/event/` | Domain Event/EventBus infrastructure |
| `apps/api/src/application/integration/` | Integration processing + outbox boundary |
| `apps/api/src/interfaces/http/routes/admin-console.ts` | Governed Admin Console API routes |
| `apps/api/src/modules/*/core/` | Delapan module-first Business Core backend implementations |
| `apps/api/migrations/` | 27-file single migration stream; latest Phase 11F stale-scope invalidation |
| `apps/api/tests/` | 27 API regression files, 354 tests pada baseline |
| `apps/api/scripts/sync-role-permissions.ts` | Additive idempotent sync untuk role `is_full_access`; tidak mengubah curated roles |
| `apps/web/src/pages/admin/console/` | Business Admin Console UI |
| `apps/web/src/shell/` | Responsive, capability-aware application shell |
| `apps/web/e2e/smoke.mjs` | Phase 11F 10-step real-browser smoke |
| `scripts/validate-platform-boundaries.mjs` | Boundary enforcement terhadap repository |
| `scripts/platform-boundary-validator.test.mjs` | 23 focused boundary-validator tests |
| `.github/workflows/ci.yml` | PostgreSQL 16-backed CI: install → migrate → validate |
| `infra/deployment/` | Production Compose, environment validation, deploy/smoke |
| `docs/operations/` | Deployment serta backup/restore/DR runbooks |

### Dokumen Supporting yang Tidak Current sampai Phase 11F

| File | Kondisi |
|---|---|
| `README.md` | Masih menyatakan Phase 0/1, 150 tests, 14 migrations, 58 tables, dan progress lama |
| `docs/decision-log.md` | Berhenti di Phase 6 |
| `docs/implementation-notes.md` | Berhenti di Phase 6 |
| `docs/technical-debt-register.md` | Struktur berhenti di Phase 6 dan memuat carry-over H/H2 yang sudah resolved |
| `docs/FOUNDER-UI-TESTING-GUIDE.md` | Masih menyatakan H2 belum dimulai |

Jangan menggunakan file-file stale tersebut sebagai sumber status tanpa rekonsiliasi terhadap Roadmap/Progress v1.19 dan source code aktual.

---

## 6. Keputusan Teknis

Keputusan berikut binding kecuali disupersede melalui ADR/Founder Decision baru.

### Platform, Data, dan Authorization

| Keputusan | Ringkasan | Referensi |
|---|---|---|
| **Fastify, bukan Express** | Framework API dengan TypeScript/JSON Schema support | ADR-0001 |
| **PostgreSQL dedicated per client** | Bukan shared SaaS database; isolasi tenant tetap ditegakkan di aplikasi | ADR-0002/0003 |
| **No Prisma** | `pg` + `node-pg-migrate`; hindari binary dependency yang diblokir environment | ADR-0002 |
| **Dedicated deployment** | Satu deployment per klien; branding/configuration tenant-local | ADR-0003 |
| **Tenant bootstrap terkontrol** | Seed/migration/bootstrap mechanism, bukan open self-service tenant creation | ADR-0004 |
| **Hierarchical Data Scope** | Recursive ancestor coverage; ADR-0009 supersedes exact-match ADR-0005 | ADR-0009 |
| **Scope dimensions** | `tenant`, `organization_unit`, `customer` | ADR-0011 |
| **Permissions tidak di JWT** | Dibaca dari DB per request untuk menghindari stale authorization | Decision Log 0B |
| **Document follows parent entity** | Entity Authorization Resolver, bukan permission document lepas | ADR-0012 |
| **Full-access sync idempotent** | Semua permission baru ditambahkan ke role `is_full_access`, curated role tidak diubah | ADR-0010 |

### Business Invariants

| Keputusan | Ringkasan |
|---|---|
| **Workflow Engine generic** | Lifecycle domain tidak boleh di-hardcode di masing-masing service (ADR-0013) |
| **Money sebagai exact decimal** | `numeric(18,2)` di DB dan string di atas DB; jangan lewat binary floating point |
| **Finance ledger immutable** | Koreksi melalui reversal/compensating transaction, bukan edit/delete transaksi applied |
| **Asset movement ledger** | Status/lokasi hanya berubah melalui movement ledger |
| **No negative stock/balance di Core** | Overdraft adalah kebijakan Advanced, bukan default Core |

### ADR-0014 — Platform Kernel, Static Packages, Governed Builder

1. **Kernel tetap di Platform Core.** Bukan sixth layer, module teraktivasi, microservice, atau cross-deployment control plane.
2. **Composition statis.** Manifest tidak me-load code. Route, service, subscriber, Scheduler handler, resolver, adapter, dan Web route tetap diregistrasi eksplisit.
3. **Satu migration stream.** Package boleh mendeklarasikan ownership, tetapi tidak boleh memiliki migration stream independen.
4. **Builder hanya metadata finite/typed/versioned.** Lifecycle wajib: draft → validate → simulate/impact → review → approve → publish → observe/audit → rollback/supersede.
5. **Production publication wajib governed.** Human-readable diff, maker-checker approval, immutable version, audit, atomic publish, observability, dan recovery.
6. **Builder dilarang menyediakan** arbitrary SQL/query editor, script/expression DSL, runtime code injection, direct schema editing, direct domain-table write, authorization bypass, atau cross-tenant mutation.
7. **Trust plane terpisah.** Business Admin bersifat deployment-local dan tunduk pada RBAC/Data Scope/audit; future Platform Architect/Builder tidak boleh menjadi ambient cross-client superuser.
8. **Core-first install.** Release immutable, validation, backup/quiescing, migrate, permission sync, health, smoke, bootstrap, dan recovery gate harus dipertahankan.
9. **Runtime baru butuh otorisasi terpisah.** Builder runtime, installer runtime, dynamic packages/plugins, generalized activation, atau desktop wrapper memerlukan requirements, roadmap treatment, security review, dan tests sendiri.

---

## 7. Masalah yang Belum Selesai

**Phase H dan H2 sudah selesai.** Jangan lagi membawa CI/CD, CORS, queue N+1, PWA icons, DR runbook, deployment automation, atau Integration outbox sebagai gate yang belum delivered tanpa bukti regresi baru.

### Boundary Produk Saat Ini

- Tidak ada active phase.
- Seluruh Core dan Platform Hardening selesai.
- Advanced yang selesai hanya dua Survey-to-Action units = **6/179 points**.
- Masih tersisa **173 Advanced points**; Wave A1–A8 bersifat planned/optional dan memerlukan Founder direction eksplisit.

### Sengaja Tidak Disediakan oleh Phase 11F

- Governed user provisioning.
- General user profile/status/lifecycle administration.
- Role create/edit/delete.
- Role-permission composition UI.
- Bulk permission matrices atau permission-catalog mutation.
- Broad Admin Console editing.
- Platform Architect/Builder Console.
- Executable Module Manifest/package loader.
- Dynamic packages/plugins.
- Schema/query editor atau scripting/DSL.
- Generalized module-availability enforcement.

### Requirement Gap dan Risiko Aktif

- Full intersection package/catalog/activation/permission/Data Scope/feature-flag belum universal di setiap contribution point; backend authorization tetap authoritative.
- Listing performance dan pagination masih parsial pada production scale.
- Generalized side-effect recovery di luar Integration outbox masih parsial.
- Role composition tidak memiliki administration UI.
- Branding support dan configuration administration masih parsial di luar area yang sudah disurface.
- Tenant-configurable session lifetime masih parsial; SSO/MFA masih deferred.
- Client deployment tetap memerlukan client-specific configuration dan release security review.
- Outbound Integration masih logged transport stub sampai transport nyata disetujui terpisah.
- Outbox durability dimulai setelah Domain Event persisted; ini tidak membuat setiap business mutation/event-write pair transaksional.
- Notification dan subscriber EventBus lain tidak otomatis mendapat PH-8 retry.
- Exactly-once external HTTP delivery tidak boleh diklaim tanpa downstream idempotency.

### Technical Debt yang Masih Layak Dibawa

- Rare survey-assignment lifetime race.
- Survey-integration administration UI.
- Friendly actor names pada timeline.
- Tenant timezone handling.
- Survey autosave/offline draft.
- Incremental restructure kode Phase 0/1 ke module-first.
- Pindahkan Survey-to-Action ke target `orchestration/` saat layer itu dibuat.
- Berbagai module UX increments di debt register (picker, multi-line forms, aggregate projection, preview, dll.) yang tidak mengubah invariant Core.
- Root script `npm run migrate:generate` salah delegasi ke API script yang tidak ada; command valid saat ini adalah `migrate:create` di workspace API.
- `packages/contracts` masih placeholder kosong.
- `npm run validate` menjalankan production boundary validator tetapi **tidak** menjalankan 23 focused boundary tests; jalankan `npm run test:platform-boundaries` terpisah.

### Documentation Governance Gap

- `README.md` tertinggal sejak Phase 1.
- `product-blueprint.md` memuat beberapa angka/status delivery lama meskipun arsitekturnya tetap authoritative.
- `documentation-map.md` mencantumkan baseline roadmap lama.
- PRD summary/traceability tertentu belum merefleksikan closure semua Business Core/H/H2.
- `technical-debt-register.md`, `decision-log.md`, dan `implementation-notes.md` belum direkonsiliasi sampai Phase 11F.
- `docs/ROADMAP-TO-100.md` non-kanonis, memakai source baseline lama, dan mendahului Phase 11A–11F.

Dokumentasi supporting tersebut harus direkonsiliasi sebagai pekerjaan terpisah; handoff ini tidak mengubahnya.

---

## 8. Test / Build Command

### Fresh Setup

```bash
npm ci
npm run db:up
cp apps/api/.env.example apps/api/.env
npm run migrate -w apps/api
npm run seed -w apps/api
npm run sync-permissions -w apps/api
```

Pada Windows `cmd`, copy env dapat dilakukan dengan:

```bat
copy apps\api\.env.example apps\api\.env
```

### Development

```bash
npm run dev:api
npm run dev:web
```

Default: API `http://localhost:4000`, Web `http://localhost:5173`.

### Complete Repository Gate

```bash
npm run validate
```

`validate` menjalankan berurutan:

```text
validate:platform-boundaries
lint
typecheck
API tests
build
validate:pwa
validate:security
```

### Individual Checks

```bash
npm run validate:platform-boundaries
npm run test:platform-boundaries
npm run lint
npm run typecheck
npm test
npm run build
npm run validate:pwa
npm run validate:security
```

`npm test` hanya menjalankan 354-test API suite. Boundary unit tests (23) harus dipanggil terpisah dengan `npm run test:platform-boundaries`.

### Browser Smoke

```bash
npm run e2e -w apps/web
```

Prasyarat: PostgreSQL sudah migrate/seed/sync, API aktif di port 4000, Web aktif di 5173, dan Playwright Chromium tersedia. Smoke test berada di `apps/web/e2e/smoke.mjs`, **bukan** `apps/api/e2e/`.

### Database dan Operations

```bash
npm run db:up
npm run db:down
npm run migrate -w apps/api
npm run migrate:down -w apps/api
npm run migrate:create -w apps/api -- <name>
npm run seed -w apps/api
npm run sync-permissions -w apps/api

npm run backup
npm run restore
npm run verify:restore
npm run deploy:validate
npm run restore:validate
npm run deploy
npm run deploy:smoke
```

Jangan gunakan root `npm run migrate:generate`: script itu saat ini mendelegasikan ke API script yang tidak ada.

### Status Verifikasi Audit Ini

**Lulus dalam audit:**

- Platform-boundary validation: 0 blocker, 1 expected Manifest advisory, 77 permissions.
- Boundary-validator tests: 23/23.
- Lint.
- PWA validation.
- Production dependency audit: 0 vulnerabilities.

**Belum berhasil direproduksi di isolated audit environment:**

- API test collection gagal karena local dependency tree/incomplete install menghasilkan `Ajv is not a constructor`.
- Typecheck/build gagal pada `schema-registry-validator.ts` karena kondisi dependency Ajv yang sama.
- `npm ls` menunjukkan install workspace lokal kosong/tidak lengkap.

Evidence kanonis tetap **354/354 pada `63e43d1`**; kegagalan audit lokal tidak boleh disamarkan sebagai regression produk. Lakukan `npm ci`, lalu ulangi `npm run validate` dengan PostgreSQL sebelum perubahan berikutnya atau release.

---

## 9. Langkah Berikutnya

Tidak ada active phase. Jangan memulai Phase 7/H — keduanya sudah selesai. Founder perlu memilih dan mengotorisasi salah satu arah berikut:

1. **Advanced Wave A1–A8**, berdasarkan prioritas bisnis, bukan asumsi urutan otomatis.
2. **Governed administration increment** terpisah, misalnya user provisioning atau role composition.
3. **Builder/package/installer runtime increment** terpisah, tunduk pada ADR-0014.
4. **Client-specific configuration/deployment**, yang tidak dihitung sebagai progress produk.
5. **Documentation reconciliation** untuk menyelaraskan README, Blueprint status tables, PRD summaries, Documentation Map, Decision Log, Implementation Notes, dan Debt Register dengan v1.19/Phase 11F.

### Advanced Backlog yang Tersisa

| Wave | Scope | Points |
|---|---|---:|
| A1 | Customer & Commercial + Service Quality Advanced | 19 |
| A2 | Survey completion + Reporting Advanced | 23 |
| A3 | Service Operations + Asset Advanced | 24 |
| A4 | Workforce Advanced | 24 |
| A5 | Supply Chain Advanced | 22 |
| A6 | Finance Advanced | 21 |
| A7 | Project Delivery + HSE Advanced | 27 |
| A8 | Platform cross-cutting Advanced | 13 |
| **Total tersisa** | | **173** |

### Sebelum Membuka Increment Baru

1. Dapatkan Founder directive eksplisit dan freeze scope.
2. Tentukan apakah pekerjaan weighted roadmap, unweighted governance/admin, atau client-specific.
3. Jalankan `npm ci` untuk memulihkan dependency tree deterministik.
4. Reproduce `npm run validate` dengan PostgreSQL.
5. Jalankan `npm run test:platform-boundaries` terpisah.
6. Untuk deployment, lakukan release security review dan client-configuration checks.
7. Jangan mengubah metrik produk untuk pekerjaan unweighted atau client-specific.

---

## 10. Risiko dan Hal yang Tidak Boleh Diubah

### ❌ Tidak Boleh Diubah Tanpa Otorisasi Produk/Arsitektur Eksplisit

- Lima-lapisan product model.
- Prinsip dedicated-per-client deployment.
- Larangan istilah internal pada client-facing surfaces.
- Denominator roadmap atau angka progress kanonis.
- Tenant isolation, permission, dan Data Scope semantics.
- Workflow-owned business lifecycles.
- Document parent-entity authorization.
- Single ordered migration stream.
- Decimal-string money representation di atas database.
- Finance/Asset immutable-ledger behavior.
- Static, explicit, reviewable composition.
- Business Admin/Builder trust-plane separation.

### ❌ Secara Spesifik Dilarang

- Runtime plugin loading dari Manifest.
- Dynamic code loading atau package execution tanpa otorisasi baru.
- Package-owned independent migration stream.
- Direct production schema editing.
- Arbitrary SQL/query/script/expression-DSL Builder surface.
- Direct domain-table writes dari Builder.
- Authorization bypass atau ambient cross-client admin access.
- Automatic production down-migration rollback.
- Menganggap hidden navigation sebagai authorization.
- Menghidupkan kembali assignment yang sudah invalidated secara diam-diam.
- Menggunakan trusted-caller seam untuk bypass tenant/integrity validation.
- Menggunakan binary floating point untuk nilai uang.

### ⚠️ Area Risiko Tinggi

| Area | Risiko / invariant |
|---|---|
| **Migration `1775000000000`** | Memakai lifecycle triggers, permanent invalidation timestamp, dan `authorization_effective_user_role_assignments`; invalidation sengaja monotonic |
| **Rollback Phase 11F** | Down migration menolak berjalan ketika retained invalidated assignments masih ada |
| **`composition-root.ts` / `app.ts`** | Manual auditable composition points; setiap kontribusi runtime baru harus diregistrasi eksplisit |
| **`user.role.manage`** | Hanya assignment/removal role yang ada; bukan permission untuk mutate role atau permission composition |
| **`admin.console.read`** | Entry permission, bukan data-access override |
| **`is_full_access` sync** | Additive dan idempotent; jangan gunakan flag ini untuk curated production role |
| **Stale-scope removal** | Harus privacy-minimized dan tenant-local; jangan membocorkan identity lintas-scope |
| **Event/outbox boundary** | Tidak semua business mutation + event write otomatis transaksional; external exactly-once butuh downstream idempotency |
| **Trusted caller seams** | Boleh melewati permission check yang disengaja, tetapi tidak boleh melewati integrity/business validation |
| **Client release** | H/H2 complete tidak menghapus kewajiban release security review dan client configuration |

### ✅ Aman Dilakukan dalam Batas yang Ada

- Menambah test coverage tanpa mengubah behavior binding.
- Memperbaiki documentation drift dengan mempertahankan Roadmap/Progress sebagai sumber angka.
- Menyelesaikan UX/technical debt secara additive tanpa mengubah invariant Core.
- Memindahkan legacy code ke target layout satu modul pada satu waktu dengan regression penuh.
- Membuat migration baru melalui `npm run migrate:create -w apps/api -- <name>`; jangan edit migration yang sudah applied.
- Menjalankan `sync-permissions` setelah permission baru ditambahkan.
- Membuka Advanced/increment baru hanya setelah scope dan klasifikasinya diotorisasi.

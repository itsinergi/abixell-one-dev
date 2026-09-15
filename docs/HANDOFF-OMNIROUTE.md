# HANDOFF — Abixell One (OmniRoute)

| | |
|---|---|
| **Tanggal Handoff** | 2026-08-21 |
| **Project** | Abixell One (OmniRoute) |
| **Organisasi** | Insting Tekno Sinergi |
| **Branch / Commit Terakhir** | `master` @ `05a6b5a` (Phase 6: Finance Regression and Closure) |
| **Status Workspace** | Clean — tidak ada uncommitted changes |
| **Dokumen Kanonis** | `docs/canonical/product-blueprint.md` · `docs/canonical/product-roadmap.md` · `docs/canonical/product-progress.md` |

---

## 1. Tujuan Project

**Abixell One** adalah **Whitelabel Integrated Enterprise Management System** yang dibangun dan dimiliki oleh Insting Tekno Sinergi. Prinsip arsitektur inti yang telah disetujui Founder:

> **Build Once. Configure Per Client. Deploy Exclusively.**

Platform ini mengkonsolidasikan domain bisnis operasional ke dalam satu ekosistem — Platform Core yang generic + modul Business Core yang dapat diaktifkan per kebutuhan klien + Advanced Capabilities opsional. Setiap deployment bersifat dedicated per klien (bukan shared SaaS).

**Posisi client-facing:** *Designed Around Your Business.*
Kata *Whitelabel*, *Shared Core*, *Reusable Platform*, dan *Product Core* bersifat **internal only** — tidak boleh muncul di UI, laporan, email, domain, atau dokumentasi yang menghadap klien (ADR-0003).

**Pendahulu:** Abixell One adalah evolusi produktisasi dari IGSEP (Integrated General Services Enterprise Platform). IGSEP dipreservasi di `docs/history/igsep/` sebagai *Legacy Product Requirement Source*, bukan implementation source of truth.

---

## 2. Arsitektur dan Teknologi

### Stack Teknis

| Lapisan | Teknologi |
|---|---|
| **Backend API** | Node.js ≥ 20, TypeScript, Fastify (HTTP framework) |
| **Frontend** | React + Vite + TypeScript + Tailwind CSS |
| **Database** | PostgreSQL 16 (Docker Compose di dev / native di CI) |
| **ORM / Migrasi** | `pg` (node-postgres) + `node-pg-migrate` — **bukan Prisma** (binary Prisma diblokir oleh network allowlist implementasi, lihat ADR-0002 di `docs/decision-log.md`) |
| **Testing** | Vitest (unit & integrasi backend), Playwright (browser E2E smoke) |
| **Linting / Typecheck** | ESLint, TypeScript strict |
| **Monorepo** | npm workspaces: `apps/api`, `apps/web`, `packages/contracts` |
| **Runtime Produksi** | Node.js — `node dist/main.js` |

### Arsitektur Lapisan Produk

```
┌─────────────────────────────────────────────────────────┐
│ CLIENT EXTENSION      client-specific, tidak reusable    │
├─────────────────────────────────────────────────────────┤
│ CLIENT CONFIGURATION  data/config, tanpa perubahan kode  │
├─────────────────────────────────────────────────────────┤
│ ADVANCED CAPABILITY   opsional, per modul                │
├─────────────────────────────────────────────────────────┤
│ BUSINESS CORE         domain bisnis minimum yang usable  │
├─────────────────────────────────────────────────────────┤
│ PLATFORM CORE         fondasi teknis, client-agnostic    │
└─────────────────────────────────────────────────────────┘
```

### Struktur Source Code

```
apps/api/src/
├── modules/                     ← Kode Phase 2+ (arsitektur target, module-first)
│   ├── asset/core/
│   ├── finance/core/
│   ├── service-operations/core/
│   ├── supply-chain/core/
│   └── workforce/core/
├── application/                 ← Kode Phase 0–1 (layer-first, belum dimigrasikan)
├── domain/
├── infrastructure/
├── interfaces/
├── composition-root.ts
├── app.ts
└── main.ts
apps/web/src/
├── shared/                      ← Utilitas lintas-modul (format, dll.)
└── [feature pages per modul]
apps/api/migrations/             ← 19 migration files (satu stream deterministik)
docs/canonical/                  ← Blueprint, Roadmap, Progress (CANONICAL)
docs/adr/                        ← Architecture Decision Records
docs/decision-log.md             ← Log keputusan implementasi per checkpoint
docs/technical-debt-register.md  ← Technical debt terklasifikasi
```

### Database

- **78 tabel**, **19 migrasi**, **64 permissions**, **234 test PASS** (pada `317f1c2`)
- Semua migrasi mengikuti stream tunggal di `apps/api/migrations/` dengan timestamp sebagai urutan

---

## 3. Pekerjaan yang Sudah Selesai

### Ringkasan Progress (Roadmap v1.6 — per `05a6b5a`)

| Metrik | Nilai |
|---|---|
| **Core Product Readiness** | **74.1 %** (129/174 pts) |
| **Full Approved Roadmap Progress** | **38.2 %** (135/353 pts) |

### Riwayat Fase

| Fase | Nama | Roadmap Units | Status |
|---|---|---|---|
| **Phase 0** (0A–0F) | Enterprise Core Foundation | PC-1…PC-13 (Platform Core, 41 pts) | **COMPLETED** |
| **Phase 1A** | Customer Experience Foundation | CUS.1–CUS.3 | **COMPLETED** |
| **Phase 1B** | Generic Customer Complaint Engine | CMP.1 | **COMPLETED** |
| **Phase 1C** (1C.1–1C.8) | Complaint Experience Layer, Dashboard, Admin, Responsive/PWA | CMP.2–CMP.7 | **COMPLETED** |
| **Phase 1D** (1D.1–1D.3) | Generic Survey & Assessment Engine + Admin/Respondent UX | SRV.1–SRV.3 | **COMPLETED** |
| **Phase 1E** (1E.1–1E.3) | Survey-to-Action Integration + Management Attention | ADV-SRV ×2 | **COMPLETED** |
| **Phase 2** | Service Operations & Work Management Core | OPS.1–OPS.5 (13 pts) | **COMPLETED** |
| **Phase 3** | Workforce / HR Core | HR.1–HR.5 (10 pts) | **COMPLETED** |
| **Phase 4** | Supply Chain Core | SCM.1–SCM.6 (14 pts) | **COMPLETED** |
| **Phase 5** | Asset Core | AST.1–AST.4 (8 pts) | **COMPLETED** |
| **Phase 6** | Finance Core | FIN.1–FIN.6 (12 pts) | **COMPLETED** |

**Phase 0 s/d Phase 6 semuanya telah COMPLETED.**

### Per-Modul Business Core

| Modul | Core (Selesai/Total) | Status |
|---|---|---|
| Customer & Commercial | 7/9 | 77.8 % (CUS.4 masih PLANNED) |
| Service Quality (Complaint) | 15/15 | **100 %** |
| Survey & Assessment | 9/9 | **100 %** |
| Service Operations | 13/13 | **100 %** |
| Workforce (HR) | 10/10 | **100 %** |
| Supply Chain | 14/14 | **100 %** |
| Asset | 8/8 | **100 %** |
| Finance | 12/12 | **100 %** |
| HSE | 0/9 | **0 %** (PLANNED) |
| Project Delivery | 0/8 | **0 %** (PLANNED) |
| Reporting & Operational Insight | 0/10 | **0 %** (PLANNED) |

### Commit History Kunci

```
05a6b5a  Phase 6: Finance Regression and Closure
317f1c2  Phase 6: Finance Experience
f901de5  Phase 6: Finance Core Foundation
5bc0fd9  Phase 5: Asset Regression and Closure
6ad67e7  Phase 5: Asset Experience
b238b07  Phase 5: Asset Core Foundation
0810d3b  Phase 4: Supply Chain Regression and Closure
00d811e  Phase 4: Supply Chain Experience
b31b7a9  Phase 4: Supply Chain Core Foundation
cb4426d  Phase 3: Workforce Regression and Closure
688de8a  Phase 3: Workforce Experience
58c8ced  Phase 3: Workforce Core Foundation
4f88f44  Phase 2: Service Operations Regression and Closure
[...]    Phase 1C, 1D, 1E, 1B, 1A checkpoints
33d8ce0  Checkpoint 0A: Project Bootstrap
```

---

## 4. Perubahan yang Belum Di-commit

**Status Working Tree: Clean.**

```
On branch master
Untracked files:
  TOOL_TEST_OMNIROUTE.txt    ← file diagnostik, boleh dihapus
```

Tidak ada staged changes atau modified files. Semua pekerjaan per `05a6b5a` sudah committed sepenuhnya.

---

## 5. File Penting dan Fungsinya

### Dokumen Kanonis (JANGAN diubah tanpa audit resmi)

| File | Fungsi |
|---|---|
| `docs/canonical/product-blueprint.md` | Definisi arsitektur lapisan, prinsip produk, dan aturan repository. **Blueprint v1.1.** |
| `docs/canonical/product-roadmap.md` | Semua Roadmap Units dengan bobot, status, dan dependensi antar-fase. **Roadmap v1.6.** |
| `docs/canonical/product-progress.md` | Angka progress terverifikasi, change log, dan kalkulasi basis. **Satu-satunya sumber angka progress yang sah.** |
| `docs/canonical/documentation-map.md` | Peta otoritas dan urutan baca seluruh dokumentasi. |

### Dokumen Implementasi

| File | Fungsi |
|---|---|
| `docs/decision-log.md` | Log setiap keputusan implementasi dari Checkpoint 0A s/d Phase 6 (referenced by 15 source-code comments — jangan dipindahkan) |
| `docs/technical-debt-register.md` | Technical debt terklasifikasi: MUST FIX BEFORE PILOT, MUST FIX BEFORE PRODUCTION, SHOULD FIX LATER, FUTURE ENHANCEMENT |
| `docs/adr/0001-*.md` s/d `0013-*.md` | Architecture Decision Records — keputusan arsitektur yang bersifat binding |
| `docs/implementation-notes.md` | Catatan detail teknis per checkpoint |
| `docs/performance-baseline.md` | Baseline performa (latency, rate limit) dari Checkpoint 0F |

### Source Code Inti

| File / Direktori | Fungsi |
|---|---|
| `apps/api/src/main.ts` | Entry point server Fastify |
| `apps/api/src/app.ts` | Registrasi plugin, middleware, route groups |
| `apps/api/src/composition-root.ts` | Dependency injection — menghubungkan semua service dan repository |
| `apps/api/src/application/rbac/` | RBAC engine — permission check, data scope resolution |
| `apps/api/src/application/workflow/` | Workflow & Approval Engine (generic, dipakai semua modul) |
| `apps/api/src/application/configuration/` | Configuration & Metadata Engine (reference data, feature flags, numbering, terminology) |
| `apps/api/src/application/notification/` | Notification Engine (in-app, template-based) |
| `apps/api/src/application/event/` | EventBus in-process + `domain_events` durable log |
| `apps/api/src/modules/asset/core/` | Asset Core module (Phase 5) |
| `apps/api/src/modules/finance/core/` | Finance Core module (Phase 6) |
| `apps/api/src/modules/service-operations/core/` | Service Operations Core (Phase 2) |
| `apps/api/src/modules/workforce/core/` | Workforce Core (Phase 3) |
| `apps/api/src/modules/supply-chain/core/` | Supply Chain Core (Phase 4) |
| `apps/api/src/application/survey-integration/` | Survey-to-Action orchestrator (Phase 1E — orchestration layer, belum dipindah ke `/orchestration/`) |
| `apps/api/migrations/` | 19 migration files — stream tunggal deterministik |
| `apps/api/scripts/seed.ts` | Demo tenant seeder (`demo-gs`) |
| `apps/api/scripts/sync-role-permissions.ts` | Idempoten permission sync untuk role `is_full_access` |
| `infra/postgres/docker-compose.yml` | PostgreSQL dev environment |

### Memory & Progress Tracking

| File | Fungsi |
|---|---|
| `memory/MEMORY.md` | Indeks memori sesi — menunjuk ke sub-files |
| `memory/product-canonical-docs.md` | Snapshot progress dari global audit |
| `memory/phase1d-closure-state.md` | Closure state Phase 1D/1E |
| `memory/phase1c-preparation-state.md` | Persiapan 1C + 4 pending decisions (sudah lewat, konteks historis) |

---

## 6. Keputusan Teknis

Keputusan berikut adalah **binding** dan tidak boleh dibalik tanpa Founder Decision baru:

### Platform & Data Layer

| Keputusan | Ringkasan | Referensi |
|---|---|---|
| **No Prisma** | Diganti `pg` + `node-pg-migrate` karena binary Prisma diblokir network allowlist | ADR-0002 |
| **Monorepo npm workspaces** | `apps/api` + `apps/web` + `packages/contracts`, tanpa Turborepo/Nx | Decision Log 0A |
| **Fastify (bukan Express)** | JSON Schema native, TypeScript support kuat, OpenAPI-ready | ADR-0001 |
| **PostgreSQL dedicated per client** | Bukan shared multi-tenant database; bukan RLS aktif | ADR-0002, ADR-0003 |
| **Password: bcryptjs (pure JS)** | Menghindari dependency native binary (pelajaran dari Prisma) | Decision Log 0B |

### RBAC & Data Scope

| Keputusan | Ringkasan | Referensi |
|---|---|---|
| **Permission tidak di-embed JWT** | Di-fetch dari DB tiap request — mencegah stale permission | Decision Log 0B |
| **Data Scope hierarkis (recursive ancestor walk)** | Assignment di unit induk otomatis mencakup seluruh descendant | ADR-0009 |
| **3 dimensi Data Scope** | `tenant` / `organization_unit` / `customer` | ADR-0011 |
| **Entity Authorization Resolver** | Attachment mengikuti otorisasi parent entity, bukan permission `document.*` terpisah | ADR-0012 |

### Business Logic

| Keputusan | Ringkasan | Referensi |
|---|---|---|
| **Workflow Engine generic** | Lifecycle Complaint/Finance/Asset/dll. TIDAK hardcoded di service masing-masing — semua melalui Workflow Engine Phase 0 | ADR-0013 |
| **Money = `numeric(18,2)` + string di atas DB** | Tidak ada nilai uang yang menyentuh binary floating point | Decision Log Phase 6 |
| **Immutable ledger** | Koreksi = transaksi baru berkompensasi; tidak ada PATCH/DELETE pada transaksi yang sudah applied | Phase 6 §19 |
| **Asset movement ledger** | Status/lokasi aset HANYA bisa berubah lewat movement ledger — tidak ada PATCH langsung | Phase 5 §41 |
| **Negative stock/balance dilarang di Core** | Kebijakan overdraft adalah Advanced Capability, bukan default | Phase 4 §19, Phase 6 §24 |

### Arsitektur Kode

| Keputusan | Ringkasan | Referensi |
|---|---|---|
| **Target: module-first (`modules/<modul>/core/advanced/packs/`)** | Berlaku untuk semua kode Phase 2+. Kode Phase 0–1 masih di layer-first (`application/`, dll.) — **migrasi DITUNDA** | Blueprint §11A |
| **Source restructure Phase 0–1 DEFERRED** | ~309 import-path rewrites untuk zero behavioural gain. Dilakukan opportunistically per modul | Decision Log post-audit |
| **Migration stream tunggal** | Semua migrasi di `apps/api/migrations/`, diurutkan berdasarkan timestamp | Decision Log post-audit |
| **`docs/decision-log.md` dan `docs/adr/` tetap di `docs/` root** | 15 source-code comments mengacu path-path ini — jangan dipindahkan | Decision Log post-audit |

---

## 7. Masalah yang Belum Selesai

### MUST FIX BEFORE PILOT (Platform Hardening — Phase H)

| Item | Roadmap Unit | Detail |
|---|---|---|
| **Tidak ada CI/CD pipeline** | PH-1 | Semua gate (lint/typecheck/test/build) masih dijalankan manual. Carry-over sejak Checkpoint 0A. |
| **CORS masih permisif (`origin: true`)** | PH-2 | Harus diganti allowlist eksplisit (`CORS_ORIGIN` env var) sebelum domain pilot client dipastikan. |
| **Operational queue N+1** | PH-5 | `ComplaintService.listOperationalQueue` enriches per-complaint. Aman pada skala pilot kecil; harus dioptimasi sebelum beban nyata. |
| **`react-router-dom` advisory (moderate)** | PH-6 | Open-redirect via backslash — tidak applicable pada penggunaan saat ini (navigasi internal literal, client-only SPA). Evaluasi + remediate. |
| **PWA icons PNG 192/512 belum ada** | PH-7 | Hanya SVG neutral icon. Untuk installability penuh lintas-browser. |

**Pilot Gate saat ini: Functionality satisfied (8 modul Business Core delivered) — BLOCKED on Phase H.**

### MUST FIX BEFORE PRODUCTION (Phase H2)

| Item | Roadmap Unit |
|---|---|
| Backup / restore / DR runbook | PH-3 |
| Deployment & environment provisioning automation | PH-4 |
| Integration reconciliation / outbox worker (EventBus in-process, fire-once, menelan subscriber errors) | PH-8 |

### SHOULD FIX LATER (Technical Debt Aktif)

- **Shared date-format import lintas-modul** — survey pages masih import dari `../complaints/format` (bukan bug, tapi coupling lokasi).
- **Endpoint update/soft-delete** untuk banyak entity (Organization Unit, User, Customer, Contract, Project, Site, Complaint, dll.) — create-only sejak Phase 0.
- **RBAC admin UI** untuk kurasi Role kurasi (non-`is_full_access`) — saat ini hanya bisa lewat seed/migration langsung.
- **Scheduler in-process** — bukan job runner tahan-restart; bila proses mati di tengah interval, jadwal tidak dikejar.
- **Pagination** pada banyak endpoint listing (`GET /organization-units`, `GET /users`, dll.) — aman pada skala demo/pilot kecil.
- **`JWT_REFRESH_SECRET` di `.env.example`** adalah dead config — refresh token bersifat opaque, bukan JWT bertanda tangan.
- **Friendly names di timeline** — aktor operasional/verifikasi ditampilkan sebagai truncated userId, bukan nama.

### Business Core yang Belum Dimulai

| Modul | Units |
|---|---|
| HSE Core | HSE.1–HSE.4 (9 pts) |
| Project Delivery Core | PRJ.1–PRJ.4 (8 pts) |
| Reporting & Operational Insight | RPT.1–RPT.4 (10 pts) |
| Customer & Commercial (CUS.4) | Admin UI untuk Customer (2 pts) |

### Advanced Capabilities

Seluruh 179 pts Advanced Capabilities belum dimulai, kecuali 6 pts Survey-to-Action yang sudah delivered di Phase 1E.

---

## 8. Test / Build Command

### Menjalankan Aplikasi

```bash
# Dev — jalankan API dan Web secara terpisah
npm run dev:api       # apps/api — tsx watch (port default 3000)
npm run dev:web       # apps/web — Vite dev server

# Atau jalankan dari masing-masing direktori:
cd apps/api && npm run dev
cd apps/web && npm run dev
```

### Build Produksi

```bash
# Build semua workspace
npm run build

# Atau per workspace
npm run build -w apps/api   # tsc → dist/
npm run build -w apps/web   # Vite build
```

### Testing

```bash
# Jalankan seluruh test suite (backend — Vitest)
npm test

# Atau langsung dari apps/api
cd apps/api && npm test
# Setara: cross-env SCHEDULER_DISABLED=true vitest run
```

**Test suite terakhir yang terverifikasi: 234 PASS (20 files) pada commit `317f1c2`.**

### Linting & Typecheck

```bash
npm run lint         # ESLint di apps/api dan apps/web
npm run typecheck    # tsc --noEmit di apps/api dan apps/web
```

### Database

```bash
# Jalankan PostgreSQL (Docker)
npm run db:up
npm run db:down

# Migrasi
npm run migrate                         # node-pg-migrate up (dari root)
cd apps/api && npm run migrate          # sama
cd apps/api && npm run migrate:down     # rollback 1 migration
cd apps/api && npm run migrate:create -- <nama>  # buat migration baru

# Seed demo tenant
cd apps/api && npm run seed

# Sync permissions untuk role is_full_access (idempoten)
cd apps/api && npm run sync-permissions
```

### E2E Smoke Test

```bash
cd apps/api && node e2e/smoke.mjs
# Memerlukan Playwright Chromium terinstal:
# npx playwright install chromium
```

---

## 9. Langkah Berikutnya

### Segera (menunggu Founder approval)

1. **Phase 7 — HSE Core** adalah fase berikutnya berdasarkan dependency order di roadmap.
   - Units: HSE.1 (Incident + observation capture, L=3), HSE.2 (Category/location/evidence/follow-up, L=3), HSE.3 (HSE UX, M=2), HSE.4 (Stabilization, S=1). Total 9 pts.
   - Dependensi: Platform Core ✅, BC-4 Service Operations ✅.

2. **Phase H — Platform Hardening (Pilot gate)** dapat berjalan **paralel** dengan fase Business Core mana pun:
   - Units: PH-1 (CI/CD), PH-2 (CORS + rate limit), PH-5 (N+1 fix), PH-6 (advisory), PH-7 (PWA icons). Total 9 pts.
   - **Ini adalah satu-satunya blocker Pilot Gate** — tidak ada blocker dari sisi Business Core.

### Fase Selanjutnya (dependency-ordered)

| Fase | Nama | Dependensi |
|---|---|---|
| Phase 8 | Project Delivery Core (PRJ.1–PRJ.4, 8 pts) | BC-1 ✅ |
| Phase 9 | Reporting & Operational Insight (RPT.1–RPT.4, 10 pts) | ≥3 Business Cores ✅ |
| Phase 10 | Customer & Commercial completion (CUS.4, 2 pts) | BC-1 ✅ |
| Phase H2 | Platform Hardening Production gate (PH-3, PH-4, PH-8) | Phase H |
| Wave A+ | Advanced Capabilities (per modul, 179 pts total) | Respective Core |

### Teknis (tanpa perlu Founder approval)

- Resolving SHOULD FIX LATER items secara opportunistis saat mengerjakan modul yang relevan.
- Migrasi source code Phase 0–1 dari `application/` ke struktur `modules/` target (dilakukan per modul, bukan big bang).

---

## 10. Risiko dan Hal yang Tidak Boleh Diubah

### ❌ TIDAK BOLEH — Tanpa Founder Decision Eksplisit

| Larangan | Alasan |
|---|---|
| **Mengubah angka atau status di dokumen kanonis** (`product-progress.md`, `product-roadmap.md`, `product-blueprint.md`) | Angka progress adalah hasil kalkulasi terverifikasi dan bersifat audit-traceable. Perubahan hanya boleh lewat proses pengerjaan fase resmi. |
| **Menambah scope ke roadmap denominator** | Setiap penambahan scope yang genuine harus lewat Founder Decision dan dicatat dalam change log roadmap. |
| **Mengubah arsitektur lapisan produk** (Platform Core / Business Core / Advanced / Client Config / Client Extension) | Struktur ini adalah keputusan Founder pre-Phase-0 yang binding. |
| **Memanggil "whitelabel", "shared core", "reusable platform", atau "product core" di UI/dokumen client-facing** | ADR-0003. |
| **Menambah state machine business logic di luar Workflow Engine** | Semua lifecycle (complaint, finance, asset, dll.) HARUS melalui Workflow Engine generic. |
| **Memuat nilai uang melalui binary floating point** | `numeric(18,2)` di DB, string di atas DB — tidak ada `parseFloat()` pada nilai uang. |

### ⚠️ HATI-HATI — Area Risiko Tinggi

| Area | Risiko |
|---|---|
| **Schema database (migrasi)** | Setiap migration bersifat **permanen dan deterministik**. Tidak ada edit migrasi yang sudah berjalan. Rollback hanya lewat `migrate:down` pada environment dev. |
| **`apps/api/migrations/` stream** | Stream tunggal — tidak pernah ada dua migrasi dengan timestamp sama. Buat selalu dengan `npm run migrate:create`. |
| **Urutkan `composition-root.ts`** | File ini menghubungkan semua dependency. Penambahan modul baru HARUS didaftarkan di sini. |
| **`docs/decision-log.md` dan `docs/adr/`** | Dikutip dari 15 source-code comments berdasarkan path. Jangan dipindahkan. |
| **`is_full_access` role** | Role dengan flag ini mendapat semua permission secara otomatis. Jangan buat role production dengan flag ini tanpa pertimbangan matang. |
| **EventBus in-process** | Bersifat fire-once dan menelan subscriber errors. Jangan andalkan untuk critical side-effects tanpa outbox worker (PH-8). |
| **Trusted caller seams** (`createAssignmentForTrustedIntegration`, `getInstanceForEntityOwner`, dll.)** | Bypass permission check, BUKAN integrity check. Jangan gunakan untuk bypass validasi business. |
| **`localStorage` untuk session** | Ini trade-off yang disengaja untuk Dedicated Deployment (ADR-0003). Jangan ganti ke httpOnly cookie tanpa Founder Decision — ini perubahan arsitektur besar. |

### ✅ AMAN Dilakukan

- Membuat Roadmap Unit baru dari `PLANNED` ke `IN PROGRESS` → `COMPLETED` lewat fase resmi.
- Menambah modul baru di bawah `apps/api/src/modules/<modul>/core/` mengikuti pola Phase 2–6.
- Menambah test coverage.
- Menyelesaikan SHOULD FIX LATER items yang tidak mengubah skema atau kontrak API.
- Memindahkan kode Phase 0–1 ke struktur target secara opportunistis (satu modul sekaligus, bukan big bang).
- Membuat migration baru untuk modul baru.

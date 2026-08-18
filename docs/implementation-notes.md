# Implementation Notes — Checkpoint 0A: Project Bootstrap

**Status: COMPLETE**
**Date: 2026-08-18**

## What was built

- Git repository initialized at the monorepo root with npm workspaces:
  `apps/api`, `apps/web`, `packages/contracts`.
- `apps/api`: Fastify + TypeScript backend. Hexagonal-style folders
  (`domain/`, `application/`, `infrastructure/`, `interfaces/http/`) created
  but intentionally empty of business logic — Checkpoint 0A is
  connectivity-only, no domain models yet (see ADR-0002 and
  `03-Core-Data-Foundation.md` — domain entities start Checkpoint 0B).
- `apps/web`: React + Vite + TypeScript + Tailwind. `ApplicationShell`
  component matches the shell regions from
  `08-Application-Shell-Design-System-Foundation.md` (Navigation +
  placeholder content area implemented; Dashboard/Workspace/Module/
  Transaction/Approval/Reporting/Administration regions are labeled as
  future-checkpoint placeholders in the nav, not yet functional).
- `infra/postgres/docker-compose.yml`: local PostgreSQL 16 for
  environments with a Docker daemon.
- Migration pipeline: `node-pg-migrate`, one migration applied
  (`pgcrypto` extension) proving the pipeline works against a real
  database, not just in theory.
- End-to-end vertical slice proven: `apps/web` (Vite dev server) →
  `/api/*` proxy → `apps/api` (Fastify) → PostgreSQL, via `/health` and
  `/health/db` endpoints. This mirrors the Database → Domain → Application
  Service → API → Frontend chain required before extending the foundation
  (per the Execution Protocol's vertical-slice instruction), minus
  Authentication/Authorization/Audit, which are Checkpoint 0B's job.
- Quality gates run and passing: `typecheck`, `lint`, `test` (1 passing
  test) for both `apps/api` and `apps/web`; production `build` succeeds
  for both.
- Three ADRs recorded: backend stack (binding), database (binding, with a
  documented implementation pivot from Prisma to pg/node-pg-migrate), and
  the technical enforcement mechanism for the "no whitelabel client-facing
  strings" rule.

## Known limitations / gaps at end of Checkpoint 0A

- No CI/CD pipeline wired yet (no remote git host configured in this
  session). Local quality gates (lint/typecheck/test/build) all pass and
  are ready to be wrapped in a CI workflow once a host (GitHub/GitLab) is
  chosen.
- No Docker daemon available in this implementation workspace to validate
  `infra/postgres/docker-compose.yml` directly; connectivity was instead
  proven against the sandbox's native PostgreSQL service. The compose file
  itself is standard and should be validated in a normal dev machine/CI
  environment before being treated as fully proven.
- No authentication, RBAC, tenant/org data, or audit trail yet — by design,
  these are Checkpoint 0B.
- Design System visual tokens (colors beyond Tailwind defaults, typography
  scale) not yet defined — deferred until real Branding Configuration
  exists (Checkpoint 0C), to avoid designing against an assumed client.

## Readiness for Checkpoint 0B

Foundation is stable enough to start the Identity & Organization Vertical
Slice: Tenant → Legal Entity → Organization Unit → User → Authentication →
RBAC → thin frontend → Audit, end-to-end from login through a real UI
action, per `01-Tenant-Legal-Entity-Organization-Model.md`,
`02-Identity-Security-RBAC-Foundation.md`, and `03-Core-Data-Foundation.md`.

No blockers identified. Proceeding to Checkpoint 0B requires no new Founder
Decision — it follows directly from the already-approved blueprint.

---

# Implementation Notes — Checkpoint 0B: Identity & Organization Vertical Slice

**Status: COMPLETE**
**Tanggal: 2026-08-18**

## Apa yang dibangun

Alur end-to-end yang dibuktikan (sesuai target minimal Checkpoint 0B):

```
Tenant → Legal Entity → Organization Unit (hierarki) → User → Authentication
→ RBAC (Role + Permission + Data Scope) → Thin Frontend → Audit Trail → PostgreSQL
```

- **Skema database** (migration `1755600000000` dan `1755600100000`):
  tabel `tenants`, `legal_entities`, `organization_units` (rekursif via
  `parent_id`), `users`, `roles`, `permissions` (katalog global, Product
  Core), `role_permissions`, `user_role_assignments` (Role + Data Scope),
  `refresh_tokens`, `audit_log` (append-only). Sesuai dokumen 01, 02, 03.
- **Domain & Repository layer** (hexagonal): setiap entity punya
  domain interface (`domain/*/*.entity.ts`) dan implementasi PostgreSQL
  terpisah (`infrastructure/persistence/repositories/*.pg.ts`) — application
  layer hanya bergantung pada interface, bukan implementasi konkret.
- **Authentication**: login dengan `tenantCode` + `email` + `password`,
  password di-hash dengan bcryptjs, access token JWT (15 menit, TIDAK
  membawa daftar permission — permission selalu dicek ulang ke database
  agar perubahan role langsung berlaku), refresh token opaque tersimpan
  sebagai hash SHA-256 di database dengan rotasi (token lama direvoke saat
  dipakai).
- **RBAC + Data Scope**: `RbacService.requirePermission()` dan
  `requireOrganizationUnitScope()` dipanggil dari setiap use-case mutasi
  SEBELUM operasi database dijalankan — bukan hanya validasi di frontend.
  Terbukti lewat test: user dengan role read-only mendapat HTTP 403 saat
  mencoba membuat Organization Unit atau User, dan daftar Organization
  Unit yang dilihat otomatis terfilter sesuai Data Scope miliknya.
- **Audit Trail**: setiap aksi penting (tenant dibuat, legal entity dibuat,
  organization unit dibuat, user dibuat, role assignment dibuat, login
  sukses, login gagal) otomatis menghasilkan baris di `audit_log` — bukan
  opsional, dipanggil langsung dari application service yang sama dengan
  operasi utamanya, dalam service call yang sama.
- **Thin Frontend**: halaman Login (Tenant code + email + password) dan
  Dashboard yang menampilkan info Tenant, pohon Organization Unit, daftar
  Legal Entity, daftar User, dan Audit Trail terbaru — lengkap dengan form
  untuk membuat Organization Unit, Legal Entity, dan User. Form ditampilkan
  ke SEMUA user yang login (tidak disembunyikan berdasar permission),
  supaya penolakan 403 dari backend benar-benar terbukti berasal dari
  backend, bukan dari frontend yang menyembunyikan tombol.
- **Seed script** (`npm run seed -w apps/api`): membuat 1 Tenant demo
  (`demo-gs`) lengkap dengan Legal Entity, 2 Organization Unit berhierarki
  (Head Office → Site A), role ADMIN (semua permission, scope tenant) dan
  SUPERVISOR (permission read-only, scope Site A saja), serta 2 user demo.
- **Test**: 1 unit test lama (health) + 13 test integrasi baru
  (`tests/integration/vertical-slice.test.ts`) yang berjalan terhadap
  PostgreSQL sungguhan (bukan mock), mencakup: login sukses/gagal (dengan
  cek audit trail), create Legal Entity, create Organization Unit
  berhierarki, create User dengan Role + Data Scope, verifikasi `/me`
  menunjukkan permission yang benar, verifikasi daftar Organization Unit
  ter-filter oleh Data Scope, penolakan 403 untuk create tanpa permission
  (dua kasus: Organization Unit dan User) dengan pembuktian bahwa data
  BENAR-BENAR tidak tersimpan di database saat ditolak, penolakan 401 tanpa
  token dan tanpa bootstrap key, pengecekan audit trail berisi seluruh aksi
  di atas, dan verifikasi langsung ke PostgreSQL (query manual, bukan
  lewat API) bahwa seluruh entity benar-benar tersimpan.

## Pembuktian manual tambahan (di luar automated test)

Selain 14 automated test, dilakukan verifikasi manual langsung terhadap
server yang berjalan (curl) dan lewat proxy Vite (mensimulasikan panggilan
dari browser): login admin & supervisor, `/me`, `/tenants/me`,
`/organization-units`, `/legal-entities`, `/users`, `/audit-log/recent`,
penolakan create oleh Supervisor, penolakan tanpa token, serta bootstrap
Tenant baru dengan dan tanpa bootstrap key. Seluruh hasil sesuai ekspektasi.

## Keterbatasan / gap yang diketahui di akhir Checkpoint 0B

- **Data Scope belum rekursif** — scope `organization_unit` hanya
  cocok-persis (exact match), belum otomatis mencakup Organization Unit
  turunannya. Didokumentasikan sebagai ADR-0005, bukan asumsi diam-diam.
  Tidak memerlukan perubahan skema untuk diperbaiki nanti.
- **Belum ada endpoint update/delete (soft delete)** untuk Tenant/Legal
  Entity/Organization Unit/User — target minimal 0B hanya create+read,
  sesuai permintaan.
- **Belum ada endpoint "assign/ubah role"** terpisah untuk user yang sudah
  ada — assignment role saat ini hanya terjadi bersamaan dengan pembuatan
  user baru.
- **Penyimpanan token di frontend bersifat in-memory saja** — sesi hilang
  saat halaman di-refresh. Strategi persistensi (misalnya httpOnly cookie)
  belum diputuskan, sengaja dibiarkan terbuka sebagai keputusan yang perlu
  diambil di checkpoint berikutnya, bukan diasumsikan tanpa dasar.
- **Belum ada CI/CD** (carry-over dari Checkpoint 0A) — seluruh gate
  (lint/typecheck/test/build) sudah terbukti hijau secara lokal, tinggal
  dibungkus pipeline begitu remote git host dipilih.
- **Rate limiting dan idempotency key** untuk operasi kritikal (disebut di
  dokumen 07) belum diimplementasikan — bukan bagian dari target minimal
  0B, dicatat untuk Checkpoint 0E (Enterprise Shared Services) atau saat
  API & Integration Foundation diperluas.

## Risk Note

| Risiko | Dampak | Kemungkinan | Mitigasi saat ini / rencana |
|---|---|---|---|
| Data Scope belum rekursif bisa disalahpahami sebagai "sudah lengkap" oleh tim lain | Sedang — bila diasumsikan lengkap, role hierarkis (mis. Regional Manager) tidak akan berfungsi sesuai ekspektasi bisnis | Sedang | Dicatat eksplisit di ADR-0005 dan decision log; wajib dibaca sebelum membangun modul yang bergantung pada scope hierarkis (Complaint/Survey pilot) |
| Bootstrap key (`PLATFORM_BOOTSTRAP_KEY`) adalah satu secret statis per deployment | Tinggi bila bocor — siapa pun yang memegangnya bisa membuat Tenant baru | Rendah (hanya dipegang tim engineering internal, sesuai Dedicated Deployment) | ADR-0004 mencatat kebutuhan rotasi/pencabutan akses setelah provisioning selesai sebagai keputusan operasional terpisah, belum final |
| Access token tidak membawa permission, sehingga setiap request melakukan query database tambahan untuk cek permission | Rendah pada skala pilot; berpotensi jadi bottleneck di skala besar | Rendah untuk Phase 0 | Trade-off sengaja dipilih demi konsistensi (permission langsung berlaku), didokumentasikan; dapat dioptimalkan dengan caching di checkpoint performa nanti bila terbukti perlu lewat benchmark, bukan diasumsikan sekarang |
| Frontend menampilkan form create ke semua user tanpa filter permission di UI | Rendah — ini disengaja untuk membuktikan enforcement backend, tapi bisa terasa membingungkan secara UX produksi nyata | Sedang | Sesuai instruksi eksplisit ("backend benar-benar melakukan authorization, bukan hanya menyembunyikan UI"); penyaringan UI berbasis permission dapat ditambahkan di checkpoint UX berikutnya tanpa mengubah enforcement backend |
| Test integrasi menulis Tenant sungguhan ke database dev yang sama dipakai untuk development manual | Rendah | Rendah | Test melakukan cleanup otomatis (`afterAll` menghapus Tenant beserta seluruh data turunannya via cascade) |

## Kesiapan untuk Checkpoint 0C

Fondasi Identity & Organization sudah stabil dan teruji end-to-end. Tidak
ada blocker untuk memulai **Checkpoint 0C — Configuration & Metadata
Foundation** (module activation, terminology, status/reference
configuration, feature flags, configuration audit) begitu mendapat
persetujuan review dari Founder.

**Menunggu review Founder sebelum masuk Checkpoint 0C**, sesuai instruksi.

---

# Implementation Notes — Checkpoint 0C: Configuration & Metadata Foundation

**Status: COMPLETE**
**Tanggal: 2026-08-18**

## Apa yang dibangun

Alur end-to-end yang dibuktikan (sesuai target minimal Checkpoint 0C):

```
Schema Registry (Product Core, JSON Schema per area/key)
  → Module Activation, Feature Flags (dengan Configuration Scope),
    Terminology, Reference Data, Numbering (Tenant Configuration Store)
  → Configuration API (13 endpoint, RBAC + Ajv validation)
  → Thin Frontend (Configuration panel + label UI dari Terminology)
  → Configuration Audit → PostgreSQL
```

- **Skema database** (migration `1755700000000`): tabel `metadata_registry`
  (Schema Registry — Product Core, migration-seeded, tidak pernah bisa
  diubah Tenant), `modules` + `tenant_module_activations`, `feature_flags`
  + `tenant_feature_flags` (dengan dua partial unique index untuk
  Configuration Scope, lihat ADR-0006), `terminology_keys` +
  `tenant_terminology_overrides`, `reference_data_types` +
  `tenant_reference_data_items`, `numbering_sequences`. Plus 2 permission
  baru (`config.read`, `config.manage`) dan seed katalog Product Core
  (2 module, 2 feature flag, 3 terminology key, 2 reference data type).
- **Schema Registry sebagai mekanisme nyata**: `SchemaRegistryValidator`
  memvalidasi setiap nilai Tenant Configuration terhadap JSON Schema yang
  tersimpan di `metadata_registry` memakai Ajv (compiled validator
  di-cache per area/key), dipanggil dari `ConfigurationService` SEBELUM
  nilai ditulis ke database. Nilai yang gagal validasi ditolak dengan
  HTTP 400 beserta detail error Ajv — bukan hanya konvensi dokumentasi.
- **Module Activation**: aktivasi per-Tenant lewat
  `tenant_module_activations`, tidak mengubah baris `modules` (katalog
  Product Core) sama sekali.
- **Feature Flags + Configuration Scope**: precedence
  Organization Unit override > Tenant override > catalog default,
  dibuktikan dengan `GET /config/feature-flags/effective` yang
  mengembalikan `source` (`catalog_default` | `tenant` |
  `organization_unit`) sehingga resolusi bisa diverifikasi independen,
  bukan hanya dipercaya.
- **Terminology**: override per-Tenant untuk label UI (mis.
  "Organization Unit" → "Site"), divalidasi Ajv, dipakai langsung oleh
  frontend Dashboard untuk judul section "Organization Units" — bukan
  string hardcode.
- **Reference Data**: tipe reference data adalah katalog Product Core
  (`reference_data_types`), item-nya 100% milik Tenant
  (`tenant_reference_data_items`), termasuk penanganan duplikat kode
  sebagai HTTP 409 (`ConflictError` dari Postgres `23505`), bukan 500.
- **Numbering**: pattern per-Tenant dengan token `{YYYY}`, `{MM}`,
  `{SEQ}`/`{SEQ:N}`, increment atomik lewat satu `UPDATE ... RETURNING`
  (tidak perlu row locking eksplisit).
- **Configuration Audit**: setiap mutasi (module activation, feature
  flag, terminology, reference data create, numbering sequence create,
  numbering generate) memanggil `AuditService` dalam service call yang
  sama, sama seperti pola 0B.
- **RBAC**: seluruh endpoint baca butuh `config.read`, seluruh endpoint
  tulis butuh `config.manage`; override di level Organization Unit juga
  memanggil `requireOrganizationUnitScope` untuk role yang scope-nya
  terbatas.
- **Thin Frontend — Configuration panel**: ditambahkan ke Dashboard,
  menampilkan Module Activation (toggle), Feature Flags dengan pemilih
  Organization Unit untuk melihat resolusi efektif + tombol override,
  Terminology (daftar + form override), Reference Data (daftar per tipe +
  form create), dan Numbering (info sequence + tombol generate). Tombol
  mutasi hanya aktif untuk user dengan `config.manage` (kontrol UI sebagai
  kenyamanan, bukan pengganti enforcement backend — backend tetap
  menolak 403 terlepas dari kondisi tombol).
- **Seed script**: Supervisor role ditambah `config.read`; tenant demo
  `demo-gs` mendapat data Configuration nyata — 1 module aktif, 1 feature
  flag dengan nilai tenant + override di Site A (membuktikan
  Configuration Scope end-to-end), 1 terminology override, 2 reference
  data item, 1 numbering sequence. Tenant demo lama dihapus dan di-seed
  ulang agar role ADMIN memiliki permission `config.*` yang baru (lihat
  Risk Note untuk keterbatasan pendekatan ini di lingkungan produksi).
- **Test**: 9 test integrasi baru
  (`tests/integration/configuration.test.ts`), berjalan terhadap
  PostgreSQL sungguhan, mencakup: katalog Module kosong di Tenant baru,
  aktivasi Module tenant-specific, resolusi Configuration Scope penuh
  (catalog default → tenant override → organization_unit override, dan
  Organization Unit lain yang tidak di-override tetap jatuh ke nilai
  tenant), penolakan Ajv untuk nilai Terminology tidak valid, penerimaan
  override Terminology valid, create Reference Data + penolakan duplikat
  (409, dan verifikasi tidak ada baris ganda di database), generate
  Numbering dua kali berturut-turut dengan verifikasi increment atomik
  langsung ke `numbering_sequences`, penolakan 403 untuk role read-only
  yang mencoba mutasi (dengan verifikasi tidak ada baris tertulis), dan
  verifikasi Configuration Audit mencatat seluruh aksi mutasi di atas.
  Total 23 test (14 lama + 9 baru) tetap hijau, tidak ada regresi.

## Pembuktian manual tambahan (di luar automated test)

Smoke test manual lewat curl terhadap server yang berjalan: login admin,
`GET /config/modules`, `GET /config/feature-flags`,
`GET /config/feature-flags/effective` di dua Organization Unit berbeda
(Site A vs Head Office, membuktikan Configuration Scope), penolakan
Terminology dengan nilai kosong (400, Ajv), create Reference Data +
percobaan duplikat (409), generate Numbering tiga kali berturut-turut
(TCK-2026-00001 → 00003), login Supervisor lalu percobaan mutasi Module
Activation dan Feature Flag di luar scope-nya (403 keduanya), dan
verifikasi langsung ke `audit_log` bahwa mutasi lewat API benar-benar
tercatat sedangkan percobaan yang gagal validasi (Terminology kosong)
TIDAK tercatat (sesuai — error dilempar sebelum audit dipanggil).

## Keterbatasan / gap yang diketahui di akhir Checkpoint 0C

- **Terminology override baru tenant-scope**, belum per-Organization-Unit
  — pola partial-unique-index (ADR-0006) sudah siap dipakai ulang bila
  dibutuhkan nanti, tidak perlu desain ulang skema.
- **Belum ada mekanisme migrasi permission otomatis** untuk tenant yang
  SUDAH berjalan di produksi saat permission baru (`config.read`,
  `config.manage`) ditambahkan lewat migration — pendekatan "hapus lalu
  seed ulang" yang dipakai di sesi ini HANYA valid untuk tenant demo/dev.
  Tenant produksi butuh strategi migrasi permission terpisah (mis. script
  backfill `role_permissions` untuk role yang sudah ada), belum
  diimplementasikan, dicatat sebagai gap eksplisit — bukan diasumsikan
  otomatis.
- **Reference Data dan Numbering Sequence belum punya endpoint
  update/deactivate** — 0C hanya membuktikan create+read+generate sesuai
  target minimal.
- **Frontend Configuration panel belum melalui smoke test visual browser
  sungguhan** — lingkungan implementasi ini tidak memiliki akses browser
  ke dev server yang berjalan di dalam container, sehingga verifikasi
  frontend berhenti di: `typecheck` bersih, `lint` bersih, `build`
  produksi sukses, dan pemanggilan API yang identik dengan yang dipanggil
  komponen frontend sudah diverifikasi hijau lewat curl. Verifikasi
  visual sungguhan (klik tombol di browser nyata) disarankan sebagai
  langkah manual oleh Founder atau di checkpoint berikutnya.
- **Resolusi Configuration Scope belum di-cache** — setiap panggilan
  `/config/feature-flags/effective` query database langsung. Cukup untuk
  skala Phase 0, dicatat sebagai titik optimasi masa depan jika
  benchmark membuktikan perlu (bukan diasumsikan sekarang).
- **CI/CD masih belum ada** (carry-over dari 0A/0B).

## Risk Note

| Risiko | Dampak | Kemungkinan | Mitigasi saat ini / rencana |
|---|---|---|---|
| Reseed tenant (delete + seed ulang) dipakai untuk menyebarkan permission baru ke role yang sudah ada | Tinggi bila pola ini ditiru di tenant produksi — kehilangan seluruh data tenant | Rendah untuk 0C (hanya dipakai di tenant demo `demo-gs`), tapi risikonya nyata bila tim lain meniru pola ini tanpa membaca catatan ini | Didokumentasikan eksplisit di decision log dan di sini sebagai "khusus demo/dev, bukan pola migrasi produksi"; strategi migrasi permission produksi (backfill `role_permissions`) dicatat sebagai item terbuka, bukan diasumsikan selesai |
| Schema Registry entry yang hilang (area/key belum di-seed migration) menyebabkan seluruh operasi terkait gagal keras (`ValidationError`, bukan fallback diam-diam) | Sedang — mencegah data tidak tervalidasi masuk, tapi berarti setiap area/key konfigurasi baru WAJIB migration terlebih dulu sebelum dipakai | Rendah (disengaja, sesuai filosofi "metadata sebagai sumber kebenaran validasi" dok 05) | Perilaku ini disengaja dan didokumentasikan di komentar kode `schema-registry-validator.ts`; tim yang menambah area/key konfigurasi baru harus tahu migration adalah langkah wajib pertama |
| Frontend Configuration panel belum diverifikasi visual di browser sungguhan | Sedang — bug UI (styling, interaksi) mungkin belum terlihat meski `build` dan panggilan API sudah hijau | Sedang | Dicatat eksplisit sebagai gap di atas; direkomendasikan verifikasi manual oleh Founder di lingkungan yang punya akses browser, atau smoke test visual di checkpoint berikutnya |
| Resolusi Configuration Scope tanpa cache berpotensi jadi bottleneck bila jumlah feature flag atau frekuensi pemanggilan `/effective` bertambah besar | Rendah pada skala pilot | Rendah untuk Phase 0 | Trade-off sengaja dipilih demi kesederhanaan (pola sama seperti keputusan permission-tidak-di-JWT di 0B); dapat dioptimalkan dengan caching nanti bila terbukti perlu lewat benchmark |
| Test integrasi menulis Tenant sungguhan ke database dev yang sama dipakai untuk development manual | Rendah | Rendah | Sama seperti 0B — `afterAll` menghapus Tenant beserta seluruh data turunannya via cascade |

## Kesiapan untuk Checkpoint 0D

Configuration & Metadata Foundation sudah stabil dan teruji end-to-end
dari UI sampai PostgreSQL: Module Activation, Feature Flags dengan
Configuration Scope, Terminology, Reference Data, Numbering, Schema
Registry (Ajv), dan Configuration Audit seluruhnya terbukti lewat 23 test
otomatis (0 regresi dari 0A/0B) plus smoke test manual curl yang
mencakup jalur sukses, jalur validasi gagal, jalur konflik, dan jalur
RBAC-403. Tidak ada konfigurasi yang di-hardcode untuk client tertentu —
seluruh nilai Tenant Configuration berasal dari baris yang dibuat lewat
API/seed, divalidasi terhadap Schema Registry yang sepenuhnya
migration-seeded (Product Core).

Gap yang diketahui (migrasi permission produksi, Terminology belum
per-Organization-Unit, endpoint update/deactivate Reference
Data/Numbering, smoke test visual browser, caching resolusi scope) sudah
dicatat eksplisit di atas, bukan diasumsikan selesai.

**Menunggu review Founder sebelum masuk Checkpoint 0D**, sesuai instruksi.

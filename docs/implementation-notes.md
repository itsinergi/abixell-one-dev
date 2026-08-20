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

---

# Implementation Notes — Checkpoint 0D: Workflow & Approval Engine Foundation

**Status: COMPLETE**
**Tanggal: 2026-08-18**

## Apa yang dibangun

Alur end-to-end yang dibuktikan (sesuai target minimal Checkpoint 0D),
seluruhnya terhadap objek generik `demo_transactions` — TIDAK ada logic
Complaint, Survey, Procurement, atau modul bisnis apa pun, sesuai
instruksi eksplisit Founder:

```
Workflow Definition -> Version -> Step -> Transition -> Condition
  -> Assignment (role+scope ATAU specific_user) -> Approval
  -> Reject / Return-Resubmit -> Escalation -> History
  -> RBAC -> Configuration Audit -> PostgreSQL
```

- **Skema database** (migration `1755800000000`): `workflow_definitions`,
  `workflow_versions` (dengan `is_current` + partial unique index, pola
  sama seperti ADR-0006), `workflow_steps`, `workflow_transitions`
  (dengan `condition_expression` jsonb), `workflow_assignment_rules`
  (dengan Condition + dua tipe assignment), `workflow_escalation_rules`,
  `demo_transactions` (objek dummy generik), `workflow_instances`
  (dengan `context_data` jsonb — inilah yang membuat engine benar-benar
  entity-agnostic, ia tidak pernah query tabel bisnis apa pun),
  `workflow_instance_assignments` (task queue + keputusan Approval),
  `workflow_history` (jejak lengkap per instance), dan
  `workflow_notification_hooks` (hook siap-notifikasi). Plus 6 permission
  baru (`workflow.definition.manage`/`.read`,
  `workflow.instance.start`/`.read`/`.act`/`.manage`).
- **Dua bug FK "ON DELETE tanpa CASCADE" ditemukan dan diperbaiki sebelum
  migration final** (lihat decision log item #6) — kelas bug persis sama
  dengan temuan Checkpoint 0B, kali ini dikenali lebih cepat karena
  polanya sudah familiar; diperbaiki lewat siklus rollback (`npm run
  migrate:down`) → perbaikan `onDelete: "CASCADE"` pada 7 kolom FK ke
  `organization_units`/`users` → migrate ulang → reseed tenant demo.
- **Condition evaluator** (`condition-evaluator.ts`): pure function,
  enam operator (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`in`), dievaluasi
  terhadap `contextData` milik Workflow Instance — dipakai baik oleh
  Transition (menentukan tujuan berikutnya) maupun Assignment Rule
  (menentukan siapa yang menerima tugas), keduanya dengan mekanisme
  "kondisi null = selalu cocok / default".
- **WorkflowService**: seluruh orkestrasi design-time (create/list
  Definition, create/list/publish Version dengan validasi wajib —
  tepat satu Step initial, minimal satu Step terminal, setiap Step
  non-terminal wajib punya Transition keluar DAN Assignment Rule — atau
  publish ditolak 400 dengan daftar masalah) dan runtime (start
  Instance, resolve Assignment lewat Condition, act on Assignment
  dengan validasi RBAC role+scope ATAU specific-user, penentuan
  Transition berikutnya lewat Condition, penyelesaian Instance ke
  status terminal, escalation sweep). Setiap operasi mutasi memanggil
  BAIK `AuditService` (Audit Trail lintas-modul) MAUPUN
  `workflow_history` (jejak spesifik per instance) — keduanya melayani
  kebutuhan berbeda sesuai dok 04/06.
- **RBAC**: `RbacService.hasRoleCoveringScope` (baru) memeriksa apakah
  actor memegang role tertentu dalam Data Scope yang mencakup target —
  dipakai untuk memutuskan siapa berhak bertindak atas Assignment
  bertipe `role` (queue), memakai model Role + Data Scope yang sama
  persis dengan yang dibangun sejak 0B (exact-match, ADR-0005).
  Assignment bertipe `specific_user` diperiksa dengan pencocokan userId
  langsung.
- **API**: 18 endpoint `/workflow/*` (7 design-time, termasuk
  create/publish Version dan add Step/Transition/Assignment
  Rule/Escalation Rule; 11 runtime, termasuk start Instance, my-
  assignments, act, history, escalation sweep), seluruhnya di balik
  `app.authenticate`, RBAC per-permission di level Service (pola sama
  seperti 0C — HTTP layer tidak pernah cek permission sendiri).
- **Thin Frontend — Workflow panel**: ditambahkan ke Dashboard,
  menampilkan tombol "Start a Workflow Instance" (memilih Organization
  Unit dan kategori — normal vs high_risk, untuk membuktikan Condition-
  based routing dari UI), daftar "My Tasks" dengan tombol
  Approve/Reject/Return/Resubmit, tabel Workflow Instances dengan
  History per instance, dan tombol Escalation Sweep.
- **Seed script**: dua role demo baru — `WORKFLOW_REVIEWER` (scope Site
  A) dan `WORKFLOW_MANAGER` (scope tenant-wide) — plus satu Workflow
  Definition lengkap dan published (`demo_approval_workflow` v1) dengan
  4 Step (REVIEW → COMPLETE/REJECTED/REVISE), 4 Transition, 3
  Assignment Rule (2 Condition-based di REVIEW, 1 specific_user di
  REVISE), dan 1 Escalation Rule (SLA 4 jam di REVIEW). Tenant demo
  `demo-gs` di-reseed ulang agar role ADMIN memiliki permission
  `workflow.*` baru (pola sama seperti 0C, gap migrasi permission
  produksi tercatat lagi).
- **Test**: 10 test integrasi baru
  (`tests/integration/workflow.test.ts`), berjalan terhadap PostgreSQL
  sungguhan, membangun Workflow Definition-nya sendiri lewat HTTP API
  (bukan lewat seed), mencakup: routing default ke WORKFLOW_REVIEWER
  ber-scope Site, Condition-based routing ke WORKFLOW_MANAGER untuk
  kategori high_risk, penolakan 403 untuk actor yang tidak memegang
  role dalam scope yang cocok, jalur Approval penuh sampai status
  `approved`, jalur Reject sampai status `rejected`, loop
  Return→specific_user(submitter)→Resubmit kembali ke REVIEW (dengan
  pembuktian 403 saat aktor yang salah mencoba bertindak), Escalation
  sweep (backdate `due_at` manual untuk simulasi SLA lewat, verifikasi
  reassignment + History + Notification hook + Audit langsung ke
  PostgreSQL), Versioning (publish Version 2 kosong ditolak validasi
  400, Instance yang sedang berjalan tetap menunjuk Version 1 meski
  Version baru dibuat), penolakan 403 tanpa permission
  `workflow.instance.act`, dan verifikasi Audit Trail mencatat seluruh
  siklus hidup (definition created, version published, instance
  started/acted/escalated). Total 33 test (23 lama + 10 baru) hijau,
  tidak ada regresi.

## Pembuktian manual tambahan (di luar automated test)

Smoke test manual lewat curl terhadap server yang berjalan, memakai
tenant demo `demo-gs`: start instance dengan routing default (→
WORKFLOW_REVIEWER Site A, `dueAt` 4 jam ke depan), `my-assignments`
untuk reviewer vs manager (manager kosong karena task ber-scope Site,
bukan tenant), penolakan 403 saat manager mencoba bertindak di luar
role/scope-nya, Approval penuh sampai instance `approved`, Condition-
based routing kategori `high_risk` → WORKFLOW_MANAGER tenant-wide,
Reject sampai instance `rejected`, loop Return→Resubmit lengkap dengan
penolakan 403 aktor salah, Escalation sweep (backdate `due_at` via SQL
langsung, verifikasi reassignment ke WORKFLOW_MANAGER + Audit Trail +
Notification hook), dan Versioning (create Version 2, publish ditolak
validasi karena kosong, Version 1 tetap `is_current`). Seluruh hasil
sesuai ekspektasi.

## Keterbatasan / gap yang diketahui di akhir Checkpoint 0D

- **Tidak ada mekanisme claim/lock** untuk Assignment bertipe `role` —
  siapa pun pemegang role dalam scope yang cocok bisa mencoba
  bertindak; yang pertama sampai ke database yang menang (percobaan
  kedua mendapat `ConflictError`, bukan silang data diam-diam).
  Didokumentasikan sebagai simplifikasi sengaja di ADR-0007.
- **Escalation sweep tidak otomatis** — tidak ada scheduler/cron di
  lingkungan implementasi ini yang memicu sweep secara berkala;
  mekanismenya sendiri terbukti benar lewat pemicu manual/API. Carry-
  over dari gap "belum ada CI/CD" filosofinya sama: infrastruktur
  penjadwalan belum ada, bukan logic yang salah.
- **Data Scope untuk Workflow Assignment masih exact-match**, carry-over
  langsung dari ADR-0005 — belum rekursif ke Organization Unit turunan.
- **Belum ada mekanisme migrasi permission untuk tenant produksi** yang
  sudah live saat permission baru ditambahkan lewat migration — gap
  yang sama dari 0C, terbukti relevan lagi di sini (reseed hanya valid
  untuk tenant demo/dev).
- **Belum ada endpoint cancel/reopen Instance** secara eksplisit (dok 04
  menyebutnya sebagai kapabilitas generik engine) — 0D membuktikan
  Submit→Validate(implisit via Assignment)→Review→Approve/Reject/
  Return→Escalate→Complete sesuai target minimal; cancellation dan
  reopen didesain agar mudah ditambahkan nanti (Instance sudah punya
  kolom `status` yang mendukung status tambahan) tapi belum
  diimplementasikan.
- **Frontend Workflow panel belum melalui smoke test visual browser
  sungguhan** — keterbatasan yang sama seperti Checkpoint 0C (lingkungan
  implementasi tidak punya akses browser ke dev server container);
  diverifikasi lewat `typecheck`/`lint`/`build` sukses dan pemanggilan
  API yang identik sudah diverifikasi hijau lewat curl.
- **CI/CD masih belum ada** (carry-over dari 0A/0B/0C).

## Risk Note

| Risiko | Dampak | Kemungkinan | Mitigasi saat ini / rencana |
|---|---|---|---|
| Tanpa claim/lock, dua pemegang role yang sama bisa mencoba bertindak pada Assignment yang sama nyaris bersamaan | Rendah — percobaan kedua mendapat error yang jelas (`ConflictError`, assignment sudah bukan `pending`), bukan silent overwrite; tapi UX-nya (aksi gagal tiba-tiba) belum ideal untuk skala tim besar | Rendah untuk Phase 0 (tim kecil per Site) | Didokumentasikan di ADR-0007; claim/lock eksplisit bisa ditambahkan tanpa mengubah skema jika pola pemakaian nyata membuktikan perlu |
| Escalation sweep butuh pemicu eksternal (manual/API), bukan otomatis berjalan sendiri | Sedang — bila tidak ada yang memanggil sweep secara rutin, task overdue tidak benar-benar ter-eskalasi meski SLA sudah lewat | Sedang, sampai scheduler/cron infrastructure ada | Mekanisme intinya sudah teruji benar; menyambungkannya ke pemicu otomatis (cron job, external scheduler) adalah pekerjaan wiring terpisah yang dicatat eksplisit sebagai gap, bukan diasumsikan sudah otomatis |
| Reseed tenant demo untuk menyebarkan permission `workflow.*` baru berulang lagi dari pola 0C | Tinggi bila pola ini ditiru di tenant produksi (kehilangan data) | Rendah (hanya dipakai di tenant demo), tapi terbukti dua kali berturut-turut (0C dan 0D) — memperkuat urgensi menyelesaikan gap ini sebelum ada tenant produksi sungguhan | Sama seperti 0C: didokumentasikan eksplisit sebagai pola demo/dev-only; migrasi permission produksi tetap sebagai item terbuka prioritas tinggi |
| Dua bug FK cascade ditemukan SETELAH migration awal diterapkan (baru ketagihan saat test integrasi cleanup gagal) | Rendah — ditemukan dan diperbaiki sebelum Founder Review, sebelum migration dianggap final, lewat siklus rollback-fix-reapply yang sudah baku sejak 0C | Rendah untuk checkpoint berikutnya (pola FK cascade untuk kolom yang mereferensikan `organization_units`/`users` di tabel scoped-tenant kini sudah dikenali sebagai pengecekan wajib) | Dicatat eksplisit di decision log; disarankan pengecekan FK cascade secara sistematis (bukan hanya reaktif saat test gagal) di awal desain migration checkpoint berikutnya |
| Test integrasi menulis Tenant sungguhan ke database dev yang sama dipakai untuk development manual | Rendah | Rendah | Sama seperti 0B/0C — `afterAll` menghapus Tenant beserta seluruh data turunannya via cascade (kini termasuk seluruh tabel `workflow_*` berkat perbaikan FK di atas) |

## Kesiapan untuk Checkpoint 0E

Workflow & Approval Engine Foundation sudah stabil dan teruji end-to-end
dari UI sampai PostgreSQL: Workflow Definition, Versioning, Step/State,
Transition, Condition, Assignment (dua tipe), Approval, Reject/Return,
Escalation hook, SLA-ready hook, Notification-ready hook, History, RBAC,
dan Configuration Audit seluruhnya terbukti lewat 33 test otomatis (0
regresi dari 0A–0C) plus smoke test manual curl yang mencakup jalur
sukses, jalur Condition-based routing, jalur reject, jalur return/
resubmit, escalation, dan RBAC-403. Seluruh pembuktian memakai objek
dummy generik (`demo_transactions`) — TIDAK ada logic Complaint, Survey,
atau Procurement yang masuk ke Phase 0, sesuai instruksi eksplisit
Founder.

Gap yang diketahui (claim/lock, scheduler otomatis untuk escalation,
migrasi permission produksi, cancel/reopen instance, smoke test visual
browser) sudah dicatat eksplisit di atas, bukan diasumsikan selesai.

---

# Implementation Notes — Checkpoint 0E: Enterprise Shared Services

**Status: COMPLETE**
**Tanggal: 2026-08-18**

## Apa yang dibangun

Enam layanan bersama (cross-cutting), seluruhnya reusable oleh modul
bisnis mana pun di masa depan dan TIDAK ada satu pun yang menyentuh
Complaint, Survey, Procurement, atau modul bisnis apa pun, sesuai
instruksi eksplisit Founder — pembuktian memakai `demo_transactions` dan
Workflow Engine dari Checkpoint 0D:

```
Event Foundation -> Notification Engine -> Document/File Service
  -> Scheduler/Background Jobs -> Integration Boundary
  -> Logging/Observability -> RBAC -> Audit Trail -> PostgreSQL
```

- **Skema database** (migration `1755900000000`): `domain_events` (log
  Event Foundation durable), `notification_templates` + `notifications`
  (Notification Engine), `documents` (Document/File Service, referensi
  polymorphic sama seperti Workflow Instance), `scheduled_jobs` +
  `scheduled_job_runs` (Scheduler), `integration_endpoints` +
  `integration_event_log` (Integration Boundary). Plus 8 permission baru
  (`notification.template.manage`, `notification.read`,
  `document.manage`/`.read`, `scheduler.manage`, `integration.manage`/
  `.read`, `observability.read`). Plus dua kolom tambahan (murni aditif)
  di `workflow_instance_assignments`: `claimed_by_user_id`, `claimed_at`
  (ADR-0008).
- **Event Foundation**: `EventBus` in-process (`application/event/
  event-bus.ts`) — `publish()` menyimpan baris `domain_events` LALU
  memanggil setiap subscriber yang cocok dengan `eventType` atau `'*'`
  (wildcard). Subscriber yang gagal ditangkap dan dicatat, tidak pernah
  menggagalkan operasi yang mempublikasikan event. `WorkflowService`
  (0D) diberi dependency `EventBus` opsional (tidak breaking) dan
  memanggil `publish()` di enam titik: assigned, approved, rejected,
  returned, completed, escalated — payload memakai konvensi
  `targetUserId`/`targetRoleCode`+`targetOrganizationUnitId` yang
  dipakai ulang oleh Notification Engine.
- **Notification Engine**: `notification_templates` adalah Tenant
  Configuration (pola sama seperti dok 05) — `{{field}}` interpolation
  sederhana (`template-renderer.ts`, sengaja minimal, filosofi anti-
  overengineering sama seperti Condition Expression 0D) terhadap payload
  Domain Event. `NotificationService.handleDomainEvent` (subscriber
  wildcard) me-resolve penerima: `targetUserId` langsung, atau
  `targetRoleCode`+scope lewat method baru `RbacRepository.
  listUserIdsWithRoleInScope` (fan-out ke SEMUA pemegang role yang
  cocok, bukan satu). Channel `in_app` benar-benar bisa dibaca dari
  Dashboard; channel lain (email/push/whatsapp/sms) tetap "Notification-
  ready" — template benar-benar di-render dan status `sent` tercatat,
  tapi belum ada transport nyata.
- **Document/File Service**: upload via `@fastify/multipart`, disimpan
  di disk lokal (`LocalFileStorage`, path storage-agnostic — siap
  diganti implementasi S3 tanpa migrasi skema), checksum SHA-256, cap
  ukuran 20MB (Phase 0 fixed, belum Tenant Configuration). Akses
  di-gate `document.manage`/`.read` di level Tenant saja — BELUM
  mengikuti Data Scope entity induknya seperti diminta dok 06 (gap
  terbuka, lihat di bawah). Soft-delete (`deleted_at`), bukan hard
  delete — retensi file fisik tetap ada di disk setelah soft-delete.
- **Scheduler / Background Jobs**: registry generik `scheduled_jobs`
  (job_code → handler_key + interval) + riwayat `scheduled_job_runs`,
  runner berupa interval loop in-process (`SchedulerService`, di-unref
  agar tidak mengganjal shutdown/test). Satu job terdaftar:
  `workflow-escalation-sweep` (interval 120 detik untuk keperluan
  demo/pembuktian cepat), handler-nya (`job-handlers.ts`) melakukan
  iterasi seluruh Tenant lalu memanggil method baru `WorkflowService.
  escalateOverdueAssignmentsForTenant` (varian tanpa `ActorContext`,
  logic sweep-nya persis sama dengan endpoint manual 0D). Endpoint
  manual trigger (`/scheduler/jobs/:jobCode/trigger`) dan endpoint
  manual sweep 0D (`/workflow/escalation-sweep`) tetap sama-sama
  RBAC-gated dan hidup berdampingan.
- **Integration Boundary**: `IntegrationService.handleDomainEvent`
  (subscriber wildcard) mencatat entri log "sent" (stub, tanpa panggilan
  HTTP nyata) untuk setiap Domain Event ke setiap Integration Endpoint
  outbound yang aktif per Tenant. Endpoint inbound menerima webhook
  sungguhan (`POST /integration/webhook/:tenantCode/:endpointCode`) —
  validasi tanda tangan HMAC-SHA256 (`timingSafeEqual`, bukan
  perbandingan string biasa) terhadap secret milik Endpoint SEBELUM
  apa pun lain terjadi; sukses hanya menghasilkan satu Domain Event
  baru, gagal dicatat sebagai entri `rejected` (bukan diam-diam
  ditolak). Route webhook memakai plugin Fastify ter-encapsulate
  (`addContentTypeParser` override lokal untuk raw body) agar override
  parser JSON TIDAK memengaruhi route lain di aplikasi.
- **Logging/Observability**: `genReqId` kustom (reuse header
  `x-request-id` masuk bila ada, generate UUID bila tidak) sehingga
  seluruh log pino per-request bisa dikorelasikan; endpoint
  `GET /observability/events` membaca log `domain_events` (RBAC-gated
  `observability.read`); riwayat run Scheduler (`scheduled_job_runs`)
  berfungsi sebagai Observability untuk background job.
- **ADR-0008 — Claim/Lock**: `WorkflowService.claimAssignment`/
  `releaseClaim` (endpoint baru `/workflow/assignments/:id/claim` dan
  `/release-claim`) — klaim atomik (`UPDATE ... WHERE status='pending'
  AND (unclaimed OR milik sendiri OR TTL 15 menit lewat) RETURNING`,
  eligibility dicek dengan helper `assertEligible` yang di-share dengan
  `actOnAssignment` (diekstrak di checkpoint ini supaya kedua jalur
  tidak pernah berbeda logic). `actOnAssignment` menolak (409) aktor
  lain selama klaim masih segar. Evaluasi lengkap tiga opsi ada di ADR.
- **API**: 5 route file baru (`notifications.ts`, `documents.ts`,
  `scheduler.ts`, `integration.ts`, `observability.ts`) plus 2 endpoint
  baru di `workflow.ts` (claim/release-claim) — seluruhnya di balik
  `app.authenticate` kecuali webhook inbound (autentikasinya adalah
  tanda tangan HMAC, bukan JWT, sesuai sifat webhook pihak ketiga).
- **Thin Frontend — Shared Services panel**: ditambahkan ke Dashboard,
  menampilkan Notifikasi masuk (dengan tombol mark-read), upload/lihat/
  hapus Document per Workflow Instance, status Scheduled Job + riwayat
  run + tombol trigger manual, daftar Integration Endpoint + log, dan
  Domain Event log (Observability). Workflow panel (0D) diperbarui:
  badge "claimed" pada My Tasks, tombol Claim/Release Claim, dan teks
  Escalation Sweep diperbarui untuk menyebut bahwa sweep kini juga
  berjalan otomatis.
- **Seed script**: 3 Notification Template demo (`workflow.assigned`,
  `workflow.completed`, `workflow.escalated`, channel `in_app`), 1
  Integration Endpoint outbound (`demo-erp-sync`, stub) dan 1 inbound
  (`demo-inbound`, dengan secret dev-only yang dicetak ke console untuk
  keperluan smoke test `curl`). Role demo `WORKFLOW_REVIEWER`/
  `WORKFLOW_MANAGER` (0D) diberi tambahan permission `notification.read`
  dan `document.read` — ditemukan sebagai gap nyata saat smoke test:
  tanpa ini, Notification yang benar-benar terkirim ke reviewer tidak
  bisa dibaca lewat API oleh reviewer itu sendiri.
- **Test**: 7 test integrasi baru
  (`tests/integration/shared-services.test.ts`), membangun Workflow
  Definition minimal-nya sendiri lewat HTTP API (dua Step: REVIEW→
  COMPLETE), mencakup: Event Foundation (event tersimpan + payload
  benar) yang mengalir ke Notification Engine (template ter-render,
  status `sent`, mark-read, RBAC-403 tanpa `notification.read`, 403
  saat user lain mencoba mark-read notifikasi yang bukan miliknya),
  Document/File Service (upload multipart sungguhan, list, download,
  delete, RBAC-403 untuk upload/delete tanpa `document.manage`, Audit
  Trail), ADR-0008 claim/lock (klaim atomik, klaim ulang oleh user yang
  sama idempotent, user kedua yang eligible diblokir 409 baik untuk
  claim maupun act, release, release-tanpa-klaim ditolak 409, user lain
  berhasil act setelah release), Scheduler (RBAC-403 tanpa
  `scheduler.manage`, manual trigger tercatat sebagai run sukses,
  Escalation Rule opt-in per Step tetap terbukti — Step tanpa
  Escalation Rule TIDAK ikut ter-escalate), Integration Boundary
  (outbound stub tercatat untuk Endpoint aktif, berhenti tercatat
  setelah Endpoint dinonaktifkan, webhook inbound valid/invalid/tanpa
  tanda tangan, endpoint/tenant tidak dikenal → 404). Total 40 test (33
  lama + 7 baru) hijau, 0 regresi. `npm run test` di `apps/api`
  sekarang otomatis menyetel `SCHEDULER_DISABLED=true` supaya interval
  Scheduler sungguhan tidak pernah balapan dengan assertion test.

## Pembuktian manual tambahan (di luar automated test)

Smoke test manual lewat curl terhadap server yang berjalan, memakai
tenant demo `demo-gs`, mencakup SELURUH enam layanan bersama secara
end-to-end: start Workflow Instance → event `workflow.assigned`
tersimpan di `domain_events` dengan `targetRoleCode` benar → Notification
`in_app` sungguhan muncul di `/notifications/my` milik reviewer dengan
body ter-render dari Template; upload Document sungguhan via multipart
→ muncul di listing entity, ter-download persis isinya, tercatat di
Audit Trail; webhook inbound dengan tanda tangan HMAC valid → 202 +
Domain Event baru; tanda tangan invalid → 403 + log `rejected`; endpoint
Integration outbound aktif → mencatat entri `sent` untuk SETIAP Domain
Event yang lewat (termasuk secara emergent untuk event
`integration.demo-inbound.received` dari webhook itu sendiri — bukti
nyata bahwa Event Foundation benar-benar decoupled, publisher tidak
tahu siapa saja subscriber-nya); Claim/Lock — reviewer klaim Assignment,
klaim ulang oleh diri sendiri idempotent, release, lalu Approve
berhasil; **pembuktian paling penting sesuai permintaan eksplisit
Founder**: Assignment di-backdate `due_at`-nya lewat SQL langsung, LALU
DITUNGGU (tanpa trigger manual apa pun) — setelah ±2 menit, riwayat run
Scheduler menunjukkan entri baru dengan `trigger: "scheduler"` dan
`triggeredBy: null`, mengeskalasi Assignment tsb secara otomatis,
memicu Notification `workflow.escalated` ke Manager, dan tercatat di
Audit Trail — seluruh rantai ini terjadi TANPA satu pun panggilan API
manual dari operator.

## Keterbatasan / gap yang diketahui di akhir Checkpoint 0E

- **Kompresi foto otomatis & enkripsi at-rest untuk Document/File
  Service** (diminta dok 06/09) belum diimplementasikan — tidak ada
  infrastruktur image-processing/object-storage terenkripsi di
  lingkungan implementasi ini.
- **Akses Document belum mengikuti Data Scope entity induknya** — masih
  di-gate di level Tenant saja (lihat decision log item #5); modul
  bisnis nyata yang akan me-resolve Data Scope per entity belum ada di
  Phase 0 (sengaja, sesuai instruksi Founder untuk tetap generic).
- **Scheduler adalah in-process timer, bukan job runner yang tahan
  restart proses** — bila proses API di-restart di tengah interval,
  job berikutnya baru berjalan setelah proses baru selesai boot, tidak
  ada mekanisme "mengejar" jadwal yang terlewat.
- **Retry otomatis untuk Notification/Integration outbound yang gagal
  belum ada** — status `failed` tercatat di log, tapi tidak ada sweep
  retry seperti halnya Escalation sweep untuk Workflow.
- **Claim/lock TTL (15 menit) masih konstanta kode**, belum Tenant
  Configuration per Step; belum ada endpoint "force release" oleh admin
  (lihat ADR-0008).
- **Channel Notification selain `in_app`** (email/push/whatsapp/sms)
  belum punya transport nyata — template benar-benar di-render dan
  status `sent` tercatat, tapi tidak ada pengiriman sungguhan.
- **Migrasi permission untuk tenant produksi yang sudah live** masih
  belum ada — gap yang sama berulang dari 0C/0D, kini sudah tiga
  checkpoint berturut-turut menggunakan pola reseed demo/dev-only.
- **Frontend Shared Services panel belum melalui smoke test visual
  browser sungguhan** — keterbatasan yang sama seperti 0C/0D
  (lingkungan implementasi tidak punya akses browser ke dev server
  container); diverifikasi lewat `typecheck`/`lint`/`build` sukses dan
  pemanggilan API yang identik sudah diverifikasi hijau lewat curl.
- **CI/CD masih belum ada** (carry-over dari 0A–0D).

## Risk Note

| Risiko | Dampak | Kemungkinan | Mitigasi saat ini / rencana |
|---|---|---|---|
| Scheduler berbasis in-process timer, hilang saat proses restart | Sedang — job terlewat tidak otomatis "dikejar" saat proses baru boot, bisa menunda Escalation sweep sampai siklus berikutnya | Rendah untuk Phase 0 (interval pendek, 2 menit) | Didokumentasikan eksplisit; migrasi ke job runner tahan-restart (pg-boss/BullMQ/cron eksternal) adalah penggantian implementasi murni, bukan desain ulang skema `scheduled_jobs` |
| Document Service belum mengikuti Data Scope entity induknya | Sedang — siapa pun dengan `document.read` di Tenant bisa melihat/download Document milik entity mana pun di Tenant tsb, bukan hanya yang scope-nya sesuai | Rendah untuk Phase 0 (belum ada modul bisnis nyata yang memakainya) | Didokumentasikan eksplisit di decision log + ADR alur; wajib diselesaikan SEBELUM modul bisnis pertama (mis. Complaint) memakai Document Service untuk foto bukti |
| Claim/lock TTL tetap (15 menit) mungkin tidak cocok untuk semua jenis Step (task cepat vs. review berhari-hari) | Rendah — TTL yang terlalu pendek/panjang hanya memengaruhi UX kolaborasi, bukan integritas data (claim tetap atomik) | Rendah | Didokumentasikan di ADR-0008 sebagai item terbuka; jadi Tenant/Step Configuration bila pola pemakaian nyata membuktikan perlu |
| Notification/Integration outbound yang gagal tidak di-retry otomatis | Sedang — event penting bisa gagal terkirim tanpa upaya ulang, hanya tercatat status `failed`/`rejected` di log | Rendah–sedang, tergantung keandalan template/endpoint pihak ketiga nanti | Log lengkap tersedia untuk audit manual; sweep retry (pola sama seperti Escalation sweep) adalah pekerjaan tambahan yang jelas scope-nya, belum diminta di checkpoint ini |
| Reseed tenant demo untuk menyebarkan permission `notification.*`/`document.*`/`scheduler.*`/`integration.*`/`observability.*` baru — pola ketiga kalinya berturut-turut (0C, 0D, 0E) | Tinggi bila pola ini ditiru di tenant produksi (kehilangan data) | Rendah (hanya dipakai di tenant demo), tapi konsistensi tiga-checkpoint-berturut-turut memperkuat urgensi | Sama seperti 0C/0D: didokumentasikan eksplisit; migrasi permission produksi tetap item terbuka prioritas tinggi, semakin mendesak |
| Test integrasi menulis Tenant sungguhan ke database dev yang sama dipakai untuk development manual | Rendah | Rendah | Sama seperti 0B–0D — `afterAll` menghapus Tenant beserta seluruh data turunannya via cascade (kini termasuk seluruh tabel Shared Services berkat desain FK CASCADE yang konsisten sejak awal checkpoint ini) |

## Kesiapan untuk Checkpoint 0F

Enterprise Shared Services sudah stabil dan teruji end-to-end dari UI
sampai PostgreSQL: Event Foundation, Notification Engine, Document/File
Service, Scheduler/Background Jobs (termasuk pembuktian nyata escalation
sweep berjalan OTOMATIS tanpa trigger manual, sesuai permintaan eksplisit
Founder), Integration Boundary (outbound stub + inbound webhook
tervalidasi tanda tangan), Logging/Observability, RBAC, dan Audit Trail
seluruhnya terbukti lewat 40 test otomatis (0 regresi dari 0A–0D) plus
smoke test manual curl yang mencakup jalur sukses, jalur RBAC-403, jalur
validasi tanda tangan gagal, dan yang terpenting — satu siklus penuh
Scheduler-triggered automatic escalation yang diamati langsung tanpa
intervensi manual. ADR-0008 (claim/lock) dievaluasi dan diimplementasikan
sebagai reservasi opt-in ber-TTL yang murni aditif terhadap desain
Workflow Engine generik dari 0D — tidak ada satu pun keputusan/skema dari
0A–0D yang diubah atau di-redesign, seluruhnya hanya diperluas. Seluruh
pembuktian memakai objek dummy generik (`demo_transactions`) dan Workflow
Engine 0D — TIDAK ada logic Complaint, Survey, atau Procurement yang
masuk ke Phase 0, sesuai instruksi eksplisit Founder.

Gap yang diketahui (Data Scope Document belum entity-aware, Scheduler
belum tahan-restart, retry otomatis belum ada, claim/lock TTL masih
konstanta, channel Notification selain in_app belum bertransport nyata,
migrasi permission produksi, smoke test visual browser) sudah dicatat
eksplisit di atas, bukan diasumsikan selesai.

**Menunggu review Founder sebelum masuk Checkpoint 0F**, sesuai instruksi.

---

# Implementation Notes — Checkpoint 0F: Phase 0 Stabilization

**Status: COMPLETE**
**Tanggal: 2026-08-18**

## Apa yang dibangun

Checkpoint 0F TIDAK menambah capability bisnis baru — fokusnya
konsolidasi, keamanan, dan kesiapan Phase 0 sebelum Complaint/Survey,
persis sesuai instruksi Founder. Sembilan area yang diminta eksplisit,
seluruhnya dikerjakan terhadap objek generik yang sama seperti 0A–0E:

- **Security review menyeluruh**: RBAC (`requirePermission`/
  `requireOrganizationUnitScope`) diverifikasi sebagai satu-satunya jalur
  otorisasi (tidak ada route yang hand-roll pengecekan sendiri); JWT
  access token TETAP tidak menyimpan permission (keputusan 0B,
  terbukti murah lewat performance baseline); refresh token TETAP opaque
  + di-hash + rotate-on-use (keputusan 0B, tidak diubah). Tiga perbaikan
  keamanan nyata ditambahkan: `@fastify/helmet` (security header
  standar), rate limiting (`@fastify/rate-limit` — global 1200/menit,
  `/auth/login` 10/menit terpisah), dan `POST /auth/logout` (revoke
  refresh token server-side). npm audit produksi (`--omit=dev`): 0
  vulnerability.
- **Hierarchical Data Scope (ADR-0009)**: menyelesaikan item terbuka
  ADR-0005 sejak 0B. Assignment di Organization Unit induk kini otomatis
  mencakup seluruh descendant-nya — dibuktikan lewat test yang membangun
  hierarki 4 level (Region → Site → Sub-Site → Leaf) dan satu Region
  sibling terpisah, memverifikasi Regional Manager yang di-scope ke
  Region bisa listing DAN membuat Organization Unit dua level di bawah
  scope aslinya, sekaligus tetap 403 saat mencoba masuk ke Region
  sibling yang tidak berelasi.
- **Production permission migration (ADR-0010)**: kolom
  `roles.is_full_access` + script idempoten
  `scripts/sync-role-permissions.ts`, menyelesaikan pola reseed yang
  berulang di 0C/0D/0E untuk kasus Role Administrator. Dibuktikan
  langsung terhadap database sungguhan: satu grant permission dihapus
  manual dari Role ADMIN tenant demo, script dijalankan, grant
  dipulihkan; run kedua melaporkan "0 grant baru" (idempoten, tidak
  merusak apa pun yang sudah benar).
- **Frontend token/session persistence**: `AuthContext` kini
  menyimpan sesi di `localStorage`, merehidrasi + langsung menukar
  refresh token untuk access token baru saat aplikasi dimuat ulang.
  `ProtectedRoute` menunggu proses ini selesai (state `initializing`)
  sebelum memutuskan redirect ke `/login`, mencegah "kedipan" ke halaman
  login bagi user yang sesinya sebenarnya masih valid.
- **Validasi database/migration**: migration Checkpoint 0F
  (`1756000000000_phase0-stabilization`) diuji siklus up→down→up
  terhadap database dev; SELURUH RANTAI migration (0A–0F, 7 file) diuji
  dari nol di database sementara terpisah — up bersih, down bersih
  sampai kosong, up lagi menghasilkan jumlah tabel yang identik. Seluruh
  19 tabel ber-scope Tenant diverifikasi memiliki `ON DELETE CASCADE`
  yang benar dari `tenants` (dasar mekanisme cleanup test sejak 0B).
- **Performance baseline**: diukur dengan `autocannon` terhadap 6
  endpoint representatif (baca, tulis, RBAC re-fetch, Scheduler). Seluruh
  p99 di bawah 45ms pada skala data demo — lihat
  `docs/performance-baseline.md` untuk detail dan batasannya. Proses
  benchmark ini SENDIRI menemukan rate limit global awal (300/menit)
  terlalu ketat, langsung diperbaiki (lihat decision-log #7).
- **Reliability/Idempotency**: inbound Integration webhook mendukung
  idempotency key opsional (partial unique index di database — migration
  0F) sehingga redelivery aman; Scheduler mendapat overlap guard
  in-process sehingga job yang sama tidak pernah berjalan dua kali
  bersamaan (dibuktikan: dua trigger manual bersamaan menghasilkan satu
  200 dan satu 409).
- **Observability**: `LOG_LEVEL` kini bisa di-override lewat env var
  tanpa code change; `GET /health` menampilkan `uptimeSeconds`; label
  `checkpoint` di health check diperbarui (sebelumnya masih tertulis
  "0B", stale sejak beberapa checkpoint — kosmetik tapi menyesatkan bila
  dibaca operator).
- **Full regression test**: 45 test terintegrasi lulus (40 dari 0A–0E, 5
  baru dari 0F), 0 regresi. Typecheck, lint, dan production build bersih
  di `apps/api` maupun `apps/web`.
- **Visual browser smoke/E2E**: untuk PERTAMA KALINYA sejak 0C
  (gap yang tercatat berulang di setiap checkpoint sebelumnya —
  lingkungan implementasi sebelumnya tidak punya akses browser), sebuah
  test Playwright+Chromium sungguhan dijalankan: login lewat form nyata,
  screenshot dashboard penuh (seluruh panel 0B–0E terverifikasi visual
  benar, termasuk label dinamis dari Terminology Configuration),
  reload-untuk-membuktikan-persistence, logout, dan verifikasi akses
  benar-benar dicabut setelah logout. Ditemukan DAN diperbaiki dua bug
  nyata lewat proses ini (lihat "Temuan" di bawah) — script tersimpan di
  `apps/web/e2e/smoke.mjs`, screenshot di `docs/evidence/`.
- **Technical Debt Register**: `docs/technical-debt-register.md`,
  konsolidasi seluruh gap 0A–0F menjadi 4 kategori
  (Blocker/Must Fix/Technical Debt/Future Enhancement) sesuai instruksi
  Founder.

## Temuan nyata selama Checkpoint 0F (bukan hipotesis)

1. **Bug nyata**: error handler global membuang status code asli dari
   plugin Fastify manapun (bukan hanya rate-limit) — request yang
   di-throttle (429) diteruskan ke client sebagai 500. Ditemukan oleh
   test rate-limiting 0F sendiri, diperbaiki di `error-mapping.ts`.
2. **Bug nyata**: route yang didaftarkan langsung ke instance `app` root
   bisa selesai terdaftar SEBELUM plugin `@fastify/rate-limit` (yang
   di-`register()` tanpa `await`) selesai menempelkan hook-nya — akibatnya
   limit per-route `/auth/login` diam-diam tidak pernah aktif. Ditemukan
   oleh test yang sama, diperbaiki dengan membungkus SELURUH route dalam
   `app.register(async (scoped) => {...})` bersarang.
3. **Bug nyata**: React StrictMode (development) memanggil efek
   rehidrasi sesi dua kali per mount; karena refresh token bersifat
   single-use, panggilan kedua gagal 401 memakai token yang sudah
   di-rotate panggilan pertama — muncul sebagai error nyata di console
   browser saat Playwright E2E reload halaman. Diperbaiki dengan guard
   `useRef`.

Ketiga temuan ini TIDAK akan terdeteksi oleh test integrasi backend saja
(temuan #2 dan #3 khususnya baru terlihat lewat pengujian end-to-end
sungguhan) — inilah alasan checkpoint ini secara eksplisit meminta visual
browser smoke test, bukan sekadar mengandalkan `typecheck`/`lint`/`build`
seperti checkpoint-checkpoint sebelumnya.

## Keterbatasan / gap yang diketahui di akhir Checkpoint 0F

Lihat `docs/technical-debt-register.md` untuk daftar lengkap
terklasifikasi. Ringkasan MUST FIX yang paling relevan untuk kesiapan
Complaint/Survey: Document Service belum mengikuti Data Scope entity
induknya (wajib diputuskan eksplisit di awal Phase 1), migrasi
permission untuk Role kurasi (non-`is_full_access`) masih manual, CORS
masih permisif (`origin: true`), CI/CD masih belum ada.

## Risk Note

| Risiko | Dampak | Kemungkinan | Mitigasi saat ini / rencana |
|---|---|---|---|
| Document Service belum entity-scope-aware, dan Complaint/Survey akan memakainya untuk lampiran bukti | Tinggi — siapa pun dengan `document.read` bisa melihat lampiran Complaint milik Site mana pun, bukan hanya yang scope-nya sesuai | Sedang, begitu Complaint/Survey mulai dibangun | Dicatat sebagai MUST FIX di Technical Debt Register; Phase 1 checkpoint pertama WAJIB memutuskan ini secara eksplisit sebelum lampiran bukti Complaint pertama diunggah |
| Rate limit (global 1200/menit, login 10/menit) belum divalidasi dengan traffic pilot nyata | Sedang — terlalu ketat akan mengganggu user asli, terlalu longgar tidak melindungi dari abuse | Rendah untuk beberapa minggu pertama pilot, meningkat seiring adopsi | Angka awal sudah berbasis bukti (performance baseline), bukan tebakan; dicatat eksplisit untuk ditinjau ulang setelah ada data pemakaian nyata |
| Sesi frontend di localStorage bisa dibaca oleh XSS jika ada kerentanan XSS di tempat lain pada frontend | Tinggi JIKA ada XSS — refresh token 7 hari bisa dicuri | Rendah (React meng-escape output secara default, helmet menambah header keamanan standar, tidak ada `dangerouslySetInnerHTML` di codebase) | Risiko yang sama persis ada untuk token in-memory sekalipun (skrip yang di-inject bisa membaca state React juga) — mitigasi sesungguhnya ada di level "cegah XSS terjadi", bukan di lokasi penyimpanan token; didokumentasikan sebagai trade-off sadar, bukan diabaikan |
| CI/CD masih belum ada — carry-over dari 0A, kini enam checkpoint berturut-turut | Sedang — seluruh gate lulus manual setiap checkpoint, tapi tidak ada jaring pengaman otomatis bila lebih dari satu implementor bekerja paralel di Phase 1 | Meningkat begitu tim bertambah | Ditandai MUST FIX; wajib diselesaikan sebelum Phase 1 melibatkan lebih dari satu kontributor kode |
| Test integrasi menulis Tenant sungguhan ke database dev yang sama dipakai untuk development manual | Rendah | Rendah | Sama seperti 0B–0E — `afterAll` menghapus Tenant beserta seluruh data turunannya via cascade (diverifikasi ulang secara sistematis di 0F: 19 tabel, seluruhnya CASCADE dari `tenants`) |

## Kesiapan untuk Phase 1 (Customer Complaint Management & Survey/Assessment)

Phase 0 Enterprise Core Foundation (Checkpoint 0A–0F) sudah stabil dan
teruji end-to-end dari UI sampai PostgreSQL: Tenant/Legal Entity/
Organization Unit, Identity/Auth/RBAC dengan Data Scope HIERARKIS,
Configuration & Metadata Engine, Workflow & Approval Engine dengan
claim/lock, dan seluruh Enterprise Shared Services (Event, Notification,
Document, Scheduler, Integration, Observability) — 45 test otomatis (0
regresi sepanjang 0A–0F), typecheck/lint/build bersih di kedua
workspace, migration chain penuh terbukti reversible dari nol, dan untuk
pertama kalinya divalidasi lewat browser sungguhan (Playwright), bukan
hanya lewat API.

Tidak ada item BLOCKER yang tersisa untuk memulai Phase 1. Item MUST FIX
(lihat Technical Debt Register) dicatat eksplisit sebagai pekerjaan yang
boleh berjalan paralel dengan Phase 1, dengan SATU pengecualian yang
wajib diputuskan di awal: strategi akses Data Scope untuk Document
Service, karena Complaint/Survey akan langsung memakai Document Service
untuk lampiran bukti sejak checkpoint pertamanya.

**Menunggu Founder Review untuk menyatakan Phase 0 COMPLETED dan
memberikan keputusan apakah Phase 1 boleh dimulai.**

## Checkpoint 1A — Document Scope & Customer Experience Foundation

Checkpoint pertama Phase 1, dikerjakan di atas repo hasil Checkpoint
0A–0F (di-restore dari archive Founder ke session Phase 1 yang terpisah,
sesuai instruksi Founder: preparation/Phase 0 dan implementasi Phase 1
dipisah per session). Git history, seluruh ADR, Decision Log,
Implementation Notes, dan Technical Debt Register Phase 0 dipertahankan
utuh — checkpoint ini HANYA menambah, tidak menulis ulang riwayat.

### Yang dibangun

1. **Customer Foundation** — Customer, Customer Contact/PIC, Contract,
   Project, Site/Location, Service (katalog Tenant-level), Service
   Assignment (Customer <-> Service, opsional dipersempit ke
   Contract/Project/Site + Internal PIC). Satu migration
   (`1757000000000_customer-experience-foundation-1a`), tujuh tabel baru.
2. **Customer Data Scope** (ADR-0011) — dimensi Data Scope ketiga
   (`customer`, exact-match) di `user_role_assignments`, konvergen dengan
   `organization_unit` scope (hierarkis, ADR-0009) lewat satu method:
   `RbacService.requireCustomerContextScope`.
3. **Document Entity Authorization Resolver** (ADR-0012) — mekanisme
   plug-in yang memutus Document Service dari kebutuhan tahu apa itu
   "Customer"; `DocumentService` melihat registry
   `Map<entityType, resolver>` saat runtime. `entityType='customer'`
   diregistrasi ke `CustomerService.canAccessForDocument`; `entityType`
   lain (mis. `demo_transaction`) tetap memakai permission Tenant-wide
   Checkpoint 0E persis seperti sebelumnya.
4. Route HTTP baru: `/customers`, `/customer-contacts`, `/contracts`,
   `/projects`, `/sites`, `/services`, `/customer-service-links` — pola
   create+list saja (sama seperti presedan `/organization-units` 0B),
   endpoint update/soft-delete belum ada (carry-over gap yang sama).
5. Seed script (`scripts/seed.ts`) diperluas: satu Customer demo
   (`CUST-001`, owner org unit = Site A) lengkap dengan Contact,
   Contract, Project, Site, Service, Service Assignment, dan satu
   `CUSTOMER_USER` login (`customeruser@democlient.local`) yang
   scope-nya HANYA Customer tsb.

### Bukti End-to-End (vertical slice, terhadap PostgreSQL nyata)

`tests/integration/customer-foundation.test.ts` (16 test, semua lewat
`app.inject` HTTP nyata, tanpa mocking) membuktikan seluruh rantai target
1A:

```
Administrator -> Customer Created -> Customer Contact Created ->
Contract/Project/Site Context -> Service Assigned -> Customer User Login
-> Data Scope Applied -> Document Uploaded -> Parent Entity Authorization
Applied -> Audit Trail -> PostgreSQL
```

Poin pembuktian yang secara spesifik divalidasi (bukan hanya jalur
happy-path):

- Supervisor scoped ke Organization Unit **induk** (Region) BISA
  menjangkau Customer yang `owner_organization_unit_id`-nya adalah
  **descendant** (Site) — membuktikan ADR-0009 (hierarchical Data Scope)
  benar-benar konvergen dengan Customer lewat ADR-0011, bukan reimplementasi
  terpisah.
- Supervisor yang sama TIDAK BISA menjangkau Customer lain yang dimiliki
  Organization Unit **sibling** (bukan ancestor/descendant) — isolasi
  antar cabang tree tetap berlaku (403).
- Customer User (role `CUSTOMER_USER_1A`, HANYA permission
  `customer.read`/`contract.read`/`project.read`/`site.read`, TANPA
  `document.*` sama sekali) BISA upload/list/download Document miliknya
  sendiri (`entityType='customer'`) — membuktikan resolver adalah gerbang
  yang sesungguhnya, bukan permission legacy.
- Customer User yang sama TIDAK BISA membaca Document milik Customer
  lain (403) — Data Scope, bukan hanya Tenant, yang menggerbangi.
- Upload dengan `entityType='demo_transaction'` (tidak ada resolver
  terdaftar) oleh aktor yang sama TETAP ditolak (403) karena tidak
  memegang `document.manage` — membuktikan regresi Checkpoint 0E benar-
  benar tidak berubah untuk entityType tanpa resolver.
- Audit Trail tercatat untuk setiap create (`customer.created`,
  `customer.contact_created`, `customer.service_assigned`,
  `document.uploaded`, dst).

### Regression Phase 0

Full suite Phase 0 (`tests/integration/*.test.ts` yang sudah ada) dijalankan
ULANG tanpa perubahan apa pun pada assertion-nya: **45/45 tetap lulus**,
0 regresi. Total suite setelah 1A: **61/61 lulus** (6 file Phase 0 + 1
file Checkpoint 1A).

### Migration validation

Migration `1757000000000` divalidasi up -> down -> up dari database
kosong terpisah (disposable, bukan database dev), mengikuti presedan
Checkpoint 0F: jumlah tabel round-trip persis 47 -> 40 -> 47 (40 cocok
dengan angka yang dicatat 0F untuk chain 0A-0F). Down migration JUGA
diuji terhadap database dev yang sudah berisi data (seed + hasil test) —
sengaja GAGAL karena ada baris `scope_type='customer'` yang melanggar
constraint versi lama; node-pg-migrate membungkusnya dalam transaction
sehingga rollback penuh terjadi otomatis, database dev tidak rusak. Ini
perilaku yang benar (down migration destruktif terhadap fitur yang
sedang dipakai data nyata memang seharusnya gagal, bukan diam-diam
membuang data), dicatat di sini agar tidak disalahartikan sebagai bug.

### Typecheck / Lint / Build

Bersih di `apps/api` (frontend tidak disentuh di checkpoint ini — 1A
adalah foundation data + API + otorisasi, UI Customer Experience baru
masuk cakupan 1C per urutan Founder).

### Keterbatasan / gap yang diketahui di akhir Checkpoint 1A

- Belum ada endpoint update/soft-delete untuk seluruh entity Customer
  Foundation (carry-over pola yang sama seperti Organization Unit/User).
- `GET /customers` belum difilter per Data Scope (baru single-entity path
  yang difilter) — didokumentasikan sebagai keputusan sadar (lihat
  decision-log #5), bukan bug, dengan rencana penyempitan di 1C.
- Belum ada UI Customer Experience (Customer/Contract/Project/Site
  management screen) — di luar cakupan 1A per urutan Founder (1C).
- Resolver Entity Authorization baru ada untuk `customer`; `contract`/
  `project`/`site` belum, karena belum ada modul yang melampirkan
  dokumen langsung ke entity tsb.

## Checkpoint 1B — Generic Customer Complaint Engine

Checkpoint kedua Phase 1, dikerjakan di session yang sama dengan 1A
setelah 1A di-APPROVE Founder. Dimulai dengan hardening kecil yang
diminta eksplisit sebelum Complaint Engine dibangun: `GET /customers`
sekarang difilter Data Scope per baris (lihat decision-log.md).

### Yang dibangun

1. **Hardening `GET /customers`** — `CustomerService.listForTenant`
   mengambil seluruh Data Scope assignment aktor sekali
   (`RbacService.getAssignments`), lalu memfilter per Customer lewat
   varian batch `isCustomerContextScopeCoveredByAssignments` (menghindari
   N+1 query per baris), short-circuit untuk `scope_type='tenant'`.
2. **Tabel `complaints`** (migration `1758000000000`) — field bisnis
   (customer/contract/project/site/service context, category/subcategory/
   description/priority/severity/source/channel, investigation fields,
   verification fields, customer confirmation fields, closure date)
   TANPA kolom lifecycle/assignment/SLA — semua itu hidup di Workflow
   Instance yang direferensikan lewat `workflow_instance_id`.
3. **`ComplaintService`** — deliberately thin: otorisasi Data-Scope-
   specific (`getAuthorized`, gabungan Customer Data Scope/submitter/
   workflow-association) dan data Complaint-specific saja; nol logika
   state machine (lihat ADR-0013).
4. **Dua ekstensi generic ke `WorkflowService`**: `reopenInstance`,
   `isActorAssociatedWithInstance` — tidak mereferensikan `complaint`
   sama sekali, reusable untuk Survey (1D+) tanpa perubahan lagi.
5. **Dua method trusted-caller baru**: `WorkflowService.
   getInstanceForEntityOwner` dan `ConfigurationService.
   generateNumberForTenant` — menghindari kebutuhan permission Tenant-
   wide (`workflow.instance.read`, `config.manage`) untuk Customer User
   atau internal Handler biasa hanya untuk kerja di Complaint sendiri.
6. **Resolver Entity Authorization untuk `entityType='complaint'`** (pola
   ADR-0012, dipakai ulang persis) — evidence/attachment Complaint tidak
   butuh permission `document.*` terpisah.
7. Route HTTP baru: `POST /complaints`, `GET /complaints`,
   `GET /complaints/:id`, `POST /complaints/:id/submit`,
   `POST /complaints/:id/actions/:actionCode` (generic action dispatch —
   actionCode datang langsung dari Transition yang dikonfigurasi Tenant),
   `POST /complaints/:id/investigation`, `.../verification`,
   `.../customer-confirmation`, `.../reopen`.
8. Seed script (`scripts/seed.ts`) diperluas: Workflow Definition demo
   `complaint_lifecycle` v1 published (11 Step, 10 Transition, 9
   Assignment Rule termasuk 1 condition-based, 1 Escalation Rule),
   Notification Template Complaint Event Catalog, reference data
   `complaint_category`/`complaint_severity`, Numbering Sequence
   `complaint_number`, role `COMPLAINT_HANDLER` (Site A org-unit scope)
   dan `COMPLAINT_MANAGER` (tenant-wide), permission tambahan untuk
   `CUSTOMER_USER`.

### Bukti End-to-End (vertical slice, terhadap PostgreSQL nyata)

Dua lapis pembuktian dilakukan: manual lewat HTTP nyata terhadap server
dev + seed data (dicatat di bawah), lalu diformalkan jadi
`tests/integration/complaint-engine.test.ts` (16 test, tenant terpisah,
Workflow Definition dibangun dari nol lewat HTTP admin API — sama
persis presedan 0D — bukan lewat seed).

Manual (curl) end-to-end run terhadap `demo-gs`:

```
Customer User Submit Complaint (CMP-2026-00001, priority=high,
severity=major) -> Customer/Data Scope Validation (lolos) -> SLA Started
(Step SUBMITTED sla_hours=4, due_at terisi) -> Workflow Instance Started
-> Assignment ke COMPLAINT_HANDLER (Site A, submitter_unit routing) ->
Handler: acknowledge -> assign -> start_investigation -> catat Root
Cause/Corrective Action/Preventive Action -> submit_corrective_action ->
submit_for_verification (routing OTOMATIS ke COMPLAINT_MANAGER
tenant-wide, BUKAN Handler yang sama — independent QA) -> Manager:
verification note -> verify (routing kembali ke submitter) -> Customer:
customer-confirmation note -> confirm -> Closed (closureDate terisi,
instance.status='approved') -> Audit Trail (complaint.created s/d
complaint.customer_confirmed) -> PostgreSQL
```

Poin pembuktian tambahan yang divalidasi manual maupun via test:

- **Condition-based dynamic routing**: Complaint `severity=critical`
  di-assign LANGSUNG ke `COMPLAINT_MANAGER` tenant-wide di Step ASSIGNED
  (skip Handler lokal), Complaint non-critical tetap ke Handler — Rule
  Condition dievaluasi terhadap `contextData`, bukan hardcode di
  Complaint Service.
- **Evidence**: Handler upload attachment ke `entityType='complaint'`
  TANPA permission `document.*`, berhasil (resolver gate); Customer User
  bisa list/download attachment yang sama.
- **SLA Escalation**: Assignment di Step IN_INVESTIGATION yang `due_at`-
  nya dibuat lampau (`now() - interval '1 hour'`, teknik yang sama
  presedan 0D) ter-escalate lewat `POST /workflow/escalation-sweep` ke
  `COMPLAINT_MANAGER` tenant-wide; event `workflow.escalated` DAN hasil
  terjemahannya `complaint.escalated` (subscriber translation di
  `composition-root.ts`, bukan perubahan Workflow Engine) sama-sama
  tercatat di `domain_events`.
- **Reopen authorization**: mencoba reopen Complaint yang masih
  `in_progress` ditolak (409, "Only a Closed/Rejected/Cancelled Complaint
  can be reopened"); aktor tanpa `complaint.manage` ditolak reopen (403);
  aktor dengan `complaint.manage` (COMPLAINT_MANAGER) berhasil reopen
  Complaint yang sudah Closed kembali ke Step ASSIGNED — Assignment baru
  otomatis dibuat lewat Assignment Rule Step tsb.

### Negative path (8 diminta eksplisit, semua dibuktikan)

| Negative path | Hasil |
|---|---|
| Wrong tenant | Administrator Tenant lain mengakses Complaint id valid milik Tenant 1B -> 404 (bukan bocor lewat guess id) |
| Unauthorized customer | Customer User A submit Complaint dengan `customerId` Customer B -> 403 |
| Invalid workflow transition | actionCode yang tidak punya Transition dari Step saat ini -> 400 (`ValidationError` dari Workflow Engine sendiri) |
| Duplicate submission / idempotency | Submit kedua kali -> 403 (Assignment pending sudah pindah ke Handler, Customer User tidak eligible lagi — bukan diproses dobel) |
| Invalid attachment | Upload tanpa file part -> 400 |
| RBAC denial | Aktor tanpa `complaint.manage` -> 403 saat create maupun reopen |
| SLA escalation | Lihat di atas — berhasil ter-escalate + event ganda tercatat |
| Reopen authorization | Lihat di atas — ditolak saat masih in_progress (409) DAN saat aktor tidak berwenang (403), berhasil saat aktor berwenang + sudah Closed |

### Regression Phase 0 + 1A

Full suite dijalankan ulang tanpa mengubah assertion checkpoint
sebelumnya: **77/77 test lulus** (8 file: 6 file Phase 0 tetap 45, 1 file
Checkpoint 1A tetap 16, 1 file Checkpoint 1B baru 16), 0 regresi.

### Migration validation

Migration `1758000000000` divalidasi up -> down -> up dari database
kosong terpisah (disposable, `abixell_one_migration_check_1b`): jumlah
tabel round-trip persis 47 -> 48 -> 47 -> 48 (bertambah satu tabel,
`complaints`, konsisten dengan satu migration yang hanya menambah satu
tabel + baris permission/reference-data-type).

### Typecheck / Lint / Build

Bersih di `apps/api` (frontend tidak disentuh — sama seperti 1A, UI
Complaint masuk cakupan checkpoint UI Experience Layer berikutnya, di
luar 1B per instruksi eksplisit Founder: "Jangan masuk ke ... UI
Experience Layer").

### Self-Review

- **Tidak ada state machine yang di-hardcode** di `ComplaintService` —
  diverifikasi langsung: mengubah actionCode manapun di Transition demo
  (mis. rename `verify` -> `qa_pass`) hanya butuh perubahan data Tenant
  Configuration, nol perubahan kode. Ini bukti konstruksi, bukan klaim.
- **Priority dan Severity benar-benar dua field/catalog terpisah** —
  Priority memakai ulang `priority_level` (generic, lintas-modul sejak
  0C), Severity punya `complaint_severity` sendiri; keduanya tervalidasi
  independen di test (`priority: "high"`, `severity: "major"` disimpan
  dan dibaca terpisah).
- **Semua field yang diminta configurable memang configurable**:
  Category/Severity (reference data), SLA (per-Step `slaHours`),
  Assignment Rule (role+scope atau specific_user, dengan/tanpa
  Condition), Numbering (pattern per Tenant), Notification Template
  (event_type + template per Tenant) — tidak satu pun perlu deploy ulang
  kode untuk diubah per klien.
- **Evidence path teruji lintas role** (Handler upload, Customer User
  list/download) — membuktikan resolver `complaint` konsisten dengan
  resolver `customer` 1A, bukan implementasi kedua yang mirip tapi
  berbeda.

### Gap Analysis

- Belum ada endpoint update/soft-delete untuk Complaint (carry-over pola
  yang sama sejak 0B).
- SLA tetap per-Step (bukan matriks multi-dimensi) — keputusan sadar,
  lihat ADR-0013 dan decision-log #5.
- `subcategory` masih free-text, belum reference-data-typed.
- Peran dengan `workflow.instance.read` peninggalan Phase 0 (mis.
  `WORKFLOW_MANAGER`) masih bisa menelusuri seluruh Workflow Instance
  tenant lewat route generic — bukan regresi baru 1B, tapi tetap dicatat
  eksplisit sebagai residual risk (lihat ADR-0013 Consequences).
- Belum ada UI Complaint (Portal Customer/Internal) — eksplisit di luar
  cakupan 1B.

### Risk Note

Tidak ada risiko BLOCKER yang ditemukan. Risiko tersisa (semua sudah
punya mitigasi eksplisit atau memang dicatat sebagai keputusan sadar,
bukan gap tak disengaja):

1. **Residual `workflow.instance.read` exposure** (lihat Gap Analysis) —
   mitigasi: demo seed 1B sengaja tidak memberi permission ini ke role
   Complaint manapun; risiko hanya muncul jika role internal lain
   diberikan permission ini DAN kebetulan juga bekerja dengan Complaint.
2. **SLA per-Step, bukan matriks** — mitigasi: keputusan proporsional
   yang didokumentasikan (ADR-0013), Workflow Definition tetap 100%
   Tenant Configuration sehingga upgrade ke matriks nanti tidak butuh
   migrasi arsitektur, hanya penambahan mekanisme seleksi Definition.
3. **`subcategory` free-text** — risiko rendah (bukan field otorisasi
   atau routing), dicatat sebagai Technical Debt murni.

### Kesiapan untuk Checkpoint 1C

Checkpoint 1B dinyatakan selesai menunggu Founder Review. Tidak ada item
BLOCKER yang menghalangi mulainya 1C. Rekomendasi eksplisit: keputusan
soal Survey/Assessment (1C/1D per urutan Founder) dan UI Experience Layer
sebaiknya menunggu instruksi lanjutan Founder, bukan diasumsikan otomatis
lanjut tanpa arahan baru.

---

## Checkpoint 1C.8 — Regression & Stabilization (Phase 1C Closure)

**Status: COMPLETE (awaiting Founder closure)**
**Date: 2026-08-19**

Verifikasi/stabilisasi lintas Checkpoint 1C.1–1C.7. Bukan feature checkpoint —
tidak ada fitur baru; hanya perbaikan test-selector (e2e smoke), verifikasi,
dan dokumentasi.

### Regression
- typecheck / lint / build: PASS. Backend suite: **116/116 PASS** (13 files).
- Bundle web stabil: JS 267 KB (gzip 75 KB), CSS 17 KB (gzip 3.8 KB) — tanpa
  lonjakan dari 1C.7.

### Authorization / cross-tenant / data scope
- Ter-cover oleh negative-path tests di seluruh suite (customer/operational/
  verification/dashboard/config): cross-tenant → 404, cross-customer/unauthorized
  → 403, scope-aware aggregation, customer-safe timeline (tanpa actor/comment),
  operational endpoint menolak customer-scope-only. Migration idempotent
  (re-run "No migrations to run"); FK role_permissions→permissions = ON DELETE
  CASCADE → migration permission 1C.5 idempotent (up: WHERE NOT EXISTS) +
  rollback-safe (down: cascade).

### Fresh-environment / migration roundtrip
- Disposable-DB roundtrip TIDAK feasible di environment ini: role `abixell`
  tanpa CREATEDB, tanpa kredensial superuser (ENVIRONMENT LIMITATION; roundtrip
  destruktif dilarang pada dev DB utama §23). Determinism diverifikasi via
  idempotency migrate + inspeksi schema (48 tables / 10 migrations) + FK. Test
  suite mem-bootstrap tenant dari kosong tiap run (bukti skema berasal dari
  migrations, bukan state historis).

### PWA real-browser verification (RESOLVED)
- `npx playwright install chromium` berhasil (114 MB). Terhadap production
  preview (:4173): SW **registered + active** (scope `/`); cache
  `abixell-shell-v1` = 3 static asset; **`/api` tidak pernah di-cache**
  (apiCached=0); **offline shell render**; **online recovery OK**. Kegagalan SW
  di in-app browser 1C.7 memang batasan sandbox, bukan defect.
- `e2e/smoke.mjs` (real Chromium) hijau: shell/persona nav, responsive
  no-overflow (390/768/1280), mobile nav toggle, manifest valid, SW support.

### Dependency audit (npm audit — tidak ada perubahan dependency, §34)
- 9 vuln (1 critical / 3 high / 5 moderate). CRITICAL/HIGH + mayoritas MODERATE =
  **dev/build/test tooling** (vitest, vite, esbuild, vite-node, glob,
  node-pg-migrate) — tidak di production runtime. react-router/-dom (moderate) =
  frontend runtime tetapi advisory tidak applicable (nav internal literal;
  client-only tanpa SSR). Tidak ada MUST-FIX applicable → dependency tidak diubah.

### Terminology / architecture drift
- Scan client-facing `apps/web/src`: tidak ada "Whitelabel/Shared Core/Reusable
  Platform/Product Core" pada string UI (satu-satunya match ada di komentar
  kode capabilities.ts — diizinkan). Arsitektur konsisten dengan binding
  decisions (modular monolith, satu PostgreSQL, API-first, web-first, PWA-ready,
  multi-tenant ready) — tanpa microservice/duplicate persistence/reporting store/
  low-code/permission bypass.

### Bugs found & fixed
- e2e smoke step-2 selector cocok banyak elemen (mobile header hidden) →
  timeout. Diperbaiki jadi selektor heading Overview (test fix; product benar).
  Tidak ada product bug ditemukan.

Lihat `technical-debt-register.md` (bagian Phase 1C) untuk konsolidasi &
klasifikasi technical debt. **Tidak ada MUST FIX BEFORE 1D.**

---

## Checkpoint 1D.1 — Generic Survey & Assessment Engine Core

**Status: COMPLETE (awaiting Founder review)**
**Date: 2026-08-19**

Backend-first vertical slice of the Product-Core Survey/Assessment engine
(FD-1D approvals). Frontend deferred to a later 1D sub-checkpoint (§29/§30).

### Built
- **Schema** (migration `1760000000000_survey-engine-schema`, +8 tables →
  56 total): `survey_definitions → survey_versions → survey_sections →
  survey_questions → survey_question_options` (Definition aggregate) and
  `survey_assignments → survey_answers → survey_answer_options` (Assignment =
  instance + response container, FD-1D-02). Tenant ownership on the roots
  (definition/assignment); sub-entities tenant-guarded in the app layer +
  tests. Indexes per §24; down migration drops in FK order (rollback-safe).
- **Permissions** (migration `1760000100000_survey-permissions`, data-only,
  idempotent): `survey.manage`, `survey.respond`, `survey.results.read`
  (FD-1D-01). ADMIN via `sync-role-permissions`; CUSTOMER_USER granted
  `survey.respond` in seed (never `manage`).
- **Domain/Repo/Services**: `SurveyService` (definition/version/section/
  question/option/publish/retire/assign + results) and `SurveyResponseService`
  (my-assignments/get/save-answers/submit). PG repo mirrors existing
  conventions.
- **Versioning & immutability** (FD-1D-03/06): lightweight status
  `draft|published|retired` (NOT the Workflow Engine); only drafts are
  editable; publish sets is_current; answers reference the immutable published
  question by FK — **no defensive snapshot fields** (per FD-1D-03).
- **Question types** (FD-1D-04): `rating` (config min/max, score = value),
  `single_choice` (options with optional score, exactly one selection),
  `long_text` (no score). Enum is future-ready; other types are rejected.
- **Scoring**: on submit, total = sum(rating values + selected option scores);
  long_text unscored; persisted on the assignment (immutable). Semantics
  documented: total is over scored questions only.
- **Assignment/respondent**: respondent_type `user` only in v1;
  customer_contact columns are schema-readiness. Cross-tenant respondent
  rejected. `context_entity_type/id` present (FD-1D-05) and authorized via the
  reused EntityAuthorizationResolver registry — **no Complaint auto-create /
  1E trigger**.
- **Submit atomicity** (§14/§37): required-validation + score, then a single
  guarded `UPDATE ... WHERE status IN (pending,in_progress)` — double-submit
  returns 409; a submitted assignment is immutable.
- **Audit/Events**: `survey.definition.created/version.created/published/
  version.retired/assignment.created/submitted` (audit); `survey.published/
  assigned/submitted` (EventBus) — notification-ready for 1E, no automation.

### API
Admin: POST /surveys, GET /surveys, GET /surveys/:code, POST /surveys/:code/
versions, POST /survey-versions/:id/{sections,questions}, POST /survey-
questions/:id/options, POST /surveys/:code/versions/:n/{publish,retire}, POST
/survey-assignments. Respondent: GET /survey-assignments/my, GET /survey-
assignments/:id, POST /survey-assignments/:id/answers, POST .../submit.
Results: GET /survey-assignments/:id/result.

### Tests / Regression
`survey-engine.test.ts` (12) — definition/publish (valid+invalid+immutable),
assignment (published-only, cross-tenant respondent), respond (ownership,
invalid option/range), submit (required, scoring=14, immutability, double-
submit), result (authorized/unauthorized/cross-tenant), tenant isolation,
audit+events. Total suite **128/128 PASS**; typecheck/lint/build PASS.

### Migration validation
Applied to dev DB; idempotent (`No migrations to run` on re-run); 56 tables /
12 migrations; both new migrations rollback-safe (down written). Disposable-DB
down/up roundtrip not run — role lacks CREATEDB (environment limitation, same
as 1C.8).

### Deferred (see technical-debt-register Phase 1D)
Survey frontend (admin + respondent), customer_contact respondent flow,
anonymous/public token, conditional/branching, matrix, file-upload question,
full multi-language, weighted/section scoring, cross-survey analytics/AI, and
the Complaint→Survey trigger (1E).

---

## Checkpoint 1D.2 — Survey Admin & Respondent Experience

**Status: COMPLETE (awaiting Founder review)**
**Date: 2026-08-19**

Thin end-to-end frontend over the 1D.1 API, reusing the 1C shell/components/
responsive/PWA foundation. Acceptance flow (admin create → publish → assign →
respondent answer → submit → result) verified live in real Chromium.

### Frontend
- Nav (capability-gated): "Surveys" (survey.manage), "My Surveys"
  (survey.respond). Routes /surveys, /surveys/:code, /my-surveys,
  /my-surveys/:assignmentId.
- Admin: SurveyListPage (list + create), SurveyDetailPage (version selector,
  draft-only question authoring for rating/single_choice/long_text incl.
  option adder, publish/retire, assignment form with a user picker via the
  existing /users endpoint). Published versions render read-only.
- Respondent: MySurveysPage (enriched list) + MySurveyDetailPage (renders
  rating scale from config min/max, single-choice radios, long-text; save
  draft; submit; submitted state read-only with total score). No offline
  answer caching (PWA policy unchanged).

### Backend (small additive reads for the UI, §29)
- GET /survey-versions/:id (survey.manage) — version detail for authoring a
  draft (getDefinition only returns the current published version).
- Enriched GET /survey-assignments/my — includes surveyName + versionNumber
  so the respondent list is meaningful.
- Seed: CUSTOMER_USER granted survey.respond (demo respondent).

### Bug fixed (found by live testing)
- The web API client always set `Content-Type: application/json`, even for
  bodyless POSTs — Fastify rejects an empty JSON body (400). This broke every
  bodyless POST (survey publish/version/retire/submit — the first such calls
  in the app). Fixed: set Content-Type + body only when a body is present.

### Tests / Regression
`survey-engine.test.ts` grew to 13 (added a check for the version-detail read
+ my-list enrichment). Suite **129/129 PASS**; typecheck/lint/build PASS.
Live acceptance verified in Chromium (admin authoring UI + respondent UI;
rating answer=5 → total score 5; submitted state persists read-only).

### Deferred (see technical-debt-register Phase 1D)
customer_contact/anonymous respondent UI, conditional/matrix/file questions,
survey analytics, and the Complaint→Survey trigger (1E). Context entity remains
a metadata/authorization seam only.

## 2026-08-19 — Checkpoint 1D.3 (Survey Engine Stabilization & Closure)

Regression/validation/closure checkpoint — **no new features** (per Founder
prohibition list). No product code changed except tests; no schema/migration,
no dependency change. Objective: prove Phase 1D is safe to close.

### Invariants validated (regression + live)
- **Lifecycle/versioning**: draft→published→retired; published + questions/
  options immutable (add-option to published question → 409).
- **Historical response safety**: create v2 + edit after a v1 response; the
  submitted assignment's result stays bound to v1 with its original score
  (verified: score unchanged after v2 edits).
- **Retire safety**: retiring the current version keeps existing results
  readable; assigning a retired version → 409.
- **Scoring/atomicity**: submit is a single guarded UPDATE (status IN
  pending/in_progress) — double-submit → 409, no partial state.
- **Tenant isolation / result authorization / context safety**: enforced via
  repo tenant scoping + `survey.results.read` + EntityAuthorizationResolver.

### Stabilization tests added (§14–§16, no product change)
`survey-engine.test.ts` → **16 tests**: immutability of published question
options; historical response safety across a new version; retire safety.
Full suite **132/132 PASS**; typecheck/lint/build PASS.

### Live acceptance (real Chromium)
- Admin authoring + publish + assign; respondent answer → submit → read-only
  with total score (unchanged app code; re-confirmed on closure state).
- **Draft persistence (§27)**: rating draft saved → reload → selection
  persists server-side (`aria-pressed=true`); `localStorage` holds only
  `abixell.session` (no business-data caching); submit → reload → read-only
  "Submitted — thank you" + correct total score.

### Scan results
- **No Complaint coupling** in Survey Core (only a UI date-format util import
  from `../complaints/format` — pure formatting, logged as SHOULD FIX LATER).
- **Terminology**: no internal terms (Whitelabel/Shared Core/Product Core) in
  client-facing UI; no client name hardcoded.
- **Migration sanity**: idempotent (survey-permissions guarded by NOT EXISTS);
  down-migrations drop in FK order.
- **PWA cache security**: sw.js caches static shell only; `/api` never cached.

### 1E readiness (documented, NOT built)
context_entity seam + `survey.assigned`/`survey.submitted` events + immutable
score are in place. See technical-debt-register "1E READINESS".

## 2026-08-20 — Checkpoint 1E.1 (Complaint → Survey Assignment Integration)

The trigger/assignment HALF of Survey-to-Action (FD-1E-01..07). Survey
Submitted → Action is explicitly OUT (that is 1E.2).

### Integration boundary (FD-1E §2/§39)
New application component `survey-integration` (orchestrator) sits BETWEEN
the two Cores. It subscribes to `complaint.customer_confirmed` and calls
Survey via an application port. Dependency is one-way: `survey-integration`
→ Complaint (read, `ComplaintRepository.findById`) + Survey (application
port). Complaint Core and Survey Core do NOT import each other or this
component. The strings `complaint` / `complaint.customer_confirmed` live
only as configured finite policy VALUES, never as Survey/Product Core logic.

### Flow
`complaint.customer_confirmed` (real EventBus) → find enabled policies for
(tenant, source_entity_type, source_event_type) → per policy: claim a
`processing` execution → one-per-lifetime pre-check → resolve respondent →
resolve current published version → `SurveyService.createAssignmentFor
TrustedIntegration` → complete execution `assigned` (context = complaint).

### Source event (FD-1E-01)
`complaint.customer_confirmed` (published by the workflow `confirm` action
via `ACTION_EVENT_MAP`). Stored as a finite `source_event_type` policy
value; NOT `complaint.closed` for the first slice.

### Respondent resolution (FD-1E-02)
`source_event_actor` = `DomainEvent.createdBy`, accepted ONLY when it is a
genuine customer-side actor: user exists + same tenant + holds a `customer`-
scoped role assignment matching the complaint's `customerId`. This
structurally EXCLUDES internal handlers/admins (they carry `tenant`/
`organization_unit` scope). Any failure → execution
`skipped_recipient_unresolvable`, no fallback to submittedByUserId /
internal agent / contact / first customer user / admin / anonymous token.

### System attribution (FD-1E-03)
No system user seeded, no ADMIN grant, no ActorContext redesign. The
Assignment is created via a trusted seam with `assigned_by = NULL`; the
survey audit records `creationMode: automation` + `triggerDomainEventId`,
and the execution row carries respondent + trigger event. So it is never
presented as manually created by the customer.

### Trusted seam (FD-1E §19)
`SurveyService.createAssignmentForTrustedIntegration` +
`resolvePublishedVersionForTrustedIntegration`. "Trusted" bypasses ONLY the
human `survey.manage` permission — tenant match, published-only, respondent-
same-tenant, and context invariants are all still enforced.

### Idempotency (FD-1E §12) — DB is the final boundary
- `UNIQUE(policy_id, trigger_domain_event_id)` → event replay is a no-op
  (`ON CONFLICT DO NOTHING` on the `processing` insert).
- partial `UNIQUE(policy_id, source_entity_type, source_entity_id) WHERE
  status='assigned'` → one-per-lifetime (FD-1E-07): reopen + re-confirm does
  not create a second survey. App pre-check optimizes the common case; the
  index is authoritative.

### EventBus reliability (FD-1E §15/§16)
The in-process bus is fire-once and SWALLOWS a throwing subscriber. The
handler therefore NEVER throws — it catches everything and persists a
`failed` execution, so a failure is durable/observable instead of lost. A
failed integration never rolls back the customer's confirmation (the
Assignment is a side-effect, not part of the confirmation transaction).

### Schema / config
Two tables (migration `1761000000000`, 56 → 58): `survey_integration_
policies` (finite structured config, no outcome/action fields — those are
1E.2, YAGNI) + `survey_integration_executions` (idempotency + observability).
Rollback-safe (down verified). No permission added (no admin surface yet →
no dead `survey.integration.configure`). Policies are created via the
service config seam (test/seed/future admin); none seeded (no magic config).

### Tests / Regression
`survey-integration.test.ts` — 8 tests through the REAL EventBus + REAL
registered subscriber (`buildContainer()`): valid assign + automation
attribution; event-replay idempotency; one-per-lifetime; recipient invalid
(internal / wrong-customer / cross-tenant); no-published-version skip;
tenant isolation (disabled policy in another tenant). Suite **140/140 PASS**
(was 132). typecheck/lint/build PASS. Complaint rows are seeded directly —
the workflow→event emission itself is covered by complaint-engine tests.

### Deferred to 1E.2
`survey.submitted` consumption, outcome/threshold evaluation, target action
(reopen / escalate / management attention). No automatic reopen in 1E.1.

## 2026-08-20 — Checkpoint 1E.2 + 1E.3 (Survey Outcome → Management Attention, and Phase 1E closure)

Completes Survey-to-Action: a submitted Survey is evaluated against a
configured question-code threshold and, on a match, raises **management
attention**. Phase 1E's Core capability ENDS here — see "Product blueprint".

### Flow (second half)
`survey.submitted` → find the 1E.1 execution that created this assignment
(policy lineage) → evaluate the execution's SNAPSHOT of the outcome config →
compare-and-set the outcome (exactly-once) → audit → if matched and the
policy is still enabled: resolve management recipients BY CAPABILITY →
publish `survey.integration.attention_required` → Notification Core delivers
→ record `attention_status`.

### Outcome model (FD-1E-05)
Question **code** (stable across versions), one finite operator
(`lt|lte|eq|gte|gt`), one numeric threshold. `rating` → the submitted
numeric value (no normalization); `single_choice` → the selected option's
CONFIGURED score (never option order); anything else / unanswered / option
without a score → `unresolvable` (never a fallback to `total_score`, never
an invented number). Outcomes: `matched | not_matched | unresolvable`, with
`outcome_error_code` naming why (`no_outcome_config`, `question_not_found`,
`not_answered`, `non_numeric_question`, `no_option_score`).

### Policy snapshot (FD-1E §29)
The outcome configuration is copied onto the execution when the Assignment
is created. Editing the policy while a respondent is still answering cannot
retroactively change how that assignment is judged (covered by a test:
threshold widened 2 → 4 mid-flight, the assignment is still judged at 2).

### Management attention (FD-1E-06)
Definition: an authoritative, tenant-safe, idempotent, auditable, and
configurable signal — NOT a new task/workflow subsystem. Delivered through
existing capability: one domain event
`survey.integration.attention_required` carrying `targetUserIds`, which the
existing Notification Engine renders/delivers per its templates. Recipients
are resolved BY CAPABILITY (`attention_permission_code` in policy data —
e.g. `complaint.dashboard.read`), never by role name, via the new
`RbacRepository.listUserIdsWithPermissionInTenant`, which excludes
`customer`-scoped assignments so a Customer User can never receive an
internal management signal. `attention_status` ∈
`created | failed | skipped_policy_disabled`.

### Notification Core change (minimal)
`handleDomainEvent` gained one branch: an optional `targetUserIds` array in
the payload, alongside the existing `targetUserId`/`targetRoleCode`
convention. No new notification service/method, no new delivery path.

### Idempotency (FD-1E §25/§26)
Exactly-once WITHOUT a new table: `claimOutcome` is a single conditional
UPDATE (`WHERE outcome IS NULL`). A replayed `survey.submitted` loses the
compare-and-set and performs no second evaluation and no second attention.

### Failure semantics (FD-1E §33/§34)
The handler never throws — a Survey submission is a completed domain action
and is NEVER rolled back by an integration failure (test: an unresolvable
management capability yields `attention_status='failed'` +
`error_code='no_management_recipient'` while the submission stands with its
score). Unresolvable outcomes are a business/configuration state, not a
retry loop. No retry framework was added.

### Trusted result access (FD-1E §43/§44)
`SurveyService.getResultForTrustedIntegration(tenantId, assignmentId)` —
bypasses only the human `survey.results.read` permission; still enforces
tenant ownership and submitted state; never exposed over HTTP.

### Automatic Complaint reopen
**NOT IMPLEMENTED — Founder decision.** Nothing in Survey Integration calls
`ComplaintService.reopen()` or mutates Workflow (verified by scan and by a
live check: zero automation-created `complaint.reopened` events).

### Schema / migration
Migration `1762000000000` — additive columns only on the two 1E.1 tables
(**still 58 tables**, no third table). All new columns nullable, so 1E.1
rows stay valid (a pre-1E.2 execution evaluates to `no_outcome_config`).
Rollback-safe: down → up verified, suite green afterwards.

### Tests / Regression
`survey-integration.test.ts` → **18 tests** (8 from 1E.1 unchanged, 10 new):
match, non-match, replay, single-choice option score, long-text
unresolvable, missing question code, policy-edit drift (snapshot),
policy-disabled-after-assignment, manual assignment no-op, and
submission-never-rolled-back. Suite **150/150 PASS** (was 140);
typecheck/lint/build PASS.

### Live acceptance (real HTTP + real EventBus, seeded demo tenant)
Full chain through the REAL Complaint workflow: customer files → submit →
handler acknowledge/assign/investigate/corrective/verification → manager
verify → **customer confirms** → survey auto-appears in My Surveys →
customer answers → submits. Rating 2 (≤2) → `matched`, attention `created`,
1 recipient, in-app notification `sent`, audit
`outcome.evaluated` + `attention.created`. Rating 4 → `not_matched`, no
attention, no notification. Complaint workflow stayed terminal (`approved`)
in both — no auto-reopen. DB checks: no duplicate assignments per
(policy, complaint), attention events == created attentions (11/11).

### Product blueprint note (FD-1E §75)
Survey-to-Action's initial **Core** capability ends at
*configurable outcome → management attention*. Automatic domain mutation
(e.g. Complaint Reopen, escalation, generic follow-up) is NOT part of Core
1E; it remains a future Advanced Capability requiring an explicit Founder
decision. This boundary matters for the Product Core vs Advanced audit
after Phase 1F.


## 2026-08-20 — Phase 2 (Service Operations & Work Management Core)

First business module delivered under the **frozen target repository
architecture**: backend at `apps/api/src/modules/service-operations/core/
{domain,application,infrastructure,api}`, frontend at
`apps/web/src/modules/service-operations/`. Existing Phase 0/1 code was NOT
migrated (deliberate — see blueprint §11A).

### Domain model
- `service_definitions` + `service_definition_checklist_items` — reusable,
  generic service types (SO-CORE-001/007).
- `work_requests` — intake. State is **derived** from
  `converted_work_order_id` / `cancelled_at`; there is deliberately no status
  column, so intake bookkeeping can never become a second lifecycle.
- `work_orders` — the executable unit. **No status column**:
  `workflow_instance_id` is the one link to the Workflow Engine
  (SO-CORE-004). Completion/verification columns record business FACTS only,
  exactly as `complaints` does.
- `work_order_checklist_items` — snapshotted from the template at creation.

### Why the checklist is snapshotted
A Service Definition is Client Configuration and will change. Executed work
must remain historically truthful, so code/label/is_required are copied onto
the Work Order at creation. Verified by test: adding a template item later
does not alter an existing Work Order's checklist.

### Platform Core reuse (nothing re-implemented)
Workflow (lifecycle + assignment eligibility), Numbering (`work_request`,
`work_order`), Configuration (reference data types `service_category`,
`work_priority`), Documents (evidence via entityType `work_order` plus an
entity authorization resolver), Audit, Domain Events, Notification, RBAC, and
Customer Data Scope. Customer/Project/Site come from Customer & Commercial —
no duplicate master anywhere.

### Authorization design
Five capability-based permissions: `service_operations.read`, `.manage`,
`.execute`, `.verify`, `.configure`. No role-name logic exists.

Work Order visibility = Customer Data Scope **OR** the actor is the assigned
executor **OR** the actor is associated with the Workflow Instance. The
assignee path matters because a field executor is authorised by assignment,
not by owning the customer's scope.

Lifecycle dispatch (`/actions/:actionCode`) requires `read` plus **any**
operational capability, with the Workflow Engine remaining the precise gate.
This was a real correction found by testing: requiring `execute` wrongly
blocked coordinators from advancing work they own.

### Idempotency and guards
Guarded UPDATEs make start, completion, and verification idempotent (a
duplicate completion returns 409 and cannot overwrite the original facts). A
Work Request converts exactly once. Required checklist items block
completion. Only the assigned executor may execute.

### Tests / Regression
`service-operations.test.ts` — 13 tests covering the full happy path,
authorization, execution ownership, lifecycle validity, historical safety,
Data Scope, cross-tenant isolation (work order, assignment, service
definition), intake lifecycle, inactive definitions, and schedule validation.
Suite **163/163 PASS**; typecheck/lint/build PASS.

### Live acceptance (real Chromium, through the UI)
Service type + checklist defined → work order created → assigned to a field
worker → scheduled → lifecycle advanced → field worker (390 px viewport)
started work, completed the required checklist item, and completed the job →
supervisor verified → historical record still readable. No horizontal
overflow at 375/390/768/desktop on all three surfaces.

### Also resolved
The "shared date formatter" debt: module-neutral helpers now live at
`apps/web/src/shared/format.ts`, with the Complaint module re-exporting them
(no behaviour change, no churn).

### Deliberately NOT built (Advanced, deferred)
Recurring service, advanced scheduling, route planning, productivity and
manpower optimisation, forecasting, offline field execution. No Vertical
Service Pack logic — the four packs remain configuration over this engine.


## 2026-08-20 — Phase 3 (Workforce / HR Core)

Second module under the frozen target architecture: backend at
`apps/api/src/modules/workforce/core/`, frontend at
`apps/web/src/modules/workforce/`.

### Domain model (3 tables, 63 → 66)
- `positions` — reusable job titles per tenant.
- `employees` — the master record. Carries the CURRENT placement for
  querying, plus an OPTIONAL `user_id`.
- `employee_assignments` — one row per placement/status period
  (`effective_from` … `effective_to`, null = current).

### Employee is not a system user
`user_id` is nullable and a partial unique index makes the link one-to-one
per tenant. An employee may exist with no login at all; linking or unlinking
never creates, modifies, or deactivates the account. Identity stays a
separate domain and Workforce never becomes an authentication system.

### History without a temporal database
A placement change closes the open period and opens a new one — historical
facts are never rewritten. A partial unique index (`WHERE effective_to IS
NULL`) allows at most one open period per employee. Ending employment records
an effective end and keeps the record readable; nothing is hard-deleted.

### Organisation is not duplicated
Placement references the platform's `legal_entities` and
`organization_units`. There is no `hr_companies` / `hr_departments` shadow
hierarchy. Hierarchical Organization Unit Data Scope is **reused**:
`RbacService.isOrganizationUnitScopeCovered` was made public so list
filtering applies the platform's exact rule rather than re-deriving it.
Transfers are also scope-checked at the destination, so scope cannot be
escaped by moving an employee out of it.

### Documents
Reuse Document Core with `entityType: 'employee'` plus an entity
authorization resolver. Employee documents require the dedicated
`workforce.documents.read` capability **in addition** to Data Scope — holding
`workforce.read` is deliberately not enough, because employment documents are
more sensitive than ordinary business records. A person can always reach
their own documents.

### No Workflow for master-data CRUD
The Workflow Engine was deliberately not used: Core employee maintenance has
no approval lifecycle, and using workflow merely because it exists would add
configuration burden with no business value.

### Privacy and data minimisation
No statutory identifiers, tax, banking, medical, biometric, religion,
marital, or family fields. Audit metadata records the employee number and
placement ids only — never contact details.

### Bug found and fixed
pg returns `date` columns as a JS Date at LOCAL midnight; formatting those
with `toISOString()` shifted every calendar date back one day in any timezone
east of UTC (`2026-02-01` became `2026-01-31`). Caught by the placement-history
test. Calendar dates are now read and written as plain `YYYY-MM-DD` strings
with no timezone conversion.

### Tests / Regression
`workforce.test.ts` — 16 tests: employee master, explicit vs generated
numbers, employee-without-login, placement history, ending employment,
user-link rules (optional, one-to-one, tenant-bound), self-service record,
hierarchical Data Scope (including descendant units and transfer guard),
authorization, document capability separation, cross-tenant isolation,
validation, and search/filter. Suite **179/179 PASS**.

### Live acceptance (real Chromium, through the UI)
Create employee with legal entity, organization unit, position and join date
→ attach an employment document → record a transfer with a new position and
effective date → end employment. The record stayed readable with three
history periods intact. No horizontal overflow at 375/390/768/desktop; 9/9
form controls label-associated on the detail page.

### Deliberately NOT built (Advanced, deferred)
Attendance, shift/roster, leave, overtime, payroll (and any statutory
contribution or income-tax handling), recruitment, performance, competency,
training, career, manpower planning. No country-specific compliance.


## 2026-08-20 — Phase 4 (Supply Chain Core)

Third module under the frozen target architecture: backend at
`apps/api/src/modules/supply-chain/core/`, frontend at
`apps/web/src/modules/supply-chain/`.

### Domain model (8 tables, 66 → 74)
`items`, `suppliers`, `stock_balances`, `stock_movements`,
`purchase_requests` + `purchase_request_lines`, `purchase_orders` +
`purchase_order_lines`.

### Stock model
Balance is kept per item and stock **location**, where the location is the
existing Site — there is no warehouse/zone/bin topology in Core. A null
`site_id` means tenant-level stock, so two PARTIAL unique indexes are used
rather than one plain UNIQUE (NULL never equals NULL — the same trap ADR-0006
documented).

Movements are the ledger and balances are the fast read. Quantity on a
movement is always positive; direction is the type. A correction is a new
compensating movement, never an edit (SCM-CORE-006).

### Transactional and concurrency safety
This was the phase's hardest requirement and its defining property:

- Every quantity change writes the movement AND applies the balance effect
  inside **one transaction**. A rejected movement leaves nothing behind —
  proven by test (a rejected issue leaves the balance untouched and writes no
  ledger row).
- The sufficiency check lives **inside** the decrement statement
  (`... AND quantity >= $qty`), not in a separate read. Two concurrent issues
  therefore cannot both pass a stale read and overspend. Proven by test: six
  parallel issues of 2 against a balance of 10 produce exactly five
  successes, one 409, a final balance of zero, and exactly five outbound
  ledger rows.
- The over-receipt check lives inside the statement that advances
  `quantity_received`, so concurrent receipts cannot jointly exceed the
  ordered quantity.

### Lifecycle
Purchase Request approval belongs to the configured Workflow Engine
(`workflow_instance_id`; no status column). A Purchase Order deliberately has
no second state machine: `issued_at` null means draft, set means issued and
line-immutable — a one-way transition with an invariant, the same pattern
used for Work Request in Phase 2.

Receipt against an order line is simply a goods-in movement referencing that
line, so no receipts table was needed.

### Money boundary
Purchase order unit price is procurement transaction data only. There is no
valuation, cost layer, AP liability, journal, or GL posting anywhere in this
module — inventory accounting belongs to Finance/Advanced.

### Platform Core reuse
Workflow (PR approval), Numbering (`purchase_request`, `purchase_order`),
Configuration (reference types `item_category`, `unit_of_measure`,
`supplier_category`), Documents (resolvers for `purchase_request` and
`purchase_order`), Audit, Events, RBAC, hierarchical Organization Unit Data
Scope. Supplier is kept distinct from Customer — no polymorphic party model.

### Authorization
Four capabilities separating duties: `supply_chain.read`, `.configure`
(master data), `.manage` (purchasing), `.stock.manage` (movements). Verified
by test that a store keeper cannot raise orders and a buyer cannot move
stock.

### Tests / Regression
`supply-chain.test.ts` — 16 tests covering master data, inactive-item guard,
goods in/out, insufficient-stock rollback, **concurrency**, per-location
balances, PR workflow lifecycle and invalid transitions, PR→PO conversion
(exactly once, approved-only), issue guard, partial receipt, over-receipt
rejection, cancellation rules, authorization separation, Data Scope,
cross-tenant isolation, validation, and historical safety. Suite
**195/195 PASS**.

### Live acceptance (real Chromium, through the UI)
Item → supplier → purchase request for 40 → submit → approve → order from
the approved request → issue → receive 25 of 40 → stock reads 25 → issue 10
out → an overspend attempt rejected with a clear "Insufficient stock"
message. No horizontal overflow at 375/390/768/desktop.

### Deliberately NOT built (Advanced, deferred)
Multi-warehouse, bin location, batch/lot/serial, reservation, reorder
planning, transfers, stock opname, inventory valuation, FIFO/moving average,
landed cost, RFQ, tender, bid comparison, supplier evaluation/scorecard,
contract purchasing, spend analytics, demand forecasting, MRP.

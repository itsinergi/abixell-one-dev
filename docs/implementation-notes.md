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

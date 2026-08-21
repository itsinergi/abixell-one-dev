# Technical Debt Register — Phase 0 (Checkpoint 0A–0F) + Phase 1 Checkpoint 1A–1B

**Tanggal disusun:** 2026-08-18 (Checkpoint 0F — Phase 0 Stabilization),
diperbarui 2026-08-18 (Checkpoint 1A — Document Scope & Customer
Experience Foundation), diperbarui lagi 2026-08-18 (Checkpoint 1B —
Generic Customer Complaint Engine)
**Cakupan:** Konsolidasi SELURUH gap yang tercatat eksplisit di
`docs/decision-log.md` dan `docs/implementation-notes.md` sepanjang
Checkpoint 0A–0F, 1A, dan 1B, diklasifikasikan ulang menjadi empat
kategori sesuai instruksi Founder. Item yang sudah diselesaikan ditandai
selesai, bukan dihapus dari catatan — riwayat keputusan tetap utuh.

Klasifikasi:
- **BLOCKER** — wajib selesai sebelum Phase 1 (Complaint/Survey) dimulai.
- **MUST FIX** — wajib selesai sebelum tenant pilot nyata go-live, boleh
  dikerjakan SELAMA Phase 1 berjalan (tidak menghalangi mulainya Phase 1).
- **TECHNICAL DEBT** — aman ditunda, didokumentasikan agar tidak
  terlupakan, tidak mengancam integritas data atau keamanan pada skala
  Phase 0/pilot awal.
- **FUTURE ENHANCEMENT** — di luar kebutuhan pilot, murni penambahan
  kapabilitas untuk skala/maturitas berikutnya.

---

## BLOCKER sebelum Survey/Assessment (Checkpoint 1D) atau UI Experience Layer

Tidak ada.

- Hierarchical Data Scope **SUDAH SELESAI** (ADR-0009, Checkpoint 0F) —
  prasyarat keras untuk role hierarkis (Regional Manager dsb.) yang akan
  dipakai Survey.
- Document Service belum mengikuti Data Scope entity induk **SUDAH
  DISELESAIKAN di Checkpoint 1A** lewat pola Entity Authorization
  Resolver (ADR-0012) + Customer Data Scope (ADR-0011) — lihat "Item yang
  SUDAH DISELESAIKAN di Checkpoint 1A" di bawah. Survey (1D) tinggal
  mendaftarkan resolver `entityType='survey'` yang sama polanya dengan
  `'customer'`/`'complaint'`, bukan memutuskan mekanismenya dari nol.
- Generic Customer Complaint Engine **SUDAH SELESAI di Checkpoint 1B**
  (ADR-0013) — Workflow Reopen dan trusted-caller read/numbering
  extensions sekarang tersedia generik untuk Survey (1D) tanpa perubahan
  Workflow/Configuration Engine lagi, lihat "Item yang SUDAH
  DISELESAIKAN di Checkpoint 1B" di bawah.

## MUST FIX sebelum pilot nyata (boleh dikerjakan selama Phase 1)

1. **Migrasi permission untuk Role kurasi (bukan `is_full_access`)** —
   ADR-0010 (0F) menyelesaikan kasus Role Administrator ("semua
   permission"), TAPI Role kurasi (mis. `SUPERVISOR`, `REVIEWER`) yang
   perlu permission baru dari Product Core tetap butuh keputusan manual
   per Tenant. Belum ada UI/endpoint administrasi RBAC untuk itu.
   *(Asal: 0C/0D/0E, sebagian diselesaikan di 0F via ADR-0010.)*
2. **CORS masih permisif (`origin: true`)** — aman untuk Phase 0
   (Dedicated Deployment, tidak ada cookie/CSRF surface), tapi harus
   diganti dengan allowlist eksplisit (`CORS_ORIGIN` env var) begitu
   domain frontend pilot client sudah pasti. *(Asal: 0F security
   review.)*
3. **CI/CD masih belum ada** — seluruh gate (lint/typecheck/test/build)
   terbukti hijau secara lokal setiap checkpoint, tapi belum dibungkus
   pipeline otomatis karena belum ada remote git host dipilih. Wajib ada
   sebelum tim berkembang lebih dari satu implementor. *(Carry-over
   0A–0F, belum ada progres — lihat catatan "belum dikerjakan" di
   bawah.)*
4. **Belum ada endpoint update/soft-delete** untuk Tenant/Legal
   Entity/Organization Unit/User, dan belum ada endpoint terpisah
   "assign/ubah Role" untuk user yang sudah ada. *(Asal: 0B.)* Pola yang
   sama berlaku untuk seluruh entity Customer Foundation (Customer,
   Contract, Project, Site, Service, Service Assignment) yang baru
   ditambahkan di 1A — belum ada endpoint update/soft-delete untuk
   entity-entity ini juga. *(Asal: 1A.)* Complaint (1B) mengikuti pola
   yang sama — belum ada endpoint update/soft-delete untuk Complaint.
   *(Asal: 1B.)*
5. **Rate limit global (1200/menit) dan per-route (`/auth/login`
   10/menit) belum divalidasi dengan traffic pilot nyata** — angka
   dipilih dari baseline benchmark internal (lihat
   `docs/performance-baseline.md`), bukan dari data pemakaian
   sungguhan. Perlu ditinjau ulang setelah beberapa minggu pilot
   berjalan. *(Asal: 0F.)*

## TECHNICAL DEBT (aman ditunda)

1. **Scheduler adalah in-process timer**, bukan job runner tahan-restart
   (pg-boss/BullMQ/cron eksternal). Interval pendek (2 menit) membuat
   dampaknya kecil untuk Phase 0/pilot awal. *(Asal: 0E.)*
2. **Tidak ada retry otomatis** untuk Notification/Integration outbound
   yang gagal — status `failed` tercatat lengkap untuk audit manual,
   tapi tidak ada sweep retry seperti Escalation Sweep. *(Asal: 0E.)*
3. **Claim/lock TTL (15 menit) masih konstanta kode**, belum Tenant/Step
   Configuration; belum ada endpoint "force release" admin. *(Asal: 0E,
   ADR-0008.)*
4. **Resolusi Configuration Scope belum di-cache** — setiap panggilan
   `/config/feature-flags/effective` query database langsung. Baseline
   0F membuktikan endpoint serupa (`GET /me` yang juga re-fetch dari DB
   tiap request) tetap p50 5ms, jadi belum ada bukti perlu caching.
   *(Asal: 0C.)*
5. **Belum ada endpoint update/deactivate** untuk Reference Data dan
   Numbering Sequence. *(Asal: 0C.)*
6. **Terminology override baru per-Tenant**, belum per-Organization-Unit
   (pola partial-unique-index ADR-0006 sudah siap dipakai ulang bila
   dibutuhkan). *(Asal: 0C.)*
7. **`JWT_REFRESH_SECRET` di `.env.example` adalah konfigurasi mati** —
   refresh token bersifat opaque (random bytes di-hash SHA-256), bukan
   JWT bertanda tangan, jadi secret ini tidak pernah benar-benar dibaca
   kode. Tidak berbahaya (tidak dipakai = tidak bisa disalahgunakan),
   tapi membingungkan siapa pun yang membaca `.env.example`. *(Ditemukan
   saat security review 0F.)*
8. **Endpoint listing (`GET /organization-units`, `GET /users`, dll)
   belum mendukung pagination.** Tidak masalah pada skala data demo;
   `docs/performance-baseline.md` mencatat ini eksplisit sebagai area
   yang perlu diukur ulang pada skala data produksi nyata. *(Ditemukan
   saat performance baseline 0F.)*
9. **Favicon hilang (`/favicon.ico` 404)** — kosmetik murni, ditemukan
   lewat browser console saat visual E2E smoke test 0F. Tidak
   mempengaruhi fungsi apa pun.
10. ~~`GET /customers` belum difilter per Data Scope~~ — **SUDAH
    DISELESAIKAN di Checkpoint 1B** (hardening yang diminta eksplisit
    sebelum Complaint Engine dibangun). Lihat "Item yang SUDAH
    DISELESAIKAN di Checkpoint 1B" di bawah. *(Asal: 1A, diselesaikan
    1B.)*
11. **Resolver Entity Authorization terdaftar untuk `entityType='customer'`
    dan `'complaint'`** — `contract`/`project`/`site` belum punya
    resolver sendiri karena belum ada modul yang melampirkan dokumen
    langsung ke entity tsb (bukan gap tersembunyi — mekanismenya sudah
    generik dan siap dipakai kapan pun dibutuhkan, tinggal registrasi
    satu baris). *(Asal: 1A, diperluas 1B.)*
12. **SLA Complaint tetap per-Step (`WorkflowStep.slaHours`), belum
    matriks multi-dimensi** Customer×Contract×Service×Category×
    Priority×Severity — keputusan proporsional yang disengaja (lihat
    ADR-0013); Workflow Definition tetap 100% Tenant Configuration
    sehingga upgrade nanti tidak butuh migrasi arsitektur. *(Asal: 1B.)*
13. **`subcategory` Complaint masih free-text**, belum jadi reference
    data type tersendiri seperti `category`/`severity`. Risiko rendah
    (bukan field otorisasi atau routing). *(Asal: 1B.)*
14. **Role internal dengan `workflow.instance.read` peninggalan Phase 0**
    (mis. `WORKFLOW_MANAGER`) tetap bisa menelusuri seluruh Workflow
    Instance tenant lewat route generic `/workflow/instances/...`,
    termasuk milik Complaint — karakteristik generic engine yang sudah
    ada sejak 0D, bukan diperkenalkan 1B. Mitigasi yang sudah berjalan:
    demo seed 1B sengaja TIDAK memberi permission ini ke role Complaint
    manapun (`CUSTOMER_USER`/`COMPLAINT_HANDLER`/`COMPLAINT_MANAGER`).
    *(Asal: 0D, residual risk dicatat eksplisit di 1B, ADR-0013.)*

## FUTURE ENHANCEMENT

1. **Kompresi foto otomatis & enkripsi at-rest** untuk Document/File
   Service (diminta dok 06/09) — butuh infrastruktur image-
   processing/object-storage terenkripsi yang belum ada di lingkungan
   implementasi ini. *(Asal: 0E.)*
2. **Channel Notification selain `in_app`** (email/push/whatsapp/sms)
   belum punya transport nyata — template benar-benar di-render dan
   status `sent` tercatat, tapi tidak ada pengiriman sungguhan (butuh
   kredensial pihak ketiga yang belum ada). *(Asal: 0E.)*
3. **Sesi frontend disimpan di localStorage**, bukan httpOnly cookie +
   same-origin BFF. Trade-off yang sengaja dan didokumentasikan (lihat
   `AuthContext.tsx`) — cocok untuk Dedicated Deployment tanpa cookie/
   CSRF surface, tapi httpOnly cookie tetap postur yang lebih aman
   secara umum jika suatu saat arsitektur frontend berubah signifikan.
   *(Asal: 0F.)*
4. **`roles.is_full_access` belum punya UI toggle** — hanya bisa diset
   saat pembuatan Role (seed atau migration langsung). *(Asal: 0F,
   ADR-0010.)*
5. **Belum ada filter "claimed by me"** di `/workflow/my-assignments` —
   field `claimedByUserId` sudah ada dan tampil sebagai badge di
   frontend, tapi belum bisa difilter. *(Asal: 0E, ADR-0008.)*

## Item yang SUDAH DISELESAIKAN di Checkpoint 0F (bukti singkat)

- Hierarchical Data Scope (ADR-0009) — 40+ test baru membuktikan scope
  induk mencakup descendant, sibling tetap terisolasi.
- Production permission migration untuk Role `is_full_access` (ADR-0010)
  — dibuktikan langsung: satu grant dihapus manual, `sync-permissions`
  memulihkannya, run kedua melaporkan 0 grant baru (idempoten).
- Frontend token/session persistence — dibuktikan lewat Playwright E2E:
  reload halaman tidak lagi memaksa login ulang; logout membersihkan
  localStorage DAN merevoke refresh token di server.
- Webhook inbound idempotency (dedupe key + partial unique index) —
  dibuktikan: redelivery dengan key sama menghasilkan log entry yang
  SAMA, bukan duplikat.
- Scheduler overlap guard — dibuktikan: dua trigger manual bersamaan
  menghasilkan satu 200 dan satu 409, tidak pernah dua-duanya jalan
  bersamaan.
- Rate limiting (`/auth/login` 10/menit, global 1200/menit) — dibuktikan
  lewat test otomatis; SEKALIGUS menemukan dan memperbaiki bug nyata:
  error handler global sebelumnya membuang status code asli dari plugin
  Fastify (429 jadi 500) — sekarang statusCode 4xx dari plugin apa pun
  diteruskan apa adanya.
- React StrictMode double-invoke race pada refresh token single-use —
  ditemukan oleh Playwright E2E test (401 di console), diperbaiki dengan
  `useRef` guard sebelum sempat jadi bug produksi.

## Item yang SUDAH DISELESAIKAN di Checkpoint 1A (bukti singkat)

- **Document Service mengikuti Data Scope entity induk** (ADR-0012,
  Entity Authorization Resolver) — dibuktikan langsung: Customer User
  TANPA permission `document.*` sama sekali berhasil upload/list/download
  dokumen miliknya sendiri, dan ditolak (403) untuk dokumen milik
  Customer lain; entityType tanpa resolver terdaftar (`demo_transaction`)
  tetap memakai permission Tenant-wide persis seperti Checkpoint 0E,
  dibuktikan lewat regression test khusus.
- **Customer Data Scope** (ADR-0011, dimensi `customer` baru) — dibuktikan
  konvergen dengan Organization Unit scope hierarkis (ADR-0009): Supervisor
  scoped ke Region (ancestor) menjangkau Customer yang dimiliki Site
  (descendant), tapi tidak menjangkau Customer milik Organization Unit
  sibling.
- **Migration 1A tervalidasi round-trip** (up -> down -> up) dari database
  kosong terpisah — jumlah tabel kembali persis ke titik awal.
- Full regression Phase 0 (45 test) dijalankan ulang tanpa perubahan —
  0 regresi.

## Item yang SUDAH DISELESAIKAN di Checkpoint 1B (bukti singkat)

- **`GET /customers` sekarang difilter Data Scope per baris** —
  `CustomerService.listForTenant` memfilter lewat
  `isCustomerContextScopeCoveredByAssignments` (varian batch, satu query
  assignment, bukan N+1), short-circuit untuk `scope_type='tenant'`.
  Menyelesaikan item Technical Debt #10 di atas.
- **Generic Customer Complaint Engine** (ADR-0013) — dibuktikan langsung:
  seluruh Complaint Lifecycle (Draft s/d Closed, plus Reject/Cancel/
  Reopen/Escalate) berjalan tanpa satu baris state-machine di
  `ComplaintService`; mengubah actionCode Transition demo hanya butuh
  perubahan data Tenant Configuration.
- **Reopen generik untuk Instance terminal** (`WorkflowService.
  reopenInstance`) — dibuktikan: Complaint Closed berhasil di-reopen ke
  Step non-terminal oleh aktor berwenang, ditolak untuk aktor tidak
  berwenang (403) dan untuk Complaint yang masih in_progress (409).
- **Trusted-caller read/numbering** (`getInstanceForEntityOwner`,
  `generateNumberForTenant`) — dibuktikan: Customer User dan internal
  Handler bekerja penuh di Complaint mereka sendiri TANPA memegang
  `workflow.instance.read` atau `config.manage`.
- **Resolver Entity Authorization `entityType='complaint'`** (pola
  ADR-0012 dipakai ulang) — dibuktikan: evidence/attachment Complaint
  berhasil diunggah/dibaca tanpa permission `document.*` terpisah.
- **Condition-based dynamic routing** untuk Complaint (severity=critical)
  — dibuktikan: Complaint critical di-assign langsung ke role tenant-wide,
  skip role Site-scoped default.
- **SLA Escalation untuk Complaint** — dibuktikan lewat Scheduler sweep
  yang sudah ada sejak 0D/0E, tanpa kode Scheduler baru; event
  `workflow.escalated` diterjemahkan jadi `complaint.escalated` lewat
  satu subscriber translation, tanpa mengubah Workflow Engine.
- Full regression Phase 0 + 1A (61 test) dijalankan ulang tanpa
  perubahan — 0 regresi; total suite setelah 1B: 77/77 lulus.
- Migration 1B tervalidasi round-trip (up -> down -> up) dari database
  kosong terpisah — jumlah tabel kembali persis ke titik awal (47 -> 48
  -> 47 -> 48).

---

## Phase 1C — Complaint Experience Layer (Checkpoint 1C.1–1C.8) — Consolidated

**Diperbarui:** 2026-08-19 (Checkpoint 1C.8 — Regression & Stabilization / Phase 1C Closure).
Konsolidasi seluruh gap yang tercatat sepanjang 1C.1–1C.7, diklasifikasikan
per instruksi Founder 1C.8 (§40/§41). Item yang sudah selesai ditandai.

### MUST FIX BEFORE 1D
- **(tidak ada.)** Verifikasi 1C.8 tidak menemukan security vulnerability yang
  applicable pada runtime, cross-tenant leakage, kegagalan authorization,
  primary flow rusak, migration non-deterministic, kegagalan bootstrap fresh
  environment, korupsi data, crash reproducible, atau kebocoran data sensitif
  via PWA cache. (Definisi MUST-FIX §42.)

### SHOULD FIX LATER
- **Operational queue N+1**: `ComplaintService.listOperationalQueue` meng-enrich
  per-complaint (getEntityStatus) — aman pada skala demo/pilot; optimisasi =
  single SQL projection (Management dashboard sudah aggregate SQL). Tanpa
  evidence bottleneck, ditunda (§36).
- **Friendly names**: operational/verification timeline menampilkan actor sebagai
  truncated userId; queue/detail belum me-resolve nama site/service (handler tak
  punya org-unit/user read). Dashboard sudah me-resolve via SQL join.
- **PNG icons 192/512** untuk installability penuh lintas-browser (SVG neutral
  icon sudah ada; deployment-readiness item).
- **react-router-dom (moderate advisory)**: open-redirect via backslash di
  Link/useNavigate + SSR deserializeErrors — TIDAK applicable pada pemakaian
  saat ini (target navigasi internal literal; SPA client-only tanpa SSR).
  Kandidat targeted patch update (6.x) — bukan blocker (§34).
- **Deterministic demo permission**: fresh seed sudah memberi
  `complaint.dashboard.read` ke COMPLAINT_MANAGER; dev DB lama perlu
  `npm run sync-permissions` / re-seed (bukan migration khusus, §25).

### DEFERRED PRODUCT CAPABILITY
- **Customer Satisfaction** → Checkpoint 1D (Generic Survey & Assessment) + 1E
  (Survey-to-Action). Tidak ada placeholder/fake metric.
- **Structured Root Cause taxonomy**: `rootCause` tetap free-text; dashboard
  tidak mengklaim structured RCA analytics.
- **Multidimensional SLA** (severity×category×customer) + business/holiday
  calendar: SLA tetap per-Workflow-Step.
- **Workflow version-authoring UI**: Complaint config menampilkan lifecycle
  read-only; authoring tetap via Workflow Engine API (versioning).
- **Numbering pattern edit & Notification template edit**: Core saat ini
  create-only → admin surface read-only untuk keduanya (butuh endpoint update
  generic di Config/Notification Core bila akan disurface).
- **QA return/rework transition**: tergantung konfigurasi Workflow (bukan kode);
  availableActions akan memunculkannya bila tenant mengonfigurasi transisi.
- **Management KPI "Critical"**: bergantung pada canonical reference-data code
  `critical` (katalog severity belum punya flag/ranking). Kandidat future
  client configuration (severity ranking/is_critical). Didokumentasikan (§17).
- **Tenant timezone**: "Submitted today" memakai konvensi timestamp DB/server;
  model timezone per-tenant belum ada.

### BUSINESS DECISION REQUIRED
- **Customer-set Priority**: customer saat ini dapat memilih priority karena
  model/API existing. Bukan defect; perlu review kebijakan bisnis apakah
  priority seharusnya field triage internal (§18).
- **Structured Root Cause taxonomy** (bila dibutuhkan): perlu Founder Decision
  terpisah sebelum menambah schema/klasifikasi.

### RESOLVED di 1C.8
- **Real-browser PWA verification**: Chromium terinstal; SW ter-register + aktif
  (scope `/`), cache `abixell-shell-v1` berisi 3 static asset, `/api` TIDAK
  pernah di-cache (apiCached=0), offline shell render, online recovery OK.
- **e2e/smoke.mjs**: dijalankan hijau di real Chromium (shell/persona nav,
  responsive no-overflow 390/768/1280, manifest valid, SW support). Selektor
  step-2 diperbaiki (cocok banyak elemen) — perbaikan test, bukan product.

---

## Phase 1D — Survey & Assessment Engine (Checkpoint 1D.1) — Deferred

**Diperbarui:** 2026-08-19 (1D.1 Survey Engine Core). Backend vertical slice
selesai; berikut kapabilitas yang sengaja ditunda (bukan bug/blocker).

### SHOULD FIX LATER
- **Survey frontend** (admin authoring + respondent form) — 1D.1 backend-only.
- **Draft-answer save** sudah ada (explicit save); autosave/offline tidak.

### DEFERRED PRODUCT CAPABILITY
- customer_contact & external/anonymous/public-token respondent (kolom
  schema-ready; flow + security review = future).
- Conditional/branching logic, matrix/grid questions, file-upload question
  type, full multi-language localization.
- Weighted / section / percentage / NPS scoring engine.
- Cross-survey analytics / benchmarking / AI (sentiment/summary/generation).
- Additional question types (short_text/multiple_choice/numeric/yes_no/date)
  — enum ready, behavior not implemented.

### BUSINESS DECISION / 1E
- **Complaint→Survey trigger & Survey-to-Action** (auto-send on close, low-
  rating reopen/corrective) = Checkpoint 1E. 1D.1 only provides the generic
  engine + context seam + domain events.
- Customer Satisfaction is now buildable ON this engine (configuration), not a
  Complaint column — wiring it to Complaint is 1E.

---

## Phase 1D — Konsolidasi Debt (Checkpoint 1D.3 — Stabilization & Closure)

**Diperbarui:** 2026-08-19 (1D.3). Checkpoint regresi/validasi/penutupan —
BUKAN checkpoint fitur. Seluruh gap Survey Engine dari 1D.1/1D.2
dikonsolidasikan ulang ke empat kategori sesuai instruksi Founder §37.
Hasil validasi 1D.3: lifecycle/versioning/immutability/scoring/atomicity/
tenant-isolation/result-authorization/context-safety terverifikasi (regresi
132/132 hijau, termasuk 3 test stabilisasi baru §14–§16; acceptance real-
browser admin+respondent + draft-persistence hijau). **Tidak ditemukan defect
kategori MUST FIX** (tenant leakage / unauthorized access / published mutation
/ scoring corruption / non-atomic submit / result leakage / migration-bootstrap
/ broken flow / PWA business-data caching / crash) — semuanya lolos.

### MUST FIX BEFORE 1E
- Tidak ada. Semua kriteria MUST-FIX Founder lolos verifikasi di 1D.3.

### SHOULD FIX LATER
- **Shared date-format util**: halaman Survey (`SurveyDetailPage`,
  `MySurveyDetailPage`, dll.) meng-import util tanggal dari
  `../complaints/format` (`formatDateShort`). Bukan coupling domain (murni
  formatting UI, tanpa logika Complaint), tapi lokasi import lintas-fitur.
  Ekstrak ke `src/lib/format.ts` bersama saat ada refactor UI util. Tidak
  memblokir 1E.
- **Autosave / offline draft** untuk respondent: saat ini explicit "Save
  draft" (persist server-side; diverifikasi bertahan lintas reload). Autosave
  dan offline-queue tetap ditunda (di luar scope 1D, dilarang di 1D.3).

### DEFERRED PRODUCT CAPABILITY
- Seluruh item DEFERRED dari section 1D.1 tetap berlaku tanpa perubahan:
  customer_contact/anonymous/public-token respondent; conditional/matrix/
  file-upload question types; weighted/section/percentage/NPS scoring;
  cross-survey analytics/benchmarking/AI; question type tambahan
  (short_text/multiple_choice/numeric/yes_no/date). Ditegaskan ulang sebagai
  dilarang eksplisit di scope 1D.3 — tidak dibangun.

### BUSINESS DECISION REQUIRED
- **Complaint→Survey trigger & Survey-to-Action** = Checkpoint 1E (rekomendasi
  next). 1D hanya menyediakan generic engine + context seam + domain events.

### 1E READINESS (didokumentasikan, TIDAK dibangun di 1D.3)
- **Context entity seam**: `survey_assignments.context_entity_type` +
  `context_entity_id` sudah ada; authorization lewat
  `EntityAuthorizationResolverRegistry` (ADR-0012). 1E cukup mengaitkan
  `context_entity_type='complaint'` tanpa perubahan schema.
- **Domain events**: `survey.assigned` + `survey.submitted` sudah dipublikasikan
  ke EventBus (`domain_events`) — seam trigger untuk Survey-to-Action.
- **Immutable score**: skor final tersimpan immutable saat submit (atomic
  finalize); tersedia untuk aturan 1E (mis. low-rating → corrective) tanpa
  re-compute.

---

## Phase 1E — Survey-to-Action (Checkpoint 1E.1 — Trigger/Assignment half)

**Diperbarui:** 2026-08-20 (1E.1). Complaint `customer_confirmed` → Survey
Assignment. Survey Submitted → Action = 1E.2 (belum dibangun).

### MUST FIX BEFORE 1E.2
- Tidak ada. Semua invariant (idempotency DB, one-per-lifetime, tenant
  isolation, recipient authorization, trusted-caller integrity, no-crash/
  no-rollback) terverifikasi (140/140).

### SHOULD FIX LATER
- **Orphan assignment pada race lifetime (rare)**: bila dua event confirm
  untuk complaint yang sama lolos pre-check bersamaan, partial-unique
  menolak UPDATE `assigned` kedua → execution jadi `skipped_already_assigned`
  tetapi Survey Assignment yang sempat dibuat menjadi orphan. Praktis
  mustahil (confirm adalah satu aksi manusia per complaint); didokumentasikan
  sebagai trade-off model synchronous best-effort (FD-1E §16/§30).
- **Reliable async reconciliation / outbox**: EventBus in-process fire-once &
  menelan exception → bila proses mati SEBELUM execution row tertulis,
  kegagalan hanya tertangkap `onError` log. Reconciliation worker = future
  Platform improvement (FD-1E §16), sengaja tidak dibangun di 1E.1.
- **Admin config UI + `survey.integration.configure` permission**: belum ada
  (policy via service seam/test/seed). Ditambah saat ada kebutuhan human
  config nyata (hindari dead permission, FD-1E §20).

### DEFERRED PRODUCT CAPABILITY / 1E.2
- Konsumsi `survey.submitted`, outcome/threshold evaluation (question-code
  vs total-score), target action (reopen / escalate / management attention),
  retry framework, per-closure-cycle re-survey, sumber non-complaint.
  Semua = 1E.2+ (dilarang di 1E.1). No automatic reopen di 1E.1.

### BUSINESS DECISION REQUIRED (untuk 1E.2)
- Outcome model + first target action (lihat proposal 1E §18/§21/§41) —
  perlu Founder Decision saat membuka 1E.2. **RESOLVED**: FD-1E-05
  (question-code threshold) + FD-1E-06 (management attention).

---

## Phase 1E — Konsolidasi Penutupan (1E.2 + 1E.3, Phase 1E CLOSED)

**Diperbarui:** 2026-08-20. Survey-to-Action lengkap: trigger→assignment
(1E.1) + submitted→outcome→management attention (1E.2), plus stabilisasi/
closure (1E.3). Regression **150/150**; live acceptance hijau; migration
down/up terverifikasi; 58 tables (1E.2 additive columns saja).

### MUST FIX BEFORE 1F
- **Tidak ada.** Tidak ditemukan data leakage, duplicate action, tenant
  bypass, broken idempotency, evaluasi salah, rollback Survey submission
  akibat integrasi, execution state korup, masalah migration, atau regresi
  kritis. Semua gate §79 lolos.

### SHOULD FIX LATER
- **Reliable async reconciliation / outbox** (dibawa dari 1E.1): EventBus
  in-process fire-once + menelan exception. Bila proses mati SEBELUM
  execution/outcome tertulis, kegagalan hanya tertangkap log `onError`.
  Reconciliation worker = future Platform improvement (FD-1E §16/§35).
- **Orphan assignment pada race lifetime (rare)** — tetap seperti 1E.1.
- **Admin config UI + `survey.integration.configure`**: policy masih via
  seed/config bootstrap (FD-1E §30). Permission sengaja BELUM dibuat agar
  tidak jadi dead permission (FD-1E §21).
- **Management Action Center view untuk Survey Attention** (FD-1E §46,
  OPTIONAL): tidak dibangun — notifikasi in-app sudah menjadi surface yang
  ada. Bisa ditambah additive bila terbukti berguna operasional.
- **Shared date formatter** (dibawa dari 1D.3, belum berubah).

### DEFERRED PRODUCT CAPABILITY (butuh Founder Decision terpisah)
- **Automatic Complaint Reopen** dari hasil survey — DILARANG di Phase 1E,
  tetap Advanced Capability.
- Escalation / generic follow-up / target action tambahan; retry framework;
  per-closure-cycle re-survey; source di luar Complaint; anonymous /
  customer_contact respondent; survey analytics / NPS / AI sentiment;
  multi-condition rule engine atau DSL.

### CATATAN BLUEPRINT
Core Survey-to-Action Phase 1E berhenti pada
`configurable outcome → management attention`. Mutasi domain otomatis
bukan bagian Core 1E (penting untuk audit Product Core vs Advanced
setelah Phase 1F).

---

## Post-Phase-1 Audit — Debt Reclassification (2026-08-20)

Global audit reclassification. Existing debt is **preserved**, not deleted;
this section re-sorts it into the categories approved for the audit and maps
each item to a Roadmap Unit so it is scheduled rather than merely noted.

### MUST FIX BEFORE PILOT (Platform Hardening — Roadmap Phase H — DELIVERED)
| Item | Unit | Note |
|---|---|---|
| No CI/CD pipeline (carried since 0A) | PH-1 | **DELIVERED**: `.github/workflows/ci.yml` and `npm run validate` composite runner. |
| CORS permissive (`origin: true`) + provisional rate limit | PH-2 | **DELIVERED**: `CORS_ORIGINS` parse/allowlist, configurable rate limits, `@fastify/helmet` policy review. |
| Operational queue N+1 enrichment | PH-5 | **DELIVERED**: Batched SQL customer query, batched workflow instance/assignment status projection, cached RBAC evaluation. |
| `react-router-dom` moderate advisory | PH-6 | **DELIVERED**: Upgraded `react-router-dom` to `^7.18.2`; `npm audit --omit=dev` 0 vulnerabilities. |
| PWA PNG icons 192/512 | PH-7 | **DELIVERED**: Generated standard `icon-192.png` and `icon-512.png`, manifest alignment, `validate:pwa` script. |

### MUST FIX BEFORE PRODUCTION (Roadmap Phase H2)
| Item | Unit |
|---|---|
| Backup / restore / DR runbook | PH-3 |
| Deployment & environment provisioning automation | PH-4 |
| Integration reconciliation / outbox worker (EventBus is in-process, fire-once, swallows subscriber errors) | PH-8 |

### SHOULD FIX LATER
- Shared date-format util (survey pages import from `../complaints/format`).
- Lifetime-race orphan survey assignment (rare; documented in 1E).
- Admin configuration UI for survey integration policies + `survey.integration.configure` permission (intentionally not created to avoid a dead permission).
- Friendly actor names in operational/verification timelines.
- Tenant timezone handling for "today" conventions.
- Autosave / offline draft for survey respondents.

### CANDIDATE ADVANCED CAPABILITY (input to future roadmap waves)
Multidimensional SLA · structured RCA taxonomy + advanced CAPA · recurring-problem
detection & service analytics · automatic domain mutation from feedback (auto-reopen,
predictive escalation) · survey conditional/matrix questions · weighted/section/NPS
scoring · anonymous/public-token distribution · multi-language surveys · survey
analytics & benchmarking · workflow version-authoring UI · AI/sentiment.

### CANDIDATE CLIENT CONFIGURATION
Numbering pattern editing · notification template editing · QA return/rework
transition · management KPI thresholds ("Critical" reference-data code) ·
customer-set priority policy · survey thresholds · integration policy.

### CANDIDATE CLIENT EXTENSION
Client-specific complaint intake channels (proprietary portal / WA gateway) ·
client ERP / accounting posting bridges · biometric or attendance devices ·
regulator reporting interfaces. Tracked **outside** the product roadmap denominator.

### BUSINESS DECISION REQUIRED
Structured Root Cause taxonomy adoption · customer-set priority policy ·
outcome/action expansion beyond management attention (automatic reopen) ·
disposition of the untracked `docs/00-prd/` corpus.

### MUST FIX BEFORE GLOBAL AUDIT
None outstanding — this audit is complete. No security, tenant-isolation, data-integrity,
or regression blocker was found (150/150 PASS at `b7b6d64`).

---

## Post-Audit Restructure — Architecture Debt (2026-08-20)

### ARCHITECTURE CLEANUP (new category)
| Item | Detail | Priority |
|---|---|---|
| **Existing source is layer-first, target is module-first** | `apps/api/src/{domain,application,infrastructure,interfaces}/*` predates the frozen target (`modules/<module>/core\|advanced\|packs`, `orchestration/`, `core/`, `shared/`). Deferred deliberately: ~309 import-path rewrites across 73 files for zero behavioural gain. Migrate module-by-module opportunistically, never as a big bang. | SHOULD FIX LATER |
| **Survey-to-Action lives at `application/survey-integration/`** | Correct behaviour, correct boundary, non-target folder. Belongs at `orchestration/survey-to-action/`. Move when the orchestration layer is first created for Phase 2+. | SHOULD FIX LATER |
| **`docs/decision-log.md`, `docs/adr/`, `docs/implementation-notes.md` not in the ideal doc tree** | Kept at `docs/` root because 15 source-code comments cite them by path. Relocate together with a comment-update pass. | FUTURE CLEANUP |
| **Shared date-format util** | Survey pages import from `../complaints/format`. Under the target rules this belongs in `shared/`. | SHOULD FIX LATER |

### DOCUMENTATION GOVERNANCE (resolved)
| Item | Resolution |
|---|---|
| Source-of-truth ambiguity (IGSEP corpus self-declared SSOT) | Resolved — `docs/canonical/documentation-map.md` defines authority + reading order |
| Untracked PRD corpus | Resolved — preserved at `docs/history/igsep/` with a legacy README |
| Founding decisions outside version control | Resolved — copied to `docs/history/pre-phase-0/` (originals untouched) |
| No canonical requirements | Resolved — `docs/prd/abixell-one/` with stable requirement IDs + traceability |
| Stale README | Resolved |

### OUTSTANDING (unchanged by this execution)
`Business-Discovery-Workshop-Kit.docx` remains uncommitted at `docs/00-prd/` pending a Founder decision on versioning binaries. Platform Hardening items (CI/CD, CORS, rate limit, DR, deployment automation, reconciliation worker, advisories, PWA icons) remain as previously classified — none were touched.

---

## Phase 2 — Service Operations Core (2026-08-20)

### MUST FIX BEFORE PHASE 2 CLOSURE
- None. No defect met the closure-blocking bar.

### RESOLVED in Phase 2
- **Shared date formatter** — module-neutral helpers extracted to
  `apps/web/src/shared/format.ts`; Complaint re-exports them (no behaviour change).

### SHOULD FIX LATER (new)
| Item | Detail |
|---|---|
| **Assignment uses a raw user id field** | The Work Order detail screen asks for an assignee user id rather than offering a people picker. Functional and correctly authorised, but poor operator UX. A picker over the existing `/users` endpoint is the natural fix. |
| **Work Request has no UI** | Requests are fully supported by the API (create, cancel, convert) and covered by tests, but the Phase 2 UI starts at the Work Order. Client-side intake screens are the natural next increment of OPS.4. |
| **Checklist checkbox has no optimistic state** | The control is fully server-authoritative, so the tick appears only after the reload completes. Correct, but momentarily laggy on a slow field connection. |
| **`listWorkOrders` composes status per row** | One Workflow status lookup per row, mirroring the existing Complaint queue pattern. Not pathological at pilot volume; revisit together with the existing operational-queue N+1 item (PH-5). |

### DEFERRED ADVANCED (unchanged, confirmed)
Recurring service generation, advanced scheduling, route planning,
productivity and manpower optimisation, forecasting, offline field execution.

### CLIENT CONFIGURATION (confirmed)
Service types, checklists, work lifecycle definition, SLA, assignment rules,
scheduling rules, reference data (`service_category`, `work_priority`),
numbering patterns, notification templates.

### CLIENT EXTENSION CANDIDATES (confirmed)
Client device/IoT integration, site access systems, client-specific
operational calculations. Excluded from the product denominator.

### PLATFORM HARDENING (unchanged)
PH-1 through PH-8 untouched by Phase 2, as instructed. The Pilot gate remains
blocked on Phase H, not on business capability.

---

## Phase 3 — Workforce / HR Core (2026-08-20)

### MUST FIX BEFORE PHASE 3 CLOSURE
- None. The one defect found (calendar dates shifting by a day through UTC
  conversion) was fixed within the phase and is covered by tests.

### SHOULD FIX LATER (new)
| Item | Detail |
|---|---|
| **User-account link has no UI** | The API supports linking/unlinking an employee to a platform user (with all guards and tests), but the employee detail screen only displays whether an account is linked. A picker over the existing `/users` endpoint is the natural next increment. |
| **Employment type is a free-text field in the UI** | The reference data type `employment_type` is registered, but the create form does not yet render a picker from it. Values are still tenant configuration; only the input control is missing. |
| **Position administration has no screen** | Positions are created through the API/seed. The employee forms consume them correctly, but maintaining the catalogue needs an admin surface. |
| **Employee list search uses ILIKE** | Adequate at pilot scale and index-friendly enough for now; revisit only if a client's workforce size makes it measurably slow. Deliberately no search infrastructure was introduced. |

### DEFERRED ADVANCED (confirmed, none implemented)
Attendance · shift & roster · leave · overtime · payroll (including statutory
contributions and income-tax withholding) · recruitment · performance ·
competency · training · career · manpower planning · workforce optimisation.

### CLIENT CONFIGURATION (confirmed)
Employment types (reference data) · positions · organisation structure ·
employee numbering pattern · document types · terminology.

### CLIENT EXTENSION CANDIDATES (confirmed)
Biometric/attendance devices · payroll bank files · government reporting
interfaces. Excluded from the product denominator.

### PLATFORM HARDENING (unchanged)
PH-1 through PH-8 untouched by Phase 3. The Pilot gate remains blocked on
Phase H, not on business capability.

---

## Phase 4 — Supply Chain Core (2026-08-20)

### MUST FIX BEFORE PHASE 4 CLOSURE
- None. The transactional invariants were verified explicitly: no corrupted
  balance, no duplicate stock effect, no cross-tenant reference, no invalid
  lifecycle mutation, no silent edit of an issued order, no orphan line.

### SHOULD FIX LATER (new)
| Item | Detail |
|---|---|
| **Purchase request supports one line in the UI** | The API accepts many lines and is tested with them; the Purchasing screen currently raises a single-line request. Multi-line entry is the natural next increment of SCM.5. |
| **Purchase order lines cannot be priced from the UI** | The API stores `unitPrice` per line (covered by tests); the screen does not yet expose a price field when creating an order from a request. |
| **Stock movement site selection is not exposed in the UI** | The API supports per-site movements and the tests cover both tenant-level and per-site balances; the screen currently posts tenant-level movements only. |
| **Item on-hand is summed client-side across locations** | The list adds up the balances the API already returned. Correct at pilot volume; a server-side aggregate would be better once an item spans many locations. |
| **No purchase document upload surface** | Document Core resolvers for `purchase_request` and `purchase_order` are registered and authorised, but no upload control exists on the purchasing screen yet. |

### DEFERRED ADVANCED (confirmed, none implemented)
Multi-warehouse · bin location · batch/lot/serial · reservation · reorder
planning · transfers · stock opname · inventory valuation · FIFO/moving
average · landed cost · RFQ · tender · bid comparison · supplier
evaluation/scorecard · contract purchasing · spend analytics · demand
forecasting · MRP.

### CLIENT CONFIGURATION (confirmed)
Item categories · units of measure · supplier categories · stock locations
(sites) · purchase request approval workflow and thresholds · numbering
patterns.

### CLIENT EXTENSION CANDIDATES (confirmed)
Client e-procurement/e-catalog platforms · supplier EDI. Excluded from the
product denominator.

### PLATFORM HARDENING (unchanged)
PH-1 through PH-8 untouched by Phase 4. The Pilot gate remains blocked on
Phase H, not on business capability.

---

## Phase 5 — Asset Core (2026-08-20)

### MUST FIX BEFORE PHASE 5 CLOSURE
- None. The transactional invariants were verified explicitly, in the test
  suite and by a closure query over every asset the suite touched: asset
  version equals the highest applied movement sequence; current placement
  equals what that movement resolved to; terminal status and the retirement
  stamp move together; no half-written ledger row (an unapplied movement
  never claims a sequence, an applied one always does); a failed movement
  writes nothing; no duplicate asset identifier; no cross-tenant reference;
  retired history intact.

### SHOULD FIX LATER (new)
| Item | Detail |
|---|---|
| **Only one movement may await approval at a time** | Enforced in the service by reading the open movement and its Workflow status. The read-then-insert has a tiny benign race: two pending movements could be created, and each would still apply atomically and chain correctly. A partial unique index would close it, but "open" is derived from Workflow state, so it needs a stored closed-marker first. |
| **Asset category is free text in the UI** | The `asset_category` Reference Data type is registered by the migration; the register screen currently accepts a typed value rather than offering the tenant's catalogue. |
| **Movement reason is free text in the UI** | Same shape: the `asset_movement_reason` type exists; the movement form does not yet offer it as a picker. |
| **Bulk movement is not supported** | Moving twenty assets to a new site is twenty actions. The ledger and API model it correctly; a batch surface would be an AST.3 increment. |
| **Location catalogue is resolved per customer** | The web layer fetches sites and projects for every customer to build one picker, because no tenant-wide site list endpoint exists. Correct and bounded at pilot volume; a tenant-wide list belongs with `CUS.4`. |
| **No asset label/QR printing** | The physical tag is stored and searchable, but nothing generates a printable label. |

### DEFERRED ADVANCED (confirmed, none implemented)
Preventive maintenance scheduling · corrective maintenance · maintenance work
orders · maintenance planning · meter reading and usage-based triggers ·
spare-part consumption · downtime tracking · MTBF/MTTR and reliability ·
predictive maintenance · condition monitoring · IoT/telematics/GPS ·
depreciation · book value · capitalisation · fixed-asset accounting ·
disposal gain/loss.

### CLIENT CONFIGURATION (confirmed)
Asset categories · movement reasons · numbering/tagging pattern · movement
approval workflow (including whether one exists at all) · locations, via the
existing organisation / project / site hierarchy.

### CLIENT EXTENSION CANDIDATES (confirmed)
Client CMMS integrations · telematics and IoT sensor platforms. Excluded from
the product denominator.

### PLATFORM HARDENING (unchanged)
PH-1 through PH-8 untouched by Phase 5. The Pilot gate remains blocked on
Phase H, not on business capability.

---

## Phase 6 — Finance Core (2026-08-20)

### MUST FIX BEFORE PHASE 6 CLOSURE
- None. The money and integrity invariants were verified explicitly, in the
  test suite and by a closure query over every account and transaction the
  suite touched: each cached balance equals the sum of its applied ledger,
  no balance is negative, no transaction is half-applied (an applied stamp
  without an applied timestamp or vice versa), every amount is positive with
  exactly two decimal places, and every reversal mirrors its original in
  amount, account, currency, and opposite direction.

### SHOULD FIX LATER (new)
| Item | Detail |
|---|---|
| **Cashflow scope resolution reads the tenant's transactions to derive covered units** | For a user without tenant scope, the aggregate resolves which organisation units their Data Scope covers by listing transactions first. Correct and bounded at pilot volume, but it is a second query that a scope-aware SQL predicate could replace once RBAC exposes a "covered unit ids" projection. |
| **No transfer between own accounts** | Moving money from bank to petty cash is currently two transactions (expense + income) under a tenant-configured category. A first-class transfer would be a natural FIN.1 increment, and it must stay a pair of ledger rows rather than becoming a journal. |
| **Category is a flat catalog** | Reference Data has no parent/child, so category grouping in the cashflow breakdown is flat. Adequate for operational cash; grouping belongs with Reporting (BC-11) or Finance Advanced. |
| **No recurring or scheduled transactions** | Rent and subscriptions are re-entered each period. Scheduler Core exists and could drive this later; it is not part of FIN-CORE-001…011. |
| **Evidence is listed but not previewed** | The detail page lists attached file names and uploads new ones; it does not render a thumbnail or inline preview of a receipt. |
| **Amount input has no locale-aware entry helper** | The field accepts `1250.75` with a dot decimal separator only. Deliberate for now — a locale-aware parser is exactly the kind of conversion that risks precision — but a client using comma decimals will notice. |

### DEFERRED ADVANCED (confirmed, none implemented)
Chart of accounts · double-entry · journals · general ledger · trial balance ·
accounts payable · accounts receivable · aging · budgeting · cost centres ·
commitments/encumbrance · bank reconciliation · statement import · tax
(PPN/VAT/PPh/withholding) · fixed-asset accounting · depreciation ·
consolidation · profit & loss · balance sheet · statutory cash-flow
statement · financial closing · fiscal period lock · multi-ledger · FX
conversion, revaluation, and gain/loss.

### CLIENT CONFIGURATION (confirmed)
Transaction categories · cash/bank accounts and their currencies · the
transaction approval workflow and its thresholds · numbering patterns ·
organisation/legal-entity placement of accounts.

### CLIENT EXTENSION CANDIDATES (confirmed)
Posting bridges to a client's accounting system · bank host-to-host
interfaces. Excluded from the product denominator.

### PLATFORM HARDENING (delivered)
PH-1, PH-2, PH-5, PH-6, and PH-7 delivered in Phase H (Pilot Hardening). The Pilot gate is satisfied; Phase H2 (PH-3, PH-4, PH-8) remains planned for Production gate.

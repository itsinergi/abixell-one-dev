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

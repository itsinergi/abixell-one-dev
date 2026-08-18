# Technical Debt Register — Phase 0 (Checkpoint 0A–0F) + Phase 1 Checkpoint 1A

**Tanggal disusun:** 2026-08-18 (Checkpoint 0F — Phase 0 Stabilization),
diperbarui 2026-08-18 (Checkpoint 1A — Document Scope & Customer
Experience Foundation)
**Cakupan:** Konsolidasi SELURUH gap yang tercatat eksplisit di
`docs/decision-log.md` dan `docs/implementation-notes.md` sepanjang
Checkpoint 0A–0F dan 1A, diklasifikasikan ulang menjadi empat kategori
sesuai instruksi Founder. Item yang sudah diselesaikan ditandai selesai,
bukan dihapus dari catatan — riwayat keputusan tetap utuh.

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

## BLOCKER sebelum Complaint/Survey (Checkpoint 1B/1D)

Tidak ada.

- Hierarchical Data Scope **SUDAH SELESAI** (ADR-0009, Checkpoint 0F) —
  prasyarat keras untuk role hierarkis (Regional Manager dsb.) yang akan
  dipakai Complaint/Survey.
- Document Service belum mengikuti Data Scope entity induk **SUDAH
  DISELESAIKAN di Checkpoint 1A** lewat pola Entity Authorization
  Resolver (ADR-0012) + Customer Data Scope (ADR-0011) — lihat "Item yang
  SUDAH DISELESAIKAN di Checkpoint 1A" di bawah. Complaint/Survey (1B/1D)
  tinggal mendaftarkan resolver `entityType='complaint'`/`'survey'` yang
  sama polanya dengan `'customer'`, bukan memutuskan mekanismenya dari
  nol.

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
   entity-entity ini juga. *(Asal: 1A.)*
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
10. **`GET /customers` belum difilter per Data Scope** — Tenant-permission-
    gated saja (`customer.read`), sama seperti presedan
    `GET /organization-units`/`GET /legal-entities` 0B. Bukan bug — path
    single-entity (`getAuthorized`) sudah difilter Data Scope dan itulah
    path yang benar-benar dilalui Customer User; penyempitan listing
    itu sendiri direncanakan sebagai bagian Checkpoint 1C saat Customer
    Portal role kurasi membutuhkannya. *(Asal: 1A.)*
11. **Resolver Entity Authorization baru terdaftar untuk `entityType='customer'`** —
    `contract`/`project`/`site` belum punya resolver sendiri karena belum
    ada modul yang melampirkan dokumen langsung ke entity tsb (bukan
    gap tersembunyi — mekanismenya sudah generik dan siap dipakai kapan
    pun dibutuhkan, tinggal registrasi satu baris). *(Asal: 1A.)*

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

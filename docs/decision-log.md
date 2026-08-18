# Decision Log

Living log of engineering decisions made during implementation. Founder
Decisions (business/architecture-binding) live in the blueprint documents;
this log is for implementation-level decisions taken under the "small
decisions use a safe default and document" rule, plus anything that
deviates from a blueprint recommendation.

## 2026-08-18 — Checkpoint 0A

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Monorepo: npm workspaces (`apps/api`, `apps/web`, `packages/contracts`) | Simplest tool that satisfies "full-stack TypeScript consistency"; avoids adding Turborepo/Nx before there's a reason to (anti-overengineering) | `09-Technical-Stack-Infrastructure-Recommendation.md` |
| 2 | HTTP framework: Fastify | Native JSON Schema validation aligns with the Configuration Engine's schema-contract approach (doc 05); strong TS support; OpenAPI-ready | ADR-0001 |
| 3 | DB access: `pg` + `node-pg-migrate` instead of Prisma | Prisma's `generate`/`migrate` require downloading a native engine binary from `binaries.prisma.sh`, which is blocked by this implementation workspace's network allowlist (`403 Forbidden`). Switched to pure-JS `pg` + `node-pg-migrate` — no binary fetch, full raw-SQL control, straightforward path to future RLS policies | ADR-0002 |
| 4 | Frontend: React + Vite + TypeScript + Tailwind | Per doc 09 recommendation; Tailwind chosen over a component-kit to keep the Design System (doc 08) unopinionated at this stage | ADR (none yet — revisit at Checkpoint 0C when Design System tokens are defined) |
| 5 | Local Postgres for smoke-testing: native `postgresql` service (Docker daemon not available in this sandboxed workspace) | `docker` CLI is present but no daemon is running in this cloud implementation environment; used the pre-installed PostgreSQL 16 service directly to prove connectivity end-to-end. `infra/postgres/docker-compose.yml` is still the source of truth for real dev/CI environments where Docker is available | — |

## Open items carried to later checkpoints (dari Checkpoint 0A)

- Design System token decisions (colors, spacing scale) — Checkpoint 0C+, once Configuration Engine exists to source Branding Configuration from.
- RLS activation strategy — deferred per ADR-0002, revisit if/when a non-dedicated (shared-hosting) tenant mode is ever pursued (would require Founder Decision, per stop conditions).
- CI/CD pipeline (GitHub Actions or equivalent) — not set up yet; Checkpoint 0A proved local build/lint/test/migrate work, CI wiring is a 0B/0C task once a remote git host is chosen.

## 2026-08-18 — Checkpoint 0B

Ringkasan keputusan implementasi pada Checkpoint 0B (Identity & Organization Vertical Slice). Detail lengkap ada di `docs/implementation-notes.md`.

| # | Keputusan | Alasan | Referensi |
|---|---|---|---|
| 1 | Tenant creation via platform-bootstrap key (`x-bootstrap-key`), bukan RBAC | RBAC butuh User yang butuh Tenant — Tenant pertama dibuat sebelum User/Role apa pun ada di deployment tsb. Bukan celah keamanan umum, hanya berlaku untuk `POST /tenants` | ADR-0004 |
| 2 | Data Scope Checkpoint 0B bersifat exact-match saja (`tenant` atau satu `organization_unit` tertentu), belum rekursif ke descendant | Menjaga vertical slice pertama dapat dibuktikan dalam waktu wajar; tidak mengubah skema data, hanya query yang perlu diperluas nanti | ADR-0005 |
| 3 | Permission TIDAK disematkan di JWT — selalu di-fetch ulang dari database per request | Mencegah perubahan role/permission jadi basi (stale) selama access token (15 menit) belum expired; sesuai prinsip "backend benar-benar melakukan authorization" | `src/application/rbac/rbac.service.ts` |
| 4 | Password hashing pakai `bcryptjs` (pure JS), bukan `bcrypt` native | Konsisten dengan pelajaran dari Checkpoint 0A (Prisma) — hindari dependency yang butuh native binary compile, aman di lingkungan mana pun | — |
| 5 | Role assignment (User + Role + Data Scope) dibuat dalam satu langkah saat `POST /users`, bukan endpoint terpisah | Permission catalog 0B belum punya permission khusus "assign role"; menyatukan operasi ini menghindari menambah permission baru yang belum diminta blueprint | `src/application/identity/user.service.ts` |
| 6 | Perbaikan FK `user_role_assignments.scope_organization_unit_id` menjadi `ON DELETE CASCADE` | Ditemukan saat menulis cleanup test integrasi: hapus Tenant gagal karena FK constraint. Hanya relevan untuk skenario hapus-tenant-penuh (deprovisioning), bukan alur bisnis normal 0B | Migration `1755600100000` |

### Item terbuka yang dibawa ke checkpoint berikutnya

- Data Scope rekursif (descendant-aware) — lihat ADR-0005.
- Permission "assign role" terpisah dari `user.create` — saat ini digabung, cukup untuk 0B tapi perlu dipisah bila Checkpoint 0C/0D butuh workflow assign-role independen (mis. mengubah role user yang sudah ada).
- Endpoint update/delete (soft delete) untuk Tenant/Legal Entity/Organization Unit/User belum ada — 0B hanya membuktikan create+read sesuai target minimal yang diminta.
- Penyimpanan token di frontend (in-memory only, hilang saat refresh halaman) — keputusan strategi persistensi token belum diambil, sengaja didokumentasikan sebagai gap, bukan diasumsikan.
- CI/CD masih belum ada (carry-over dari 0A).

## 2026-08-18 — Checkpoint 0C

Ringkasan keputusan implementasi pada Checkpoint 0C (Configuration &
Metadata Foundation). Detail lengkap ada di `docs/implementation-notes.md`.

| # | Keputusan | Alasan | Referensi |
|---|---|---|---|
| 1 | Configuration Scope untuk Feature Flags disimpan sebagai satu baris per scope assignment (`tenant` atau `organization_unit`), bukan satu baris per flag, dengan dua partial unique index terpisah | Diperlukan agar satu flag bisa punya nilai tenant-wide DAN override per Organization Unit sekaligus; partial index (bukan unique constraint biasa) sengaja dipilih untuk menghindari kelas bug NULL-tidak-sama-dengan-NULL yang ditemukan di Checkpoint 0B | ADR-0006 |
| 2 | Schema Registry (`metadata_registry`) divalidasi sungguhan pakai Ajv (compiled + cache per area/key), bukan hanya dokumentasi/konvensi | Membuat "metadata sebagai sumber kebenaran validasi" (dok 05) jadi mekanisme nyata — nilai Tenant Configuration yang gagal validasi ditolak dengan 400, bukan diterima lalu gagal diam-diam di lapisan lain | `src/application/configuration/schema-registry-validator.ts` |
| 3 | Numbering sequence memakai satu `UPDATE ... RETURNING` atomik untuk increment, tanpa row locking eksplisit | PostgreSQL menjamin atomicity untuk single-statement UPDATE; menghindari kompleksitas `SELECT ... FOR UPDATE` + transaksi eksplisit yang belum diperlukan pada skala Phase 0 | `configuration.repository.pg.ts` → `incrementNumberingSequence` |
| 4 | Terminology override Checkpoint 0C bersifat tenant-scope saja, belum per-Organization-Unit | Konsisten dengan target minimal 0C (membuktikan mekanisme override ada dan divalidasi), pola partial-unique-index yang sama (ADR-0006) bisa dipakai langsung bila Organization-Unit-level Terminology override diminta nanti — bukan re-desain skema | ADR-0006 (konsekuensi) |
| 5 | Permission baru (`config.read`, `config.manage`) ditambahkan ke katalog global lewat migration, dan `demo-gs` tenant di-reseed (delete + seed ulang) agar role ADMIN yang sudah ada otomatis memilikinya | Seed script bersifat idempotent (skip bila tenant sudah ada) sehingga permission baru tidak otomatis "menempel" ke role lama; reseed adalah cara paling sederhana untuk lingkungan demo/dev, BUKAN pola migrasi permission untuk tenant produksi yang sudah live (lihat Risk Note) | `apps/api/scripts/seed.ts` |

### Item terbuka yang dibawa ke checkpoint berikutnya

- Terminology override baru tenant-scope; Organization-Unit-scope Terminology belum diimplementasikan (lihat ADR-0006).
- Belum ada mekanisme migrasi permission otomatis untuk tenant yang SUDAH hidup di produksi saat permission baru ditambahkan lewat migration — reseed hanya valid untuk lingkungan demo/dev yang boleh dihapus-ulang.
- Reference Data dan Numbering Sequence belum punya endpoint update/deactivate — 0C hanya membuktikan create+read+generate sesuai target minimal.
- Frontend Configuration panel belum melalui smoke test visual browser sungguhan (lingkungan implementasi tidak punya akses browser ke dev server container) — hanya diverifikasi lewat `typecheck`, `lint`, `build` sukses dan pemanggilan endpoint API yang sama persis sudah diverifikasi lewat curl.
- CI/CD masih belum ada (carry-over dari 0A/0B).

## 2026-08-18 — Checkpoint 0D

Ringkasan keputusan implementasi pada Checkpoint 0D (Workflow & Approval
Engine Foundation). Detail lengkap ada di `docs/implementation-notes.md`.

| # | Keputusan | Alasan | Referensi |
|---|---|---|---|
| 1 | Workflow Assignment (tipe `role`) di-route ke "queue" Role+Organization Unit Scope, bukan ke satu user yang sudah dipilih di muka | Konsisten dengan model Role + Data Scope yang sudah dibangun sejak 0B; siapa pun pemegang role tsb dalam scope yang cocok berhak bertindak — sesuai contoh "Assign ke: Site Supervisor" di dok 04 | ADR-0007 |
| 2 | Tipe assignment kedua, `specific_user`, disediakan untuk kasus assign-ke-individu tertentu (mis. Return/Revise dikembalikan ke submitter awal), berdampingan dengan `role` | Dok 04 secara eksplisit menyebut delegasi dan revisi sebagai kapabilitas generik; REVISE step pada workflow demo memakai ini untuk membuktikan dua tipe assignment berdampingan dalam satu definisi | `workflow_assignment_rules.assignment_type` |
| 3 | Versioning memakai flag `is_current` per Version dengan partial unique index (pola sama seperti ADR-0006), bukan kolom "current_version_id" di tabel Definition | Menghindari kelas bug NULL-tidak-sama-dengan-NULL yang sama; instance yang sedang berjalan menyimpan `workflow_version_id` miliknya sendiri sehingga publish Version baru tidak pernah mengganggu instance lama, sesuai "Definisi lama tetap menyelesaikan transaksi berjalan" (dok 04) | Migration `1755800000000`, `workflow_versions_current_unique` |
| 4 | Escalation sweep adalah operasi API eksplisit (RBAC-gated, `workflow.instance.manage`), bukan dijalankan otomatis oleh scheduler/cron | Tidak ada infrastruktur cron/scheduler di lingkungan implementasi ini (senada dengan gap "belum ada CI/CD" dari 0A/0B); mekanisme sweep sendiri terbukti benar-benar bekerja (reassignment, History, Notification hook, Audit) saat dipanggil — pemicu otomatis adalah pekerjaan wiring terpisah, bukan desain ulang | `WorkflowService.escalateOverdueAssignments`, migration file header |
| 5 | Notification-ready hook diwujudkan sebagai tabel `workflow_notification_hooks` yang mencatat event+payload setiap kali engine SEHARUSNYA mengirim notifikasi, bukan implementasi Notification Engine sungguhan | Notification Engine adalah cakupan dokumen 06 (belum menjadi bagian Phase 0 checkpoint manapun sejauh ini); tujuan 0D adalah membuktikan titik hook menyala di momen yang tepat dengan data yang tepat, siap dikonsumsi Notification Engine nanti tanpa perubahan skema | Migration `1755800000000` |
| 6 | Dua bug FK "ON DELETE tanpa CASCADE" (`assigned_organization_unit_id` ke `organization_units`, dan enam kolom ke `users`: `fixed_user_id`, `created_by`, `started_by`, `assigned_user_id`, `decided_by`, `actor_user_id`) ditemukan dan diperbaiki sebelum migration final | Kelas bug yang PERSIS SAMA dengan temuan Checkpoint 0B (migration `1755600100000`) — cleanup test integrasi (hapus Tenant) gagal karena FK menghalangi cascade; kali ini ditemukan lebih awal (saat menulis test 0D sendiri, sebelum sempat jadi masalah produksi) karena polanya sudah dikenali dari 0B | Migration `1755800000000` (diperbaiki langsung sebelum migration dianggap final, lewat siklus rollback-fix-reapply seperti bug regex 0C) |
| 7 | Role demo baru (`WORKFLOW_REVIEWER` scope Site A, `WORKFLOW_MANAGER` scope tenant-wide) ditambahkan ke seed script, tenant `demo-gs` di-reseed ulang | Pola yang sama persis dengan 0C — permission baru (`workflow.*`) tidak otomatis menempel ke role ADMIN yang sudah ada di tenant demo lama; reseed adalah solusi khusus demo/dev, bukan strategi migrasi produksi (gap ini sudah tercatat sejak 0C dan berulang di sini, memperkuat urgensi menyelesaikannya sebelum tenant produksi sungguhan ada) | `apps/api/scripts/seed.ts` |

### Item terbuka yang dibawa ke checkpoint berikutnya

- Tidak ada mekanisme claim/lock saat beberapa pemegang role yang sama berpotensi bertindak pada Assignment yang sama secara bersamaan — yang menang adalah yang pertama sampai ke database (Assignment kedua akan mendapat `ConflictError` karena status sudah bukan `pending`), bukan silent double-decision. Didokumentasikan sebagai simplifikasi sengaja di ADR-0007, bukan diasumsikan tidak akan pernah terjadi.
- Escalation sweep tidak dipicu otomatis oleh scheduler — masih memerlukan pemicu manual/API call eksternal (lihat item #4 di atas).
- Data Scope untuk Workflow Assignment masih exact-match (bukan rekursif), carry-over dari ADR-0005 — Site Supervisor tidak otomatis mencakup unit turunannya.
- Migrasi permission untuk tenant produksi yang sudah live masih belum ada (carry-over dari 0C, terbukti lagi relevan di sini).
- CI/CD masih belum ada (carry-over dari 0A/0B/0C).

## 2026-08-18 — Checkpoint 0E

Ringkasan keputusan implementasi pada Checkpoint 0E (Enterprise Shared
Services). Detail lengkap ada di `docs/implementation-notes.md`.

| # | Keputusan | Alasan | Referensi |
|---|---|---|---|
| 1 | Event Foundation dibangun sebagai dua bagian terpisah: `EventBus` in-process (publish/subscribe sinkron) + tabel `domain_events` (log durable, bisa di-query) | Dok 07 hanya mensyaratkan bentuk arsitektur event-driven ("publisher tidak tahu subscriber-nya"), bukan secara eksplisit broker terpisah proses; memisahkan mekanisme dari log membuat Observability (baca log) tidak bergantung pada subscriber mana pun yang kebetulan terdaftar saat itu | `application/event/event-bus.ts` |
| 2 | Subscriber Event Foundation yang throw ditangkap dan dicatat, TIDAK membatalkan operasi yang mempublikasikan event | Selaras dengan dok 07: validasi transaksi tetap ketat & synchronous, tapi side-effect (notifikasi, integrasi) bersifat best-effort — satu Notification Template yang salah tidak boleh menggagalkan approval Workflow | `EventBus.publish` |
| 3 | Notification Engine memakai konvensi payload standar `targetUserId` / `targetRoleCode` + `targetOrganizationUnitId` untuk resolusi penerima, dengan role-queue memakai ulang persis model Role+Data Scope dari ADR-0007 (method baru `RbacRepository.listUserIdsWithRoleInScope`) | Menghindari membuat model "penerima" kedua yang terpisah dari model Role+Scope yang sudah ada; satu assignment role-queue Workflow otomatis fan-out ke SEMUA pemegang role yang cocok, bukan hanya satu | `notification.service.ts`, `rbac.repository.pg.ts` |
| 4 | Document/File Service memakai penyimpanan disk lokal (`LocalFileStorage`) dengan `storagePath` yang disimpan sebagai kolom generik (bukan URL S3 spesifik) | Tidak ada infrastruktur object storage di lingkungan implementasi ini; skema `documents` sudah storage-agnostic sehingga implementasi S3 nanti tinggal ganti kelas storage, tanpa migrasi skema atau perubahan `DocumentService` | `infrastructure/storage/local-file-storage.ts` |
| 5 | Akses Document (`document.manage`/`document.read`) di-gate di level Tenant saja, BELUM mengikuti Data Scope entity induknya seperti diminta dok 06 | Checkpoint ini sengaja tetap generic/entity-agnostic (tidak boleh menyentuh Complaint/Survey/Procurement), sehingga tidak ada modul bisnis nyata untuk me-resolve Data Scope dari suatu entity — simplifikasi sekelas Terminology tenant-scope-only di 0C, didokumentasikan sebagai gap terbuka, bukan pengecualian diam-diam | `document.service.ts` |
| 6 | Scheduler adalah interval loop in-process (`setInterval`, di-unref agar tidak mengganjal shutdown/test) dengan registry generik `scheduled_jobs` + riwayat `scheduled_job_runs`, bukan library cron/queue eksternal | Tidak ada infrastruktur queue/cron di lingkungan implementasi ini; tujuan 0E adalah membuktikan mekanisme "job berjalan otomatis" bekerja sungguhan (dibuktikan lewat sweep escalation yang benar-benar terpicu otomatis, lihat Pembuktian Manual di Implementation Notes), penggantian ke pg-boss/BullMQ nanti murni penggantian implementasi, bukan desain ulang skema | `application/scheduler/scheduler.service.ts` |
| 7 | Scheduler Escalation Sweep memakai method baru `WorkflowService.escalateOverdueAssignmentsForTenant` (tanpa `ActorContext`/RBAC check) yang memanggil ulang logic sweep yang sama persis dengan endpoint manual | Job terjadwal tidak punya user HTTP yang terautentikasi; endpoint HTTP manual (`/workflow/escalation-sweep`) tetap satu-satunya jalur yang di-gate `workflow.instance.manage` — method sistem ini sengaja tidak pernah didaftarkan sebagai route | `workflow.service.ts` → `runEscalationSweep` (private, dipakai kedua jalur) |
| 8 | Integration Boundary outbound bersifat stub murni (mencatat log "sent" per Domain Event ke Endpoint aktif, tanpa panggilan HTTP nyata ke pihak ketiga); inbound adalah webhook nyata dengan validasi tanda tangan HMAC-SHA256 | Tidak ada kredensial integrasi pihak ketiga pilot mana pun yang tersedia (persis pertanyaan terbuka di dok 07); sisi inbound tetap dibuat sungguhan karena tidak butuh kredensial eksternal — cukup untuk membuktikan "integrasi tidak pernah menyentuh domain layer langsung", hasil akhirnya selalu berupa satu Domain Event | `integration.service.ts` |
| 9 | Mekanisme claim/lock role-queue (permintaan eksplisit Founder) diimplementasikan sebagai reservasi opt-in dengan TTL 15 menit, bukan lock permanen | Lock permanen berisiko task "terdampar" bila aktor yang klaim hilang kontak; TTL memberi pemulihan otomatis tanpa langkah admin manual, sambil tetap menyelesaikan masalah utama (dua reviewer mengerjakan task yang sama secara bersamaan) — evaluasi lengkap tiga opsi ada di ADR | ADR-0008 |
| 10 | Permission baru Checkpoint 0E ditambahkan lewat migration, tenant `demo-gs` di-reseed ulang (pola sama seperti 0C/0D) | Konsisten dengan gap migrasi-permission-untuk-tenant-produksi yang sudah tercatat sejak 0C — reseed tetap hanya valid untuk lingkungan demo/dev | `apps/api/scripts/seed.ts` |

### Item terbuka yang dibawa ke checkpoint berikutnya

- Kompresi foto otomatis dan enkripsi at-rest untuk Document/File Service (diminta dok 06/09) belum diimplementasikan — tidak ada infrastruktur image-processing/object-storage terenkripsi di lingkungan ini.
- Akses Document belum mengikuti Data Scope entity induknya (lihat item #5) — masih tenant-level saja.
- Scheduler adalah in-process timer, bukan job runner yang tahan restart proses — bila proses API di-restart di tengah interval, job berikutnya baru berjalan setelah proses baru selesai boot, bukan "mengejar" jadwal yang terlewat.
- Retry otomatis untuk Notification yang gagal (`status='failed'`) atau Integration outbound yang gagal belum ada — keduanya tercatat di log tapi tidak di-retry.
- Claim/lock TTL (15 menit) masih konstanta kode, belum jadi Tenant Configuration per Step (lihat ADR-0008).
- Belum ada endpoint "force release" claim oleh admin — hanya TTL alami dan release oleh pemegang claim sendiri.
- Migrasi permission untuk tenant produksi yang sudah live masih belum ada (carry-over dari 0C/0D, berulang lagi di sini — kandidat kuat untuk diselesaikan sebelum tenant produksi pertama).
- CI/CD masih belum ada (carry-over dari 0A–0D).

## 2026-08-18 — Checkpoint 0F (Phase 0 Stabilization)

Ringkasan keputusan implementasi pada Checkpoint 0F. Detail lengkap ada
di `docs/implementation-notes.md`, `docs/technical-debt-register.md`,
dan `docs/performance-baseline.md`.

| # | Keputusan | Alasan | Referensi |
|---|---|---|---|
| 1 | Data Scope menjadi hierarkis (descendant-aware) — assignment di Organization Unit induk otomatis mencakup seluruh descendant, dihitung lewat upward ancestor walk (`WITH RECURSIVE`) dari target, bukan downward descendant enumeration dari assignment | Menyelesaikan item terbuka ADR-0005 sejak 0B, prasyarat keras untuk Complaint/Survey (Regional Manager harus otomatis mencakup semua Site di bawahnya); arah upward dipilih karena selalu dimulai dari satu target konkret (dibatasi kedalaman tree), bukan enumerasi descendant dari root yang bisa besar | ADR-0009, `RbacService`, `RbacRepository.listUserIdsWithRoleInScope`, `OrganizationUnitService.listForTenant` |
| 2 | Migrasi permission produksi diselesaikan untuk kasus Role "full access" lewat kolom `roles.is_full_access` + script idempoten `sync-role-permissions.ts`, BUKAN otomatisasi penuh untuk semua Role | Role kurasi (mis. SUPERVISOR) yang harus dapat permission baru adalah keputusan bisnis, bukan mekanis — mengotomatisasi itu berisiko over-grant akses secara diam-diam (regresi keamanan); Role "intent"-nya memang "semua permission" (Administrator) aman disinkronkan otomatis, terbukti lewat pengujian langsung (hapus 1 grant → sync → grant kembali, run kedua 0 perubahan) | ADR-0010 |
| 3 | Frontend menyimpan sesi (termasuk refresh token) di `localStorage`, direhidrasi + di-refresh proaktif saat mount, bukan httpOnly cookie + BFF | Ini API JSON Bearer-token murni (tanpa cookie, tanpa CSRF surface), Dedicated Deployment per client (ADR-0003, permukaan serangan lebih kecil dari SaaS multi-tenant); alternatif httpOnly cookie + same-origin BFF adalah perubahan arsitektur besar di luar cakupan "tanpa capability besar" checkpoint ini — dicatat sebagai Future Enhancement, bukan diasumsikan selesai final | `AuthContext.tsx`, Technical Debt Register |
| 4 | `POST /auth/logout` ditambahkan — merevoke refresh token di server, bukan hanya menghapusnya di client | Persistensi sesi di localStorage berarti refresh token bisa hidup sampai 7 hari di browser; tanpa revoke server-side, token yang tertinggal (mesin bersama, riwayat browser) tetap bisa dipakai walau user merasa sudah logout | `auth.service.ts`, `refresh-token.ts` |
| 5 | Inbound Integration webhook mendukung idempotency key opsional (`X-Idempotency-Key`) dengan partial unique index di database, BUKAN wajib untuk semua pengirim | Sender yang tidak mengirim key tetap dapat perilaku pre-0F (setiap delivery valid diproses) — tidak ada dedupe key yang reliable untuk dipaksakan secara umum (hash payload akan menolak event yang identik tapi memang berbeda secara sah); race dua delivery bersamaan dengan key sama ditangani lewat penangkapan unique-violation (kode 23505), bukan diasumsikan tidak akan pernah terjadi | Migration `1756000000000`, `integration.service.ts` |
| 6 | Scheduler mendapat in-process overlap guard (`Set<jobCode>` yang sedang berjalan) — trigger kedua untuk job yang sama saat masih berjalan langsung ditolak `ConflictError` (409), bukan antre atau berjalan paralel | Escalation Sweep tidak idempoten terhadap dirinya sendiri berjalan dua kali bersamaan (bisa meng-eskalasi Assignment yang sama dua kali); guard in-process cukup untuk Phase 0 (satu proses API), akan perlu revisit bila Scheduler pindah ke banyak proses/instance nanti | `scheduler.service.ts` |
| 7 | Rate limiting ditambahkan: global 1200/menit per IP (dapat di-tuning `RATE_LIMIT_MAX`), `/auth/login` 10/menit per IP secara terpisah | `/auth/login` adalah satu-satunya endpoint yang jadi target realistis brute-force credential guessing — limitnya jauh lebih ketat dari limit umum; angka global awal (300/menit) terbukti terlalu ketat oleh performance baseline sendiri (autocannon kena 429), dinaikkan ke 1200 berdasarkan bukti, bukan tebakan kedua yang sama tanpa dasarnya | `app.ts`, `docs/performance-baseline.md` |
| 8 | Error handler global diperbaiki untuk meneruskan `statusCode` 4xx apa pun yang dibawa error dari plugin Fastify (rate-limit, sensible, multipart), bukan selalu jatuh ke 500 generik | BUG NYATA ditemukan oleh test rate-limiting 0F sendiri: request yang di-throttle (429 dari `@fastify/rate-limit`) sebelumnya diteruskan ke client sebagai 500 "Internal server error" — client tidak akan pernah tahu harus retry-with-backoff, bukan menganggap ada bug di server | `error-mapping.ts` |
| 9 | Setiap route HTTP dipindah ke dalam `app.register(async (scoped) => {...})` bersarang, bukan didaftarkan langsung di instance `app` root | Root cause dari bug #8/#7 di atas — plugin `@fastify/rate-limit` menempelkan hook `onRoute` lewat antrean avvio (asynchronous), sedangkan route yang didaftarkan langsung ke `app.post/get/...` bersifat sinkron dan bisa selesai SEBELUM plugin tsb selesai register; membungkus route dalam `app.register()` menempatkannya di antrean avvio yang sama sehingga urutan selalu benar, terlepas dari apakah pemanggilan plugin di atasnya di-`await` atau tidak | `app.ts` |
| 10 | React StrictMode double-invoke pada efek rehidrasi sesi diberi guard `useRef` agar refresh token (single-use) tidak dipakai dua kali dalam satu mount | Ditemukan oleh Playwright E2E smoke test (401 di console browser saat reload halaman) — StrictMode sengaja memanggil efek dua kali di development untuk mendeteksi bug seperti ini; tanpa guard, panggilan kedua memakai refresh token yang SUDAH di-rotate oleh panggilan pertama | `AuthContext.tsx` |

### Item terbuka yang dibawa ke checkpoint berikutnya (Phase 1)

Lihat `docs/technical-debt-register.md` untuk daftar lengkap terklasifikasi
(Blocker/Must Fix/Technical Debt/Future Enhancement). Tidak ada item
BLOCKER yang tersisa untuk memulai Phase 1; item MUST FIX (Document
Service belum entity-scope-aware, migrasi permission Role kurasi, CORS
allowlist, CI/CD, endpoint update/soft-delete, validasi rate limit
dengan traffic nyata) dicatat eksplisit sebagai pekerjaan yang boleh
berjalan PARALEL dengan Phase 1, bukan sebagai penghalang mulainya.

## 2026-08-18 — FOUNDER DECISION: Phase 0 dinyatakan COMPLETED

Setelah Founder Review atas `docs/phase0-final-review.md` (Self-Review,
Gap Analysis, Risk Analysis, Security Review, Test Summary, Technical
Debt Summary, Readiness Assessment), Founder menyatakan:

> **Phase 0 — Enterprise Core Foundation dinyatakan COMPLETED.**

Keputusan ini bersifat business/architecture-binding (Founder Decision),
dicatat di sini sebagai referensi implementasi; keputusan resmi lengkap
juga tercatat di `docs/phase0-final-review.md` bagian 7 (Readiness
Assessment) yang merekomendasikan status ini.

**Dasar keputusan:**
- 0 item BLOCKER tersisa di seluruh Technical Debt Register.
- Seluruh 6 checkpoint (0A–0F) selesai dengan self-review, test, gap
  analysis, dan risk note masing-masing, mengikuti protokol IEP secara
  konsisten.
- 45/45 integration test lulus, typecheck/lint/build bersih, migration
  chain tervalidasi penuh, security review tidak menemukan kerentanan
  kritis, visual browser E2E pertama kali berhasil dan menemukan 3 bug
  nyata yang sudah diperbaiki.

**Implikasi:** enam Must Fix yang tersisa (Document Service belum
entity-scope-aware, migrasi permission Role kurasi, CORS allowlist,
CI/CD, endpoint update/soft-delete, validasi rate limit dengan traffic
nyata) TIDAK menghalangi status COMPLETED ini — sudah diklasifikasikan
eksplisit sebagai pekerjaan yang berjalan paralel dengan Phase 1, bukan
prasyarat sebelum Phase 1 dimulai. Satu keputusan yang tetap WAJIB
diambil secara eksplisit di checkpoint pertama Phase 1 (bukan diwarisi
diam-diam): strategi akses Data Scope untuk Document Service, sebelum
fitur lampiran bukti Complaint dibangun.

Keputusan mengenai kapan dan dengan instruksi seperti apa Phase 1
(Customer Complaint Management + Survey & Assessment) dimulai menunggu
arahan eksplisit Founder berikutnya.

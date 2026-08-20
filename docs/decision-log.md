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

## 2026-08-18 — Checkpoint 1A (Document Scope & Customer Experience Foundation)

Checkpoint pertama Phase 1. Ringkasan keputusan implementasi; detail
lengkap ada di `docs/implementation-notes.md`,
`docs/technical-debt-register.md`, ADR-0011, dan ADR-0012.

| # | Keputusan | Alasan | Referensi |
|---|---|---|---|
| 1 | Document/Attachment authorization mengikuti Data Scope parent entity lewat pola **Entity Authorization Resolver** (`Map<entityType, resolver>` yang di-lookup DocumentService saat runtime), bukan permission `document.manage`/`document.read` Tenant-wide untuk entityType yang sudah punya resolver | Binding decision eksplisit Founder: "attachment tidak memiliki independent business authorization yang terpisah dari parent business entity"; entityType tanpa resolver terdaftar (`demo_transaction`, satu-satunya yang dipakai regression suite Phase 0) tetap memakai perilaku Checkpoint 0E persis — jadi ini murni tambahan, bukan mengganti perilaku lama | ADR-0012, `document.service.ts`, `entity-authorization-resolver.ts` |
| 2 | Data Scope mendapat dimensi ketiga: `customer` (exact-match, scope_customer_id), setara `tenant`/`organization_unit`, bukan kolom `customer_id` ad hoc di tabel `users` | Customer User bukan bagian hierarki Organization Unit internal sama sekali — memodelkannya sebagai Organization Unit scope adalah category error; menaruhnya sebagai axis Data Scope ketiga (bukan mekanisme otorisasi terpisah) berarti satu titik keputusan (`RbacService.requireCustomerContextScope`) tetap jadi satu-satunya tempat semua modul Customer-context bertanya, sama seperti pola ADR-0009 | ADR-0011, migration `1757000000000` |
| 3 | Contract/Project/Site TIDAK punya `owner_organization_unit_id` sendiri — Data Scope-nya diresolusi lewat Customer induknya (`CustomerService.getAuthorized`) | Proporsional terhadap kebutuhan 1A ("tidak semua field wajib, buat relationship generik"); Contract/Project/Site yang butuh scope independen dari Customer induknya adalah keputusan Client Configuration/Extension, bukan kebutuhan Product Core yang terbukti saat ini | Migration `1757000000000` header, `contract.service.ts`/`project.service.ts`/`site.service.ts` |
| 4 | Customer User dibuat lewat endpoint `/users` yang SUDAH ADA (Checkpoint 0B), bukan endpoint/tabel identity terpisah — hanya `scopeType: 'customer'` baru | Instruksi eksplisit Founder: "gunakan entity Phase 0 yang sudah tersedia, jangan membuat duplicate master data"; seluruh infrastruktur Auth/JWT/RBAC Phase 0 (login, refresh, RBAC effective-permission lookup) langsung berfungsi untuk Customer User tanpa perubahan | `user.service.ts`, `users.ts` routes |
| 5 | Listing `GET /customers` tetap Tenant-permission-gated saja (belum difilter Data Scope per baris) | Mengikuti presedan `GET /organization-units`/`GET /legal-entities` 0B — path single-entity (`getAuthorized`, dipakai Contract/Project/Site/Service/Document resolver) adalah path yang benar-benar dilalui Customer User; penyempitan listing eksplisit ditunda ke 1C saat Customer Portal role kurasi membutuhkannya, dicatat sebagai gap, bukan diasumsikan selesai | `customer.service.ts`, Technical Debt Register |
| 6 | Service catalog (`services`) adalah data Tenant-level generik (nama seperti "Catering" hanya contoh dummy), dipisah dari Service Assignment (`customer_service_links`) yang benar-benar terikat Data Scope Customer | Menjaga prinsip Generic Engine — Product Core tidak memuat kategori/nama Service spesifik klien; assignment-nya (siapa dapat Service apa) yang terikat otorisasi, bukan katalognya | Migration `1757000000000`, `service-catalog.service.ts` |

### Item terbuka yang dibawa ke checkpoint berikutnya

- Belum ada endpoint update/soft-delete untuk Customer/Contract/Project/Site/Service/Service Assignment (carry-over pola yang sama seperti Organization Unit/User sejak 0B).
- `GET /customers` belum difilter Data Scope per baris (lihat keputusan #5) — didokumentasikan sebagai gap sadar, bukan bug.
- Resolver Entity Authorization baru didaftarkan untuk `entityType='customer'`; `contract`/`project`/`site` belum punya resolver sendiri karena belum ada modul bisnis yang melampirkan dokumen langsung ke entity tersebut (Complaint/Survey akan melampirkan ke dirinya sendiri, bukan langsung ke Contract/Project/Site).
- Seluruh item Must Fix Phase 0 (CORS allowlist, CI/CD, migrasi permission Role kurasi, endpoint update/soft-delete Phase 0, validasi rate limit) masih terbuka, belum dikerjakan di checkpoint ini (di luar cakupan 1A, boleh paralel per keputusan Founder sebelumnya).

## 2026-08-18 — Checkpoint 1B (Generic Customer Complaint Engine)

Checkpoint kedua Phase 1, dilanjutkan di session yang sama setelah
Checkpoint 1A di-APPROVE Founder. Ringkasan keputusan implementasi;
detail lengkap ada di `docs/implementation-notes.md`,
`docs/technical-debt-register.md`, dan ADR-0013.

**Hardening 1A yang diselesaikan lebih dulu (sesuai instruksi eksplisit):**
`GET /customers` sekarang benar-benar difilter Data Scope per baris
(bukan hanya Tenant-permission-gated) — `CustomerService.listForTenant`
mengambil seluruh assignment aktor sekali (`RbacService.getAssignments`),
lalu memfilter tiap Customer lewat `isCustomerContextScopeCoveredByAssignments`
(varian batch dari `requireCustomerContextScope`/ADR-0011 yang menghindari
N+1 query), short-circuit untuk assignment `scope_type='tenant'`. Item
terbuka #5 di catatan Checkpoint 1A di atas dinyatakan RESOLVED oleh
perubahan ini, bukan ditunda lagi ke 1C.

| # | Keputusan | Alasan | Referensi |
|---|---|---|---|
| 1 | Complaint Lifecycle (Draft→Submitted→Acknowledged→Assigned→In Investigation→Corrective Action→Verification→Customer Confirmation→Closed, plus Reject/Cancel/Reopen/Escalate) TIDAK diimplementasikan sebagai state machine di `ComplaintService` — 100% adalah Workflow Definition/Version/Step/Transition/Assignment Rule/Escalation Rule biasa di generic Workflow Engine (0D/0E), `ComplaintService` hanya menyimpan `COMPLAINT_WORKFLOW_DEFINITION_CODE = "complaint_lifecycle"` dan meneruskan `actionCode` apa adanya ke `WorkflowService.actOnAssignment` | Instruksi eksplisit Founder: "Workflow tidak boleh hardcoded di Complaint Service; gunakan generic Workflow Engine Phase 0" — dibuktikan langsung: actionCode yang tidak valid untuk Step saat ini ditolak oleh `WorkflowService` sendiri (`ValidationError`, HTTP 400), bukan oleh kode Complaint apa pun | ADR-0013, `complaint.service.ts`, `complaints.ts` routes, seed workflow `complaint_lifecycle` |
| 2 | Dua ekstensi generic baru ditambahkan ke `WorkflowService`: `reopenInstance` (reset Instance terminal ke Step non-terminal, buat Assignment baru lewat Assignment Rule Step tsb) dan `isActorAssociatedWithInstance` (submitter ATAU pernah/sedang di-assign) — keduanya tidak mereferensikan `complaint`/`entityType` sama sekali | Instance terminal tidak punya Assignment pending, jadi Reopen tidak bisa jadi Transition biasa; membuatnya generic (bukan method khusus Complaint) berarti Survey (1D+) mendapat Reopen gratis tanpa perubahan Workflow Engine lagi | ADR-0013, `workflow.service.ts` |
| 3 | `ComplaintService.getAuthorized` (gerbang visibilitas) menggabungkan TIGA kondisi dengan OR: Customer Data Scope (ADR-0011) ATAU submitter cocok ATAU `isActorAssociatedWithInstance` — bukan Customer Data Scope saja | Customer Data Scope saja akan salah memblokir investigator internal yang di-assign lewat Role+Organization-Unit tapi TIDAK terikat `ownerOrganizationUnitId` Customer tsb (mis. tim investigasi terpusat lintas-Customer); `WorkflowService.actOnAssignment`'s `assertEligible` tetap jadi gerbang presisi "boleh bertindak sekarang", terpisah dari "boleh tahu Complaint ini ada" | ADR-0013, `complaint.service.ts` |
| 4 | `WorkflowService.getInstanceForEntityOwner` (trusted-caller, tanpa cek `workflow.instance.read`) dan `ConfigurationService.generateNumberForTenant` (trusted-caller, tanpa cek `config.manage`) ditambahkan; `ComplaintService` memakai keduanya, bukan varian permission-gated | `workflow.instance.read` adalah permission Tenant-wide ("baca semua Workflow Instance di tenant") yang berbahaya diberikan ke Customer User ATAU bahkan ke internal Handler biasa hanya supaya bisa kerja di Complaint sendiri; `config.manage` sama sekali tidak cocok untuk Customer User yang sekadar submit Complaint. Demo seed sengaja TIDAK memberi `workflow.instance.read` ke `CUSTOMER_USER`/`COMPLAINT_HANDLER`/`COMPLAINT_MANAGER` | ADR-0013, `workflow.service.ts`, `configuration.service.ts` |
| 5 | SLA tetap memakai mekanisme per-Step yang sudah ada (`WorkflowStep.slaHours`), BUKAN matriks SLA multi-dimensi Customer×Contract×Service×Category×Priority×Severity | Simplifikasi proporsional untuk 1B — tiap Step demo `complaint_lifecycle` sudah bisa punya `slaHours` sendiri (Submitted=4j, Assigned=8j, In Investigation=48j) lewat Tenant Configuration murni; matriks penuh adalah generalisasi spekulatif tanpa requirement Business Discovery yang disetujui, dicatat sebagai Technical Debt eksplisit | ADR-0013, seed `complaint_lifecycle` steps |
| 6 | Priority memakai reference data `priority_level` yang SUDAH ADA sejak Checkpoint 0C (dipakai ulang, bukan dibuat baru); Severity mendapat reference data type baru `complaint_severity`; keduanya field terpisah di tabel `complaints`, tidak digabung | Instruksi eksplisit Founder: "Bedakan Priority dan Severity" — memakai ulang `priority_level` yang sudah generic (bukan spesifik Complaint) membuktikan Priority adalah konsep lintas-modul, sementara Severity yang secara konseptual berbeda (dampak vs urgensi) mendapat katalognya sendiri | Migration `1758000000000`, `complaint.entity.ts` |
| 7 | Resolver Entity Authorization baru didaftarkan untuk `entityType='complaint'` (pola ADR-0012 yang sama persis dengan `customer`), sehingga evidence/attachment Complaint TIDAK butuh permission `document.*` terpisah | Konsisten dengan binding decision 1A: attachment tidak punya otorisasi bisnis independen dari parent entity-nya; `complaint`-nya sendiri adalah `getAuthorized` yang sama dipakai visibilitas Complaint (poin #3), bukan logika baru | ADR-0012, ADR-0013, `composition-root.ts` |
| 8 | Numbering Complaint (`complaint_number`, pola `CMP-{YYYY}-{SEQ:5}`) dan Notification Template Complaint (`complaint.submitted`/`.assigned`/`.closed`/`.escalated`/`.reopened`) 100% dibuat lewat mekanisme Tenant Configuration Checkpoint 0C/0E yang sudah ada — tidak ada baris kode baru di subsistem Numbering/Notification | Instruksi eksplisit Founder: Numbering dan Notification Template harus configurable — dibuktikan dengan tidak menambah satu pun tabel/service baru untuk keduanya, hanya baris data Tenant Configuration | Migration `1758000000000`, seed script |

### Item terbuka yang dibawa ke checkpoint berikutnya

- Belum ada endpoint update/soft-delete untuk Complaint (carry-over pola yang sama seperti Customer/Contract/Project/Site/Service sejak 1A dan Organization Unit/User sejak 0B).
- SLA multi-dimensi (Customer×Contract×Service×Category×Priority×Severity) belum ada — keputusan sadar #5 di atas, bukan bug.
- `subcategory` masih free-text, belum jadi reference data type tersendiri.
- Peran internal dengan `workflow.instance.read` (peninggalan Phase 0, mis. `WORKFLOW_MANAGER`) tetap bisa menelusuri semua Workflow Instance tenant lewat route generic `/workflow/instances/...`, termasuk milik Complaint — karakteristik generic engine yang sudah ada sejak 0D, bukan diperkenalkan 1B; demo seed 1B sengaja tidak memberi permission ini ke role Complaint manapun (lihat keputusan #4).
- Seluruh item Must Fix Phase 0 yang belum dikerjakan (CORS allowlist, CI/CD, migrasi permission Role kurasi, validasi rate limit dengan traffic nyata) masih terbuka, di luar cakupan 1B, boleh berjalan paralel sesuai keputusan Founder sebelumnya.

## 2026-08-19 — Checkpoint 1C.8 (Regression & Stabilization)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Tidak mengubah dependency meski `npm audit` melaporkan 9 vuln | CRITICAL/HIGH + mayoritas MODERATE = dev/build/test tooling (vitest/vite/esbuild/vite-node/glob/node-pg-migrate), bukan production runtime; react-router/-dom moderate advisory tidak applicable (nav internal literal, client-only tanpa SSR). Tidak ada MUST-FIX applicable | Founder 1C.8 §33/§34/§42 |
| 2 | Fresh-environment via disposable DB tidak dijalankan | Role `abixell` tanpa CREATEDB & tanpa superuser; roundtrip destruktif dilarang di dev DB utama. Determinism diverifikasi via idempotency migrate + inspeksi schema/FK; test suite mem-bootstrap tenant dari kosong | Founder 1C.8 §23/§24 (ENVIRONMENT LIMITATION) |
| 3 | Menginstal Playwright Chromium (runtime browser, bukan package baru) & memverifikasi PWA di real browser | Playwright sudah devDependency; §27 mengizinkan install browser runtime. Membuktikan SW register/active + `/api` tidak di-cache + offline shell — menutup gap verifikasi 1C.7 | Founder 1C.8 §26/§27 |
| 4 | Perbaikan selektor e2e smoke (bukan product) | Selektor step-2 cocok banyak elemen (mobile header hidden) → timeout; product behavior benar (diverifikasi live). §28 "perbaiki test bila product benar" | Founder 1C.8 §28 |
| 5 | Limitation KPI "Critical" & customer-set Priority didokumentasikan, tidak diubah | Critical bergantung canonical code `critical`; priority dapat dipilih customer karena model existing — keduanya butuh keputusan bisnis/konfigurasi, bukan defect | Founder 1C.8 §17/§18 |

### Closure Phase 1C
- Tidak ada schema/migration baru di 1C.8 (tetap 10 migrations / 48 tables).
- Tidak ada perubahan backend business / dependency.
- Technical debt Phase 1C dikonsolidasi & diklasifikasi di `technical-debt-register.md`.
- Tidak ada blocker; Phase 1C siap ditutup menunggu Founder.

## 2026-08-19 — Checkpoint 1D.1 (Survey Engine Core)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Assignment = instance + response container (no separate survey_responses) | Fewer tables, template vs instance still separated; answers hang off the assignment | FD-1D-02 |
| 2 | Answers reference the immutable published question by FK; NO snapshot columns | Published version + questions are immutable, so meaning cannot drift; snapshot would be redundant | FD-1D-03 |
| 3 | Lightweight status lifecycle (draft/published/retired), not the Workflow Engine | Survey definition lifecycle is simple; reusing the workflow engine would be over-engineering | FD-1D-06 §9 |
| 4 | Only rating/single_choice/long_text have behavior; enum future-ready | FD-1D-04; other types rejected at create + publish validation | FD-1D-04 |
| 5 | Submit finalization is a single guarded UPDATE (status IN pending/in_progress) | Atomic; double-submit impossible; no partial business state | §14/§37 |
| 6 | Context entity authorized via the shared EntityAuthorizationResolver registry | Reuse ADR-0012; Survey Core never hardcodes `if contextEntityType===complaint` | FD-1D-05 §16 |
| 7 | Respondent v1 = user only; customer_contact columns are schema-readiness | Keep first slice focused; model stays extensible | FD-1D §10/§16 |
| 8 | No survey numbering | UUID sufficient | FD-1D-07 |

### 1D vs 1E boundary
Survey assignments may carry a context entity, but 1D.1 contains NO
Complaint→Survey auto-creation or any Survey-to-Action automation — that is
Checkpoint 1E. Events (`survey.submitted` etc.) are emitted as the seam.

## 2026-08-19 — Checkpoint 1D.2 (Survey Admin & Respondent UX)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | API client sets Content-Type/body only when a body is present | Fastify 400s on empty JSON body; broke bodyless POSTs (survey publish/submit) — first such calls in the app | Bug found in live testing |
| 2 | Added GET /survey-versions/:id + enriched /survey-assignments/my | Authoring a DRAFT and a meaningful respondent list need reads the 1D.1 API did not expose; small additive, survey.manage/respond gated | Founder 1D.2 §29 |
| 3 | Assignment respondent picker reuses /users | No duplicate people directory; admin holds user.read | Founder 1D.2 §16 |
| 4 | Frontend-only otherwise; no schema/migration | 1D.2 is UX over 1D.1 | Founder 1D.2 §30 |

## 2026-08-19 — Checkpoint 1D.3 (Survey Engine Stabilization & Closure)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Closure = validation + tests only; zero product/schema/dependency change | 1D.3 is a stabilization checkpoint, not a feature checkpoint | Founder 1D.3 |
| 2 | Added 3 stabilization tests (immutability §14 / historical safety §15 / retire safety §16); suite 16 survey / 132 total | Lock the immutability + versioning invariants against regression before closing 1D | Founder 1D.3 §14–§16 |
| 3 | No MUST-FIX defects found → Phase 1D declared ready for Founder closure | All MUST-FIX criteria (tenant leakage/unauthorized/published mutation/scoring/atomicity/result leakage/PWA caching/crash) passed | Founder 1D.3 §37 |
| 4 | Survey UI date-format import from `../complaints/format` kept for now, logged SHOULD FIX LATER | Pure formatting util, no Complaint logic → not a coupling defect; extract at next UI-util refactor | Founder 1D.3 §37 |
| 5 | 1E readiness documented, not built (context_entity seam, survey.assigned/submitted events, immutable score) | Founder scope forbids starting 1E; only document the seam | Founder 1D.3 §39 |

## 2026-08-20 — Checkpoint 1E.1 (Complaint → Survey Assignment Integration)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | New `survey-integration` orchestrator between the Cores; one-way dep (→ Complaint read + Survey port); neither Core imports the other | Keep Complaint Core survey-unaware and Survey Core complaint-unaware; integration lives on the boundary | FD-1E §2/§39 |
| 2 | Source event = `complaint.customer_confirmed`, stored as a finite `source_event_type` policy value | Follow actual customer confirmation, not `complaint.closed`, for the first slice; configurable finite value, not a rule engine | FD-1E-01 §7 |
| 3 | Respondent = `source_event_actor` (`DomainEvent.createdBy`) accepted only if it holds a `customer`-scoped assignment matching the complaint's customer | Deterministic, excludes internal handlers/admins; no anonymous/contact/submitter fallback | FD-1E-02 §5/§9 |
| 4 | Automation attribution via `assigned_by=NULL` + audit `creationMode:automation` + `triggerDomainEventId` | No system user / no ADMIN grant / no ActorContext redesign; never present the survey as manually created by the customer | FD-1E-03 §18 |
| 5 | Trusted seam `createAssignmentForTrustedIntegration` bypasses only human permission, re-enforces every business/data invariant | "Trusted caller = skip permission, not integrity" | FD-1E §19 |
| 6 | DB is the final idempotency boundary: `UNIQUE(policy, trigger_event)` + partial `UNIQUE(policy, entity) WHERE status='assigned'` | In-process EventBus is fire-once and swallows errors; app pre-check is only an optimization | FD-1E §12/§15 |
| 7 | Handler never throws; persists a `failed` execution instead | A failed integration must not roll back the confirmation; failure must be durable/observable, not swallowed | FD-1E §15/§16 |
| 8 | One-per-lifetime (FD-1E-07), not per-closure-cycle; no outcome/action fields in schema | YAGNI — 1E.1 is trigger/assignment only; 1E.2 may additively extend | FD-1E-07 §6/§25 |
| 9 | No permission and no admin UI added; policies via service config seam | No human config surface in 1E.1 → avoid a dead `survey.integration.configure` permission | FD-1E §20/§37 |

## 2026-08-20 — Checkpoint 1E.2 / 1E.3 (Survey Outcome → Management Attention; Phase 1E closure)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Outcome = question **code** + one finite operator + one numeric threshold | Question ids change per version, codes are the stable semantic key; `total_score` is raw and not comparable across surveys | FD-1E-05 §11/§16 |
| 2 | Outcome config is SNAPSHOTTED onto the execution at assignment time | A policy edited while the respondent is answering must not retroactively change the judgement of an already-assigned survey | FD-1E §29 |
| 3 | `rating` → submitted value; `single_choice` → configured option score; everything else → `unresolvable` | Never invent a number, never fall back to total score, never read option order as a value | FD-1E §13/§14/§15 |
| 4 | Management attention = domain event + Notification Core + execution/audit record; no task subsystem | Reuse existing capability first; the execution record is the authoritative signal | FD-1E-06 §6/§19 |
| 5 | Recipients resolved by CAPABILITY (`attention_permission_code` policy data), excluding customer-scoped users | Founder forbids coupling to a role name; a Customer User must never receive an internal management signal | FD-1E §20/§42 |
| 6 | Notification Core extended with an optional `targetUserIds` payload key | One-line convention extension reuses all template/render/delivery machinery instead of a second notification path | FD-1E §19 |
| 7 | Exactly-once via conditional UPDATE `WHERE outcome IS NULL` (no new table/index) | DB is the final idempotency boundary; a single-statement CAS is atomic and keeps the schema to two tables | FD-1E §25/§47 |
| 8 | Policy disabled after assignment → outcome still evaluated, action skipped (`skipped_policy_disabled`) | "Disabled policy → no outcome action", while keeping the evaluation observable | FD-1E §58 |
| 9 | Automatic Complaint reopen NOT implemented; Core 1E ends at management attention | Explicitly prohibited for Phase 1E; remains a Founder-gated advanced capability | FD-1E §5/§39/§75 |
| 10 | Trusted result read added (`getResultForTrustedIntegration`), never exposed over HTTP | Automation needs the result without a human permission, but must keep tenant + submitted-state integrity | FD-1E §43/§44 |

## 2026-08-20 — Global Product Blueprint & Roadmap Audit (Post-Phase-1)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | **Phase 1F = NOT APPLICABLE / cancelled as undefined** | No authoritative definition ever existed; "1F" occurrences were forward references written during 1E. Recorded so no future session re-invents it | FD-POST-1-01 |
| 2 | **Phase 1 = OFFICIALLY COMPLETED** after 1E | Documented Phase 1 scope (Customer Complaint Management + Survey & Assessment) is fully delivered and stabilized | FD-POST-1-02 |
| 3 | Product is layered as Platform Core / Business Core / Advanced Capability / Client Configuration / Client Extension | Extends the Founder-approved pre-Phase-0 three-layer rule by splitting Product Core into Platform vs Business and naming Advanced explicitly | `01-FOUNDER-DECISION-PRE-PHASE-0.md` + audit §4/§5 |
| 4 | **11 Business Core modules** defined; Vendor merged into Supply Chain, Contract into Customer & Commercial, Document into Platform Core; IGSEP vertical apps (catering/housekeeping/camp/facilities) become vertical service packs over Service Operations | Avoid over-modularization; module boundary must reflect owned data + lifecycle, not menu items | audit §12/§13 |
| 5 | **Survey-to-Action (Phase 1E) classified as Advanced — delivered**, not Business Core | It is automation depth over two Core modules; per the Founder's own Core/Advanced principle. Code is unchanged — classification only | audit §5/§23/§24 |
| 6 | `docs/product-blueprint.md`, `docs/product-roadmap.md`, `docs/product-progress.md` are the **canonical** product documents | Removes source-of-truth ambiguity; README now points to them | audit §49/§92 |
| 7 | `docs/00-prd/22-…` is **template/strategy input**, not the roadmap; the IGSEP corpus is **historical/supporting** | Doc 22 is instruction-shaped and year-based; the corpus describes IGSEP, a different (pre-whitelabel) product shape | audit §7/§31 |
| 8 | Progress model v1.0: weighted roadmap units (S1/M2/L3/XL5), COMPLETED=100 %, IN PROGRESS=0 % until accepted | Reproducible and conservative; phase-count percentages rejected as misleading | audit §37–§42 |
| 9 | **Dual metric** reported: Core Product Readiness + Full Approved Roadmap Progress | A single number would misrepresent a deployable Core against a large optional Advanced backlog | audit §72/§73 |
| 10 | Client Extensions excluded from both denominators; client configuration data is not product progress | Otherwise every custom client request would permanently reduce "product completion" | audit §70/§71 |
| 11 | Platform Hardening (CI/CD, CORS, rate limit, DR, deployment, advisories) tracked as its own track inside Core Readiness, never as business capability | Keeps infrastructure debt out of module classification while still gating pilot/production | audit §54–§56 |
| 12 | `docs/00-prd/` recommended for commit as **supporting/historical** (excluding the DOCX); not committed in this run | Corpus is authoritative history but not implementation truth; Founder disposition required first | audit §51/§84 |

## 2026-08-20 — Repository Architecture, IGSEP Migration & Canonical PRD Baseline

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Module structure is **`core/` + `advanced/` + `packs/`**, created only when non-empty | Founder-approved locked structure; empty folders for symmetry are noise | Architecture mandate §4/§13 |
| 2 | **Cross-domain Advanced lives in `orchestration/`**, domain-specific Advanced inside its module | Prevents false ownership; Survey-to-Action spans Survey + Complaint + Notification + Events + Integration | §5/§44 |
| 3 | Dependency direction frozen: `shared ← core ← modules ← orchestration`; packs depend on their module's core + configuration | Prevents `core → business module` and module-to-module internal coupling | §10 |
| 4 | **Source-code restructure DEFERRED**; target architecture frozen and binding for all new (Phase 2+) code | 109 files carry 275 relative imports (130 cross-layer) across 73 files, + 34 test imports + 51 composition-root imports — ~309 path rewrites for zero behavioural benefit against a green suite | §11/§45/§47/§48 |
| 5 | Migrations stay in one deterministic stream at `apps/api/migrations/`, ownership by filename | Global ordering must remain unambiguous | §18 |
| 6 | **IGSEP is the predecessor of Abixell One**, preserved verbatim as *Legacy Product Requirement Source* at `docs/history/igsep/` | It is not an unrelated product; rewriting it to say "Abixell One" would destroy historical meaning and traceability | §19/§20/§21 |
| 7 | Canonical PRD **reconstructed, not renamed**, at `docs/prd/abixell-one/` with stable requirement IDs and 11 module PRDs | PRD answers "what must the product do", separate from blueprint/roadmap/progress | §22–§29 |
| 8 | All 70 IGSEP legacy requirement areas dispositioned (ADOPT 18 / ADAPT 14 / MERGE 5 / RECLASSIFY 21 / DEFER 2 / SUPERSEDE 10 / DROP 0) | No requirement silently ignored; traceability matrix is mandatory | §30/§31/§72 |
| 9 | Four IGSEP vertical modules (Catering, Housekeeping, Camp, Facilities) **SUPERSEDED** into one Service Operations engine + four packs; four portal/mobile/dashboard "modules" superseded into experience surfaces | Prevents duplicate work-order/scheduling/workflow engines and audience-shaped pseudo-modules | §7/§33 |
| 10 | Progress denominator **unchanged** (174 / 353) after PRD reconstruction | Legacy items mapped to existing units or to SUPERSEDE/pack dispositions that add no weight; only genuinely new approved scope may inflate the denominator | §55–§57 |
| 11 | Baselines frozen: Blueprint v1.1, PRD v1.0, Roadmap v1.1, Progress Model v1.0, Documentation Governance v1.0 | Explicit versioning enables future change explanation | §58 |
| 12 | `docs/decision-log.md`, `docs/adr/`, `docs/implementation-notes.md` **kept at `docs/` root** rather than moved into the ideal tree | They are cited by path from 15 source-code comments; moving them creates stale references for no benefit | §39 |
| 13 | Pre-Phase-0 founder decisions **copied** into `docs/history/pre-phase-0/` (originals in the parent directory left untouched) | The product's founding decisions must be version-controlled; the Founder's own copies are not this execution's to relocate | §65 |
| 14 | `Business-Discovery-Workshop-Kit.docx` **not committed** | Binaries stay outside the active repository pending explicit Founder decision | §64 |

## 2026-08-20 — Phase 2 (Service Operations & Work Management Core)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Built under the frozen target architecture (`modules/service-operations/core/...`); existing Phase 0/1 code left in place | New code must follow the target; migrating old code was deferred for churn reasons | Blueprint §11A |
| 2 | `work_orders` has **no status column**; `workflow_instance_id` is the only lifecycle link | Prevents a second state machine competing with the Workflow Engine | SO-CORE-004 |
| 3 | Work Request state is **derived** (converted/cancelled), not stored | Intake bookkeeping must not drift into a lifecycle of its own | SO-CORE-002 |
| 4 | Checklist is **snapshotted** onto the Work Order at creation | A Service Definition is configuration and will change; executed history must stay truthful | SO-CORE-007 |
| 5 | Evidence reuses Document Core with a `work_order` entity authorization resolver | No second attachment subsystem; attachments inherit the Work Order's authorization | SO-CORE-009, ADR-0012 |
| 6 | Five capability permissions (read/manage/execute/verify/configure); no role names | Segregation of duties must be configurable per client | SO-CORE §29 |
| 7 | Lifecycle dispatch requires `read` + **any** operational capability, not `execute` | Coordinators, executors, and verifiers all legitimately advance lifecycle; Workflow eligibility stays the precise gate (found by testing) | SO-CORE-004 |
| 8 | Work Order visibility includes the **assignee path** alongside Customer Data Scope | A field executor is authorised by assignment, not by owning the customer's scope | SO-CORE-012 |
| 9 | Start/complete/verify are idempotent via guarded UPDATEs | Duplicate actions must never overwrite original facts or duplicate side effects | Phase 2 §48 |
| 10 | Module-neutral formatters moved to `apps/web/src/shared/format.ts`, Complaint re-exports them | Retires the shared-formatter debt with zero behaviour change and no churn | Debt register |

## 2026-08-20 — Phase 3 (Workforce / HR Core)

| # | Decision | Reason | Reference |
|---|---|---|---|
| 1 | Built under the frozen target architecture (`modules/workforce/core/...`) | Second proof that new modules follow the target; Phase 0/1 code left untouched | Blueprint §11A |
| 2 | **Employee is not a system user**: `user_id` nullable, one-to-one per tenant via partial unique index | An employee may have no login; Identity remains a separate domain and Workforce never becomes an auth system | HR-CORE-008 |
| 3 | Linking/unlinking a user account never creates, modifies, or deactivates it | Hidden destructive side effects across domain boundaries are prohibited | Phase 3 §23/§24 |
| 4 | Current placement lives on `employees`; every period lives in `employee_assignments` with a partial unique index on the open row | History must be preserved without adopting a full temporal database | HR-CORE-003/007 |
| 5 | Organisation is referenced, never duplicated; `RbacService.isOrganizationUnitScopeCovered` made public | List filtering must reuse the platform's hierarchical scope rule instead of re-deriving it | HR-CORE-009, ADR-0009 |
| 6 | A transfer is scope-checked at the DESTINATION unit too | Otherwise Data Scope could be escaped by moving an employee out of it | HR-CORE-009 |
| 7 | Separate `workforce.documents.read` capability for employee documents | Employment documents are more sensitive than ordinary business records; `workforce.read` alone must not grant them | HR-CORE-006, Phase 3 §19 |
| 8 | Employment STATUS is a finite Core value; employment TYPE is Reference Data | Status drives behaviour; type is client vocabulary | HR-CORE-002, Phase 3 §16 |
| 9 | No Workflow Engine for employee master-data CRUD | Workflow must not be used merely because it exists; Core HR has no approval lifecycle | Phase 3 §22 |
| 10 | Ending employment sets an effective end and preserves history; no hard delete | Business history and downstream references must survive | Phase 3 §23/§47 |
| 11 | Deliberate data minimisation: no statutory, tax, banking, medical, biometric, or family fields | Workforce Core must stay internationally reusable and privacy-respecting | Phase 3 §10/§40 |
| 12 | Calendar dates handled as plain `YYYY-MM-DD` strings, never via `toISOString()` | pg returns `date` at local midnight; UTC conversion shifted dates by a day (bug found in testing) | Phase 3 bug fix |

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

# HANDOFF — Abixell One (9Router-CX)

| | |
|---|---|
| Tanggal handoff | 2026-08-21 |
| Repository aktif | `abixell-one` |
| Branch / HEAD | `master` @ `05a6b5a` |
| Status repo | Ada untracked files, tidak ada tracked change yang termodifikasi |
| Sumber utama | `README.md`, `docs/canonical/*`, `docs/decision-log.md`, `docs/adr/*`, `git log`, `git status`, source code aktif |
| Catatan | `CLAUDE.md` tidak ditemukan di repo ini |

## 1. Tujuan project

Abixell One adalah sistem manajemen enterprise terintegrasi milik Insting Tekno Sinergi dengan positioning internal sebagai *Whitelabel Integrated Enterprise Management System*. Tujuan utamanya adalah menyediakan satu platform inti yang bisa dikonfigurasi per klien dan di-deploy secara dedicated per klien, sambil menjaga agar istilah internal seperti `whitelabel`, `shared core`, atau `reusable platform` tidak pernah muncul di artefak yang menghadap klien.

Secara produk, repo ini menggabungkan Platform Core, Business Core modules, dan sebagian Advanced Capability. Dokumen kanonis menegaskan bahwa implementasi saat ini sudah melampaui fondasi Phase 0/1 dan telah menyelesaikan domain tambahan sampai Finance Core.

## 2. Arsitektur dan teknologi

Arsitektur repo berbentuk monorepo npm workspaces:

- `apps/api`: backend Node.js + TypeScript + Fastify
- `apps/web`: frontend React + Vite + TypeScript + Tailwind CSS
- `packages/contracts`: kontrak shared lintas backend/frontend

Teknologi dan keputusan utama:

- Database: PostgreSQL
- Akses data dan migrasi: `pg` + `node-pg-migrate`
- Auth: JWT access token + refresh token, dengan sesi frontend disimpan di `localStorage`
- Testing backend: Vitest
- E2E smoke frontend: Playwright
- Linting/typecheck: ESLint + TypeScript strict

Arsitektur kode backend bersifat campuran:

- `apps/api/src/application/*` menampung kode Phase 0–1 yang masih berstruktur layer-first
- `apps/api/src/modules/*` menampung modul Phase 2+ dengan arah arsitektur module-first
- `apps/api/src/composition-root.ts` menjadi titik wiring dependency utama

Dokumen blueprint menyatakan target jangka panjang untuk kode baru adalah struktur `modules/<module>/core|advanced|packs`, sementara migrasi kode lama dilakukan bertahap dan sengaja ditunda bila belum memberi manfaat perilaku.

## 3. Pekerjaan yang sudah selesai

Berdasarkan `git log` dan `docs/canonical/product-progress.md`, pekerjaan yang sudah selesai mencakup:

- Phase 0: Enterprise Core Foundation
- Phase 1: Customer Complaint Management + Survey & Assessment
- Phase 2: Service Operations Core
- Phase 3: Workforce Core
- Phase 4: Supply Chain Core
- Phase 5: Asset Core
- Phase 6: Finance Core

Commit HEAD saat ini:

```text
05a6b5a Phase 6: Finance Regression and Closure
317f1c2 Phase 6: Finance Experience
f901de5 Phase 6: Finance Core Foundation
```

Progress kanonis yang tercatat pada 2026-08-20:

- Core Product Readiness: `74.1%`
- Full Approved Roadmap Progress: `38.2%`
- Measured at: `317f1c2`
- Bukti teknis: `234/234 tests`, `78 tables`, `19 migrations`

## 4. Perubahan yang belum di-commit

Hasil status git saat peninjauan:

- Tidak ada tracked file yang `modified` atau `staged`
- Ada beberapa file `untracked`

Untracked file yang terlihat:

- `TOOL_TEST_OMNIROUTE.txt`
- `docs/HANDOFF-9ROUTER-CC.md`
- `docs/HANDOFF-OMNIROUTE.md`
- `docs/HANDOFF-9ROUTER-CX.md` setelah file ini dibuat

Artinya, codebase yang sudah terlacak git berada pada kondisi stabil terhadap HEAD, tetapi workspace bukan `clean working tree` karena ada dokumen/artefak lokal yang belum di-add.

## 5. File penting dan fungsinya

Dokumen produk dan kontrol perubahan:

- `README.md`: ringkasan project, aturan istilah client-facing, layout repo, dan perintah awal
- `docs/canonical/documentation-map.md`: peta otoritas dokumen
- `docs/canonical/product-blueprint.md`: struktur produk, layer, dan aturan arsitektur repo
- `docs/canonical/product-roadmap.md`: fase, unit roadmap, dependensi, dan urutan delivery
- `docs/canonical/product-progress.md`: angka progres resmi yang dipakai sebagai sumber kebenaran
- `docs/decision-log.md`: keputusan implementasi dari checkpoint awal sampai fase-fase berikutnya
- `docs/adr/*.md`: keputusan arsitektur yang sifatnya mengikat
- `docs/technical-debt-register.md`: daftar utang teknis dan hardening yang belum selesai
- `docs/implementation-notes.md`: detail implementasi per checkpoint/fase

File kode yang sangat penting:

- `apps/api/src/main.ts`: entry point backend
- `apps/api/src/app.ts`: registrasi plugin Fastify, middleware, dan route groups
- `apps/api/src/composition-root.ts`: wiring service, repository, dan modul; titik rawan bila menambah modul baru
- `apps/api/src/application/rbac/*`: RBAC, permission, dan data scope
- `apps/api/src/application/workflow/*`: workflow engine generic
- `apps/api/src/application/configuration/*`: configuration/metadata engine
- `apps/api/src/application/document/*`: document service dan authorization resolver
- `apps/api/src/application/survey-integration/*`: orkestrasi Survey-to-Action
- `apps/api/src/modules/service-operations/*`, `workforce/*`, `supply-chain/*`, `asset/*`, `finance/*`: implementasi domain Business Core Phase 2–6
- `apps/api/migrations/*`: single stream migrasi database
- `apps/api/scripts/seed.ts`: bootstrap tenant/demo data
- `apps/api/scripts/sync-role-permissions.ts`: sinkronisasi permission untuk role full-access
- `apps/web/src/*`: antarmuka pengguna React/Vite
- `infra/postgres/docker-compose.yml`: database dev lokal

## 6. Keputusan teknis

Keputusan teknis yang paling terlihat konsisten di repo dan dokumen:

- Fastify dipilih sebagai framework HTTP backend
- Prisma tidak dipakai; repo memakai `pg` + `node-pg-migrate`
- Monorepo dijaga sederhana dengan npm workspaces, tanpa Nx/Turborepo
- Permission tidak di-embed ke JWT; authorization efektif diambil ulang dari database
- Password hashing memakai `bcryptjs`, bukan dependency native
- Data scope berkembang menjadi model hierarkis dan multi-dimensi
- Attachment/document mengikuti authorization parent entity, bukan berdiri sendiri
- Workflow engine dibuat generic dan dipakai lintas domain
- Nilai uang di Finance dijaga pada `numeric(18,2)` dan representasi string, bukan floating point biner
- Event bus, scheduler, dan beberapa automation masih berbasis in-process
- Session frontend disimpan di `localStorage`; ini keputusan sadar, bukan kebetulan implementasi
- Kode baru diarahkan ke arsitektur module-first, tetapi restrukturisasi besar kode lama sengaja tidak dipaksa sekaligus

## 7. Masalah yang belum selesai

Berdasarkan `docs/canonical/product-progress.md`, `README.md`, dan `docs/technical-debt-register.md`, area yang masih terbuka meliputi:

- Platform Hardening belum selesai dan masih menjadi penghambat pilot gate
- CI/CD pipeline belum ada
- CORS masih perlu diarahkan ke allowlist yang eksplisit
- Ada N+1 risk pada sebagian alur operasional
- Advisory dependency frontend masih perlu dievaluasi/remediasi
- PWA hardening belum sepenuhnya lengkap
- Outbox/reliable delivery untuk event/integration belum final
- Scheduler masih in-process dan tidak tahan restart seperti job runner yang dedicated
- Beberapa endpoint lama masih cenderung create/read oriented; update, soft-delete, atau admin tooling belum lengkap di semua area
- Masih ada modul roadmap yang belum dimulai: HSE, Project Delivery, Reporting & Operational Insight, serta sisa Customer & Commercial

## 8. Test/build command

Perintah utama dari repo:

```bash
npm install
npm run db:up
npm run migrate -w apps/api
npm run seed -w apps/api
npm run dev:api
npm run dev:web
```

Build, quality, dan test:

```bash
npm run build
npm run lint
npm run typecheck
npm test
```

Perintah spesifik workspace:

```bash
npm run build -w apps/api
npm run build -w apps/web
npm run migrate -w apps/api
npm run seed -w apps/api
npm run sync-permissions -w apps/api
cd apps/web && npm run e2e
```

Catatan penting:

- `apps/api` memakai `cross-env SCHEDULER_DISABLED=true vitest run` untuk test backend
- `apps/web` menyediakan smoke test berbasis Playwright
- README menyebut demo login setelah seed untuk tenant `demo-gs`

## 9. Langkah berikutnya

Langkah paling aman berikutnya, mengikuti roadmap dan kondisi repo:

- Mulai Phase 7: HSE Core
- Jalankan paralel Platform Hardening agar pilot gate tidak terus tertahan
- Pertahankan pola module-first untuk domain baru
- Tambahkan test coverage untuk area yang masih ditandai sebagai debt/hardening
- Hindari restrukturisasi besar Phase 0–1 sekaligus; lakukan bertahap saat ada pekerjaan yang memang menyentuh area itu
- Saat menambah modul baru, selalu update `composition-root.ts`, migrasi, permission, seed, dan test

## 10. Risiko dan hal yang tidak boleh diubah

Risiko tinggi:

- Mengubah dokumen kanonis tanpa proses yang benar akan membuat angka progres dan arah roadmap tidak sinkron
- Mengedit migrasi yang sudah menjadi bagian stream aktif berisiko merusak jejak skema
- Mengubah wiring di `composition-root.ts` tanpa verifikasi penuh dapat memutus dependency runtime
- Menambah side effect kritis di atas event bus in-process tanpa outbox yang proper berisiko kehilangan eksekusi
- Mengubah aturan auth/authorization tanpa memahami ADR dan decision log berisiko membuka akses lintas scope

Hal yang tidak boleh diubah sembarangan:

- Jangan menampilkan istilah internal seperti `whitelabel` pada artefak client-facing
- Jangan mengganti keputusan data uang menjadi float
- Jangan membangun state machine domain baru yang menyalahi pola workflow engine generic tanpa keputusan arsitektural baru
- Jangan memindahkan atau merombak dokumen kanonis dan ADR tanpa audit, karena file-file itu menjadi acuan eksplisit repo
- Jangan melakukan big-bang refactor struktur kode lama hanya demi kerapian bila tidak ada manfaat perilaku yang nyata
- Jangan menganggap `CLAUDE.md` sebagai sumber aturan repo ini, karena file tersebut tidak tersedia di repository aktif yang ditinjau

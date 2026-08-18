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

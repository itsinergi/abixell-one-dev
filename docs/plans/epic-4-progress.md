# Epic 4 Progress

## 2026-09-27–2026-09-28 — Gelombang 1-4 Implementation Complete

**Status**: Complete sampai UI/UX, gate verification passed.  
**Work**: CORE-ROADMAP.md §4.4 Gelombang 1-4 implementation per locked specification.

## Summary

User, Role & Permission Configuration UI implemented across four waves:

- **Gelombang 1** (2026-09-27): Role definition CRUD, permission picker, Copy Role detached, edit dengan impact preview, Window access config (langkah 11a), penegakan baca-saja per Window (langkah 11b)
- **Gelombang 2** (2026-09-28): User-centric + assignment-centric UI, create user + batch assignment, scope picker server-side visibility
- **Gelombang 3** (2026-09-28): Revocation lifecycle, audit history, authorization-effective view
- **Gelombang 4** (2026-09-28): Module feedback hardening, empat penolakan terbedakan, regression matrix, dua permukaan satu kebijakan

Customer scope wawancara juga selesai 2026-09-28 (enam keputusan terkunci). Sisa satu-satunya bukan pekerjaan Epic 4: filter permukaan internal customer, menunggu modul Service Operation.

## Evidence

### Migrations

Eleven migrations executed (verified in master):

1. `1787700000000_epic-4-wave-1-role-definition.cjs`
2. `1787800000000_epic-4-wave-1-role-window-access.cjs` — `role_window_access`
3. `1788000000000_epic-4-wave-1-role-definition-api-resources.cjs`
4. `1788100000000_epic-4-wave-1-role-definition-route-window.cjs`
5. `1788200000000_epic-4-wave-3-assignment-revocation.cjs` — `revoked_at`/`revoked_by`/`revoke_reason`, partial unique index, monotonic trigger
6. `1788300000000_epic-4-open-item-1-role-description.cjs`
7. `1788400000000_epic-4-open-item-2-role-deactivation.cjs`
8. `1788500000000_epic-4-customer-scope-exclusivity.cjs` — trigger `enforce_customer_scope_exclusivity`
9. `1788600000000_epic-4-open-item-2-lifecycle-route.cjs`
10. `1788700000000_epic-4-closeout-assignment-routes.cjs`

### Tests — All Passing (database terisolasi `abixell_one_epic3_wave4`)

- `role-definition.test.ts` — 18/18 (setelah penutupan item terbuka, naik dari 14/14)
- `window-enforcement-unit.test.ts` — 32/32 (matriks aturan + sensus tanpa DB)
- `window-enforcement-coverage.test.ts` — 8/8 (enumerasi route via onRoute, 4 arah gagal)
- `window-enforcement.test.ts` — 9/9 (end-to-end termasuk header karangan browser diabaikan)
- `admin-access-management.test.ts` — 31/31
- `epic4-wave3-revocation.test.ts` — 10/10 (retensi baris, provenance, double-revoke 409, self-revoke 409)
- `epic4-wave4-hardening.test.ts` — 9/9 (parity pesan modul, empat penolakan, regression matrix, identitas dua permukaan)
- `dictionary-seed-parity.test.ts` — 7/7

**Total**: 124 tests passing across 8 files.

### Window Enforcement Coverage

- 909 route dilayani; 340 penulis.
- 334 route penulis terkunci ke 47 Window (14 modul).
- 6 sisanya di `WINDOW_ENFORCEMENT_EXEMPTIONS` dengan sifat dapat difalsifikasi.
- `enforcementStatus` = `"enforced"` (0 route tak terhitung).

### Code Quality

- **Typecheck**: 0 errors (`apps/api`, `apps/web`)
- **Cacat ditemukan & diperbaiki saat uji**: dua lookup target jalur tulis belum memfilter `revoked_at IS NULL` (Gelombang 4 langkah 25) — diperbaiki, ketiga lookup (grant/batch/revoke) kini konsisten.

## Completion Gate (§4.4)

✓ Super Admin dapat membuat, menyalin, mengubah, menghapus role sesuai guardrail.  
✓ Admin Tenant hanya melihat target dalam scope; tidak dapat memperluas otoritas sendiri.  
✓ Permission picker hanya menampilkan fungsi modul aktif.  
✓ Role dapat dikonfigurasi dan dikunci per Window (11a/11b terpenuhi).  
✓ `window_code` selalu dari resolusi server, tidak pernah dari browser.  
✓ Copy Role tidak membawa user/assignment.  
✓ Edit Role menampilkan impact preview sebelum commit.  
✓ Assignment dikelola dari dua permukaan dengan policy sama.  
✓ Revoke menghentikan effective access tanpa logout; histori tetap terlihat.  
✓ Audit mencatat actor, target, role, scope, before/after.  
✓ Customer scope tetap tertutup di UI sampai wawancara Service Operation selesai.  
✓ Test dijalankan pada database terisolasi.

## Sign-Off

All gates passed. Epic 4 Gelombang 1-4 ready to merge.

**Implementation completed**: 2026-09-28.

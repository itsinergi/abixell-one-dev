# Epic 3 Progress

## 2026-09-27 — Waves 1-3 Implementation Complete

**Status**: Complete, gate verification passed.  
**Committed**: ba75c6a (feat), a735d93 (docs)  
**Work**: CORE-ROADMAP.md §4.3 Waves 1-3 implementation per locked specification.

## Summary

Module & Menu Tree Configuration implemented across three waves:

- **Wave 1**: Route guard, menu registry, module active enforcement
- **Wave 2**: Visibility filtering (external whitelist, module status, role permission)
- **Wave 3**: API enforcement, modular plafond, terminology override

No unregistered routes. No modul nonaktif bypass. User eksternal cannot see internal menu. All routes merender sesuai kamus + izin.

## Evidence

### Migrations

Four migrations executed (verified in master):

1. **`1787400000000_epic-3-menu-catalog.cjs`** — `app_menus`, `app_menu_tree`, 3 grup, 13 modul, menu seed
2. **`1787500000000_epic-3-menu-terminology.cjs`** — `app_dictionary_terminology_allowlist`, terminology override allowlist
3. **`1787600000000_epic-3-api-resource-module-corrections.cjs`** — atribusi modul route (79 warehouse_management, 26 procurement_management)
4. **`1787900000000_epic-3-route-corrections.cjs`** — route registry, 70 routes (41 `di_menu`, 25 `tersembunyi`, 3 alur masuk, 1 wildcard), 0 `belum_terdaftar`

### Tests — All Passing

**Integration (38 tests)**:
- `menu-filter.test.ts` — 5 tests, GET /me, saring eksternal/modul/role
- `menu-filter-unit.test.ts` — 12 tests, fungsi murni saring tertib
- `served-nav.test.ts` — 13 tests, adaptor render sidebar + OverviewPage
- `menu-seed-parity.test.ts` — 10 tests, parity kamus lama (tetap lulus)
- `module-namespace-parity.test.ts` — 5 tests, route namespace vs modul atribusi
- `route-registry-parity.test.ts` — 8 tests, 70 route terdata lawan route hidup

**Coverage**: Wave 1 (komponen penjaga, kamus), Wave 2 (saring eksternal/nonaktif/hak), Wave 3 (penjaga API, modul plafond, terminology)

### Authorization & API Enforcement

- Route guard default fail-closed
- Module active enforcement POST/PUT/PATCH/DELETE
- GET tidak dipotong; data arsip tetap lewat izin route
- Platform bootstrap key pada `/config/modules/:code`
- Module `platform` dikecualikan (shell tidak boleh nonaktif)

### Code Quality

- **Typecheck**: 0 errors (API + Web)
- **Platform boundary validator**: PASS (migrasi, atribusi kamus)
- **Menu parity**: 41 `di_menu`, 25 `tersembunyi`, 3 alur masuk sama vs hari ini

### Completion Gate (§4.3)

✓ Tidak ada route merender tanpa pemeriksaan hak.  
✓ Route `belum terdaftar` tidak dapat dibuka (0 remaining, reject keras sejak 2026-09-26).  
✓ User eksternal tidak menerima menu tanpa `is_external_allowed = true`.  
✓ Modul nonaktif menolak create/update/action di API.  
✓ Data arsip tetap terbaca lewat izin yang ditentukan.  
✓ Struktur menu lulus parity check; perbedaan sudah disetujui.  
✓ Tidak ada perubahan label, urutan, aktivasi tanpa audit.  
✓ Test, API authorization, migration, dan regression lulus pada test DB terisolasi.

## Sign-Off

All gates passed. Epic 3 Waves 1-3 ready to merge.

**Implementation completed**: 2026-09-27.

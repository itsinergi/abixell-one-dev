
# Epic 6 Progress

## 2026-09-30 — Gelombang 0-1 Implementation Complete

**Status**: Complete untuk Gelombang 0-1, gate verification passed. Gelombang 2-4 menjadi pekerjaan berikutnya.
**Committed**: 270aa5a — `feat(core): Epic 6 Gelombang 0-1 — Business Partner schema + CRUD + lifecycle`
**Work**: CORE-ROADMAP.md §4.6 Gelombang 0-1 implementation per locked specification.
**Preparation**: Scope, gates, dependencies, dan urutan kerja Gelombang 2-4 dicatat di `docs/plans/epic-6-g2-4-preparation.md`.

## Summary

User Identity, Employee, Business Partner & Assignment — Gelombang 0 (kontrak + migrasi aman) dan Gelombang 1 (Business Partner foundation) implemented.

- **Gelombang 0**: istilah canonical, inventaris resource identity, field sensitivity + audit contract, compatibility/reconciliation plan
- **Gelombang 1**: Business Partner Individual/Organization + lifecycle, role profiles, Contact, Address, Business Partner Group, classifications, alias/history; aturan BP lebih dahulu sebelum User/role bisnis

Gelombang 2-4 (Employee placement, User + Role Assignment chain, Tax Registration/import/merge) **belum dikerjakan**.

## Evidence

### Migrations

Nine migrations executed (verified in master):

1. `1790000000000_epic-6-g0-1-business-partners.cjs` — Business Partner canonical (Individual/Organization)
2. `1790100000000_epic-6-g0-2-bp-roles.cjs` — role profiles (Employee, Customer, Vendor/Supplier, dll.)
3. `1790200000000_epic-6-g0-3-bp-contacts.cjs` — Contact
4. `1790300000000_epic-6-g0-4-bp-addresses.cjs` — Address
5. `1790400000000_epic-6-g0-5-tax-registrations.cjs` — Tax Registration collection (fondasi)
6. `1790500000000_epic-6-g0-6-users-link-to-bp.cjs` — User link ke Business Partner
7. `1790600000000_epic-6-g0-7-permissions.cjs` — permission BP
8. `1790700000000_epic-6-g0-8-employee-profiles.cjs` — Employee Profile
9. `1790800000000_epic-6-g0-dictionary-seed.cjs` — kamus

Semua child table memakai composite FK `(tenant_id, parent_id)`, membuat kepemilikan lintas tenant tidak dapat direpresentasikan di schema. Tenant isolation ditegakkan di schema (composite FK) dan app layer (semua query filter `tenant_id`).

### Code

- `apps/api/src/domain/business-partner/business-partner.entity.ts`
- `apps/api/src/application/business-partner/business-partner.service.ts`
- `apps/api/src/infrastructure/persistence/repositories/business-partner.repository.pg.ts`
- `apps/api/src/interfaces/http/routes/business-partners.ts`
- Wiring: `composition-root.ts`, `app.ts`
- `apps/api/src/domain/configuration/module-attribution.ts`, `window-enforcement.ts` — diperbarui untuk modul Business Partner

### Tests — Passing

**`epic-6-g1-business-partner.test.ts`**: 435 tests — CRUD, lifecycle transition, role flags (DB-dependent).

## Completion Gate — Status Parsial (§4.6)

Gate penuh Epic 6 mencakup 23 kriteria lintas Gelombang 0-4. Yang **terpenuhi** oleh Gelombang 0-1:

✓ Business Partner canonical mendukung Individual dan Organization.
✓ Business Partner wajib ada sebelum User, Employee, Customer, Vendor, Contact.
✓ Employee adalah role Business Partner Individual dengan Employee Profile.
✓ Customer, Vendor/Supplier, dll. menjadi role Business Partner.
✓ Business Partner Code unik per Tenant.
✓ Seluruh test memakai database terisolasi, bukan `abixell_one_dev`.

Yang **belum terpenuhi** (Gelombang 2-4, belum dikerjakan):

✗ Primary/secondary placement effective-dated (Gelombang 2).
✗ User type, invitation lifecycle, Role category, assignment lifecycle (Gelombang 3).
✗ Delegation guardrail dan same-assignment enforcement (Gelombang 3).
✗ Tax Registration collection lengkap + NPWP/NITKU default Indonesia (Gelombang 4).
✗ Template import Excel/CSV + partial success per aggregate (Gelombang 4).
✗ Merge/split dengan preview, audit, tombstone/alias (Gelombang 4).
✗ Data sensitif Employee tidak tampil di projection/export umum — belum diverifikasi (bergantung Gelombang 2-4).

## Sign-Off

Gelombang 0-1 gates passed untuk ruang lingkupnya. **Epic 6 secara keseluruhan belum selesai** — Gelombang 2-4 adalah pekerjaan terbuka, bukan backlog opsional, karena gate §4.6 eksplisit menuntutnya (placement, User/Role Assignment chain, Tax Registration, merge/split).

**Gelombang 0-1 completed**: 2026-09-30.
**Rekomendasi**: lanjutkan ke Gelombang 2 (Employee placement) sebagai pekerjaan berikutnya pada Epic 6, atau nyatakan eksplisit scope-cut bila founder memutuskan Gelombang 2-4 ditunda.

# Rencana Gelombang: A6 Closure + A7 + A8

| Item | Nilai |
|---|---|
| Dokumen | Rencana gelombang (derivative, bukan kanonik) |
| Baseline | `master` @ `0d511c8` 2026-10-26; 308 / 353 pts (87.3%) — Tahap 1 (A6 closure) selesai |
| Target akhir rencana | 348 / 353 pts (98.6%) |
| Poin yang dicakup | 61 (A6 closure 21 + A7 27 + A8 13) |
| Di luar cakupan | `SO-ADV-006` (5 pts, deferred), Phase 11G, Epic 15 |
| Status otorisasi | Tahap 0 dan Tahap 1 **selesai**. Tahap 2 (A7) **diotorisasi** 2026-10-26 atas direktif Founder. Tahap 3 (A8) belum diotorisasi |
| Dokumen kanonik | `docs/canonical/product-roadmap.md`, `docs/canonical/product-progress.md` |

Dokumen ini menjawab satu pertanyaan: bagaimana 66 poin Advanced yang tersisa dipecah menjadi
work package yang bisa dieksekusi, dengan angka dan batas yang tidak bergerak. Ia tidak
mengubah denominator dan tidak mengklaim satu poin pun.

## 1. Titik awal

| Blok | Pts | State per 2026-10-26 |
|---|---:|---|
| Wave A6 — Finance Advanced | 21 | **21 earned.** Tujuh unit merged, delapan layar terpasang, closure evidence diterima; headline 308 / 353 (87.3%) |
| Wave A7 — Project Delivery + HSE Advanced | 27 | **Diotorisasi 2026-10-26.** Requirement ID ada di PRD; work package ditetapkan di §5 |
| Wave A8 — Platform cross-cutting | 13 | Belum diotorisasi; **tidak ada requirement ID** — hanya tiga frasa kapabilitas di `ROADMAP-TO-100.md` §11 |
| `SO-ADV-006` — Offline Field PWA | 5 | Deferred; ADR-nya harus menimpa tiga requirement DELIVERED (`UX-006`, `UX-007`, `PLT-NFR-002`) |

Baseline runtime yang dipakai sebagai titik ukur (dari build A6, 2026-10-25):

| Item | Nilai |
|---|---|
| Migration head | `1795900000000_wave-a6-2-finance-advanced-write-routes` |
| Jumlah migration | 144 |
| Permission migration-owned | 225 |
| Full API regression | 1465 passed / 27 skipped (5 timeout paralel, lulus saat isolasi) |
| Boundary validator | 0 blocking, 1 advisory (Module Manifest) |

## 2. Aturan poin

- `COMPLETED = full weight`, `IN PROGRESS = 0`, `PLANNED/DEFERRED = 0`. Tidak ada partial credit.
- **Built ≠ earned.** Kode merged tanpa closure evidence bernilai 0 (`POINT-LEDGER.md` §7.1).
- **Persetujuan ADR bernilai 0.** ADR mengotorisasi kerja, bukan menambah poin.
- Poin dihitung **per unit roadmap**, bukan per work package. Beberapa WP berbagi satu unit.
- Tidak ada perubahan denominator tanpa persetujuan scope baru dari Founder.

## 3. Tahap 0 — ADR draft (0 pts, prasyarat A7 dan A8)

| WP | Isi | Keluaran | Status |
|---|---|---|---|
| WP-DOC-A7A8-01 | Lima ADR draft | `docs/adr/0026` … `docs/adr/0030` | **Draft ditulis, `PROPOSED`** |

| ADR | Pertanyaan yang dikunci |
|---|---|
| 0026 | Siapa pemilik jurnal project cost — Project Delivery membuat dokumen, Accounting Kernel tetap satu-satunya penulis GL |
| 0027 | HSE CAPA vs Core follow-up action; permit-to-work lewat Workflow Engine; risk matrix tersimpan per asesmen |
| 0028 | Partner API: prefix berversi, kredensial mesin terpisah, tenant diturunkan dari kredensial, subset terdaftar |
| 0029 | Batas data AI: assistive-only, tanpa lintas tenant, tanpa training atas data tenant, opt-in fail-closed |
| 0030 | Marketplace: unit distribusi adalah manifest, komposisi statis lewat ADR-0014, tanpa kode eksekutabel |

ADR-0026 adalah yang memblokir A7: tanpa jawaban kepemilikan, `PRJ-ADV-008` tidak bisa dibangun
tanpa menduplikasi ledger.

## 4. Tahap 1 — Wave A6 closure (21 pts → 308 / 353 = 87.3%)

Enam unit sudah built. Yang ditambahkan hanya layar, menu, dan closure evidence. Tidak ada
perubahan skema kecuali menu catalog.

| WP | Unit | Pts | Isi |
|---|---|---:|---|
| WP-FIN-A6-07 | FIN-ADV-001 | 5 | Layar COA builder, daftar/detail jurnal, post/reverse, trial balance |
| WP-FIN-A6-08 | FIN-ADV-002 | 3 | Layar AP/AR open-item + aging |
| WP-FIN-A6-09 | FIN-ADV-003 | 3 | Layar budget control + accounting dimensions |
| WP-FIN-A6-10 | FIN-ADV-004 | 2 | Layar bank reconciliation |
| WP-FIN-A6-11 | FIN-ADV-005 | 3 | Layar asset book + depreciation run |
| WP-FIN-A6-12 | FIN-ADV-006/007/008 | 5 | Layar tax, consolidation, financial statements |
| WP-FIN-A6-13 | — | 0 | Menu catalog + navigasi Finance Advanced (migration baru) |
| WP-FIN-A6-14 | semua | 0 | `docs/closure-evidence-wave-a6.md` ditulis ulang per unit + rekonsiliasi kanonik |

Halaman web mengikuti pola yang sudah ada: `apps/web/src/modules/finance/*.tsx` dan route di
`apps/web/src/App.tsx`. Satu WP satu PR, satu PR satu commit `feat(wave-a6): …`.

Batas yang berubah: `docs/closure-evidence-wave-a6.md:29` menyatakan layar Finance Advanced
adalah batas A6.1, bukan gap A6. Rencana ini menjadikan batas itu pekerjaan, bukan alasan
menunda klaim. Setelah WP-FIN-A6-07…13 selesai, pernyataan itu harus diperbarui.

## 5. Tahap 2 — Wave A7 (27 pts → 335 / 353 = 94.9%)

| WP | Unit | Pts | Isi |
|---|---|---:|---|
| WP-PRJ-A7-01 | PRJ-ADV-001/002 | 5 | WBS hierarki, dependensi aktivitas, critical path |
| WP-PRJ-A7-02 | PRJ-ADV-003 | — | Gantt; earned bersama unit 5 pts di atas |
| WP-PRJ-A7-03 | PRJ-ADV-004/005 | 3 | Resource loading + levelling, baseline + variance |
| WP-PRJ-A7-04 | PRJ-ADV-006/007 | 5 | Earned value + cost control |
| WP-PRJ-A7-05 | PRJ-ADV-008 | — | Project accounting lewat Accounting Kernel; bagian dari unit 5 pts di atas |
| WP-HSE-A7-01 | HSE-ADV-001 | 5 | Investigasi terstruktur + RCA |
| WP-HSE-A7-02 | HSE-ADV-002 | — | JSA/HIRA + risk matrix; earned bersama unit 5 pts di atas |
| WP-HSE-A7-03 | HSE-ADV-003 | 3 | Permit to Work (workflow-delegated) |
| WP-HSE-A7-04 | HSE-ADV-004 | 3 | Inspection & audit programmes |
| WP-HSE-A7-05 | HSE-ADV-005 | 3 | Environmental monitoring |
| WP-HSE-A7-06 | HSE-ADV-006 | — | Formal CAPA; earned bersama unit 3 pts di atas |
| WP-HSE-A7-07 | HSE-ADV-007 | — | Safety indicators + dashboard; idem |
| WP-A7-08 | — | 0 | Closure evidence + rekonsiliasi kanonik A7 |

PRJ 5+3+5 = 13, HSE 5+3+3+3 = 14. Total 27.

## 6. Tahap 3 — Wave A8 (13 pts → 348 / 353 = 98.6%)

| WP | Unit | Pts | Isi |
|---|---|---:|---|
| WP-PLT-A8-00 | — | 0 | **Dekomposisi PRD**: tulis `PLT-ADV-001…003` di `docs/prd/abixell-one/06-advanced-capabilities.md` + traceability |
| WP-PLT-A8-01 | PLT-ADV-001 | 3 | Partner API surface (memakai `INT-012`) |
| WP-PLT-A8-02 | PLT-ADV-002 | 5 | AI readiness: sentiment, summarization, assistive automation |
| WP-PLT-A8-03 | PLT-ADV-003 | 5 | Marketplace & ecosystem |
| WP-PLT-A8-04 | — | 0 | Closure evidence + rekonsiliasi kanonik A8 |

`WP-PLT-A8-00` adalah satu-satunya pekerjaan yang menambah teks requirement baru. Itu **bukan**
penambahan denominator: tiga unit 3/5/5 sudah ada di `product-roadmap.md` §9 dan
`POINT-LEDGER.md` §5 sejak baseline. Yang dibuat hanyalah ID dan teks requirement untuk unit
yang sudah berpoin.

## 7. Risiko

| # | Risiko | Mitigasi |
|---:|---|---|
| 1 | A8 tanpa requirement ID → scope creep | `WP-PLT-A8-00` mengunci teks requirement sebelum kode; denominator tidak bergerak |
| 2 | Project accounting menduplikasi GL | ADR-0026: Accounting Kernel satu-satunya penulis jurnal |
| 3 | HSE CAPA tertukar dengan Core follow-up action | ADR-0027: dua agregat terpisah, CAPA tidak pernah memutasi Core |
| 4 | AI readiness membocorkan data lintas tenant | ADR-0029: tanpa training atas data tenant, tanpa lintas tenant, opt-in fail-closed |
| 5 | Marketplace menyeret client extension ke core | ADR-0030 berlabuh pada ADR-0014 (static package, governed builder) |
| 6 | Enam layar A6 dalam satu tahap menjadi PR besar | satu WP satu PR; menu catalog WP terpisah |
| 7 | `SO-ADV-006` dianggap bagian gelombang ini | Dinyatakan di luar cakupan; butuh ADR yang menimpa `UX-006`, `UX-007`, `PLT-NFR-002` |

## 8. Gate verifikasi per WP

Nama script persis dari `package.json`:

```bash
npm run validate:platform-boundaries
npm run lint
npm run typecheck
npm run test -w apps/api
npm run build
npm run validate:pwa
```

WP yang menyentuh migration atau permission menambah `npm run validate:platform-boundaries`
dengan hasil `0 blocking` dan jumlah permission migration-owned yang dinyatakan. WP penutup
gelombang menambah full API regression, dengan jumlah skip dinyatakan terpisah.

## 9. Aritmetika target

```text
Baseline                287 / 353 = 81.3%
+ A6 closure (21)       308 / 353 = 87.3%   SELESAI — diklaim 2026-10-26
+ A7 (27)               335 / 353 = 94.9%   target Tahap 2, belum diklaim
+ A8 (13)               348 / 353 = 98.6%   target Tahap 3, belum diotorisasi
+ SO-ADV-006 (5)        353 / 353 = 100.0%   (di luar rencana ini)
```

Baris A6 di atas adalah **klaim yang sudah diterima**. Baris A7 dan A8 tetap **target**, bukan
klaim: tidak satu poin pun bertambah sampai closure evidence unit A7 diterima.

## 10. Hubungan dengan dokumen kanonik

- `docs/canonical/product-progress.md` — angka kanonik tidak disentuh oleh dokumen ini.
- `docs/canonical/product-roadmap.md` — bobot unit tidak berubah.
- `docs/ROADMAP-TO-100.md` — urutan gelombang dan state otorisasi.
- `docs/POINT-LEDGER.md` — built vs earned per unit.

Dokumen ini tidak menggantikan satu pun dari keempatnya.

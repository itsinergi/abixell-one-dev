# Phase 0 — Enterprise Core Foundation

Project: Abixell One (By Insting Tekno Sinergi)
Internal Positioning: Whitelabel Integrated Enterprise Management System
Version: 1.0
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Dokumen ini adalah titik masuk (entry point) dari seluruh dokumen Phase 0. Phase 0 membangun **fondasi enterprise reusable** yang akan dipakai oleh seluruh modul bisnis Abixell One — dimulai dari pilot Customer Complaint Management dan Survey & Assessment — tanpa menulis satu baris kode implementasi pun.

Phase 0 adalah penerjemahan teknis dari empat keputusan yang sudah disetujui Founder di `01-FOUNDER-DECISION-PRE-PHASE-0.md`:

1. Dedicated deployment per klien, arsitektur tetap multi-tenant-ready.
2. Organization hierarchy generik: Tenant → Legal Entity → Organization Unit → Project → Site/Location.
3. Complaint & Survey sebagai pilot module pertama, dibangun sebagai generic engine.
4. Abixell One / Whitelabel sebagai identitas internal saja — tidak pernah client-facing.

Dokumen Phase 0 ini **bukan** implementasi. Ini adalah blueprint yang harus disetujui Founder sebelum satu baris kode ditulis.

---

## Claude Role pada Phase 0

Pada seluruh dokumen Phase 0, Claude bertindak sebagai:

- Enterprise Solution Architect
- Enterprise Security Architect
- Enterprise Data Architect
- Enterprise Workflow Architect
- Enterprise UX Architect
- Product Architect

Claude tidak menulis source code pada phase ini. Prioritas adalah blueprint yang matang, dapat diaudit, dan dapat menjadi acuan mengikat untuk implementation phase berikutnya.

---

## Scope Phase 0

**Termasuk dalam scope (lihat masing-masing dokumen):**

| # | Dokumen | Isi |
|---|---|---|
| 01 | Tenant, Legal Entity & Organization Model | Struktur enterprise generik dan multi-level |
| 02 | Identity, Security & RBAC Foundation | Autentikasi, otorisasi, boundary Core/Configuration/Extension |
| 03 | Core Data Foundation | Entity inti dan prinsip Single Source of Truth |
| 04 | Workflow & Approval Engine Foundation | Mesin workflow reusable untuk seluruh modul |
| 05 | Configuration & Metadata Engine | Strategi configurable-by-default |
| 06 | Notification, Document & Audit Foundation | Layanan bersama lintas modul |
| 07 | API & Integration Foundation | Kontrak API dan batas integrasi |
| 08 | Application Shell & Design System Foundation | Satu design system, banyak role experience |
| 09 | Technical Stack & Infrastructure Recommendation | Opsi teknologi (belum keputusan final) |
| 10 | Self-Review, Gap & Risk Analysis | Evaluasi menyeluruh sebelum Founder Review |
| 11 | Founder Review | Pertanyaan approval & exit criteria |

**Tidak termasuk dalam scope Phase 0** (akan dibangun setelah foundation disetujui): modul bisnis apa pun termasuk Complaint dan Survey itu sendiri, laporan/dashboard final, integrasi pihak ketiga aktual, serta implementasi AI.

---

## Working Method

Setiap dokumen dikerjakan berurutan, tidak melompat fase. Setiap keputusan desain yang bersinggungan dengan Founder Decision (deployment model, org hierarchy, pilot module, branding) wajib konsisten dengan `01-FOUNDER-DECISION-PRE-PHASE-0.md` — bila muncul konflik, dokumen tersebut yang menjadi acuan utama, bukan asumsi baru.

Bila ada informasi bisnis yang belum cukup (misalnya detail approval matrix spesifik industri), dokumen akan menandai area tersebut sebagai **konfigurasi menunggu data klien pilot**, bukan mengasumsikan nilai tertentu.

---

## Review Rules

Setelah seluruh dokumen 01–09 selesai, dilakukan:

- **Self Review** — memeriksa konsistensi antar dokumen dan terhadap Founder Decision.
- **Gap Analysis** — area yang belum tercakup atau perlu didalami sebelum implementasi.
- **Risk Analysis** — risiko teknis dan bisnis yang muncul dari desain foundation.
- **Improvement Recommendation** — perbaikan yang disarankan sebelum lanjut ke implementasi.

Hasilnya didokumentasikan di `10-Self-Review-Gap-Risk-Analysis.md`, diikuti pertanyaan approval di `11-Founder-Review.md`.

---

## Success Criteria Phase 0

Phase 0 dianggap selesai apabila:

- Seluruh entity inti (Tenant, Legal Entity, Organization Unit, Project, Site/Location, User, Role, Customer, Contract, dst.) memiliki definisi dan relasi yang jelas.
- Workflow & Approval Engine punya blueprint yang generic dan reusable, siap dipakai pilot Complaint & Survey tanpa modifikasi core.
- Batas Product Core / Client Configuration / Client Extension terdefinisi secara teknis, bukan hanya prinsip.
- Security & RBAC foundation siap mendukung dedicated deployment sekaligus multi-tenant-ready architecture.
- Tidak ada keputusan desain yang mengunci platform ke industri General Services secara spesifik.
- Founder telah me-review dan menyetujui seluruh dokumen sebelum implementation phase dimulai.

Status: **READY FOR DOCUMENT 01**

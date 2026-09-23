# 01 — Founder Decision: Pre-Phase 0

**Project:** Abixell One — By Insting Tekno Sinergi
**Internal Positioning:** Whitelabel Integrated Enterprise Management System
**Status:** APPROVED FOR PHASE 0 PREPARATION
**Tanggal:** 18 Agustus 2026

Dokumen ini adalah catatan resmi keputusan Founder atas keempat Blocking Decision yang diajukan pada `00-PRE-PHASE-0-SUMMARY.md`. Dokumen ini menjadi acuan mengikat untuk seluruh pekerjaan Phase 0 dan seterusnya.

---

## Decision 1 — Deployment Model

**Keputusan:** Dedicated Deployment per Client. Setiap klien memiliki deployment, konfigurasi, identitas, data, domain, environment, dan kebutuhan operasional yang terisolasi. Namun seluruh source code berasal dari satu reusable product core, dan arsitektur tetap multi-tenant-ready.

**Client-Facing Rule:** Istilah berikut **tidak boleh** muncul di sisi klien — *Whitelabel, Multi-tenant product, Shared product core, Reusable platform, Template platform, Product reused for other clients*. Dari sisi klien, sistem diposisikan sebagai *Enterprise Management System* yang dirancang dan dikonfigurasi secara eksklusif untuk kebutuhan operasional mereka. Klien tidak perlu tahu bahwa fondasi teknologi yang sama dipakai ulang untuk implementasi lain.

**Prinsip internal:** *One Product Core. Dedicated Client Experience.*

---

## Decision 2 — Organization Structure

**Keputusan:** Tidak menggunakan struktur spesifik General Services (`Company → Branch → Project → Site`). Gunakan hierarki enterprise generik:

`Tenant → Legal Entity → Organization Unit → Project → Site / Location`

| Level | Definisi |
|---|---|
| Tenant | Boundary implementasi untuk satu klien |
| Legal Entity | Perusahaan/badan hukum di bawah klien tersebut |
| Organization Unit | Struktur fleksibel: HO, Branch, Division, Department, Business Unit, Area, dst. |
| Project | Kontrak, project, operation, atau engagement sebagai business scope tersendiri |
| Site / Location | Lokasi fisik/operasional: camp, mine site, office, warehouse, factory, kitchen, building, workshop, dll. |

Struktur ini wajib configurable dan tidak boleh mengunci platform ke satu industri.

---

## Decision 3 — Pilot Module

**Keputusan:** Pilot pertama adalah **Customer Complaint Management** dan **Survey & Assessment**, dibangun langsung setelah Enterprise Core Foundation selesai.

Pilot ini sekaligus menjadi uji coba kapabilitas platform reusable: Customer, Contract, Project, Site/Location, User, Role, SLA, Workflow, Assignment, Escalation, Notification, Document/Photo Evidence, Corrective Action, Survey Engine, Reporting, Dashboard, Audit Trail.

Complaint dan Survey **wajib** dibangun sebagai generic enterprise engine yang dapat dipakai ulang di industri dan klien lain — bukan aplikasi yang spesifik untuk General Services.

---

## Decision 4 — Product Name & Positioning

**Keputusan:** Nama internal & engineering: **Abixell One**. Positioning internal: **Whitelabel Integrated Enterprise Management System**. Disetujui sebagai identitas internal untuk development, architecture, documentation, dan product governance.

**Internal use (boleh dipakai secara internal):** Abixell One, Whitelabel, Product Core, Reusable Platform, Multi-client, Multi-tenant-ready, Configuration Layer, Product Architecture.

**Client-facing use — kata "Whitelabel" tidak boleh muncul di:** UI aplikasi klien, login page, mobile/PWA, dashboard, report, PDF, email notification, proposal klien, user manual klien, presentasi klien, domain, footer, metadata aplikasi, dokumentasi teknis client-facing.

Dari sisi klien, sistem diposisikan sebagai **Integrated Enterprise Management System** (atau nama yang disepakati khusus dengan klien) — dirancang, dikonfigurasi, dan diimplementasikan secara eksklusif untuk kebutuhan perusahaan mereka.

**Prinsip arsitektur (internal):** *Build Once. Configure Per Client. Deploy Exclusively.*
**Positioning (client-facing):** *Designed Around Your Business.*

Artinya: source core reusable; client configuration terisolasi; branding, module activation, terminology, workflow, approval matrix, SLA, report, dan dashboard unik per klien; business rules configurable; environment dedicated.

Fork source code per klien dihindari kecuali ada alasan arsitektural yang benar-benar tidak dapat diselesaikan lewat mekanisme extension/configuration.

---

## Additional Founder Direction — Batas Product Core / Configuration / Extension

Phase 0 wajib menegakkan batas tegas antara tiga lapisan:

- **Product Core** — reusable, tidak boleh berubah hanya karena kebutuhan satu klien.
- **Client Configuration** — dapat dikonfigurasi tanpa mengubah core.
- **Client Extension** — dipakai hanya jika kebutuhan klien benar-benar unik dan tidak tepat dimasukkan ke generic core.

Setiap permintaan klien wajib dievaluasi terlebih dahulu: apakah ini *universal capability*, *configurable requirement*, atau *client-specific extension*? Tidak boleh langsung dimasukkan ke core.

---

## Phase 0 Approval

Keempat Blocking Decision telah dijawab. Persiapan **Phase 0 — Enterprise Core Foundation** dapat dilanjutkan dengan ketentuan:

1. Dedicated deployment per klien.
2. Arsitektur multi-tenant-ready.
3. Organization hierarchy generik (Tenant → Legal Entity → Organization Unit → Project → Site/Location).
4. Complaint & Survey sebagai pilot module pertama, dibangun generic.
5. "Abixell One" sebagai internal product identity.
6. "Whitelabel" hanya untuk konteks internal — tidak pernah client-facing.
7. Implementasi client-facing harus memberi persepsi solusi eksklusif.
8. Reusable core dan client-specific configuration dipisahkan secara tegas (Core / Configuration / Extension).

**Founder Decision Status: APPROVED**

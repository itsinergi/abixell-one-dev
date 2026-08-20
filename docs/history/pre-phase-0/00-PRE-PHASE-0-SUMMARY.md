# 00 — Preparation Summary Sebelum Phase 0

**Abixell One** — By Insting Tekno Sinergi
**Positioning:** Whitelabel Integrated Enterprise Management System
**Status:** Draft untuk review & approval Founder — belum masuk development
**Tanggal:** 18 Agustus 2026

---

## 1. Executive Summary

Abixell One adalah platform manajemen enterprise yang dirancang untuk digunakan berulang kali oleh banyak klien dan banyak industri, bukan aplikasi yang dibangun khusus untuk satu perusahaan. Konsepnya sederhana: satu produk inti yang solid, dikonfigurasi ulang untuk tiap klien — bukan satu produk yang di-*fork* dan ditulis ulang setiap kali ada klien baru.

Positioning produk adalah *Whitelabel Integrated Enterprise Management System*. Artinya Abixell One bukan ERP, bukan HRIS, bukan CRM tunggal — melainkan kerangka enterprise yang bisa "dipakaikan baju" berbeda-beda (nama, logo, tema, modul aktif, terminologi) sesuai klien, sambil tetap berbagi satu mesin inti yang sama di baliknya.

Tujuan Phase 0 adalah membangun fondasi ini terlebih dahulu: sistem autentikasi, struktur perusahaan/tenant, mesin workflow, mesin konfigurasi, kerangka keamanan, dan kerangka tampilan — sebelum satu pun modul bisnis (Complaint, Survey, Catering, dsb.) mulai ditulis. Ini seperti membangun fondasi dan rangka bangunan sebelum memasang dinding dan furnitur per ruangan.

Alasan fondasi ini harus reusable sejak awal: riset internal (folder GS Management) menunjukkan produk ini lahir dari kebutuhan nyata klien General Services (katering, housekeeping, camp, facility) — dimulai dari alat sederhana seperti sistem Customer Complaint & Survey berbasis QR code (`cx-feedback-app`, sudah berjalan untuk klien Wilmar dan Petrosea via Adrina Jaya Abadi). Kalau fondasi ini dibangun spesifik untuk satu klien atau satu industri, setiap klien baru akan berarti membangun ulang — mahal, lambat, dan sulit dirawat. Kalau fondasi dibangun generik sejak awal, klien baru cukup dikonfigurasi, bukan dikodekan ulang.

Arsitektur whitelabel adalah konsekuensi langsung dari model bisnis ini. Insting Tekno Sinergi tidak menjual satu instalasi ke satu klien — tujuannya menjual satu platform ke banyak klien dengan biaya pengembangan marjinal yang makin kecil setiap klien baru. Ini hanya mungkin jika batas antara "yang generik" (core platform) dan "yang spesifik klien" (configuration) dijaga ketat sejak hari pertama.

Cara platform berkembang: dimulai dari titik kontak paling sederhana dengan pelanggan — komplain dan survei kepuasan — lalu meluas ke modul operasional (Catering, Housekeeping, General Service, Camp), lalu ke rantai pasok (Inventory, Warehouse, Procurement), lalu ke keuangan enterprise (Finance, Accounting, Tax). Urutan ini bukan kebetulan: setiap tahap membangun kepercayaan operasional dan data yang dibutuhkan tahap berikutnya, dan setiap tahap menggunakan mesin inti yang sama (workflow, approval, notifikasi, audit) yang dibangun di Phase 0.

Dokumen riset iDempiere digunakan sebagai referensi arsitektur — bukan template. Prinsip-prinsip enterprise yang matang dari iDempiere (document lifecycle sebagai state machine, metadata sebagai sumber kebenaran, multi-tenant shared-schema, prinsip "jangan sentuh core untuk kustomisasi") layak diadopsi. Tapi implementasi teknisnya (Java 8, OSGi, ZK/Swing) sudah usang dan tidak akan ditiru; Abixell One dibangun dengan stack modern dan filosofi API-first, event-driven, serta AI-ready sejak awal.

---

## 2. Product Foundation

Sebelum modul bisnis dibangun, yang harus disiapkan adalah **batas produk** — mana yang menjadi mesin inti (dipakai semua klien, tidak boleh diubah per klien) dan mana yang menjadi lapisan konfigurasi (berbeda per klien, tanpa menyentuh kode).

| Aspek | Core Platform (reusable) | Client Configuration (per klien) |
|---|---|---|
| Struktur tenant | Model tenant/company/branch/project/site generik | Jumlah & nama entity aktual milik klien |
| Modul | Mesin & struktur data modul | Modul mana yang diaktifkan untuk klien tsb. |
| Branding | Sistem tema & theming engine | Logo, warna, nama aplikasi klien |
| Bahasa/istilah | Sistem terminologi yang dapat diganti | Kata "Site" diganti "Camp" untuk klien tambang |
| Workflow | Workflow engine generik | Approval matrix spesifik klien |

Cakupan minimal yang harus siap: batas produk whitelabel yang jelas, model tenant/company dengan dukungan multi-company, multi-branch, multi-project, multi-site, mekanisme aktivasi fitur/modul per klien, konfigurasi branding, kesiapan lokalisasi (bahasa, mata uang, format tanggal), serta satu mekanisme manajemen konfigurasi terpusat yang dapat diaudit.

Contoh sederhana: klien tambang batu bara mengaktifkan modul Catering + HSE + Fleet, memakai istilah "Site" dan "Pit", dengan logo dan warna korporat sendiri — sementara klien perkantoran mengaktifkan modul Housekeeping + Facility saja, memakai istilah "Building" dan "Floor", dengan tema warna berbeda. Kode di baliknya sama persis.

---

## 3. High-Level System Architecture

```
User (Executive / Ops / Field / Customer / Vendor)
        ↓
Frontend (Web App, Mobile/PWA, Customer Portal)
        ↓
API / Application Layer (REST/GraphQL Gateway, Auth)
        ↓
Business Domain (Commercial, Operations, Supply Chain, Finance …)
        ↓
Workflow / Rules / Security (Workflow Engine, RBAC, Approval)
        ↓
Database / Storage (PostgreSQL, File/Document Storage)
        ↓
Integration Layer (Accounting, Payroll, WhatsApp, GPS, Biometric …)
```

Setiap lapisan punya tanggung jawab tunggal: Frontend menampilkan dan mengumpulkan data sesuai peran pengguna; API/Application Layer menjadi satu pintu masuk terautentikasi untuk semua klien (web, mobile, integrasi pihak ketiga); Business Domain berisi logika masing-masing area bisnis secara terpisah agar dapat dikembangkan independen; Workflow/Rules/Security adalah layanan lintas-modul yang menegakkan urutan proses, hak akses, dan jejak audit; Database/Storage menyimpan data transaksi dan dokumen secara aman dan terstruktur; Integration Layer menjadi jembatan resmi keluar-masuk data ke sistem pihak ketiga tanpa mencemari logika bisnis inti.

---

## 4. Backend Preparation

Layanan berikut disiapkan di Phase 0 sebagai **layanan reusable** yang dipakai oleh seluruh modul bisnis, bukan dibangun ulang per modul:

- API architecture (REST, opsi GraphQL untuk kueri kompleks) dengan standar respons & versi yang konsisten
- Application service & domain layer per business domain, terpisah dari infrastruktur
- Configuration engine (metadata-driven) — sumber kebenaran untuk field, label, status, numbering
- Workflow engine & approval engine generik — dipakai Complaint, PR/PO, Asset Transfer, dst.
- SLA engine — pemantauan tenggat & eskalasi lintas modul
- Notification engine (email, push, WhatsApp-ready)
- Audit trail — siapa mengubah apa, kapan, dari mana
- Document/file service — upload, penyimpanan, retensi
- Event system — domain event untuk integrasi antar modul dan kesiapan AI di masa depan
- Scheduler/background job untuk proses terjadwal
- Integration boundary — titik resmi keluar-masuk data pihak ketiga
- Security: autentikasi, otorisasi (RBAC, siap ABAC), data scope per organisasi/proyek/site

Belum ada keputusan teknologi final. Sebagai rekomendasi (bukan keputusan mengikat): backend berbasis Node.js/TypeScript atau Go untuk kecepatan pengembangan dan performa; PostgreSQL sebagai database utama dengan Row-Level Security untuk isolasi tenant; workflow mengikuti pola BPMN standar (bukan proprietary) agar portable dan bisa dimodelkan tanpa developer.

---

## 5. Frontend Preparation

Platform menggunakan **satu Design System**, tapi menyajikan **beberapa Experience Layer** berbeda sesuai peran pengguna: Executive/BOD, Management/GM, Operational, Supervisor, Field Worker, Customer, Vendor, dan Administrator.

Perbedaan penting: **Role Permission** menentukan *apa yang boleh dilakukan* pengguna (create, approve, view), sedangkan **Role Experience** menentukan *bagaimana antarmuka disajikan* untuk peran tersebut — Executive melihat ringkasan dan grafik, Field Worker melihat daftar tugas sederhana dengan tombol besar untuk dipakai di lapangan. Dua peran bisa punya permission yang sama namun experience yang sangat berbeda.

Struktur frontend:

```
Application Shell
├── Navigation
├── Dashboard
├── Workspace
├── Module
├── Transaction
├── Approval
├── Reporting
└── Administration
```

Platform harus responsif di web, siap untuk desktop dan tablet, serta PWA-ready dengan dukungan offline untuk operasional lapangan (misalnya inspeksi housekeeping atau checklist katering di area tanpa sinyal) — mengacu pada kebutuhan Supervisor/Employee Mobile yang sudah diidentifikasi dalam riset GS Management.

---

## 6. Workflow Architecture

Workflow engine bersifat generik dan dipakai lintas domain — dari Complaint, Survey follow-up, Purchase Request/Order, Asset Transfer, Invoice Approval, Corrective Action, hingga Contract Approval. Tidak ada modul yang membangun mesin approval-nya sendiri.

Komponen inti: workflow definition, workflow step, condition, assignment, approval, escalation, SLA, notification, dan history — semuanya *configurable*, bukan hardcoded di kode.

```
Submit
  ↓
Validate
  ↓
Assign
  ↓
Review
  ↓
Approve / Reject
  ↓
Escalate if overdue
  ↓
Complete
```

---

## 7. Data & Structure Preparation

Struktur informasi minimal yang disiapkan sejak awal: Tenant, Company, Organization, Branch, Department, Project, Site, Customer, Contract, User, Role, Employee, Service, Master Data, Reference Data, Transaction Data, Document, dan Audit History.

Prinsip **Single Source of Truth**: setiap entity (misalnya Customer atau Site) hanya punya satu representasi resmi di sistem, dan seluruh modul — dari Complaint hingga Finance — merujuk ke entity yang sama, bukan menyalin datanya sendiri-sendiri. Ini mencegah data ganda dan memastikan laporan lintas modul selalu konsisten.

---

## 8. Metadata & Configuration Strategy

Area yang sebaiknya *configurable*, bukan hardcoded: aktivasi modul, konfigurasi form, label/istilah, penomoran dokumen, status, kategori, SLA, approval matrix, definisi workflow, template notifikasi, template laporan, visibilitas dashboard, terminologi per klien, dan branding.

Dari konsep Application Dictionary iDempiere, yang **transferable** ke Abixell One adalah gagasan "metadata sebagai sumber kebenaran validasi" — field, referensi, aturan wajib/read-only didefinisikan sebagai data, bukan kode, sehingga konsisten di semua modul. Yang **tidak diadopsi** adalah cara iDempiere mengikat metadata langsung ke generasi UI (Swing/ZK) — di Abixell One, metadata menjadi kontrak API/schema yang dikonsumsi frontend, bukan mesin generate-UI itu sendiri. Ini menjaga fleksibilitas desain tanpa mewarisi kerumitan teknis iDempiere.

---

## 9. Module Architecture Direction

Phase 0 **tidak** membangun modul bisnis apa pun — hanya fondasi reusable. Arah implementasi modul setelahnya:

**First Business Modules:** Customer Complaint, Survey & Assessment, Customer Portal/Service Desk.
**Next Operational Modules:** Catering, Housekeeping, General Service, Camp & Facilities.
**Supply Chain:** Inventory, Warehouse, Procurement.
**Enterprise Financial:** Finance, Accounting, Tax.

Urutan ini masuk akal karena tiga alasan: (1) Complaint/Survey adalah titik kontak paling ringan dengan pelanggan dan sudah punya bukti konsep berjalan (`cx-feedback-app`), sehingga risiko implementasi rendah dan nilai bisnis cepat terlihat; (2) modul operasional membangun data operasional harian yang menjadi input bagi rantai pasok; (3) Supply Chain dan Finance membutuhkan data transaksi dan kepercayaan proses yang hanya terbentuk setelah modul operasional stabil — membangun Finance terlalu awal berisiko dirancang berdasarkan asumsi, bukan pola nyata.

---

## 10. White-Label Architecture

Abixell One dapat dipakai ulang untuk klien lain dengan mengonfigurasi: branding (logo, nama aplikasi, tema warna), terminologi, modul aktif, konfigurasi dashboard dan workflow, SLA dan approval matrix, template notifikasi dan laporan, template dokumen, domain/subdomain, serta pengalaman pengguna per peran.

Prinsip yang dipegang: **build once, configure many**. Kode sumber tetap satu untuk semua klien; yang berbeda hanyalah data konfigurasi. Kode khusus per klien (*custom code per client*) dihindari sejauh mungkin — kalau satu klien butuh sesuatu yang tidak bisa dikonfigurasi, itu jadi sinyal untuk memperluas kemampuan konfigurasi platform, bukan alasan untuk fork kode.

---

## 11. Extensibility Strategy

Platform harus bisa berkembang — modul baru, workflow baru, integrasi baru, laporan/dashboard baru, klien baru, industri baru, bahkan experience pengguna baru — tanpa desain ulang besar-besaran.

Ini dicapai lewat kombinasi: arsitektur modular dengan batas domain yang jelas, mekanisme extension/plugin resmi (bukan fork), event system untuk menghubungkan modul baru tanpa mengubah modul lama, API terbuka dan terdokumentasi, hook di titik-titik strategis workflow, serta metadata/konfigurasi sebagai jalur utama penyesuaian. Pola ini terinspirasi dari filosofi "jangan sentuh core untuk kustomisasi" milik iDempiere — diambil sebagai prinsip, bukan implementasi OSGi-nya.

---

## 12. Security & Governance Foundation

Yang harus tersedia sejak Phase 0: autentikasi, RBAC, data scope berbasis organisasi/site/project, audit trail, riwayat approval, activity log, kontrol akses dokumen, security logging, tata kelola konfigurasi, dan riwayat perubahan.

Keamanan tidak boleh ditambahkan belakangan karena ia bersinggungan dengan hampir semua lapisan sistem — model data, API, workflow, dan UI. Menambahkannya setelah modul bisnis berjalan berarti merombak ulang struktur data dan alur yang sudah ada, jauh lebih mahal dibanding merancangnya sejak fondasi.

---

## 13. Phase 0 Deliverables

| Deliverable | Status |
|---|---|
| Product core boundary (whitelabel) | MUST HAVE |
| Tenant/company/branch/project/site structure | MUST HAVE |
| Authentication foundation | MUST HAVE |
| RBAC (role permission) | MUST HAVE |
| Application shell + design system | MUST HAVE |
| Master data foundation | MUST HAVE |
| Workflow engine foundation | MUST HAVE |
| Audit trail foundation | MUST HAVE |
| Feature/module activation configuration | MUST HAVE |
| Development environments (dev/staging) | MUST HAVE |
| SLA engine foundation | SHOULD HAVE |
| Notification foundation | SHOULD HAVE |
| Document foundation | SHOULD HAVE |
| Dummy seed data | SHOULD HAVE |
| Logging | SHOULD HAVE |
| Testing foundation (unit/integration) | SHOULD HAVE |
| Architecture decision log | SHOULD HAVE |
| Role Experience layer per persona | FUTURE READY |
| Offline/PWA sync | FUTURE READY |
| AI Ready layer (event, schema) | FUTURE READY |
| Marketplace/plugin ecosystem | FUTURE READY |

---

## 14. What Phase 0 Will NOT Build

Phase 0 sengaja **tidak** membangun: Full CRM, Full Catering, Full Warehouse, Full Procurement, Full Accounting/Tax, implementasi AI, Business Intelligence kompleks, integrasi IoT, maupun aplikasi mobile native produksi. Batas ini menjaga fokus fondasi dan mencegah over-engineering di tahap paling awal.

---

## 15. Recommended Development Sequence

```
Preparation
  ↓
Foundation
  ↓
Complaint
  ↓
Survey
  ↓
Customer Portal
  ↓
Operational Core
  ↓
Catering
  ↓
Housekeeping / General Service
  ↓
Warehouse / Inventory
  ↓
Procurement
  ↓
Finance / Accounting / Tax
  ↓
Enterprise Analytics
```

**Preparation** — menyamakan pemahaman Founder dan tim sebelum kode ditulis. **Foundation** — fondasi teknis siap dipakai modul apa pun. **Complaint** — kanal keluhan pelanggan berjalan digital dengan bukti konsep tervalidasi. **Survey** — kepuasan pelanggan terukur secara berkelanjutan. **Customer Portal** — pelanggan punya satu titik akses transparan. **Operational Core** — struktur project/site/karyawan siap dipakai modul lapangan. **Catering/Housekeeping/General Service** — operasional harian utama klien General Services terdigitalisasi. **Warehouse/Inventory** — kontrol stok dan konsumsi terpusat. **Procurement** — pembelian terkontrol dan terhubung ke stok. **Finance/Accounting/Tax** — seluruh transaksi operasional bermuara ke laporan keuangan yang akurat. **Enterprise Analytics** — manajemen mendapat visibilitas lintas seluruh rantai bisnis.

---

## 16. Risks Before Development

| Risiko | Mitigasi |
|---|---|
| Terlalu banyak hardcode | Tegakkan prinsip "configurable by default" sejak review desain modul pertama |
| Produk terlalu spesifik ke domain General Services | Validasi setiap keputusan desain terhadap minimal 2 skenario industri berbeda |
| Batas whitelabel tidak jelas | Dokumentasikan eksplisit Core vs Client Configuration sebelum coding (lihat Bagian 2) |
| Workflow dibangun berulang per modul | Wajibkan semua modul memakai satu Workflow Engine, tanpa pengecualian |
| Duplikasi master data antar modul | Terapkan prinsip Single Source of Truth sejak skema data awal |
| Role hanya permission, bukan experience | Rancang Role Experience sebagai lapisan terpisah dari RBAC sejak Phase 0 |
| Over-engineering di Phase 0 | Batasi scope sesuai checklist Bagian 13 & 14, review sebelum menambah fitur |
| Mengikuti iDempiere terlalu literal | Setiap adopsi konsep iDempiere wajib melalui trade-off analysis (lihat Bagian 8 & 11) |
| Microservices prematur | Mulai dari modular monolith, pisah jadi service hanya bila skala menuntut |
| Kustomisasi berlebihan per klien | Setiap permintaan klien yang tak bisa dikonfigurasi masuk backlog perluasan platform, bukan fork kode |

---

## 17. Founder Decision Required

**Blocking Decision (wajib diputuskan sebelum Phase 0 mulai):**

1. Apakah target awal deployment tetap dedicated per klien, atau langsung disiapkan sebagai multi-tenant SaaS?
2. Apakah struktur organisasi standar (Company → Branch → Project → Site) sudah mencerminkan seluruh model bisnis klien yang disasar (GS, tambang, dan lainnya)?
3. Siapa yang menjadi klien referensi/pilot untuk modul Complaint & Survey pertama?
4. Apakah nama "Abixell One" dan positioning "Whitelabel Integrated Enterprise Management System" sudah final untuk dipakai di seluruh dokumentasi teknis?

**Can Be Decided Later (dapat memakai default aman dan direview ulang saat modul relevan mulai dibangun):**

5. Pilihan teknologi backend final (Node.js/TypeScript vs Go).
6. Pilihan mesin workflow spesifik (BPMN engine mana yang dipakai).
7. Strategi hosting/infrastruktur final (cloud provider, on-premise readiness).
8. Cakupan compliance spesifik (ISO, SMK3, HACCP) yang ditargetkan per klien.
9. Skema penamaan modul/menu final dalam produk.
10. Roadmap AI dan integrasi IoT/GPS/biometric detail.

---

## 18. Final Recommendation

Blueprint riset yang ada (GS Management PRD, riset iDempiere, `cx-feedback-app` yang sudah berjalan) sudah cukup matang secara konsep untuk memulai Phase 0 — arah bisnis, domain, dan prinsip arsitektur sudah jelas. Yang perlu dikunci lebih dulu adalah keempat Blocking Decision di Bagian 17, khususnya batas whitelabel (Core vs Client Configuration) dan target model deployment, karena keduanya memengaruhi struktur data dan API sejak baris kode pertama.

Yang boleh tetap fleksibel: pilihan teknologi spesifik, detail mesin workflow, dan cakupan compliance — semua ini dapat disesuaikan tanpa merombak fondasi selama prinsip API-first, modular, dan configuration-over-customization dipegang teguh.

Secara konsep, Abixell One sudah cukup generik untuk menjadi produk whitelabel — akarnya di domain General Services, namun modul intinya (Complaint, Workflow, Master Data, Approval) relevan untuk industri lain. Area yang paling perlu dijaga agar tidak diam-diam berubah menjadi *proyek custom per klien* adalah: penamaan/istilah domain (hindari hardcode istilah "Site" atau "Camp" di kode), approval matrix (harus selalu configurable, tidak pernah hardcoded per klien), dan modul operasional GS (Catering/Housekeeping) — karena di sinilah godaan terbesar untuk menulis logika spesifik satu klien akan muncul pertama kali.

**Rekomendasi:** blueprint siap masuk Phase 0 setelah keempat Blocking Decision disetujui Founder.

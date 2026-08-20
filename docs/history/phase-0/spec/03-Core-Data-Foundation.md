# 03 — Core Data Foundation

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Dokumen ini mendaftar entity data inti yang harus siap sebelum modul bisnis apa pun dibangun, dan menetapkan **prinsip Single Source of Truth** — setiap entity punya satu representasi resmi, dirujuk oleh seluruh modul, tidak diduplikasi.

Entity di sini bersifat generik dan lintas-industri, konsisten dengan Founder Decision 2 (organization hierarchy generik) dan Decision 3 (Complaint/Survey harus generic engine).

---

## Entity Inti

### Organizational (lihat dokumen 01)
Tenant, Legal Entity, Organization Unit, Project, Site/Location.

### People & Access
- **User** — akun login, terhubung ke satu atau lebih Role dan data scope.
- **Role** — kumpulan permission, dapat dikombinasikan dengan data scope saat assignment ke User.
- **Employee** — data kepegawaian (bisa terhubung ke User bila punya akses login, bisa berdiri sendiri bila tidak).

### Commercial
- **Customer** — pelanggan/klien dari Tenant, entity yang dituju modul Complaint, Survey, dan Customer Portal.
- **Contract** — perjanjian/kontrak yang menghubungkan Customer dengan Project tertentu.
- **Vendor** — pemasok/mitra eksternal, dipakai modul Procurement dan seterusnya.

### Reference & Master Data
- **Master Data** — data acuan yang jarang berubah dan dipakai lintas modul (kategori, satuan, jenis layanan).
- **Reference Data** — data pendukung dari Configuration Engine (status list, kode wilayah, dsb.) — lihat dokumen 05.

### Transactional & Supporting
- **Transaction Data** — payload transaksi tiap modul (Complaint, Survey response, dst.), selalu merujuk ke entity organizational & commercial di atas, tidak menyalin datanya.
- **Document** — file/lampiran/foto bukti, terhubung ke transaksi manapun yang membutuhkan (lihat dokumen 06).
- **Audit History** — jejak perubahan seluruh entity di atas (lihat dokumen 06).

---

## Relasi Inti

```
Tenant
  └── Legal Entity
        └── Organization Unit
              └── Project ── Contract ── Customer
                    └── Site/Location
                          └── Transaction Data (Complaint, Survey, ...)
                                └── Document (evidence)

User ── Role ── Permission + Data Scope (Org Unit / Project / Site)
Employee ── (optional link) ── User
```

Setiap Transaction Data wajib merujuk minimal ke Site/Location (atau Project bila belum granular ke site) dan, bila relevan, ke Customer/Contract — inilah yang memungkinkan Complaint dan Survey dari pilot pertama otomatis reusable untuk modul lain: keduanya tidak membawa struktur data sendiri, melainkan memakai kerangka Core Data ini.

---

## Prinsip Single Source of Truth

Contoh penerapan: data Customer hanya disimpan satu kali di entity Customer. Modul Complaint tidak menyimpan salinan nama/kontak Customer di tabelnya sendiri — ia hanya menyimpan referensi (ID) ke Customer. Ketika Customer Portal, Survey, atau Finance kelak membutuhkan data Customer yang sama, semuanya membaca dari sumber yang sama, sehingga perubahan data Customer (misal update kontak) langsung konsisten di semua modul tanpa proses sinkronisasi manual.

Prinsip yang sama berlaku untuk Site/Location, Contract, dan Organization Unit — seluruhnya menjadi *tabel referensi* yang di-*link*, bukan di-*copy*, oleh modul bisnis.

---

## Kesiapan untuk Pilot Complaint & Survey

Agar pilot pertama benar-benar menguji reusability platform (sesuai Founder Decision 3), Core Data Foundation harus menyediakan sebelum development pilot dimulai:

- Struktur Customer, Contract, Project, Site/Location yang dapat diisi data dummy klien pilot.
- User & Role dasar (Admin, Supervisor, Customer-facing) sudah bisa login dan punya data scope.
- Master Data kategori komplain/survei disiapkan sebagai *Reference Data configurable* (dokumen 05), bukan hardcoded di kode modul.

---

## Yang Belum Diputuskan (menunggu data klien pilot)

- Apakah Employee wajib selalu punya akun User, atau boleh murni data HR tanpa akses sistem?
- Struktur Master Data kategori Complaint/Survey final — menunggu detail operasional dari klien pilot GS.

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

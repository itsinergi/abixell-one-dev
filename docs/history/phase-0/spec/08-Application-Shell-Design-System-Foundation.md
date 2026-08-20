# 08 — Application Shell & Design System Foundation

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Frontend Abixell One memakai **satu Design System**, tapi menyajikan **beberapa Experience Layer** berbeda sesuai peran pengguna — sekaligus menjadi tempat penegakan aturan client-facing branding dari Founder Decision 1 & 4 (kata "Whitelabel" dan sejenisnya tidak boleh tampil ke klien).

---

## Application Shell

```
Application Shell
├── Navigation        (menu dinamis sesuai modul aktif Tenant & permission user)
├── Dashboard          (ringkasan sesuai Role Experience)
├── Workspace          (area kerja harian — daftar tugas, approval pending)
├── Module             (area kerja spesifik modul, mis. Complaint, Survey)
├── Transaction        (form input/detail transaksi)
├── Approval           (antrian approval, konsisten lintas modul via Workflow Engine)
├── Reporting          (laporan operasional s/d eksekutif)
└── Administration     (konfigurasi Tenant — modul, branding, RBAC, master data)
```

Shell ini sama untuk semua Tenant; yang berbeda adalah konten di dalamnya — modul mana yang muncul di Navigation, widget apa di Dashboard — seluruhnya ditentukan Configuration Engine (dokumen 05), bukan build terpisah per klien.

---

## Role Permission vs Role Experience

Dua konsep ini sering tertukar dan wajib dipisahkan sejak Phase 0:

- **Role Permission** (dokumen 02) menentukan *apa yang boleh dilakukan* — create, approve, view data tertentu.
- **Role Experience** menentukan *bagaimana antarmuka disajikan* untuk peran tersebut.

Dua pengguna bisa punya permission yang identik (keduanya boleh approve Complaint) tapi experience berbeda total: Operation Manager melihat dashboard ringkasan dengan grafik tren, sementara Field Supervisor melihat daftar tugas sederhana dengan tombol besar untuk dipakai sambil berjalan di lapangan.

## Experience Layer Minimal

| Experience Layer | Fokus Tampilan |
|---|---|
| Executive / BOD | Ringkasan lintas Tenant/Legal Entity, tren, exception |
| Management / GM | Dashboard operasional per Organization Unit/Project |
| Operational | Workspace harian, approval queue |
| Supervisor | Tugas lapangan, checklist, assignment tim |
| Field Worker | Task list sederhana, kamera/GPS/offline-first |
| Customer | Portal terbatas — status komplain/survei milik mereka saja |
| Vendor | Portal terbatas — transaksi terkait mereka saja |
| Administrator | Configuration, RBAC, master data, branding |

Role Experience adalah lapisan presentasi di atas Design System yang sama — bukan aplikasi terpisah, bukan codebase terpisah.

---

## Responsive, Device & Offline Readiness

- **Web responsive** sebagai baseline untuk seluruh Experience Layer manajemen/administrasi.
- **Tablet** untuk supervisor lapangan yang butuh layar lebih besar (checklist, inspeksi).
- **PWA-ready** — Field Worker dan Supervisor Experience dirancang agar dapat di-install sebagai app-like experience tanpa perlu native app di awal.
- **Offline readiness** untuk operasional lapangan — data yang diinput saat offline (checklist, foto komplain) disimpan lokal, disinkronkan otomatis saat koneksi kembali, dengan resolusi konflik yang ditentukan Workflow Engine (mis. server-wins untuk status approval).
- Native mobile (Android/iOS) secara eksplisit **tidak** menjadi target Phase 0 (lihat Bagian 14 di Preparation Summary) — PWA dulu, native menyusul bila kebutuhan lapangan menuntut kapabilitas device lebih dalam (mis. background GPS tracking).

---

## Branding & Client-Facing Rule (mengacu Founder Decision 1 & 4)

Seluruh elemen visual dan tekstual yang tampil ke pengguna — nama aplikasi, logo, warna, footer, judul halaman, isi email — bersumber dari Branding Configuration milik Tenant (bagian dari Configuration Engine, dokumen 05), bukan hardcode di Design System. Design System sendiri hanya mendefinisikan *struktur dan perilaku* komponen (tombol, form, tabel) — bukan identitas visual final, yang selalu adalah hasil konfigurasi per Tenant.

Dengan begitu, tidak ada risiko kode aplikasi "membocorkan" istilah internal (Whitelabel, Multi-tenant, dsb.) ke sisi klien, karena teks yang tampil ke klien secara arsitektur tidak pernah datang dari kode, selalu dari konfigurasi.

---

## Yang Belum Diputuskan (menunggu data klien pilot)

- Apakah Customer/Vendor Experience untuk pilot pertama berupa portal penuh, atau cukup halaman publik sederhana (mengikuti pola `cx-feedback-app` yang sudah berjalan)?
- Prioritas platform: web dulu penuh, atau PWA field-worker dikembangkan paralel sejak pilot pertama?

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

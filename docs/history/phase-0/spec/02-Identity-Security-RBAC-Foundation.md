# 02 — Identity, Security & RBAC Foundation

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Dokumen ini merancang fondasi keamanan dan akses yang dipakai seluruh modul, dan — secara khusus untuk Phase 0 — mendefinisikan **mekanisme teknis** yang menegakkan batas Product Core / Client Configuration / Client Extension yang diarahkan Founder. Batas ini tidak cukup sebagai prinsip di dokumen; ia harus punya bentuk teknis yang nyata agar benar-benar ditegakkan.

---

## Authentication

- Username & password sebagai baseline, dengan kebijakan password (panjang minimum, rotasi, lockout setelah percobaan gagal).
- Session dengan access token + refresh token; session timeout configurable per Tenant.
- Single Sign-On (SSO) dan Multi-Factor Authentication dirancang sebagai *ready*, tidak wajib diimplementasi di pilot pertama.
- Setiap login tercatat di Security Log (device, IP, waktu, hasil) — lihat dokumen 06.

## Authorization — RBAC + Data Scope

Otorisasi memakai dua sumbu yang saling melengkapi:

1. **Role Permission** — *apa* yang boleh dilakukan (create/read/update/delete/approve) terhadap suatu jenis data.
2. **Data Scope** — *data mana* yang boleh diakses, ditentukan oleh posisi pengguna dalam hierarchy Tenant → Legal Entity → Organization Unit → Project → Site/Location (dokumen 01).

Kombinasi keduanya menjawab pertanyaan "siapa boleh apa terhadap data mana" tanpa hardcode per modul — setiap modul baru (termasuk Complaint dan Survey nanti) tinggal mendaftarkan permission-nya ke RBAC Engine yang sama.

ABAC (Attribute-Based Access Control) dievaluasi sebagai kebutuhan lanjutan untuk kasus lebih kompleks (misalnya akses berdasarkan status dokumen atau nilai transaksi), tapi RBAC + Data Scope sudah cukup untuk Phase 0 dan pilot Complaint/Survey.

---

## Mekanisme Teknis: Product Core / Client Configuration / Client Extension

Ini adalah bagian paling penting dari dokumen ini — menerjemahkan arahan Founder menjadi struktur yang bisa ditegakkan sistem, bukan sekadar disiplin tim.

| Lapisan | Bentuk Teknis | Siapa Boleh Mengubah |
|---|---|---|
| **Product Core** | Skema domain, struktur entity, workflow engine, API contract — didefinisikan di source code & migration files, versioned di git | Tim engineering internal, lewat release resmi platform |
| **Client Configuration** | Data konfigurasi tersimpan di tabel/collection konfigurasi milik Tenant (label, workflow instance, approval matrix, branding, feature flag) — tidak menyentuh skema | Tim implementasi/admin klien, tanpa deploy ulang kode |
| **Client Extension** | Custom field terdefinisi via schema extensible (kolom JSON/JSONB tervalidasi terhadap schema registry), atau extension point resmi (hook/plugin) — terisolasi dari core, terdaftar dan diaudit | Tim engineering, hanya untuk kebutuhan yang sudah melalui triase dan disetujui |

**Aturan triase** (dilakukan sebelum request klien apa pun diterima):

```
Request Klien
   ↓
Apakah ini kebutuhan yang mungkin muncul di klien lain? → Ya → kandidat Product Core (masuk backlog platform)
   ↓ Tidak
Apakah bisa diselesaikan dengan mengubah data konfigurasi (label, matrix, template)? → Ya → Client Configuration
   ↓ Tidak
Apakah benar-benar unik dan tidak reusable? → Ya → Client Extension (lewat extension point resmi)
```

Permintaan tidak boleh langsung menyentuh Product Core hanya karena datang dari satu klien — governance ini dipegang oleh Architecture Review (lihat dokumen 09) sebagai gatekeeper.

---

## Menegakkan "Whitelabel Internal-Only" Secara Teknis

Sejalan dengan Founder Decision 4 (kata "Whitelabel" tidak boleh muncul di sisi klien), string yang bersifat client-facing (nama aplikasi, label modul, teks notifikasi, footer, metadata halaman) wajib bersumber dari **Client Configuration** (branding & terminology config per Tenant), tidak pernah di-hardcode di kode aplikasi. Ini otomatis mencegah istilah internal bocor ke UI klien — karena secara arsitektur, kode aplikasi tidak pernah menyimpan teks yang tampil ke pengguna akhir secara langsung.

---

## Audit-First Design

Setiap entity yang tunduk pada RBAC (data transaksi, konfigurasi, extension) wajib menyimpan: Created By/At, Updated By/At, Deleted By/At (soft delete), serta perubahan permission dan role sebagai audit event tersendiri (lihat dokumen 06 untuk detail Audit Trail Service). Perubahan pada Client Configuration dan Client Extension — karena berpotensi memengaruhi tampilan/perilaku sistem untuk seluruh pengguna Tenant tersebut — wajib tercatat dengan level audit yang sama seperti perubahan data transaksi penting.

---

## Yang Belum Diputuskan (menunggu data klien pilot)

- Apakah SSO/MFA menjadi prasyarat go-live pilot pertama, atau boleh menyusul di rilis berikutnya?
- Siapa yang menjadi Architecture Review gatekeeper secara organisasi (Founder sendiri, atau tim engineering lead)?

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

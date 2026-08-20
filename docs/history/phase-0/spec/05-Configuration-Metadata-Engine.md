# 05 — Configuration & Metadata Engine

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Dokumen ini merancang mesin yang membuat prinsip *"Build Once. Configure Per Client."* (Founder Decision 4) benar-benar bisa dijalankan sehari-hari — tanpa mesin ini, "configurable" hanya jadi slogan dan tim akan tergoda hardcode demi kecepatan.

---

## Area yang Wajib Configurable

| Area | Contoh |
|---|---|
| Aktivasi modul | Klien A aktifkan Complaint+Survey saja, Klien B tambah Catering |
| Form | Field tambahan pada form Complaint tanpa ubah kode |
| Label & terminologi | "Site" → "Camp" untuk klien tambang |
| Penomoran dokumen | Format nomor tiket komplain per Tenant |
| Status & kategori | Status Complaint: Baru/Diproses/Selesai, atau versi klien lain |
| SLA | Batas waktu respons per kategori/prioritas |
| Approval matrix | Lihat dokumen 04 |
| Definisi workflow | Urutan step per jenis transaksi |
| Template notifikasi | Isi email/WA per event, per Tenant |
| Template laporan | Layout dan field laporan |
| Visibilitas dashboard | Widget apa yang tampil untuk role tertentu |
| Branding | Logo, warna, nama aplikasi (dokumen 08) |

Prinsip pengujian sebelum sesuatu boleh hardcode: *"Apakah nilai ini akan sama untuk semua klien, selamanya?"* Jika jawabannya tidak pasti, area tersebut wajib masuk Configuration Engine, bukan kode.

---

## Bentuk Teknis

Configuration Engine menyimpan konfigurasi sebagai data terstruktur milik Tenant (bukan file kode yang perlu deploy ulang), dengan tiga lapisan:

1. **Schema Registry** — mendefinisikan bentuk yang valid untuk tiap jenis konfigurasi (misalnya: struktur approval matrix harus punya field kondisi + approver + SLA). Ini mencegah konfigurasi "liar" yang tidak konsisten.
2. **Tenant Configuration Store** — nilai aktual konfigurasi per Tenant, tervalidasi terhadap Schema Registry.
3. **Configuration API** — satu titik akses yang dipakai baik oleh backend (validasi, workflow) maupun frontend (render form, label, terminologi) — sehingga frontend dan backend selalu membaca sumber konfigurasi yang sama, tidak pernah dua sumber berbeda yang bisa tidak sinkron.

---

## Referensi dari Application Dictionary iDempiere — Apa yang Diambil, Apa yang Tidak

Riset arsitektur (iDempiere) menunjukkan konsep Application Dictionary — metadata sebagai sumber kebenaran untuk validasi dan referensi antar entity — telah teruji lebih dari satu dekade di ribuan deployment ERP. Konsep ini **layak diadopsi**: metadata (field wajib, tipe data, referensi/lookup, aturan read-only) didefinisikan sebagai data terkonfigurasi, bukan hardcode di banyak tempat.

Yang **tidak diadopsi**: cara iDempiere mengikat metadata langsung ke mesin generate-UI (Swing/ZK sekaligus). Di Abixell One, Configuration API menghasilkan **kontrak schema** (setara JSON Schema) yang dikonsumsi frontend sebagai salah satu consumer — bukan mesin yang men-generate UI secara otomatis dari database. Ini menjaga fleksibilitas desain UI (dokumen 08) sambil tetap mendapat manfaat metadata-driven validation.

---

## Hubungan dengan Mekanisme Core/Configuration/Extension (dokumen 02)

Configuration Engine adalah implementasi teknis dari lapisan "Client Configuration" yang dibahas di dokumen 02. Setiap kali sebuah permintaan klien lolos triase sebagai "Configuration" (bukan Core, bukan Extension), maka penyelesaiannya adalah: menambah entry baru ke Schema Registry (bila jenis konfigurasi belum ada) atau mengisi Tenant Configuration Store (bila jenis konfigurasi sudah ada) — tanpa menyentuh source code.

---

## Yang Belum Diputuskan (menunggu data klien pilot)

- Cakupan awal Schema Registry untuk pilot — apakah mencakup seluruh area di atas sejak hari pertama, atau bertahap dimulai dari yang dipakai Complaint/Survey saja?

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

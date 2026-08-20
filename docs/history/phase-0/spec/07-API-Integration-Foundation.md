# 07 — API & Integration Foundation

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Karena deployment bersifat dedicated per klien (Founder Decision 1) namun arsitektur wajib tetap multi-tenant-ready, API adalah titik di mana kedua sifat itu harus damai: setiap deployment berjalan sendiri secara fisik, tapi memakai kontrak API yang identik dan reusable di semua klien.

---

## API Architecture

- **API-first**: kontrak API (OpenAPI/GraphQL SDL) dibuat dari schema domain yang sama dipakai Configuration Engine (dokumen 05) — bukan ditambahkan belakangan setelah UI selesai.
- REST sebagai baseline; GraphQL dievaluasi untuk kueri dashboard/reporting yang kompleks.
- Autentikasi via token (JWT + refresh token), selaras dengan dokumen 02.
- Standar respons & error yang konsisten lintas seluruh modul (format sukses/gagal, kode error, pagination).
- Versioning API eksplisit sejak awal — perubahan besar tidak memaksa klien lama upgrade paksa (expand-contract pattern, bukan breaking change langsung).
- Rate limit & idempotency key untuk operasi kritikal (submit approval, upload dokumen).

## Integration Boundary

Integrasi pihak ketiga (accounting, payroll, biometric, GPS, WhatsApp, payment gateway, dsb.) **tidak** boleh mengakses database secara langsung atau menyisip logic ke domain layer. Semua integrasi masuk lewat:

- **Outbound**: Integration Service memanggil API pihak ketiga, dipicu oleh Event System (lihat di bawah).
- **Inbound**: Webhook/endpoint khusus yang divalidasi (signature/token) sebelum data masuk ke domain layer, melalui Application Service — tidak langsung ke database.

Batas ini menjaga Product Core tetap bersih dari ketergantungan pihak ketiga tertentu; menambah integrasi baru tidak memerlukan perubahan pada domain layer.

## Event System

Peristiwa penting (ComplaintSubmitted, SurveyCompleted, ApprovalGranted, dst.) dipublikasikan sebagai domain event. Event ini dikonsumsi oleh:

- Notification Engine (dokumen 06)
- Integration Service (untuk sinkronisasi ke sistem eksternal)
- Modul lain di masa depan tanpa perlu mengubah modul yang mempublikasikan event
- Kesiapan AI layer (event terstruktur menjadi bahan pelatihan/insight di masa depan, tidak diimplementasikan di Phase 0)

Pendekatan event-driven ini dipilih berdasar pelajaran dari riset iDempiere: mekanisme validasi in-process (ModelValidator) mereka kuat untuk integritas transaksi, tapi tidak cukup untuk arsitektur yang butuh perluasan modul tanpa modifikasi core. Abixell One mempertahankan validasi transaksi yang ketat secara synchronous, namun side-effect (notifikasi, integrasi, audit-analytics) dipropagasikan lewat event.

---

## Multi-Tenant-Ready Meski Dedicated Deployment

"Multi-tenant-ready" pada Founder Decision 1 berarti: kode aplikasi yang sama, bila dijalankan dalam mode shared-database, mampu memisahkan data antar Tenant dengan aman (Tenant sebagai discriminator wajib, ditambah lapisan proteksi row-level di database). Untuk deployment dedicated, discriminator ini tetap ada tapi biasanya bernilai tunggal (satu Tenant per deployment) — sehingga bila suatu saat model bisnis berubah ke arah shared-hosting untuk klien kecil, tidak perlu redesign skema, cukup mengaktifkan kembali kapasitas yang sudah ada di arsitektur.

---

## Yang Belum Diputuskan (menunggu data klien pilot)

- Integrasi pihak ketiga mana yang benar-benar dibutuhkan di rilis pilot (kemungkinan WhatsApp untuk notifikasi lapangan)?
- REST vs GraphQL untuk kebutuhan dashboard — keputusan final menunggu kebutuhan reporting nyata.

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

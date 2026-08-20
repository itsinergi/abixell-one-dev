# 06 — Notification, Document & Audit Foundation

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Tiga layanan bersama ini dipakai hampir semua modul sejak pilot pertama (Complaint butuh notifikasi assignment + foto bukti; Survey butuh notifikasi follow-up). Dibangun sebagai shared service di Phase 0 agar tidak diimplementasikan ulang di setiap modul.

---

## Notification Engine

Menerima trigger dari Workflow Engine (dokumen 04) atau modul lain, lalu mengirim ke channel yang sesuai:

- Email
- Push notification (web & mobile/PWA)
- WhatsApp-ready (integrasi menyusul di dokumen 07)
- SMS-ready
- Notifikasi in-app + digest berkala

Template notifikasi adalah **Client Configuration** (dokumen 05) — isi pesan, bahasa, dan channel default dapat berbeda per Tenant tanpa ubah kode. Notification Engine mencatat status pengiriman (sent/failed/read) untuk keperluan audit dan troubleshooting.

## Document / File Service

Layanan tunggal untuk upload, penyimpanan, dan retensi file — dipakai foto bukti komplain, dokumen kontrak, lampiran laporan, dsb.

- Mendukung foto, dokumen (PDF/Excel/Word), dan lampiran umum.
- Setiap file terhubung ke satu entity transaksi (polymorphic reference), bukan disimpan terpisah tanpa konteks.
- Retensi dan hak akses file mengikuti data scope entity induknya (mis. foto bukti komplain hanya terlihat oleh yang punya akses ke komplain tersebut).
- Kompresi foto otomatis sebelum upload — relevan untuk pengguna lapangan dengan koneksi terbatas (mengacu kebutuhan operasional GS di riset).
- Enkripsi at-rest untuk dokumen sensitif; strategi detail di dokumen 09.

## Audit Trail Service

Layanan pusat yang mencatat seluruh perubahan pada entity yang tunduk RBAC (dokumen 02):

- Created/Updated/Deleted By & At untuk seluruh entity.
- Approval history (siapa approve/reject, kapan, komentar) — bersumber dari Workflow Engine.
- Login & activity history, termasuk device dan IP.
- Perubahan konfigurasi (dokumen 05) dan perubahan permission/role (dokumen 02) — dicatat dengan level yang sama seperti perubahan data transaksi.

Audit Trail bersifat *append-only* — tidak dapat diedit atau dihapus lewat aplikasi, hanya dibaca. Ini menjadi dasar Governance Dashboard di fase berikutnya (Internal Audit, Security Administrator).

---

## Mengapa Tiga Layanan Ini Digabung dalam Satu Dokumen

Ketiganya sama-sama bersifat *cross-cutting* — dipanggil dari banyak modul, tidak dimiliki satu domain bisnis tertentu — dan bekerja sama secara langsung: sebuah approval di Workflow Engine memicu Notification, melampirkan Document, dan tercatat di Audit Trail — semuanya dalam satu alur transaksi yang sama.

---

## Yang Belum Diputuskan (menunggu data klien pilot)

- Channel notifikasi default untuk pilot (Email saja, atau langsung WhatsApp mengingat konteks lapangan)?
- Retention policy dokumen (berapa lama foto bukti komplain disimpan)?

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

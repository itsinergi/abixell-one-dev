# 04 — Workflow & Approval Engine Foundation

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Workflow bukan fitur per modul — ia adalah Enterprise Service bersama. Dokumen ini merancang mesin workflow generik yang, sesuai Founder Decision 3, harus langsung teruji lewat pilot Complaint dan Survey — dua kasus penggunaan yang cukup berbeda (Complaint butuh assignment & escalation ke tim; Survey butuh follow-up terjadwal) untuk membuktikan mesin ini benar-benar reusable, bukan dirancang khusus salah satu kasus.

---

## Workflow Engine — Alur Umum

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

## Komponen

| Komponen | Fungsi |
|---|---|
| Workflow Definition | Template proses (langkah, kondisi, approver) — configurable per Tenant, per jenis transaksi |
| Workflow Version | Definisi lama tetap menyelesaikan transaksi berjalan; definisi baru berlaku untuk transaksi baru |
| Workflow Step | Satu tahap dalam proses (Validate, Assign, Review, dst.) |
| Condition | Aturan percabangan (if/else, threshold, lookup) |
| Assignment | Penentuan siapa/role apa yang menerima tugas di suatu step, berdasar Data Scope (dokumen 02) |
| Approval | Keputusan approve/reject dengan jejak siapa & kapan |
| Escalation | Perpindahan otomatis ke level lebih tinggi bila SLA terlampaui |
| SLA | Batas waktu per step, dipantau SLA sub-engine |
| Notification | Trigger ke Notification Engine (dokumen 06) di setiap perubahan status |
| History | Log lengkap perjalanan satu instance workflow, menjadi bagian Audit Trail |

---

## Approval Matrix — Configurable, Bukan Hardcode

Approval matrix (siapa approve apa, berdasarkan kondisi apa) disimpan sebagai data konfigurasi per Tenant — bukan logic di kode. Contoh pola umum (nilai aktual menunggu data klien):

```
Kondisi: Kategori = "Complaint - Safety"
  → Assign ke: Site Supervisor
  → Escalate jika > 4 jam belum di-assign: Operation Manager
  → Approve/Close oleh: Site Supervisor, verified by QA
```

```
Kondisi: Survey Response = Rating ≤ 2
  → Auto-trigger: Follow-up task ke Customer Relations
  → SLA follow-up: 24 jam
  → Escalate jika lewat SLA: Operation Manager
```

Dua contoh ini menunjukkan workflow yang sama (Submit → Validate → Assign → Review → Approve/Reject → Escalate → Complete) melayani dua kebutuhan bisnis berbeda hanya lewat konfigurasi kondisi dan assignment — inilah bukti reusability yang dicari dari pilot pertama.

---

## Dynamic Routing

Assignment dan approval dapat ditentukan oleh: role, Organization Unit, Project, Site, kategori transaksi, tingkat urgensi/risiko, atau kombinasi (matrix). Routing memakai Organization Hierarchy dari dokumen 01 sebagai basis eskalasi berjenjang (Site → Project → Organization Unit → Legal Entity) tanpa perlu tabel eskalasi terpisah per modul.

## Dukungan Proses

Sequential approval, parallel approval, conditional approval, delegasi (termasuk delegasi sementara/cuti), auto-approve, auto-reject, escalation, cancellation, revisi, resubmission, rollback, dan reopen — seluruhnya adalah kapabilitas generik engine, tersedia untuk modul apa pun yang mendaftarkan workflow-nya.

## Keamanan Approval

Approval tidak boleh dilewati atau dimanipulasi di luar engine; seluruh keputusan wajib melalui Workflow Engine dan tercatat di History — sejalan dengan prinsip Audit-First di dokumen 02.

---

## Yang Belum Diputuskan (menunggu data klien pilot)

- Approval matrix aktual untuk Complaint (siapa assign, siapa approve, berapa SLA) menunggu SOP klien pilot.
- Apakah Survey follow-up butuh approval berjenjang, atau cukup notifikasi tanpa approval formal?

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

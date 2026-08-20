# 12 — Founder Decision: Phase 0 Implementation Approval

Phase 0 — Enterprise Core Foundation | Abixell One
Status: **APPROVED FOR IMPLEMENTATION**
Tanggal: 18 Agustus 2026

Dokumen ini adalah catatan resmi jawaban Founder atas tiga Blocking Decision di `11-Founder-Review.md`, mengubah status Phase 0 dari *PENDING FOUNDER APPROVAL* menjadi **APPROVED FOR IMPLEMENTATION**.

---

## 1. Governance Gatekeeper

Founder menjadi **final gatekeeper** untuk batas Product Core / Client Configuration / Client Extension. Engineering Lead dapat melakukan review dan rekomendasi teknis harian, tetapi perubahan terhadap Product Core tetap memerlukan keputusan Founder.

*Dampak ke blueprint:* mekanisme triase di `02-Identity-Security-RBAC-Foundation.md` — permintaan yang lolos triase sebagai kandidat Product Core wajib eskalasi ke Founder sebelum masuk backlog implementasi, bukan diputuskan sepihak oleh tim engineering.

## 2. Pilot Client & Business Discovery

Klien pilot: calon klien General Services yang memprioritaskan Customer Complaint Management dan Survey & Assessment. Data, SOP, SLA, approval matrix, kategori, dan workflow spesifik klien tersebut **hanya dipakai sebagai bahan validasi** — tidak boleh di-hardcode ke Product Core. Kebutuhan spesifik klien ditempatkan di Client Configuration, atau Client Extension bila benar-benar diperlukan.

*Dampak ke blueprint:* menegaskan ulang aturan triase di `02-Identity-Security-RBAC-Foundation.md` dan `05-Configuration-Metadata-Engine.md` — approval matrix dan kategori Complaint/Survey milik klien pilot masuk sebagai *Tenant Configuration*, bukan skema generik.

## 3. Pilot Platform Priority

**Web-first + PWA-ready from day one.** Prioritas implementasi pertama: responsive web application untuk Management, Administrator, Customer, dan Supervisor. Arsitektur sejak awal menyiapkan: PWA manifest, responsive mobile experience, offline-ready architecture, local cache, synchronization foundation, camera/GPS readiness, dan field worker experience — tanpa membangun Full PWA field operation sekarang. Full PWA field operation menyusul di fase berikutnya tanpa redesign besar.

*Dampak ke blueprint:* memperjelas urutan di `08-Application-Shell-Design-System-Foundation.md` — Executive/Management/Administrator/Customer/Supervisor Experience dibangun penuh terlebih dulu; Field Worker Experience dibangun di atas fondasi PWA yang sama namun tidak menjadi prioritas rilis pertama.

## 4. Non-Blocking Decisions

Seluruh tujuh Non-Blocking Decision di `11-Founder-Review.md` memakai default aman yang sudah direkomendasikan:

- Legal Entity opsional untuk klien single-company kecil.
- Organization Unit tidak dibatasi hardcode di skema, UI mendukung minimal 5 level.
- SSO/MFA menyusul setelah pilot, tidak menjadi prasyarat go-live.
- Employee boleh punya atau tidak punya akun User.
- Schema Registry dibangun bertahap, dimulai dari area yang dipakai Complaint/Survey.
- Notifikasi pilot dimulai dari Email, WhatsApp menyusul.
- Tech stack mengikuti rekomendasi `09-Technical-Stack-Infrastructure-Recommendation.md`: modular monolith, TypeScript/Node.js (atau Go), PostgreSQL + Row-Level Security, BPMN-standard workflow engine.

---

## Final Approval

Ketiga Blocking Decision telah dijawab. **Phase 0 — Enterprise Core Foundation dinyatakan APPROVED FOR IMPLEMENTATION.**

Prinsip yang tetap berlaku sepanjang implementasi: *Build Once. Configure Per Client. Deploy Exclusively.* Product Core tidak boleh diubah berdasarkan kebutuhan satu klien tanpa Founder Decision.

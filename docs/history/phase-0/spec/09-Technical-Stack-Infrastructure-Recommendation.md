# 09 — Technical Stack & Infrastructure Recommendation

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW (rekomendasi, bukan keputusan final)

---

## Purpose

Dokumen ini membandingkan opsi arsitektur dan teknologi, memberi rekomendasi — bukan mengunci keputusan. Founder tetap dapat mengubah pilihan teknologi tanpa merombak dokumen 01–08, karena keduanya sengaja dijaga netral-teknologi.

---

## Architecture Style

| Style | Kelebihan | Kekurangan | Cocok Untuk Abixell One? |
|---|---|---|---|
| Modular Monolith | Deployment sederhana, konsisten dengan dedicated deployment per klien, mudah dirawat tim kecil-menengah | Scaling granular lebih sulit dibanding microservices | **Direkomendasikan untuk Phase 0 & pilot** |
| Microservices | Scaling granular, isolasi kegagalan | Kompleksitas operasional tinggi, prematur untuk tim & skala saat ini | Dipertimbangkan setelah beberapa Tenant besar dengan beban tinggi |
| Layered/Clean/Hexagonal (dalam Modular Monolith) | Domain layer terpisah dari infrastruktur, mudah diuji, cocok dengan pemisahan Core/Configuration/Extension | Disiplin tim diperlukan agar batas layer tidak bocor | **Direkomendasikan** sebagai pola internal di dalam modular monolith |

**Rekomendasi:** Modular monolith dengan domain layer terpisah bergaya Clean/Hexagonal Architecture. Setiap domain (Commercial, Operations, dst. — dokumen 03) menjadi modul terpisah secara kode, dengan API boundary jelas, siap dipecah jadi service terpisah di masa depan bila skala menuntut — tanpa komit ke microservices sejak awal (menghindari risiko "premature microservices" yang tercatat di Preparation Summary).

---

## Rekomendasi Teknologi (opsional, dapat diubah Founder)

| Lapisan | Opsi | Catatan |
|---|---|---|
| Backend | TypeScript/Node.js **atau** Go | TypeScript unggul kecepatan iterasi & talent pool; Go unggul performa & deployment sederhana untuk service kritikal |
| Database | PostgreSQL | Mendukung Row-Level Security untuk isolasi tenant, JSONB untuk Client Extension (dokumen 02) |
| Workflow Engine | Standar BPMN (mis. Flowable/Camunda) atau lightweight event-based state machine untuk kasus sederhana | Menghindari format proprietary; portable dan dapat dimodelkan visual |
| Frontend | React/Vue SPA modern + design system terpisah | Talent pool luas, decoupled dari backend |
| API | REST baseline, GraphQL untuk kueri dashboard kompleks | Sesuai dokumen 07 |
| Event/Message | Redis Streams (ringan) atau Kafka/NATS (bila volume tinggi) | Mulai ringan, upgrade saat volume menuntut |
| File Storage | Object storage (S3-compatible) | Retensi & enkripsi sesuai dokumen 06 |

Ini bukan keputusan final Founder — sebagai rekomendasi awal Phase 0, dapat direvisi kapan pun sebelum implementation phase dimulai.

---

## Environment & DevOps Readiness

- Environment minimal: Development, Staging, Production — terpisah per Tenant untuk deployment dedicated.
- CI/CD dasar (build, test, deploy otomatis ke staging) disiapkan sejak commit pertama, bukan ditambahkan belakangan.
- Migration-as-code (skema database berubah lewat file migrasi versioned di git) — bukan sinkronisasi manual lewat UI, mengikuti pelajaran dari riset iDempiere.
- Feature flag untuk merilis fitur baru secara bertahap tanpa deploy terpisah per klien.
- Docker sebagai unit deployment standar sejak awal; Kubernetes dipertimbangkan saat jumlah deployment dedicated bertambah signifikan.

## Disaster Recovery (garis besar, detail menyusul di fase implementasi)

Backup terjadwal, retensi backup, dan strategi recovery time minimal harus terdefinisi sebelum go-live pilot pertama — meski implementasi detail dapat menyusul setelah Phase 0 disetujui.

---

## Yang Belum Diputuskan (menunggu Founder & tim engineering)

- Pilihan final backend (TypeScript vs Go).
- Kapan mulai menyiapkan Kubernetes vs cukup Docker Compose/single-host untuk skala klien pilot.
- Provider cloud atau on-premise sebagai target infrastruktur awal.

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

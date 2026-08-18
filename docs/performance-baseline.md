# Performance Baseline — Checkpoint 0F

**Tanggal:** 2026-08-18
**Alat:** `autocannon` (load generator), server dijalankan `NODE_ENV=production`
(pino logger `info` level, tanpa `pino-pretty`), melawan PostgreSQL lokal yang
sama dipakai untuk development — bukan lingkungan produksi sungguhan, jadi
angka ini adalah *baseline relatif* untuk mendeteksi regresi performa di
checkpoint mendatang, bukan SLA yang dijamin untuk deployment pilot nyata.

Seluruh endpoint diuji dengan token Bearer sungguhan (tenant `demo-gs`,
user `admin@demo.local`, tenant-wide scope). `/auth/login` diuji terpisah
dengan jeda antar-request karena route tersebut sengaja dibatasi ketat
(lihat "Temuan" di bawah).

## Hasil

| Endpoint | Concurrency | Durasi | p50 | p97.5 | p99 | Req/Sec (avg) |
|---|---|---|---|---|---|---|
| `POST /auth/login` (sequential, di luar rate limit) | 1 | 3x manual | ~2 ms | — | — | — |
| `GET /me` (RBAC effective-permissions re-fetch) | 10 | 8s | 5 ms | 12 ms | 19 ms | ~1.566 |
| `GET /organization-units` (hierarchical scope walk, ADR-0009) | 10 | 8s | 11 ms | 25 ms | 45 ms | ~799 |
| `GET /audit-log/recent` | 10 | 8s | 9 ms | 17 ms | 20 ms | ~994 |
| `GET /scheduler/jobs` | 5 | 6s | 3 ms | 7 ms | 8 ms | ~1.242 |
| `POST /workflow/demo-transactions` (write path) | 5 | 8s | 8 ms | 19 ms | 29 ms | ~531 |

## Observasi

- Seluruh endpoint yang diuji berada jauh di bawah ambang batas yang akan
  terasa oleh pengguna (p99 tertinggi 45 ms, pada endpoint hierarchical
  Data Scope yang paling banyak melakukan query — `GET
  /organization-units` dengan pemegang scope non-tenant-wide berjalan
  lewat in-memory ancestor walk, ADR-0009). Tidak ditemukan indikasi N+1
  query atau bottleneck struktural pada skala data Phase 0 (data demo,
  puluhan baris per tabel).
- `RbacService` me-re-fetch effective permissions dari database di
  SETIAP request (keputusan sengaja sejak 0B — permission tidak
  disimpan di JWT, lihat decision-log.md) — `GET /me` tetap p50 5 ms,
  jadi trade-off ini terbukti murah pada skala saat ini.

## Temuan (menghasilkan perubahan kode di Checkpoint 0F)

Benchmark pertama terhadap `GET /organization-units` langsung terkena
HTTP 429 dari rate limiter global (Checkpoint 0F) yang aslinya diset
`max: 300` per menit — angka itu dipilih tanpa data traffic nyata, dan
benchmark ini membuktikan angka tersebut terlalu ketat bahkan untuk
skenario pemakaian wajar (belasan pengguna aktif). Rate limit global
dinaikkan menjadi `1200`/menit (dapat di-tuning lewat env var
`RATE_LIMIT_MAX`), sedangkan `/auth/login` tetap `10`/menit per IP
(disengaja — endpoint ini SATU-SATUNYA yang jadi target realistis
brute-force credential guessing, throughput tinggi bukan requirement
untuk endpoint tersebut).

## Baseline ini BUKAN

- Bukan pengujian dengan volume data produksi (ribuan Organization Unit,
  ribuan baris Workflow Instance) — pada skala itu, query hierarchical
  Data Scope (ADR-0009, `WITH RECURSIVE`) dan listing tanpa pagination
  (`GET /organization-units`, `GET /users`, dll — belum ada endpoint di
  Phase 0 yang mendukung pagination) kemungkinan perlu diukur ulang.
  Dicatat sebagai Technical Debt (lihat Technical Debt Register).
- Bukan pengujian dengan koneksi database jarak jauh (latency jaringan
  nyata antara API dan PostgreSQL produksi) — lingkungan ini
  PostgreSQL lokal (localhost), jadi latency jaringan DB tidak
  tercermin dalam angka di atas.
- Bukan load test jangka panjang (soak test) untuk mendeteksi memory
  leak atau koneksi pool yang bocor selama berjam-jam/berhari-hari.

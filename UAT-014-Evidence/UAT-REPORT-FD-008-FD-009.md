# UAT Report — Pilot Catering E2E-014 (FD-008 / FD-009)

**Tanggal:** 2026-10-23
**Unit pilot:** UNIT-CAT-PILOT-01 (tenant `165f3810-1148-468a-a4a3-4fe2931d5c00`)
**Status:** 4 dari 4 exit criteria TERPENUHI — pilot E2E-014 **LULUS** (keputusan teks Founder 2026-10-24)

---

## Aturan keputusan FD (diubah 2026-10-24)

Keputusan Founder untuk item FD **tidak lagi mensyaratkan tanda tangan**. Cukup berupa **jawaban teks** atas pertanyaan FD yang diajukan; jawaban tersebut mengikat dan mengunci keputusan sebagaimana mestinya.

## Keputusan Founder terkunci 2026-10-23

| ID | Keputusan |
|---|---|
| FD-008 | UAT (User Acceptance Testing — pengujian penerimaan pengguna) dijalankan **tim internal**, Founder melakukan **spot-check** hasil |
| FD-009 | Unit pilot **UNIT-CAT-PILOT-01** dengan 4 exit criteria di bawah |

## Keputusan Founder 2026-10-24 (teks, menggantikan tanda tangan)

| ID | Keputusan teks |
|---|---|
| FD-009-C1 | **"Bukti transaksi via API sudah cukup"** — 29 transaksi UAT-014 yang dibuktikan lewat API nyata + consumer outbox diterima sebagai exit criterion #1 (tanpa UI walkthrough) |
| FD-009-C4 | Keputusan teks di atas sekaligus menjadi persetujuan laporan UAT ini — pilot E2E-014 dinyatakan **LULUS** |

---

## Exit criteria & bukti

### 1. ✅ 29 transaksi UAT-014 — terpenuhi lewat API (Founder setuju 2026-10-24)

- 29 work order lengkap: UAT-014-01 ×20, UAT-014-02/-03/-04 ×3, invoice INV-00001..INV-00029
- Dijalankan lewat **API nyata + consumer outbox** (`accounting-event-poster`) oleh `apps/api/scripts/run-pilot-fase1.ts` (commit `1b034e7`), bukan oleh operator melalui layar UI
- Log bukti: `FASE-1-local-chain.log` (akhir log: "PASS — 29 chains, GL balanced, outbox drained")
- **Keputusan Founder 2026-10-24 (FD-009-C1):** "Bukti transaksi via API sudah cukup" — **criterion LULUS tanpa UI walkthrough**.

### 2. ✅ GL debit = kredit dan AR cocok (diverifikasi ulang ke database 2026-10-23)

| Bukti | Nilai |
|---|---|
| Jurnal posted | 87 (29 cost + 29 AR base + 29 AR tax) |
| Baris GL | 174 |
| Total debit | 6.802.182,00 |
| Total credit | 6.802.182,00 (selisih 0,00) |
| AR (1210) debit | 3.814.182,00 — cocok dengan total 29 invoice |
| Invoice | 29 lembar, base 3.436.200,00 + PPN 11% 377.982,00 = 3.814.182,00 |

Distribusi GL per akun:

| Akun | Nama | Debit | Kredit |
|---|---|---:|---:|
| 1210 | Accounts Receivable | 3.814.182,00 | 0,00 |
| 2410 | Tax Payable | 0,00 | 377.982,00 |
| 2500 | Accrued WO Cost | 0,00 | 2.988.000,00 |
| 4100 | Service Revenue | 0,00 | 3.436.200,00 |
| 6200 | WO Cost | 2.988.000,00 | 0,00 |

### 3. ✅ Periode akuntansi Okt-2026 ditutup

- Endpoint resmi `POST /accounting/periods/:id/lock` dengan permission `finance.accounting.period.lock` → HTTP 204
- Status database sesudahnya: `OCT-2026` = **`closed`**
- Alasan penutupan tercatat di audit trail (`accounting.period.locked`)

### 4. ✅ Persetujuan laporan UAT oleh Founder — via keputusan teks 2026-10-24

- Aturan diubah: persetujuan FD cukup berupa **jawaban teks**, tidak lagi tanda tangan
- Keputusan Anda: "saya memutuskan bahwa bukti transaksi via API sudah cukup" — menerima laporan ini sekaligus menutup criterion #1 dan #4
- **Status akhir: pilot E2E-014 dinyatakan LULUS sesuai FD-009**

## Verifikasi perilaku sistem (2026-10-24)

Bukti teknis penguncian periode diverifikasi ulang lewat API nyata (`admin@pilot.local`):

| Uji | Hasil |
|---|---|
| Status periode `OCT-2026` di API | `closed` |
| `POST /accounting/journals` ke periode closed | HTTP 409 — "Cannot create journal in a non-open accounting period" |
| `POST /accounting/periods/:id/lock` ulang (sudah closed) | HTTP 409 — "Period is already closed" |
| Audit trail `accounting.period.locked` | Ada di `audit_log` dengan alasan + `periodCode: 'OCT-2026'` |

---

## FD-009-S1 — rotasi password pilot (selesai 2026-10-24)

6 akun pilot (`admin@pilot.local`, `coord@pilot.local`, `bill@pilot.local`, `exec@pilot.local`, `verify@pilot.local`, `kernel-actor@pilot.local`) dirotasi dari password throwaway default ke password baru lewat `UPDATE users SET password_hash = ...` (bcrypt, 10 salt rounds).

Diverifikasi lewat `POST /auth/login` nyata:

| Uji | Hasil |
|---|---|
| Password baru (admin, coord, bill) | HTTP 200 `authenticated` |
| Password lama (`PilotAdmin12345!`, `PilotUser12345!`) | HTTP 401 "Invalid tenant, email, or password" |

Password baru disampaikan ke tim internal lewat jalur terpisah (tidak dicatat di dokumen ini).

## Hal yang TIDAK termasuk dalam UAT ini

- Staging init ke VPS — ditunda keputusan Anda 2026-10-23 ("bukti lokal cukup untuk sekarang")

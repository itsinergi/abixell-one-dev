# I18N-ROADMAP — Dua Bahasa (EN/ID) di Abixell One

Status: W0–W4 selesai (2026-10-29). W5–W7 belum dimulai.
Tujuan: semua yang muncul di UI transaksi punya terjemahan Bahasa Indonesia, tanpa mengubah kode backend.

## Keputusan terkunci

- Cakupan: infrastruktur + permukaan inti dulu, modul menyusul per gelombang.
- Persistensi: `localStorage` (`abixell.locale.v1`). Server menyusul, dicatat sebagai utang (lihat `docs/technical-debt-register.md`, bagian "I18N").
- Default: Inggris.
- Pemilih bahasa: topbar kanan atas di sebelah pemilih tema, dan di kartu pilih role pasca-login (di atas pilihan Role). Tombol teks "EN"/"ID", tanpa ikon, meniru `ThemeToggle`.
- Backend tidak disentuh.

## Arsitektur (sudah ada)

Tanpa dependency baru.

```
apps/web/src/i18n/
  LocaleProvider.tsx      context + localStorage + <html lang>/data-locale
  t.ts                    translate(locale, key, params?) + interpolasi {name}
  dictionaries/en.ts      sumber kanonik, menurunkan tipe MessageKey
  dictionaries/id.ts      Record<MessageKey, string>, kunci hilang = gagal tsc
apps/web/src/shell/components/LanguageSwitcher.tsx
```

- `useT()` mengembalikan `t` yang stabil per locale (`useCallback`, dep `[locale]`).
- Jangan simpan string hasil `t(...)` di state di dalam callback yang menjadi dependency effect. Simpan error mentah atau flag, terjemahkan saat render (pola di `AppShell.tsx`). Kalau tidak, ganti bahasa memicu refetch.
- Skrip pre-paint di `apps/web/index.html` membaca kunci yang sama untuk mencegah flash. Kunci dan nilai harus sinkron dengan provider.

## Gelombang

| Gelombang | Isi | String | File | Status |
|---|---|---|---|---|
| W0 | Halaman administration dikembalikan ke Inggris (`PanelAdminPage`, `OrganizationPanel`, `ConfigurationPanel`) | 358 | 3 | selesai |
| W1 | Infrastruktur: provider, `t()`, kamus, `LanguageSwitcher`, skrip pre-paint | n/a | 6 | selesai |
| W2 | Permukaan inti: Login, pilih role, AppShell, UserMenu, SwitchRoleDialog, OverlayDialog, Profile, Overview, `ui.tsx`, `format.ts` | ~150 kunci | 12 | selesai |
| W3 | `pages/admin/**` + `ConfigurationPanel` + `SharedServicesPanel` + `WorkflowPanel` | ~660 | 22 | selesai (22/22, 2026-10-29) |
| W4 | `pages/survey/**`, `PublicSurveyPage` (termasuk menyatukan pemilih locale survei dengan locale shell) | 220 | 5 | selesai (5/5, 2026-10-29) |
| W5 | `modules/finance` + `modules/hse` | 809 | 19 | belum |
| W6 | `pages/supply-chain-advanced`, `workforce-advanced`, `sales`, `asset-advanced` | 971 | 17 | belum |
| W7 | Sisa: `pages/complaints`, `operational`, `verification`, `management`, `service-*`, `modules/{project-delivery,customer-commercial,service-operations,asset,reporting-insight,supply-chain,workforce}` | ~900 | 30 | belum |

Urutan berdasarkan volume string terukur. Satu gelombang = satu PR yang bisa direview.

Selesai per gelombang bila: tidak ada string UI hardcoded tersisa di file gelombang itu, `tsc` hijau, lint hijau, build hijau, dan sweep kunci mentah di kedua locale = 0.

### Item lepas (bukan gelombang)

- Label navigasi `nav-*` (24 kode, seed `1787400000000_epic-3-wave-1-menu-catalog.cjs`): diterjemahkan di klien lewat `navLabels` yang di-key oleh `code`. Override tenant (nama dari server berbeda dari label seed) tetap menang.
- `PublicSurveyPage` punya pemilih `id-ID`/`en-US` sendiri. Disatukan dengan locale shell di W4, bukan sebelumnya.
- `shared/format.ts`: `formatDate`/`formatDateShort` ikut locale aktif. `formatMoney` tidak diubah (format akuntansi Indonesia adalah aturan bisnis, bukan preferensi bahasa).

## Batasan yang harus dinyatakan jujur

1. **Pesan galat API tetap Inggris.** `ApiError.message` dikirim server. Tanpa menyentuh backend, tidak bisa diterjemahkan. Item tersendiri: peta `error code` → kamus klien, perlu gelombang backend terpisah.
2. **Data bisnis tidak diterjemahkan.** Nama tenant, role, unit organisasi, isi master data tetap seperti dikirim server. Menerjemahkannya berarti mengubah data, bukan UI.
3. **`DESIGN.md` §6 belum terpenuhi sampai W7 selesai.** §6 mewajibkan Bahasa Indonesia untuk seluruh copy produk; default Inggris adalah keputusan sadar pemilik produk dan bertentangan dengan §6 untuk sementara. Kontradiksi ini sengaja ditandai di sini agar tidak hilang diam-diam.
4. **Persistensi per-browser.** Pilihan tidak ikut ke perangkat lain. Utang bernomor di `docs/technical-debt-register.md`: kolom `users.preferred_locale` + `PATCH /me` (schema `.strict()` di `apps/api/src/interfaces/http/routes/auth.ts:108-123`).

## Sengaja tidak dikerjakan

- Library i18n (i18next/react-intl): tidak dipasang. ~150 kunci tidak membenarkan dependency, bundle, dan konsep baru. Tambah bila plural/ICU/format tanggal-terbilang benar-benar dibutuhkan.
- Plural dan ICU: dilewati, Bahasa Indonesia tidak berinfleksi jumlah. Ditandai `ponytail:` di `t.ts`.
- RTL: tidak berlaku, EN dan ID keduanya LTR.
- Kolom `users.preferred_locale`: ditunda, dicatat sebagai utang.
- Terjemahan pesan API: ditunda ke gelombang backend terpisah.

## Verifikasi

Dari `apps/web/` (`rtk` memecah `npm run lint`, pakai invokasi langsung):

```bash
npx tsc --noEmit
node ../../node_modules/eslint/bin/eslint.js src --max-warnings 0
npm run build
```

Bukti per gelombang:

1. **Kamus lengkap.** Tambah satu kunci ke `en.ts` saja, `tsc` harus gagal `TS2741` di `id.ts`, lalu hapus. Terbukti pada W2.
2. **Tidak ada kunci mentah.** Sweep DOM di kedua locale untuk teks cocok `/^[a-z]+\.[a-z.]+$/`. Harus 0.
3. **Persistensi.** Pilih ID, reload: tetap ID, `<html lang="id">`, tanpa flash EN.
4. **Kedua tema.** EN dan ID × light dan dark. Teks Indonesia lebih panjang: tombol dan label tidak terpotong, kontras AA.
5. **Mobile 390px.** Pemilih bahasa terjangkau di topbar dan drawer, `scrollWidth === 390`.
6. **Keyboard.** Tab mencapai kedua tombol, `aria-pressed` benar, fokus terlihat.
7. **Nav.** Label nav berganti EN/ID, override tenant tetap menang.
8. **Backend tidak berubah.** `npm test -w apps/api` tetap hijau.

Item 2 dan 4–7 dijalankan saat diminta eksplisit atau menjelang serah-terima gelombang, bukan otomatis di setiap perubahan.

### Bukti W4 (2026-10-29)

- Item 1: `tsc` menolak kunci `id.ts` yang hilang (`Record<MessageKey, string>`), terbukti sejak W2.
- Item 2: sweep DOM di 7 tab `SurveyDetailPage` × EN dan ID = 0 kunci mentah, 0 em dash. Sweep dijalankan dengan mengiterasi `main nav button` menurut posisi DOM, bukan dengan mencocokkan teks label, supaya tidak bergantung pada locale yang sedang aktif. Dua string terakhir yang masih hardcoded (judul dan deskripsi tab Token distribusi) ditemukan dan ditutup lewat sweep ini.
- Item 4: kontras terukur di light dan dark, EN dan ID. Nilai terendah di luar pil status = 4.98 (tab tidak aktif). Pil status `text-status-ok` di `bg-status-ok-soft` = 4.41 pada light: nilai palet `DESIGN.md` yang sudah dipakai seluruh aplikasi sebelum W4, bukan regresi gelombang ini. Dicatat di `docs/technical-debt-register.md`.
- Item 6: Tab mencapai tombol tab; fokus terlihat (`ring-accent` 2px + offset 1px). Tiga `focus:ring-slate-400` dan satu `focus-visible:ring-slate-400` diganti token aksen.
- Item 8: tidak ada berkas `apps/api` yang diubah. Kontrak tipe di `apps/web/src/lib/api.ts` disesuaikan ke payload yang sudah ada.

Dua cacat runtime ditemukan lewat click-through dan diperbaiki:

1. `SurveyAnalyticsOverview` dan `SurveyBenchmarkResult` di `api.ts` memakai nama field yang tidak pernah dikirim server (`sectionScores`, `benchmarks`, `assignmentCount`). Akibatnya tab Analytics dan Benchmarking melempar `undefined.map` dan halaman kosong. Tipe sekarang mengikuti `survey-analytics.service.ts` dan `survey-advanced.repository.pg.ts` apa adanya (`sectionAverages`, `items`, `totalAssignments`, `completionRatePercent`, `smallCellSuppressed`).
2. Seluruh `pages/survey/**` memakai `text-slate-*`/`bg-slate-*`/`bg-white` hardcoded. Di tema gelap teks judul jadi `rgb(231,234,240)` di atas panel gelap (rasio 1.02). Diganti token tema (`text-ink`, `text-ink-dim`, `text-ink-faint`, `bg-panel`, `bg-panel-2`, `border-line`, `*-status-*`).

## Gerbang antislop (mode DURING)

R-02 tanpa em dash di copy, R-25 kontras AA, R-32 keyboard, R-34 kedua tema, R-35 click-through terekam.

## Ringkasan (Indonesia)

Roadmap dua bahasa: W0–W4 selesai (admin dikembalikan ke Inggris, infrastruktur, permukaan inti, seluruh `pages/survey/**`). W5–W7 menyusul per modul, urut volume string. Empat batasan dinyatakan jujur: pesan galat API tetap Inggris, data bisnis tidak diterjemahkan, `DESIGN.md` §6 belum terpenuhi sampai W7, persistensi hanya per-browser.

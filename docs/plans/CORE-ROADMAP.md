# Core Roadmap — Abixell One

**Versi:** 1.16
**Tanggal:** 2026-09-30
**Status:** **Epic 1 selesai 2026-09-28** — enam gelombang (skema, sesi server-side, otorisasi hanya-role-aktif, ApprovalAuthority & SoD, route + UI, cutover + regresi) dibangun dan diuji; Epic 5–15 kini terbuka. Epic 2–6 sudah digali; Epic 7–13 sudah digali dan menunggu eksekusi; Epic 14 sudah digali 2026-09-25 (kernel posting; sisanya Wave A6); design system Epic 13 dibangun native di dalam repo; **Epic 4 selesai 2026-09-28 sampai UI/UX** — Gelombang 1 (langkah 5–11b), Gelombang 2 (langkah 11–16 beserta UI-nya), Gelombang 3 (langkah 17–21), dan Gelombang 4 (langkah 22–25) seluruhnya dibangun dan diuji. **Wawancara customer scope selesai 2026-09-28 — enam keputusan terkunci (eksternal saja, default baca dua permission dengan opsi set penuh, permukaan internal tertutup, Admin Tenant pemberi, pencabutan manual plus penjaring sistem, tidak boleh campur scope); item terbuka 1–7 seluruhnya terkunci, termasuk item 4 (batch atomic all-or-nothing) dan item 5–7.** Implementasi seluruh pekerjaan yang lahir dari keputusan itu selesai 2026-09-28 (migration 1788300000000–1788700000000), termasuk penutupan utang kamus rute Wave 2/3. **Sisa Epic 4: hanya filter permukaan internal customer, yang menjadi deliverable wajib modul Service Operation karena belum ada query customer-facing untuk dipasangi filter.** **Epic 15 (Panel Admin) dibuka 2026-09-28 — struktur kategori konfigurasi dan slot modul terkunci sebagai bahan wawancara; detail di §4.15.** **FASE 0 item 3 + FASE 1 local dry-run selesai 2026-10-23 (keputusan Q1a+Q2c):** seed pilot `seed-pilot-catering.ts` terverifikasi dan 29 transaksi UAT-014 dijalankan end-to-end lewat API nyata + consumer outbox — 87 jurnal GL posted, debit = kredit = 6.802.182.00, 29/29 invoice (INV-00001..00029); bukti di `UAT-014-Evidence/`. Pengerjaan staging sendiri belum dijalankan (runbook `docs/operations/pilot-staging-init-runbook.md` siap). Tanpa bobot poin — validasi setara Phase 11F. Wave A6 / Epic 15 / open items tertunda sesuai Q3b/Q4b/Q5b.
**Basis riset:** `D:\RESEARCH AREA\research\idempiere` (22 dokumen) — **diverifikasi ulang ke source code `idempiere/idempiere` dan wiki resmi pada 2026-09-23**

---

## 0. Basis Riset & Aturan Traceability

### 0.1 Mengapa dokumen ini ada

Planning phase sebelumnya menyebut iDempiere sebagai referensi arsitektur, tetapi hanya tiga tempat yang benar-benar menurunkannya (`docs/history/phase-0/spec/05-Configuration-Metadata-Engine.md`, `docs/adr/0002-database-postgresql.md`, `docs/adr/0015`–`0017`). Akibatnya, implementasi core bergerak jauh dari konsep yang diminta: metadata dipakai sebagai validasi schema saja, tidak sebagai sumber kebenaran platform; tidak ada document engine; tidak ada access table berlapis; tidak ada approval authority.

Dokumen ini mengoreksi arah itu. Setiap rekomendasi diturunkan dari konsep iDempiere yang sudah diverifikasi, lalu diterjemahkan ke arsitektur Abixell One.

### 0.2 Aturan yang mengikat dokumen ini

1. **Setiap klaim arsitektur wajib punya rujukan.** Format: konsep iDempiere (`file:line`) → kondisi Abixell One (`file:line` atau tabel).
2. **Empat penanda wajib** pada setiap rekomendasi:
   - `Adopt` — konsep iDempiere diambil hampir utuh.
   - `Modernize` — konsep diambil, implementasi disesuaikan ke stack Abixell One.
   - `Reject` — pendekatan iDempiere tidak dipakai, dengan alasan tertulis.
   - `Needs interview` — belum boleh diputuskan tanpa wawancara.
3. **Klaim tanpa rujukan wajib ditandai `ASUMSI`.**
4. **Verifikasi ulang wajib.** Klaim riset tidak diwarisi begitu saja; lihat §5 untuk koreksi yang ditemukan.

### 0.3 Metode verifikasi

Klaim riset diuji langsung terhadap:

- Source code `idempiere/idempiere` branch `master` via `raw.githubusercontent.com` (dibaca sebagai berkas, bukan dikutip dari riset).
- Wiki resmi `wiki.idempiere.org` dan `idempiere.dev`.
- Skema database Abixell One via `information_schema` pada container `abixell-dev`.

**Hasil: 24 klaim terverifikasi benar, 3 koreksi, 1 temuan besar yang riset lewatkan.** Rincian di §5 dan §7.

---

## 1. Terjemahan iDempiere → Abixell One

| Konsep iDempiere | Wujud terverifikasi | Keputusan | Wujud di Abixell One |
|---|---|---|---|
| `AD_Client` — tenant discriminator | Setiap tabel bisnis punya `AD_Client_ID` | `Adopt` | Sudah ada: `tenant_id` di seluruh tabel |
| `AD_Org` — organisasi dalam tenant | `AD_Org_ID`, `AD_Org_ID = 0` berarti shared | `Adopt` | Sudah ada: `organization_unit` + `scope_type` |
| `AD_Session` — sesi server-side | `AD_Role_ID`, `AD_Org_ID`, `WebSession`, `Remote_Addr`, `Processed` | `Adopt` | **Belum ada.** Hanya `refresh_tokens` |
| `AD_Role` — definisi role | `IsManual`, `UserLevel`, `AmtApproval`, `AmtApprovalAccum`, `DaysApprovalAccum`, `C_Currency_ID`, `IsCanApproveOwnDoc` | `Adopt` | **Parsial.** `roles` hanya `code`, `name`, `is_full_access` |
| Login multi-role + pemilihan context | `Login.getRoles()`, `getWarehouses()` | `Modernize` | Sudah ada: `RoleSiteSelectionPage` (tetapi belum otoritatif) |
| Ganti role tanpa logout | Context dibangun ulang | `Adopt` | Sudah ada: `updateSession({ assignmentId })` (client-side, belum server-side) |
| `AD_Window_Access`, `AD_Process_Access`, `AD_Form_Access`, `AD_Workflow_Access`, `AD_Task_Access` | Lima tabel access, masing-masing punya `IsReadWrite` | `Adopt` | **Belum ada** |
| `AD_Table_Access`, `AD_Column_Access` | `IsReadOnly`, `IsExclude` | `Adopt` | **Belum ada** |
| `AD_Role_OrgAccess` | `IsReadOnly` (bukan `IsReadWrite` — lihat §5) | `Adopt` | **Parsial.** `scope_type` tanpa flag read-only per scope |
| `AD_Private_Access`, `AD_Record_Access` | Lock per record | `Adopt` | **Belum ada** |
| `MRole.addAccessSQL()` — filter query otomatis | `MRole.java:2076` | `Modernize` | **Belum ada.** Saat ini cek per-callsite |
| Approval authority | `getApprovalUser()` `MWFActivity.java:722` | `Adopt` | **Belum ada** |
| SoD / self-approval block | `IsCanApproveOwnDoc` `I_AD_Role.java:342` | `Adopt` | **Belum ada** |
| Eskalasi approver | `Supervisor_ID` user → `Supervisor_ID` org | `Adopt` | **Belum ada** |
| Application Dictionary | `AD_Table`…`AD_Field` + `DisplayLogic`/`MandatoryLogic`/`ReadOnlyLogic` | `Modernize` | **Parsial.** Metadata sebagai kontrak schema, bukan generator UI |
| `AD_Menu` + `AD_TreeNodeMM` | Menu tree sebagai data | `Modernize` | **Belum ada** (nav hardcoded di frontend) — dikerjakan Epic 3 (§4.3) |
| Document Engine | `DocAction.java:36-85` | `Adopt` | **Belum ada.** Status ad hoc per modul |
| Document type + numbering | `C_DocType` + `AD_Sequence` + `C_DocTypeCounter` | `Adopt` | **Belum ada** |
| `AD_SysConfig` + `ConfigurationLevel` | Parameter setup berjenjang | `Adopt` | **Belum ada** |
| `AD_EntityType` | Module descriptor: `EntityType`, `ModelPackage`, `Version` | `Modernize` | **Parsial.** `modules` tanpa versi/model |
| ModelValidator + Event handler | `ModelValidator.java`, `IEventTopics.java` | `Adopt` | **Belum ada** hook resmi |
| `SvrProcess` | Batch/on-demand process | `Modernize` | Belum ada sebagai abstraksi resmi |
| `AD_Scheduler` | Job terjadwal in-app | `Modernize` | Belum ada |
| Print Format / JasperReports | `ReportEngine.java`, `AD_PrintFormat` | `Modernize` | Belum ada |
| `ITheme` / `ThemeManager` | Theme sebagai plugin | `Modernize` | **Belum ada.** Tailwind hardcoded |
| `AD_PasswordRule` + user locking | Aturan berbasis kamus, sequence, QWERTY | `Adopt` | **Belum ada** |
| OSGi/Equinox | Modularitas classloading | `Reject` | Kompleksitas terbukti jadi hambatan DX |
| Dual UI Swing + ZK | Dua toolkit paralel | `Reject` | iDempiere sendiri menyebut Swing legacy |
| Schema sync via UI | "Synchronize Column" | `Reject` | Migration-as-code sudah dipegang |
| Workflow proprietary non-BPMN | `AD_Workflow` | `Needs interview` | Format engine belum diputuskan |
| Metadata langsung meng-generate UI | GridWindow/GridField | `Reject` | Metadata jadi kontrak API, UI tetap eksplisit |

**Prinsip yang diambil dari iDempiere dan berlaku menyeluruh:**

> **Menu bukan security boundary.** Wiki *Securing iDempiere* menyatakannya verbatim: *"it is recommended to configure the security using access, not menus (menus don't restrict access - user still can zoom)"*. Menyembunyikan menu hanya kosmetik; user tetap mencapai window lewat Zoom selama punya Window Access.

Konsekuensi untuk Abixell One: seluruh enforcement wajib di layer API/data. Navigasi frontend, `capabilities.ts`, dan `activeModuleCodes` **tidak pernah** menjadi kontrol akses.

---

## 2. Core Capability Map & Gap

### 2.1 Kondisi Abixell One saat ini

| Metric | Nilai | Sumber |
|---|---|---|
| Module terdaftar | 13 | `select count(*) from modules` |
| Permission | 162 | `select count(*) from permissions` |
| Role | 93 | `select count(*) from roles` |
| Role assignment | 107 | `select count(*) from user_role_assignments` |
| Situs panggilan `rbac.*` | **500 di 42 berkas** | `grep -c` lintas `apps/api/src` |
| Tabel sesi server-side | 0 | hanya `refresh_tokens` |
| Tabel parameter/config | 1 | hanya `scm_account_assignment_configs` |

Module aktif: `asset`, `customer_commercial`, `customer_complaint`, `finance`, `hse`, `procurement_management`, `project_delivery`, `reporting_insight`, `service_operations`, `supply_chain`, `survey_assessment`, `warehouse_management`, `workforce`.

### 2.2 Peta celah

```text
LAPISAN                          iDempiere              ABIXELL ONE
─────────────────────────────────────────────────────────────────────
1. Tenant isolation              AD_Client_ID           ✅ tenant_id
2. Organization scope            AD_Org_ID + OrgAccess  ⚠️  scope_type (tanpa read-only per scope)
3. Active role context           AD_Session.AD_Role_ID  ❌ tidak ada
4. Role definition              AD_Role (lengkap)      ⚠️  code/name/is_full_access saja
5. Module access                 AD_EntityType + grant  ⚠️  modules + tenant_module_activations
6. Window/page access            AD_Window_Access       ❌ tidak ada
7. Process/action access         AD_Process_Access      ❌ tidak ada
8. Table CRUD access             AD_Table_Access        ❌ tidak ada
9. Column/field access           AD_Column_Access       ❌ tidak ada
10. Record-level access          AD_Private/Record_Acc  ❌ tidak ada
11. Approval authority           AmtApproval + accum    ❌ tidak ada
12. Segregation of duties        IsCanApproveOwnDoc     ❌ tidak ada
13. Escalation hierarchy         Supervisor_ID          ❌ tidak ada
14. Menu tree                    AD_Menu + TreeNodeMM   ❌ tidak ada
15. Field logic (display/mand.)  AD_Field logic columns ❌ tidak ada
16. Parameter setup              AD_SysConfig           ❌ tidak ada
17. Document lifecycle           DocAction state mach.  ❌ tidak ada
18. Document type + numbering    C_DocType + AD_Sequence❌ tidak ada
19. Extension hooks              ModelValidator + Event ❌ tidak ada
20. Scheduler                    AD_Scheduler           ❌ tidak ada
21. Reporting artifacts          AD_PrintFormat         ❌ tidak ada
22. Theme                        ITheme/ThemeManager    ❌ tidak ada
23. Password policy              AD_PasswordRule        ❌ tidak ada
24. Audit trail                  Change/Session/Process ✅ audit_log
```

**Sudah selaras:** tenant isolation, audit trail, migration-as-code, Docker, modular monolith, pemisahan permission (apa) dari data scope (data mana).

**Akar masalah core:** otorisasi Abixell One saat ini **hanya lapisan 1, 2, dan 5**. Lapisan 3, 4, dan 6–13 — yaitu seluruh model otorisasi iDempiere yang membuat role benar-benar mengikat — tidak ada.

### 2.3 Bukti akar masalah: permission adalah union murni

`apps/api/src/infrastructure/persistence/repositories/rbac.repository.pg.ts:653`

```sql
SELECT DISTINCT p.code
  FROM authorization_effective_user_role_assignments aura
  JOIN role_permissions rp ON rp.role_id = aura.role_id
  JOIN permissions p ON p.id = rp.permission_id
 WHERE aura.user_id = $1
```

Tidak ada klausa role aktif. Seorang user dengan role A dan role B mendapat **gabungan** permission keduanya, dan `RbacService.requirePermission()` (`apps/api/src/application/rbac/rbac.service.ts:27`) menerima gabungan itu.

`apps/api/src/interfaces/http/routes/auth.ts` mendokumentasikan celah ini secara eksplisit dalam komentarnya: `assignmentId` **"is UI shaping only"** dan *"per-axis authorization in the backend continues to evaluate every assignment regardless"*.

Inilah yang harus diubah Epic 1.

---

## 3. Prinsip Arsitektur Core

Prinsip berikut berlaku untuk seluruh Epic, bukan hanya Epic 1.

1. **Satu security context, mengalir ke semua lapisan.** `ActorContext` saat ini `{ userId, tenantId }` (`apps/api/src/domain/shared-kernel/audit-context.ts`) harus menjadi pembawa context lengkap ala iDempiere (`#AD_Client_ID`, `#AD_Org_ID`, `#AD_Role_ID`, `#AD_User_ID`).
2. **Enforcement di API/data, bukan di UI.** `capabilities.ts` dan `activeModuleCodes` hanya presentasi.
3. **Permission ≠ Data Scope ≠ Approval Authority.** Tiga hal berbeda: *apa yang boleh*, *data mana yang boleh*, *berapa nilai yang boleh disetujui*.
4. **Metadata sebagai sumber kebenaran, tetapi tidak meng-generate UI.** Mengikuti keputusan yang sudah diambil di `docs/history/phase-0/spec/05-Configuration-Metadata-Engine.md`.
5. **Configuration over customization.** Setiap permintaan yang berulang harus menjadi konfigurasi, bukan fork kode.
6. **Migrasi sebagai satu-satunya jalur perubahan skema.** `Reject` pola "Synchronize Column".
7. **Setiap perubahan otorisasi wajib auditable.** Reuse `audit_log` + pola governed transaction (`apps/api/src/infrastructure/persistence/repositories/governed-transaction.ts`).

---

## 4. Epic Register

| # | Epic | Bergantung pada | Status |
|---|---|---|---|
| **1** | **Security Context, Role Definition & Approval Authority** | — | **Eksekusi 2026-09-28 — sessions + active-role + ApprovalAuthority + switch-role + cutover selesai; detail di §4.1** |
| 2 | Application Dictionary & Metadata Engine | Epic 1 | **Eksekusi 2026-10-01 — Wave 2 (Reference Data Metadata) dan Wave 3 (Parameter Bridge) selesai; 14/14 focused tests, 30/30 parity tests, 958/958 API regression, typecheck 0 errors, bootstrap key timing attack fixed; detail di §4.2** |
| 3 | Module & Menu Tree Configuration | Epic 2 | **Digali 2026-09-23 — detail di §4.3, siap eksekusi setelah Epic 2** |
| 4 | User, Role & Permission Configuration UI | Epic 1, 2, 3 | **Digali 2026-09-24 — detail di §4.4, siap desain setelah Epic 1–3** |
| 5 | Company, Tenant & Organization Profile | Epic 1, 2, 4 | **Eksekusi 2026-09-28–2026-09-30 — G0-G4 COMPLETE; Phase 1-5 selesai (43 test regression + Phase 4 live DB re-parent); detail di §4.5** |
| 6 | User Identity, Employee, Business Partner & Assignment | Epic 1, 4, 5 | **Digali 2026-09-24 — detail di §4.6, siap desain setelah Epic 1, 4, dan 5** |
| 7 | Document Engine & Transaction Lifecycle | Epic 1, 2, 5, 6 | **Digali 2026-09-24 — detail di §4.7, siap desain setelah Epic 1, 2, 5, 6** |
| 8 | Document Type, Numbering & Parameter Setup | Epic 7 | **Digali 2026-09-25 — detail di §4.8, siap desain setelah Epic 7** |
| 9 | Workflow Engine, Approval Matrix & Escalation | Epic 1, 7 | **Digali 2026-09-25 — detail di §4.9, siap desain setelah Epic 1 dan 7** |
| 10 | Password, Session & User Security | Epic 1, 6 | **Digali 2026-09-25 — detail di §4.10, siap desain setelah Epic 1 dan 6** |
| 11 | Extension Hooks: Validator, Event, Callout & Process | Epic 2, 7 | **Digali 2026-09-25 — detail di §4.11, siap desain setelah Epic 2 dan 7** |
| 12 | Reporting, Scheduler & Notification Artifacts | Epic 7, 11 | **Digali 2026-09-25 — detail di §4.12, siap desain setelah Epic 7 dan 11** |
| 13 | UI/UX Theme System & Generic Rendering | Epic 2 | **Digali 2026-09-25 — detail di §4.13, siap desain setelah Epic 2; design system dibangun native di dalam repo (keputusan #6 direvisi 2026-09-25)** |
| 14 | Finance & Accounting Posting | Epic 7 | **Digali 2026-09-25 — detail di §4.14 (kernel posting saja); sisanya Wave A6 sesi terpisah; siap desain setelah Epic 7, 8, 9, 11 + tinjauan akuntan untuk template bagan akun** |
| 15 | Panel Admin — Pusat Konfigurasi Tunggal | Epic 2, 4, 5, 8, 9, 12, 13 | **Dibuka 2026-09-28 — struktur 8 kategori konfigurasi dan 13 slot modul terkunci sebagai bahan wawancara (§4.15); wawancara desain belum dilakukan** |

Setiap Epic 2–15 digali lewat wawancara sebelum ditulis detail dan dieksekusi, mengikuti mekanisme yang sama dengan Epic 1.

---

### 4.1 EPIC 1 — Security Context, Role Definition & Approval Authority

#### Problem statement

Seorang user dapat memegang lebih dari satu role (mis. Creator dan Approver). Saat ini seluruh role yang dipegang **berlaku serentak**: `getEffectivePermissionCodes` menggabungkan permission dari semua assignment tanpa mempertimbangkan role aktif. Akibatnya:

- Tidak ada pemisahan tugas. Satu user dengan role Creator + Approver dapat membuat dan menyetujui dokumen yang sama dalam satu sesi.
- Ganti role di `/select-workspace` hanya mengubah apa yang **dilaporkan** ke UI, bukan apa yang **diizinkan** backend.
- Tidak ada batas nilai approval, tidak ada eskalasi approver, tidak ada blokir self-approval.
- Header aplikasi menampilkan UUID mentah, bukan identitas user.

Ini adalah perubahan lapisan otorisasi inti, bukan perubahan UI.

#### Keputusan yang sudah dikunci (hasil wawancara)

| Topik | Keputusan |
|---|---|
| Model multi-role | Satu user boleh punya banyak role; role aktif yang berlaku |
| Ruang lingkup penolakan | **Seluruh** permukaan otorisasi — RBAC, CRUD, dan akses page/module — bukan hanya approval |
| Model SoD | **Utuh (iDempiere penuh):** role flag + approval limit + akumulasi + konversi kurs + hierarki eskalasi |
| Model approval | Tidak boleh menyetujui dokumen sendiri, **dan** dibatasi nilai, **dan** dieskalasi otomatis bila tidak berwenang |
| Ganti role | Langsung, tanpa re-login |
| Sumber kebenaran role aktif | Sesi server (DB), bukan di dalam JWT |
| Token legacy | Ditolak; semua user dipaksa login ulang |
| Audit | Setiap pergantian role tercatat sebagai audit event |
| Demo data | Tambah satu user demo 2-role (Creator + Approver); 7 user demo lainnya tidak diubah |
| Urutan pengerjaan | Ditanyakan setelah user selesai review plan lain |

#### Basis iDempiere (terverifikasi)

**Sesi server-side — `I_AD_Session.java`**
Kolom terverifikasi: `AD_Client_ID`, `AD_Org_ID`, `AD_Role_ID`, `Description`, `IsActive`, `LoginDate`, `Processed`, `Remote_Addr`, `Remote_Host`, `ServerName`, `WebSession`. Role aktif hidup di sesi server, bukan di token.

**Definisi role — `I_AD_Role.java`**

| Baris | Kolom | Fungsi |
|---|---|---|
| 210 | `AmtApproval` | Batas nominal approval role |
| 223 | `AmtApprovalAccum` | Batas akumulasi nominal dalam periode |
| 236 | `C_Currency_ID` | Mata uang batas tersebut |
| 281 | `DaysApprovalAccum` | Panjang periode akumulasi (hari) |
| 342 | `IsCanApproveOwnDoc` | Boleh menyetujui dokumen sendiri atau tidak |
| 316 | `IsAccessAllOrgs` | Shortcut akses semua organisasi |
| 425 | `IsManual` | Mode whitelist akses |
| 516 | `IsUseUserOrgAccess` | Sumber daftar org: user atau role |

**Penyelesaian approver — `MWFActivity.java:722`**

```java
public int getApprovalUser(int AD_User_ID, int C_Currency_ID, BigDecimal amount,
                           int AD_Org_ID, boolean ownDocument)
```

Alur terverifikasi:

1. `amount == null || amount.signum() == 0` → tidak ada yang perlu disetujui, langsung selesai (`:727-729`).
2. Ambil role user pada organisasi dokumen: `user.getRoles(AD_Org_ID)` (`:762`).
3. **Blokir self-approval:** `if (ownDocument && !role.isCanApproveOwnDoc()) continue;` (`:766-767`).
4. Role tanpa batas nominal dilewati: `if (roleAmt == null || roleAmt.signum() == 0) continue;` (`:769-770`).
5. Konversi kurs bila mata uang role ≠ mata uang dokumen, memakai `MConversionRate.convert(...)` (`:771-779`).
6. Bandingkan: `boolean approved = amount.compareTo(roleAmt) <= 0;` (`:780`).
7. **Batas akumulasi:** bila `AmtApprovalAccum > 0` dan `DaysApprovalAccum > 0`, hitung total dokumen yang sudah di-approve user dalam periode tersebut, tambahkan nominal dokumen ini, lalu bandingkan (`:786-798`).
8. Bila lolos → `return user.getAD_User_ID()` (`:801-802`).
9. Bila tidak → naik ke `user.getSupervisor_ID()` (`:807-811`); bila kosong, ke `MOrgInfo.getSupervisor_ID()` (`:815-822`).
10. Guard terhadap siklus hierarki (`:752-758`), dan `NoApprover` bila tidak ada approver (`:1343`).

**Penentu `ownDocument` — `MWFActivity.java:1336-1340`**

```java
int startAD_User_ID = Env.getAD_User_ID(getCtx());
if (startAD_User_ID == 0) startAD_User_ID = doc.getDoc_User_ID();
int nextAD_User_ID = getApprovalUser(startAD_User_ID, doc.getC_Currency_ID(),
        doc.getApprovalAmt(), doc.getAD_Org_ID(),
        startAD_User_ID == doc.getDoc_User_ID());   // own doc
```

Pembandingnya adalah **user dokumen** (`getDoc_User_ID()`, dideklarasikan di interface `DocAction.java:244`), bukan `created_by` di tabel transaksi. Ini berbeda dari asumsi awal pada wawancara.

**Perhitungan akumulasi — `MWFActivity.java:854`**
`getAmtAccum()` menghitung dokumen pada tabel yang sama, pada aktivitas workflow dengan kolom `IsApproved`, `WFState='CC'`, `a.UpdatedBy = userid`, dalam rentang `days` hari, dengan penyaringan tambahan bila tabel punya `IsSOTrx`, `IsReceipt`, atau `DocStatus`.

#### Yang dibangun

**A. Skema database (migration baru)**

Mengikuti migration-as-code, satu migration untuk skema dan satu untuk permission, pola yang sudah dipakai `1786000000000_tenant-name-update-permission.cjs`.

| Objek | Perubahan | Basis |
|---|---|---|
| `sessions` (baru) | `id`, `user_id`, `tenant_id`, `active_assignment_id`, `active_role_id`, `organization_unit_id`, `web_session`, `remote_addr`, `login_at`, `last_seen_at`, `revoked_at`, `processed` | `AD_Session` |
| `roles` | Tambah `is_manual`, `is_can_approve_own_doc`, `amt_approval`, `amt_approval_accum`, `days_approval_accum`, `currency_code`, `is_access_all_orgs`, `user_level` | `AD_Role` |
| `user_role_assignments` | Tambah `is_read_only` per scope | `AD_Role_OrgAccess.IsReadOnly` |
| `users` | Tambah `supervisor_user_id` | `AD_User.Supervisor_ID` (`I_AD_User.java:825`) |
| `organization_units` | Tambah `supervisor_user_id` | `AD_OrgInfo.Supervisor_ID` (`I_AD_OrgInfo.java:286`) |
| `role_window_access` (baru) | `role_id`, `window_code`, `is_read_write`, `is_active` | `AD_Window_Access` |
| `role_process_access` (baru) | `role_id`, `process_code`, `is_read_write`, `is_active` | `AD_Process_Access` |
| `role_table_access` (baru) | `role_id`, `table_code`, `is_read_only`, `is_exclude` | `AD_Table_Access` |
| `role_column_access` (baru) | `role_id`, `table_code`, `column_code`, `is_read_only`, `is_exclude` | `AD_Column_Access` |
| `role_record_access` (baru) | `role_id`, `record_id`, `table_code`, `is_read_write` | `AD_Record_Access` |

Catatan: entitas transaksi perlu pembawa **document user** setara `Doc_User_ID`. Karena document engine belum ada (Epic 7), Epic 1 hanya menetapkan konvensinya di tipe bersama dan menerapkannya pada entitas yang sudah punya `created_by` (`complaints`, `work_orders`).

**B. Security context server-side**

- `sessions` menjadi sumber kebenaran role aktif. `refresh_tokens` tetap menangani rotasi token; `sessions` menangani context.
- `apps/api/src/infrastructure/security/jwt.ts` tetap **tidak** membawa permission, sesuai komentar yang sudah ada di sana. Yang ditambahkan adalah `sessionId` pada payload, agar setiap request dapat me-resolve role aktif.
- `apps/api/src/interfaces/http/plugins/auth-plugin.ts:58` diubah: `request.actor` dibangun dari `{ userId, tenantId }` (`apps/api/src/domain/shared-kernel/audit-context.ts`) menjadi context lengkap dengan `assignmentId`, `roleId`, `scopeType`, `scopeOrganizationUnitId`, `scopeCustomerId`.
- `ActorContext` diperluas. Ini menyentuh **500 situs panggilan `rbac.*` di 42 berkas** — perubahan mekanis yang harus dikerjakan bertahap dengan typecheck sebagai penjaga.

**C. Otorisasi hanya role aktif**

`apps/api/src/infrastructure/persistence/repositories/rbac.repository.pg.ts:653` diubah agar seluruh query menerima `assignmentId` dan memfilter `aura.id = $assignmentId`, bukan `aura.user_id = $userId`.

`apps/api/src/application/rbac/rbac.service.ts` berubah dari:

```ts
async requirePermission(userId: string, permissionCode: string): Promise<void>
```

menjadi menerima actor context lengkap, sehingga role aktif selalu ikut dievaluasi. Perilaku baru:

- Permission yang tidak dimiliki role aktif → **403**, walaupun role lain memilikinya.
- Akses page/module yang tidak sesuai role aktif → ditolak di API, bukan hanya disembunyikan di UI.
- CRUD di luar role aktif → ditolak.

**D. Approval authority & SoD**

Satu layanan baru, terpisah dari `RbacService`, karena tanggung jawabnya berbeda:

```ts
interface ApprovalAuthority {
  resolveApprover(input: {
    actor: ActorContext;
    documentUserId: string;
    amount: number | null;
    currencyCode: string;
    organizationUnitId: string;
    documentTable: string;
    documentId: string;
  }): Promise<ApprovalDecision>;
}

type ApprovalDecision =
  | { kind: "self-approved" }                                   // amount 0 → tak perlu approval
  | { kind: "approve"; approverUserId: string }                 // berwenang
  | { kind: "escalate"; nextApproverUserId: string }            // naik ke supervisor
  | { kind: "no-approver" };                                    // gagal bersih
```

Logika mengikuti `getApprovalUser` persis, termasuk urutan pemeriksaan, konversi kurs, akumulasi, eskalasi, dan guard siklus.

**E. Audit**

Setiap pergantian role menulis satu baris `audit_log` dengan `action = 'session.role.switched'` dan metadata `{ previousRoleId, roleId, previousAssignmentId, assignmentId }`. Reuse `recordGovernedAudit` (`apps/api/src/infrastructure/persistence/repositories/governed-transaction.ts`).

**F. Cutover**

Token tanpa `sessionId` **ditolak**. Semua user login ulang. Tidak ada masa transisi. Ini membuat tabel `sessions` kosong saat deploy dan menghindari state campuran.

#### Frontend

| Perubahan | Berkas |
|---|---|
| Header: avatar generik di kanan atas, nama lengkap di sebelah kirinya | `apps/web/src/shell/layout/AppShell.tsx` |
| Hapus blok UUID + Sign out di footer sidebar **dan** footer drawer mobile | `apps/web/src/shell/layout/AppShell.tsx` |
| Dropdown avatar: Profil / Ganti Role / Keluar | komponen baru |
| Halaman Profil baru | route baru di `apps/web/src/App.tsx`, di dalam `AppShell` |
| `Session` menyimpan `sessionId`; `updateSession` memanggil API ganti role | `apps/web/src/auth/AuthContext.tsx` |
| `/me` mengembalikan `fullName`, `email`, role aktif | `apps/api/src/interfaces/http/routes/auth.ts`, `apps/web/src/lib/api.ts` |
| Picker role dipakai ulang sebagai dialog di dalam shell | `apps/web/src/pages/RoleSiteSelectionPage.tsx` |

Catatan antislop: modul antislop belum diarahkan untuk pekerjaan UI ini. Sampai ada arahan desain (`DESIGN.md`), tambahan avatar, dropdown, dan halaman Profil diperlakukan sebagai **draft without direction**, dial ENERGY/RHYTHM/MOTION = 1, dan bukan deliverable yang bisa dikirim ke produksi.

#### Pengujian

Database test terisolasi — **jangan** menjalankan suite pada `abixell_one_dev`:

```bash
DATABASE_URL="postgresql://abixell:abixell_dev_password@localhost:5442/abixell_one_tenant_update_test?schema=public" npx vitest run
```

Wajib dibuktikan dengan `SELECT current_database()` sebelum hasil dipercaya.

Cakupan minimal:

1. Role tunggal → perilaku lama tidak berubah.
2. Dua role, role aktif A → permission milik B **ditolak 403**, walaupun user memegang B.
3. Ganti role tanpa re-login → permission berubah sesuai role baru; audit tercatat.
4. Token tanpa `sessionId` → 401.
5. Self-approval: `IsCanApproveOwnDoc = false` → dokumen sendiri tidak dapat di-approve.
6. `IsCanApproveOwnDoc = true` → dapat di-approve.
7. Nominal melebihi `AmtApproval` → eskalasi ke supervisor, bukan error.
8. Tanpa supervisor dan tanpa supervisor org → `no-approver`, gagal bersih.
9. Akumulasi melewati `AmtApprovalAccum` dalam `DaysApprovalAccum` → eskalasi.
10. Konversi kurs saat mata uang role ≠ mata uang dokumen.
11. Siklus hierarki supervisor → berhenti, tidak menggantung.
12. Regression penuh.

#### Di luar cakupan Epic 1

- Membangun document engine dan lifecycle (Epic 7).
- UI konfigurasi access table (Epic 4) — pada Epic 1 tabel dibaca oleh backend; pengisian awal lewat migration.
- Menu tree (Epic 3).
- Theme (Epic 13).
- Perubahan pada 7 user demo yang sudah ada.

#### Keputusan Epic 1 yang tercatat

| Topik | Keputusan |
|---|---|
| `service_acceptances` & `disposals` tanpa `created_by` | **Menunggu Epic 7** (diputuskan 2026-09-23). Epic 1 tidak menambah kolom; konvensi document user hanya pada `complaints` dan `work_orders`. |
| Urutan Epic | **Mulai Epic 2** (diputuskan 2026-09-23), karena Epic 2 memblokir Epic 3, 4, 7, 11, 13. |

#### Riwayat eksekusi Epic 1 (2026-09-28)

**Epic 1 selesai 2026-09-28, enam gelombang, seluruhnya dibangun dan diuji.** Blokaran untuk Epic 5–15 terbuka. Yang dibangun, dan keputusan yang mengikat:

| Gelombang | Wujudnya |
|---|---|
| W1 — Skema (§4.1 A) | Lima migration: `1788800000000` (kolom Role approval `amt_approval`, `amt_approval_accum`, `days_approval_accum`, `currency_code`, `is_can_approve_own_doc`, `is_manual`, `is_access_all_orgs`, `user_level`; `users.supervisor_user_id`; `organization_units.supervisor_user_id`; `user_role_assignments.is_read_only`), `1788900000000` (tabel `sessions` — sumber kebenaran role aktif; `ON DELETE SET NULL` pada `active_assignment_id` karena Epic 4 dapat mencabut assignment saat sesi masih hidup; `active_assignment_id` nullable: rute tanpa permission tetap terjangkau, rute permission gagal tertutup 403), `1789000000000` (`currency_conversion_rates` milik tenant, tanpa baris seed — kurs adalah fakta dunia, bukan karangan produk; kurs hilang gagal bersih), `1789100000000` (`workflow_history.decision_amount` — sumber data jendela akumulasi; nominal disalurkan dari `contextData` instance saat engine merekam keputusan), `1789200000000` (baris kamus `api:POST /auth/switch-role`; `dictionary-seed-parity` hijau penuh). |
| W2 — Sesi server-side (§4.1 B) | Token akses kini membawa `sessionId`, bukan permission; `auth-plugin` membangun `request.actor` dari baris sesi setiap request. `ActorContext` diperluas menjadi `{ userId, tenantId, sessionId, assignmentId, roleId, roleCode, scopeType, scopeOrganizationUnitId, scopeCustomerId }`. Login memilih assignment default urut nama Role (`ORDER BY r.name, aura.id LIMIT 1`). `refresh_tokens` tetap pegang rotasi token; `sessions` pegang context. |
| W3 — Otorisasi role aktif (§4.1 C) | `rbac.repository.pg.ts` menerima `assignmentId` dan memfilter `aura.id`, bukan `aura.user_id`; `requirePermission`, `requireTenantScopedPermissionForActor`, gerbang Window (`getWindowAccessStateForActor`), dan `requireTransactionActorPermission` (transaksi governed) semuanya membaca assignment aktif. `assignmentId = null` → 403 `No active Role in this session; switch to a Role that grants permission '<code>'`. `admin-console.service.ts getOverview` dilaporkan sebagai celah produksi nyata dan diperbaiki: kapabilitas kini diuji lewat `hasTenantScopedPermissionForAssignment` atas assignment aktif, bukan union assignment user. |
| W4 — ApprovalAuthority & SoD (§4.1 D) | `approval-authority.service.ts` + `approval-authority.repository.pg.ts`, terpisah dari `RbacService`. `ApprovalDecision` empat arah (`self-approved` / `approve` / `escalate` / `no-approver`), mengikuti urutan `getApprovalUser` persis: blokir self-approval, Role tanpa batas nominal dilewati (NULL ≠ tak terbatas), konversi kurs sebelum banding, batas akumulasi `workflow_history` dalam jendela hari, eskalasi `users.supervisor_user_id` lalu `organization_units.supervisor_user_id`, guard siklus hierarki. `compareAmounts` membandingkan presisi penuh; `convertAmount` memotong sub-sen, tidak pernah membulatkan naik. |
| W5 — Route + UI (§4.1 Frontend) | `POST /auth/switch-role` — ganti role tanpa re-login, tanpa token baru; baris sesi adalah context-nya. Audit `session.role.switched` di `session.service.ts:261` dengan metadata `{ previousRoleId, roleId, previousAssignmentId, assignmentId }`. Web: `UserMenu` (avatar generik + nama lengkap, dropdown Profil / Ganti Role / Keluar) menggantikan blok UUID footer sidebar dan drawer; `SwitchRoleDialog` dipakai ulang dari picker `RoleSiteSelectionPage`; `AuthContext` menyimpan `sessionId` dan memanggil API switch-role; `/me` mengembalikan `fullName`, `email`, role aktif. |
| W6 — Cutover + regresi (§4.1 F) | Token tanpa `sessionId` **ditolak 401**, tanpa masa transisi; semua user login ulang. |

**Konflik kontrak dengan §4.4 langkah 11b — diselesaikan, Epic 1 menang.** §4.4 langkah 11b menjanjikan union allow: `is_read_write = true` pada satu assignment efektif sudah cukup membuka tulis. §4.1 C, yang dikunci lebih lanjut sebagai lapisan inti otorisasi, menyatakan sebaliknya: "Permission yang tidak dimiliki role aktif → 403, walaupun role lain memilikinya" dan "Akses page/module yang tidak sesuai role aktif → ditolak di API". Semantik union adalah prase-Epic1 lintas-assignment; sejak Epic 1 gerbang Window (`getWindowAccessStateForAssignment`) dan seluruh permukaan otorisasi membaca **hanya assignment aktif**. Tiga uji lama yang menegaskan union diadaptasi dengan komentar penjelas; produksi (gerbang Window, kapabilitas overview) dibangun langsung pada bentuk assignment-aktif selama gelombang ini. Perilaku gerbang Window: read-only aktif → 403; pindah ke Role writable via switch-role → 201.

**Bukti** (semua pada database terisolasi, `SELECT current_database()` dijaga guard per suite; jangan pernah menjalankan pada `abixell_one_dev`):

- `tests/integration/epic-1-security-context.test.ts` 4/4 pada `abixell_one_epic1` — kasus 1–4 persis cakupan minimal §4.1 Pengujian (role tunggal tak berubah, 403 permission role lain saat aktif, switch tanpa re-login + audit, token tanpa `sessionId` 401).
- `tests/approval-authority-unit.test.ts` 15/15 tanpa DB — kasus 5–11 cakupan minimal (self-approval dua arah, eskalasi batas nominal, no-approver bersih, akumulasi, konversi kurs, kurs hilang, siklus hierarki, plus presisi banding dan pemotongan konversi).
- Regresi penuh 62 berkas / 867 uji lulus pada `abixell_one_epic1` (pengecualian dua suite guard); `role-definition.test.ts` 18/18 + `window-enforcement.test.ts` 9/9 pada `abixell_one_epic3_wave4` setelah adaptasi kontrak di atas.
- `tsc --noEmit` bersih di `apps/api` dan `apps/web`; eslint bersih di `apps/web`; sisa temuan error-level eslint `apps/api` berada di berkas yang tidak disentuh Epic 1 (pre-existing).
- Demo: `seed.ts` menambah satu user demo 2-role (Creator + Approver); 7 user demo lainnya tidak diubah, sesuai keputusan wawancara.

#### Item terbuka di Epic 1

| # | Item | Perlu |
|---|---|---|
| 1 | Apakah setiap entitas transaksi memakai satu kolom "document user", atau boleh berbeda per modul? | Keputusan saat Epic 7 |
| 2 | Untuk entitas yang belum punya `created_by` (`service_acceptances`, `disposals`), apakah kolom ditambahkan sekarang atau menunggu Epic 7? | **Diputuskan 2026-09-23: menunggu Epic 7.** Epic 1 tidak menambah kolom pada kedua tabel ini; konvensi document user diterapkan hanya pada entitas yang sudah punya `created_by` (`complaints`, `work_orders`). |
| 3 | Apakah approval berlaku juga untuk aksi non-dokumen (mis. perubahan konfigurasi)? | **Terblokir — belum terjawab.** Wawancara Epic 9 (2026-09-25) tidak memutuskan ini; §4.9 memindahkannya ke daftar "Open items" sebagai item #4 ("Wawancara lanjutan setelah target aksi dan audit scope jelas") dan ke "Di luar cakupan" baris 2752 ("tetap open decision lintas domain sampai tipe target dan audit contract ditentukan"). Titik keputusannya adalah **tipe target** mana yang boleh di-approve dan **audit contract**-nya — bukan mesin workflow, yang sudah selesai. Titik itu milik Epic 2 Gelombang 2 (§4.2 gelombang 2 menetapkan reference data, terminology, dan numbering pattern — jumlah target non-dokumen terkecil) dan Epic 13 Wave 13.5 (form admin pertama yang benar-benar memakai generator). §4.2 sudah menetapkan arahnya: guardrail #1 "Batas wewenang" melarang super admin mengubah kolom definisi-akses dari UI, dengan atau tanpa approval. |

---

### 4.2 EPIC 2 — Application Dictionary & Metadata Engine

#### Problem statement

Abixell One sekarang tidak punya daftar resmi tentang apa saja yang ada di dalam aplikasi. Halaman, tombol aksi, tabel, dan field tidak terdaftar di satu tempat. Akibatnya:

- Role tidak bisa dibatasi per halaman atau per aksi, karena halaman dan aksi itu sendiri tidak punya identitas resmi.
- Field yang wajib, tersembunyi, atau terkunci tidak bisa diatur tanpa mengubah kode React.
- Istilah di layar tidak bisa disesuaikan per tenant.
- Setiap modul menulis aturan tampilannya sendiri, sehingga perilaku berbeda-beda antar modul.

Yang sudah ada saat ini hanya satu tabel kecil, `metadata_registry`, berisi 4 baris validasi nilai konfigurasi (feature flag, numbering, reference data, terminology). Itu bukan Application Dictionary; itu hanya pemeriksa bentuk nilai.

**Epic 2 membangun kamus aplikasi**, yaitu daftar resmi objek aplikasi beserta sifatnya, sehingga Epic 1 (akses), Epic 3 (menu), Epic 4 (konfigurasi role), Epic 7 (dokumen), dan Epic 13 (tema) punya pijakan yang sama.

#### Keputusan yang sudah dikunci (hasil wawancara 2026-09-23)

| Topik | Keputusan |
|---|---|
| Tujuan kamus | Fondasi keamanan **lebih dulu**, lalu UI/form, lalu konfigurasi bisnis. Ketiganya wajib, tetapi bertahap. |
| Pembagian | **Tiga gelombang.** Gelombang 1 membuka Epic 1/3/4; Gelombang 2 konfigurasi bisnis; Gelombang 3 logic lanjutan. |
| UI dari kamus | **Generator terbatas.** Kamus boleh menghasilkan form sederhana untuk halaman admin/konfigurasi. Halaman transaksi utama tetap ditulis manual di React. |
| Pemetaan Window/Tab | **Window = satu halaman/route. Tab = bagian di dalam halaman itu.** |
| Isi Tab | Konfigurasi apa pun muncul sebagai **card** di dalam Tab. Berapa pun jumlahnya, semuanya masuk ke Tab. |
| Pengecualian Tab | Wizard **hanya** dipakai bila konfigurasi berurutan dan saling bergantung. Wizard tetap berada di dalam Tab. |
| Objek yang dikunci | **Tiga lapis: Page/Window, API Resource, Table.** Bukan hanya Table seperti iDempiere. |
| Cara kamus mengubah aplikasi | **Rancangan lalu aktifkan.** Perubahan disimpan sebagai rancangan; aplikasi belum berubah; super admin mengaktifkan setelah diperiksa. |
| Rollback | **Simpan versi.** Setiap perubahan tersimpan sebagai versi; bisa kembali ke versi sebelumnya. |
| Sumber definisi | **Inti di kode, penimpa di database.** Definisi inti ditulis di kode lewat migration dan ikut review; perubahan yang dipublikasikan dan penyesuaian tenant disimpan di database sebagai penimpa. |
| Editor di produksi | **Super admin lewat UI**, dengan guardrail: validasi, audit, versi, langkah aktifkan, dan batas wewenang. |
| Batas wewenang super admin | Super admin **tidak boleh** mengubah definisi yang memberi akses (lapis Page, API Resource, Table, Field access). Itu ada di kode. |
| Bila kode dan penimpa bentrok | **Kode menang.** Penimpa ditandai **bentrok** dan tidak dipakai sampai super admin memutuskan: ikut kode, atau perbarui penimpa. |
| Notifikasi perubahan inti | **Notifikasi aplikasi + catatan audit + penanda** di layar kamus. |
| Daftar acuan (reference data) | **Inti dari kode; tenant boleh menambah** atau menonaktifkan item. Tenant tidak boleh menghapus item inti. |
| Cakupan tenant | **Tenant hanya menimpa yang aman:** label, terminologi, urutan field, field disembunyikan. Tenant tidak menyentuh definisi akses. |
| Ganti istilah | **Hanya dari daftar istilah yang diizinkan** yang disiapkan developer. |
| Penamaan tabel | **Nama Abixell** (`app_windows`, `app_tabs`, `app_fields`, dst), dengan peta ke nama iDempiere dicatat di dokumen. |
| Aturan tampil/validasi | **Aturan terstruktur**, bukan rumus teks seperti `@Status@=CO`. Disimpan sebagai data, bisa divalidasi sebelum disimpan, tidak ada teks yang dijalankan. |
| Menu navigasi | **Tidak dipindah di Epic 2.** Menu yang ada tetap di kode; menu dari kamus dikerjakan di Epic 3. |
| Halaman & aksi lama | **Didaftarkan otomatis** sebagai gelombang awal. Yang belum terdaftar ditandai `belum terdaftar` dan **tidak bisa dikunci role** sampai didaftarkan — tidak ada yang diam-diam lolos. |
| Aktifkan rancangan | **Satu super admin cukup**, tetapi setiap pengaktifan tercatat: siapa, kapan, dari versi mana ke versi mana. Perubahan yang menyentuh akses ditolak dari jalur ini. |
| Operator aturan terstruktur | **9 operator, terkunci di Gelombang 1:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `isNull`. `in` dan `notIn` menerima nilai berupa array; `isNull` menerima boolean (`true` = field harus kosong/absen). Operator lain tidak diterima. Ingat: menambah operator di gelombang berikutnya berarti setiap versi aturan yang sudah tersimpan harus dibaca ulang dengan himpunan yang lebih luas, jadi himpunan ini dilebarkan **dengan sengaja**, bukan dengan menambah operator sambil jalan. |
| Wizard | **Cukup penanda pada Tab.** `app_tabs.tab_type` sudah bernilai `fields`, `cards`, atau `wizard`; **tidak ada** objek kamus `app_wizards` terpisah. Isi wizard tetap card berurutan (`sequence_no` 10, 20, 30) di dalam Tab itu, dan wizard tetap berada di dalam Tab seperti keputusan di atas. |

#### Prinsip yang mengikat Epic 2

1. **Meniru konsep iDempiere, bukan bentuk fisiknya.** `AD_Window`/`AD_Tab`/`AD_Field`/`AD_Reference`/`AD_Val_Rule` ditiru **konsepnya**; nama tabel Abixell memakai nama yang mudah dibaca.
2. **Kamus adalah kontrak, bukan mesin UI penuh.** React tetap ditulis manual untuk halaman transaksi. Ini keputusan `Reject` pada §1 baris "Metadata → UI generation".
3. **Definisi akses tidak berasal dari UI.** Ini yang membuat "super admin boleh edit kamus" tetap aman.
4. **Tidak ada perubahan yang langsung berlaku.** Rancangan → diperiksa → diaktifkan. Ini menutup kelemahan iDempiere yang riset catat di `20-limitations.md` (schema sync dari UI runtime).
5. **Setiap perubahan bisa dilacak dan dibatalkan.** Versi + audit, bukan catatan perubahan saja.
6. **Yang belum terdaftar tidak bisa dikunci.** Aman secara default: selama belum terdaftar, tidak ada role yang bisa diberi akses ke situ.

#### Basis iDempiere (terverifikasi)

| Konsep | Sumber | Keputusan |
|---|---|---|
| Table & Column | `I_AD_Table.java`, `I_AD_Column.java` | Adopt konsep → `app_tables`, `app_columns` |
| Window & Tab | `I_AD_Window.java`, `I_AD_Tab.java` | Adopt konsep → `app_windows`, `app_tabs` |
| Field + logic | `I_AD_Field.java:342,643,700` — `DisplayLogic`, `IsDisplayed`, `IsReadOnly`, `MandatoryLogic`, `ReadOnlyLogic` | Modernize → aturan terstruktur, bukan rumus teks |
| Reference | `I_AD_Reference.java`, `I_AD_Ref_List.java` | Adopt → `app_references`, `app_reference_items` |
| Validation rule | `I_AD_Val_Rule.java` | Modernize → aturan terstruktur |
| Entity type / modul | `I_AD_EntityType.java:130-222` — `EntityType`, `ModelPackage`, `Version` | Adopt → `modules` diperluas |
| Parameter setup | `I_AD_SysConfig.java:84-183` — termasuk `ConfigurationLevel` | Gelombang 3 (Epic 8) |
| Preview/uji | iDempiere tidak punya langkah publikasi | **Tambahan Abixell** — inilah guardrail yang iDempiere tidak punya |

#### Gelombang pengerjaan

**Gelombang 1 — Fondasi keamanan (membuka Epic 1, 3, 4)**

Objek: Page/Window, Tab/bagian, Process/Action, Table, Field; plus API Resource.

| Objek baru | Isi |
|---|---|
| `app_windows` | Satu halaman/route. `code` unik, nama, module, status pendaftaran |
| `app_tabs` | Bagian di dalam halaman. Urutan, jenis isi (`fields` / `cards` / `wizard`), label |
| `app_processes` | Tombol/aksi yang bisa dijalankan: submit, approve, verify, export |
| `app_tables` | Tabel data yang boleh diakses |
| `app_fields` | Field pada tabel: label, wajib, bisa-edit, tampil, urutan |
| `app_api_resources` | Pintu masuk API, dipetakan ke objek kamus |
| `app_field_rules` | Aturan terstruktur untuk wajib/tampil/read-only bersyarat |

**Gelombang 2 — Konfigurasi bisnis**

Reference data (kategori, jenis, status, satuan) dengan penanda `boleh ditambah tenant`; terminology dengan daftar istilah yang diizinkan; numbering pattern.

**Gelombang 3 — Logic lanjutan & parameter setup**

Aturan bersyarat yang lebih kaya, parameter berjenjang ala `AD_SysConfig.ConfigurationLevel`, jembatan ke Epic 8.

#### Mekanisme penimpa, bentrok, dan versi

**Tiga sumber, satu urutan keputusan:**

```text
1. Definisi inti        ← kode, lewat migration, ikut review
2. Penimpa terbitkan    ← super admin lewat UI, sudah diaktifkan
3. Penimpa tenant       ← tenant, hanya untuk hal aman
```

**Urutan menang:** inti > penimpa terbitkan > penimpa tenant, **kecuali** tenant hanya boleh menyentuh kolom yang ditandai aman.

**Alur perubahan super admin:**

```text
super admin mengubah  →  tersimpan sebagai RANCANGAN (belum berlaku)
                      →  divalidasi otomatis
                      →  diperiksa (lihat banding dengan definisi inti)
                      →  diaktifkan  →  versi baru terbentuk  →  audit tertulis
```

**Bila kode berubah setelah penimpa ada:**

```text
developer mengubah definisi inti
    → penimpa yang menyentuh definisi itu ditandai BENTROK
    → penimpa tidak dipakai selama bentrok
    → super admin menerima notifikasi + penanda di layar kamus
    → super admin memutuskan: ikut kode, atau perbarui penimpa
```

Tidak ada penimpa yang diam-diam tertimpa. Tidak ada definisi lama yang diam-diam terus dipakai.

**Guardrail yang wajib ada sebelum editor kamus boleh dinyalakan:**

| # | Guardrail | Isi |
|---|---|---|
| 1 | Batas wewenang | Kolom definisi-akses tidak dapat diedit dari UI, dalam keadaan apa pun |
| 2 | Validasi sebelum simpan | Rancangan yang tidak konsisten ditolak |
| 3 | Langkah aktifkan | Rancangan tidak berlaku sebelum diaktifkan |
| 4 | Versi | Setiap aktifkan membentuk versi; bisa kembali |
| 5 | Audit | Siapa, kapan, dari versi mana ke versi mana |
| 6 | Notifikasi bentrok | Perubahan definisi inti memberi tahu super admin |
| 7 | Tidak ada teks dijalankan | Aturan disimpan sebagai data terstruktur |

#### Pendaftaran halaman dan aksi yang sudah ada

13 modul, 162 permission, dan sekitar 42 berkas pemakai RBAC didaftarkan **otomatis** sebagai gelombang awal. Halaman dan aksi yang belum terdaftar ditandai `belum terdaftar`, dan selama dalam keadaan itu **tidak bisa dikunci role**. Konsekuensinya: tidak ada halaman yang diam-diam tetap terbuka, dan tidak ada halaman yang diam-diam terkunci karena lupa.

#### Di luar cakupan Epic 2

- Menu navigasi dari kamus (Epic 3).
- Layar konfigurasi role (Epic 4) — Epic 2 menyediakan objeknya, Epic 4 membangun UI-nya.
- Document engine dan lifecycle (Epic 7).
- Generator UI penuh (ditolak; §1).
- Migrasi seluruh halaman transaksi ke generator (hanya halaman admin/konfigurasi).
- Parameter berjenjang (Epic 8, gelombang 3 menyiapkan jembatannya).

#### Item terbuka di Epic 2

| # | Item | Perlu |
|---|---|---|
| 1 | Bentuk tepat aturan terstruktur: berapa operator yang didukung di gelombang 1? | **Ditutup 2026-09-26 — terkunci 9 operator** (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `isNull`; lihat tabel keputusan). Validator route dan evaluator sudah mengimplementasikannya (`field-rule-evaluator.ts`). |
| 2 | Apakah wizard perlu objek kamus sendiri, atau cukup ditandai pada Tab? | **Ditutup 2026-09-26 — cukup penanda pada Tab** (`app_tabs.tab_type = 'wizard'`; tidak ada objek `app_wizards`; lihat tabel keputusan). |
| 3 | Halaman admin/konfigurasi mana yang pertama memakai generator terbatas? | **Diteruskan Epic 13 (§4.13 open item #5):** dijawab saat Wave 13.5 — bukan di Epic 4. Urutan generator dikunci §4.13 keputusan #12: layar baca-saja dulu (Wave 13.4), form admin menyusul (Wave 13.5). |
| 4 | Apakah penimpa tenant ikut masuk versioning, atau cukup audit? | **Ditutup 2026-09-26 — tidak, cukup audit.** Yang masuk versioning adalah **penimpa terbitkan** (super admin lewat UI; §4.2 baris "Rollback": "setiap perubahan tersimpan sebagai versi"; guardrail #4 "Setiap aktifkan membentuk versi"). Cakupan tenant tidak pernah masuk jalur itu: baris "Cakupan tenant" membatasi tenant pada kolom aman (label, terminologi, urutan field, field disembunyikan), dan guardrail #1 "Batas wewenang" melarang UI menyentuh definisi akses dalam keadaan apa pun — jadi tidak ada kolom akses yang bisa diaktifkan/dibatalkan oleh penimpa tenant. Baris 516 sudah menyatakan penimpa tenant kalah dari penimpa terbitkan (urutan: inti > penimpa terbitkan > penimpa tenant), sehingga rollback penimpa terbitkan tidak boleh dan tidak perlu menyentuh baris tenant. Konsekuensi yang mengikat implementasi: penimpa tenant memerlukan **audit** (siapa, kapan, sebelum/sesudah — sudah tersedia lewat `audit_log` + `recordGovernedAudit`), dan **tidak** memerlukan rantai versi/snapshot yang dapat dipulihkan. Taksonomi lengkap (yang ber-versi vs yang ber-audit saja) ditulis saat Gelombang 2; keputusannya sendiri sudah final sekarang. |

#### Gate sebelum Epic 2 dinyatakan selesai

**Status: Epic 2 DONE — 2026-10-01.** Gelombang 1 selesai lebih dahulu; Gelombang 2 (konfigurasi bisnis) dan Gelombang 3 (jembatan parameter) selesai pada 2026-10-01.

| # | Pemeriksaan | Hasil |
|---|---|---|
| 1 | Skema: level-konsistensi parameter, guardrail tidak dapat diwakili sebagai ter-override, isolasi tenant lewat FK komposit | Lulus — `app_parameters` / `app_parameter_values`; CHECK `NOT is_guardrail OR NOT org_override_allowed`; FK komposit `(tenant_id, organization_scope_id)` |
| 2 | Urutan keputusan nilai efektif: Organization > Client > System > bawaan produk; bacaan efektif mengembalikan nilai dan level sumber | Lulus — `GET /config/parameters/:code/effective` mengembalikan `sourceLevel` (`O`/`C`/`S`/`product_default`) |
| 3 | Otorisasi: tulis System butuh bootstrap key; tulis Client/Organization butuh `config.manage` + scope tenant | Lulus — gerbang bootstrap di route; RBAC scope OU diverifikasi reviewer |
| 4 | Audit: setiap perubahan parameter tercatat (siapa, kapan) | Lulus — `updated_by` / `updated_at` |
| 5 | Tidak ada teks dijalankan: aturan dan nilai disimpan sebagai data terstruktur | Lulus — nilai lewat `jsonb`, divalidasi Schema Registry; tidak ada skrip |
| 6 | Validasi sebelum simpan: nilai parameter divalidasi terhadap `metadata_registry` | Lulus — `SchemaRegistryValidator` menolak nilai tidak sesuai skema |
| 7 | Sembilan operator aturan tetap terkunci (tidak dilebarkan tanpa sengaja) | Lulus — regresi sembilan operator di suite Epic 2 |
| 8 | Paritas: kamus (dictionary/route/menu) dan seed referensi data | Lulus — 30/30 tes paritas |
| 9 | Migrasi: `1790900000000` dan `1791000000000` lolos platform-boundary-validator | Lulus — tidak ada temuan baru Wave 2–3; 11 isu lama Epic 5/6 di luar cakupan |
| 10 | Typecheck API | Lulus — 0 error (`tsc --noEmit`) |
| 11 | Regresi fokus Epic 2 | Lulus — 14/14 (`tests/integration/epic-2-wave-2-3-configuration.test.ts`) |
| 12 | Regresi API penuh | Lulus — 958/958 tes jalan; 2 suite gagal saat pengumpulan karena penjaga DB terisolasi Epic 3/4 (`abixell_one_epic3_wave4`), bukan regresi Epic 2 |
| 13 | Peninjau: database-reviewer (4 temuan) dan typescript-reviewer (1 CRITICAL) | Selesai — semua diperbaiki: sintaks FK, indeks komposit, `down()` terminology yang terlalu luas, CHECK guardrail, dan perbandingan bootstrap key constant-time |
| 14 | Tanpa pekerjaan frontend/UI; tanpa langkah Epic 5/6 | Lulus |

Bukti rinci: `docs/plans/epic-2-progress.md`.

---

### 4.3 EPIC 3 — Module & Menu Tree Configuration

#### Problem statement

Seluruh navigasi Abixell One hari ini berada di satu berkas kode yang berjalan **di sisi browser**: `apps/web/src/lib/capabilities.ts` (787 baris).

| Isi | Jumlah | Cara ditulis |
|---|---|---|
| Grup navigasi | 3 (`Operations`, `Enterprise Core`, `Governance & Platform`) | kode |
| Modul | 13 kode, label dan grupnya | kode (`MODULE_METADATA`) |
| Menu | 41 | kode (`NAV_SECTIONS`) |

Tidak ada berkas navigasi lain, dan **tidak ada tabel menu di database**. Tidak ada tabel bernama `%menu%`, `%window%`, atau `%dictionary%`.

Empat akibat yang sudah terverifikasi:

1. **Menu bukan penjaga akses — dan memang tidak pernah dirancang begitu.** Header `capabilities.ts` menyatakannya sendiri: *"Hiding a nav item never grants or denies access; it only declutters the shell."* Ini benar dan sejalan dengan iDempiere. Masalahnya, penjaga yang sebenarnya (API) tidak selalu menerjemahkan penolakannya menjadi penjelasan yang bisa dipakai orang.

2. **Ada route yang bisa dibuka tanpa ada di menu.** Dari 62 route unik (pengukuran 2026-09-23, sebelum pendaftaran Epic 3): 41 terdaftar di menu, 3 berada di luar shell (`/login`, `/select-workspace`, `/public/surveys/:token` — bagian alur masuk, memang bukan menu), dan **18 dapat dicapai di dalam shell tanpa terdaftar di menu**. Rincian 18 itu:

   | Kelompok | Jumlah | Contoh |
   |---|---|---|
   | Halaman rincian/form yang induknya ada di menu — **disengaja tersembunyi** | 13 | `/assets/:assetId`, `/complaints/new`, `/work-orders/:workOrderId` |
   | Rincian yang induk menu langsungnya tidak ada — perlu ditempelkan ke induk yang benar saat pendaftaran | 3 | `/hse/records/:recordId`, `/asset-maintenance/*/:id` |
   | **Halaman sungguhan tanpa penjaga** — lupa didaftarkan | **2** | `/hse/report` (`HseReportPage.tsx`), `/administration/complaints` (`ComplaintConfigPage.tsx`) |

   Untuk dua halaman terakhir, data tidak bocor: API-nya tetap menolak. `apps/api/src/modules/hse/core/application/hse.service.ts:110` memanggil `rbac.requirePermission(actor.userId, "hse.report")`. Tetapi user tanpa izin yang mengetik alamat itu melihat **seluruh form tampil dan bisa diisi** — baru saat submit API menolak. Halaman `/reporting` tidak termasuk celah ini: ia terdaftar di menu dan tidak punya route yatim.

   **Keadaan akhir setelah Epic 3 Wave 1 (`route-registry.ts`, diukur ulang 2026-09-27): 70 route terdaftar** — 41 `di_menu`, 29 `tersembunyi`, 0 `belum_terdaftar`. Dari 29 tersembunyi itu: 3 alur masuk (`/login`, `/select-workspace`, `/public/surveys/:token`), 1 wildcard (`*`), dan **25 tersembunyi di dalam shell**. Angka 18 di atas adalah baseline audit sebelum pendaftaran; selisihnya adalah route yang ditambahkan setelah 2026-09-23 dan route yang dipindahkan ke alur masuk. Nol `belum_terdaftar` adalah hasil yang dituju langkah ini, bukan sisa pekerjaan.

3. **Hanya 9 dari 62 halaman memeriksa izin sendiri** (pengukuran 2026-09-23, baseline yang sama). Lima puluh tiga sisanya bergantung sepenuhnya pada penolakan API. Aman untuk data, buruk untuk pengalaman.

4. **Menonaktifkan modul saat ini hanya kosmetik.** `apps/api/src/application/configuration/configuration.service.ts` saat `setModuleActivation` menulis status aktivasi dan satu catatan audit `config.module_activation.changed` — **tidak menyentuh `role_permissions` sama sekali**, dan tidak ada pemeriksaan modul-aktif di layer API (pencarian `requireModule` / `moduleActive` tidak menemukan apa pun). Akibatnya tenant yang mematikan modul HSE tetap bisa memakai seluruh API HSE lewat integrasi atau URL langsung.

**Epic 3 memindahkan navigasi dari kode ke kamus Epic 2**, memberi setiap route status resmi, dan menutup celah modul-nonaktif di layer API.

#### Bukti iDempiere: menu tidak pernah menjadi penjaga (terverifikasi ulang 2026-09-23)

| Yang diperiksa | Hasil | Arti |
|---|---|---|
| `I_AD_Menu_Access.java` di repositori iDempiere | **404 — tidak ada** | iDempiere tidak punya tabel hak menu sama sekali |
| `MMenu.java` (306 baris, `org.adempiere.base/src/org/compiere/model/`) | **nol** penyaring akses — hanya cache, validasi simpan, dan urutan pohon | Menu bukan penjaga di tingkat kode |
| `X_AD_Menu.ACTION_*` | `B` Workbench, `D` Detail, `F` WorkFlow, `I` Info, `P` Process, `R` Report, `T` Task, `W` Window, `X` Form | Satu menu menunjuk **satu objek tujuan**, dan aksesnya diperiksa pada objek itu |
| Wiki *Securing iDempiere* | *"menus don't restrict access - user still can zoom"* | Sumber resmi menyarankan begitu |

Dua bukti ini — ketiadaan `AD_Menu_Access` dan ketiadaan penyaring di `MMenu.java` — adalah bukti tingkat kode untuk prinsip yang sudah tercatat di §1. Bukan sekadar saran wiki.

#### Keputusan yang sudah dikunci (wawancara 2026-09-23)

| Topik | Keputusan |
|---|---|
| Sumber menu | **Kode + penimpa di database**, mengikuti Epik 2. Struktur menu ditulis di kode lewat migration dan ikut review; database hanya menyimpan penyesuaian. |
| Identitas | **UUID sebagai primary key + `code` unik yang mudah dibaca sebagai identitas stabil.** Kode yang dikunci; label yang bebas diganti. |
| Grup & modul | **Struktur, keanggotaan, dan posisi grup dikunci kode.** Jumlah grup dan penempatan modul tidak dapat diubah dari UI. |
| Label | **Label dan deskripsi boleh ditimpa tenant**, dibatasi daftar istilah yang diizinkan (Epic 2 gelombang 2). ID tidak berubah saat label berganti. |
| Kedalaman pohon | **Empat tingkat:** Grup → Modul → Sub-menu → Halaman. Sub-menu satu tingkat, dipakai hanya bila satu modul memang besar. |
| Menu dari role | **Menu mengikuti akses halaman.** Tidak ada permission menu tersendiri; tidak ada tabel `role_menu_access`. |
| Visibilitas menu | **Modul aktif + role boleh buka → menu tampil dan bisa diklik.** |
| Menu tanpa hak | **Modul aktif + role tidak boleh → menu tampil dalam keadaan nonaktif**, disertai keterangan singkat alasannya. |
| Menu modul nonaktif | **Menu tidak tampil sama sekali.** |
| User eksternal | **Hanya melihat menu yang memang disediakan untuk mereka.** Bukan menu internal dalam keadaan nonaktif — menu itu **tidak pernah dikirim**. Susunannya diatur lewat konfigurasi role akses, dan dibahas di Epic 4. |
| Susunan menu khusus customer | **Diserahkan ke Epic 4.** Epic 3 menyediakan mekanismenya dan memastikan default-nya tertutup. |
| Default untuk customer | **Tertutup.** Menu tanpa penanda `boleh untuk eksternal` tidak pernah sampai ke user customer. Aman menurut default. |
| Status route | **Setiap route punya status resmi di kamus:** `di-menu`, `tersembunyi`, atau `belum terdaftar`. Yang belum terdaftar dilaporkan di layar kamus. |
| Kunci di dalam halaman | **Setiap route wajib punya kunci di dalamnya, tanpa kecuali.** Halaman `tersembunyi` tidak dianggap aman hanya karena tidak ada di menu. HSE dan Reporting termasuk yang wajib berkunci. Sebuah halaman tidak boleh menampilkan isinya sebelum hak diperiksa. |
| Halaman rincian | **Default: turunan mewarisi akses halaman induk**, ditandai tersembunyi selamanya, tidak muncul di layar role. |
| Pengecualian rincian | **Boleh punya aturan sendiri bila memang hanya-baca.** Rincian seperti itu punya identitas Window sendiri dengan mode read-only, tetap tersembunyi dari menu. |
| Otoritas modul | **Modul = plafon, bukan pemberian akses.** Akses nyata tetap dari daftar Window, Process, dan Reporting yang dicentang. |
| Modul nonaktif | **Blokir pekerjaan baru, data lama tetap terbaca.** Create/update/action ditolak; user berizin khusus masih dapat membaca atau mengekspor arsip. |
| Siapa yang mengaktifkan modul | **Hanya super admin.** Konteks under-tenant (Central maupun Sites) tidak boleh menyalakan atau mematikan modul. |
| Penjelasan akses langsung | **Tampilkan alasan yang tepat:** 403 tanpa hak, "modul tidak aktif", 404 alamat tidak dikenal. Tidak diam-diam melempar ke Overview. |
| Siapa mengaktifkan pengaturan | **Hanya super admin**, dan setiap pengaktifan tercatat (Epic 2 guardrail 5). |
| Penamaan tabel | **Nama Abixell**, mengikuti Epic 2, dengan peta ke iDempiere dicatat di bawah. |

#### Prinsip yang mengikat Epic 3

1. **Menu bukan security boundary.** Ini prinsip iDempiere, dan bukti kodenya sudah dikumpulkan di atas. Navigasi hanya presentasi; penjaga sebenarnya ada di API dan data. Tidak ada satu pun keputusan di Epic 3 yang boleh menjadikan menu sebagai kontrol akses.
2. **Menu tidak boleh jadi jalan pintas kebocoran.** Batas peran (`requiresInternal`) **diselesaikan sekali, di server**, bersama daftar menu. Klien tidak pernah menerima menu yang tidak boleh ia ketahui. Untuk user eksternal, mana yang boleh mereka lihat adalah **daftar putih**: yang tidak diberi penanda `boleh untuk eksternal` tidak pernah dikirim.
3. **Satu definisi, satu pemeriksaan.** Status route, hak halaman, dan visibilitas menu berasal dari kamus yang sama (Epic 2), bukan dari daftar kedua yang bisa berbeda.
4. **Menambah halaman tanpa mendaftarkannya adalah kesalahan yang terlihat, bukan kesalahan yang senyap.** Route yang belum terdaftar muncul di laporan kamus, bukan diam-diam terbuka atau diam-diam terkunci.
5. **Menonaktifkan modul harus berarti sesuatu di server.** Selama status nonaktif hanya menyembunyikan menu, kata "nonaktif" menyesatkan.
6. **Yang tersembunyi tetap harus dijelaskan.** User yang sah tetapi kurang berhak mendapat penjelasan yang bisa ia baca, bukan layar kosong.

#### Basis iDempiere (terverifikasi)

| Konsep | Sumber | Kolom terverifikasi | Keputusan |
|---|---|---|---|
| Menu sebagai data | `I_AD_Menu.java` | `AD_Menu_ID`, `AD_Menu_UU`, `Name`, `Description`, `Action`, `AD_Window_ID`, `AD_Process_ID`, `AD_Form_ID`, `AD_Task_ID`, `AD_Workflow_ID`, `AD_InfoWindow_ID`, `IsSummary`, `IsSOTrx`, `IsReadOnly`, `PredefinedContextVariables`, `EntityType` | Adopt konsep → `app_menus` |
| Penempatan pohon | `I_AD_TreeNodeMM.java` | `AD_Tree_ID`, `Node_ID`, `Parent_ID`, `SeqNo`, `IsActive` | Adopt konsep → `app_menu_tree` |
| Definisi pohon | `I_AD_Tree.java` | `AD_Table_ID`, `TreeType`, `IsAllNodes`, `IsDefault`, `IsLoadAllNodesImmediately`, `IsTreeDrivenByValue`, `IsValueDisplayed`, `Parent_Column_ID`, `Processing` | Modernize → satu definisi pohon tetap, tidak diekspos ke UI |
| Jenis aksi menu | `X_AD_Menu.ACTION_*` | `W` Window, `P` Process, `R` Report, `X` Form, `T` Task, `F` WorkFlow, `I` Info, `B` Workbench, `D` Detail | Modernize → `Window`, `Process`, `Report`, `Form` |
| Menu sebagai penjaga | — | **Tidak ada** `AD_Menu_Access`; `MMenu.java` tanpa penyaring | **Reject** — menu tidak memberi atau menolak akses, sama seperti iDempiere |
| Ganti istilah menu | `AD_Menu.Name` + `AD_Message` | — | Modernize → penimpa label tenant lewat Epic 2 |

#### Pemisahan dua tabel (mengikuti iDempiere)

iDempiere memisahkan **apa** menu itu dari **di mana** menu itu diletakkan:

```text
app_menus        apa isi menu  : kode, label, jenis aksi, tujuan (window/process/report), module
app_menu_tree    di mana letaknya: parent, urutan, aktif
```

Pemisahan ini diadopsi apa adanya. Keuntungannya: memindahkan menu tidak mengubah definisinya, dan satu halaman bisa muncul di dua tempat bila kelak diperlukan.

| Kolom | Isi |
|---|---|
| `app_menus.id` | UUID, primary key |
| `app_menus.code` | Identitas stabil dan mudah dibaca, unik. **Dikunci kode.** Contoh `nav-operations-work-orders` |
| `app_menus.name` | Label inti, dikunci kode, dipakai sebagai cadangan |
| `app_menus.action` | `window` \| `process` \| `report` \| `form` |
| `app_menus.window_id` | Menunjuk `app_windows` (Epic 2). Satu menu satu tujuan |
| `app_menus.is_summary` | `true` = ini folder (Grup, Modul, Sub-menu), bukan halaman |
| `app_menus.module_id` | Menunjuk `modules`. **Wajib** untuk menu berjenis halaman |
| `app_menus.is_external_allowed` | **Default `false`.** Penanda daftar putih: hanya menu berpenanda `true` yang pernah dikirim ke user eksternal (Customer User). Menggantikan dua penanda lama `requiresInternal` / `requiresCustomerScope` dengan satu penanda yang default-nya tertutup. Keadaan hari ini: 38 dari 41 menu bertanda `requiresInternal`, 1 bertanda `requiresCustomerScope`, dan **hanya 2 menu** (`overview`, `my-surveys`) terbuka bagi keduanya — jadi perilaku efektifnya memang sudah berupa daftar putih kecil, hanya ditulis sebagai dua penanda negatif |
| `app_menus.is_active` | Dinyalakan/dimatikan super admin |
| `app_menu_tree.menu_id` | Menunjuk `app_menus` |
| `app_menu_tree.parent_id` | Menunjuk `app_menus` induk. Kosong = akar (Grup) |
| `app_menu_tree.seq_no` | Urutan dalam satu induk |

Batas empat tingkat dijaga di server: kedalaman yang melebihi batas ditolak sebelum tersimpan.

#### Status resmi setiap route

Setiap route mendapat satu status di kamus. Aturan ini yang menutup celah `/hse/report` dan `/administration/complaints`:

| Status | Arti | Muncul di menu | Muncul di layar role |
|---|---|---|---|
| `di-menu` | Halaman kerja biasa | ya | ya |
| `tersembunyi` | Form, halaman rincian, halaman alat | tidak | tidak |
| `belum terdaftar` | **Route ada, tetapi belum punya status** | tidak | tidak — dan **tidak bisa dikunci role** |

Halaman rincian secara default menjadi turunan halaman induk dan **mewarisi aksesnya**. Aturan mewarisi:

```text
/assets                        akses induk: baca + ubah
  /assets/:assetId             turunan, mewarisi induk
  /asset-maintenance/.../:id   turunan, mewarisi induk

/asset-maintenance
  /asset-maintenance/assets/:id  PENGECUALIAN: daftar izin lebih sempit
                                 (meter, downtime, analytics)
                                 tetap tersembunyi dari menu
```

Pengecualian rincian dipakai ketika memang ada rincian yang lingkupnya tidak boleh sepemuh induknya. Rincian seperti itu tetap punya identitas Window sendiri supaya dapat dikunci terpisah, tetapi tetap tidak muncul di menu.

> **Diperbarui 2026-09-26 (penutupan item terbuka 3).** Contoh `/finance/transactions/:id` di atas dulu ditulis sebagai pengecualian hanya-baca. Pendataan seluruh 17 rincian menunjukkan contoh itu **tidak** hanya-baca — halamannya menulis lewat aksi yang masing-masing dijaga izinnya sendiri (`finance.manage`, `finance.approve`) — sehingga contohnya diganti dengan rincian yang benar-benar berbeda dari induknya. Ada dua: `/asset-maintenance/assets/:id` (masuk lewat izin meter, downtime, dan analytics) dan `/hse/report` (form dibuat dijaga `hse.report`, bukan `hse.manage`). Perhatikan juga: pengecualian sempit itu berlaku pada **daftar izin**, bukan pada mode hanya-baca. Mode hanya-baca (`is_read_write`) menunjuk `role_window_access` di §4.4 dan belum ada. Alasan lengkap ada di "Item terbuka di Epic 3" → item 3.

**Tersembunyi bukan berarti tanpa kunci.** Halaman yang tidak muncul di menu tetap wajib memeriksa hak sebelum menampilkan isinya. Alasan: menu hanyalah daftar tampilan, sedangkan alamat bisa diketik siapa saja. Halaman yang hanya mengandalkan "tidak ada di menu" sebenarnya terbuka, bukan tersembunyi.

Cara mewujudkannya: **satu komponen penjaga di tingkat route**, bukan pemeriksaan yang ditulis ulang di setiap halaman. Halaman mendeklarasikan hak yang dibutuhkannya lewat kamus, dan penjaga itu yang menahan render. Alasannya:

- Pemeriksaan yang disalin ke 62 halaman pasti akan terlewat di beberapa tempat — dan sudah terbukti terlewat: hanya 9 dari 62 halaman memeriksa haknya sendiri hari ini.
- Satu penjaga berarti satu aturan. Tidak ada halaman yang bisa "lupa dilindungi" karena perlindungan bukan tugas halaman itu.
- Halaman `tersembunyi` mendapat perlakuan yang sama persis seperti halaman biasa. Status menu tidak lagi berpengaruh pada keamanan.

```text
SEBELUM (ditulis per halaman)
  Halaman A  memeriksa hak  ✓
  Halaman B  tidak menulis   ✗  <- terbuka, bukan tersembunyi
  Halaman C  memeriksa hak  ✓
  ... 62 halaman, hasil: 9 memeriksa, 53 tidak

SESUDAH (satu penjaga route)
  Semua halaman lewat penjaga yang sama
  Hak dibaca dari kamus Epic 2
  Halaman belum terdaftar -> ditolak, bukan dibiarkan lewat
```

#### Dua sebab, dua akibat

Ini pembeda yang menentukan bentuk akhir navigasi, dan yang paling mudah salah diterapkan:

```text
MODUL AKTIF   + role boleh buka  →  menu tampil, bisa diklik
MODUL AKTIF   + role tidak boleh →  menu tampil, NONAKTIF + keterangan
MODUL NONAKTIF                   →  menu TIDAK tampil sama sekali
```

Alasannya: modul nonaktif adalah keputusan **tenant** yang berlaku bagi semua orang di tenant itu — tidak ada gunanya memamerkan menunya. Sedangkan role adalah keputusan **per orang** — menampilkan menu nonaktif membantu orang tahu fungsi itu ada, dan menghubungi admin untuk memintanya.

Tiga baris di atas berlaku untuk **user internal**. Untuk user eksternal, ada penyaring yang berjalan lebih dulu:

```text
URUTAN PENYARINGAN MENU (di server, urut dari atas)

1. Penanda "boleh untuk eksternal"   →  customer hanya menerima menu berpenanda itu
2. Status modul (aktif / nonaktif)   →  modul nonaktif: menu hilang
3. Hak role atas halaman             →  tidak berhak: menu tampil NONAKTIF

Akibatnya, untuk customer tidak pernah ada menu internal yang sampai
ke browser dalam keadaan nonaktif — menu itu tersaring di langkah 1.
```

Batas peran tetap dihormati sebagai lapisan atas. **Default untuk user eksternal adalah tertutup:** menu tanpa penanda `boleh untuk eksternal` tidak pernah dikirim ke browser mereka.

```text
CUSTOMER USER (eksternal)
  Grup Operations            tampil
    Complaints               bisa diklik
  (menu internal dan pemerintahan platform
   TIDAK PERNAH DIKIRIM — bukan sekadar nonaktif)
```

Karena klien menerima menu yang sudah disaring server, menu yang tidak disediakan untuk customer tidak dapat dibatalkan penyembunyiannya dari browser. Susunan menu customer yang final — menu mana saja yang diberi penanda `boleh untuk eksternal` — diputuskan lewat konfigurasi role akses di Epic 4.

#### Cara kerja modul sebagai plafon

Modul memberi batas, bukan akses:

```text
Modul diperbolehkan : Asset, Workforce
Window dicentang    : Assets (baca), Employees (baca)

Hasil:
  Assets      terbuka
  Employees   terbuka
  Maintenance TIDAK terbuka
              (modulnya boleh, tetapi window-nya tidak dicentang)
  Queue       tertutup (tidak punya modul apa pun)
```

Konsekuensinya aman menurut default: membolehkan modul tanpa mencentang apa pun **tidak membuka apa pun**. Ini juga yang membuat "menu mengikuti akses halaman" bekerja tanpa daftar hak kedua.

#### Modul nonaktif harus berarti di server

Celah yang ditemukan hari ini ditutup di Epic 3, bukan ditunda:

```text
MODUL AKTIF
  baca ✓   buat ✓   ubah ✓   proses ✓

MODUL NONAKTIF
  menu kerja                 hilang
  create / update / action   DITOLAK di API
  baca arsip / ekspor        boleh, lewat Administration, izin khusus
  data                       tidak pernah dihapus
```

Hanya **super admin** yang dapat menyalakan atau mematikan modul, termasuk untuk konteks under-tenant (Central maupun Sites). Setiap perubahan tercatat di `audit_log`.

Alasan memilih "blokir pekerjaan baru, data lama tetap terbaca" dan bukan "blokir semuanya": memblokir total akan memutus akses ke arsip, menggagalkan ekspor untuk audit, dan membuat kewajiban lama yang belum selesai tidak bisa ditutup. Alasan tidak memilih "hanya sembunyikan menu": itu menjadikan status nonaktif sekadar kosmetik, dan integrasi atau URL langsung tetap dapat memakai modul yang oleh tenant sudah dimatikan.

#### Penjelasan saat alamat dibuka langsung

| Keadaan | Yang dilihat user | Status |
|---|---|---|
| Tidak punya hak | "Anda tidak memiliki akses ke halaman ini." | 403 |
| Modul tidak aktif | "Modul ini tidak aktif untuk tenant Anda." | 403 dengan alasan |
| Alamat tidak dikenal | "Halaman tidak ditemukan." | 404 |
| Data di luar scope | Hasil sama seperti route tidak ada, supaya keberadaan data tidak terbocorkan | 404 atau 403 sesuai kebijakan keamanan API |

Tidak ada pengalihan diam-diam ke Overview. API tetap melakukan pemeriksaan terakhir dan tetap menjadi penentu.

#### Gelombang pengerjaan Epic 3

**Gelombang 1 — Menu dari kamus, setara hari ini.**

1. **Membuat satu komponen penjaga route terlebih dahulu**, dengan perilaku default tertutup. Route yang belum punya status resmi tidak boleh merender isi halaman. Dua route yang saat ini tanpa penjaga (`/hse/report`, `/administration/complaints`) menjadi prioritas pertama untuk ditutup.
2. Mendaftarkan seluruh route ke kamus dengan salah satu dari tiga status resmi — rencana awal ditulis dari baseline 62 route (41 `di-menu`, 18 `tersembunyi`, 3 alur masuk); hasil akhir pada `route-registry.ts` (2026-09-27) adalah **70 route: 41 `di_menu`, 25 `tersembunyi` di dalam shell, 3 alur masuk, 1 wildcard** (29 `tersembunyi` total, 0 `belum_terdaftar`). Selisihnya route tambahan yang lahir setelah baseline. Dua route yang saat baseline tanpa penjaga (`/hse/report`, `/administration/complaints`) masuk sebagai `tersembunyi` **berkunci**, bukan `tersembunyi` terbuka.
3. Membuat `app_menus` + `app_menu_tree`; mengisi tiga grup, 13 modul, dan sub-menu dari definisi kode lewat migration.
4. Menyajikan menu dari server, dengan cara penyajiannya dipilih berdasarkan hasil pengukuran, bukan asumsi (§Item terbuka 1).
5. Memeriksa hasilnya terhadap menu hari ini: **daftar menu harus sama persis** sebelum ada penyesuaian baru. Ini titik pembuktian bahwa pemindahan tidak menghilangkan apa pun.

**Gelombang 2 — Visibilitas, dua sebab dua akibat.**

6. Menu tampil nonaktif beserta keterangan bila role tidak berhak.
7. Penyaring menu di server: penanda `boleh untuk eksternal` (daftar putih customer) → status modul → hak role. Default tertutup: menu tanpa penanda tidak pernah dikirim ke user eksternal.
8. Penjelasan 403 / 404 yang tepat pada route yang dibuka langsung.

**Gelombang 2 selesai 2026-09-26.** Yang dibangun, dan yang diputuskan saat mengerjakannya:

| Bagian | Wujudnya |
|---|---|
| Penyaring (§4.3 langkah 7) | `apps/api/src/domain/configuration/menu-filter.ts` — fungsi murni, urutan tetap: daftar putih eksternal → status modul → hak role. Dipanggil `app-metadata.service.ts::listMenuTree(actor, caller)`; `GET /me` menghitung `effectivePermissions` + `scopeTypes` lebih dulu, lalu menyajikan hasil saringnya sebagai `menu` |
| Menu nonaktif + keterangan (§4.3 langkah 6) | `NavRow` di `AppShell.tsx` merender menu `locked` sebagai teks, bukan tautan, dengan alasannya sebagai teks terlihat — bukan `title` saja, karena tooltip tidak terjangkau sentuh dan mudah terlewat oleh keyboard |
| Sumber render | `apps/web/src/lib/servedNav.ts`. Sidebar **dan** `OverviewPage` membaca pohon yang disajikan server. `capabilities.ts` turun pangkat jadi sumber data untuk test paritas saja, bukan lagi sumber render |
| Penjelasan tiga sebab (§4.3 langkah 8) | Satu layar, tiga kalimat berbeda: modul tidak aktif (keputusan tenant), tanpa hak (keputusan admin), alamat tidak dikenal (bukan keduanya). Tidak ada pengalihan diam-diam ke Overview — user yang memilih |
| Bukti | `menu-filter.test.ts` (5 uji lewat `GET /me`), `menu-filter-unit.test.ts` (12 uji pada fungsi murni), `served-nav.test.ts` (13 uji pada adaptor render), `menu-seed-parity.test.ts` (10 uji paritas, tetap lulus) |

**Keputusan yang diambil saat Gelombang 2 dan mengikat implementasi:**

1. **Modul `platform` dikecualikan dari pemeriksaan modul-aktif, dan pengecualiannya ditulis di kode, bukan disimpulkan.** Diukur: `tenant_module_activations` **tidak punya satu baris pun** untuk `platform`, di tenant mana pun, sedangkan registry memberi `module_code: "platform"` pada `/`, `/profile`, `/administration`, dan `/admin`. Tanpa pengecualian ini, penjaga modul-aktif akan menolak seluruh workspace setiap tenant — termasuk halaman masuknya sendiri. `platform` adalah modul shell, bukan modul bisnis yang dinyalakan per tenant; halaman di belakangnya tetap dijaga izin masing-masing.
2. **Untuk user eksternal, menu internal tidak ada — bukan nonaktif.** Bukti yang dituntut daftar risiko ("memastikan menu internal tidak ada, bukan hanya disabled") diwujudkan apa adanya: uji eksternal memeriksa **setiap simpul di payload, dalam keadaan apa pun**, dan gagal bila ada satu simpul tanpa `is_external_allowed`. Uji ini sengaja tidak menerima menu internal yang `locked` — build yang meloloskan menu internal nonaktif akan lulus pemeriksaan bentuk, tetapi tetap membocorkan susunan informasi internal ke browser customer.
3. **Hanya `nav-overview` yang merupakan halaman `di-menu` tanpa syarat izin.** Diukur dari kamus: 17 menu berpermission kosong, tetapi 14 di antaranya folder (Grup/Modul) dan 2 sisanya (`nav-administration`, `nav-admin-console`) tidak berstatus `di-menu`. Karena folder tidak pernah `locked` (hak ada di tujuan, bukan di folder), "halaman tanpa syarat izin tidak pernah nonaktif" punya tepat satu contoh nyata — dan itu dipakai sebagai uji.

**Gelombang 3 — Modul sebagai plafon, dan penonaktifan yang nyata.**

9. Menegakkan modul-aktif di layer API: create/update/action ditolak, baca arsip tetap boleh lewat jalur berizin.
10. Membatasi penonaktifan modul hanya untuk super admin.
11. Penimpa label tenant dari daftar istilah yang diizinkan.

**Gelombang 3 selesai 2026-09-26.** Yang dibangun, dan keputusan yang mengikat:

| Bagian | Wujudnya |
|---|---|
| Penjaga API (§4.3 langkah 9) | `module-activity-plugin.ts` memasang pemeriksaan setelah autentikasi pada setiap route yang berubah-data. `module-enforcement.ts` memetakan route ke modul dan menolak `POST`/`PUT`/`PATCH`/`DELETE` modul bisnis nonaktif dengan 403: `Modul ini tidak aktif untuk tenant Anda.` GET tidak dipotong; data arsip tetap melalui izin route biasa. |
| Otoritas penonaktifan (§4.3 langkah 10) | `PUT /config/modules/:code` wajib lulus RBAC `config.manage` **dan** `x-bootstrap-key` ADR-0004. Kunci platform tidak menggantikan actor atau izin tenant; tanpa actor maupun tanpa kunci responsnya 401. |
| Pengecualian shell | `platform` dikecualikan secara eksplisit dari plafon modul. Shell dan Configuration harus dapat menyalakan modul pertama tenant baru; setiap halaman di dalamnya tetap memakai izin masing-masing. |
| Terminologi menu (§4.3 langkah 11) | Migrasi `1787500000000_epic-3-menu-terminology.cjs` menanam allowlist Product Core dari `config_menu_seed()`. Query pohon menu mencapai override hanya lewat join allowlist; kunci terminologi lain boleh tersimpan tetapi tidak dapat mengubah navigasi. |
| Batas dan audit | Label menu memakai Schema Registry `terminology.value` maksimal 60 karakter; deskripsi memakai `terminology.description_value` maksimal 240. Audit terminology menyimpan `previousValue` dan `value`; identitas, route, modul, serta izin menu tidak dapat ditimpa. |
| Bukti | Database uji `abixell_one_epic3_wave3`: 759 uji API lulus semua (55 file), termasuk 10 uji penjaga modul dan 9 uji terminologi menu; typecheck dan build API lulus; platform-boundaries PASS 0 blocking. |

**Koreksi atribusi kamus yang diungkap Gelombang 3 — migrasi `1787600000000_epic-3-api-resource-module-corrections.cjs`.** Penjaga modul (langkah 9) membuat kesalahan atribusi lama menjadi berdaya guna. Seed kamus Epic 2 (1787300000000) merekam seluruh route di bawah namespace alias `/supply-chain/advanced/*` sebagai `supply_chain`, padahal namespace itu memuat registrar tiga modul di bawah satu segmen pertama — warehouse, procurement, dan tiga route legacy `account-assignment-config`. Sebelum langkah 9 kesalahan ini hanya salah catat; sesudahnya, tenant yang mematikan `warehouse_management` masih dapat menulis movement lewat URL alias sementara handler yang sama ditolak di `/wms/*`, dan sebaliknya mematikan `supply_chain` saja keliru menolak route alias yang seharusnya tetap terjangkau.

Koreksi: 105 baris (79 `warehouse_management`, 26 `procurement_management`) mengikuti `API_PATH_MODULE_OVERRIDES`; `module-namespace-parity.test.ts` menurunkan pasangan yang sama dari pohon route hidup dan gagal bila tabel dan registrar berselisih. Fungsi katalog diubah dengan pola rename-plus-join — snapshot 617 baris tidak ditulis ulang, nama lama tetap terbaca — dan `config_seed_dictionary_for_tenant()` tetap utuh karena ia memanggil fungsi katalog lewat nama. Migrasi seed Epic 2 tidak disentuh (append-only), kolom yang berubah hanya `module_code`, tidak ada izin baru, tidak ada `role_permissions`. `app_processes` tidak tersentuh: atribusi izin tidak pernah memakai aturan segmen path.

**Keputusan item terbuka 4 — baca arsip cukup lewat Administration.** Gate hanya menolak perubahan; route baca berizin yang sudah ada tetap dapat mengakses catatan ketika modul nonaktif. Tidak dibangun halaman arsip khusus per modul dalam Epic 3. Endpoint arsip khusus dan izin `admin.module_archive.read` adalah bentuk pengembangan berikutnya bila route Administration terbukti tidak cukup.

**Backlog sengaja ditunda:** B-02, B-03, B-04, dan B-05 tidak berubah dalam gelombang ini. Tidak ada bypass role, script bebas, atau perluasan hak akses untuk melengkapinya.

#### Serah terima ke Epic 4 (wajib dipenuhi, bukan dikerjakan di sini)

Permintaan berikut muncul saat wawancara Epic 3, tetapi tempatnya di Epic 4. Dicatat di sini supaya Epic 3 menyediakan syaratnya dan Epic 4 tidak merancang ulang:

| # | Permintaan | Syarat yang harus disiapkan Epic 3 |
|---|---|---|
| 1 | **Korelasi menu ↔ modul fungsi**, agar saat mengatur role mudah menentukan menu mana yang tampil | Setiap menu berjenis halaman **wajib** punya `module_id` yang terisi. Menu tanpa modul ditolak saat pendaftaran |
| 2 | **Create role** dengan menambah/mengurangi fungsi, Window, Proses, dan Reporting sesuai kebutuhan batasan | Tiga lapis kunci Epic 2 (Page/Window, API Resource, Table) terisi lengkap, sehingga daftar centang punya sumber sah |
| 3 | **Copy role** untuk role yang selisihnya sedikit | `roles` sudah unik per `(tenant_id, code)`. Salinan lepas: role baru berdiri sendiri, tidak ada kaitan hidup dengan role asal |
| 4 | **Otorisasi modul di setup role** | `modules` sebagai plafon, dengan daftar Window/Process/Reporting sebagai hak nyata |
| 5 | **Role default per modul sebagai rekomendasi** | Rekomendasi disiapkan Epic 4 berdasarkan isi modul. **Bukan keharusan.** Keputusan akhir tetap di tangan founder, dengan fleksibilitas sesuai batas pengelolaan modul dan role |
| 6 | **Susunan menu khusus user eksternal** — customer hanya melihat menu yang disediakan untuk mereka, diatur lewat konfigurasi role akses | Mekanisme daftar putih `boleh untuk eksternal` sudah tersedia di gelombang 2; penandaan menu mana yang masuk daftar putih diputuskan Epic 4 |

#### Di luar cakupan Epic 3

- Layar Create role, Copy role, dan pengaturan role (Epic 4).
- Susunan menu khusus customer yang final (Epic 4).
- Document Engine dan lifecycle (Epic 7).
- Generator UI penuh (ditolak, §1).
- Hak menu tersendiri per role — **ditolak**, bertentangan dengan prinsip iDempiere.
- Memindahkan halaman ke generator (hanya halaman admin/konfigurasi, Epic 2).

#### Item terbuka di Epic 3

| # | Item | Perlu |
|---|---|---|
| 1 | Cara penyajian menu ke klien: ikut payload `/me` yang sudah ada, atau endpoint menu tersendiri. Harus dipilih berdasarkan pengukuran — jumlah menu, ukuran payload, dan waktu muat — bukan berdasarkan asumsi. | **Ditutup 2026-09-26 — ikut payload `/me`.** Diukur pada tenant dengan seluruh modul aktif dan role berisi seluruh izin (kasus terbesar yang mungkin): `/me` **41,8 ms**, payload **22.431 B**, menu **17.614 B** (79%), **57 simpul** menu dalam 3 grup. Endpoint menu tersendiri akan menambah satu perjalanan bolak-balik dan satu invokasi, lalu tetap memuat data yang sama — tanpa menghilangkan satu byte pun dari `/me`, karena halaman yang memanggilnya toh membaca keduanya bersama (shell butuh `permissions` + `scopeTypes` untuk alasan yang sama ia butuh `menu`). Menambah endpoint hanya untuk 17.614 B yang sudah ikut terkirim adalah optimasi tanpa sasaran. Ukuran ini juga masih di bawah satu koneksi lambat mana pun dengan margin besar. Ambang tinjau ulang dicatat di bawah |
| 2 | Apakah `belum terdaftar` diberi tenggat, setelah lewat tenggat route ditolak keras, atau cukup dilaporkan selamanya sebagai pekerjaan tertunda | **Ditutup 2026-09-26 — ditolak keras sejak sekarang, dan tenggatnya adalah sekarang.** Lihat alasan di bawah |
| 3 | Rincian mana saja yang memang perlu pengecualian hanya-baca, bukan mewarisi induknya | **Dipindahkan 2026-09-26, dan tuntas di Epic 4 pada 2026-09-27.** Pendataan 17 rincian: 15 mewarisi induk, 2 lebih sempit, 0 hanya-baca. Angka itu menutup bagian registry-nya; bagian hanya-baca-nya diwujudkan sebagai `role_window_access` dan **ditegakkan** pada Epic 4 Gelombang 1 langkah 11a–11b — role read-only tetap membuka halamannya, tulisnya ditolak server dengan 403. Dikoreksi 2026-09-26: penutupan pertama menyimpulkan "tidak perlu pengecualian" dari kemampuan halaman, padahal pertanyaannya tentang izin per role. Lihat alasan di bawah |
| 4 | Apakah baca-arsip modul nonaktif cukup lewat Administration, atau perlu halaman arsip khusus per modul | Keputusan saat eksekusi gelombang 3 |

**Ambang tinjau ulang untuk item terbuka 1.** Keputusan "ikut `/me`" diikat ke angka yang diukur, bukan ke selera. Ditinjau ulang bila salah satu tercapai: menu melewati **±120 simpul** (dua kali lipat hari ini), payload `/me` melewati **±64 KB**, atau `/me` melewati **±200 ms** pada database produksi. Selama ketiganya belum tercapai, endpoint menu tersendiri tidak dibuat.

**Alasan lengkap item terbuka 2 — `belum terdaftar` ditolak keras.** Pertanyaannya menawarkan tiga pilihan; dua di antaranya sudah tidak berlaku karena kenyataan yang terukur:

```text
Tenggat + tolak setelah lewat tenggat   →  tidak perlu tenggat.
                                           Tolakannya sudah berlaku sejak route guard dinyalakan.
Dilaporkan selamanya sebagai utang      →  bertentangan dengan gate rilis §4.3 yang
                                           menjadikan `belum terdaftar` sebagai error, bukan warning.
```

Yang membuat tenggat tidak diperlukan adalah pengukuran, bukan pilihan rasa. Dari 13.370 baris `app_windows` di database pembangunan, **nol** berstatus `belum_terdaftar` — 7.831 `di_menu`, 5.539 `tersembunyi`. Registry mengisi status setiap route saat pendaftaran, dan registry itulah yang melewatkan route yang tidak dideklarasikan. Jadi `belum_terdaftar` bukan kondisi yang menumpuk dan perlu ditenggat; ia hanya bisa muncul dari route yang baru ditambahkan ke `App.tsx` tanpa didaftarkan ke kamus.

Dan untuk route seperti itu, perilakunya sekarang sudah tepat sasaran: `resolveRouteEntry` mengembalikan `null` (wildcard `*` sengaja **tidak** dipakai sebagai cadangan — itu akan membuat penjaga tidak pernah bisa melaporkan alamat tak dikenal), lalu `AppShell` menahan render dan menampilkan "Page not found." tanpa mengalihkan diam-diam ke Overview. Artinya route yang belum terdaftar **tidak merender isinya**, yaitu hal yang sama dengan "ditolak keras" — hanya dicapai lewat 404, bukan lewat 403.

Gagasan "tenggat" sendiri cacat untuk kasus ini. Tenggat masuk akal bila ada baris yang menumpuk di database dan perlu dipaksa selesai; di sini tidak ada baris seperti itu, dan menambahkan tenggat berarti menambahkan **jendela di mana route yang belum terdaftar boleh dirender** — persis kebalikan dari prinsip 4 ("menambah halaman tanpa mendaftarkannya adalah kesalahan yang terlihat, bukan kesalahan yang senyap") dan dari mitigasi baris "Developer menambah route tanpa mendaftar". Tenggat akan melemahkan kontrol, bukan memperkuatnya.

Konsekuensi yang mengikat:

1. `GUARD_ENFORCE = true` di `apps/web/src/lib/routeRegistry.ts` adalah keadaan akhir, bukan nilai sementara untuk dibalik nanti. Ini menutup langkah "flip fail-closed" yang dulu direncanakan sebagai pekerjaan tersendiri.
2. Penegakan fail-closed tetap berada di jalur **build/CI** (uji `route-registry-parity.test.ts` membandingkan registry dengan route yang benar-benar dideklarasikan `App.tsx`, dua arah: tidak ada route tanpa entri, tidak ada entri tanpa route). Itu yang menjadikan `belum_terdaftar` tidak pernah tercapai di produksi — bukan tenggat.
3. Laporan kamus tetap ada untuk pembacaan manusia, tetapi **bukan** sebagai izin menunda: halaman yang belum terdaftar tidak dirender hari ini juga, bukan setelah lewat sekian hari.

**Alasan lengkap item terbuka 3 — dipindahkan ke Epic 4, bukan ditutup sebagai tidak perlu.** Item ini diminta "didata saat eksekusi gelombang 1" dan terlewat di sana; pendataannya dilakukan terhadap registry yang sudah berjalan (70 entri, 17 di antaranya rincian).

> **Koreksi 2026-09-26.** Penutupan pertama item ini keliru dan sudah dibatalkan. Waktu itu item ditutup dengan kesimpulan "tidak ada rincian yang perlu pengecualian hanya-baca, dan pertanyaannya keliru bentuk". Kesimpulan itu dibangun dari premis yang salah: ia menyamakan **kemampuan halaman** dengan **izin role**. Yang didata memang benar — 17 halaman rincian (`parentPath` terisi), 15 mewarisi daftar izin induk, 0 hanya-baca menurut kode halamannya. Dua yang tidak mewarisi adalah `/asset-maintenance/assets/:assetId` dan `/hse/report`, dan keduanya menyimpang karena capability masuknya berbeda, bukan karena mode bacanya berbeda. Yang tidak sah adalah lompatan darinya ke "maka pengecualian hanya-baca tidak perlu ada". Pertanyaan §4.3 bukan "apakah halamannya menulis", melainkan "bolehkah **role** ini menulis di halaman itu". Halaman yang punya mutasi tetap harus bisa dibuka oleh role yang hanya berhak baca; hari ini tidak ada satu pun tempat yang menyatakan itu. Sebuah audit atas satu keadaan implementasi tidak boleh membatalkan kebutuhan yang sudah ditetapkan sebagai keputusan desain — dan `role_window_access` sudah berada di Epic 1 (baris 287) sejak sebelum audit ini. Karena itu item ini tidak ditutup: bagian registry-nya selesai, bagian hanya-baca-nya **dipindahkan** ke Epic 4 Gelombang 1.

**Pertanyaan §4.3 menanyakan apakah ada halaman rincian yang tidak menulis.** Jawaban terukur: dari 17 halaman rincian (`parentPath` terisi), **tidak ada** yang murni hanya membaca. Yang membaca saja hanya `/finance/transactions/:transactionId`? Tidak — halaman itu pun menulis. Yang benar-benar hanya membaca tidak ada satu pun.

Hasil ini menjawab bagian **registry**. Ia tidak menjawab bagian **hanya-baca**, karena keduanya dua pertanyaan berbeda. Daftar izin route menjawab "role mana yang boleh membuka Window ini" (lapis 2). Mode hanya-baca menjawab "setelah dibuka, boleh menulis atau tidak" (lapis 3). Satu halaman yang menulis bisa saja harus dibuka oleh role yang tidak boleh menulis; justru itulah keadaan yang menuntut lapis 3, bukan yang meniadakannya.

| Uji | Hasil |
|---|---|
| Rincian yang mengulang daftar izin induknya persis | 15 dari 17 |
| Rincian dengan daftar izin berbeda dari induknya | 2 — `/asset-maintenance/assets/:assetId` (masuk lewat izin lain) dan `/hse/report` (form-nya dijaga `hse.report`, bukan `hse.manage`) |
| Rincian yang halamannya tidak melakukan penulisan sama sekali | **0** |

**Dua rincian yang layak dibahas, dan apa yang sebenarnya keduanya tunjukkan.**

`/asset-maintenance/assets/:assetId` (“Asset Performance”) memang punya daftar lebih sempit — `asset.meter.manage`, `asset.downtime.manage`, `asset.analytics.read`, bukan daftar induk. Pengecualiannya nyata dan terukur: `OPERATOR_ROLE` masuk lewat daftar itu, `NO_ANALYTICS_ROLE` tertahan meski memegang `asset.maintenance.read`. Tetapi bentuknya **bukan** pengecualian hanya-baca: halamannya mencatat pembacaan meter, mencatat downtime, menutup downtime, dan menghasilkan snapshot prediktif — empat penulisan. Melabelinya hanya-baca akan salah dan akan memutus pekerjaan yang memang tugasnya. Ia tetap anak penuh `/asset-maintenance`; yang membuatnya berbeda adalah izinnya, bukan modus bacanya.

`/finance/transactions/:transactionId` adalah baris yang §4.3 sebut dengan tangan sebagai contoh, dan justru baris itu yang menulis: `reverseFinanceTransaction`, `actOnFinanceTransaction`, `uploadDocument`. Yang membuat “hanya-baca” di sini bukan daftar route, melainkan kerja tiap aksi di server:

| Aksi halaman | Dijaga server oleh |
|---|---|
| `getTransaction` (baca) | `finance.read` |
| `reverseTransaction` | `finance.manage` |
| `actOnTransaction` | `finance.approve` |
| `uploadDocument` | izin unggah dokumen |

Satu route memang tidak dapat memisahkan `finance.read` dari `finance.approve`: `FIN_READER_P6` dan `FIN_APPROVER_P6` sama-sama berhak membuka halaman itu, dan yang membedakan keduanya hanya aksi yang boleh dijalankan. Kalau daftar route dipersempit untuk memisahkan mereka, halaman yang tertutup adalah halaman yang seharusnya boleh dibuka.

**Apa yang sebenarnya menahan perubahan, dan di mana ia berada.** Bukan route guard. Route guard hanya memutuskan halaman dirender atau tidak; ia berjalan di browser dan §4.3 sendiri menyebutnya “afordansi UX”, bukan penjaga. Yang menahan perubahan adalah `requirePermission` di service, per aksi. Konsekuensi yang sudah berlaku hari ini, tanpa pekerjaan tambahan:

1. Route gate untuk rincian tetap menyalin daftar induk. Tidak ada penafsiran runtime, tidak ada aturan tersembunyi yang bisa dilupakan.
2. Registry tidak menandai rincian sebagai hanya-baca karena registry mendeskripsikan akses Window, bukan mode akses per role. Tidak adanya tanda di registry **bukan** bukti bahwa role tidak memerlukan mode hanya-baca.
3. Jika role hanya memegang izin baca, `role_window_access.is_read_write = false` harus menahan mutasi di server tanpa menutup halaman. Daftar izin route tidak boleh dipersempit untuk memisahkan role tersebut, karena halaman tetap boleh dibuka.
4. Pengecualian daftar izin tetap hanya dipakai bila rincian memang memiliki lingkup capability berbeda — seperti `/asset-maintenance/assets/:assetId` — bukan untuk mengekspresikan mode baca role.

**Pekerjaan dipindahkan secara eksplisit ke Epic 4 Gelombang 1.** “Mode hanya-baca” pada kalimat §4.3 — “identitas Window sendiri dengan mode read-only” — diwujudkan sebagai `role_window_access` (`role_id`, `window_code`, `is_read_write`, `is_active`). Tabel ini belum ada dan kini menjadi tambahan wajib Gelombang 1, bersama picker Window pada definisi Role dan penegakan server-side terhadap mutasi. Semua Window yang dapat dipilih tetap punya mode baca/tulis per role; angka 15 dari 17 hanya menjelaskan pewarisan daftar izin registry, bukan alasan untuk menyembunyikan rincian dari picker. Empat tabel saudara (`role_process_access`, `role_table_access`, `role_column_access`, `role_record_access`) tetap di luar Gelombang 1: Process saat ini identik 165/165 dengan permission (angka diperbarui 2026-09-27 setelah `role.manage` masuk), `app_tables` kosong, `app_columns` belum ada, dan dictionary record belum ada. Mereka baru dibangun setelah objek yang akan dikunci memiliki identitas operasional.

#### Strategi mitigasi risiko Epic 3

Strategi utama: **keamanan ditutup lebih dulu, perubahan menu dilakukan bertahap, dan setiap perpindahan dibuktikan terhadap perilaku hari ini**. Epic 3 tidak boleh dinyatakan selesai hanya karena menu sudah tampil dari database. Route, API, modul, role, dan menu harus lulus pemeriksaan masing-masing.

##### 1. Prioritas mitigasi berdasarkan risiko

| Risiko | Dampak | Mitigasi wajib | Bukti selesai |
|---|---|---|---|
| Route baru atau route tersembunyi merender tanpa izin | User melihat form atau data yang bukan haknya; celah `/hse/report` dan `/administration/complaints` terulang | Jadikan **route guard terpusat** langkah pertama. Default guard adalah menolak: route tanpa entri kamus, tanpa hak, atau dengan modul nonaktif tidak boleh merender isi halaman | Test untuk route `di-menu`, `tersembunyi`, `belum terdaftar`, tanpa hak, dan modul nonaktif; isi halaman tidak muncul sebelum pemeriksaan selesai |
| Modul nonaktif hanya menyembunyikan menu | URL langsung dan integrasi tetap membuat atau mengubah data | Satu helper server wajib, misalnya `requireModuleActive(moduleCode)`, dipakai pada semua create/update/action. Baca arsip memakai jalur dan izin khusus | Test API membuktikan create/update/action ditolak, baca arsip tetap sesuai izin, dan data tidak dihapus |
| Menu internal terkirim ke user eksternal | Struktur internal atau fungsi administrasi bocor ke browser | Penyaringan server berurutan: daftar putih eksternal → status modul → hak role. `is_external_allowed` default `false`; menu yang tidak diizinkan tidak pernah dikirim | Test payload user eksternal memastikan menu internal tidak ada, bukan hanya disabled; test internal memastikan aturan role tetap berlaku. **Terpenuhi 2026-09-26 (Gelombang 2):** `menu-filter.test.ts` memeriksa setiap simpul payload eksternal — gagal bila ada satu simpul tanpa `is_external_allowed`, dalam keadaan apa pun — dan `menu-filter-unit.test.ts` membuktikan urutan langkahnya: pemanggil yang **memegang** izinnya tetap kehilangan menu itu, karena langkah 1 berjalan lebih dulu |
| Migrasi menu mengubah perilaku tanpa sengaja | Menu hilang, salah induk, salah urutan, atau tujuan halaman berubah | Migrasikan dalam mode **parity first**. Bandingkan hasil server dengan 41 menu lama sebelum perubahan desain atau label | Snapshot/diff struktur: grup, modul, `code`, parent, urutan, action, dan target harus sama |
| Developer menambah route tanpa mendaftar | Route terbuka, salah izin, atau tidak dapat dikunci role | Tambahkan pemeriksaan build/CI yang membandingkan route dengan kamus. Status `belum terdaftar` menjadi error pada gate rilis, bukan warning yang diabaikan | CI gagal jika route baru belum memiliki status dan hak yang sah; daftar pengecualian hanya untuk tiga alur luar shell |
| Penjaga terpusat menjadi satu titik kegagalan | Satu bug dapat membuka atau menutup banyak halaman sekaligus | Pisahkan mode fail-closed, unit test matrix, integration test, dan smoke test untuk setiap kelas status. Jangan memberi bypass produksi berbasis URL atau flag klien | Test guard gagal tertutup saat kamus/API error; hasil smoke test route utama dan route sensitif tersimpan |
| Struktur empat tingkat terlalu kaku | Modul besar sulit dinavigasikan; perubahan struktur memerlukan deployment | Jangan memperluas kedalaman sebelum ada bukti. Untuk kebutuhan rutin, izinkan override label dan urutan saja. Tinjau ulang hanya jika satu modul melewati batas operasional yang disepakati | Catatan ukuran dan keluhan navigasi nyata; keputusan perubahan didasarkan pada data, bukan perkiraan |
| Payload menu salah desain | Waktu muat atau kompleksitas pemeliharaan meningkat | Ukur `/me` versus endpoint khusus dengan jumlah menu, ukuran payload, waktu respons, cache, dan waktu render. Pilih opsi paling sederhana yang memenuhi target | Hasil pengukuran tersimpan bersama keputusan; tidak ada optimasi prematur |
| Aktivasi atau penimpa menu salah | User kehilangan menu atau label resmi berubah tanpa kendali | Simpan audit actor, tenant, waktu, perubahan sebelum/sesudah, dan versi. Perubahan struktural tetap lewat kode/migration; database hanya untuk override yang diizinkan | Audit lengkap, validasi daftar istilah, dan prosedur rollback teruji |

##### 2. Urutan kerja aman

Urutan berikut mengikat eksekusi Epic 3:

1. **Tutup dua celah nyata lebih dulu** dengan guard sementara yang mengikuti kamus Epic 2: `/hse/report` dan `/administration/complaints` tidak boleh menampilkan isi sebelum hak diperiksa.
2. Bangun route guard final dengan perilaku fail-closed, lalu uji route normal, detail tersembunyi, route belum terdaftar, modul nonaktif, dan error kamus.
3. Daftarkan seluruh route dan tetapkan target izin setiap route. Jangan memindahkan menu sebelum daftar route memiliki status resmi.
4. Buat tabel `app_menus` dan `app_menu_tree`, lalu isi definisi awal melalui migration yang dapat diulang dengan aman.
5. Jalankan parity check terhadap menu lama. Jika ada selisih, hentikan perpindahan dan jelaskan selisihnya; jangan menganggap selisih sebagai perubahan desain tanpa keputusan.
6. Sajikan menu dari server setelah hasil parity lulus. Penyajian `/me` atau endpoint khusus dipilih dari hasil pengukuran.
7. Aktifkan aturan eksternal, status modul, dan hak role secara bertahap. Setiap lapisan diuji sendiri sebelum digabung.
8. Tegakkan status modul di API dan uji jalur langsung, bukan hanya klik dari menu.

##### 3. Gate sebelum rilis

Epic 3 tidak boleh masuk production jika salah satu kondisi berikut gagal:

- Tidak ada route yang merender isi tanpa pemeriksaan hak.
- Route `belum terdaftar` tidak dapat dibuka dan muncul di laporan yang dapat ditindaklanjuti.
- User eksternal tidak menerima menu tanpa `is_external_allowed = true`.
- Modul nonaktif menolak create/update/action pada API, termasuk lewat URL langsung dan integrasi yang memakai actor sah.
- Data arsip tetap dapat dibaca hanya melalui izin yang ditentukan.
- Struktur menu baru lulus parity check terhadap menu lama, atau setiap perbedaan sudah disetujui dan dicatat.
- Tidak ada perubahan label, urutan, atau aktivasi tanpa audit.
- Test guard, API authorization, migration, dan regression utama lulus pada database uji terpisah dari `abixell_one_dev`.

##### 4. Rencana rollback

Rollback dibagi agar kegagalan satu bagian tidak memaksa membatalkan seluruh Epic:

| Jenis kegagalan | Tindakan rollback |
|---|---|
| Payload menu atau struktur salah | Kembalikan feature flag penyajian ke sumber menu lama tanpa menghapus kamus dan audit; perbaiki migration sebelum mencoba lagi |
| Label atau urutan override salah | Pulihkan nilai override sebelumnya dari audit; jangan mengubah UUID atau `code` stabil |
| Guard menolak user sah | Matikan rollout menu baru, perbaiki mapping kamus/role, lalu ulangi test. **Tidak boleh** menambahkan bypass akses global |
| Guard gagal tertutup atau route sensitif terbuka | Hentikan rilis segera; pertahankan guard fail-closed dan blok route sampai perbaikan lulus |
| Enforcement modul mengganggu baca arsip | Rollback aturan write/action secara terpisah hanya jika keamanan tetap tertutup; baca arsip tidak boleh dipulihkan lewat endpoint kerja biasa |
| Migration gagal sebagian | Gunakan migration transaction/idempotency dan prosedur down yang aman; verifikasi schema, seed, dan audit sebelum retry |

Rollback tidak boleh menghapus data bisnis, mengubah izin lintas tenant, atau mengembalikan menu sebagai security boundary. Setelah rollback, API tetap menjadi penjaga terakhir.

##### 5. Pengendalian risiko jangka panjang

- Setiap menu baru wajib memiliki `code` stabil, `module_id`, action, target, status route, dan aturan eksternal yang eksplisit.
- Setiap endpoint modul baru wajib menyebutkan pemeriksaan modul aktif dan permission object yang digunakan.
- Perubahan struktur inti dilakukan lewat migration dan review; override tenant dibatasi label, deskripsi, urutan, dan status yang memang diizinkan.
- Audit log dipakai untuk investigasi, bukan dianggap sebagai pencegah. Pencegah tetap guard, API authorization, dan database scope.
- Review risiko diulang saat Epic 4 menghubungkan menu dengan Create Role, Copy Role, otorisasi modul, dan whitelist user eksternal.
- Setiap keputusan yang menambah fleksibilitas harus menjawab dulu: apakah fleksibilitas itu memperbesar permukaan salah konfigurasi? Jika ya, default tetap tertutup dan kemampuan dibuka secara eksplisit.

---

### 4.4 EPIC 4 — User, Role & Permission Configuration UI

#### Problem statement

Abixell One sudah memiliki fondasi backend untuk role, permission, assignment, dan Data Scope, tetapi konfigurasi administrasinya belum menjadi satu alur yang utuh. Kondisi yang harus diselesaikan Epic 4:

- Role masih terutama dibaca sebagai data; layar Create Role, Edit Role, dan Copy Role belum tersedia.
- Permission, role, dan Data Scope harus dikelola sebagai satu keputusan akses. Permission dari role A tidak boleh digabung dengan scope dari assignment yang tidak sama.
- Admin Tenant perlu dapat mengelola user dan akses, tetapi tidak boleh memperluas otoritasnya sendiri atau keluar dari batas tenant dan organisasi yang didelegasikan.
- Pencabutan assignment harus langsung menghentikan akses, tetapi riwayat assignment tetap dapat diperiksa.
- Modul nonaktif tidak boleh menawarkan permission seolah-olah dapat dipakai. UI harus memberi notifikasi bahwa modul tersebut inactive.
- Customer scope sudah didukung oleh backend, tetapi aturan bisnisnya belum dikunci. Customer scope tidak dibuka dalam UI Epic 4 sebelum wawancara Service Operation selesai.

Epic 4 adalah layar konfigurasi di atas enforcement API. Menu, halaman, dan checkbox bukan security boundary. Semua perubahan tetap divalidasi di backend, dicatat di `audit_log`, dan dijalankan melalui governed transaction.

#### Keputusan terkunci hasil wawancara

Keputusan berikut dicatat pada 2026-09-24 dari empat putaran wawancara. Istilah **Super Admin** berarti otoritas platform. Istilah **Admin Tenant** berarti administrator internal tenant yang tetap dibatasi oleh tenant, scope, permission, dan aturan delegasi pada assignment mereka. Keduanya tetap tunduk pada guardrail platform dan audit.

**Keputusan awal:** cakupan Epic 4 mencakup user dan role; administrasi tenant memakai delegasi terbatas; konfigurasi kebijakan approval masuk cakupan, bukan pembangunan workflow approval; perubahan akses langsung berlaku pada pemeriksaan authorization berikutnya. Penanda `Modernize` pada keputusan produk berarti rancangan Abixell, bukan klaim bahwa perilaku identik sudah dibuktikan pada iDempiere.

##### Putaran 1 — Batas otoritas administrator

| Topik | Keputusan | Penanda |
|---|---|---|
| User yang dapat dilihat Admin Tenant | Hanya user dalam scope admin tersebut. User di luar scope tidak terlihat sama sekali. | Modernize |
| Perluasan otoritas sendiri | Admin Tenant tidak boleh memperluas otoritasnya sendiri. | Adopt |
| Perubahan assignment pemberi otoritas sendiri | Admin Tenant tidak boleh mengubah assignment yang memberi otoritas administrasinya. | Modernize |
| Penghapusan role | Role hanya boleh dihapus jika tidak lagi dipakai user. Role yang masih dipakai tidak dihapus. | Modernize |

Super Admin dapat mengelola seluruh tenant dan seluruh assignment sesuai kewenangannya. Admin Tenant bertindak sebagai administrator yang didelegasikan, bukan sebagai Super Admin lokal tanpa batas.

##### Putaran 2 — Visibilitas user, pembuatan user, dan pilihan scope

| Topik | Keputusan | Penanda |
|---|---|---|
| User di luar scope admin | Tidak terlihat sama sekali, bukan hanya disabled. | Modernize |
| Default scope Admin Tenant | Tenant-wide dalam tenant miliknya sendiri, selama assignment admin tersebut memang memberi scope tenant-wide. | Modernize |
| Pembuatan user baru | Epic 4 boleh membuat user baru, termasuk data dasar dan assignment awal bila dipilih. | Modernize |
| Scope yang ditawarkan untuk Admin Tenant | Tenant dan organization unit/site dalam tenant sendiri. | Modernize |
| Customer scope pada UI Epic 4 | Tetap tersedia di backend, tetapi dikunci dari UI sampai kebutuhan bisnis Service Operation diputuskan. | Needs interview |

Assignment awal bersifat opsional. Keputusan Putaran 4 memperjelas bahwa user boleh dibuat tanpa assignment dan diberi akses kemudian.

##### Putaran 3 — Create, Edit, dan Copy Role

| Topik | Keputusan | Penanda |
|---|---|---|
| Siapa boleh membuat role | Super Admin dan Admin Tenant yang memenuhi batas otoritas. Admin Tenant tidak boleh membuat role dengan authority di atas yang dapat mereka delegasikan. | Modernize |
| Permission yang muncul pada setup role | Hanya permission dari modul yang aktif untuk tenant tersebut. Permission dari modul inactive tidak dapat dipilih. | Modernize |
| Notifikasi modul inactive | Bila permission atau fungsi yang diminta berasal dari modul inactive, UI harus menjelaskan bahwa modul inactive; UI tidak boleh menyamarkan keadaan itu sebagai permission yang hilang. | Modernize |
| Isi Copy Role | Hanya definisi: nama baru, permission, dan batasan. User dan assignment tidak disalin. Salinan berdiri sendiri. | Modernize |
| Edit role yang sedang dipakai | Boleh. Sebelum simpan, wajib tampilkan dampak: jumlah user terdampak dan permission yang bertambah atau berkurang. | Modernize |

##### Putaran 4 — User assignment internal

| Topik | Keputusan | Penanda |
|---|---|---|
| Permukaan pengelolaan assignment | Keduanya tersedia: dari halaman Users untuk satu user, dan dari halaman assignment untuk tinjauan lintas user. | Modernize |
| Pemberi tenant-wide assignment | Super Admin dan Admin Tenant yang memenuhi batas otoritasnya. Memiliki akses data tenant saja tidak otomatis berarti boleh memberi assignment tenant-wide. | Modernize |
| Organization unit assignment | Admin yang berwenang boleh mengelola seluruh region yang berada dalam batas tenant/delegasinya beserta semua turunannya. | Modernize |
| Riwayat assignment dicabut | Tetap terlihat pada riwayat akses user, dengan status dicabut, waktu, pelaku, dan audit. | Modernize |
| Pemberian beberapa assignment | Beberapa pasangan role + scope dapat dipilih sekaligus, lalu dikonfirmasi dalam satu tindakan. Setiap pasangan tetap menjadi assignment terpisah. | Modernize |
| User baru tanpa akses | Boleh membuat user tanpa assignment. Tidak ada role atau scope default yang diberikan diam-diam. | Modernize |

#### Prinsip yang mengikat Epic 4

1. **Role, permission, dan Data Scope adalah satu keputusan akses.** Permission dan scope harus berasal dari assignment yang sama ketika aksi memerlukan keduanya. Epic 4 tidak boleh membuat tampilan yang mendorong admin menganggap permission dari satu role dapat dipasangkan bebas dengan scope dari assignment lain.
2. **Admin hanya dapat mengelola area yang dapat mereka kelola.** Daftar user, role, scope, dan assignment harus disaring di server. Filter pada browser tidak cukup.
3. **Delegasi tidak boleh menaikkan privilege.** Admin Tenant hanya dapat memberikan permission, role, dan scope yang masih berada dalam batas authority mereka sendiri.
4. **Tidak ada akses diam-diam.** User baru boleh tidak memiliki assignment. Sistem tidak membuat akses default tanpa tindakan eksplisit admin.
5. **Modul adalah plafon.** Modul aktif membuka daftar objek yang dapat dipilih; modul aktif sendiri tidak memberikan permission. Modul inactive tidak dapat menjadi sumber permission baru.
6. **Copy role selalu detached.** Salinan tidak mengikuti perubahan role asal dan tidak membawa user atau assignment asal.
7. **Perubahan role yang berdampak harus terlihat sebelum commit.** Preview dampak adalah guardrail sebelum permission bertambah atau berkurang untuk banyak user.
8. **Pencabutan berlaku segera pada pemeriksaan authorization berikutnya.** Session aktif tidak perlu logout, tetapi assignment revoked tidak lagi masuk ke authorization-effective view.
9. **Riwayat tidak dihapus karena akses dicabut.** Assignment aktif dan assignment historis dipisahkan statusnya; audit tetap append-only.
10. **Customer scope bukan asumsi internal.** Scope customer tidak ditawarkan kepada Admin Tenant sampai aturan Service Operation mengunci siapa pemakai, data, delegasi, pencabutan, dan kombinasi scope.
11. **Menu bukan security boundary.** UI hanya membantu konfigurasi; API dan repository tetap menjadi penjaga terakhir.

#### Basis iDempiere dan terjemahan Abixell One

| Konsep iDempiere | Bukti/rujukan | Terjemahan Abixell One | Penanda |
|---|---|---|---|
| Role sebagai definisi authority | `I_AD_Role.java`; role menyimpan sifat dan aturan authority | `roles` + `role_permissions`; Epic 4 menyediakan Create, Edit, dan Copy Role | Modernize |
| User-role assignment | `I_AD_User_Roles.java` | `user_role_assignments`, dengan assignment sebagai unit permission + Data Scope | Adopt |
| Organization access | `I_AD_Role_OrgAccess.java`; access organization mempunyai arah read-only yang eksplisit | Scope organization unit hierarkis, dengan aturan delegasi Admin Tenant | Modernize |
| Window/process/table/column access | `I_AD_Window_Access.java`, `I_AD_Process_Access.java`, `I_AD_Table_Access.java`, `I_AD_Column_Access.java` | Daftar permission dari kamus Epic 2; modul menjadi plafon, objek aplikasi menjadi pilihan nyata | Adopt/Modernize |
| Record/private access | `MRole` dan access record iDempiere | Bukan diselesaikan lewat menu; tetap menjadi lapisan backend pada Epic 1 dan modul terkait | Adopt |
| Query access filter | `MRole.addAccessSQL()` (`MRole.java:2076` dan rentang terkait) | Authorization dan filter scope tetap dipusatkan di service/repository, bukan di komponen React | Modernize |
| Login dengan beberapa role | `Login.getRoles()` dan pemilihan context iDempiere | Role assignment dapat dipilih sebagai context; perubahan role aktif ditangani Epic 1 | Modernize |
| Copy role | `MRole` dan pola role definition iDempiere | Keputusan Abixell: salin definisi saja, detached; detail implementasi wajib diverifikasi saat eksekusi | Modernize / Needs verification |

**Batas bukti:** source iDempiere menjadi rujukan pola, bukan alasan untuk menyalin UI Swing/ZK. Untuk perilaku copy role yang tepat, source lengkap harus diverifikasi lagi sebelum implementasi. Keputusan detached copy Abixell tetap terkunci sebagai keputusan produk.

#### Mekanisme desain

##### A. Role definition

Role memiliki batas tenant dan identitas `code` yang unik per tenant. Epic 4 menyediakan tiga alur:

1. **Create Role** — admin mengisi code, nama, deskripsi bila tersedia, lalu memilih permission yang valid.
2. **Edit Role** — admin mengubah definisi permission atau metadata yang diizinkan. Sistem menghitung dampak sebelum menyimpan.
3. **Copy Role** — sistem membuat role baru dengan code dan nama baru, menyalin permission serta batasan yang disetujui, tanpa menyalin `user_role_assignments` dan tanpa hubungan hidup ke role asal.

Permission picker harus menerima daftar yang sudah disaring menurut:

```text
modul tenant aktif
    → objek aplikasi terdaftar di kamus
        → permission yang boleh didelegasikan oleh actor
            → permission yang dapat dipilih
```

Jika modul inactive, item tidak boleh dipilih. UI menampilkan notifikasi **modul inactive**. Backend mengulangi validasi ini sehingga request buatan manual tidak dapat melewati plafon modul.

Untuk Admin Tenant, batas delegasi dihitung dari authority yang benar-benar dapat mereka kelola, bukan dari seluruh katalog permission global. Super Admin dapat mengelola katalog sesuai aturan platform.

##### B. Dampak edit role

Sebelum edit role disimpan, backend menghitung:

- jumlah user dengan assignment role tersebut;
- daftar permission yang akan ditambahkan;
- daftar permission yang akan dicabut;
- scope yang tetap sama dan tidak berubah;
- assignment yang sudah revoked atau invalidated dan tidak boleh dihitung sebagai akses efektif;
- apakah perubahan melampaui authority actor.

UI menampilkan hasil preview. Konfirmasi akhir mengirim versi perubahan yang sudah dipreview, sehingga backend dapat menolak bila definisi berubah di antara preview dan commit. Perubahan yang menambah atau mencabut permission menulis audit event dengan before/after.

##### C. User management

Halaman Users menampilkan hanya user yang berada dalam batas visibility actor. User di luar scope tidak dikirim ke browser. Create User menerima:

- data dasar user;
- status awal sesuai aturan identity;
- nol atau beberapa assignment awal.

Create tanpa assignment sah dan menghasilkan user tanpa akses operasional. Bila assignment awal dipilih, beberapa pasangan role + scope diproses sebagai satu transaksi dan satu konfirmasi. Kegagalan satu pasangan menggagalkan seluruh batch. **Keputusan dikunci 2026-09-28 (item terbuka 4): atomic all-or-nothing — mode partial success tidak dipakai.**

##### D. Dua permukaan assignment

**User-centric:**

- buka satu user;
- lihat assignment aktif dan riwayat revoked/invalidated;
- tambah beberapa pasangan role + scope;
- preview dampak;
- konfirmasi satu kali;
- revoke assignment tertentu dengan alasan yang tercatat.

**Assignment-centric:**

- daftar assignment lintas user yang berada dalam scope actor;
- filter user, role, scope type, organization unit, status aktif/revoked/invalidated;
- buka detail user atau assignment;
- lakukan review dan aksi yang sama dengan guardrail authority.

Kedua permukaan memakai application service dan policy yang sama. Tidak boleh ada satu permukaan yang lebih kuat hanya karena route-nya berbeda.

##### E. Scope assignment internal

Scope internal Epic 4:

- `tenant` — seluruh tenant actor, hanya bila authority assignment actor membolehkan;
- `organization_unit` — unit tertentu dan turunannya sesuai aturan hierarki;
- `customer` — tersimpan dan dibaca backend, tetapi tidak tersedia di UI Epic 4 sampai session Service Operation selesai.

Admin yang memegang authority pada seluruh region dalam tenant dapat mengelola region-region tersebut beserta descendant-nya. Admin yang hanya memegang satu region tidak boleh melihat atau memberi assignment ke region lain. Pemeriksaan ancestor/descendant harus memakai helper scope terpusat, bukan logika baru di frontend.

##### F. Model pencabutan dan histori

Kode saat ini masih melakukan `DELETE FROM user_role_assignments` pada alur governed removal (`apps/api/src/infrastructure/persistence/repositories/rbac.repository.pg.ts:520`) lalu menulis audit `user.role_removed`. Keputusan Epic 4 membutuhkan histori yang terlihat pada daftar akses, sehingga target desain harus berubah:

- assignment row tidak dihapus saat pencabutan manual;
- tambahkan status pencabutan, minimal `revoked_at`, `revoked_by`, dan alasan pencabutan;
- `scope_invalidated_at` tetap dipakai untuk invalidasi karena entitas scope dihapus atau tidak lagi valid, bukan sebagai pengganti pencabutan manual;
- authorization-effective view mengecualikan assignment revoked dan invalidated;
- daftar administrasi dapat menampilkan assignment historis dengan status dan metadata pencabutannya;
- audit event tetap ditulis append-only dalam transaksi yang sama.

Perubahan role atau penghapusan role tidak menghapus histori assignment. Role yang sudah tidak tersedia dapat ditampilkan sebagai `unavailable` pada histori, sesuai perilaku read model administrasi yang sudah ada.

##### G. Penghapusan role

Role hanya dapat dihapus jika tidak memiliki user assignment yang masih relevan dengan aturan lifecycle. Jika masih dipakai user, UI menjelaskan jumlah pemakai dan meminta admin memakai Edit, Deactivate, atau revoke assignment sesuai kebijakan yang kelak dikunci. Tidak ada cascade delete diam-diam terhadap assignment historis.

##### H. Otorisasi aksi administrasi

Setiap aksi mengikuti urutan berikut di server:

```text
1. actor aktif dan tenant valid
2. actor punya permission administrasi yang relevan
3. target user/role/scope berada dalam visibility dan Data Scope actor
4. role dan permission yang akan diberikan berada dalam batas delegasi actor
5. modul terkait aktif, bila aksi menyentuh permission modul
6. aturan khusus self-management dan final tenant manager terpenuhi
7. governed transaction + audit
```

Aturan `same-assignment` tetap berlaku. Memiliki `config.read` dari satu assignment dan scope tenant dari assignment lain tidak boleh menghasilkan kewenangan administrasi tenant-wide.

#### Gelombang pengerjaan Epic 4

**Gelombang 0 — Kontrak dari Epic 1–3**

1. Pastikan kamus Epic 2 menyediakan identity untuk Page/Window, API Resource, Table, Process, dan permission.
2. Pastikan Epic 3 memasok module association, status module active/inactive, dan korelasi menu ke fungsi.
3. Tetapkan policy server untuk Admin Tenant: visibility user, role delegation, tenant scope, dan organization hierarchy.
4. Tidak membuka customer scope pada UI sebelum session Service Operation selesai.

**Gelombang 1 — Role definition**

5. Create Role dengan code unik per tenant.
6. Permission picker berbasis active module dan daftar objek kamus.
7. Validasi backend untuk module ceiling dan delegation ceiling.
8. Copy Role detached: definisi saja, tanpa user atau assignment.
9. Edit Role dengan impact preview dan optimistic version check.
10. Deactivate/delete guard sesuai status pemakaian role.
11a. **Konfigurasi `role_window_access`** — tabel `role_id`, `window_code`, `is_read_write`, `is_active`; picker Window pada layar Role. `window_code` selalu dipilih dari Window kamus yang terdaftar; browser tidak pernah mengirim identitas Window untuk keputusan enforcement.
11b. **Penegakan `role_window_access` bertahap per modul** — petakan API Resource ke Window secara eksplisit di server, lalu tolak POST/PUT/PATCH/DELETE dengan 403 bila seluruh assignment efektif role untuk Window itu read-only atau inactive. Tidak ada fallback diam-diam sebelum pemetaan modul selesai. ~~user dengan beberapa role mendapat union allow (`is_read_write = true` pada satu assignment efektif sudah cukup).~~ **Disunting Epic 1 (2026-09-28):** union allow adalah semantik prase-Epic1 lintas-assignment yang digantikan §4.1 C — gerbang Window kini membaca **hanya assignment aktif**. Lihat §4.1 "Riwayat eksekusi Epic 1".

**Catatan Gelombang 1 — mengapa langkah 11 ada di sini.** Mode hanya-baca per role adalah lapis ketiga dari model otorisasi (aktivasi modul → permission → `role_window_access` → scope data). Ia dipindahkan ke sini oleh penutupan item terbuka 3 Epic 3 pada 2026-09-26: §4.3 meminta “identitas Window sendiri dengan mode read-only”, dan permintaan itu tidak dapat dijawab oleh daftar izin route, karena daftar izin menjawab “boleh membuka atau tidak”, bukan “boleh menulis atau tidak”. Halaman rincian yang menulis tetap harus dapat dibuka oleh role yang hanya berhak baca; tanpa langkah ini tidak ada satu pun tempat yang menyatakan itu.

Empat tabel saudara (`role_process_access`, `role_table_access`, `role_column_access`, `role_record_access`) **tetap di luar Gelombang 1**, dengan dasar terukur pada database pembangunan:

| Tabel | Objek untuk dikunci | Alasan belum dibangun |
|---|---|---|
| `role_window_access` | 70 kode Window (`app_windows`) | Dibangun di Gelombang 1 |
| `role_process_access` | 165 kode Process | `app_processes.code` identik **165 dari 165** dengan `permissions.code`; mengunci Process berarti mengunci objek yang sudah dikunci `role_permissions` |
| `role_table_access` | 0 | `app_tables` ada tetapi **kosong** |
| `role_column_access` | — | Tabel dictionary kolom **belum ada**; tidak ada kunci untuk `column_code` |
| `role_record_access` | 0 | Dictionary record belum ada; aturan record saat ini berbasis `scope_type` di `user_role_assignments` |

Tiga dari empat tabel tidak memiliki objek untuk dikunci dan satu menduplikasi `role_permissions`. Menambahkannya sebelum dictionary Process/Table/Column/Record memiliki identitas operasional akan menghasilkan tabel kosong tanpa picker yang dapat diisi. Urutan yang benar: bangun identitas objeknya dulu, lalu kuncinya.

**Gelombang 1 langkah 5–11a selesai 2026-09-27.** Langkah 11b — penegakannya — menyusul di bagian berikutnya pada hari yang sama. Yang dibangun, dan keputusan yang mengikat:

| Bagian | Wujudnya |
|---|---|
| Create Role (§4.4 langkah 5) | `POST /admin/roles`. Keunikan code per tenant dijaga constraint database, bukan pemeriksaan aplikasi. Skema create tidak membawa `version`; versi pertama ditetapkan server. |
| Permission picker (§4.4 langkah 6) | `GET /admin/role-definition-options` mengembalikan katalog permission dan Window yang sudah disaring di server. `PermissionOption.selectable` benar hanya bila kode modul dikenal, terdaftar, dan — untuk modul bisnis — modulnya aktif bagi tenant, serta delegable bagi aktor. |
| Plafon modul dan delegasi (§4.4 langkah 7) | `validateProposedGrants` dan `validateProposedWindows` dijalankan pada setiap jalur tulis. Kode yang tidak boleh diberikan aktor ditolak beserta alasannya, bukan dibuang diam-diam. |
| Copy Role detached (§4.4 langkah 8) | `POST /admin/roles/:roleCode/copy` hanya menyalin baris eksplisit sumbernya; `is_full_access` tidak pernah diwarisi. Hasil salinan tetap melewati dua validator yang sama, sehingga menyalin peran yang memegang permission modul nonaktif gagal dengan sebab yang terbaca alih-alih kehilangan hibah tanpa kabar. |
| Edit dengan impact preview (§4.4 langkah 9) | `POST /admin/roles/:roleCode/preview` dan `PUT /admin/roles/:roleCode/definition`. Pemeriksaan versi optimistis memakai `computeDefinitionHash` — permissionCode dideduplikasi dan diurutkan, Window diurutkan per `windowCode`, sha256. Update tanpa perubahan mengembalikan definisi tersimpan tanpa menulis baris. |
| Deactivate/delete guard (§4.4 langkah 10) | `DELETE /admin/roles/:roleCode/definition` menolak selama masih ada satu baris assignment yang menunjuk Role itu, dan menyebut jumlahnya di pesan. |
| Otoritas tulis | `requireTransactionRoleDefinitionAuthority` menuntut `admin.console.read` dari assignment efektif mana pun **dan** `role.manage` **dan** `config.read` dari **satu** assignment ber-scope tenant. Aturan `same-assignment` yang sama berlaku: `config.read` dari satu assignment dan scope tenant dari assignment lain tidak dapat digabungkan untuk memperoleh kewenangan tulis ini. |
| Konfigurasi Window (§4.4 langkah 11a) | Migrasi `1787800000000_epic-4-wave-1-role-window-access.cjs` membangun `role_window_access` — `role_id`, `window_code`, `is_read_write`, `is_active` — dengan FK komposit ke `roles(id, tenant_id)` ON DELETE CASCADE dan ke `app_windows(tenant_id, code)` ON DELETE RESTRICT, sehingga menghapus Window kamus yang masih dikonfigurasi Role gagal bersuara alih-alih menjatuhkan konfigurasinya. |
| Pilihan Window | `loadWindowOptions` menyaring di server: `route:*` dikecualikan dan hanya Window ber-`registration_status IN ('di_menu','tersembunyi')` yang masuk daftar. Browser memilih dari daftar itu; ia tidak pernah mengirim identitas Window untuk keputusan enforcement. |
| Status penegakan | `enforcementStatus` **diturunkan** dari pemetaan API Resource → Window (`WINDOW_ENFORCEMENT_STATUS`), bukan literal. Bernilai `"partial"` selama masih ada route penulis yang tidak menyelesaikan ke Window mana pun, dan `"enforced"` hanya setelah yang terakhir ditutup. Literal `"not_enforced"` dihapus dari API, port repositori, cermin web, dan layar Role. |
| Bukti tahap 11a | `apps/api/tests/integration/role-definition.test.ts` pada database terisolasi `abixell_one_epic3_wave4`: 14 dari 14 lulus. `tsc --noEmit` dan `eslint src --ext .ts,.tsx` bersih di `apps/web`. Verifikasi peramban atas alur hidup penuh: create, simpan flag Window (versi 1 → 2, `{isActive:false, isReadWrite:true, windowCode:"route:/admin"}`), hapus, guard hapus ADMIN (409, `Cannot delete Role 'ADMIN': 1 User assignment(s) still reference it`), dan gating kapabilitas `roleManage` atas tombol New role/Copy. Satu penulisan sengaja dilakukan lalu dibalik (`QA_CREATE_CHECK`), meninggalkan 0 baris. |

**Dua cacat lingkungan ditemukan saat verifikasi, bukan cacat kode.** Migrasi `1787800000000_epic-4-wave-1-role-window-access` dan `1788000000000` belum pernah diterapkan ke `abixell_one_dev`, sehingga pembacaan definisi mengembalikan 500; dan peran ADMIN demo belum memegang `role.manage` yang baru diperkenalkan gelombang ini, sehingga pembacaan opsi mengembalikan 403. Keduanya diperbaiki dengan menerapkan migrasi dan menjalankan `npm run sync-permissions -w apps/api` (175 hibah baru). Database pembangunan itu perlu `--check-order false` karena urutan migrasinya sudah terbalik sejak sebelumnya; database segar diurutkan per nama berkas dan tidak terpengaruh.

**Dasar design system Epic 13 dipasang lebih awal pada gelombang ini**, karena shell Admin Console adalah tempat pertama token dipakai: token warna, densitas (`--row 32px`, `--control 28px`, `--radius 3px`), dan tipografi angka tabular kini lengkap untuk terang **dan** gelap di `apps/web/src/index.css`, dipakai lewat nama semantik di Tailwind (`bg-panel`, `text-ink-dim`, `border-line`). Sakelar tema tersedia dan pilihannya tersimpan di `abixell.theme.v1`. Bawaan yang dikirim tetap **terang**; membalik bawaan ke gelap adalah perubahan satu baris setelah halaman modul lain ikut bermigrasi.

**Gelombang 1 langkah 11b selesai 2026-09-27 — penegakan baca-saja per Window.** Yang dibangun, dan keputusan yang mengikat:

| Bagian | Wujudnya |
|---|---|
| Pemetaan eksplisit (§4.4 langkah 11b) | `apps/api/src/domain/configuration/window-enforcement.ts` memegang `WINDOW_RULES`: setiap route penulis dipetakan ke `windowCode` dari Window kamus. Pencocokan **hanya menerima pola route Fastify** (`request.routeOptions.url`, mis. `/assets/:id`), tidak pernah URL kongkret: URL kongkret (`/assets/3f2a`) akan diam-diam jatuh ke Window induk dan mengunci halaman yang salah. |
| Titik penegakan | `registerWindowAccessEnforcement` di `apps/api/src/interfaces/http/plugins/window-access-plugin.ts` menyisipkan `preHandler` lewat `addHook("onRoute", …)` sehingga pemeriksaan berjalan **setelah** `app.authenticate` mengisi `request.actor`. Urutan registrasi di `app.ts:128` lalu `:135` menetapkan gerbang modul-aktif lebih dulu, gerbang Window kedua. |
| Keputusan | `evaluateWindowWriteAccess` berjalan berurutan: (1) metode bukan penulis → izinkan; (2) tidak ada aturan yang mengklaim path → izinkan; (3) Role tidak pernah dikonfigurasi untuk Window itu → izinkan; (4) Window terkonfigurasi dan seluruh assignment efektif read-only → 403 `Peran Anda hanya berhak membaca pada halaman ini.` |
| Union allow | ~~Satu baris assignment efektif dengan `is_read_write = true AND is_active = true` sudah cukup membuka tulis.~~ **Digantikan Epic 1 (2026-09-28, §4.1 C):** gerbang membaca hanya assignment aktif — Role read-only aktif menolak tulis walau user memegang Role writable lain; switch-role membukanya kembali. |
| Baca tetap terbuka (§4.4) | GET/HEAD/OPTIONS tidak pernah diblokir, apa pun isi Window. Role read-only **tetap dapat membuka** halamannya; yang ditolak hanya tulisnya, dan ditolak di server, bukan dengan menyembunyikan tombol. |
| Tanpa pengecualian platform | Berbeda dari gerbang modul-aktif, gerbang Window tidak mengecualikan `platform`. Kunci Window bersifat per Role dan dapat dicabut oleh Role lain; pengecualian akan membuat `route:/admin` dekoratif justru bagi Role yang paling mungkin kelebihan wewenang. |
| Tidak ada fallback diam-diam (§4.4) | Route tanpa aturan **lolos**, bukan dikunci: "belum dipetakan" bukan klaim yang sama dengan "hanya-baca". Konsekuensinya route tak terpetakan tidak terlihat, jadi jumlahnya dihitung uji, bukan diandaikan. |
| Cakupan terukur | 909 route yang benar-benar dilayani; 340 di antaranya penulis. Pemetaan menutup **334 route penulis ke 47 Window**. Enam sisanya dikecualikan eksplisit di `WINDOW_ENFORCEMENT_EXEMPTIONS` — tiga prefiks (`/auth`, `/documents`, `/integration/webhook`), masing-masing dengan sifat yang membuat pemetaan tidak mungkin, bukan sekadar belum dikerjakan. Nol route tak terhitung. |
| Sensus, bukan konstanta | `enforcementStatus` tidak lagi dibaca dari daftar celah, melainkan dari **sensus route yang server benar-benar deklarasikan**: hook `onRoute` yang sama yang memasang gerbang memanggil `registerServedMutatingRoute` untuk tiap route penulis, mencatatnya sebagai `governed`, `exempt`, atau `unaccounted`. Angka itu tidak dapat melenceng dari kenyataan, karena tidak ada tempat kedua yang menyimpannya. |
| Pengecualian yang dapat difalsifikasi | Tiap entri membawa `property` yang menentukan kelayakannya. `unauthenticated` **diuji terhadap deklarasi route itu sendiri**: route yang membawa `app.authenticate` ditolak sebagai pengecualian, karena ia punya actor dan karenanya seharusnya dapat dipetakan. `window-from-request` menuntut arah sebaliknya — actornya ada, Window-nya yang berasal dari body — sehingga kedua sifat itu tidak dapat dipertukarkan diam-diam. |
| Status jujur dua arah | `enforcementStatus` kini bacaan, bukan pernyataan: `"enforced"` selama tidak ada route penulis yang tak terhitung, dan kembali `"partial"` begitu ada satu saja yang muncul tanpa aturan dan tanpa pengecualian. Layar Role menampilkan pita yang sesuai dengan nilai itu. |
| Window Role Definition | Migrasi `1788100000000_epic-4-wave-1-role-definition-route-window.cjs` menambahkan `route:/admin/roles/:roleCode` ke `config_route_window_seed()`. Rute itu sudah ada di `App.tsx` tetapi tidak ada di kamus, yang dilaporkan dua uji sebagai drift; komposisinya sama dengan `1788000000000` (fungsi lama dinamai ulang, nama kanonis didefinisikan ulang sebagai gabungan `UNION`). Tidak ada permission baru, tidak ada baris `role_permissions`. |
| Bukti | `apps/api/tests/window-enforcement-unit.test.ts` (32 lulus, matriks aturan plus sensus tanpa DB) dan `apps/api/tests/window-enforcement-coverage.test.ts` (8 lulus, enumerasi route yang benar-benar dilayani lewat `onRoute` dan gagal di **empat** arah: route tak terhitung, sensus yang tidak sepakat dengan permukaan nyata, pengecualian basi, dan pengecualian yang sifatnya dibantah deklarasi route itu sendiri). End-to-end: `apps/api/tests/integration/window-enforcement.test.ts` pada `abixell_one_epic3_wave4`, 9 dari 9 — termasuk baca yang tetap 200 pada Window read-only, header `x-window-code` karangan browser yang diabaikan, union allow, kontrol positif penulis, dan gerbang modul yang mendahului gerbang Window. |

**Penutupan celah 11b pada hari yang sama.** Gelombang ini semula meninggalkan enam prefiks pipa platform sebagai celah dan membuat `enforcementStatus` berbunyi `"partial"`. Enam itu ternyata bukan satu jenis. Empat di antaranya — `/auth/login`, `/auth/refresh`, `/auth/logout`, dan `/integration/webhook/:tenantCode/:endpointCode` — tidak punya actor sama sekali, sehingga aturan Window di sana tidak akan pernah dieksekusi: gerbangnya berhenti lebih dulu di `if (!actor) return`. Yang tersisa punya actor **dan** halaman yang menaikkannya: `SharedServicesPanel` memanggil `/notifications/*`, `/scheduler/jobs`, dan `/integration/endpoints` dari dalam `/administration`; `WorkflowPanel` memanggil setiap route runtime `/workflow/*` dari tempat yang sama; definisi workflow adalah permukaan console, dibaca `/admin/workflows`. Keenam prefiks itu kini dipetakan per sub-prefiks, dan yang benar-benar tidak dapat dipetakan tinggal tiga, masing-masing dengan sifatnya di `WINDOW_ENFORCEMENT_EXEMPTIONS`.

`/documents` tetap di luar pemetaan meski actornya ada, dan alasannya yang membuat baris gate ini berbeda dari sekadar "belum dikerjakan": Window sebuah lampiran adalah sifat dari entitas yang ditumpanginya (`entityType`/`entityId` di body multipart), lintas modul. Menurunkannya di server tetap berarti membiarkan browser memilih kuncinya — persis yang dilarang §4.4. Karena itu ia masuk pengecualian dengan sifat `window-from-request`, bukan dipetakan ke Window tebakan.

Konsekuensinya `enforcementStatus` berbunyi `"enforced"` — dan itu benar dalam arti yang dapat diperiksa: **setiap** route penulis yang server layani entah dikunci sebuah Window atau dikecualikan dengan sifat yang dapat difalsifikasi. Uji cakupan yang menegakkannya, bukan kalimat ini.

**Gelombang 2 — User dan assignment internal**

11. Create User dengan data dasar dan assignment awal opsional.
12. User-centric access management dari detail user.
13. Assignment-centric list lintas user.
14. Multi-assignment selection dengan satu preview dan satu konfirmasi.
15. Scope picker tenant dan organization unit/site; descendant mengikuti hirarki.
16. Visibility server-side: user di luar scope tidak pernah masuk payload.

**Gelombang 3 — Revocation dan audit history**

17. Migration status revoked yang terpisah dari `scope_invalidated_at`.
18. Revoke assignment tanpa menghapus row historis.
19. Authorization-effective view mengecualikan revoked/invalidated assignment.
20. Riwayat user menampilkan status, waktu, actor, alasan, role, dan scope.
21. Audit before/after untuk role, permission, assignment, dan pencabutan.

**Gelombang 4 — Module feedback dan hardening**

22. Notifikasi konsisten untuk permission dari modul inactive.
23. Error yang membedakan permission kurang, module inactive, target di luar scope, dan assignment tidak valid.
24. Regression test untuk Super Admin, Admin Tenant tenant-wide, Admin Tenant region, dan user tanpa assignment.
25. Uji dua permukaan assignment agar policy dan hasilnya identik.

**Gelombang 2 UI, Gelombang 3, dan Gelombang 4 selesai 2026-09-28 — Epic 4 tuntas sampai UI/UX.** Yang dibangun, dan keputusan yang mengikat:

**Gelombang 2 — UI dua permukaan**

| Bagian | Wujudnya |
|---|---|
| User-centric access management (§4.4 langkah 12) | `AdminUsersView.tsx` detail user dengan blok assignment per role+scope, state per baris (`active`/`revoked`/`invalidated`/`unavailable`), dan dialog revoke dengan alasan wajib. Overlay dialog tetap inert dan stacked; `inFlight` ref guard mencegah submit ganda. |
| Assignment-centric inventory (§4.4 langkah 13) | `AdminAssignmentsView.tsx` — kolom State dan kolom Revoked (waktu + alasan) memakai label yang sama dengan permukaan Users: satu kebijakan, satu label, dua layar. |
| Create user + batch (§4.4 langkah 11, 14) | Create user dengan assignment awal opsional; multi-assignment lewat preview + konfirmasi tunggal yang sama dengan API-nya. |
| Scope picker (§4.4 langkah 15–16) | Tenant dan Organization Unit; visibility server-side — user di luar scope tidak pernah masuk payload, UI hanya menyembunyikan sebagai kenyamanan. |

**Gelombang 3 — revocation dan audit history (langkah 17–21)**

| Bagian | Wujudnya |
|---|---|
| Migrasi (langkah 17) | `1788200000000_epic-4-wave-3-assignment-revocation.cjs`: tiga kolom `revoked_at`, `revoked_by` (tanpa FK, sama dengan `created_by` — provenance harus bertahan melewati penghapusan User, dan FK akan merusak tenant-cascade cleanup), `revoke_reason`. Unique index exact-assignment dibangun ulang sebagai partial index `WHERE revoked_at IS NULL AND scope_invalidated_at IS NULL`, sehingga re-grant setelah revoke adalah baris baru, bukan kebangkitan. Trigger dibuat ulang agar `revoked_at` monoton — UPDATE tidak dapat menghapus atau menulis ulang provenance revoke. |
| Route revoke (langkah 18) | `POST /admin/users/:userId/role-assignments/:assignmentId/revoke` dengan alasan wajib 1–500 karakter (`.strict()` Zod). Baris dipertahankan; revoke kedua 409. Guard: self-revoke 409, final active tenant manager 409, target di luar visibility 404 (tidak dapat dibedakan dari tidak ada). |
| View authorization (langkah 19) | `authorization_effective_user_role_assignments` mengecualikan `revoked_at IS NOT NULL`; permission hilang pada check berikutnya tanpa logout. |
| Riwayat user (langkah 20) | Kedua permukaan memproyeksikan `assignmentState` + `revokedAt`/`revokedBy`/`revokeReason`/`assignedAt`/`assignedBy`. Precedence lifecycle: `revoked` > `invalidated` > `unavailable` > `active` — revoke manual dan invalidasi sistem adalah dua event berbeda dengan provenance berbeda. `roleState` tetap menggambarkan baris Role itu sendiri; hanya `scopeState` dan `assignmentState` yang melipat revocation. |
| Audit (langkah 21) | Action `user.role_revoked` (menggantikan `user.role_removed`), metadata = identitas legacy + `before`/`after` snapshot lifecycle + `reason` + `assignmentId`. INSERT RETURNING jalur tulis diperluas `created_at, created_by` agar payload 201 dan GET identik; `toIsoStringOrNull()` menormalkan Date pg ke ISO string. |

**Gelombang 4 — module feedback dan hardening (langkah 22–25)**

| Bagian | Wujudnya |
|---|---|
| Notifikasi modul inactive (langkah 22) | Jalur single-assignment (`createGovernedRoleAssignment`) dan jalur batch (`resolveAssignmentBatch`) menghasilkan kalimat yang identik: `Role '<code>' needs module '<m>' which is not active for this tenant`. Diuji equality literal antar kedua route. |
| Empat penolakan terbedakan (langkah 23) | Permission kurang = 403 dengan alasan permission; modul inactive = 400 dengan alasan modul; delegation = 400 dengan alasan ceiling; target di luar Data Scope = 404 yang tidak berbeda dari User tidak ada; Role/scope tidak valid = 404 dengan nama entitas. |
| Regression matrix (langkah 24) | Tenant-wide manager, region (OU-scoped) manager, dan user tanpa assignment: matriks diuji pada kedua permukaan. |
| Dua permukaan satu kebijakan (langkah 25) | **Cacat nyata ditemukan dan diperbaiki saat pengujian ini**: dua lookup target jalur tulis (`createGovernedRoleAssignment` dan `resolveAssignmentBatch`) belum memfilter `revoked_at IS NULL`, sehingga grant OU yang telah dicabut masih memberi jangkauan tulis sementara jalur baca sudah mengecualikannya. Ketiga lookup target kini konsisten (grant, batch, revoke, baca). Uji identitas permukaan membandingkan set baris per target antara `/admin/users/:id/access` dan `/admin/assignments`. |

**Penutupan 2026-09-28 — item terbuka 1, 2, 4, dan kamus rute.** Empat migration: `1788300000000` (kolom `roles.description`, NULL atau ≤500 karakter, dikecualikan dari preview hash tapi menaikkan versi), `1788400000000` (`roles.is_active` + predicate JOIN pada view `authorization_effective_user_role_assignments`), `1788500000000` (trigger `enforce_customer_scope_exclusivity` + katalog feature flag `customer_scope_full_permission_set`), `1788600000000` (kamus rute `active-state`), dan `1788700000000` (kamus tujuh rute Waves 2–3 — assignment-options, assignments, access, POST users, assignment-batches, assignment-previews, revoke — plus penghapusan baris kamus `api:DELETE .../role-assignments/:assignmentId` untuk rute DELETE yang sudah pensiun saat Wave 3 menggantinya dengan POST revoke beralasan; `dictionary-seed-parity` kini hijau penuh). Uji setelah penutupan: `role-definition.test.ts` 18/18, `admin-access-management.test.ts` 32/32, `dictionary-seed-parity.test.ts` 7/7. Item terbuka 4 dikunci atomic all-or-nothing tanpa perubahan kode; tabel risiko dan bagian C.3 mengikuti.

**Bukti Gelombang 3–4** (semua pada database terisolasi `abixell_one_epic3_wave4`):
`tests/integration/epic4-wave3-revocation.test.ts` 10/10 — retensi baris + provenance, permission hilang pada check berikutnya, proyeksi revoked di kedua permukaan, audit before/after tunggal, double-revoke 409, re-grant baris baru dengan id berbeda, alasan wajib + batas 500 + strict, out-of-scope/foreign 404, gerbang permission ganda (403 tanpa `admin.console.read` maupun tanpa `user.role.manage`), trigger monoton (UPDATE mencoba menghapus provenance tetap ditolak), self-revoke dan final-manager 409. `tests/integration/epic4-wave4-hardening.test.ts` 9/9 — parity pesan modul inactive antar route, empat penolakan terbedakan, matriks regresi tiga aktor, identitas dua permukaan, dan revoked-OU-grant tidak lagi memberi jangkauan tulis di grant/batch/preview. `tests/integration/admin-access-management.test.ts` 31/31 setelah perubahan, `role-definition.test.ts` 14/14, `window-enforcement.test.ts` 9/9. `tsc --noEmit` bersih di `apps/api` dan `apps/web`.

#### Serah terima dari Epic 3

| # | Kebutuhan Epic 4 | Kontrak yang harus disediakan Epic 3 |
|---|---|---|
| 1 | Role memilih Window, Process, Reporting, dan fungsi sesuai kebutuhan | Setiap objek terdaftar di kamus dan memiliki `module_id` yang sah |
| 2 | Permission dibatasi modul aktif | API menyediakan status activation yang dapat divalidasi server, bukan hanya menu |
| 3 | Notifikasi modul inactive | Error contract membedakan inactive module dari missing permission |
| 4 | User eksternal tidak menerima menu internal | Penanda whitelist `is_external_allowed` tersedia; keputusan customer scope tetap di Service Operation |
| 5 | Role dapat menunjukkan fungsi yang akan tampil | Korelasi menu ↔ module ↔ Window/Process tersedia |

#### Di luar cakupan Epic 4

- Menentukan use case, data visibility, dan aturan delegasi customer scope. Ini menjadi session wawancara terpisah karena customer scope akan menjadi transaksi dalam modul **Service Operation**.
- Portal customer atau UI eksternal.
- Workflow approval, nominal approval, SoD, dan eskalasi; lihat Epic 1 dan Epic 9.
- Document engine dan lifecycle; lihat Epic 7.
- Menu sebagai security boundary; ditolak sesuai prinsip Epic 3.
- Penentuan final model server-side session dan active role; lihat Epic 1.
- Penghapusan data user secara permanen dan kebijakan retensi audit.
- Bulk assignment lintas tenant.

#### Session terpisah: Customer Scope untuk Service Operation

Customer scope tidak dianggap selesai hanya karena kolom dan authorization helper sudah ada. Sebelum UI dibuka, session terpisah harus mengunci enam pertanyaan berikut:

1. Siapa pemakai customer scope: internal, eksternal, atau keduanya?
2. Data apa yang dapat terlihat per modul Service Operation?
3. Data apa yang tetap tertutup walaupun user memiliki role yang sama?
4. Siapa yang boleh memberi customer scope: Super Admin, Admin Tenant, atau keduanya dengan delegation boundary?
5. Kapan akses dicabut saat hubungan dengan customer berakhir, siapa pelakunya, dan bagaimana auditnya?
6. Apakah customer scope boleh dimiliki bersamaan dengan tenant atau organization-unit scope?

**Wawancara selesai 2026-09-28 — enam pertanyaan terkunci.**

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Siapa pemakai customer scope | **Eksternal saja.** Hanya Customer User portal. User internal memakai tenant atau organization-unit scope plus permission modul; customer scope bukan cara memberi akses kepada staf. |
| 2 | Data apa yang terlihat per modul Service Operation | **Default baca saja: `service_operations.read` dan `optimization.read` dari delapan permission modul.** Enam sisanya (`execute`, `verify`, `manage`, `configure`, `pack.manage`, `optimization.apply`) ditolak saat grant, dengan bentuk penolakan yang sama seperti permission di luar delegation ceiling. **Set penuh tetap disiapkan sebagai opsi** yang dapat dibuka Admin Tenant dan Super Admin lewat batas role; keputusan membukanya milik pemilik produk, bukan disimpulkan dari default. |
| 3 | Data apa yang tetap tertutup walaupun user memiliki role yang sama | **Permukaan internal tertutup.** Daftar tetap: catatan internal (`customers.notes`), audit trail dan riwayat perubahan, baris customer lain, direktori staf internal, dan data modul lain (finance, hse, dan seterusnya). Penegakan di query server, bukan penyembunyian di React; penolakan berbentuk 403/404 mengikuti aturan out-of-scope yang sudah berjalan. |
| 4 | Siapa yang boleh memberi customer scope | **Admin Tenant.** Guard sama seperti assignment internal: `admin.console.read` plus `user.role.manage` pada grant tenant-scope, ditambah delegation ceiling. Super Admin memakai jalur yang sama dengan authority lebih tinggi. |
| 5 | Kapan akses dicabut, siapa pelakunya, bagaimana auditnya | **Manual plus penjaring sistem.** Jalur resmi: Admin Tenant mencabut lewat UI Gelombang 3 (`revoked_at`, `revoked_by`, `revoke_reason`, audit `user.role_revoked`), sehingga audit selalu memiliki pelaku bernama dan alasan. Penjaring: bila customer dihapus lebih dulu, trigger `enforce_role_assignment_scope_invalidation` menandai `scope_invalidated_at` seperti sekarang. Tidak ada jalur backend baru. |
| 6 | Apakah customer scope boleh dimiliki bersamaan dengan tenant atau organization-unit scope | **Tidak boleh.** Satu user tidak boleh memegang customer scope dan tenant atau organization-unit scope sekaligus. **Ditegakkan di database lewat trigger `enforce_customer_scope_exclusivity` (BEFORE INSERT OR UPDATE, hanya baris hidup — `revoked_at IS NULL AND scope_invalidated_at IS NULL`), bukan hanya validasi aplikasi.** Partial unique index tidak bisa menyatakan aturan ini: index pada `user_id` yang dibatasi ke baris customer akan melarang dua assignment customer untuk satu user (bukan aturannya), dan index `(user_id, is_customer)` akan melarang dua assignment internal (kejadian biasa yang sah). |

**Implementasi 2026-09-28 (migration `1788500000000`):** aturan campur scope (baris 6) dan plafon permission customer (baris 2) sudah dibangun. Yang tertunda hanya daftar tetap permukaan internal (baris 3), karena belum ada query customer-facing untuk dipasangi filter — modul Service Operation belum ada. Pekerjaan itu dicatat sebagai **deliverable wajib modul Service Operation**, bukan sebagai item Epic 4.

Dua aturan yang sudah dibangun:

- **Campur scope** — trigger `enforce_customer_scope_exclusivity` di `user_role_assignments`. Kedua arah (customer pada user internal, dan sebaliknya) ditolak dengan error code `23514` bertanda constraint `user_role_assignments_scope_exclusivity_check`; repository menambahkan pre-check yang menghasilkan 409 dengan pesan yang sama, sehingga klien tidak bisa membedakan mana yang menolak. Row yang di-revoke atau di-invalidate tidak ikut berkonflik — row yang tidak memberi akses tidak bisa berkonflik.
- **Plafon permission customer** — allowlist default `{service_operations.read, service_operations.optimization.read}` dari delapan permission modul Service Operation; enam sisanya ditolak saat grant dengan pesan yang menyebut kedua permission yang diizinkan. Pembukaan set penuh lewat feature flag `customer_scope_full_permission_set` (`default_enabled = false`, override per tenant lewat surface `config.manage` yang sudah ada), sehingga pemilik produk dapat membukanya tanpa migration. Plafon hanya mengikat modul Service Operation; permission modul lain (`customer.read`, `contract.read`, `project.read`, `site.read`, `service.read`) tidak dibatasi.

#### Keputusan item terbuka terkait (2026-09-28)

| # | Item terbuka | Keputusan |
|---|---|---|
| 1 | Field metadata role yang boleh diedit tenant | **`name` dan `description`.** `code` tetap karena dipakai di pesan error dan audit; daftar permission diubah lewat jalur terpisah yang sudah ada. **Diimplementasi 2026-09-28** (migration `1788300000000`, field form create/copy dan editor definisi; description dikecualikan dari preview hash tapi menaikkan versi). |
| 2 | Role ber-assignment boleh di-deactivate atau tidak | **Tidak boleh selama masih ada assignment hidup.** Permintaan di-deactivate ditolak dengan pesan yang menyebut jumlah assignment, mengikuti bentuk guard delete role yang sudah ada. **Diimplementasi 2026-09-28** (migration `1788400000000`, route `active-state` dengan kamus `1788600000000`). |
| 4 | Batch assignment gagal seluruhnya atau partial success | **Atomic all-or-nothing.** Gagal satu pasangan membatalkan seluruh batch; satu governed transaction, satu hasil, satu audit batch. **Dikunci 2026-09-28; implementasi sudah sesuai tanpa perubahan kode.** |
| 5 | Retensi dan akses ke riwayat assignment revoked | **Disimpan selamanya** sampai Epic 10 menetapkan kebijakan retensi artefak yang berlaku untuk semua tabel riwayat, termasuk tabel ini. Tidak ada migration retensi dan tidak ada purge terjadwal sekarang. |

Sampai session itu selesai:

- backend customer scope tetap dipertahankan;
- permission dan scope customer tidak dihapus dari model;
- UI Epic 4 tidak menawarkannya kepada Admin Tenant;
- menu/transaksi Service Operation yang memerlukan customer scope tetap mengikuti default tertutup;
- keputusan customer scope tidak boleh ditebak dari kebutuhan internal tenant.

Status: **Wawancara selesai 2026-09-28 — enam keputusan terkunci di atas.** Dua dari tiga pekerjaan backend tercatat sudah dibangun 2026-09-28 (trigger campur scope, plafon permission customer plus feature flag-nya); yang tertunda hanya filter permukaan internal, karena belum ada query customer-facing untuk dipasangi filter. Batasan yang masih berlaku: UI Epic 4 (jalur batch) tetap tidak menawarkan customer scope sampai modul Service Operation dibuka, dan default set permission tetap tertutup.

#### Item terbuka Epic 4

| # | Item | Perlu |
|---|---|---|
| 1 | ~~Field metadata role yang boleh diedit tenant selain code, nama, dan permission~~ **Selesai dan diimplementasi 2026-09-28:** `name` dan `description` boleh diedit tenant; `code` tetap; permission lewat jalur terpisah. Migration `1788300000000` menambah kolom `roles.description` (NULL atau ≤500 karakter) dan field textarea description ada di form create/copy serta editor definisi; description dikecualikan dari preview hash (perbaikan typo tidak membatalkan preview yang disetujui) tetapi perubahan description saja tetap menaikkan versi. | Keputusan saat desain kamus Epic 2/eksekusi Epic 4 |
| 2 | ~~Apakah role yang masih memiliki assignment boleh di-deactivate tanpa revoke semua assignment~~ **Selesai dan diimplementasi 2026-09-28:** tidak boleh selama masih ada assignment hidup; permintaan ditolak dengan pesan yang menyebut jumlah assignment. Migration `1788400000000` menambah `roles.is_active`, predicate `r.is_active` masuk JOIN (bukan WHERE) view `authorization_effective_user_role_assignments`, dan route `POST /admin/roles/:roleCode/active-state` (dictionary row `1788600000000`) menjadi jalur lifecycle-nya; Role nonaktif tidak bisa di-grant, dan penonaktifan berlaku pada permission check berikutnya tanpa logout. | Keputusan lifecycle role sebelum implementasi |
| 3 | ~~Bentuk alasan pencabutan dan apakah wajib untuk semua revoke~~ **Selesai 2026-09-28 (Gelombang 3):** alasan wajib, teks bebas 1–500 karakter, ditolak bila kosong/lewat batas/membawa kunci asing (`.strict()`); alasan masuk metadata audit `user.role_revoked`. Keputusan berlaku untuk permukaan assignment Epic 4. | Keputusan audit/lifecycle sebelum Gelombang 3 |
| 4 | ~~Apakah batch assignment gagal seluruhnya atau boleh partial success~~ **Selesai dan dikunci 2026-09-28: atomic all-or-nothing.** Gagal satu pasangan role+scope membatalkan seluruh batch; satu governed transaction, satu hasil, satu audit batch. Implementasi sekarang sudah begini (satu multi-row INSERT di `rbac.repository.pg.ts`, konflik satu pasangan membatalkan semuanya, `23505` sebagai backstop race), jadi tidak ada pekerjaan kode; keputusan ini hanya mengunci status quo. | Keputusan transaksi sebelum implementasi bulk |
| 5 | ~~Retensi dan akses ke riwayat assignment revoked~~ **Selesai 2026-09-28:** disimpan selamanya sampai Epic 10 menetapkan kebijakan retensi artefak yang berlaku untuk semua tabel riwayat. Tanpa purge terjadwal sekarang. | Epic 10/audit policy, sebelum production |
| 6 | ~~Enam aturan customer scope untuk Service Operation~~ **Selesai 2026-09-28:** enam keputusan terkunci pada tabel wawancara di atas (eksternal saja; default baca dua permission dengan opsi set penuh; permukaan internal tertutup; Admin Tenant pemberi; manual plus penjaring sistem; tidak boleh campur scope). Dua aturan yang bisa dibangun tanpa query customer-facing sudah diimplementasi lewat migration `1788500000000`. **Sisa yang wajib: filter permukaan internal** (catatan internal, audit trail, baris customer lain, direktori staf internal) di setiap query customer-facing — tidak ada query seperti itu sampai modul Service Operation ada, jadi pekerjaan ini dicatat sebagai deliverable wajib modul tersebut. | Session terpisah; belum boleh diputuskan di Epic 4 |
| 7 | ~~Perilaku customer scope bila user memiliki scope internal bersamaan~~ **Selesai 2026-09-28:** terjawab oleh keputusan 6 — tidak boleh dimiliki bersamaan, ditegakkan di database lewat trigger `enforce_customer_scope_exclusivity`. | Session terpisah; jangan disimpulkan dari helper backend saat ini |

#### Strategi mitigasi risiko Epic 4

| Risiko | Dampak | Mitigasi wajib | Bukti selesai |
|---|---|---|---|
| Admin melihat atau mengubah user di luar scope | Kebocoran data dan privilege escalation | Filter visibility di repository dan policy server; jangan mengandalkan filter React | Integration test memastikan target di luar scope tidak muncul dan mutation ditolak |
| Admin memberi permission lebih tinggi dari authority sendiri | Admin Tenant dapat membuat jalur privilege escalation | Hitung delegation ceiling pada backend dari assignment actor yang sama | Test mencoba grant permission/scope di atas actor dan mendapat 403 |
| Permission dan scope berasal dari assignment berbeda | User mendapat authority gabungan yang tidak pernah diberikan | Semua mutation dan check memakai same-assignment policy | Test dua assignment silang ditolak |
| Modul inactive masih dapat dipilih | Role terlihat valid tetapi membuka fungsi yang tenant matikan | Modul menjadi plafon di picker dan API; inactive menghasilkan error khusus | Test UI dan API menunjukkan notifikasi inactive module dan request ditolak |
| Copy Role menyalin user secara diam-diam | Banyak user menerima akses baru tanpa review | Salin role_permissions dan batasan saja; assignment selalu kosong | Test hasil copy memiliki nol assignment baru |
| Edit role langsung mengubah banyak user tanpa pemahaman | Gangguan operasi dan privilege tak terduga | Impact preview, versi definisi, konfirmasi eksplisit, audit before/after | Test preview menghitung affected users dan diff permission |
| Revoke menghapus histori | Investigasi dan audit kehilangan konteks | Soft revoke row; pisahkan dari scope invalidation; audit append-only | Riwayat user menampilkan revoked assignment lengkap |
| Batch assignment hanya sebagian berhasil tanpa diketahui | User mendapat akses tidak lengkap atau salah | Satu governed transaction, satu hasil, satu audit batch — dikunci 2026-09-28 (item terbuka 4) | Test kegagalan satu item membatalkan batch sesuai keputusan |
| User baru menerima akses default tak disengaja | Akses terbuka sebelum review | Default tanpa assignment; assignment awal hanya eksplisit | Test create user tanpa assignment menghasilkan effective access kosong |
| Customer scope dibuka terlalu dini | Data customer atau menu eksternal terbuka tanpa policy | Feature gate UI; session Service Operation wajib selesai lebih dulu | Test Admin Tenant tidak melihat opsi customer scope |
| Dua permukaan UI memiliki aturan berbeda | Admin dapat melewati batas lewat halaman lain | Satu application service/policy dipakai Users dan Assignment List | Test mutation melalui dua route menghasilkan keputusan sama |

#### Gate sebelum Epic 4 dinyatakan selesai

- Super Admin dapat membuat, menyalin, mengubah, dan menghapus role yang memenuhi guardrail.
- Admin Tenant hanya melihat target dalam scope dan tidak dapat memperluas otoritasnya sendiri.
- Permission picker hanya menampilkan fungsi dari modul aktif; modul inactive menghasilkan notifikasi yang jelas.
- **(11a — terpenuhi)** Role dapat dikonfigurasi per Window: picker menyimpan `is_read_write` per `window_code` dari Window kamus yang terdaftar. Definisi Role tidak lagi mengembalikan literal `not_enforced`; ia mengembalikan status turunan dari pemetaan API Resource → Window.
- **(11b — terpenuhi)** Role dapat dikunci per Window: role dengan `is_read_write = false` **tetap dapat membuka** Window-nya, tetapi setiap permintaan tulis (POST/PUT/PATCH/DELETE) ditolak server dengan 403 — bukan sekadar tombol yang disembunyikan. Setiap route penulis yang server layani kini terkunci sebuah Window; yang tidak dapat dikunci terdaftar eksplisit beserta sifat yang membuatnya demikian, dan `enforcementStatus` membaca daftar itu dari sensus route, bukan dari konstanta.
- **(11b — terpenuhi)** `window_code` pada keputusan enforcement selalu berasal dari resolusi route di server, tidak pernah dari nilai yang dikirim browser. Diuji dengan header `x-window-code` karangan klien: resolusi tetap mengikuti pola route.
- **(11a + 11b — hijau)** Dari 340 route penulis yang server layani, 334 terkunci sebuah Window (47 Window kamus, 14 modul) dan 6 sisanya terdaftar di `WINDOW_ENFORCEMENT_EXEMPTIONS` dengan sifat yang dapat difalsifikasi — tiga di antaranya dibuktikan uji benar-benar tanpa actor, dan satu (`/documents`) karena Window-nya berasal dari body, bukan dari route. Nol route tak terhitung, jadi `enforcementStatus` berbunyi `"enforced"`. Pengecualian yang menyelinap demi menghindari pemetaan akan gagal: uji menolak entri ber-`unauthenticated` yang route-nya ternyata membawa `app.authenticate`.
- Copy Role tidak membawa user atau assignment.
- Edit Role menampilkan jumlah user terdampak dan diff permission sebelum commit.
- User dapat dibuat tanpa assignment.
- User dapat diberi beberapa role+scope sekaligus dengan satu preview dan satu konfirmasi.
- Assignment dapat dikelola dari halaman Users dan halaman assignment lintas user dengan policy yang sama. **(terpenuhi 2026-09-28, Gelombang 2 UI + Gelombang 4 step 25)** — satu service, satu repository, satu set lifecycle field; uji identitas membandingkan set baris antar permukaan, dan cacat lookup tulis yang belum memfilter revoked ditemukan dan diperbaiki oleh uji itu.
- Organization unit assignment menghormati parent/descendant boundary.
- Revoke menghentikan effective access pada check berikutnya tanpa logout, tetapi histori tetap terlihat. **(terpenuhi 2026-09-28, Gelombang 3)** — uji 10/10 termasuk trigger monoton dan re-grant sebagai baris baru.
- Audit mencatat actor, target, role, scope, before/after, waktu, dan alasan bila diwajibkan. **(terpenuhi 2026-09-28, Gelombang 3)** — `user.role_revoked` membawa before/after lifecycle, alasan wajib, dan assignmentId.
- Customer scope tetap tertutup pada UI Epic 4 sampai session Service Operation menghasilkan keputusan lengkap.
- Test dijalankan pada database terisolasi, bukan `abixell_one_dev`.

**Epic 4 dinyatakan selesai sampai UI/UX pada 2026-09-28.** Gelombang 1 (langkah 5–11b), Gelombang 2 (langkah 11–16 beserta UI dua permukaan), Gelombang 3 (langkah 17–21), dan Gelombang 4 (langkah 22–25) seluruhnya dibangun, diuji, dan tercatat. Wawancara customer scope dan seluruh item terbuka (1–7) juga selesai 2026-09-28 — setiap keputusan terkunci di tabel di atas, dan pekerjaan implementasi yang lahir darinya sudah dibangun (migration `1788300000000`–`1788700000000`). Sisa satu-satunya bukan pekerjaan Epic 4: filter permukaan internal pada query customer-facing, yang menunggu modul Service Operation dan sudah dicatat sebagai deliverable wajib modul itu.

#### Catatan implementasi terhadap kondisi saat ini

Fondasi yang sudah ada mendukung sebagian besar arah ini:

- `RbacService` sudah memisahkan permission dari Data Scope dan menyediakan pemeriksaan hierarki organization unit (`apps/api/src/application/rbac/rbac.service.ts:52-115`).
- Customer context scope sudah memiliki helper terpusat (`apps/api/src/application/rbac/rbac.service.ts:169-229`), tetapi keberadaan helper bukan keputusan bisnis untuk membuka UI.
- Governed assignment mutation sudah memeriksa authority tenant-scoped dan menulis audit (`apps/api/src/infrastructure/persistence/repositories/rbac.repository.pg.ts:564-633`).
- Read model admin sudah membedakan role/scope available dan unavailable.
- Alur remove saat ini masih menghapus row assignment (`apps/api/src/infrastructure/persistence/repositories/rbac.repository.pg.ts:520-525`), sehingga Gelombang 3 wajib mengubah lifecycle tersebut sebelum gate histori dianggap lulus.

Catatan ini adalah pemetaan kondisi dan target roadmap, bukan persetujuan untuk langsung mengubah kode. Implementasi tetap mengikuti urutan epic dan database uji terisolasi.

---

### 4.5 EPIC 5 — Company, Tenant & Organization Profile

#### Problem statement

Struktur inti Abixell One sudah memiliki `tenants`, `legal_entities`, dan `organization_units`, tetapi masih berupa fondasi minimal. `tenants` hanya menyimpan code, name, dan status; `legal_entities` hanya name serta registration number; Organization Unit hanya name, type teks bebas, dan parent. Belum ada profile legal lengkap, lifecycle yang menjaga histori, address bertipe, Department sebagai dimensi reporting, versioning hierarchy bertanggal efektif, atau scope Legal Entity.

Kondisi ini membuat tiga risiko:

1. Legal Entity belum cukup untuk menjadi identitas hukum dan finansial resmi pada transaksi, invoice, tax, reporting, atau dokumen.
2. Pemindahan dan penghapusan Organization Unit dapat mengubah atau memutus pembacaan histori transaksi dan Data Scope.
3. Model akses saat ini hanya mengenal tenant, Organization Unit, dan customer. Tenant yang kelak mempunyai banyak Legal Entity tidak mempunyai scope khusus untuk memberi akses seluruh satu Legal Entity tanpa memberi akses seluruh tenant.

Epic 5 membangun **Company, Tenant & Organization Profile**, bukan portal customer, bukan employee master, dan bukan document/file management penuh. Epic ini memisahkan tiga konsep yang sering tercampur:

```text
Tenant                 = workspace dan data boundary
Legal Entity           = badan hukum di dalam Tenant
Organization Unit      = struktur operasi internal yang bersifat hierarkis
Department             = dimensi organisasi/reporting, bukan Data Scope
Customer Site/Location = lokasi milik customer, bukan Organization Unit internal
```

#### Keputusan terkunci hasil wawancara 2026-09-24

##### Putaran 1 — Struktur kepemilikan dan Organization Unit

| Topik | Keputusan | Penanda |
|---|---|---|
| Relasi Tenant dan Legal Entity | Tahap awal satu Tenant mempunyai satu Legal Entity. Model wajib siap untuk beberapa Legal Entity dalam satu Tenant pada masa depan. | Modernize |
| Batas Legal Entity | Satu Legal Entity hanya milik satu Tenant; tidak boleh dibagikan atau dipindahkan lintas Tenant. | Adopt |
| Pembuatan Legal Entity | Hanya Super Admin dapat menambah Legal Entity. | Modernize |
| Organization Unit | Dipakai untuk struktur operasional penuh: Central, Region, Internal Site/Branch, dan tingkat operasi lain yang sah. | Modernize |
| Department | Tidak menjadi Organization Unit karena akses user dapat lintas Department lewat role dan permission modul. | Modernize |
| Perubahan Tenant/legal entity/Organization Unit | Super Admin mengelola Tenant identity; Admin Tenant mengelola Legal Entity dan Organization Unit dalam Tenant sesuai permission serta batas scope. Pembuatan Legal Entity tetap hanya Super Admin. | Modernize |
| Parent Internal Site/Branch | Wajib memiliki parent; hanya root Central yang tidak memiliki parent. | Modernize |
| Delete Organization Unit | Hanya Super Admin, setelah unit inactive dan seluruh referensi diperiksa. | Modernize |

**Makna multi-tenant, multi-Legal-Entity:** platform dapat memiliki banyak Tenant; setiap Tenant pada masa depan dapat memiliki banyak Legal Entity. Ini **bukan** berarti satu Legal Entity dapat dimiliki dua Tenant.

##### Putaran 2 — Profil, Department, hierarchy, dan identitas code

| Topik | Keputusan | Penanda |
|---|---|---|
| Profil Tenant | Tenant adalah workspace/data boundary. Profil perusahaan resmi hidup di Legal Entity. | Modernize |
| Department | Master terpisah untuk employee dan reporting; bukan Data Scope dan bukan security boundary. Department boleh memiliki hierarchy ringan. | Modernize |
| User, role, dan business partner | Model User, Employee, Role, Business Partner, dan assignment dikunci di Epic 6 §4.6. Business Partner canonical berbentuk Individual atau Organization; Employee adalah role + profile dengan placement bertanggal efektif. | Resolved — §4.6 |
| Jenis Organization Unit | Jenis inti dan aturan hierarchy dikunci platform; Tenant boleh mengganti label lewat terminology yang diizinkan. | Modernize |
| Perpindahan Organization Unit | Menggunakan effective date. Transaksi lama dapat dibaca terhadap hierarchy historis; transaksi baru memakai hierarchy yang efektif pada tanggal transaksi. | Modernize |
| Code Organization Unit | UUID adalah primary key dan referensi internal. Code adalah identitas bisnis stabil, namun Super Admin dapat mengubahnya melalui proses terkendali yang menyimpan histori/alias, audit, dan dampak integrasi. | Modernize |
| Profil Legal Entity | Legal name, display/trade name, registration number, collection Tax Registrations sesuai §4.6 (bukan satu field tax ID), registered address wajib per Tax Registration aktif dan sesuai NPWP, operating address, country, timezone, base currency, email, phone, dan status. | Modernize |
| Dokumen legalitas | Epic 5 menyiapkan slot attachment dan metadata referensi. Upload, storage, versioning, expiry, approval, dan retention ditangani epic/session dokumen terpisah. Identity file slot terkait Employee/Business Partner ikut memerlukan keputusan file policy lintas Epic 5–6. | Needs interview |

##### Putaran 3 — Address, currency, timezone, dan lifecycle Legal Entity

| Topik | Keputusan | Penanda |
|---|---|---|
| Alamat Legal Entity | Multi-address bertipe: registered, operating, billing, tax, serta type lain bila diperlukan. | Modernize |
| Base currency | Boleh berbeda antar Legal Entity dalam satu Tenant. Konversi transaksi lintas mata uang tetap menjadi tanggung jawab Finance. | Modernize |
| Timezone | Tenant mempunyai default timezone. Legal Entity dan Organization Unit dapat override bila perlu. | Modernize |
| Versioning hierarchy | Riwayat parent-child Organization Unit disimpan penuh memakai effective date. | Modernize |
| Legal Entity inactive | Tidak boleh dipakai transaksi baru; transaksi lama tetap terbaca; reporting menandai entity inactive. | Modernize |

##### Putaran 4 — Legal Entity scope, root, tombstone, dan Department

| Topik | Keputusan | Penanda |
|---|---|---|
| Legal Entity Data Scope | Tambahkan scope `legal_entity`. Scope ini mencakup semua Organization Unit di Legal Entity tersebut, tetapi tidak mencakup Legal Entity lain pada Tenant yang sama. | Modernize |
| Root Central | Setiap Legal Entity wajib memiliki tepat satu root Organization Unit bernama Central. Dibuat otomatis saat Legal Entity dibuat dan tidak boleh dihapus. | Modernize |
| Pemindahan hierarchy | Super Admin mengeksekusi perubahan. Admin Tenant dapat mengusulkan, tetapi usulan tidak langsung berlaku. | Modernize |
| Unit yang pernah dipakai | Setelah inactive, Delete oleh Super Admin mengubah Organization Unit menjadi tombstone `deleted`; transaksi tetap menunjuk unit historis tersebut. | Modernize |
| Pengganti Organization Unit | Opsional. Bila merger/penggantian terjadi, simpan referensi unit pengganti. Bila penutupan total, reason tanpa pengganti cukup. | Modernize |
| Pengelolaan Department | Admin Tenant dapat mengelola Department dalam Tenant sesuai permission; Super Admin dapat mengelola semua. | Modernize |

##### Putaran 5 — Proposal, effective date, dan backdate hierarchy

| Topik | Keputusan | Penanda |
|---|---|---|
| Usulan Admin Tenant | Draft change request berisi before/after, effective date, reason, dan proposer. Super Admin review lalu publish atau reject. | Modernize |
| Waktu berlaku hierarchy | Berdasarkan effective date yang dipilih Super Admin; dapat future-dated. | Modernize |
| Backdate hierarchy | Boleh terbatas oleh Super Admin; reason dan audit khusus wajib. | Modernize |
| Assignment saat Organization Unit pindah | Mengikuti hierarchy efektif. Setelah effective date, scope parent lama tidak lagi mencakup unit yang pindah; scope parent baru dapat mencakupnya. Akses yang sudah terjadi tidak dihapus dari audit. | Modernize |
| Legal Entity baru | Dibuat dengan root Central, profil minimum, dan status draft/inactive sampai Super Admin mengaktifkannya. | Modernize |
| Department hierarchy | Boleh memiliki hierarchy ringan untuk reporting, tetapi tidak menjadi Data Scope. | Modernize |

##### Putaran 6 — Status dan guardrail

| Topik | Keputusan | Penanda |
|---|---|---|
| Profil Tenant | Minimal: name, code, status, default timezone, default locale, default currency, owner/contact administrator. | Modernize |
| Lifecycle Legal Entity | `draft → active → inactive → tombstone/deleted`. | Modernize |
| Lifecycle Organization Unit | `draft → active → inactive → tombstone/deleted`; replacement optional. | Modernize |
| Lifecycle Department | `active/inactive`; tidak perlu tombstone kompleks karena bukan Data Scope. | Modernize |
| Aktivasi Legal Entity | Tidak memerlukan approval terpisah; Super Admin mengaktifkan dari draft/inactive. | Modernize |
| Perubahan yang boleh diusulkan Admin Tenant | hierarchy Organization Unit, inactive/delete request, code change request, dan profil Legal Entity penting. Super Admin publish/reject. | Modernize |

#### Prinsip yang mengikat Epic 5

1. **Tenant bukan Company Profile.** Tenant adalah data boundary/workspace. Satu atau banyak Legal Entity di bawahnya membawa identitas hukum, finansial, dan alamat resmi.
2. **Satu Legal Entity tidak dapat lintas Tenant.** Semua foreign key, query, import, dan mutation memverifikasi kesamaan Tenant secara eksplisit.
3. **Organization Unit adalah pohon operasi internal.** Organization Unit tidak sama dengan Customer Site/Location, dan bukan Department.
4. **Department tidak memberi authority.** Department digunakan untuk employee placement dan reporting; role, permission, dan Data Scope tetap mengendalikan akses.
5. **UUID tidak berubah.** UUID adalah primary key dan referensi internal. Business code dapat berubah hanya melalui controlled Super Admin change yang menyimpan code sebelumnya, actor, alasan, waktu berlaku, dan dampak integrasi.
6. **Tidak ada hard delete buta.** Entity yang pernah direferensikan berubah menjadi tombstone. Physical delete hanya mungkin bila seluruh pemeriksaan referensi membuktikan entity tidak pernah dipakai.
7. **Riwayat struktur adalah data.** Parent-child harus memiliki range effective date, tidak hanya satu `parent_id` current. Transaksi dapat menjelaskan struktur yang berlaku pada tanggal bisnisnya.
8. **Backdate tidak menyembunyikan waktu pencatatan.** Backdate hierarchy wajib menyimpan effective date, recorded/published date, actor, reason, dan dampak. Audit tidak pernah di-backdate.
9. **Legal Entity scope berada di antara Tenant dan Organization Unit.** Scope yang lebih luas selalu mencakup descendant, tidak pernah sibling atau Legal Entity lain.
10. **Status inactive menutup pekerjaan baru, bukan histori.** Transaksi lama, audit, dan reporting tetap dapat membaca referensi historis dengan penanda yang menjelaskan statusnya.
11. **Attachment slot bukan file management.** Epic 5 hanya menyimpan link/metadata. File bytes, virus scanning, retention, versioning, dan access policy menjadi kontrak epic dokumen/file terpisah.
12. **Proposal bukan publish.** Admin Tenant dapat menyusun draft perubahan dalam batasnya; hanya Super Admin dapat menerbitkan perubahan struktur dan Legal Entity yang mengubah data authority/hierarchy.

#### Basis iDempiere dan kondisi Abixell One

| Konsep | Bukti | Kondisi/terjemahan Abixell One | Penanda |
|---|---|---|---|
| Tenant/client boundary | iDempiere `AD_Client`; riset `11-security.md:35-44` mencatat client sebagai boundary tenant | `tenants.id` sudah menjadi discriminator pada tabel inti; migration awal: `apps/api/migrations/1755600000000_identity-organization-rbac-audit.cjs:23-34` | Adopt |
| Legal Entity dalam Tenant | Dokumen fondasi lama menyatakan Legal Entity di bawah Tenant: `docs/history/phase-0/spec/01-Tenant-Legal-Entity-Organization-Model.md:17-25` | `legal_entities.tenant_id` sudah wajib: migration awal `:37-49`; Epic 5 memperkaya profil dan lifecycle | Modernize |
| Organisasi internal | iDempiere `AD_Org`; riset `11-security.md:35-44` membedakan organisasi dari tenant | `organization_units` rekursif melalui `parent_id`, wajib memiliki `legal_entity_id`: migration awal `:51-70` | Adopt/Modernize |
| Scope organization parent ke child | `AD_Role_OrgAccess` sebagai konsep; iDempiere model akses organisasi | `ADR-0009` menerapkan Organization Unit X mencakup semua descendant; Epic 5 menambah Legal Entity scope dan effective-dated history | Modernize |
| Query filter authorization | `MRole.addAccessSQL()`; riset `11-security.md:127-159` | Scope dan hierarchy tetap disaring di API/repository, bukan browser | Modernize |
| Business partner terpisah dari user dan organisasi | iDempiere `C_BPartner`, `C_BPartner_Location`; riset `13-database.md:63-65` | Customer Site/Location adalah milik customer; bukan Organization Unit internal. Model User/Employee/Business Partner diputuskan di Epic 6 §4.6: Business Partner canonical berbentuk Individual atau Organization; Employee adalah role + profile. | Adopt/Modernize — resolved §4.6 |
| Organization profile (`AD_OrgInfo`) | Konsep iDempiere relevan, tetapi source lokal yang diverifikasi belum ditemukan | Jangan menyatakan field-by-field parity. Epic 5 memakai keputusan produk Abixell dan verifikasi source wajib sebelum implementasi detail. | Needs verification |

**Koreksi penting terhadap dokumen lama:** `docs/history/phase-0/spec/01-Tenant-Legal-Entity-Organization-Model.md` masih memperlakukan Department sebagai contoh Organization Unit dan menyebut Project/Site sebagai turunan hierarchy umum. Keputusan Epic 5 menggantikan arah itu: Department adalah dimensi terpisah; Internal Site adalah Organization Unit internal; Customer Site/Location adalah objek milik customer; Project tetap objek bisnis, bukan node wajib dalam pohon Organization Unit.

#### Model target

```text
Tenant
├── default timezone / locale / currency
├── Legal Entity A
│   ├── legal profile + typed addresses + base currency
│   ├── root Organization Unit: Central
│   │   ├── Region Barat
│   │   │   ├── Internal Site Bandung
│   │   │   └── Internal Site Bekasi
│   │   └── Region Timur
│   └── Department hierarchy (reporting only)
│       ├── Operations
│       └── Finance
└── Legal Entity B (future-ready)
    └── root Organization Unit: Central

Customer
└── Customer Site/Location
    └── lokasi pelayanan customer; bukan bagian pohon internal
```

**Kombinasi scope target:**

```text
tenant scope
  → seluruh Legal Entity dan seluruh Organization Unit dalam Tenant

legal_entity scope
  → seluruh Organization Unit pada satu Legal Entity

organization_unit scope
  → satu Organization Unit dan semua descendant efektifnya

customer scope
  → customer tertentu; tetap menunggu session Service Operation
```

Scope Legal Entity harus berasal dari assignment yang sama dengan permission yang dipakai. Scope tenant/Legal Entity/Organization Unit tidak boleh digabung lintas assignment untuk menaikkan authority.

#### Mekanisme desain

##### A. Tenant profile

`tenants` ditambah metadata minimal: `default_timezone`, `default_locale`, `default_currency`, owner/contact administrator, dan lifecycle yang konsisten. Tenant identity utama tetap dikelola Super Admin. Tenant tidak menyalin profil legal Legal Entity.

##### B. Legal Entity profile dan addresses

Legal Entity membawa field legal dan finansial yang sudah dikunci. Alamat dimodelkan terpisah agar satu Legal Entity dapat memiliki banyak address bertipe. Address type minimal: `registered`, `operating`, `billing`, `tax`; type tambahan hanya melalui daftar metadata yang sah.

Alamat dan kontak memiliki lifecycle sendiri sesuai kebutuhan, tetapi tidak boleh menghapus alamat yang sudah direferensikan invoice, dokumen legal, atau transaksi. Perubahan alamat penting menghasilkan audit before/after.

Legal Entity hanya dibuat Super Admin. Pembuatan atomik menghasilkan:

1. Legal Entity `draft` atau `inactive`;
2. tepat satu root Organization Unit `Central`;
3. profil minimum;
4. audit create;
5. tidak ada akses transaksi sampai Legal Entity aktif dan assignment yang sah ada.

Aktivasi tetap dilakukan Super Admin tanpa approval kedua. Legal Entity inactive/deleted tidak dapat menjadi target transaksi baru.

##### C. Organization Unit current state, history, dan hierarchy change request

Model tidak cukup memakai satu `parent_id` current. Target desain menyimpan:

- Organization Unit identity: UUID, current business code, Legal Entity, jenis inti, display label;
- lifecycle: draft, active, inactive, tombstone/deleted;
- parent-child history: `parent_organization_unit_id`, `effective_from`, `effective_to`, published/recorded time, actor, reason;
- change request: draft before/after, requested effective date, proposer, reviewer, publish/reject status, reason;
- optional `replacement_organization_unit_id` saat merger atau pemindahan permanen;
- tombstone metadata: status asal, waktu, actor, reason, replacement bila ada.

Batas struktur:

- Satu Legal Entity selalu memiliki tepat satu root Central.
- Root Central tidak dapat dihapus atau dipindah lintas Legal Entity.
- Semua Internal Site/Branch memiliki parent.
- Anak dan parent harus berada pada Tenant dan Legal Entity yang sama.
- Tidak boleh ada cycle, overlap rentang parent efektif, atau perubahan historis yang membuat root ganda.

Perubahan hierarchy lewat dua jalur:

| Actor | Kemampuan |
|---|---|
| Admin Tenant | Membuat draft change request dalam batas tenant/scope; tidak dapat publish |
| Super Admin | Membuat, mereview, publish, reject, future-date, atau backdate terbatas dengan reason wajib |

Saat change request dipublish, policy authorization membaca hierarchy yang efektif. Scope parent lama berhenti mencakup child yang dipindah pada effective date. Scope parent baru mulai mencakupnya. Audit untuk tindakan masa lalu tidak ditulis ulang.

##### D. Tombstone dan penghapusan

Alur target:

```text
active
  → inactive
  → Super Admin meminta delete
  → pemeriksaan referensi lintas transaksi/assignment/employee/reporting/audit
  → belum pernah direferensikan: physical delete dapat dipertimbangkan
  → pernah direferensikan: tombstone deleted; record minimum tetap ada
```

Pemeriksaan wajib mencakup transaksi active dan inactive, assignment active dan historis, employee placement, finance, project, inventory, audit, reporting, serta attachment metadata. Delete Organization Unit tidak menghapus transaksi terkait. Tanda pada transaksi/read model menjelaskan mengapa referensi menjadi deleted, kapan terjadi, siapa actor-nya, reason, dan replacement bila ada.

`scope_invalidated_at` yang ada sekarang tetap menangani scope yang invalid akibat target dihapus/dipindah/tidak valid. Epic 5 tidak boleh menggunakan flag ini sebagai pengganti lifecycle tombstone atau histori organisasi.

##### E. Department

Department adalah master tenant-scoped terpisah dengan hierarchy ringan untuk reporting dan employee placement. Department tidak dipakai oleh authorization scope, tidak membuat descendant Data Scope, dan tidak mengubah aturan role/permission. Lifecycle hanya `active/inactive`.

Keterkaitan User, Employee, Role, dan Business Partner diputuskan di Epic 6 §4.6. Ringkasnya: Business Partner canonical adalah Individual atau Organization; Employee adalah role + profile; Department adalah dimensi reporting, bukan scope; placement memiliki satu primary dan secondary terbatas, semuanya bertanggal efektif.

##### F. Legal Entity Data Scope

Tambahkan `scope_type = legal_entity` dan `scope_legal_entity_id`. Validasi:

```text
tenant scope
  → tanpa target Legal Entity atau Organization Unit

legal_entity scope
  → target Legal Entity wajib; target Organization Unit kosong

organization_unit scope
  → target Organization Unit wajib; Legal Entity diturunkan/divalidasi dari unit

customer scope
  → tidak berubah; UI menunggu keputusan Service Operation
```

Service authorization harus memastikan permission dan scope berasal dari assignment yang sama. Untuk target Organization Unit, coverage benar jika assignment adalah tenant scope, Legal Entity scope yang sama, atau Organization Unit pada ancestor efektif. Legal Entity scope tidak mencakup sibling Legal Entity.

Penambahan scope ini menyentuh `user_role_assignments`, authorization-effective view, `RbacService`, repository, active session context Epic 1, list/filter administrasi Epic 4, dan seluruh resource yang menerapkan scope. Ini harus diperlakukan sebagai perubahan security core, bukan sekadar tambahan dropdown.

##### G. Backdate hierarchy dan Backdate Transaction

**Backdate hierarchy** adalah perubahan struktur yang effective date-nya lebih awal daripada tanggal pencatatan/publish. Hanya Super Admin dapat publish. Audit menyimpan kedua waktu dan reason.

Contoh:

```text
Site Bandung pindah Region Barat → Region Tengah
business effective date: 2026-09-01
recorded/published date: 2026-09-24
```

Hierarchy historis pada laporan harus dapat dibedakan antara struktur yang dulu diketahui sistem dan koreksi struktur yang kemudian dipublish. Laporan periode yang sudah ditutup tidak boleh berubah diam-diam; perubahan memakai prosedur koreksi/reissue pemilik modul.

**Backdate Transaction** adalah keputusan lintas modul, bukan implementasi Epic 5. Kontrak yang diteruskan ke Epic 7, 8, dan 9:

```text
Transaction Date: [ 2026-09-01 ]

[ ] Backdate Transaction

Saat checkbox dicentang:
Backdate Transaction Date: [ 2026-08-25 ]
Calendar selected date:      [ 2026-08-25 ]
Notes / Justification:       [ Keterlambatan input karena keterlambatan informasi ]
Attachment:                  [ Attach supporting document ]
```

Aturan terkunci:

- checkbox Backdate Transaction default **unchecked**;
- backdate date wajib lebih awal daripada Transaction Date;
- calendar memilih Backdate Transaction Date dan tidak diam-diam mengganti tanggal normal;
- Notes/Justification wajib saat checkbox aktif;
- attachment tersedia dekat justifikasi; policy modul dapat mewajibkannya;
- record menyimpan Transaction Date, Backdate Transaction Date, input time, actor, reason, attachment reference, dan approval status bila dibutuhkan;
- audit mencatat seluruh data tersebut; tanggal audit tidak pernah di-backdate;
- Super Admin/policy module menentukan siapa boleh memakai backdate; mekanisme approval masuk Epic 9.

##### H. Legal document attachment slot

Epic 5 menyiapkan metadata/reference untuk dokumen legal Legal Entity, misalnya document category, legal entity, attachment reference, expiry date bila relevan, status referensi, dan audit. Epic ini tidak memilih object storage, scan virus, ukuran file, encryption, versioning, retention, approval, atau akses download. Semua adalah item session dokumen/file yang harus selesai sebelum tombol upload production dibuka.

#### Gelombang pengerjaan Epic 5

**Eksekusi 2026-09-28–2026-09-30**

- **Phase 1 — G3 UI Picker**: COMPLETE — LE picker + selectable detection + default selection (AdminAssignmentControls, AdminAssignAccessDialog)
- **Phase 2 — G4 Attachment Metadata**: COMPLETE — migration, domain entity, repository (governed tx), service (RBAC), routes, DI wiring, G4 contract doc
- **Phase 3 — G1 Lifecycle Fix**: COMPLETE — legal-entity.repository.pg.ts line 377 excludes root Central from active-units guard; LE deactivation now safe
- **Phase 4 — Legacy Re-parent**: COMPLETE (DB admin executed 2026-09-30; 37 orphan OUs re-parented, 21 LEs consolidated to single Central root, 0 remaining orphans in real data, 21 audit entries)
- **Phase 5 — Documentation & QA**: COMPLETE (G4 contract written, Phase 4 operator spec written & executed, 43 integration tests lulus di isolated test DB — G1 lifecycle 17, G3 authorization 13, G3 legal entity scope 13; Phase 4 live DB re-parent done; Epic 5 §4.5 roadmap items #4, #7 deferred to future interviews; typecheck clean API+Web)

**Gelombang 0 — Kontrak dan migrasi aman**

1. Inventaris semua foreign key/transaksi/assignment yang sudah memakai `legal_entity_id` atau `organization_unit_id`.
2. Tetapkan enum status dan transition policy tanpa mengubah data historis secara diam-diam.
3. Definisikan migration additive untuk profile Tenant, Legal Entity, address, Department, history hierarchy, tombstone metadata, change request, attachment reference, dan Legal Entity scope.
4. Buat parity snapshot terhadap hierarchy current sebelum history efektif diaktifkan.

**Gelombang 1 — Profile dan lifecycle**

5. Perkaya profile Tenant dan Legal Entity.
6. Tambahkan typed addresses dan validasi Tenant/Legal Entity ownership.
7. Buat lifecycle Legal Entity dan Organization Unit; block transaksi baru pada entity inactive/deleted.
8. Buat root Central otomatis dalam transaction saat Super Admin membuat Legal Entity.
9. Buat Department master dan hierarchy reporting tanpa menghubungkannya ke Data Scope.

**Gelombang 2 — History hierarchy dan proposal**

10. Tambahkan parent-child effective-date history dan current projection.
11. Buat Admin Tenant change request dan Super Admin review/publish/reject.
12. Tambahkan validasi cycle, root Central, cross-Legal-Entity parent, overlap date range, future-date, dan limited backdate.
13. Tambahkan tombstone/replacement flow serta reference-check registry sebelum delete.

**Gelombang 3 — Legal Entity scope dan authorization**

14. Tambah Legal Entity Data Scope pada assignment, active session context, authorization-effective view, repository, dan service.
15. Terapkan coverage tenant → Legal Entity → Organization Unit dengan policy same-assignment.
16. Update semua list/mutation resource agar scope Legal Entity disaring server-side.
17. Update Epic 4 role/assignment UI untuk menunjukkan Legal Entity scope setelah backend security lulus.

**Gelombang 4 — File contract dan lintas-epic handoff**

18. Expose attachment metadata slot tanpa mengaktifkan upload production bila epic dokumen/file belum siap.
19. Tulis contract Backdate Transaction ke Epic 7/8/9.
20. Jalankan regression scope, transaction lifecycle, reporting history, audit, dan cross-tenant isolation pada database uji terpisah.

#### Konsistensi dan serah terima Epic 1–4

| Epic | Kontrak Epic 5 | Dampak/aksi |
|---|---|---|
| Epic 1 — Security Context | Actor context harus dapat membawa Legal Entity scope dan active assignment yang lengkap. | Update context/session resolution sebelum Legal Entity scope diaktifkan. |
| Epic 2 — Application Dictionary | Legal Entity, address, Department, Organization Unit, hierarchy change request, dan attachment reference membutuhkan Table/API Resource/Field metadata terdaftar. | Definisi inti masuk migration/code; tenant hanya override aman. |
| Epic 3 — Module & Menu | Module bukan pemberi akses. Status entity inactive/deleted harus memberi API error yang benar, bukan hanya menyembunyikan menu. | Menu/profile UI mengikuti access object dan module state. |
| Epic 4 — User, Role & Permission UI | Assignment scope bertambah `legal_entity`; user/role admin perlu melihat scope baru dalam batas delegasi. | Tidak membuka customer scope; tetap gunakan governed transaction, same-assignment, visibility server-side, dan audit. |
| Epic 6 — User Identity, Employee, Business Partner & Assignment | Department menjadi dimensi placement/reporting; Business Partner canonical adalah Individual atau Organization; Employee adalah role + profile dengan placement effective-dated. | Ikuti keputusan Epic 6 §4.6: satu primary placement dan secondary terbatas, semuanya effective-dated; placement tidak memberi Data Scope. Jangan menganggap semua User adalah Employee atau semua Employee harus memiliki login. |
| Session Customer Scope / Service Operation | Customer Site/Location bukan Internal Site/Organization Unit; customer scope tetap terpisah. | Jangan menampilkan customer scope pada UI internal sampai session selesai. |
| Epic 7 — Document Engine | Transaction membutuhkan Legal Entity/Organization Unit historical reference serta contract Backdate Transaction. | Epic 7 mengimplementasikan field/tombol/validasi transaction backdate, bukan Epic 5. |
| Epic 8 — Parameter Setup | Policy module untuk batas backdate dan attachment wajib. | Buat parameter terstruktur, bukan if statement per layar. |
| Epic 9 — Workflow & Approval | Approval Backdate Transaction dan perubahan struktur yang memerlukan approval lebih lanjut. | Epic 5 hanya Super Admin publish; workflow formal belum dibangun. |
| Epic dokumen/file baru | Storage, upload, scan, version, expiry, retention, access policy dokumen legal dan supporting evidence. | Attachment slot Epic 5 tidak boleh dianggap upload feature selesai. |

#### Di luar cakupan Epic 5

- Employee master, placement rules, dan lifecycle identity User/Employee/Business Partner; keputusan ada di Epic 6 §4.6.
- Customer scope, customer portal, customer Site policy, dan menu eksternal.
- Upload/storage/virus scanning/versioning/retention dokumen legal atau attachment transaksi.
- Workflow approval formal untuk hierarchy change atau Backdate Transaction.
- Document lifecycle dan UI Backdate Transaction lintas modul.
- Finance currency conversion, tax calculation, bank account, izin usaha khusus modul, fiscal close, serta accounting posting.
- Menjadikan Department sebagai Data Scope atau security boundary.
- Physical delete entity yang pernah direferensikan.

#### Item terbuka Epic 5

| # | Item | Perlu |
|---|---|---|
| 1 | Batas maksimal jumlah hari backdate hierarchy dan Backdate Transaction | Parameter policy Epic 8, dengan kebutuhan Finance/Compliance per modul |
| 2 | Definisi “laporan sudah ditutup” dan prosedur reissue saat hierarchy backdate mengubah grouping historis | **Diteruskan Epic 12 (§4.12 open item #3):** Epic 12 hanya menyediakan retensi + penanda periode; definisi teknisnya menunggu wawancara lanjutan Epic 5 atau keputusan Epic 14 |
| 3 | Pilihan object storage, virus scan, encryption, retention, size/type limit, dan access policy attachment | Session dokumen/file terpisah |
| 4 | Field status/profile tambahan per yurisdiksi, termasuk validasi Tax Registrations dan aturan registered address wajib yang cocok dengan NPWP | Finance/tax/compliance interview; collection Tax Registrations ditetapkan di Epic 6 §4.6 |
| 5 | Model tepat user, employee, person, vendor, customer, dan business partner | **Resolved di Epic 6 §4.6:** Business Partner canonical berbentuk Individual atau Organization; Employee adalah role + profile. |
| 6 | Apakah Department assignment dapat multi-value per employee dan berlaku per effective date | **Resolved di Epic 6 §4.6:** satu primary placement dan secondary placement terbatas, semuanya effective-dated; Department hanya dimensi reporting. |
| 7 | Lifecycle label `tombstone/deleted`: apakah label user-facing memakai "Deleted", "Archived", atau istilah bisnis lain | Decision UI/terminology sebelum implementasi |
| 8 | Physical delete eligibility dan katalog referensi lintas semua modul | Dipastikan saat Gelombang 2 dari schema/foreign-key inventory, bukan diasumsikan sekarang |

#### Strategi mitigasi risiko Epic 5

| Risiko | Dampak | Mitigasi wajib | Bukti selesai |
|---|---|---|---|
| Legal Entity lintas Tenant | Kebocoran data atau pencampuran identitas hukum | Foreign key/composite ownership checks, policy query tenant-scoped, tests cross-tenant | Mutation dan query lintas Tenant ditolak; test isolation lulus |
| One root Central tidak terjaga | Scope dan hierarchy ambigu | Transaction create Legal Entity + root Central, unique constraint, no-delete policy | Tidak dapat membuat Legal Entity tanpa satu Central atau dua Central |
| Department dipakai sebagai security scope | Akses menjadi salah dan membingungkan | Pisahkan tabel/domain Department dari scope authorization; review endpoint | Permission check tidak menerima Department ID sebagai scope |
| Parent Organization Unit lintas Legal Entity | Scope Legal Entity dapat bocor | Validasi tenant/legal entity parent-child serta database constraint/trigger bila perlu | Cross-entity parent ditolak oleh API dan DB |
| Change hierarchy mengubah histori diam-diam | Laporan dan audit tidak dapat dipercaya | Effective-date history, publish time, reason, before/after, closed-period policy | Test historical query sebelum/sesudah publish menunjukkan versi dan audit |
| Backdate memberi akses retroaktif | Audit access menjadi tidak dapat diinterpretasi | Authorization berlaku dari publish/current decision; access event lama immutable | Test audit lama tidak berubah saat history dibackdate |
| Tombstone memutus transaksi | Referensi lama hilang atau foreign key gagal | Reference inventory, soft lifecycle, immutable minimal identity read model | Transaksi lama tetap menampilkan Organization Unit historis serta alasan status |
| Code change merusak integrasi | Import/API/dokumen mengarah salah | UUID internal, code alias history, deprecation window, audit, integration impact preview | Lookup code lama dapat dijelaskan/ditolak secara terarah; UUID tetap sama |
| Legal Entity inactive masih dipakai create | Transaksi baru memakai entity tertutup | Central `requireLegalEntityActive` policy pada mutation | Integration test semua mutation menolak target inactive/deleted |
| Legal Entity scope digabung dengan permission scope lain | Privilege escalation | Same-assignment enforcement dari Epic 1/4; security review atas seluruh scope query | Test assignment silang tidak dapat authorize |
| Attachment slot dianggap fitur file selesai | File tidak aman atau tak dapat diretain | Epic 5 hanya metadata/reference; upload gate menunggu epic dokumen/file | Tidak ada production upload route sebelum policy file selesai |
| Backdate Transaction berbeda perilaku antar modul | Audit/compliance inkonsisten | Epic 7 menyediakan contract dan component/service standar; Epic 8 policy per modul | Conformance test setiap module transaction memakai contract sama |

#### Gate sebelum Epic 5 dinyatakan selesai

- Tenant, Legal Entity, Organization Unit, Department, Customer Site/Location, dan User/Employee dipisahkan jelas pada domain dan UI.
- Satu Legal Entity tidak dapat dikaitkan ke Tenant lain.
- Hanya Super Admin dapat membuat dan mengaktifkan Legal Entity; pembuatan menghasilkan tepat satu root Central.
- Legal Entity profile dan typed addresses tervalidasi dan teraudit.
- Legal Entity/Organization Unit inactive/deleted tidak dapat dipakai transaksi baru.
- Organization Unit yang pernah direferensikan tidak physical delete; transaksi historis tetap terbaca dengan tombstone reason/status/replacement bila ada.
- Parent-child history mendukung future-date dan limited backdate tanpa cycle/overlap/cross-entity link.
- Admin Tenant hanya dapat mengusulkan perubahan dalam batasnya; Super Admin menjadi publisher.
- Tenant → Legal Entity → Organization Unit Data Scope berlaku di server dan permission datang dari assignment yang sama.
- Department tidak pernah memberi atau memperluas akses.
- Backdate Transaction contract tersimpan sebagai handoff Epic 7–9; tombol transaction backdate belum dianggap selesai di Epic 5.
- Attachment legal hanya metadata/reference sampai epic dokumen/file memenuhi security/lifecycle gate.
- Semua test scope, migration, lifecycle, audit, reporting history, dan cross-tenant berjalan pada database terisolasi, bukan `abixell_one_dev`.

#### Catatan implementasi terhadap kondisi saat ini

- Migration awal sudah membuat `legal_entities.tenant_id` wajib dan `organization_units.legal_entity_id` wajib, tetapi masih memakai `ON DELETE CASCADE` serta `organization_units.parent_id` tunggal. Ini belum memenuhi tombstone, reference-preserving delete, atau effective-date hierarchy (`apps/api/migrations/1755600000000_identity-organization-rbac-audit.cjs:37-70`).
- `unit_type` saat ini teks bebas. Keputusan Epic 5 membutuhkan platform-owned core type dan tenant terminology override, bukan type bebas sebagai security input (`apps/api/migrations/1755600000000_identity-organization-rbac-audit.cjs:57-61`).
- `ADR-0009` sudah membuktikan scope Organization Unit parent mencakup descendant (`docs/adr/0009-hierarchical-data-scope.md:25-57`). Epic 5 memperluasnya ke Legal Entity scope dan waktu efektif, sehingga perubahan harus mengulang security regression secara menyeluruh.
- `RbacService` telah memiliki pemeriksaan scope hierarkis Organization Unit dan customer helper; penambahan Legal Entity scope perlu menyesuaikan service/repository secara eksplisit, bukan menebak dari `parent_id` (`apps/api/src/application/rbac/rbac.service.ts:52-115`, `:169-229`).
- Existing governed transaction serta audit harus dipakai untuk mutation struktur dan scope; tidak ada perubahan profile atau hierarchy yang langsung publish dari browser (`apps/api/src/infrastructure/persistence/repositories/governed-transaction.ts:3-103`).

Dokumen ini adalah keputusan roadmap. Tidak memberi persetujuan untuk migration atau perubahan backend sekarang. Implementasi mengikuti urutan epic, plan terpisah, review database/security, dan database test terisolasi.

---

### 4.6 EPIC 6 — User Identity, Employee, Business Partner & Assignment

#### Problem statement

Abixell One membutuhkan satu model identity yang tidak mencampur pihak bisnis, hubungan kerja, orang kontak, dan akun login:

```text
Business Partner = pihak/orang canonical yang dikenal sistem
Employee         = peran Business Partner Individual + Employee Profile
Contact          = orang kontak di bawah Business Partner Organization
User             = akun login opsional
```

Tanpa batas ini, Employee mudah diduplikasi sebagai master orang kedua, Customer dan Vendor menjadi identitas terpisah untuk pihak yang sama, dan placement kerja berisiko dianggap sebagai authorization. Epic 6 mengunci canonical party, hubungan User/Employee/Contact, Role Assignment, placement, import/export, merge/split, serta Tax Registration. Epic ini bukan implementasi Human Resources Information System penuh, customer portal penuh, atau perubahan backend sekarang.

#### Koreksi arsitektural utama

Keputusan awal Putaran 1 sempat menempatkan Employee sebagai master terpisah. Keputusan itu **dibatalkan** setelah verifikasi ulang konsep resmi iDempiere dan koreksi founder.

Model final:

```text
Business Partner
├── type: Individual | Organization
├── roles
│   ├── Employee
│   ├── Customer
│   ├── Vendor/Supplier
│   ├── Service Provider
│   ├── Outsourcing Provider
│   ├── Salesperson
│   └── Prospect
├── role profiles
├── contacts
├── optional users
├── addresses
└── tax registrations
```

Employee bukan master identitas kedua. Modul Human Resources Information System mengambil daftar Employee dari Business Partner yang memiliki role/flag Employee aktif. Data hubungan kerja hidup di Employee Profile.

#### Keputusan terkunci hasil wawancara 2026-09-24

##### Putaran 1 — Model canonical dan Employee

| Topik | Keputusan | Penanda |
|---|---|---|
| Business Partner | Master pihak canonical; dapat mempunyai banyak peran bisnis. | Adopt |
| Employee | Role/flag pada Business Partner Individual, bukan master identitas terpisah. | Adopt |
| Employee Profile | Menyimpan data khusus hubungan kerja dan placement. | Modernize |
| Human Resources Information System | Mengambil Employee dari Business Partner dengan role Employee aktif. Istilah produk: Employee, bukan workforce. | Modernize |
| User | Akun login opsional; Employee boleh memiliki atau tidak memiliki User. | Modernize |
| Contact | Business Partner Organization dapat memiliki banyak Contact/User. | Adopt |
| Outsourcing | Pekerja outsourcing dapat berperan Employee dengan `employment type = outsourced` dan referensi ke Business Partner penyedia outsourcing. | Modernize |
| Department | Placement/reporting effective-dated; bukan Business Partner Group dan bukan Data Scope. | Modernize |

##### Putaran 2 — Kepemilikan User, Tenant, dan undangan

| Topik | Keputusan | Penanda |
|---|---|---|
| Kepemilikan User | Satu User biasa dimiliki satu Tenant. Orang yang sama pada Tenant berbeda memakai User berbeda; email boleh sama lintas Tenant. | Modernize |
| Super Admin | User platform/System context, bukan User biasa milik Tenant. | Modernize |
| Pembuat User | Super Admin lintas Tenant; Admin Tenant hanya Tenant sendiri dan tidak dapat membuat/mengubah Super Admin. | Modernize |
| Prasyarat | Business Partner wajib dibuat sebelum User, Employee, Vendor, atau Customer. | Adopt |
| Delegasi | Admin hanya dapat memberi kewenangan yang mereka miliki; tidak boleh self-assignment atau memberi scope lebih luas. | Modernize |
| User eksternal | Wajib terkait Contact dan Business Partner; tidak memakai Organization Unit sebagai scope internal. | Modernize |
| Undangan | `Draft → Invited → Pending Verification → Active → Suspended → Deactivated`; token sekali pakai, punya expiry, resend membatalkan token lama, password tidak dikirim melalui email. | Modernize |

Urutan canonical:

```text
Business Partner
  → tipe Individual/Organization
  → aktifkan role
  → lengkapi role profile
  → optional Contact
  → optional User
  → Role Assignment + Data Scope
```

##### Putaran 3 — Tipe pihak, role profile, group, dan Contact

| Topik | Keputusan | Penanda |
|---|---|---|
| Tipe pihak | Setiap Business Partner wajib Individual atau Organization. Employee wajib Individual. Tipe tidak diubah setelah transaksi tanpa migrasi terkendali. | Modernize |
| User internal | Terhubung langsung ke Business Partner Individual berperan Employee. Satu Employee maksimal satu User aktif dalam Tenant. | Modernize |
| Contact | Record orang di bawah Business Partner Organization; bukan Business Partner Individual tambahan. | Adopt |
| Contact purpose | Multi-value, misalnya Primary, Billing, Shipping, Operational, dan Portal Administrator. Purpose bukan hak akses. | Modernize |
| Role profile | Setiap role memiliki profil dan lifecycle sendiri, misalnya Employee Profile, Customer Profile, Vendor Profile. | Modernize |
| Business Partner Group | Satu group utama untuk reporting/default bisnis; klasifikasi tambahan memakai label multi-value. | Adopt/Modernize |
| Wizard | Satu wizard bertahap. Draft boleh setelah basic identity valid; role belum aktif sampai profil minimum valid. | Modernize |

Super Admin teknis dan Integration User tetap wajib memiliki Business Partner, tetapi tidak wajib role Employee.

##### Putaran 4 — Template, import, dan export

| Topik | Keputusan | Penanda |
|---|---|---|
| Format | Excel `.xlsx` dan CSV sejak awal. Excel dapat multi-sheet; CSV terpisah per jenis data. | Modernize |
| Template | Tersedia sebelum import; memuat petunjuk, kolom wajib, contoh terpisah, nilai referensi, dan versi template. | Modernize |
| Pelaksana import | Hanya Super Admin dan Admin Tenant; Admin Tenant terbatas pada Tenant serta authority mereka. | Modernize |
| Partial success | Diproses per aggregate Business Partner. Aggregate valid tetap masuk; aggregate gagal tidak disimpan. | Modernize |
| Hasil gagal | File hasil validasi memuat source sheet/row, Business Partner Code, Employee Number bila ada, nama, status, error code, dan validation message. | Modernize |
| Mode | `Create Only` dan `Update Existing` dipilih eksplisit. | Modernize |
| Matching | UUID, Business Partner Code, atau nomor per role yang stabil. Nama/email bukan matching otomatis atau unique key. | Modernize |
| Batas credential | Import tidak membuat User, Role Assignment, password, token, atau secret. User dibuat melalui undangan terpisah. | Modernize |
| Export | Mengikuti permission, Data Scope, field sensitivity, audit, template version, dan proteksi spreadsheet formula injection. | Modernize |

##### Putaran 5 — Lifecycle dan delete

| Topik | Keputusan | Penanda |
|---|---|---|
| Business Partner | `Draft → Active → Inactive → Deleted Tombstone`. | Modernize |
| Role Business Partner | Masing-masing punya status sendiri; Vendor dapat inactive sementara Customer tetap active. | Modernize |
| Employee Profile | `Draft → Active → On Leave → Suspended → Ended`. | Modernize |
| Contact | `Draft → Active → Inactive`. | Modernize |
| User terkait | Employee Ended atau Contact Inactive memicu pilihan eksplisit; default aman Suspend User. Keep Active wajib reason, review date, dan audit. | Modernize |
| Delete | Eksekusi hanya Super Admin setelah reference check. Bila ada referensi historis, gunakan tombstone. Admin Tenant hanya mengusulkan. | Modernize |

Reference check minimal mencakup transaksi, dokumen, audit log, User, Role Assignment, Contact, Employee Profile, placement history, classification, import/export history, dan integration reference.

##### Putaran 6 — User type, Role category, dan Role Assignment

| Topik | Keputusan | Penanda |
|---|---|---|
| User type | Internal, External, Integration, dan SuperAdmin. | Modernize |
| Role category | Internal Role, External Role, Integration Role, dan Platform Role. User type membatasi role yang boleh diberikan. | Modernize |
| Scope eksternal | `User → Contact → Business Partner`; dapat full Business Partner access atau area/resource terbatas. | Modernize |
| Batas Admin Tenant | Tidak dapat memberi Platform Role, role yang tidak dapat didelegasikan, scope lebih luas, role ke diri sendiri, atau mengubah user berkewenangan lebih tinggi. | Modernize |
| Lifecycle assignment | `Draft → Active → Suspended → Revoked → Expired`; menyimpan effective period, reason, actor, dan audit. | Modernize |
| Login context | User memilih Role, Tenant, Scope Type, dan Scope Target aktif. Assignment tidak digabung menjadi effective permission lebih besar. | Adopt |
| Same-assignment rule | Permission dan Data Scope yang dipakai harus berasal dari assignment yang sama. | Adopt |

##### Putaran 7 — Placement dan integrasi

| Topik | Keputusan | Penanda |
|---|---|---|
| Multi-Legal Entity | Satu Business Partner/Employee Profile dan placement history lintas Legal Entity dalam Tenant yang sama. | Modernize |
| Primary placement | Tepat satu primary placement aktif. | Modernize |
| Secondary placement | Boleh terbatas, dengan reason dan effective date; tidak otomatis memberi Data Scope. | Modernize |
| Identity change | UUID dan Business Partner Code stabil. Perubahan identitas memakai histori, audit, reason, waktu berlaku, dan dokumen pendukung bila perlu. | Modernize |
| Duplicate warning | Sistem memperingatkan; Admin memutuskan dengan reason. Sistem tidak auto-merge. | Modernize |
| Mutasi | Organization Unit/Department selalu effective-dated dan tidak otomatis mengubah Role Assignment/Data Scope. | Modernize |
| Integration User | Wajib Business Partner Organization bertipe Integration/System Partner; tidak memakai akun manusia bersama. | Modernize |

##### Putaran 8 — Kode, data sensitif, merge, dan split

| Topik | Keputusan | Penanda |
|---|---|---|
| Business Partner Code | Unik per Tenant; UUID primary key teknis. Perubahan code butuh permission khusus dan alias/history. | Modernize |
| Nomor per role | Employee Number, Customer Number, dan Vendor Number terpisah serta unik dalam Tenant. | Modernize |
| Data sensitif Employee | Permission view/export khusus, akses diaudit, masked pada pencarian umum, dan template import sensitif terpisah. | Modernize |
| File | Epic 6 hanya metadata/slot dokumen; storage, versioning, retention, scanning, dan policy akses masuk session dokumen/file. | Boundary |
| Merge | Hanya Super Admin, same Tenant, preview dampak, resolusi konflik, audit, alias code, dan source merged tombstone. | Modernize |
| Split | Proses terkendali: record baru, relasi dipilah secara audited, transaksi final dilindungi, Admin Tenant mengusulkan, Super Admin mengeksekusi. | Modernize |

Contoh nomor:

```text
Business Partner Code : BP-000123
Employee Number       : EMP-00045
Customer Number       : CUS-00031
Vendor Number         : VEN-00088
```

##### Putaran 9 — Tax Registration dan alamat pajak

| Topik | Keputusan | Penanda |
|---|---|---|
| Cardinality | Business Partner dan Legal Entity masing-masing mendukung 0 sampai banyak Tax Registration. | Modernize |
| Customer/Vendor | Tidak memiliki Tax ID sendiri; memakai Tax Registration Business Partner. | Adopt |
| Indonesia | Nomor Pokok Wajib Pajak pusat dan Nomor Identitas Tempat Kegiatan Usaha disimpan sebagai jenis Tax Registration berbeda. | Modernize |
| Nomor Pokok Wajib Pajak pusat | Satu pihak Indonesia hanya boleh punya satu yang aktif. Pengecualian memerlukan override Super Admin, reason, dan audit. | Modernize |
| Alamat pajak | Setiap Tax Registration aktif wajib mempunyai registered address yang sesuai. Address memakai effective period; alamat lama tidak ditimpa. | Modernize |
| Resolusi transaksi | Berdasarkan Legal Entity, Business Partner, role Customer/Vendor, address/location, dan tanggal transaksi. | Modernize |
| Snapshot | Dokumen final menyimpan snapshot nomor dan alamat pajak. | Modernize |
| Import/export | Template Business Partner mencakup Address dan Tax Registration; kegagalan diproses per aggregate. | Modernize |
| Rekonsiliasi model lama | Tidak dibahas dalam roadmap Epic 6; ditangani saat desain implementasi terpisah. | Boundary |

Kandidat uniqueness default:

```text
jurisdiction + tax_type + normalized_registration_number
```

Satu Tax Registration aktif utama berlaku per owner, jurisdiction, tax type, dan periode aktif. Pemilihan detail nomor pajak pada transaksi diselesaikan pada Epic Finance; Epic 6 menyiapkan master, relasi, histori, dan snapshot contract.

#### Prinsip yang mengikat Epic 6

1. **Business Partner adalah canonical party.** User, Employee, Customer, Vendor, dan Contact tidak menjadi sumber identitas yang saling bersaing.
2. **Business Partner dibuat lebih dahulu.** User, Employee, Customer, Vendor, Contact, dan Integration User tidak berdiri tanpa Business Partner yang sesuai.
3. **Employee adalah role Business Partner Individual.** Employee Profile menyimpan data Human Resources Information System.
4. **Customer dan Vendor adalah role.** Satu pihak dapat menjalankan keduanya tanpa duplikasi master.
5. **User adalah akun login opsional.** User tidak membuktikan hubungan kerja atau bisnis; relasi Business Partner/Contact yang membuktikannya.
6. **Placement bukan authorization.** Department dan placement dipakai untuk operasi/reporting; akses tetap melalui Role Assignment.
7. **Permission dan Data Scope berasal dari assignment yang sama.** Assignment berbeda tidak digabung untuk memperbesar authority.
8. **Riwayat tidak ditimpa.** Placement, role profile, address, dan Tax Registration memakai effective date serta audit.
9. **Dokumen final memakai snapshot.** Perubahan master data tidak mengubah bukti historis transaksi final.
10. **Import tidak menjadi jalur pembuatan credential atau authority.**
11. **Data sensitif Employee dipisahkan dari projection/export umum.**
12. **Tax ID adalah collection, bukan scalar tunggal.**
13. **Merge/split tidak menulis ulang dokumen final tanpa proses dan audit yang sah.**

#### Basis iDempiere dan regulasi pajak Indonesia

| Konsep | Bukti | Terjemahan Abixell One | Penanda |
|---|---|---|---|
| Business Partner sebagai party | `C_BPartner` mempunyai flag Customer, Vendor, Employee, SalesRep, dan Prospect | Business Partner canonical bertipe Individual/Organization. | Adopt |
| User terkait Business Partner | `AD_User.C_BPartner_ID` | User menjadi akun login opsional terkait Business Partner Individual atau Contact. | Adopt/Modernize |
| Banyak User/Contact | `MUser.getOfBPartner(...)` dan User/Contact Window | Business Partner Organization dapat memiliki banyak Contact; sebagian boleh punya User. | Adopt |
| Employee sebagai role | `C_BPartner.IsEmployee` | Employee role + Employee Profile. | Adopt |
| Business Partner Group | Business Partner Group Window | Satu group utama; klasifikasi tambahan multi-value. | Adopt/Modernize |
| Tax ID iDempiere | `C_BPartner.TaxID` scalar | Dimodernisasi menjadi Tax Registration collection. | Modernize |
| NPWP/NITKU | Sumber resmi Direktorat Jenderal Pajak | Satu NPWP pusat aktif per pihak sebagai default; NITKU membedakan tempat kegiatan usaha dan terkait address. | Modernize |

Sumber resmi yang diverifikasi:

- `https://wiki.idempiere.org/en/Business_Partner_(Window_ID-123)`
- `https://wiki.idempiere.org/en/Business_Partner_Group_(Window_ID-192)`
- `https://wiki.idempiere.org/en/User_(Window_ID-108)`
- `https://wiki.idempiere.org/en/Contact_(Window_ID-53152)`
- `https://raw.githubusercontent.com/idempiere/idempiere/master/org.adempiere.base/src/org/compiere/model/MUser.java`
- `https://raw.githubusercontent.com/idempiere/idempiere/master/org.adempiere.base/src/org/compiere/model/MBPartner.java`
- `https://raw.githubusercontent.com/idempiere/idempiere/master/org.adempiere.base/src/org/compiere/model/I_AD_User.java`
- `https://raw.githubusercontent.com/idempiere/idempiere/master/org.adempiere.base/src/org/compiere/model/I_C_BPartner.java`
- `https://pajak.go.id/id/artikel/coretax-djp-era-npwp-16-digit`
- `https://www.pajak.go.id/id/reformdjp/faq`
- `https://pajak.go.id/id/peraturan/penggunaan-nomor-induk-kependudukan-sebagai-nomor-pokok-wajib-pajak-nomor-pokok-wajib`
- `https://www.pajak.go.id/id/artikel/mengenal-nitku-pengganti-npwp-cabang`

#### Model target

```text
Business Partner
├── identity: UUID, Tenant, code, type, name, lifecycle
├── role profiles
│   ├── Employee Profile
│   ├── Customer Profile
│   ├── Vendor Profile
│   └── role profiles lain
├── Contacts → optional Users
├── Addresses
├── Tax Registrations
├── Classifications
└── Alias / merge history

User
└── Role Assignments
    └── Role + Tenant + Scope Type + Scope Target + effective period
```

Employee flow:

```text
Business Partner Individual
  → Employee role
  → Employee Profile
  → primary placement
  → optional User
  → optional Role Assignment
```

External access flow:

```text
Business Partner Organization
  → Contact
  → optional User
  → External Role Assignment scoped to Business Partner/resource
```

Tax Registration minimal memuat owner type/id, jurisdiction, tax type, normalized registration number, issuing authority, registered address, effective range, status, primary flag, verification status, supporting document reference, dan audit fields.

#### Mekanisme desain

##### A. Business Partner dan role profile

Business Partner menyimpan identitas stabil: UUID, Tenant, code unik, type Individual/Organization, nama, group utama, lifecycle, audit, alias, dan tombstone metadata. Role profile hanya menyimpan data khusus domain. Menambah Customer/Vendor/Employee tidak membuat salinan identitas pihak.

##### B. Employee Profile dan placement

Employee Profile hanya untuk Business Partner Individual. Minimal menyimpan Employee Number, employment type/status, joined/ended date, primary Organization Unit/Department/position, placement history, secondary placement terbatas, dan metadata dokumen. Data sensitif memiliki permission khusus.

Mutasi lintas Organization Unit, Department, atau Legal Entity memakai effective date dan reason. Mutasi tidak otomatis mengubah Role Assignment.

##### C. Contact, User, dan undangan

Contact berada di bawah Business Partner Organization dan dapat mempunyai banyak purpose. User internal terkait Business Partner Individual Employee; User eksternal terkait Contact; Integration User terkait Business Partner Organization Integration/System Partner. User dibuat melalui undangan, bukan import bisnis.

##### D. Role Assignment

Role Assignment memuat `user_id`, `role_id`, `scope_type`, `scope_target_id`, `effective_from`, `effective_to`, status, reason, actor, dan audit. Setiap authorization check memakai satu assignment utuh. Login context memilih assignment aktif; multi-assignment tidak berarti gabungan kewenangan.

##### E. Import/export

Import memproses aggregate Business Partner beserta role profiles, Contacts, Addresses, Tax Registrations, placement, dan classifications. Satu bagian wajib gagal berarti aggregate itu rollback; aggregate lain tetap dapat berhasil. File hasil validasi memuat lokasi sumber dan error terarah. Export tunduk pada permission, Data Scope, masking, audit, dan formula-injection guard.

##### F. Merge/split

Merge memilih target canonical, menampilkan preview dampak, menyelesaikan konflik, menjadikan source merged tombstone, dan menyimpan code lama sebagai alias. Split membuat Business Partner baru dan memilah relasi secara audited. Dokumen final tetap menjaga snapshot historis.

##### G. Tax Registration

Tax Registration adalah child collection milik Business Partner atau Legal Entity. Customer/Vendor memakai milik Business Partner. Setiap registrasi aktif terkait registered address yang sesuai dan effective period. Dokumen transaksi final menyimpan snapshot nomor dan alamat yang dipilih.

##### H. File dan data sensitif

Epic 6 hanya menyiapkan metadata/reference. File bytes, object storage, scanning, encryption, versioning, expiry, retention, download policy, dan approval file menunggu session dokumen/file. Field sensitif Employee tidak boleh masuk projection umum.

#### Gelombang pengerjaan Epic 6

**Gelombang 0 — Kontrak dan migrasi aman**

1. Tetapkan istilah canonical dan cardinality.
2. Inventaris resource/table/permission terkait identity tanpa destructive migration.
3. Tetapkan field sensitivity dan audit contract.
4. Susun compatibility/reconciliation plan dalam desain implementasi terpisah.

**Gelombang 1 — Business Partner foundation**

5. Bangun Business Partner Individual/Organization dan lifecycle.
6. Tambahkan role profiles, Contact, Address, Business Partner Group, classifications, alias/history.
7. Terapkan aturan Business Partner lebih dahulu sebelum User/role bisnis.

**Gelombang 2 — Employee dan placement**

8. Tambahkan Employee Profile serta nomor Employee.
9. Tambahkan primary/secondary placement effective-dated lintas Organization Unit, Department, dan Legal Entity.
10. Terapkan User review/suspend saat Employee Ended atau Contact Inactive.

**Gelombang 3 — User dan Role Assignment**

11. Tambahkan User type, invitation lifecycle, Role category, dan assignment lifecycle.
12. Tambahkan external/integration identity chain.
13. Terapkan delegation guardrail dan same-assignment enforcement.

**Gelombang 4 — Tax Registration, import/export, merge/split**

14. Tambahkan Tax Registration collection untuk Business Partner dan Legal Entity.
15. Sediakan template Excel `.xlsx` dan CSV sebelum import.
16. Implement partial success per aggregate dan file hasil validasi.
17. Tambahkan proposal/preview/execute merge dan split dengan audit.
18. Verifikasi authorization, lifecycle, import/export security, field masking, tax history, transaction snapshot, dan cross-tenant isolation pada database uji terpisah.

#### Konsistensi dan serah terima lintas Epic

| Epic | Kontrak Epic 6 | Dampak/aksi |
|---|---|---|
| Epic 1 — Security Context | Actor/login context membawa assignment aktif. | Permission dan Data Scope tidak digabung lintas assignment. |
| Epic 2 — Application Dictionary | Business Partner, role profiles, Contact, placement, Tax Registration, import/export, dan sensitive fields perlu metadata. | Metadata harus tersedia sebelum UI/configuration. |
| Epic 3 — Module & Menu | Menu hanya presentasi. | Internal/external/integration surfaces tidak menjadi security boundary. |
| Epic 4 — User, Role & Permission UI | Assignment menampilkan lifecycle, expiry, reason, type, dan scope target. | Admin Tenant tunduk pada delegation guardrail. |
| Epic 5 — Company/Tenant/Organization | Legal Entity, Organization Unit, dan Department dipakai placement/Tax Registration. | Department tetap bukan Data Scope. |
| Epic 7 — Document Engine | Dokumen final menyimpan snapshot Business Partner, address, Tax Registration, dan actor relevan. | Master-data change tidak menulis ulang dokumen final. |
| Epic 8 — Parameter Setup | Expiry, import policy, tax validation, dan backdate limits dapat menjadi parameter. | Parameter tidak boleh melewati security guardrail. |
| Epic 9 — Workflow | Merge/split, exceptional tax override, dan assignment approval dapat memakai workflow formal. | Epic 6 hanya menetapkan domain, authority, dan audit minimum. |
| Epic 10 — Password, Session & User Security | Credential policy, lockout, password history, dan session hardening. | Epic 6 hanya menetapkan User identity/invitation boundary. |
| Epic 12 — Reporting/Notification | Expiry, review date, dan import result dapat memicu reporting/notifikasi. | Detail scheduler/notifikasi menunggu Epic 12. |
| Session dokumen/file | Supporting file Employee, Business Partner, dan Tax Registration. | Epic 6 hanya metadata/reference. |

#### Di luar cakupan Epic 6

- Customer portal, menu final user eksternal, dan detail Customer Scope pada Service Operation.
- Payroll, attendance, benefits, appraisal, atau fitur Human Resources Information System rinci.
- Tax calculation, e-Faktur, withholding tax, finance posting, atau compliance negara rinci.
- Password rule, password history, lockout, dan session hardening.
- Workflow formal merge/split, assignment, dan tax override.
- File storage, scan, encryption, versioning, retention, serta download policy.
- Rekonsiliasi schema/model lama; dibahas saat desain implementasi terpisah.

#### Item terbuka Epic 6

| # | Item | Perlu |
|---|---|---|
| 1 | Katalog final field sensitif Employee dan masking export | Interview Human Resources Information System/compliance |
| 2 | Permission catalog External/Integration Role dan resource-area scope | Epic 4, Customer Scope, dan Epic 10 |
| 3 | Default expiry Role Assignment, review cadence, dan notifikasi | Epic 8 dan Epic 12 |
| 4 | Format final template per jenis import | Desain implementasi dan contoh file |
| 5 | Validasi Tax Registration per negara/tax type | Finance/tax/compliance interview |
| 6 | Workflow approval merge/split dan exceptional multiple NPWP pusat | Epic 9 |
| 7 | File policy untuk Employee, Business Partner, dan Tax Registration | Session dokumen/file |
| 8 | Journey/menu user eksternal | Session Customer Scope / Service Operation |

#### Strategi mitigasi risiko Epic 6

| Risiko | Dampak | Mitigasi wajib | Bukti selesai |
|---|---|---|---|
| Duplikasi Customer/Vendor/Employee | Master pihak pecah | Business Partner wajib sebelum role; merge/split audited | Satu Business Partner dapat memegang beberapa role |
| Employee dipaksa punya login | HR data tercampur credential | User opsional dan model terpisah | Employee aktif tanpa User valid |
| External User mendapat role internal | Kebocoran akses | User type, Role category, delegation guardrail | Assignment tidak kompatibel ditolak |
| Permission/scope digabung lintas assignment | Privilege escalation | Same-assignment check | Test assignment silang gagal authorize |
| Department menjadi security boundary | Akses salah | Department hanya placement/reporting | Authorization tidak menerima Department scope |
| Mutasi placement mengubah akses | Authority berubah tanpa approval | Tidak ada auto-update Role Assignment | Mutasi tidak mengubah permission |
| Import membuat credential/authority | Security bypass | Larang User, Role Assignment, password, token, secret | Parser/template menolak field tersebut |
| Partial success membuat data setengah | Aggregate rusak | Transaction per aggregate | Aggregate gagal rollback |
| Tax ID scalar | Registrasi/alamat salah | Collection + effective address | NPWP pusat dan beberapa NITKU dapat dimodelkan |
| Master change mengubah dokumen final | Bukti legal rusak | Snapshot | Dokumen final tetap menampilkan data saat finalisasi |
| Merge/split merusak histori | Referensi hilang | Preview, tombstone, alias, audit | Histori tetap dapat dijelaskan |
| Supporting file tanpa policy | Kebocoran data | Metadata saja sampai file policy siap | Tidak ada upload production sebelum gate file |

#### Gate sebelum Epic 6 dinyatakan selesai

- Business Partner canonical mendukung Individual dan Organization.
- Business Partner wajib ada sebelum User, Employee, Customer, Vendor, Contact, atau Integration User.
- Employee adalah role Business Partner Individual dengan Employee Profile.
- Customer, Vendor/Supplier, Service Provider, Outsourcing Provider, Salesperson, dan Prospect menjadi role Business Partner.
- Employee tanpa User dan Contact tanpa User valid.
- User type dan Role category membatasi assignment yang sah.
- Undangan User memakai token sekali pakai dan lifecycle terkunci.
- Role Assignment memiliki lifecycle, effective period, reason, revocation, dan audit.
- Permission dan Data Scope berasal dari assignment yang sama.
- Admin Tenant tidak dapat self-assign atau memberi authority lebih luas.
- Department bukan Data Scope; placement tidak otomatis memberi akses.
- Tepat satu primary placement aktif; secondary terbatas dan effective-dated.
- Business Partner Code unik per Tenant; nomor Employee/Customer/Vendor terpisah.
- Data sensitif Employee tidak tampil dalam projection/export umum.
- Template Excel `.xlsx` dan CSV tersedia sebelum import.
- Import partial success berjalan per aggregate dan mengembalikan file hasil validasi.
- Import tidak membuat credential, token, secret, User, atau Role Assignment.
- Business Partner dan Legal Entity mendukung Tax Registration collection serta registered address yang sesuai.
- Default Indonesia: satu NPWP pusat aktif per pihak; NITKU menjadi jenis registrasi terpisah per lokasi.
- Dokumen final menyimpan snapshot party, nomor, dan alamat pajak.
- Merge/split dieksekusi Super Admin dengan preview, audit, tombstone/alias, dan perlindungan transaksi final.
- Seluruh test memakai database terisolasi, bukan `abixell_one_dev`.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci domain dan security boundary; tidak memberi persetujuan migration atau perubahan backend sekarang.
- Rekonsiliasi tabel/model existing dilakukan dalam plan implementasi terpisah setelah scope verdict dan persetujuan eksplisit.
- Suite test tidak boleh diarahkan ke `abixell_one_dev` karena konfigurasi test lokal diketahui dapat meninggalkan data Tenant.
- Validasi pajak per negara tetap memerlukan review Finance/tax/compliance sebelum production.

---

### 4.7 EPIC 7 — Document Engine & Transaction Lifecycle

#### Problem statement

Entitas transaksional inti (`work_orders`, `complaints`, `service_acceptances`, `disposals`, dan modul WMS/Procurement) butuh siklus hidup dokumen formal — bukan CRUD bebas. Dokumen berpindah Draft → In Progress → Complete, field kunci terkunci setelah Complete, dan efek samping (perubahan stok, kewajiban akuntansi) tercatat dengan jejak audit. Tanpa engine ini, setiap modul menulis ulang logic status sendiri secara inkonsisten, dan tiga kontrak yang sudah dijanjikan epic sebelumnya — konvensi *document user* (Epic 1), kontrak Backdate Transaction (Epic 5), dan snapshot dokumen final (Epic 6) — tidak punya tempat implementasi.

#### Keputusan terkunci (2026-09-24)

1. **Registrasi tipe dokumen metadata-driven.** Tabel `document_types` menyimpan konfigurasi per tipe (kode, nama, base type, modul pemilik, wajib approval, boleh re-activate). Engine membaca tabel ini saat runtime, tidak hardcode per tipe.
2. **Nomor dokumen dari sequence table server-side.** Tabel `document_sequences` menyimpan counter per tipe per tahun; nomor final diisi saat transisi ke Complete, bukan saat draft dibuat. *(Revisi 2026-09-25: sequence key diperluas menjadi `(document_type_id, document_code_id, period_yyyymm)` sesuai Epic 8 decision #5; lihat §4.8.)*
3. **Approval dan Backdate Transaction satu keputusan.** Saat dokumen menunggu approval (status `IP`, `is_approved = false`), data backdate (jika ada) ikut tampil ke approver dalam satu keputusan yang sama. Struktur node approval detail milik Epic 9.
4. **Snapshot dokumen final hybrid.** Field yang sering di-query (Business Partner ID, nama, jumlah) didenormalisasi jadi kolom sendiri; field audit tambahan (aktor, catatan, detail alamat/Tax Registration) disimpan sebagai JSON di kolom `snapshot_extra`.
5. **Posting akuntansi: kontrak dan waktu saja, bukan mesin akuntansi.** Epic 7 menyediakan kolom `posted` (`N`/`Y`/`E`), pemicu saat Complete, dan penanganan gagal — tanpa membangun pemetaan akun GL atau jurnal. Isi akuntansi menjadi tanggung jawab **Epic 14 — Finance & Accounting Posting** (baru, lihat baris Epic 14 di Epic Register).
6. **Void dan Close dibangun sekarang; Reverse Correct/Reverse Accrual ditunda.** Epic 7 tidak menyediakan cara resmi membalik dokumen yang sudah Complete dan sudah diposting. Reverse menjadi prasyarat Epic 14.
7. **Kolom `doc_user_id` dilengkapi di seluruh tabel dokumen.** `service_acceptances` dan `disposals` mendapat kolom ini sebagai prasyarat sebelum engine berjalan di kedua tabel — menutup celah yang dibiarkan terbuka di Epic 1.
8. **Koreksi dokumen Complete lewat Re-activate, dibatasi status posting.** `CO → IP` (Re-activate) hanya diizinkan jika `posted = 'N'`. Jika `posted = 'Y'`, Re-activate diblokir dengan pesan eksplisit: koreksi menunggu Reverse (Epic 14).
9. **Cakupan Epic 7 dibatasi ke 4 tabel dokumen yang sudah ada** (`work_orders`, `complaints`, `service_acceptances`, `disposals`) plus kontrak pendaftaran modul baru — modul yang belum dibangun (HSE, Education, dll.) mendaftar ke `document_types` saat modulnya sendiri dieksekusi, tanpa mengubah engine.
10. **Batas Epic 7 vs Epic 8:** Epic 7 membangun mesin (tabel, fungsi transisi, sequence). Epic 8 membangun UI konfigurasi (atur pola nomor, prefix, kelola `document_types` per modul).
11. **Backdate disimpan di tabel terpisah `document_backdate`**, bukan kolom di setiap tabel dokumen — satu tempat audit, tidak terduplikasi.
12. **State instance dokumen disimpan sebagai kolom di tabel dokumen masing-masing** (`doc_status`, `doc_action`, dll.) — bukan tabel header pusat. Konsisten dengan skema modul yang sudah ada; menghindari migrasi besar dan join tambahan di semua jalur baca.
13. **Lock saat Complete terbatas ke field kunci** (nomor, tanggal, jumlah, pihak terkait) — field administratif (catatan internal, tag) tetap bisa diubah.
14. **Concurrency dirancang untuk multi-instance sejak awal.** Kolom `processing` tetap ada untuk pesan UI, tetapi penjagaan sebenarnya memakai row lock database (`SELECT ... FOR UPDATE`) — bukan flag kolom sebagai satu-satunya lock, seperti kelemahan yang dicatat di riset iDempiere.
15. **Posting gagal tidak membatalkan Complete.** `posted = 'E'`, dokumen tetap Complete; kegagalan akuntansi tidak boleh membatalkan kejadian operasional yang sudah benar-benar terjadi. Termonitor lewat layar "Dokumen Belum Terposting" (Epic 12).

#### Binding principles

- Dokumen adalah *state machine* eksplisit, bukan implicit dari flag boolean tersebar.
- Setelah Complete, field kunci dokumen tidak bisa diedit langsung — hanya lewat aksi resmi (Void, Close, Re-activate terbatas).
- Backdate Transaction dan approval selalu diperiksa bersamaan sebelum status berpindah ke Complete.
- Snapshot dokumen final tidak pernah ditulis ulang oleh perubahan master data belakangan — mengikat prinsip #9 Epic 6.
- Tidak ada mesin akuntansi dibangun tanpa pemilik (epic Finance) — Epic 7 berhenti di kontrak dan waktu.

#### iDempiere basis (terverifikasi terhadap source resmi)

| Konsep | Sumber terverifikasi | Diadopsi/dimodifikasi |
|---|---|---|
| Interface `DocAction` (konstanta aksi & status) | `org.compiere.process.DocAction` (raw GitHub, dicek langsung) | Adopt konstanta `DR/IP/CO/CL/VO/IN`; `RE`(Reversed)/`WP`/`WC` ditunda |
| `getDoc_User_ID()` | `DocAction.java` — dokumen punya "document owner" terpisah dari `created_by` | Adopt — dipetakan ke kolom `doc_user_id` |
| Orkestrasi transisi status | `org.compiere.process.DocumentEngine` | Adopt konsep; matriks transisi disederhanakan (lihat §4.7, sub "State machine") |
| Kolom wajib dokumen (`DocumentNo`, `DocStatus`, `Processing`, `IsApproved`, `Posted`) | Riset lokal `09-document-engine.md` §5, cross-check `X_C_DocType` source | Adopt, dengan penambahan `document_type_id`, `reversal_id` |
| Void vs Close vs Reverse semantics | Riset lokal `09-document-engine.md` §8 | Void + Close diadopsi; Reverse Correct/Accrual ditunda ke Epic 14 |
| `Processing` flag sebagai lock | Riset lokal §9 — dicatat sebagai kelemahan untuk sistem multi-instance | Modifikasi: kolom tetap ada untuk UI, lock sebenarnya via row lock database |
| Posting sinkron vs asinkron (`AutoPost`) | Riset lokal §6.3 | Adopt asinkron sebagai default; kontrak waktu saja di Epic 7 |

#### Tabel & kolom baru

**Tabel baru:**

| Tabel | Fungsi |
|---|---|
| `document_types` | Registry tipe dokumen: kode, nama, base type, modul pemilik, wajib approval, boleh re-activate |
| `document_sequences` | Counter nomor dokumen per tipe per kode per bulan (key: `document_type_id`, `document_code_id`, `period_yyyymm`), pola `{prefix}-{MM}{YY}-{code3}{num4}` — revisi dari Epic 8 |
| `document_backdate` | Audit backdate: tipe & ID dokumen asal, `transaction_date`, `backdate_date`, alasan, referensi lampiran, siapa minta, status approval. *(Revisi 2026-09-25: kolom `approval_instance_id` ditambahkan oleh Epic 9 — keputusan backdate ditautkan ke `approval_instances`, bukan lagi status terpisah; lihat §4.9.)* |

**Kolom baru di `work_orders`, `complaints`, `service_acceptances`, `disposals`:**

`document_no`, `document_type_id`, `doc_status`, `doc_action`, `processed`, `processing`, `is_approved`, `posted`, `reversal_id` (kosong sampai Epic 14), `doc_user_id` (baru khusus `service_acceptances`/`disposals`), `bp_id_snapshot`, `bp_name_snapshot`, `amount_snapshot`, `snapshot_extra` (JSON).

*(Revisi 2026-09-25 kedua — dari wawancara Epic 9.)* Kolom berikut ditambahkan ke keempat tabel dokumen: `approval_instance_id` (referensi ke instance approval yang sedang berjalan) dan kolom denormalisasi `last_approver_user_id`, `last_approval_datetime`, `last_rejection_reason`. Kolom `is_approved` yang sudah ada tetap, tetapi kini diisi oleh mesin approval Epic 9, bukan oleh UI. Alasan denormalisasi: daftar dokumen perlu menampilkan status approval tanpa join ke `approval_tasks`, dan `last_rejection_reason` harus terbaca oleh submitter tanpa membuka riwayat. Lihat §4.9.

#### State machine — cakupan Epic 7

Status aktif: `DR` (Drafted) → `IP` (In Progress) → `CO` (Completed) → `CL` (Closed); jalur gagal `DR`/`IP` → `IN` (Invalid) → kembali via Unlock; jalur batal `DR`/`IP` → `VO` (Voided). `CO → IP` (Re-activate) hanya jika `posted = 'N'`.

Status ditunda (butuh Epic 14): `RE` (Reversed), `WP` (Waiting Payment), `WC` (Waiting Confirmation). Aksi ditunda: Post manual (`PO`), Reverse Correct (`RC`), Reverse Accrual (`RA`).

Approval memakai flag `is_approved`, terpisah dari `doc_status` — dokumen bisa `IP` sambil menunggu approval, persis pola iDempiere yang sudah diverifikasi.

#### Kontrak Backdate Transaction (implementasi dari Epic 5)

1. Checkbox default tidak dicentang; tanggal transaksi normal terisi.
2. Checkbox dicentang → `backdate_date` wajib, harus lebih awal dari tanggal transaksi.
3. Alasan/justifikasi wajib saat checkbox aktif; lampiran tersedia di dekatnya, bisa diwajibkan per modul.
4. Kalender memilih tanggal backdate tanpa mengubah tanggal transaksi normal secara diam-diam.
5. Baris backdate tersimpan di `document_backdate` saat dokumen masih `IP`, sebelum Complete.
6. Approver melihat data backdate dalam keputusan approval yang sama (binding principle #3 di atas).
7. Tanggal audit tidak pernah ikut di-backdate.
8. Siapa boleh mengajukan backdate ditentukan Super Admin / kebijakan modul (detail policy: Epic 8).

#### Cross-epic handoff

| Ke | Yang diserahkan Epic 7 |
|---|---|
| Epic 8 — Document Type, Numbering & Parameter Setup | UI konfigurasi `document_types`, pola nomor/prefix, parameter backdate per modul |
| Epic 9 — Workflow, Approval Matrix & Escalation | Titik integrasi approval + backdate; struktur node dan eskalasi jadi tanggung jawab Epic 9 |
| Epic 11 — Extension Hooks | Titik hook validator sebelum/sesudah transisi status; event saat Complete/Void/Close |
| Epic 12 — Reporting, Scheduler & Notification | Layar monitoring dokumen `posted = 'E'`; notifikasi kegagalan posting |
| **Epic 14 — Finance & Accounting Posting (baru)** | Kolom `posted`, `reversal_id`, dan kontrak waktu posting; Epic 14 mengisi pemetaan akun GL, jurnal, dan mekanisme Reverse Correct/Accrual |

#### Out-of-scope Epic 7

- Pemetaan akun GL, jurnal akuntansi, dan multi-accounting-schema — milik Epic 14.
- Reverse Correct dan Reverse Accrual — milik Epic 14.
- UI konfigurasi tipe dokumen dan parameter — milik Epic 8.
- Struktur node approval dan eskalasi — milik Epic 9.
- Modul yang belum dibangun (HSE, Education, dll.) — mendaftar ke `document_types` saat modulnya sendiri dieksekusi.

#### Open items

| # | Item | Perlu diselesaikan di |
|---|---|---|
| 1 | Detail pemetaan akun GL dan struktur jurnal | **Ditutup Epic 14 (2026-09-25).** Pemetaan akun = `finance_posting_rules` diisi admin tenant; struktur jurnal = `finance_journals` + `finance_journal_lines`. Lihat §4.14 keputusan #8 dan #9. |
| 2 | Mekanisme Reverse Correct/Accrual dan `reversal_id` linkage | **Ditutup Epic 14 (2026-09-25).** Kolom `reversal_id` mulai diisi; koreksi memakai Reverse Correct (tanggal asli) atau Reverse Accrual (tanggal berjalan), tertaut dua arah. Lihat §4.14 keputusan #11. |
| 3 | Struktur node approval untuk backdate + dokumen dalam satu keputusan | Epic 9 |
| 4 | Definisi "laporan sudah ditutup" saat backdate mengubah grouping historis (carry-over dari Epic 5 open item #2) | **Ditutup Epic 14 (2026-09-25).** Periode berstatus `closed`; status itu hanya dicapai setelah daftar periksa penutupan lulus. Lihat §4.14 keputusan #10. |
| 5 | Kebijakan siapa boleh backdate per modul | Epic 8 policy |

#### Risk mitigation

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kolom dokumen terduplikasi tiap tabel; modul baru = tambah kolom | Skema makin berat, migrasi berulang | Kontrak pendaftaran modul wajib; migrasi kolom jadi template terstandar |
| Reverse ditunda → dokumen Complete + posted mentok tanpa jalan koreksi | Operasional macet menunggu Epic 14 | Jalur Re-activate untuk `posted='N'`; pesan blokir eksplisit; Reverse jadi prasyarat gate Epic 14 |
| Posting asinkron gagal tanpa terlihat operator | Dokumen dianggap selesai padahal akuntansi belum jalan | Layar monitoring (Epic 12) + status `posted='E'` tampil di dokumen |
| Snapshot hybrid tidak konsisten antar modul | Audit trail BP/Tax Registration tidak lengkap di beberapa modul | Field snapshot wajib dideklarasikan di `document_types`; validasi saat transisi ke Complete |
| Row lock database belum terbukti di skala multi-instance nyata | Race condition saat load tinggi | Test concurrency eksplisit sebelum Epic 7 dianggap selesai |

#### Completion gate

Epic 7 dianggap selesai jika: (1) keempat tabel dokumen punya kolom lifecycle lengkap dan `doc_user_id`; (2) transisi `DR→IP→CO→CL` dan `VO`/Re-activate-terbatas berjalan dengan lock row-level; (3) `document_backdate` terisi dan tervalidasi sesuai kontrak Epic 5; (4) snapshot hybrid tersimpan saat Complete; (5) `posted='E'` terlihat dan tidak membatalkan Complete. Pemetaan akun GL, Reverse, dan UI konfigurasi **bukan** syarat selesai Epic 7 — itu milik Epic 14 dan Epic 8.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci kontrak dan domain; tidak memberi persetujuan migration atau perubahan backend sekarang.
- Rekonsiliasi skema tabel existing (`work_orders`, `complaints`, `service_acceptances`, `disposals`) dilakukan di plan implementasi terpisah setelah scope verdict dan persetujuan eksplisit.
- Riset iDempiere untuk Epic 7 diverifikasi terhadap source resmi (raw GitHub `DocAction.java`, `X_C_DocType.java`), bukan hanya catatan riset lokal.
- **Revisi 2026-09-25 (dari wawancara Epic 8):** kolom `document_code_id` ditambahkan ke keempat tabel dokumen. Lihat §4.8 untuk kontrak `document_codes` dan format nomor lengkap.
- **Revisi 2026-09-25 kedua (dari wawancara Epic 9):** kolom `approval_instance_id` ditambahkan ke keempat tabel dokumen **dan** ke `document_backdate`; kolom denormalisasi `last_approver_user_id`, `last_approval_datetime`, `last_rejection_reason` ditambahkan ke keempat tabel dokumen. Status approval di `document_backdate` tidak lagi berupa field mandiri — keputusan backdate ditautkan ke `approval_instances` yang sama dengan dokumennya. Lihat §4.9. Prinsip #3 Epic 7 (approval dan backdate satu keputusan) tetap utuh; yang berubah hanya cara menyimpannya.

---

### 4.8 EPIC 8 — Document Type, Numbering & Parameter Setup

#### Problem statement

Epic 7 membangun mesin transisi status dokumen dan menetapkan bahwa nomor dokumen diambil dari sequence server-side saat Complete. Yang belum ada: **siapa yang mengatur** tipe dokumen, bagaimana format nomor ditentukan, bagaimana satu tipe dokumen bisa melayani beberapa kategori transaksi, dan bagaimana parameter operasional (batas backdate, kewajiban lampiran) dikonfigurasi per modul tanpa menulis `if` per layar.

Epic 8 adalah epic **konfigurasi**, bukan epic mesin. Batasnya ditetapkan keputusan #10 Epic 7: Epic 7 memiliki tabel dan fungsi transisi; Epic 8 memiliki UI dan parameter.

Kebutuhan konkret yang memicu ruang lingkup ini: format nomor yang dipakai perusahaan tidak seragam dan tidak sederhana. Sebuah tipe dokumen harus bisa memuat **beberapa kode klasifikasi** yang berbagi prefix sama, dan nomor harus memuat periode agar mudah diarsipkan serta diurutkan per bulan.

#### Keputusan terkunci (2026-09-25)

1. **Registry tunggal, form per modul.** `document_types` tetap satu tabel pusat (warisan Epic 7 #1); tiap modul menambah field spesifiknya lewat satu kolom JSON `config_extra` dengan skema validasi per modul. Tidak ada kolom fisik tambahan per modul — itu yang memecah registry.
2. **Entitas `document_codes` baru — anak dari `document_types`.** Satu tipe dokumen boleh punya banyak kode. Kode adalah entitas, bukan konvensi penamaan, karena kode inilah yang menjadi kunci klasifikasi untuk pemetaan akun GL di Epic 14.
3. **Format nomor: `{prefix}-{MM}{YY}-{code3}{num4}`.** Contoh: `PO-0126-0100001`. Prefix tipe, periode bulan+tahun, kode 3 digit, sequence 4 digit.
4. **`MM`/`YY` diambil dari `transaction_date`**, bukan tanggal Complete dan bukan tanggal draft dibuat. Dokumen ber-`transaction_date` Januari tetap bernomor periode Januari walau di-Complete Februari — konsisten dengan kontrak backdate Epic 5/7.
5. **Reset counter bulanan per kode.** Kunci sequence menjadi `(document_type_id, document_code_id, period_yyyymm)`, bukan per tipe per tahun seperti tertulis di §4.7.
6. **Format ini preset default, bukan satu-satunya.** Builder penomoran tetap menyediakan preset lebih sederhana (numerik murni, prefix + numerik) untuk tipe yang tidak memerlukan kode atau periodisasi.
7. **Pattern builder terpandu, bukan free-text.** Admin memilih preset dan mengisi nilai; sintaks format Java tidak pernah ditulis langsung oleh admin. Setiap preset menampilkan pratinjau nomor contoh.
8. **Kode wajib.** Setiap tipe dokumen aktif memiliki minimal satu kode aktif. Tidak ada jalur "tipe tanpa kode".
9. **Kode unik per tipe, bukan lintas tipe.** `010` di bawah tipe Work Order bermakna berbeda dari `010` di bawah Complaint. Prefix sudah membedakan, jadi tidak ada kebutuhan menyeragamkan arti kode lintas modul.
10. **Unik nomor per (prefix, periode, kode)**, ditambah constraint unik penuh pada kolom `document_no` sebagai jaring pengaman. Validasi UI menolak dua tipe aktif yang memakai prefix sama.
11. **Optimistic numbering.** Nomor dikonsumsi saat Complete, tidak direservasi. Gap antar-nomor inheren dan **dicatat di tabel audit**, mengikuti pola iDempiere `AD_Sequence.IsAudited`. Tidak ada lock baris sequence — konsisten dengan keputusan #14 Epic 7 (rancangan multi-instance).
12. **Reset periode bersifat lazy**, dievaluasi saat generate nomor, bukan lewat job terjadwal. Deterministik di semua instance tanpa leader election.
13. **Lock field terbagi dua kelas setelah kode dipakai transaksi.** Field penomoran (`code`, `prefix`, template sequence, `start_no`, `increment_no`) terkunci; field aman (`name`, `description`) tetap editable. Rename label selalu boleh; kode itu sendiri tidak pernah berubah.
14. **Habis nomor 4 digit dalam satu bulan per kode → Complete diblokir.** Admin harus membuat kode baru atau menaikkan lebar digit untuk periode berikutnya. Format tidak pernah mengembang otomatis.
15. **`document_code_id` boleh kosong saat Draft, wajib terisi sebelum Complete.** Complete ditolak jika kode belum dipilih. Nomor baru terbit saat Complete, jadi pemilihan kode punya ruang sampai titik itu.
16. **Parameter backdate berjenjang System → Client → Organization.** Nilai paling spesifik menang. UI level Organization hanya terbuka untuk parameter bertanda `org_override_allowed = true`; parameter yang menyentuh guardrail audit/keamanan dipaksa Client-level atau lebih atas. UI selalu menampilkan **nilai efektif + level asal**.
17. **Pengelola konfigurasi: Super Admin saja** pada gelombang ini. Tidak ada delegasi Config Manager per modul.
18. **Peringatan dampak wajib sebelum simpan.** Perubahan pada field penomoran menampilkan ringkasan dampak ("tipe ini dipakai N dokumen; nomor baru akan memakai pola X") dan memerlukan konfirmasi eksplisit.
19. **Counter document dikonfigurasi di Epic 8, dieksekusi di Epic 11.** Epic 8 menyimpan peta tipe → tipe counter beserta aksi pemicunya (field `doc_action` pada relasi counter). Eksekusi pembuatan dokumen turunan menempel pada hook transisi status milik Epic 11.
20. **Otoritas approval backdate ditunda ke Epic 9.** Epic 8 hanya mengekspos saklar "backdate butuh approval Y/N" dan batas hari. Epic 9 mengisi siapa yang berwenang dan bagaimana eskalasinya. Alasan penundaan: menjawabnya sekarang menghasilkan dua sumber kebenaran otorisasi yang akan bertabrakan dengan graf approval Epic 9.
21. **Export/import JSON dengan `schema_version` + checksum.** Isi ekspor: `document_types` + `document_codes` + definisi struktur `document_sequences`. Nilai `current_next` **tidak** ikut — counter aktif tetap lokal per tenant tujuan.
22. **Epic 8 hanya mengontrak core registry.** Modul masa depan (termasuk Procurement/PO yang dipakai sebagai ilustrasi format, bukan cakupan) mendaftarkan tipe dan kodenya lewat kontrak registrasi yang sama. Epic 8 tidak mendaftarkan modul yang belum dibangun.

#### Prinsip yang mengikat

- **Konfigurasi tidak boleh melewati guardrail.** Parameter dapat diubah admin, tetapi parameter yang menyentuh keamanan/audit dipaksa ke level konfigurasi yang lebih tinggi. Ini prinsip yang sama dengan yang sudah tercatat di §3 untuk Epic 8.
- **Engine tidak boleh bergantung pada bentuk UI.** Preset dibangun UI, tetapi yang tersimpan dan dieksekusi engine adalah pola kanonik. Mengubah UI tidak boleh mengubah arti data yang sudah ada.
- **Nomor dokumen adalah artefak historis.** Sekali terbit, ia tidak berubah. Yang boleh berubah adalah label manusianya.
- **Gap nomor bukan cacat; gap yang tidak terjelaskan adalah cacat.** Setiap konsumsi nomor tercatat.
- **Satu tipe dokumen, banyak kode** adalah model data, bukan trik penamaan. Kode yang bermakna sendiri layak jadi entitas.
- **UI konfigurasi adalah permukaan authoring utama.** Berkas ekspor adalah jalur reproduksi (kloning tenant, pemulihan bencana), bukan jalur kerja harian.

#### Basis iDempiere (terverifikasi terhadap source resmi)

| Konsep iDempiere | Sumber terverifikasi | Adopsi untuk Epic 8 |
|---|---|---|
| `AD_Sequence` — generator nomor | raw GitHub `X_AD_Sequence.java` (Release 13): `CurrentNext`, `CurrentNextSys`, `StartNo`, `IncrementNo`, `IsAutoSequence`, `IsOrgLevelSequence`, `StartNewMonth`, `DateColumn`, `DecimalPattern`, `IsAudited` | Adopt sebagian: pola nomor, increment, audit konsumsi. `IsOrgLevelSequence` menjadi rujukan bahwa sequence boleh berjenjang per organisasi |
| `AD_Sequence.StartNewMonth` | raw GitHub `X_AD_Sequence.java` — flag reset berbasis bulan | **Adopt langsung** — mendukung keputusan reset bulanan (#5) |
| `AD_Sequence.IsAudited` | raw GitHub `X_AD_Sequence.java` — "Activate Audit Trail of what numbers are generated" | **Adopt langsung** — mendukung keputusan pencatatan gap (#11) |
| `AD_Sequence.DecimalPattern` + `DateColumn` | raw GitHub `X_AD_Sequence.java` — pola Java DecimalFormat dan kolom tanggal sumber | Adopt konsepnya, **modifikasi bentuk**: admin memakai preset terpandu, bukan menulis pola langsung (#7) |
| `C_DocType` — registry tipe dokumen | raw GitHub `X_C_DocType.java`, dirujuk §4.7 | Adopt sebagai acuan `document_types` |
| `C_DocTypeCounter` — relasi tipe dokumen | raw GitHub `X_C_DocTypeCounter.java`: `C_DocType_ID`, `Counter_C_DocType_ID`, `IsCreateCounter`, `IsValid`, dan **`DocAction`** (aksi yang diterapkan ke dokumen turunan) | Adopt strukturnya; eksekusi ditunda ke Epic 11 (#19). Keberadaan field `DocAction` di tabel relasi memvalidasi bahwa aksi pemicu memang bagian dari konfigurasi, bukan dari mesin |
| `AD_SysConfig` + `ConfigurationLevel` | raw GitHub `X_AD_SysConfig.java`: `CONFIGURATIONLEVEL_System = "S"`, `CONFIGURATIONLEVEL_Client = "C"`, `CONFIGURATIONLEVEL_Organization = "O"`, plus `Name`, `Value`, `EntityType` | Adopt penuh untuk parameter berjenjang (#16) |
| `C_DocType` auto-generate flags (`IsAutoGenerateInout`, `IsAutoGenerateInvoice`) | raw GitHub `X_C_DocType.java`, dirujuk §4.7 | Ditunda — menunggu modul pemilik. Epic 8 hanya menyiapkan slot konfigurasi |
| Registry sebagai data, bukan kode | Riset lokal `08-application-dictionary.md` §1 "The Dictionary is the Application" | Adopt prinsipnya; aplikasi tetap menyimpan registry di tabel, bukan di file konfigurasi statis |

#### Mekanisme desain

**Format nomor.**

```
{prefix}-{MM}{YY}-{code3}{num4}

PO-0126-0100001
│   │  │  │   └── sequence, 4 digit, reset bulanan per kode
│   │  │  └────── kode dokumen, 3 digit (maks 999 kode per tipe)
│   │  └───────── tahun transaksi, 2 digit
│   └──────────── bulan transaksi
└──────────────── prefix tipe dokumen
```

Segmen kode dan sequence **digabung tanpa pemisah**, sehingga keduanya wajib berlebar tetap. Tanpa lebar tetap, string tidak dapat diurai balik. Konsekuensi yang diterima: kode maksimal `999`, sequence maksimal `9999` per kode per bulan. Jika volume bulanan sebuah kode melampaui 9999, jalur keluarnya adalah memecah ke kode baru, bukan mengubah lebar digit.

**Model data.**

Tabel baru:

| Tabel | Fungsi |
|---|---|
| `document_types` | Registry tipe dokumen: nama, `table_name` (modul pemilik), `prefix`, `config_extra` (JSON, extension per modul), status aktif |
| `document_codes` | Kode klasifikasi per tipe: `document_type_id`, `code` (3 digit), `name`, `description`, status aktif |
| `document_sequences` | Counter per `(document_type_id, document_code_id, period_yyyymm)`: `current_next`, `start_no`, `increment_no` |
| `document_sequence_audit` | Jejak konsumsi nomor: tipe, kode, periode, nomor terbit, dokumen asal, waktu, aktor |

Constraint:

- `document_codes`: unique `(document_type_id, code)`
- `document_sequences`: unique `(document_type_id, document_code_id, period_yyyymm)`
- Keempat tabel dokumen: unique pada `document_no`
- Validasi aplikasi: minimal satu kode aktif per tipe aktif; tidak ada dua tipe aktif dengan prefix sama

Kolom baru di `work_orders`, `complaints`, `service_acceptances`, `disposals`:

`document_code_id` (revisi §4.7 — sebelumnya hanya `document_type_id`)

**Siklus hidup kode dan nomor.**

```
Draft dibuat
  │  document_code_id boleh kosong
  │
  ├─ Kode dipilih (sebelum Complete)
  │
  └─ Complete
       ├─ transaction_date dibaca → periode MMYY
       ├─ engine cari/buat baris document_sequences untuk (tipe, kode, periode)
       ├─ current_next dibaca, nomor dibentuk, current_next diincrement
       ├─ nomor + doc_code_id disimpan
       └─ konsumsi dicatat di document_sequence_audit
```

Kegagalan Complete setelah nomor terbit meninggalkan gap. Gap adalah konsekuensi yang diterima dari keputusan #11; yang dijaga adalah setiap gap dapat dijelaskan lewat tabel audit. Retry Complete memakai nomor yang sama — operasi idempoten.

**Governance dan UI.**

- Halaman **Parameters** terpusat menampilkan seluruh parameter berjenjang dengan nilai efektif dan level asal; halaman tiap modul menyediakan tautan pintas ke parameter miliknya.
- Halaman **Document Types** menampilkan registry; form per modul menambah field spesifik lewat `config_extra`.
- Perubahan field penomoran pada tipe yang sudah dipakai memicu dialog konfirmasi dampak.
- Super Admin adalah satu-satunya peran pengelola pada gelombang ini.

**Counter document.**

Konfigurasi berupa peta: tipe sumber → tipe turunan → aksi pemicu (`doc_action` pada relasi counter, mengikuti bentuk `C_DocTypeCounter`). Epic 8 menyimpan dan memvalidasi peta ini; eksekusinya menempel pada hook transisi status Epic 11. Epic 8 tidak membuat dokumen turunan.

**Export/import.**

Berkas JSON dengan `schema_version` dan checksum. Isi: definisi `document_types`, `document_codes`, dan struktur `document_sequences` **tanpa** `current_next`. Untuk tenant yang sudah punya data dokumen lama, proses impor menawarkan pemindaian nomor lama sebagai saran `current_next`; admin wajib mengonfirmasi nilai final sebelum berlaku.

**Reusability.**

Kontrak registrasi menjadi satu-satunya jalur bagi modul untuk memiliki tipe dokumen. Modul yang belum dibangun tidak didaftarkan lebih awal; ia mendaftar saat modulnya dieksekusi, dengan kontrak yang sama.

#### Gelombang pengerjaan

| Gelombang | Isi | Prasyarat |
|---|---|---|
| 1 | Model data: `document_types`, `document_codes`, `document_sequences`, `document_sequence_audit`; kolom `document_code_id` di 4 tabel | Epic 7 gelombang 1 |
| 2 | Engine penomoran: pembentukan nomor dari pattern kanonik, reset bulanan lazy, pencatatan audit, penanganan tabrakan | Gelombang 1 + engine Complete Epic 7 |
| 3 | Parameter store berjenjang + resolusi level + tampilan nilai efektif | Gelombang 1 |
| 4 | UI: halaman Document Types, form per modul, pattern builder terpandu dengan pratinjau, halaman Parameters, dialog konfirmasi dampak | Gelombang 1–3 |
| 5 | Export/import + pemindaian nomor lama untuk onboarding | Gelombang 1–4 |
| 6 | Slot konfigurasi counter document (tanpa eksekusi) | Gelombang 1–4 |

#### Cross-epic handoff

| Ke | Yang diserahkan Epic 8 |
|---|---|
| **Epic 7 (revisi)** | Kolom `document_code_id` pada keempat tabel dokumen; kunci `document_sequences` yang diperluas dari per-tahun menjadi per-kode-per-periode |
| Epic 9 — Workflow, Approval Matrix & Escalation | Saklar "backdate butuh approval" dan batas hari per modul; Epic 9 mengisi kewenangan dan eskalasi |
| Epic 11 — Extension Hooks | Konfigurasi peta counter document beserta aksi pemicunya; Epic 11 mengeksekusi pembuatan dokumen turunan pada hook transisi status |
| Epic 12 — Reporting, Scheduler & Notification | Parameter notifikasi (ambang, penerima default) dan kebutuhan tampilan riwayat konsumsi nomor |
| Epic 14 — Finance & Accounting Posting | `document_codes` sebagai kunci klasifikasi untuk pemetaan akun GL (Asset / Consumable / Service Request berperilaku akuntansi berbeda) |
| Modul masa depan (Procurement, HSE, dll.) | Kontrak registrasi tipe dan kode dokumen |

#### Out-of-scope Epic 8

- Eksekusi pembuatan counter document — milik Epic 11.
- Otoritas approval backdate dan eskalasinya — milik Epic 9.
- Pemetaan akun GL dari `document_codes` — milik Epic 14.
- Delegasi Config Manager per modul — governance tetap Super Admin-only pada gelombang ini.
- Purchase Order dan modul Procurement — PO hanya dipakai sebagai ilustrasi format dalam wawancara; tidak diimplementasikan di Epic 8.
- Migrasi data dokumen lama secara otomatis — Epic 8 menyediakan saran `current_next`, bukan memigrasikan dokumen.

#### Open items

| # | Item | Perlu diselesaikan di |
|---|---|---|
| 1 | Ambang pasti "sudah ada transaksi" yang mengunci field penomoran (lebih dari nol? setelah Complete pertama?) | Desain gelombang 1 |
| 2 | Skema validasi `config_extra` per modul | Saat modul pertama memerlukan field custom |
| 3 | Definisi teknis preset kanonik yang disimpan vs bentuk preset di UI | Desain gelombang 4 |
| 4 | Kebijakan penanganan gap nomor pada laporan audit | Epic 12 |
| 5 | Nilai default dan satuan batas backdate per modul | Epic 9 (bersama kewenangan approval) |

#### Risk mitigation

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Satu admin mengubah prefix/pattern pada tipe yang sudah dipakai | Nomor baru tidak konsisten dengan riwayat; laporan lintas periode rusak | Field penomoran terkunci setelah dipakai (#13) + dialog konfirmasi dampak wajib (#18) |
| Dua tipe memakai prefix sama | Tabrakan nomor yang baru terdeteksi saat terbit | Validasi UI menolak prefix duplikat + constraint unik `document_no` sebagai jaring pengaman |
| Sequence 4 digit habis di bulan ramai | Complete gagal tanpa jalur keluar yang jelas | Complete diblokir dengan pesan eksplisit; jalur keluar memecah ke kode baru (#14) |
| Parameter berjenjang tanpa tampilan level asal | Admin mengubah nilai yang tidak berpengaruh karena ditimpa level lebih spesifik | UI wajib menampilkan nilai efektif + level asal (#16) |
| Import konfigurasi membawa `current_next` | Nomor bertabrakan di tenant tujuan | `current_next` dikecualikan dari ekspor (#21) + konfirmasi manual saat onboarding |
| Registry terpecah karena tiap modul menambah kolom fisik | `document_types` membengkak, registry kehilangan keseragaman | Extension hanya lewat `config_extra` (#1) |
| Format nomor mengembang otomatis saat digit habis | Parser, laporan, dan ekspor lama rusak diam-diam | Format tidak pernah mengembang sendiri; perubahan lebar digit adalah keputusan admin per periode |

#### Completion gate

Epic 8 dianggap selesai jika: (1) `document_types`, `document_codes`, `document_sequences`, dan `document_sequence_audit` terbentuk dengan constraint yang ditetapkan, dan kolom `document_code_id` ada di keempat tabel dokumen; (2) engine penomoran menghasilkan format `{prefix}-{MM}{YY}-{code3}{num4}` dari `transaction_date`, dengan reset bulanan per kode; (3) setiap konsumsi nomor tercatat di tabel audit; (4) parameter berjenjang berjalan dengan resolusi Organization → Client → System dan UI menampilkan nilai efektif beserta level asal; (5) halaman Document Types dan Parameters berjalan dengan pattern builder terpandu serta dialog konfirmasi dampak; (6) export/import JSON dengan `schema_version` dan checksum berjalan tanpa membawa `current_next`.

Eksekusi counter document, otoritas approval backdate, dan pemetaan akun GL **bukan** syarat selesai Epic 8 — itu milik Epic 11, Epic 9, dan Epic 14.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci kontrak dan domain; **tidak** memberi persetujuan migration atau perubahan backend.
- Format nomor dan struktur `document_codes` dikunci dari wawancara 2026-09-25. Contoh format `PO-0126-0100001` memakai PO semata sebagai ilustrasi; implementasi berlaku untuk keempat tabel dokumen Epic 7.
- Rekonsiliasi skema tabel existing dilakukan di plan implementasi terpisah setelah scope verdict dan persetujuan eksplisit.
- Riset iDempiere untuk Epic 8 diverifikasi terhadap source resmi (raw GitHub `X_AD_Sequence.java`, `X_C_DocTypeCounter.java`, `X_AD_SysConfig.java`), bukan hanya catatan riset lokal.

---

### 4.9 EPIC 9 — Workflow Engine, Approval Matrix & Escalation

#### Problem statement

Epic 1 sudah mengunci sumber kewenangan approval: role aktif, batas nominal, akumulasi, supervisor chain, dan larangan self-approval. Epic 7 sudah mengunci lifecycle dokumen serta prinsip bahwa approval dokumen dan Backdate Transaction adalah **satu keputusan**. Epic 8 sudah menyediakan `document_type_id`, `document_code_id`, dan parameter backdate. Yang belum ada adalah mesin yang menentukan **workflow mana yang berlaku, siapa approver aktualnya, kapan sebuah node selesai, apa yang terjadi ketika approver tidak lagi valid, dan bagaimana dokumen keluar dari keadaan menggantung**.

Tanpa Epic 9, flag `is_approved` hanya field tanpa sumber kebenaran. Logika approval mudah tersebar menjadi `if` per endpoint, delegasi tidak dapat diaudit, perubahan struktur organisasi dapat diam-diam mengubah approval yang sedang berjalan, dan timeout tidak mempunyai jalur eskalasi yang deterministik.

Epic 9 membangun graph workflow metadata-driven dan runtime approval yang menjadi satu-satunya sumber kebenaran untuk keputusan approval dokumen dan backdate. Epic ini **tidak** mengubah cara Epic 1 menghitung kewenangan dan tidak membangun kanal notifikasi Epic 12.

#### Keputusan terkunci (2026-09-25)

1. **Workflow dipilih dari tipe dokumen, lalu kode dokumen.** Default berasal dari `document_type_id`; konfigurasi pada `document_code_id` menjadi override yang lebih spesifik jika tersedia. Tidak ada pemilihan workflow bebas oleh submitter.
2. **Graph metadata-driven, bukan hardcode atau script bebas.** Workflow tersusun dari node dan transition yang disimpan sebagai data. Kondisi transition memakai field terstruktur yang dikenali engine—nominal, organization unit, document code, dan kondisi backdate—bukan JavaScript/SQL buatan admin.
3. **Approver di-resolve saat submit.** Hasil resolusi menjadi snapshot chain untuk instance tersebut. Engine hanya melakukan re-resolve saat action approval dipanggil dan approver tersimpan sudah tidak valid; membaca status tidak boleh mengubah chain.
4. **Mode approval per node: `ANY`, `ALL`, atau `SEQUENTIAL`.** `ANY` selesai dengan satu signature; `ALL` memerlukan semua signature; `SEQUENTIAL` juga memakai kelengkapan signature seluruh daftar, bukan urutan aksi yang kaku. Jika konfigurasi tidak lengkap, fallback konservatif adalah semua approver wajib menyetujui.
5. **Delegasi terjadwal dan berbatas.** Delegasi menyimpan delegator, delegate, rentang tanggal, cakupan document type/code/organization unit, batas nominal approval, alasan, status, dan audit. Delegate tidak pernah mendapat kewenangan melebihi delegator.
6. **Eskalasi dapat otomatis dan manual.** Eskalasi otomatis terjadi saat deadline node terlewati atau approver tidak tersedia; Admin dapat menjalankan eskalasi manual dengan alasan wajib. Setiap node menetapkan target dan perilaku ketika supervisor tidak ada.
7. **Backdate memakai workflow dokumen yang sama.** Kondisi tambahannya dapat memakai jumlah hari backdate, periode yang terdampak, batas nominal, dan otoritas minimum. Tidak ada workflow backdate paralel.
8. **`Reject` dan `Return for Correction` adalah dua action berbeda.** Keduanya wajib alasan dan menghentikan instance aktif agar dokumen dapat dikoreksi lalu diajukan ulang.
9. **Satu instance approval aktif per node per dokumen.** Keputusan dokumen dan backdate berada dalam instance dan task yang sama; tidak ada instance approval backdate terpisah.
10. **Transition node otomatis.** Setelah syarat node terpenuhi, sistem mengevaluasi condition dan memindahkan instance ke node berikutnya tanpa tombol "next node" untuk pengguna.
11. **Re-resolve hanya dipicu action.** Validitas approver diperiksa ketika Approve/Reject/Return dijalankan, bukan melalui polling, pembukaan halaman, atau pembacaan status.
12. **Delegasi kedaluwarsa tidak diperpanjang diam-diam.** Action diblokir jika approver tersimpan tidak lagi valid dan engine tidak menemukan pengganti sah. Admin harus memilih approver pengganti secara manual; perubahan itu masuk audit re-resolve.
13. **Reject tidak memalsukan status lifecycle.** Saat ditolak, `doc_action = 'RJ'`, sedangkan `doc_status` tetap `IP` (In Progress). Approval dan lifecycle tetap dua dimensi terpisah seperti kontrak Epic 7.
14. **Alasan penolakan punya source of truth dan salinan baca.** Source of truth berada di `approval_tasks.reason_code` + `reason_text` (lihat keputusan #28) beserta history; nilai terakhir disalin ke `last_rejection_reason` pada tabel dokumen untuk UI daftar/detail.
15. **`SEQUENTIAL` berarti kelengkapan signature, bukan urutan kaku.** Semua approver dalam daftar wajib memberi keputusan, tetapi action approver kedua tidak diblokir hanya karena approver pertama belum bertindak. Urutan tampilan tidak menjadi aturan otorisasi.
16. **Riwayat eskalasi disimpan per step.** Setiap perpindahan mencatat nomor step, approver asal, approver tujuan, alasan, dan waktu. Maksimum tiga level; setelah itu workflow menjalankan perilaku terkonfigurasi: auto-reject atau intervensi Admin.
17. **Definisi workflow memakai tiga tabel:** `workflows`, `workflow_nodes`, dan `workflow_node_transitions`.
18. **Runtime approval memakai dua tabel utama:** `approval_instances` untuk satu node aktif pada satu dokumen dan `approval_tasks` untuk satu approver pada instance tersebut.
19. **Backdate tidak membuat tabel approval baru.** Tabel `document_backdate` dari Epic 7 mendapat `approval_instance_id`; keputusan backdate mengikuti instance dokumen yang sama.
20. **Task menyimpan keputusan backdate bersama keputusan dokumen.** `approval_tasks` mempunyai `backdate_approved` dan `backdate_approval_comment`. Satu action approval mencakup keduanya.
21. **Re-resolve wajib dapat ditelusuri.** `approval_tasks` mempunyai `was_re_resolved`, `re_resolved_from_user_id`, `re_resolve_reason`, dan `re_resolve_datetime`.
22. **Delegasi disimpan terpisah dari hasil approval.** Tabel `approval_delegations` adalah konfigurasi reusable dengan scope dan masa berlaku; ia tidak dicampur ke `approval_tasks`.
23. **Eskalasi disimpan terpisah per perpindahan.** Tabel `approval_escalations` mempunyai satu baris per step agar rantai eskalasi dapat direkonstruksi tanpa menimpa task lama.
24. **Keempat tabel dokumen mendapat linkage dan denormalisasi.** `work_orders`, `complaints`, `service_acceptances`, dan `disposals` mendapat `approval_instance_id`; `is_approved` yang sudah ada diisi engine; kolom baca `last_approver_user_id`, `last_approval_datetime`, dan `last_rejection_reason` ditambahkan.
25. **Database trigger menggerakkan transition.** Update keputusan pada `approval_tasks` memicu evaluasi completion node dan condition transition di database. Application membaca definisi dan mengirim action, tetapi bukan application code atau scheduled job yang menentukan perpindahan node.
26. **Saat Reject atau Return for Correction, dokumen tetap status IP.** Creator dapat segera membuka dokumen untuk edit-in-place tanpa transisi ke Draft. Submission ulang membuat instance approval baru; tidak ada jalur bypass approver via Return.
27. **Keduanya (Reject dan Return for Correction) menghasilkan instance approval baru saat resubmit.** Tidak ada perbedaan rantai approver antara Reject dan Return — creator harus melalui approval dari awal lagi. Sebab penolakan dicatat sebagai field alasan untuk menginformasikan keputusan creator selanjutnya, bukan untuk menentukan jalur approval ulang.
28. **Alasan penolakan memakai kategori predefined + free text (kombinasi).** Engine menyediakan daftar kategori per document type (misal: "Revisi Required", "Budget Limit", "Not Needed", "Policy Violation"). Jika tidak cocok, creator dapat centang "Lainnya / Other Reason" untuk unlock freetext. Kategori ditetapkan Admin per document type; tidak ada kategori lintas tipe atau hardcode.
29. **Setiap action approval — Approve, Reject, maupun Return — wajib meninggalkan catatan (`approval_tasks.comment`).** Untuk Reject/Return, catatan ini adalah `reason_code` + `reason_text` (keputusan #28). Untuk Approve, catatan berupa free text wajib diisi minimal satu kalimat (tidak perlu kategori, karena "disetujui" tidak punya banyak penyebab yang perlu dikategorikan seperti penolakan). Tujuannya: creator tidak pernah membaca task kosong tanpa konteks tentang apa yang dinilai approver, sekalipun hasilnya disetujui.

#### Prinsip yang mengikat

- **Satu keputusan, satu audit chain.** Approval dokumen dan backdate tidak boleh pecah menjadi dua proses, dua status, atau dua set approver.
- **Snapshot stabil, re-resolve eksplisit.** Perubahan role, organisasi, atau delegasi setelah submit tidak boleh diam-diam menulis ulang chain. Re-resolve hanya terjadi pada action dan selalu meninggalkan alasan.
- **Kewenangan tidak lahir dari workflow.** Workflow memilih dan mengorkestrasi approver; batas kewenangan, akumulasi, supervisor chain, currency conversion, dan self-approval tetap milik Epic 1.
- **Delegasi mempersempit, tidak memperluas.** Scope waktu, dokumen, organisasi, dan nominal berlaku sekaligus. Delegate tidak mewarisi permission permanen dan tidak boleh melampaui delegator.
- **Dokumen tidak boleh menggantung tanpa pemilik.** Deadline, fallback supervisor, maksimal eskalasi, dan jalur intervensi Admin harus terdefinisi sebelum workflow diaktifkan.
- **Lifecycle dan approval tetap terpisah.** `doc_status` menggambarkan keadaan dokumen; `approval_instances` dan `is_approved` menggambarkan keputusan approval. Reject tidak menyamarkan satu sebagai yang lain.
- **Metadata boleh dikonfigurasi, executable code tidak.** Condition transition memakai operator dan field yang diizinkan engine; admin tidak dapat memasukkan SQL atau script.
- **Denormalisasi hanya untuk membaca.** `is_approved`, `last_approver_user_id`, `last_approval_datetime`, dan `last_rejection_reason` ditulis oleh engine dari history approval. Endpoint umum tidak boleh mengubahnya langsung.

#### Basis iDempiere (terverifikasi terhadap source resmi)

| Source resmi | Fakta yang diadopsi | Adaptasi Abixell One |
|---|---|---|
| `X_AD_Workflow.java` | Workflow memiliki table target, start node, responsible, access level, dan tipe workflow | `workflows` menjadi registry definisi per document type/code; pemilihan definisi tetap metadata-driven |
| `X_AD_WF_Node.java` | Node menyimpan action dan `DocAction` yang dijalankan | `workflow_nodes` menjadi unit approval dengan mode approver, deadline, serta kebijakan eskalasi |
| `X_AD_WF_NodeNext.java` | Transition memiliki sequence dan `TransitionCode` | `workflow_node_transitions` menyimpan urutan dan condition JSON terstruktur; tidak mengizinkan executable expression bebas |
| `MWFActivity.java` (basis Epic 1) | Approval user dihitung dari role, nominal, akumulasi, supervisor, currency, dan self-approval guard | Epic 9 memanggil hasil resolusi Epic 1 dan menyimpannya sebagai snapshot task; tidak menduplikasi algoritmanya |

Adopsi ini mengambil model definisi workflow–node–transition dari iDempiere, tetapi tidak menyalin evaluator expression Java-nya. Condition Abixell One dibatasi ke field dan operator terdaftar agar dapat divalidasi, diaudit, dan dieksekusi konsisten di database.

#### Model target

**Definisi workflow:**

| Tabel | Kontrak minimum |
|---|---|
| `workflows` | Identitas definisi, `document_type_id`, optional `document_code_id` sebagai override, start node, responsible/fallback Admin, status aktif |
| `workflow_nodes` | Parent workflow, jenis node, mode `ANY`/`ALL`/`SEQUENTIAL`, deadline/timeout, target eskalasi, maksimal level (≤3), dan action ketika batas eskalasi habis |
| `workflow_node_transitions` | Node asal/tujuan, sequence evaluasi, serta condition JSON untuk nominal, organization unit, document code, dan backdate |

**Runtime approval:**

| Tabel | Kontrak minimum |
|---|---|
| `approval_instances` | Referensi dokumen (`document_type_id` + ID dokumen), workflow dan node aktif, status instance, waktu mulai/selesai, submitter, serta keterkaitan pengajuan ulang |
| `approval_tasks` | Satu baris per approver: approver resolved, action/status, waktu keputusan, `comment` wajib untuk semua action (`reason_code` + `reason_text` khusus Reject/Return, free text untuk Approve), keputusan backdate, dan field audit re-resolve |
| `approval_delegations` | Delegator/delegate, tanggal mulai–akhir, scope document type/code/organization unit, batas nominal, alasan, status, dan audit pembuat/perubah |
| `approval_escalations` | Instance/task, step number, user asal/tujuan, alasan timeout/exception/manual, waktu, dan Admin pelaksana jika manual |
| `approval_reason_codes` | Kategori alasan penolakan per document type: kode, label, urutan tampil, flag "wajib catatan", dan satu baris "Lainnya" yang tidak dapat dihapus per tipe |

**Linkage dokumen:**

| Lokasi | Perubahan |
|---|---|
| `work_orders`, `complaints`, `service_acceptances`, `disposals` | `approval_instance_id`; engine-owned `is_approved`; denormalisasi `last_approver_user_id`, `last_approval_datetime`, `last_rejection_reason` |
| `document_backdate` | `approval_instance_id`; status approval lama menjadi nilai baca yang berasal dari instance/task, bukan sumber keputusan mandiri |

`approval_instance_id` pada dokumen menunjuk instance aktif/terakhir untuk akses cepat. Seluruh instance lama tetap dapat ditelusuri lewat referensi dokumen pada `approval_instances`; linkage cepat tidak boleh menghapus history.

#### Mekanisme pemilihan dan eksekusi

```text
Submit dokumen
    │
    ├─ pilih workflow override dari document_code_id (jika aktif)
    │    └─ jika tidak ada: pakai default document_type_id
    │
    ├─ resolve approver dari otoritas Epic 1
    │    ├─ role aktif + organization scope
    │    ├─ nominal + akumulasi + currency
    │    ├─ self-approval guard
    │    └─ delegasi aktif yang scope-nya cocok
    │
    ├─ buat approval_instance untuk start node
    ├─ snapshot approver ke approval_tasks
    └─ tautkan dokumen (+ document_backdate jika ada) ke instance yang sama
```

```text
Action pada approval_task
    │
    ├─ validasi approver saat ini
    │    ├─ masih valid                    → lanjut
    │    ├─ tidak valid, pengganti sah     → re-resolve + catat audit
    │    └─ tidak ada pengganti sah        → blokir; Admin pilih manual
    │
    ├─ simpan keputusan dokumen + backdate
    └─ database trigger evaluasi node
         ├─ syarat mode belum lengkap      → tetap pada node
         ├─ Reject / Return                → hentikan instance + simpan alasan
         └─ syarat lengkap
              ├─ condition transition cocok → buat/aktifkan instance node berikut
              └─ tidak ada node berikut     → tandai approved + update denormalisasi
```

Condition transition dievaluasi menurut `sequence`; transition pertama yang condition-nya terpenuhi menjadi jalur berikut. Engine harus menolak aktivasi workflow yang mempunyai node buntu tanpa hasil terminal atau jalur fallback.

#### Kontrak mode multi-approver

| Mode | Syarat selesai | Perilaku task |
|---|---|---|
| `ANY` | Satu approver sah menyetujui | Task lain tidak lagi actionable setelah node selesai; history tetap disimpan |
| `ALL` | Semua approver yang di-snapshot menyetujui | Action dapat dilakukan tanpa urutan; satu Reject/Return menghentikan instance |
| `SEQUENTIAL` | Semua approver yang di-snapshot menyetujui | Daftar dapat ditampilkan bertahap, tetapi tidak ada hard gate berdasarkan nomor urut; completeness signature adalah satu-satunya syarat |

Jika approver yang sama ter-resolve lebih dari sekali pada node yang sama karena memegang beberapa assignment, engine harus menormalisasi menjadi satu task identitas—satu orang tidak dihitung sebagai beberapa signature.

#### Re-resolve dan delegasi

1. Submit menyimpan approver asal dan hasil delegasi yang berlaku pada saat itu.
2. Saat Approve/Reject/Return dipanggil, engine memeriksa user masih aktif, assignment/role masih berlaku, scope organisasi masih sah, dan delegasi belum kedaluwarsa.
3. Jika tidak valid, engine menjalankan resolver Epic 1 sekali untuk mencari substitute sah. Perubahan task mengisi `was_re_resolved`, `re_resolved_from_user_id`, `re_resolve_reason`, dan `re_resolve_datetime`.
4. Jika resolver tidak menghasilkan user sah—termasuk delegasi kedaluwarsa tanpa fallback—action ditolak. Admin memilih user pengganti dengan alasan wajib; pilihan manual masuk audit yang sama.
5. Re-resolve tidak mengubah definisi workflow atau task yang sudah selesai.

Tabel `approval_delegations` menyimpan konfigurasi reusable. `approval_tasks` hanya menyimpan siapa yang benar-benar menerima dan menjalankan task. Pemisahan ini mencegah perubahan konfigurasi delegasi mengubah history approval.

#### Approval backdate dan penolakan

- Baris `document_backdate` dibuat saat dokumen `IP` sesuai Epic 7, kemudian ditautkan ke `approval_instance_id` yang sama dengan dokumen.
- Approver melihat data dokumen dan backdate dalam satu action. Jika backdate aktif, `backdate_approved` wajib diisi bersama komentar sesuai policy node.
- Condition dapat menaikkan jalur approval berdasarkan jumlah hari backdate, periode terdampak, nominal, dan authority minimum tanpa membuat workflow kedua.
- `Reject` menyimpan `doc_action='RJ'`; `doc_status` tetap `IP`. `Return for Correction` tetap action berbeda agar UI dan audit dapat membedakan penolakan final terhadap instance dari permintaan koreksi.
- Alasan action disimpan pada task/history. `last_rejection_reason` pada dokumen adalah salinan terakhir untuk baca cepat.
- Saat submit ulang, instance baru dibuat dan `last_rejection_reason` pada dokumen dikosongkan. History instance sebelumnya tidak dihapus atau ditulis ulang.

#### Siklus revisi dan keputusan creator

Reject dan Return for Correction **tidak** mengubah `doc_status`. Dokumen tetap `IP` dan langsung kembali ke creator untuk diedit di tempat. Tidak ada transisi ke Draft, tidak ada state perantara, dan tidak ada jalur di mana creator dapat menyetujui dokumennya sendiri dengan melewati approver.

```text
approver menolak (Reject atau Return for Correction)
    │
    ├─ doc_action = 'RJ'      (doc_status tetap IP)
    ├─ approval_tasks.reason_code  + reason_text   ← keputusan approver
    ├─ salinan baca → dokumen.last_rejection_reason
    └─ instance aktif ditutup dengan status rejected/returned

creator membaca alasan
    │
    ├─ kategori + catatan menjelaskan MENGAPA ditolak
    ├─ creator memutuskan: revisi, ubah nominal/scope, atau batalkan
    └─ mengedit dokumen di tempat (doc_status masih IP)

resubmit
    │
    ├─ instance BARU dibuat (Reject maupun Return identik di sini)
    ├─ snapshot approver di-resolve ulang dari kondisi saat resubmit
    └─ last_rejection_reason dikosongkan; history instance lama tetap utuh
```

Konsekuensi yang disengaja: approver dapat melihat seluruh riwayat instance lama pada dokumen yang sama, sehingga penolakan berulang terlihat sebagai pola—bukan sebagai percobaan pertama yang tampak bersih. Membatalkan dokumen setelah ditolak tetap memakai jalur Void/Invalid Epic 7, bukan action approval baru.

#### Kategori alasan penolakan

Alasan penolakan memakai **kombinasi kategori dan catatan bebas**, karena creator harus memahami *mengapa* sebelum memutuskan *apa yang dilakukan berikutnya*:

| Bagian | Isi | Wajib |
|---|---|---|
| `reason_code` | Satu kategori dari daftar yang disiapkan Admin per document type | Ya (satu kategori) |
| `reason_text` | Catatan kebebasan approver—konteks, angka, permintaan spesifik | Ya untuk kategori "Lainnya"; opsional untuk kategori lain sesuai setelan |
| "Lainnya / Other Reason" | Kategori khusus yang **membuka** catatan bebas ketika tidak ada kategori cocok | Ya, sebagai pelarian |

Jika kategori yang tersedia tidak ada yang cocok, approver memilih "Lainnya" dan **wajib** mengisi catatan bebas. Checkbox/kategori ini tidak dapat dihilangkan dari daftar—tanpa jalur pelarian, approver akan memilih kategori yang salah dan creator membaca alasan yang menyesatkan.

Daftar kategori bersifat konfigurasi, bukan hardcode. Karena kategorinya spesifik per tipe dokumen ("Budget Limit" masuk akal untuk Work Order tetapi tidak untuk Complaint), ia disimpan sebagai tabel lookup yang direferensikan `document_types`, dengan setiap document type memiliki satu kategori "Lainnya" yang tidak dapat dihapus. Menambah/mengubah kategori tidak mengubah alasan yang sudah tersimpan—`reason_code` pada task lama tetap menunjuk kategori aslinya.

#### Perubahan status dokumen — ringkasan untuk creator

| Peristiwa | `doc_status` | `doc_action` | `is_approved` | Yang dilakukan creator |
|---|---|---|---|---|
| Draft dibuat | `DR` | — | `false` | Lengkapi data |
| Submit approval | `IP` | `AP` (menunggu) | `false` | Menunggu |
| Approver menyetujui penuh | `IP` | `AP` | `true` | Lanjut ke Complete |
| Approver `Reject` | `IP` (tetap) | `RJ` | `false` | Revisi di tempat, resubmit, atau Void |
| Approver `Return for Correction` | `IP` (tetap) | `RJ` | `false` | Sama seperti Reject |
| Creator resubmit | `IP` | `AP` (menunggu) | `false` | Menunggu instance baru |
| Creator membatalkan | `VO`/`IN` | sesuai Epic 7 | `false` | Selesai |

#### Transition database dan boundary aplikasi

Database trigger pada perubahan `approval_tasks` bertanggung jawab untuk operasi atomik berikut:

1. Mengunci instance aktif yang relevan agar dua keputusan bersamaan tidak memajukan node dua kali.
2. Menghitung completion berdasarkan mode node dan task yang sah.
3. Menangani hasil Reject/Return atau memilih transition pertama yang condition-nya cocok.
4. Membuat/mengaktifkan instance node berikutnya atau menyelesaikan workflow.
5. Memperbarui `approval_instance_id`, `is_approved`, dan kolom denormalisasi dokumen dalam transaksi yang sama.

Application bertanggung jawab untuk autentikasi request, otorisasi action, validasi payload, penyajian definisi, serta pemanggilan resolver Epic 1. Application **tidak** boleh memajukan node dengan update terpisah. Scheduled job **tidak** boleh menjadi penggerak transition normal; ia hanya boleh memanggil evaluator timeout/escalation yang sama melalui kontrak Epic 12.

#### Eskalasi

```text
deadline node lewat / approver unavailable / Admin manual
    │
    ├─ catat approval_escalations step N
    ├─ tentukan target supervisor/fallback yang sah
    ├─ reassign/re-resolve task dengan audit
    └─ N < 3 ? lanjut menunggu : jalankan kebijakan exhaustion
                               ├─ auto-reject
                               └─ intervensi Admin
```

Eskalasi otomatis adalah perilaku domain Epic 9; Epic 9 menyediakan evaluator dan menjamin audit hasilnya. Pemanggilan berkala evaluator serta pengiriman reminder/notifikasi dijadwalkan oleh Epic 12. Ketidakhadiran kanal notifikasi tidak boleh mengubah hasil resolver atau meniadakan deadline.

#### Gelombang pengerjaan

| Wave | Isi | Gate |
|---:|---|---|
| **9.1** | Definisi `workflows`, `workflow_nodes`, `workflow_node_transitions`; validator graph dan condition terstruktur | Workflow invalid, node buntu, transition ambigu, atau tanpa fallback tidak dapat diaktifkan |
| **9.2** | `approval_instances`, `approval_tasks`, resolver integration Epic 1, linkage ke empat tabel dokumen dan `document_backdate` | Submit menghasilkan snapshot approver; dokumen + backdate memakai instance yang sama |
| **9.3** | Database trigger completion/transition, mode `ANY`/`ALL`/`SEQUENTIAL`, Reject/Return, resubmit | Concurrency test membuktikan node tidak maju ganda dan history lama tetap utuh |
| **9.4** | `approval_delegations`, action-time re-resolve, Admin substitution | Delegasi scope/masa berlaku/nominal tidak dapat dilewati; semua substitusi tercatat |
| **9.5** | `approval_escalations`, evaluator timeout/exception, batas tiga level dan exhaustion behavior | Eskalasi otomatis/manual dapat direkonstruksi per step; tidak ada instance tanpa owner/fallback |
| **9.6** | UI konfigurasi graph terstruktur, kategori alasan per document type, dan inbox/history approval dengan siklus revisi creator | UI hanya mengedit metadata tervalidasi; tidak menulis field denormalisasi atau transition runtime langsung; creator dapat melihat reason_code + reason_text seluruh instance lama |

#### Cross-epic handoff

| Ke/dari | Kontrak |
|---|---|
| **Dari Epic 1 — Security Context & Approval Authority** | Konsumsi resolver role, organization scope, nominal, akumulasi, supervisor chain, currency conversion, dan self-approval guard; Epic 9 tidak menulis ulang algoritma |
| **Revisi Epic 7 — Document Engine** | Tambah `approval_instance_id` ke empat tabel dokumen dan `document_backdate`; tambah denormalisasi approval ke empat tabel dokumen; prinsip approval + backdate satu keputusan tetap |
| **Dari Epic 8 — Document Type & Parameters** | `document_type_id` + `document_code_id` memilih workflow; parameter backdate menjadi input condition dan authority minimum |
| **Ke Epic 11 — Extension Hooks** | Event terminal Complete/Reject/Return/Escalate dan perpindahan node menjadi titik hook; Epic 11 mengatur kontrak serta eksekusi extension, bukan menentukan hasil approval |
| **Ke Epic 12 — Reporting, Scheduler & Notification** | Epic 12 memanggil evaluator deadline secara berkala, mengirim reminder/notifikasi, dan menyediakan monitoring; sumber status tetap tabel Epic 9 |

#### Out-of-scope Epic 9

- Mengubah role, `AmtApproval`, akumulasi nominal/hari, currency conversion, supervisor chain, atau self-approval policy—milik Epic 1.
- Mengubah lifecycle dasar `DR/IP/CO/CL/VO`, numbering, snapshot dokumen, atau posting—milik Epic 7/8/14.
- Mengirim email, notifikasi in-app, atau reminder terjadwal—milik Epic 12. Epic 9 hanya menyediakan deadline, evaluator, status, dan event.
- Menjalankan business extension pada event workflow—milik Epic 11. Epic 9 hanya menyediakan transition atomik dan titik event.
- Approval untuk aksi non-dokumen seperti perubahan konfigurasi sistem. Kebutuhan itu tetap open decision lintas domain sampai tipe target dan audit contract ditentukan.
- Pemetaan GL, jurnal, atau reversal—milik Epic 14.

#### Open items

| # | Item | Perlu diselesaikan di |
|---|---|---|
| 1 | Bentuk UI authoring graph: drag-node atau form terstruktur | Desain UI Epic 9; engine contract tidak bergantung pada pilihan ini |
| 2 | Kanal dan routing notifikasi eskalasi (email/in-app) | **Dijawab Epic 12 (§4.12):** kanal Wave 1 = `in_app` + `email` + `push` (Web Push service worker + mobile) + bot Telegram; routing lewat `notification_recipient_rules` hybrid (payload menang, konfigurasi tenant sebagai fallback); eskalasi masuk kategori prioritas tinggi sehingga dikirim seketika, bukan digest (§4.12 keputusan #3, #5, #7). Epic 9 tidak berubah. |
| 3 | Nama/payload final hook untuk node transition, Complete, Reject, Return, dan Escalate | **Dijawab Epic 11 (§4.11):** trigger point workflow dikunci — perpindahan node + terminal `Approved`/`Rejected`/`Returned`/`Escalated`; payload per event type didaftarkan sebagai data pada Wave 11.1. Epic 9 tidak perlu mengubah engine-nya. |
| 4 | Workflow approval untuk aksi non-dokumen/configuration change | Wawancara lanjutan setelah target aksi dan audit scope jelas |
| 5 | Daftar kategori alasan baku per document type (isi awal, bukan mekanisme) | UI konfigurasi Epic 9 wave 9.6; mekanisme tabelnya sudah terkunci |

#### Risk mitigation

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Application dan database sama-sama memajukan node | Double transition dan instance ganda | Database trigger menjadi satu-satunya writer transition; application tidak mendapat jalur update langsung |
| Dua approver bertindak bersamaan | Node selesai dua kali atau task hilang | Lock instance aktif dalam transaksi trigger + constraint satu instance aktif per node/dokumen |
| Perubahan organisasi/delegasi mengubah history | Audit tidak dapat dipercaya | Snapshot saat submit; re-resolve action-time dengan field asal, alasan, dan waktu |
| Delegasi memperluas authority | User menyetujui di luar nominal/scope delegator | Intersection seluruh scope dan batas nominal; resolver tetap menjalankan guard Epic 1 |
| Graph salah konfigurasi membentuk loop/node buntu | Dokumen menggantung | Validator aktivasi: reachability, terminal/fallback, transition sequence, dan cycle guard |
| Denormalisasi berbeda dari history | Daftar dokumen menampilkan status salah | Hanya trigger engine menulis kolom baca; rekonsiliasi invariant dalam test dan monitoring |
| Trigger terlalu kompleks atau lambat | Lock panjang pada approval task | Condition operator dibatasi dan terindeks; trigger hanya mengubah runtime state, side effect eksternal lewat event Epic 11 |
| Kategori alasan dipakai asal-asalan karena approver malas mengetik | Creator membaca alasan yang menyesatkan dan salah mengambil tindakan lanjut | Kategori "Lainnya" wajib ada sebagai jalur pelarian; flag "wajib catatan" per kategori; tampilkan kategori lama agar approver melihat preseden |
| Kolom `last_rejection_reason` tertinggal dari history setelah resubmit berulang | Daftar dokumen menampilkan alasan yang sudah usang | Hanya trigger engine yang menulis kolom ini; dikosongkan pada resubmit dalam transaksi yang sama dengan pembuatan instance baru |
| Evaluator timeout belum dijadwalkan sebelum Epic 12 | Eskalasi waktu tidak berjalan otomatis di produksi | Epic 9 menyediakan evaluator yang dapat diuji/idempotent; aktivasi timeout produksi menjadi dependency eksplisit Epic 12 |

#### Completion gate

Epic 9 dianggap selesai jika: (1) tiga tabel definisi (`workflows`, `workflow_nodes`, `workflow_node_transitions`), empat tabel runtime/delegasi/escalation (`approval_instances`, `approval_tasks`, `approval_delegations`, `approval_escalations`), dan tabel kategori alasan (`approval_reason_codes`) terbentuk dengan constraint tenant serta referensi yang benar; (2) workflow default per `document_type_id` dan override per `document_code_id` dipilih deterministik; (3) submit menyimpan snapshot approver dari resolver Epic 1; (4) mode `ANY`, `ALL`, dan `SEQUENTIAL` bekerja sesuai kontrak; (5) trigger database memajukan node tepat sekali di bawah action concurrent; (6) dokumen dan `document_backdate` memakai instance serta keputusan yang sama; (7) Reject/Return menjaga dokumen di IP, creator bisa edit-in-place lalu resubmit (instance baru), kategori alasan predefined + freetext "Other" berfungsi; (8) resubmit, re-resolve, delegasi, eskalasi maksimal tiga level, dan intervensi Admin meninggalkan audit lengkap; (9) keempat tabel dokumen mempunyai linkage dan denormalisasi engine-owned; dan (10) validator menolak graph yang loop/buntu/tanpa fallback.

Pengiriman notifikasi/reminder terjadwal dan eksekusi extension hook **bukan** syarat selesai Epic 9—itu milik Epic 12 dan Epic 11. Namun evaluator timeout/escalation dan event transition harus sudah tersedia serta dapat diuji tanpa kanal eksternal.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci kontrak dan domain; **tidak** memberi persetujuan migration, trigger database, perubahan backend, atau UI sekarang.
- Revisi terhadap §4.7 hanya menambah linkage/source-of-truth approval. Prinsip Epic 7 #3—approval dokumen dan backdate satu keputusan—tidak berubah.
- Tidak ada tabel `approvers_backdate`. Membuatnya akan menduplikasi `document_backdate` dan memecah satu keputusan menjadi dua sumber kebenaran.
- Nama fisik constraint, indeks, enum status instance/task, serta bentuk JSON Schema condition ditetapkan dalam plan implementasi terpisah; semantiknya wajib mengikuti 29 keputusan di atas.
- Riset iDempiere untuk Epic 9 diverifikasi terhadap source resmi (raw GitHub `X_AD_Workflow.java`, `X_AD_WF_Node.java`, `X_AD_WF_NodeNext.java`, dan `MWFActivity.java` yang sudah menjadi basis Epic 1), bukan hanya catatan riset lokal.
- **Empat keputusan tambahan setelah wawancara (2026-09-25 lanjutan):** keputusan #26 (dokumen tetap IP saat Reject/Return, creator edit-in-place + resubmit), #27 (keduanya buat instance baru, tidak ada jalur bypass), #28 (alasan penolakan memakai kategori predefined + freetext "Other"), #29 (Approve juga wajib catatan, bukan hanya Reject/Return). Keputusan ini mengklarifikasi kontrak lifecycle approval yang belum tertulis di keputusan #8, #13, #14.

---

### 4.10 EPIC 10 — Password, Session & User Security

#### Problem statement

Epic 1 mendefinisikan `sessions` table sebagai server-side single source of truth untuk konteks aktif pengguna — siapa, role mana, organisasi mana yang dipilih. Tetapi Epic 1 tidak mengatur keamanan password itu sendiri, timeout sesi, rotasi token refresh, atau mekanisme lockout akun. Aplikasi saat ini memakai password hashing minimal, tidak ada lockout otomatis, session timeout sepenuhnya client-side, dan tidak ada cara user melihat atau mencabut sesi lain. Dalam konteks multi-device dan mobile-first — user bisa login dari kantor, rumah, dan ponsel bersamaan — tanpa dashboard sesi, user tidak bisa memastikan perangkat yang ditinggal terbuka sudah terkunci dan token sudah aman.

Epic 10 menghardkan siklus hidup password dan session: upgrade ke Argon2id, ledakan kegagalan login → lockout 15 menit, refresh token family + reuse detection, dashboard sesi user, dan step-up authentication (revertifikasi password) sebelum perubahan sensitif (ubah password, ubah email, minta reset admin). Setiap keputusan bersumber pada iDempiere precedent atau kebutuhan operasional yang sudah muncul di wawancara sebelumnya.

#### Keputusan terkunci (2026-09-25)

1. **Password hashing: upgrade bcrypt → Argon2id dengan transparent rehash-on-login.** Sistem saat ini pakai bcrypt (SALT_ROUNDS=10). Semua password baru dan password yang direset ke default harus hash dengan Argon2id. Saat user login sukses dengan bcrypt lama, sistem otomatis rehash password plain ke Argon2id dan simpan ulang — user tidak usah reset password manual. Bcrypt yang sudah ada tetap berfungsi sampai semuanya terganti.

2. **Password policy terkunci: minimum 6 karakter, alphanumeric + huruf besar wajib, history 5 terakhir tanpa reuse.** Admin tenant tidak boleh melemahkan minimum 6 karakter. Tidak ada periodic password expiry secara otomatis (user-initiated change saja). Sistem track 5 password lama (hashed); user tidak boleh pakai kembali apapun dari 5 terakhir saat ubah password.

3. **Account lockout: 10 failed login attempts → 15-minute flat-tier cooldown, user-visible countdown.** Setelah 10 kegagalan berturut-turut (per user per tenant), akun terkunci 15 menit. Tidak ada escalating tiers (misalnya 1 min → 5 min → 15 min) — satu tingkat saja untuk simplicity operasional. Lockout terhitung dari percobaan gagal ke-10; user bisa login lagi setelah 15 menit berlalu. UI login menampilkan countdown sisa lockout dalam menit, bukan pesan generi "account locked".

4. **MFA ditolak sepenuhnya.** Tidak ada TOTP, backup code, OTP via email/SMS, atau mekanisme MFA apapun. Password-only authentication sudah cukup. User yang memiliki risiko tertentu ditangani via Admin force-logout + mandatory password change (keputusan #10), bukan via MFA.

5. **WebAuthn/Passkey sebagai Wave 2 — credential type alternative untuk login tanpa password, bukan MFA.** Tidak dibangun di Wave 1 (keputusan username/password founding ini). Wave 2 boleh menambahkan WebAuthn sebagai cara login alternatif sebelum masuk sesi (credential type pilihan, bukan second factor di atas password). Saat itu, keputusan scope WebAuthn dan perangkat yang didukung (FIDO2, platform authenticator) menjadi kontrak Wave 2 terpisah.

6. **Session policy: idle timeout 1 jam, absolute lifetime 12 jam; tenant bisa ketat tapi tidak boleh longgar.** Jika user tidak ada aktivitas 1 jam, sesi auto-logout. Apapun, sesi logout otomatis setelah 12 jam sejak login sukses (bahkan kalau terus aktif). Tenant Super Admin bisa mengatur batas maksimum tenant lebih ketat (misalnya idle 30 menit, lifetime 4 jam), tetapi tidak boleh membuka lebih longgar dari 1 jam / 12 jam system baseline. Setiap tenant punya setting timeout per tenant (bukan per user atau per role); berlaku ke seluruh user tenant itu.

7. **Refresh token family + reuse detection: rotasi track parent/child, reuse → revoke seluruh family dan session terkait.** Saat token refresh diajukan, sistem buat token baru dan tandai token lama sebagai parent dari yang baru (parent-child link). Jika token yang sudah di-rotate dipakai lagi (reuse detected), sistem revoke token itu beserta seluruh token family (trace balik sampai root), dan revoke semua session user yang memakai token dari family itu. Deteksi reuse adalah defense terhadap token theft — jika attacker dapat token lama, pemakaian ulangnya akan segera diketahui.

8. **User-visible active session list: waktu login, last activity, browser/device, IP, opsional location; kontrol revoke satu atau semua-except-current.** Dashboard "Sesi Aktif Saya" menampilkan tabel sesi aktif user: kapan login, kapan last activity, user agent (Chrome/Firefox/Safari), device type (Desktop/Mobile/Tablet), IP address, dan opsional geolokasi. User bisa revoke sesi tertentu atau "revoke semua sesi lain" (keep current, logout yang lain). Sesi yang di-revoke dari dashboard user otomatis logout semua browser/app yang pakai session itu.

9. **Immediate revocation on sensitive changes: password change, email change, account deactivation, admin force-logout semua revoke semua session/token; email change wajib re-verification.** Saat user ubah password sendiri, sistem revoke semua session/token user itu — user wajib login ulang di semua device. Saat email diubah (baik oleh user atau admin), email baru wajib di-verify (link klik di inbox email baru) sebelum email benar-benar ganti; sebelum verified, session/token juga di-revoke — user harus login ulang dengan email baru setelah verifikasi. Saat admin deaktivasi akun user, semua session/token itu juga revoked. Saat Super Admin atau Tenant Admin jalankan force-logout untuk user, semua session/token itu di-revoke sekaligus.

10. **Admin-initiated password reset: Super Admin atau Tenant Admin reset ke value default/temporary; user wajib mandatory password change sebelum app use apapun; default password single-use only.** Admin reset akun user dengan salah satu opsi: (1) sistem auto-generate password random (panjang 8, alphanumeric + huruf besar), atau (2) admin input password value manual (harus pass 6-char min + alphanumeric + uppercase). Password default ditampilkan sekali ke admin (copy/paste ke email user), tidak disimpan/retrievable setelah itu. User login dengan password itu → UI block semua fitur app, wajib change password dulu. Saat password default dipakai login, token session dan refresh token yang dihasilkan punya flag `must_change_password=true`; backend cek flag ini, tolak akses ke semua endpoint kecuali `POST /auth/password/change` dan UI login/change-password page. Setelah user ubah password (endpoint spesifik), flag cleared, user bisa akses app normal.

11. **Step-up authentication: re-verify password sebelum aksi sensitif (ubah password, ubah email, minta admin reset); valid ~10 menit; mekanisme defense terhadap device terbuka tanpa kunci.** Sebelum user ubah password diri sendiri, ubah email, atau minta admin reset dari dashboard (bukan admin yang jalanin, tapi user yang request), sistem tampilkan dialog verifikasi password: user ketik password current. Verifikasi ok → session di-upgrade dengan timestamp `password_verified_at`. Selama 10 menit setelah itu, user bisa jalankan aksi sensitif tanpa verifikasi ulang. Setelah 10 menit, step-up expired — user wajib verify ulang. Defense ini melindungi dari scenario: user login, tinggal device terbuka, orang lain datang dan ubah email/password tanpa user tahu.

12. **Audit logging: login success/failure, lockout, unlock, reset, password change, session revoke, refresh-token reuse detection, step-up events; raw password/token tidak pernah dicatat.** Setiap event keamanan dicatat: login attempt sukses (user, timestamp, IP, user agent), login attempt gagal (user, reason: invalid password/unknown user, timestamp, IP), account lockout (user, waktu mulai, tentative unlock time), admin unlock akun, password reset by admin (admin yang reset, user target), password change by user, session revoke (user memicu/admin memicu), token reuse detected (user, timestamp, IP, token ID family), step-up verification (user, action requested, result ok/fail). Raw password atau token hash tidak pernah dicatat; hanya event dan metadata. Audit log entry siapa dilakukan oleh siapa, kapan, dari mana.

13. **Password default generation: dua opsi untuk tenant admin—(1) sistem auto-generate random, atau (2) tenant admin input manual; keduanya harus pass 6-char alphanumeric+uppercase minimum.** Saat admin reset akun, pilihan: (A) klik tombol "Generate Random Password" → sistem create random 8-char alphanumeric+uppercase+special (contoh `Px7@Km2Q`), tampilkan sekali, admin copy/kirim ke user. (B) klik "Set Manual Password" → dialog form, admin input string; validasi: minimum 6 karakter, wajib alphanumeric, wajib ada huruf besar. Keduanya punya display sekali, tidak retrievable setelah tutup dialog. Kedua opsi ini untuk reset saja; tidak untuk setup password pertama saat user didaftar (itu milik workflow pendaftaran pengguna — Epic 6 atau admin UI terpisah, out of scope Epic 10).

14. **Force-change enforcement: user diblokir total dari app sampai password diubah.** Saat user login dengan password default (hasil reset admin), session dapat flag `must_change_password=true`. Frontend dan backend sama-sama check flag: backend tolak semua request kecuali `POST /auth/password/change` dan GET ke page yang berisi form change password; frontend block navigasi ke halaman lain, tampilkan modal wajib ubah password. Setelah user ubah password sukses, flag cleared, user bisa navigasi normal. Jika user coba logout sebelum ubah password, logout allowed (session end), tetapi saat login lagi, password itu masih default, jadi wajib ubah ulang.

15. **Session server-side single source of truth dari Epic 1.** `sessions` table (dibuat Epic 1) menyimpan state sesi aktif: user ID, tenant ID, role, organization unit, device info (user agent), IP, login time, last activity time, refresh token ID. Setiap request ke app harus validate session ID (dari JWT token atau session cookie) terhadap `sessions` table — aplikasi tidak percaya hanya pada token validity, tapi juga check session record ada dan `revoked_at` NULL. Saat admin revoke atau token reuse detected, baris session di-update `revoked_at = now()`. Saat session logout/expire natural, baris session tetap ada (audit trail), tapi `revoked_at` sudah terisi.

16. **Tenant bisa ketat tapi tidak boleh longgar session timeout.** Setiap tenant punya row di tabel configuration (milik Epic 5/8 Configuration Engine) dengan field: `session_idle_timeout_seconds` (default 3600 = 1 jam), `session_absolute_lifetime_seconds` (default 43200 = 12 jam). Tenant Super Admin bisa set lebih ketat (contoh idle 1800 = 30 menit), tapi form input punya constraint: tidak boleh lebih dari system max (1 jam / 12 jam). Backend validate sebelum save; jika admin coba set ke nilai longgar, form error: "Idle timeout tidak boleh > 1 jam".

17. **Tidak ada jalur "Lupa Password" self-service — pemulihan password hanya lewat admin tenant.** Ini keputusan desain yang sengaja, bukan kekurangan cakupan. User yang lupa password **wajib menghubungi admin tenant**, dan admin tenant atau Super Admin menjalankan reset sesuai keputusan #10 (password default + `must_change_password`). Tidak ada form "forgot password", tidak ada email reset link, tidak ada security question, tidak ada reset token berbasis email. Rasional: menolak permukaan serangan dari alur reset berbasis email (kompromi inbox, token reset yang bocor atau bisa diprediksi, enumerasi akun lewat respons berbeda antara email terdaftar dan tidak) yang tidak diimbangi kebutuhan operasional saat ini. Konsekuensi diterima: beban reset berpindah ke admin tenant, dan user yang lupa password bergantung pada ketersediaan admin. Alur ini juga menutup open item lama yang menyarankan epic recovery terpisah — **tidak ada epic recovery yang perlu dibuat.**

#### Prinsip yang mengikat

- Password adalah awal akses; hardening password dan session adalah defense first layer sebelum RBAC (Epic 1) dan approval engine (Epic 9) jalan.
- User punya kontrol visibility dan revocation atas sesi diri sendiri — "saya buka 5 device, saya lihat mana, saya revoke yang mencurigakan".
- Lockout otomatis dan reset admin tidak boleh meninggalkan user terkunci selamanya — unlock otomatis (15 menit) atau admin unlock jangan lama.
- Sensitive actions (ubah password, ubah email) butuh extra verifikasi — mekanisme defense terhadap device tidak terkunci atau session theft.
- Audit trail harus lengkap dan tidak pernah kehilangan event keamanan, tapi raw password/token tidak pernah dicatat.
- Tenant bisa strict tapi tidak boleh longgar — system baseline adalah "secure by default".

#### Basis iDempiere (terverifikasi terhadap source resmi)

| Konsep | Sumber terverifikasi | Diadopsi/dimodifikasi |
|---|---|---|
| Password hashing (bcrypt minimum) | `Securing iDempiere` wiki — hashed password wajib di produksi | Adopt bcrypt baseline; upgrade ke Argon2id untuk baru + transparent rehash |
| Password rules (kompleksitas, history) | `NF1.0 PasswordRules` — feature bawaan iDempiere | Adopt minimum 6 char + alphanumeric + uppercase; history 5 (not configurable per tenant) |
| User locking (lockout) | `NF1.0 User_Locking` — lockout otomatis setelah failed attempts | Adopt; single tier 15 menit setelah 10 failures (iDempiere punya configurable, kami lock value) |
| Session/Login context | `Login.java` — verifikasi password, buat context dengan `#AD_Client_ID`, `#AD_Org_ID`, `#AD_Role_ID` | Adopt session context; Epic 1 `sessions` table adalah equivalent iDempiere `Properties ctx` |
| MFA dalam iDempiere 8.2+ | Available tetapi opsional; kegagalan tercatat di `AuthFailure.log` | Reject MFA sama sekali; password-only sufficient |
| Refresh token & rotation | Tidak ada di iDempiere (session cookie-based, tidak bearer token) | Design baru untuk Abixell One (REST API architecture); rotation + family tracking |
| Session dashboard user | Tidak ada di iDempiere standar | Design baru; user lihat & revoke sesi aktif sendiri |

#### Model target

**Tabel baru/revisi:**

| Tabel | Fungsi | Catatan |
|---|---|---|
| `users` (revisi) | Tambah kolom: `password_hash_algorithm` ('bcrypt' / 'argon2id'), `failed_login_attempts` (counter), `account_locked_until` (nullable timestamptz), `must_change_password` (boolean, flag dari reset default) | Existing schema dari Epic 1; tinggal tambah 4 kolom |
| `sessions` (revisi dari Epic 1) | Epic 1 baseline: `user_id`, `tenant_id`, `active_assignment_id`, `active_role_id`, `organization_unit_id`, `web_session`, `remote_addr`, `login_at`, `last_seen_at`, `revoked_at`. Epic 10 tambah: `user_agent` (browser/OS), `device_type` (Desktop/Mobile/Tablet), `geolocation` (opsional), `ip_address` (jika belum di `remote_addr`) | Dari Epic 1; Epic 10 perluas untuk device dashboard |
| `refresh_tokens` (revisi) | Existing migration 1755600000000 punya tabel ini; Epic 10 revisi untuk track family: tambah `parent_token_id` (nullable uuid referensi ke refresh_tokens), `reuse_detected_at` (nullable, untuk audit), `rotation_count` (int, counter generasi) | Track parent-child linkage; `parent_token_id` NULL = root token dari login awal |
| `password_history` (baru) | Audit trail password lama: user ID, password hash lama (Argon2id), set on timestamp, rehashed from bcrypt flag | 5 baris terakhir per user; constraint unique (user_id, sequence) atau hapus otomatis riwayat >5 |
| `audit_log` (revisi dari Epic 1) | Sudah ada; Epic 10 gunakan untuk security events (lihat keputusan #12) | Entity type = 'user_security', action = 'login_success', 'login_failure', 'account_lockout', 'password_change', dll. |
| `step_up_verifications` (baru) | Timestamp verifikasi password untuk step-up auth: user ID, action requested (change_password / change_email / request_admin_reset), verified_at, expires_at (verified_at + 10 menit) | Saat user verify password step-up, buat row; cek sebelum eksekusi aksi sensitif |
| `user_configuration` atau `tenant_session_config` | Session policy per tenant: idle timeout, absolute lifetime (milik Epic 5/8 Configuration Engine, bukan Epic 10 yang defin tabel, tapi Epic 10 yang pakai) | Reuse dari Epic 5/8; Epic 10 hanya consume |

**Kolom baru di `users` (dari Epic 1):**
`password_hash_algorithm`, `failed_login_attempts`, `account_locked_until`, `must_change_password`.

#### Mekanisme — login & password workflow

```
LOGIN FLOW:
  User input email + password
    ↓
  Cek account locked: `account_locked_until > now()` ?
    Ya → Return error + countdown sisa lockout
    Tidak → Lanjut
  ↓
  Query password hash dari users (`password_hash`) + algorithm (`password_hash_algorithm`)
  ↓
  Verify password plain terhadap hash:
    - Jika algorithm='bcrypt' → bcrypt compare
    - Jika algorithm='argon2id' → argon2id verify
    ↓
  Verifikasi gagal 10x berturut-turut?
    Ya → Set `account_locked_until = now() + 15 menit`, `failed_login_attempts = 10`
         Audit: login_failure, user, reason='invalid_password'
         Return: account locked, countdown 15 min
    Tidak → Reset `failed_login_attempts = 0`, lanjut
  ↓
  Verifikasi OK:
    - Jika algorithm='bcrypt':
        Rehash ke argon2id sekaligus
        Update users: password_hash (baru), algorithm='argon2id'
        Insert password_history: hash lama bcrypt, rehashed_from_bcrypt=true
    - Jika sudah argon2id: skip rehash
  ↓
  Buat session baru di `sessions` table:
    user_id, tenant_id, active_assignment_id, active_role_id, organization_unit_id,
    user_agent (request header User-Agent), device_type (detect dari user agent),
    remote_addr (request IP), login_at=now(), last_seen_at=now(),
    web_session (opaque session ID), refresh_token_id (buat & hash token baru)
  ↓
  Generate JWT access token (payload: session_id, user_id, tenant_id, role_id, org_id, must_change_password flag)
  Generate refresh token (store hash di refresh_tokens, parent_token_id=NULL, rotation_count=0)
  ↓
  Audit: login_success, user, ip, user_agent, login_time
  Return: access_token + refresh_token (opaque value) ke client
```

```
PASSWORD CHANGE WORKFLOW:
  User klik "Ubah Password"
    ↓
  Step-up verification: dialog "Verifikasi password current"
    User input password current → verify success?
      Ya → Insert step_up_verifications (user, action='change_password', verified_at=now(), expires_at=now+10m)
      Tidak → Error, retry
  ↓
  Tampil form ubah password (field lama, field baru 2x konfirmasi)
  ↓
  Validasi password baru:
    - Min 6 char, alphanumeric + uppercase
    - Check history 5 terakhir: baru ≠ salah satu dari 5 lama (hash compare)
  ↓
  Jika valid:
    - Argon2id hash password baru
    - Update users: password_hash, password_hash_algorithm='argon2id'
    - Insert password_history (hash baru, not rehashed)
    - Clear `must_change_password` flag (jika user dari reset admin)
    - Revoke semua session/token user → Audit: password_change, user
    - Return: "Password ubah OK; login ulang di semua device"
  ↓
  User harus login ulang di semua browser/device (session lama sudah di-revoke)
```

```
ADMIN PASSWORD RESET:
  Admin klik "Reset Password" untuk user X
    ↓
  Dialog pilihan:
    (A) Generate Random → sistem buat 8-char random, display sekali, copy/kirim user
    (B) Set Manual → form input, validasi min 6 char + alphanumeric + uppercase
  ↓
  Hash password (method A atau B) → Argon2id
  ↓
  Update users:
    password_hash (new), password_hash_algorithm='argon2id',
    must_change_password=true,
    failed_login_attempts=0,
    account_locked_until=NULL
  ↓
  Revoke semua session/token user X → Audit: password_reset_by_admin, admin user, target user
  ↓
  Saat user login dengan password itu:
    - Token session dapat flag must_change_password=true
    - Backend tolak semua endpoint kecuali POST /auth/password/change
    - Frontend block navigasi, tampil modal "Ubah Password"
    - User ubah → flag cleared
```

#### Session timeout & renewal

```
IDLE TIMEOUT (1 jam default):
  Setiap request ke API:
    ↓
  Check `sessions.last_seen_at` > now() - idle_timeout (3600 detik default)?
    Tidak → Session expired; return 401 Unauthorized, client redirect login
    Ya → Update sessions.last_seen_at = now()
  ↓
  Check `sessions.revoked_at` IS NULL?
    Tidak → Session di-revoke; return 401, redirect login
    Ya → Continue
  ↓
  Check session absolute lifetime: login_at + 12 jam (43200 detik default)?
    Ya → Session exceeded lifetime; logout otomatis; audit: session_expired_by_lifetime
    Tidak → Continue request

REFRESH TOKEN ROTATION:
  Client request POST /auth/refresh dengan refresh_token
    ↓
  Hash token, lookup di refresh_tokens
    ↓
  Check reuse: refresh_tokens.rotation_count terakhir match token?
    Ya → REUSE DETECTED!
        Update all token family (trace parent_token_id balik ke root):
          - Set reuse_detected_at = now() untuk semua baris family
          - Revoke semua session yang memakai token dari family ini
        Audit: token_reuse_detected, user
        Return: 401 Unauthorized
    Tidak → Lanjut
  ↓
  Check token sudah di-revoke (revoked_at NOT NULL)?
    Ya → Return 401
    Tidak → Lanjut
  ↓
  Check token expired (expires_at < now())?
    Ya → Return 401 Unauthorized
    Tidak → Lanjut
  ↓
  Generate token baru:
    - Hash new token
    - Insert refresh_tokens: parent_token_id=(lama), rotation_count=old.rotation_count+1, expires_at=now+refresh_lifetime
    - Update session: refresh_token_id (new), update token family linkage
  ↓
  Return: new access_token + new refresh_token
```

#### Session revocation & logout

```
USER-INITIATED LOGOUT (dari device sekarang):
  User klik logout
    ↓
  Client POST /auth/logout
    ↓
  Backend cari session dari token, update: revoked_at = now()
  Update refresh_tokens yang terkait: revoked_at = now()
  Audit: logout_user_initiated, user
  ↓
  Return: OK; frontend clear token, redirect login

REVOKE SPECIFIC SESSION (dari dashboard "Sesi Aktif Saya"):
  User lihat daftar sesi, klik X di sesi lain
    ↓
  Client POST /account/sessions/{session_id}/revoke
    ↓
  Backend verify session_id belong to request user, update: revoked_at = now()
  Update refresh_tokens link: revoked_at = now()
  Audit: session_revoked_by_user, user, target_session_id
  ↓
  Target session (device lain): setiap request cek `revoked_at`, akan dapat 401

REVOKE ALL SESSIONS EXCEPT CURRENT:
  User klik "Logout semua device lain"
    ↓
  Client POST /account/sessions/revoke-others
    ↓
  Backend update semua session user KECUALI session_id sekarang: revoked_at = now()
  Audit: all_sessions_revoked_except_current, user
  ↓
  Semua browser/app lain immediate logout

ADMIN FORCE-LOGOUT:
  Admin POST /admin/users/{user_id}/force-logout
    ↓
  Backend update semua session user: revoked_at = now()
  Update semua refresh_tokens: revoked_at = now()
  Audit: force_logout_by_admin, admin user, target user
  ↓
  Return: OK; target user di semua device akan dapat 401 saat request berikutnya
```

#### Step-up authentication (verifikasi ulang password sebelum aksi sensitif)

```
CHANGE PASSWORD FLOW (sudah di atas, dengan step-up):
  Detail step-up:
    User klik "Ubah Password" → UI check: ada row di step_up_verifications
      (user_id, expires_at > now())?
      Ya → Skip verifikasi ulang, lanjut ke form ubah
      Tidak → Tampil dialog "Verifikasi Password Sekarang"
    ↓
    User input password → POST /auth/step-up/verify-password
    ↓
    Backend verify password == password_hash di users
      Ok → Insert step_up_verifications (user_id, action, verified_at=now(), expires_at=now+600s)
      Fail → Return error, user retry
    ↓
    User lihat form ubah password, selesaikan ubah, summit

CHANGE EMAIL FLOW (dengan step-up + re-verification):
  User klik "Ubah Email" → step-up verify password (10 min valid)
    ↓
  Form ubah email → input email baru → validate format
    ↓
  POST /account/email/change (require step_up_verifications valid)
    ↓
  Backend:
    - Update users.email = baru, email_verified=false
    - Revoke semua session/token user
    - Kirim email verifikasi ke email_baru dengan link: /verify-email?token=<signed_token>
    - Audit: email_change_requested, user
  ↓
  User klik link di email baru
    ↓
  Backend verify token signature, confirm email valid, update users.email_verified=true
  Audit: email_verified, user
  ↓
  User bisa login lagi dengan email baru

REQUEST ADMIN PASSWORD RESET (dari user dashboard):
  User klik "Request Admin Reset Password"
    ↓
  Step-up verify password (10 min valid) + form textarea reason
    ↓
  POST /account/password/request-reset
    ↓
  Backend:
    - Create ticket/task: user X minta reset (reason, timestamp)
    - Notify admin (Epic 12: notification)
    - Audit: password_reset_requested_by_user, user, reason
  ↓
  Admin approve/reject di console; jika approve:
    Admin jalankan reset (pilih auto-generate atau manual) → password_change flow
```

#### Tenant configuration untuk session timeout

Tenant configuration (milik Epic 5/8, consume di Epic 10):

| Setting | Default | Min | Max | Notes |
|---|---|---|---|---|
| `session_idle_timeout_seconds` | 3600 | 60 | 3600 | Tidak boleh > 1 jam |
| `session_absolute_lifetime_seconds` | 43200 | 900 | 43200 | Tidak boleh > 12 jam |
| `login_max_failures` | 10 | 3 | 20 | Banyak kegagalan sebelum lockout |
| `login_lockout_duration_seconds` | 900 | 300 | 3600 | Durasi lockout (15 min default) |
| `password_history_count` | 5 | 1 | 10 | Jumlah password lama yang dicek (no reuse) |
| `step_up_expiry_seconds` | 600 | 300 | 1800 | Validitas step-up verification (10 min default) |

Form input untuk Super Admin tenant:
- Dropdown `session_idle_timeout_seconds`: preset 15m, 30m, 1h (default), readonly — tidak bisa override ke > 1h
- Dropdown `session_absolute_lifetime_seconds`: preset 2h, 4h, 8h, 12h (default), readonly — tidak bisa override
- Lainnya: readonly untuk Wave 1; Wave 2 boleh ada UI untuk tenant config lebih granular

#### Gelombang pengerjaan

- **10.1: Password & Lockout** — upgrade bcrypt → Argon2id, policy 6-char + uppercase, failed login counter, 10 failures → 15 min lockout. Test: password hash, policy validation, lockout countdown, admin unlock.
- **10.2: Session & Revocation** — `sessions` table (dari Epic 1), timeout idle + lifetime, session revoke by user, revoke all by admin. Test: session expiry, revocation immediate effect, multiple device login, concurrent session data.
- **10.3: Refresh Token Family & Reuse Detection** — refresh token rotation, parent-child tracking, reuse detection → revoke family. Test: token refresh cycle, reuse detected, family revocation cascade.
- **10.4: Session Dashboard & Audit** — user view active session, revoke satu/semua-others, audit log lengkap (login, lockout, reset, password change, session revoke). Test: dashboard load, revoke interaksi, audit trail completeness.
- **10.5: Step-up & Sensitive Actions** — step-up verification sebelum ubah password/email, force-change enforcement. Test: step-up expiry, password change flow, email change + re-verification, must_change_password enforcement.
- **10.6: WebAuthn Wave 2 (defer)** — credential type alternative login, FIDO2 / platform authenticator support. Roadmap Future; bukan Wave 1.

#### Cross-epic handoff

| Ke | Yang diserahkan Epic 10 |
|---|---|
| **Epic 1 — Security Context, Role Definition** | Session table schema, session_id propagation di context, revocation check |
| **Epic 5 — Company, Tenant & Organization Profile** | Tenant session policy configuration (idle timeout, lifetime); reuse di Epic 10 |
| **Epic 6 — User Identity, Employee, BP & Assignment** | User master record + password_hash + must_change_password flag |
| **Epic 8 — Document Type, Numbering & Parameter** | Tenant configuration UI untuk session timeout (readonly preset di Wave 1) |
| **Epic 12 — Reporting, Scheduler & Notification** | Notifikasi lockout, password reset admin request, email verification |
| **Epic 11 — Extension Hooks** | Hook sebelum/sesudah password change, login success/failure |

#### Out-of-scope Epic 10

- WebAuthn/Passkey — Wave 2 future expansion.
- Konfigurasi password policy detail per tenant (min length, complexity rules) — sistem default 6 char + alphanumeric + uppercase, tidak configurable.
- Single-sign-on (SSO), OAuth, LDAP, social login — future expansion.
- API key, service account security — milik Epic yang terpisah.
- Encryption kolom sensitif di database — milik Epic Infrastructure/Security.
- Permission untuk reset akun lain — Super Admin + Tenant Admin saja; bukan per-role granular.

#### Open items

| # | Item | Perlu diselesaikan di |
|---|---|---|
| 1 | Email notifikasi template untuk password reset admin request & approval | **Dijawab Epic 12 (§4.12):** template tetap `notification_templates` (unique `(tenant_id, event_type, channel)`); transport email nyata lewat `MailTransport` + SMTP pada Wave 12.1; pengiriman lewat `notification_deliveries` dengan retry. Isi template per event type diisi saat Wave 12.1. |
| 2 | Mekanisme admin unlock akun (10 failures, 15 min cooling sudah otomatis; unlock manual needed?) | Epic 10 implementation phase |
| 3 | Export audit log security events (untuk compliance, SOC 2, penetration test) | **Dijawab Epic 12 (§4.12):** masuk sebagai laporan resmi di `report_definitions` (CSV/XLSX), **bukan** jalur export terpisah — retensi audit log lebih panjang dari log operasional dan `audit_log` terpartisi bulan (§4.12 keputusan #22, cross-epic handoff "Dari Epic 10"). |
| 4 | Device fingerprinting & anomaly detection (optional Wave 2) | Future; tidak Wave 1 |
| 5 | IP whitelist / blacklist per user atau per tenant | Future; not Wave 1 |
| 6 | Backup authenticator atau recovery code (terkait Wave 2 WebAuthn) | Wave 2 decision |
| 7 | ~~Rancang jalur recovery "Lupa Password"~~ — tertutup 2026-09-25: tidak ada self-service, user wajib hubungi admin tenant (keputusan #17) | Tidak perlu — keputusan terkunci |

#### Risk mitigation

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Bcrypt lama masih menerima login; attacker focus ke hashed bcrypt di DB | Bcrypt lebih lemah dari Argon2id; decrypt lebih cepat | Transparent rehash on login terjadi bertahap; setiap user yang login akan upgrade otomatis. Tidak ada timeline ketat rehash 100%, tetapi setelah 3–6 bulan mayoritas sudah Argon2id. |
| Password default dari admin reset user bisa bocor di email plain text | Email user tidak enkripsi; attacker intercept email → dapat password | Design: (A) admin copy/paste ke email sendiri, atau (B) sistem kirim email dengan link set-password (user klik link, set password diri sendiri tanpa admin tahu). Recommendation: implement opsi B untuk Wave 1+. |
| User lupa password tidak punya jalur self-service | User harus menghubungi admin tenant; ada friksi operasional dan beban admin | **Keputusan desain, bukan kelalaian.** Jalur "Lupa Password" self-service **sengaja tidak disediakan**. Pemulihan password sepenuhnya lewat admin tenant (lihat keputusan #10: reset + `must_change_password`). Konsekuensinya diterima: jalur self-service berbasis email menambah permukaan serangan (email compromise, token reset bocor) yang tidak diimbangi kebutuhan operasional saat ini. Karena tidak ada reset mandiri, lockout 15 menit adalah satu-satunya penundaan sebelum user dapat meminta reset admin. |
| Step-up 10 menit bisa kurang jika user di dalam meeting panjang, forget verify ulang | Session step-up expired saat user tik-tok ubah email; harus verify ulang | Default 10 menit reasonable untuk kantor; tenant bisa tighten lebih (bukan relax). UI warning "Anda akan ubah email; verify password sekarang agar tidak expire di tengah" |
| Session revocation tidak instant di client; attacker pakai token lama sampai request berikutnya | Token sudah di-revoke di server, tapi client tidak tahu sampai dapat 401 | Acceptable risk — 401 membuat client logout, token tidak bisa refresh ulang. Instant revocation butuh polling/push (WebSocket), out of scope Wave 1. |
| Audit log table terlalu besar dalam 1–2 tahun | Query audit log jadi lambat | Partition audit_log by date (bulan); query recent events cepat, historical archive. Detail partitioning: Epic 12 atau Infrastructure. |
| Multiple tenant dalam satu instance — session data satu tenant bisa bleed ke tenant lain | Critical security | Setiap session query, filter by tenant_id dalam WHERE clause WAJIB. Unit test eksplisit: user tenant A tidak bisa akses session tenant B. Code review checklist: tenant_id filter pada semua session query. |

#### Completion gate

Epic 10 dianggap selesai jika: 
(1) password hashing Argon2id + transparent rehash berjalan, policy 6-char enforce, history 5 no-reuse validated. 
(2) lockout 10 failures → 15 min berjalan dengan countdown user-visible. 
(3) `sessions` table dari Epic 1 menyimpan session state, idle timeout 1 jam + lifetime 12 jam auto-logout berjalan. 
(4) Refresh token family linkage + reuse detection berjalan; token family revoke cascade tested. 
(5) Session dashboard user menampilkan list sesi aktif + revoke one/all-others berfungsi. 
(6) Audit log mencatat login, lockout, reset, password change, session revoke events lengkap. 
(7) Step-up verification sebelum ubah password/email berjalan dengan 10 menit expiry. 
(8) Admin reset password: opsi A (auto-gen) atau B (manual) + display sekali tested. 
(9) must_change_password flag enforcement saat login + block app access sampai ubah password berfungsi.
(10) Multi-tenant isolation unit test pass + session data tidak bleed antar tenant.

**Bukan** syarat selesai Epic 10: WebAuthn/Passkey (Wave 2), password policy granular per tenant (static di Wave 1), SSO (future), push notification revocation instant (future).

**Tidak akan pernah dibangun** (keputusan #17): jalur "Lupa Password" self-service. Tidak ada epic recovery terpisah. Pemulihan password permanen lewat admin tenant.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci kontrak password, session, dan user security policies; tidak memberi persetujuan backend implementation sekarang.
- Kolom `password_hash_algorithm`, `failed_login_attempts`, `account_locked_until`, `must_change_password` di tabel `users` diperkirakan mudah ditambah di existing migration Epic 1 atau migration baru Epic 10.
- Tabel `refresh_tokens` sudah ada di migration 1755600000000 (Epic 1); Epic 10 migration revisi dengan kolom `parent_token_id`, `reuse_detected_at`, `rotation_count`.
- Tabel `sessions` dari Epic 1 adalah single source of truth session state; Epic 10 consume dan enforce timeout/revocation. Kolom device (user_agent, device_type, remote_addr) diperluas dari Epic 1 baseline untuk dashboard "Sesi Aktif Saya".
- Transparansi rehash bcrypt → Argon2id ON LOGIN adalah design yang sudah proven di banyak aplikasi (GitHub, HashiCorp Vault); risiko minimal, benefit besar (password strength upgrade tanpa user interrupt).
- Basis iDempiere: `NF1.0 PasswordRules`, `NF1.0 User_Locking`, `Login.java` verifikasi password — diadopsi langsung; MFA dari iDempiere 8.2+ ditolak per keputusan #4.
- Step-up authentication 10 menit adalah trade-off antara usability (user tidak verifikasi setiap kali) vs security (jendela 10 min acceptable untuk pencuri device terbuka). Tenant bisa ketat lebih (bukan relax).

---

### 4.11 EPIC 11 — Extension Hooks: Validator, Event, Callout & Process

#### Problem statement

Empat epic sebelumnya sudah berjanji menyerahkan pekerjaan ke Epic 11 tanpa menentukan kontraknya. §4.7 baris 2236 menulis "titik hook validator sebelum/sesudah transisi status; event saat Complete/Void/Close". §4.8 baris 2312 menulis "counter document dikonfigurasi di Epic 8, **dieksekusi di Epic 11**". §4.9 baris 2742 menulis "event terminal Complete/Reject/Return/Escalate dan perpindahan node menjadi titik hook; Epic 11 mengatur kontrak serta eksekusi extension". §4.10 baris 3154 menulis "hook sebelum/sesudah password change, login success/failure". Empat janji, nol kontrak.

Kondisi kode saat ini memperparah masalah itu. `EventBus` (`apps/api/src/application/event/event-bus.ts`) sudah ada dan bekerja, tetapi subscriber-nya **hardcoded** di `composition-root.ts` baris 604–660 — setiap behavior baru berarti mengubah kode dan deploy ulang. Tidak ada satu pun registry extension: `grep -i "hook"` di `apps/api/src` hanya mengembalikan enam komentar, bukan implementasi. Artinya semua kebutuhan "sesuaikan perilaku per tenant" yang sudah muncul di wawancara Epic 4–10 belum punya tempat untuk tinggal.

Epic 11 mengisi kekosongan itu dengan empat jenis extension — **Validator** (gate sebelum transisi, boleh menolak), **Event** (reaksi setelah kejadian, tidak boleh menolak), **Callout** (reaksi saat field berubah, memblokir form bukan transaksi), dan **Process** (pekerjaan manual atau terjadwal) — dijalankan lewat registry yang isinya dikurasi kode, bukan diketik admin. Prinsip pemisahnya satu kalimat: **admin memilih dari daftar, developer menentukan isi daftar.**

#### Keputusan terkunci (2026-09-25)

Wawancara Epic 11: 24 pertanyaan, semuanya terjawab. Nomor di bawah sama dengan nomor pertanyaan di sesi wawancara.

1. **Empat jenis extension masuk Wave 1: Validator, Event, Callout, dan Process.** Callout tetap masuk daftar meskipun UI authoring-nya baru matang nanti — kontrak backend-nya dikunci sekarang supaya generator UI Epic 13 tidak perlu membongkar engine. Penundaan hanya pada UI, bukan pada model.

2. **Registrasi hook: hybrid — metadata di database, handler dari allowlist kode.** Admin tidak mengetik nama class atau path handler. Handler yang boleh dipakai adalah yang sudah didaftarkan developer saat startup; konfigurasi (trigger point, urutan, parameter, aktif/tidak) hidup di database sebagai data. Ini menolak pendekatan lama iDempiere yang menyimpan `Classname` string bebas di `AD_Client.Validator` dan `AD_Process.Classname`.

3. **Pembagian wewenang: Super Admin mendaftarkan handler, Tenant Admin hanya mengaktifkan handler yang ditandai tenant-safe.** Setiap handler punya flag `tenant_safe` yang berasal dari kode dan tidak bisa diubah dari database atau UI. Handler non-tenant-safe hanya bisa diaktifkan Super Admin di scope System. Tenant Admin melihat daftar yang sudah tersaring, tidak melihat yang bukan haknya.

4. **Scope hook Wave 1: tenant. Wave 2: bertingkat System → Tenant → Organization Unit.** Wave 1 hanya punya dua level — System (dibuat Super Admin, berlaku semua tenant) dan Tenant (dibuat Tenant Admin dari handler tenant-safe). `organization_unit_id` disiapkan sebagai kolom nullable sejak awal, tetapi **tidak boleh diisi** dan tidak boleh muncul di UI sampai Wave 2. Alasan penundaan: struktur organisasi (Epic 5/6) belum stabil dan hook ber-scope unit adalah jalur paling mudah menciptakan kebocoran lintas unit.

5. **Validator dokumen berjalan sebelum dan sesudah transisi status.** Sebelum: validasi yang boleh membatalkan. Sesudah: reaksi yang tidak boleh membatalkan (contoh: membuat counter document Epic 8). Titik yang didukung dibatasi ke aksi dokumen yang benar-benar ada di Epic 7 — `Complete`, `Void`, `Close`, `Reverse` — bukan 16 timing `docValidate` iDempiere. Titik lain ditambah hanya kalau ada kebutuhan terverifikasi.

6. **Hook workflow dipasang pada perpindahan node dan pada event terminal — bukan pada setiap perubahan task approval.** Event terminal: `Approved`, `Rejected`, `Returned`, `Escalated` (kontrak Epic 9 baris 2742). Perpindahan node juga menjadi trigger. Perubahan kecil pada `approval_tasks` (klaim, komentar, baca) **bukan** trigger — kalau dijadikan trigger, satu dokumen bisa memicu puluhan eksekusi tanpa manfaat.

7. **Hook security Epic 10 mencakup login success/failure, password change, lockout, dan session revoke.** Empat event itu sesuai handoff Epic 10 baris 3154. Rotasi token internal (`parent_token_id`, `rotation_count`) **tidak** diekspos sebagai event extension — payload-nya menyentuh material token, dan tidak ada kebutuhan bisnis yang membenarkannya di Wave 1.

8. **Validator boleh membatalkan transaksi; event tidak boleh.** Validator mengembalikan error terstruktur dan transaksi rollback — semantik veto iDempiere dipertahankan. Event berjalan setelah commit dan kegagalannya **tidak** membatalkan apa pun; kegagalan dicatat dan diretry. Tidak ada mode "blocking event". Pemisahan ini yang membuat keputusan #11 bisa dijalankan.

9. **Payload hook terstruktur per event type, bukan baris penuh.** Setiap event type punya daftar field eksplisit yang dikirim. Handler tidak menerima `SELECT *` dari tabel — kalau butuh data lain, ia meminta lewat service (keputusan #10). Payload eksplisit berarti field baru tidak bocor ke extension secara diam-diam saat skema berubah.

10. **Handler mengakses data lewat service resmi, bukan database client.** Handler memanggil service internal yang sudah memegang authorization, audit, dan aturan tenant. `PoolClient` dan governed transaction **tidak** diteruskan ke handler extension. Database client langsung tetap hak eksklusif core engine (pola `inGovernedTransaction`, `apps/api/src/infrastructure/persistence/repositories/governed-transaction.ts`).

11. **Validator berjalan di dalam transaksi utama; event dan process berjalan setelah commit.** Validator butuh transaksi yang sama supaya rollback-nya nyata. Event dan process tidak boleh memperpanjang transaksi dokumen — handler lambat atau pihak ketiga yang menggantung tidak boleh menahan lock baris dokumen.

12. **Kegagalan event/process dicatat ke execution log dengan status `failed`, bisa diretry manual.** Bukan log server yang hilang setelah rotasi, bukan pula pembatalan transaksi. Setiap eksekusi punya baris sendiri: hook mana, entity mana, status, error, durasi.

13. **Retry otomatis terbatas dengan backoff, lalu berhenti sebagai `terminal_failed`.** Sejalan dengan pola outbox yang sudah dipakai `integration_outbox_deliveries` (migrasi `1771000000000`): `attempt_count`, `next_attempt_at`, `last_error`, `completed_at`. Retry tanpa batas ditolak karena menciptakan beban yang tidak pernah selesai dan menyembunyikan kegagalan permanen.

14. **Process bisa dipicu manual dan terjadwal dari satu definisi.** Bukan dua definisi terpisah. Bind ke `scheduled_jobs` yang sudah ada (migrasi `1755900000000`, lease `1772000000000`) untuk sisi terjadwal, dan ke aksi admin untuk sisi manual. Scheduler baru tidak dibuat — scheduler in-process yang sudah ada yang dipakai.

15. **Satu definisi process hanya boleh punya satu run aktif per tenant.** Process code yang sama untuk tenant yang sama tidak boleh berjalan ganda; tenant lain tetap bisa jalan paralel. Ini mencegah race condition di dalam tenant tanpa mengorbankan throughput lintas tenant.

16. **Counter document Epic 8 dieksekusi pada hook sesudah `Complete`, dengan fallback reconciliation process.** Jalur utama: dokumen utama selesai → hook membuat dokumen turunan. Jalur pemulihan: process terjadwal memindai dokumen `Complete` yang belum punya counter dan membuatnya. Fallback wajib ada karena hook sesudah commit bisa hilang saat proses crash — tanpa fallback, dokumen turunan bisa hilang permanen tanpa jejak.

17. **Pemetaan field counter document eksplisit per document type/code, bukan salin semua kolom dan bukan script.** Epic 8 sudah menyimpan peta tipe → tipe counter beserta aksi pemicunya; Epic 11 menambahkan pemetaan field sebagai data terstruktur. Field yang tidak dipetakan tidak ikut.

18. **Urutan eksekusi antar hook memakai `sequence_number`; validator bersifat fail-fast.** Nomor menentukan urutan deterministik. Pada validator, kegagalan hook pertama menghentikan hook berikutnya — validasi lanjutan yang berjalan di atas data yang belum lolos validasi dasar tidak punya arti. Pada event, kegagalan satu handler tidak menghentikan handler lain, karena tiap handler punya baris eksekusi sendiri.

19. **Audit hook mencatat: hook, event, tenant, entity, actor, payload ringkas, durasi, status, error.** Cukup untuk merekonstruksi apa yang terjadi dan siapa memicunya. Bukan payload penuh — ringkasan dan digest.

20. **Redaction wajib: password, token, secret, dan credential tidak pernah masuk payload atau log.** Konsisten dengan keputusan #12 Epic 10 ("raw password/token tidak pernah dicatat"). Ini juga alasan keputusan #7 menolak event rotasi token. Redaction dilakukan dispatcher sebelum payload diserahkan ke handler, bukan diserahkan ke kesadaran masing-masing handler.

21. **Tidak ada script bebas. Tidak ada JavaScript, tidak ada SQL, tidak ada ekspresi yang dievaluasi.** Hanya handler allowlist dengan parameter terstruktur yang divalidasi terhadap schema. Konsisten dengan Epic 9 yang menolak expression evaluator bebas dan membatasinya ke field/operator terdaftar.

22. **Konfigurasi hook berversi; satu versi aktif pada satu waktu.** Perubahan konfigurasi membuat baris versi baru, bukan menimpa. Ini yang membuat baris execution log bisa dijawab "hook ini isinya apa waktu itu", sebuah pertanyaan yang tidak bisa dijawab kalau konfigurasi di-update di tempat.

23. **Mode uji: test run dengan payload contoh, tanpa efek samping.** Admin bisa menjalankan hook terhadap payload contoh sebelum mengaktifkannya. Test run tidak menulis data bisnis dan tidak memicu efek lanjutan. Sandbox penuh per tenant ditolak karena terlalu besar untuk nilai yang diberikan.

24. **Urutan gelombang: Registry → Validator → Event → Process → Counter document → Callout & UI.** Fondasi registry dan allowlist harus berdiri lebih dulu; kalau fitur spesifik (counter document) dibangun sebelum kontrak umum stabil, setiap fitur akan menciptakan mekanisme registrasinya sendiri — persis kekacauan yang Epic 11 ada untuk mencegahnya.

#### Prinsip yang mengikat

- **Admin memilih dari daftar, developer menentukan isi daftar.** Registrasi handler adalah kode; konfigurasi adalah data; keduanya tidak boleh tertukar.
- **Veto hanya milik validator.** Satu-satunya extension yang boleh menggagalkan transaksi adalah validator yang berjalan sebelum commit. Semua reaksi lain berjalan setelah commit dan gagalnya dicatat, bukan membatalkan.
- **Transaksi dokumen tidak menunggu extension.** Handler lambat, pihak ketiga mati, atau job panjang tidak boleh menahan lock baris dokumen.
- **Tidak ada script bebas.** Handler dari allowlist + parameter terstruktur + schema validasi. Ini garis yang sama dengan Epic 9 (condition terstruktur) dan Epic 8 (pattern builder, bukan free-text).
- **Redaction terjadi di dispatcher, bukan di hati nurani handler.** Payload yang sensitif tidak pernah keluar dari core; keamanan tidak bergantung pada handler yang berperilaku baik.
- **Setiap eksekusi punya bukti.** Baris execution log per eksekusi: siapa, apa, entity mana, status, error, durasi — dan versi konfigurasi yang berlaku saat itu.
- **Registry satu-satunya jalan.** `EventBus` subscriber hardcoded tidak lagi menjadi tempat behavior baru; semuanya lewat registry agar punya konfigurasi, audit, dan retry yang sama.

#### Basis iDempiere (terverifikasi terhadap source resmi)

| Konsep | Sumber terverifikasi | Diadopsi/dimodifikasi |
|---|---|---|
| Model Validator — `modelChange`/`docValidate` return String non-null = veto | `org.compiere.model.ModelValidator` (interface: `initialize`, `getAD_Client_ID`, `login`, `modelChange`, `docValidate`; `06-plugin-system.md` §9, `17-event-system.md` §3) | **Adopt** semantik veto (keputusan #8); **Reject** signature — return error terstruktur, bukan String |
| 16 nilai `TIMING_*` siklus dokumen | `ModelValidator` (`06-plugin-system.md:253-258`, `17-event-system.md` §3.2) | **Modernize** — dipangkas ke 4 aksi Epic 7: `Complete`, `Void`, `Close`, `Reverse`, dengan timing before/after (keputusan #5) |
| `TYPE_*` ↔ OSGi topic 1-ke-1 (`tableEventTopics[]`) | `ModelValidator` + `IEventTopics` (`17-event-system.md` §3.1) | **Adopt** prinsip satu mekanisme, dua wajah — Validator dan Event adalah dua konsumsi dari titik picu yang sama (keputusan #5, #6, #7) |
| `postEvent` (async, non-veto) vs `sendEvent` (sync, veto-able) | `IEventManager` (`17-event-system.md` §6.2) | **Adopt** pemisahan sync-veto vs async-reaksi sebagai dasar keputusan #8 dan #11 |
| Callout — return error memblokir UI, bukan transaksi | `org.compiere.model.Callout` + `CalloutEngine` (reflection, `06-plugin-system.md` §10) | **Adopt** semantik (memblokir form, bukan transaksi); **Modernize** — reflection diganti handler allowlist (keputusan #2, #21) |
| Registrasi `AD_Client.Validator` / `AD_Process.Classname` string bebas | `AD_Client`, `AD_Process` legacy path (`06-plugin-system.md` §9, §11) | **Reject** — string classname bebas diganti allowlist + flag `tenant_safe` (keputusan #2, #3) |
| `SvrProcess` (prepare/doIt) + `AD_Process` + `AD_Scheduler` | `org.compiere.process.SvrProcess`, `06-plugin-system.md` §11, `16-scheduler.md` | **Adopt** satu definisi dua pemicu (manual + jadwal, keputusan #14); **Reject** thread-per-job tanpa distributed lock (`16-scheduler.md` §8) — diganti lease `scheduled_jobs` yang sudah ada |
| Script ModelValidator JSR-223 (`AD_Table_ScriptValidator`) | `ModelValidationEngine` dispatch (`17-event-system.md` §4.3) | **Reject** tegas — tidak ada script apapun (keputusan #21), konsisten Epic 9 |
| Login hook (`validator.login(...)`) + `AFTER_LOGIN` topic | `ModelValidationEngine.loginComplete` (verified raw `release-11`) | **Adopt** sebagai salah satu trigger security hook (keputusan #7) |

#### Model target

Tabel baru Epic 11 (nama final saat desain; struktur mengikat):

| Tabel | Fungsi | Kolom kunci |
|---|---|---|
| `hook_handlers` | Allowlist handler yang terdaftar dari kode | `code` (unik), `hook_type` (`validator`/`event`/`callout`/`process`), `tenant_safe` (dari kode, immutable), `param_schema` (jsonb), deskripsi |
| `hook_configs` | Konfigurasi aktif per tenant/system | `handler_code` FK allowlist, `scope` (`system`/`tenant`), `tenant_id` (nullable untuk system), `organization_unit_id` (nullable, **tidak terisi di Wave 1**), `trigger_point`, `sequence_number`, `params` (jsonb, divalidasi terhadap `param_schema`), `is_active`, `config_version` |
| `hook_config_versions` | Riwayat versi konfigurasi | `hook_config_id`, `version`, snapshot kolom konfigurasi, `changed_by`, `changed_at` — update tidak pernah menimpa |
| `hook_executions` | Log eksekusi per eksekusi | `hook_config_id`, `config_version` (snapshot), `event_type`, `tenant_id`, `entity_type`, `entity_id`, `actor_user_id`, `payload_digest`, `status` (`succeeded`/`failed`/`terminal_failed`/`skipped`), `attempt_count`, `next_attempt_at`, `last_error`, `duration_ms`, `started_at`, `finished_at` |
| `counter_document_mappings` | Pemetaan field counter document (eksekusi kontrak Epic 8) | `document_type_id`, `document_code_id`, `target_document_type_id`, `trigger_action` (dari Epic 8), `field_map` (jsonb eksplisit sumber→target) |

Tabel yang **dipakai ulang** tanpa perubahan: `scheduled_jobs` + `scheduled_job_runs` (migrasi `1755900000000`, lease `1772000000000`) untuk process terjadwal; `domain_events` + `EventBus` sebagai titik picu event (dispatcher Epic 11 menjadi subscriber terdaftar yang berasal dari registry, bukan hardcoded); `integration_outbox_deliveries` sebagai pola referensi retry/backoff.

#### Mekanisme — dispatch & veto

```
TITIK PICU (semua mekanisme berasal dari titik yang sama):
  1. Sebelum transaksi: document_action(Complete|Void|Close|Reverse, before)
     → dispatcher validator, in-transaction, fail-fast, urut sequence_number
  2. Setelah commit:   document_action(..., after) | workflow.transition |
     workflow.terminal(Approved|Rejected|Returned|Escalated) |
     security.login_success | security.login_failure | security.password_changed |
     security.lockout | security.session_revoked
     → dispatcher event, post-commit, tiap handler terisolasi

VALIDATOR (in-transaction, veto-able):
  for hook in validators(trigger_point, tenant) sort by sequence_number:
    result = handler.execute(reduced_payload, services)   // bukan PoolClient
    if result.error:
      raise HookVetoError(result.error)   → transaksi ROLLBACK
      → hook_executions INSERT status='failed' (dalam transaksi terpisah)
      → sisa validator pada trigger_point itu TIDAK dijalankan (fail-fast)
    else: hook_executions INSERT status='succeeded'

EVENT (post-commit, non-veto):
  for hook in events(event_type, tenant) sort by sequence_number:
    try:
      handler.execute(payload, services)
      hook_executions INSERT status='succeeded'
    catch e:
      hook_executions INSERT status='failed', attempt_count=1, next_attempt_at=now()+backoff
      // handler BERIKUTNYA tetap jalan — isolasi antar handler
```

#### Mekanisme — retry & reconciliation

```
RETRY (backoff terbatas, pola integration_outbox_deliveries):
  attempt_count < MAX_RETRY (default 3):
    next_attempt_at = now() + backoff(attempt_count)   // eksponensial, jitter
  attempt_count >= MAX_RETRY:
    status = 'terminal_failed'   // berhenti; operator lihat di log, retry manual

MANUAL RETRY:
  Admin pilih baris hook_executions status IN ('failed','terminal_failed')
  → eksekusi ulang dengan payload tersimpan (digest → payload disimpan terpisah
    sesuai policy retensi) → attempt_count++ → audit catat siapa yang retry

COUNTER DOCUMENT RECONCILIATION (fallback keputusan #16):
  scheduled process (bind scheduled_jobs):
    SELECT dokumen doc_status='Complete' dengan aksi pemicu counter terpenuhi
      ANTI JOIN dokumen turunan yang sudah dibuat
    → buat dokumen turunan via field_map
    → idempotent: dokumen yang sudah ada dilewati, bukan diduplikasi
```

#### Gelombang pengerjaan

| Wave | Isi | Syarat selesai |
|---|---|---|
| 11.1 | Registry: `hook_handlers` allowlist + loader startup + `hook_configs` + validasi `param_schema` + versi konfigurasi | Handler terdaftar dari kode; config CRUD dengan validasi schema; versi tercatat |
| 11.2 | Validator engine: dispatch in-transaction, veto rollback, fail-fast, execution log | Test: veto membatalkan transaksi; fail-fast menghentikan rantai; log terisi |
| 11.3 | Event engine: dispatcher post-commit, isolasi antar handler, retry + backoff + `terminal_failed`, retry manual | Test: kegagalan satu handler tidak menghentikan lainnya; retry maju sesuai backoff; terminal berhenti |
| 11.4 | Process engine: definisi dua pemicu (manual + `scheduled_jobs`), lock satu-run-per-tenant | Test: run ganda dalam satu tenant ditolak; tenant lain tidak terganggu |
| 11.5 | Counter document: eksekusi peta Epic 8 pada hook after-Complete + fallback reconciliation idempotent | Test: counter terbuat dari hook; crash simulation → reconciliation melengkapi tanpa duplikat |
| 11.6 | Security & workflow hooks: 5 trigger security Epic 10 + trigger workflow Epic 9; Callout contract (backend, tanpa UI); UI admin hook (list, aktif/nonaktif, urutan, test run) | Test: setiap trigger terpicu dari aksi nyata; test run tidak menulis data bisnis |

#### Cross-epic handoff

| Ke/Dari | Kontrak |
|---|---|
| **Dari Epic 2** | Metadata engine sebagai pola definisi data-driven; allowlist `hook_handlers` mengikuti disiplin metadata Epic 2 |
| **Dari Epic 7** | Aksi dokumen `Complete`/`Void`/`Close`/`Reverse` sebagai trigger point; kontrak transaksi dan `document_codes` |
| **Dari Epic 8** | Peta tipe → tipe counter + aksi pemicu (`doc_action`); Epic 11 menambahkan `field_map` dan **mengeksekusi** pembuatan dokumen turunan |
| **Dari Epic 9** | Event transition node + terminal `Approved`/`Rejected`/`Returned`/`Escalated`; nama/payload final hook (open item #3 Epic 9) ditutup di sini: payload per event type didaftarkan pada Wave 11.1 |
| **Dari Epic 10** | Trigger security: login success/failure, password change, lockout, session revoke; rotasi token **tidak** diekspos |
| **Dari infra yang ada** | `EventBus` (titik picu), `scheduled_jobs` (scheduler), pola outbox (retry/backoff) |
| **Ke Epic 12** | Notifikasi berasal dari event hook (contoh: lockout → email ke admin); Epic 12 hanya kanal pengiriman |
| **Ke Epic 13** | Kontrak Callout backend siap; UI authoring callout menyusul di generator UI |
| **Ke Epic 14** | Hook after-Complete adalah titik pemasangan GL posting (Epic 14) — posting berjalan sebagai handler event, bukan modifikasi engine dokumen |

#### Out-of-scope Epic 11

- Script engine apapun (JS, SQL, expression evaluator) — ditolak permanen, bukan ditunda.
- Hook ber-scope Organization Unit — Wave 2 (kolom disiapkan, tidak terisi).
- OSGi-style hot-deploy plugin runtime — tidak relevan untuk stack Node/TS.
- Distribusi extension pihak ketiga / marketplace handler — future, butuh model keamanan terpisah.
- Message queue eksternal (RabbitMQ/Kafka) — pola outbox in-process sudah cukup; swap ke queue tetap additive.
- Debug/step-through debugger hook — mode uji payload-contoh (keputusan #23) adalah batas Wave 1.

#### Open items

| # | Item | Perlu diselesaikan di |
|---|---|---|
| 1 | Payload final per event type (daftar field eksplisit) untuk semua trigger | Wave 11.1 saat daftar event type didaftarkan |
| 2 | Retensi `hook_executions` dan payload tersimpan (berapa lama, arsip atau hapus) | **Dijawab Epic 12 (§4.12):** `hook_executions` diperlakukan sebagai **log operasional** — retensi lebih pendek dari audit log, dijalankan oleh job pembersihan terjadwal Wave 12.7 (keputusan #22). Angka konkretnya open item #2 Epic 12. |
| 3 | Nilai `MAX_RETRY` dan bentuk backoff (default proposal: 3 attempt, eksponensial + jitter) | Parameter policy saat implementasi 11.3 |
| 4 | UI authoring callout (form mana, field mana, urutan evaluasi) | **Dijawab Epic 13 (§4.13):** dijalankan di generator setelah pola render terbukti — Wave 13.5+; kontrak backend Callout (baris 3233) tidak dibongkar |
| 5 | Kriteria handler boleh diberi flag `tenant_safe` (checklist review kode) | Checklist internal sebelum Wave 11.1 |
| 6 | Payload counter document yang mengandung file/lampiran — ikut field_map atau slot terpisah | Terkait open item #16 file policy (Epic 5/6/7) |

#### Risk mitigation

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Handler lambat/buggy menahan transaksi dokumen | Semua user tenant menunggu; lock baris panjang | Validator adalah satu-satunya kode in-transaction dan wajib cepat (guideline review); semua reaksi post-commit; timeout handler di dispatcher |
| Kebocoran data sensitif lewat payload | Password/token masuk log atau pihak ketiga | Redaction di dispatcher sebelum payload keluar (keputusan #20); event rotasi token tidak diekspos (keputusan #7) |
| Hook error membatalkan transaksi bisnis yang sah | Dokumen tidak bisa diposting karena bug extension | Veto hanya validator; kegagalan event tidak membatalkan; admin bisa nonaktifkan hook tanpa deploy |
| Duplikasi dokumen turunan saat crash | Counter document ganda | Reconciliation idempotent + ANTI JOIN (keputusan #16); unique constraint pada tautan dokumen turunan |
| Admin tenant mengaktifkan handler berbahaya | Eksekusi kode tidak terkendali per tenant | Flag `tenant_safe` immutable dari kode; Tenant Admin hanya melihat handler tersaring (keputusan #3) |
| Konfigurasi berubah diam-diam, eksekusi lama tak bisa dijelaskan | Audit tidak bisa merekonstruksi kejadian | Versi konfigurasi + `config_version` snapshot di setiap baris eksekusi (keputusan #22) |
| Retry tak berujung membebani sistem | Beban terus mengalir ke handler yang rusak | `MAX_RETRY` + `terminal_failed` (keputusan #13); terminal terlihat di admin UI, retry manual eksplisit |

#### Completion gate

Epic 11 dianggap selesai jika:
(1) registry allowlist berjalan: handler hanya bisa didaftarkan dari kode, `tenant_safe` immutable, config tervalidasi `param_schema`.
(2) versi konfigurasi tercatat; update tidak menimpa; `config_version` tersnapshot di setiap eksekusi.
(3) validator berjalan in-transaction: veto menghasilkan rollback nyata; fail-fast teruji; urutan `sequence_number` deterministik.
(4) event berjalan post-commit: kegagalan satu handler tidak menghentikan handler lain; retry backoff sampai `terminal_failed`; retry manual berfungsi.
(5) process: satu definisi dua pemicu; lock satu-run-per-tenant teruji dengan run ganda.
(6) counter document terbuat dari hook after-Complete sesuai `field_map`; reconciliation idempotent melengkapi hasil crash tanpa duplikat.
(7) lima trigger security Epic 10 dan trigger workflow Epic 9 terpicu dari aksi nyata (bukan dari test harness saja).
(8) redaction teruji: payload berisi password/token uji tidak pernah muncul di payload, log, maupun execution log.
(9) test run mode uji: payload contoh dieksekusi tanpa menulis data bisnis.
(10) isolasi tenant: hook tenant A tidak pernah terpicu oleh event tenant B (unit test eksplisit).

**Bukan** syarat selesai Epic 11: UI authoring callout (Epic 13), GL posting (Epic 14, hanya titik pemasangannya), hook ber-scope Organization Unit (Wave 2), message queue eksternal, marketplace extension.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci kontrak extension engine; tidak memberi persetujuan backend implementation sekarang.
- `EventBus` yang ada **tidak dibongkar**: ia tetap titik picu; yang berubah adalah cara subscriber baru lahir — lewat registry, bukan lewat baris baru di `composition-root.ts`.
- `governed-transaction.ts` tetap hak core engine; dispatcher validator dipanggil **di dalam** `inGovernedTransaction` oleh engine dokumen/workflow, bukan oleh handler.
- Nama tabel bersifat proposal penamaan; struktur dan kolom kunci yang mengikat. Penamaan final mengikuti konvensi migration yang berlaku.
- Open item #3 Epic 9 (nama/payload hook workflow) tertutup secara mekanisme: payload per event type didaftarkan sebagai data di Wave 11.1 — Epic 9 tidak perlu mengubah engine-nya.
- Basis iDempiere diverifikasi terhadap `06-plugin-system.md` §9–§11, `16-scheduler.md`, `17-event-system.md` §3–§6, plus raw source `ModelValidator.java`, `IEventTopics.java`, `Callout.java`, `ModelValidationEngine.java` (release-11).
- Keputusan #17 (no self-service password recovery) Epic 10 tidak berubah; hanya statusnya yang dikoreksi dari risiko terbuka menjadi keputusan terkunci hari ini.

---

### 4.12 EPIC 12 — Reporting, Scheduler & Notification Artifacts

#### Problem statement

Epic 12 adalah **penerima terbesar di roadmap**: 28 referensi masuk dari enam epic sebelumnya, dan sebelum hari ini belum ada satu pun kontraknya. Epic 5 meminta definisi "laporan sudah ditutup" (baris 1664). Epic 6 meminta notifikasi expiry assignment (baris 2074, 2093). Epic 7 meminta layar monitoring dokumen `posted = 'E'` dan notifikasi kegagalan posting (baris 2173, 2237, 2264). Epic 8 meminta parameter notifikasi dan penanganan gap nomor pada laporan audit (baris 2434, 2454). Epic 9 meminta pemanggilan berkala evaluator deadline, reminder eskalasi, dan kanal routing (baris 2707, 2722, 2743, 2759). Epic 10 meminta notifikasi lockout, reset admin, verifikasi email, plus export audit log (baris 3111, 3153, 3169, 3171). Epic 11 sudah lebih tegas lagi: "Notifikasi berasal dari event hook; **Epic 12 hanya kanal pengiriman**" (baris 3393).

Kondisi kode saat ini memperlihatkan tiga kesenjangan yang berbeda sifat.

**Transport tidak ada.** Notification Engine sudah berdiri: tabel `notification_templates` dan `notifications` ada sejak migrasi `1755900000000`, template benar-benar di-render, dan baris log status `sent` benar-benar ditulis. Tetapi hanya `in_app` yang punya pembaca nyata. Komentar `notification.service.ts:156` mengakuinya terbuka: kanal lain "Notification-ready … but no live transport exists yet in this workspace". Nol dependensi mail di `apps/api/package.json`. Artinya seluruh janji notifikasi dari Epic 7, 9, dan 10 hari ini **tidak sampai ke siapa pun** — barisnya tercatat `sent` padahal tidak ada yang terkirim.

**Penjadwalan tidak tahan restart.** Scheduler berjalan sebagai `setInterval` per job di dalam proses API, dijaga lease DB (`locked_at`/`lock_token`, 5 menit, heartbeat lease/3). Tiga handler terdaftar: `workflow-escalation-sweep`, `integration-outbox-reconciliation`, `service-quality-sla-reconciliation`. `implementation-notes.md:717` mencatat gap-nya sendiri: "bila proses API di-restart di tengah interval, job berikutnya baru berjalan setelah proses baru selesai boot, tidak ada mekanisme 'mengejar' jadwal yang terlewat". Konsekuensi konkret: **eskalasi deadline Epic 9 bisa terlewat saat deploy**, dan eskalasi yang terlewat berarti approval menggantung.

**Reporting ada, tapi bukan mesin laporan.** `reporting-insight` memberi CSV export, BI query builder dengan saved reports, dan tiga model prediksi. Tidak ada PDF/XLSX. Permission sudah ada (`reporting.read`, `reporting.export`, `reporting.bi.manage`, `reporting.predictive.read`). Jadi yang belum ada bukan kemampuan membaca data — melainkan **artefak**: file yang tersimpan, terjadwal, terkirim, dan punya masa simpan.

Epic 12 menutup ketiganya tanpa membangun mesin laporan baru. Prinsip pemisahnya: **kanal dulu, karena kanal dipakai semua gelombang lain.** Monitoring `posted='E'` (Epic 7), reminder eskalasi (Epic 9), notifikasi lockout (Epic 10), dan laporan terjadwal semuanya membutuhkan transport yang sama — membangun konsumennya lebih dulu berarti membangun notifikasinya dua kali.

#### Keputusan terkunci (2026-09-25)

Wawancara Epic 12: 24 pertanyaan. Nomor di bawah sama dengan nomor pertanyaan di sesi wawancara.

1. **Cakupan: Notifikasi + Scheduler hardening + Reporting artifacts, tanpa mesin laporan baru.** Mesin print-format `AD_PrintFormat`/`AD_PrintFormatItem` iDempiere **tidak** dibangun. Reporting existing (CSV + BI + prediksi) dipertahankan dan ditambah penyimpanan, penjadwalan, pengiriman, dan retensi. Alasan: mayoritas janji Epic lain adalah soal kanal dan monitoring, bukan mesin pencetakan laporan; mesin print-format adalah proyek tersendiri dengan biaya besar untuk kebutuhan yang belum terbukti.

2. **Transport email: SMTP global satu instance, dengan antarmuka `MailTransport` sebagai adapter.** Wave 1 memakai SMTP langsung. Provider API (Resend/SES/SendGrid) disiapkan sebagai implementasi alternatif dari antarmuka yang sama, tanpa membongkar engine. SMTP per tenant (pola `AD_Client.SMTPHost` iDempiere) **ditolak** untuk Wave 1 — menambah manajemen kredensial per tenant yang belum terbukti dibutuhkan.

3. **Kanal Wave 1: `in_app` + `email` + `push`, ditambah transport frontend service worker dan bot Telegram.** Tiga kanal enum hidup sungguhan. `push` mencakup dua transport: **Web Push via service worker** di frontend, dan mobile push (FCM/APNs) saat aplikasi mobile ada. **Telegram bot** ditambahkan sebagai kanal pengiriman. `whatsapp` dan `sms` tetap ada di enum tetapi **tidak** punya transport Wave 1 — keduanya menunggu kontrak vendor berbayar yang belum ada pemiliknya.

4. **Preferensi notifikasi per user: saklar global (pola iDempiere `AD_User.NotificationType` — `E`/`N`/`B`/`X`) di Wave 1; per event type di Wave 2.** Wave 1 memakai satu saklar: email, in-app, keduanya, atau none. Preferensi per event type ditunda karena butuh UI matriks dan default per event type. **`in_app` didefinisikan sebagai inbox terpadu yang kelak mencakup web app dan mobile app** — bukan sekadar panel di web. Definisi ini dikunci sekarang supaya model data tidak perlu diubah saat aplikasi mobile dibangun.

5. **Resolusi penerima: hybrid — konvensi payload sebagai default, konfigurasi tenant sebagai override.** Konvensi yang sudah ada (`targetUserId` / `targetUserIds` / `targetRoleCode` + `targetOrganizationUnitId`) tetap berlaku dan menang bila terisi. Bila payload tidak menentukan penerima, konfigurasi tenant per event type dipakai. Ini menutup kasus yang tidak bisa dijawab payload: "kegagalan posting → admin tenant" (Epic 7) dan "lockout → admin" (Epic 10).

6. **Retry pengiriman notifikasi: terbatas + backoff, meniru pola outbox.** `attempt_count`, `next_attempt_at`, `last_error`, berakhir di `terminal_failed`. **Tabel retry notifikasi sendiri**, bukan memakai ulang `integration_outbox_deliveries` — tabel itu terikat `integration_endpoint_id` secara FK, dan email bukan endpoint; memaksakannya akan mengotori model. Yang disalin adalah polanya, bukan tabelnya.

7. **Prioritas tinggi dikirim langsung; sisanya masuk digest berkala.** Notifikasi yang tidak boleh tertunda — lockout, eskalasi workflow, kegagalan posting — dikirim seketika. Sisanya digabung ke digest berkala per user. Ini menolak "semua langsung" (banjir email pada volume tinggi) dan menolak "semua digest" (notifikasi keamanan tertunda). Klasifikasi prioritas berasal dari event type, didaftarkan sebagai data.

8. **Definisi laporan tetap: laporan resmi sebagai kode (service + query terdaftar) untuk kebutuhan formal, dan BI query builder untuk eksplorasi.** Dua jalur dengan peran berbeda. Jalur resmi memakai pola `reporting-insight` (read-only projection, permission eksplisit, Data Scope ditegakkan di service/repository). Jalur eksploratif memakai `BiService` yang sudah ada. **Metadata print-format deklaratif (opsi iDempiere) ditolak** — membangunnya berarti membuat mesin baru dan membuka jalan menuju definisi laporan sebagai data, yang bertentangan dengan disiplin Epic 11.

9. **Query builder ad-hoc untuk user dibatasi ke dataset terdaftar (`BiService` yang sudah ada).** User memilih dari dataset yang sudah diaudit; tidak ada SQL bebas. **SQL bebas bagi role tertentu (pola `AD_AlertRule`) ditolak** — `AD_AlertRule` adalah satu-satunya tempat iDempiere membiarkan user menulis SQL, dan itu diakui sebagai pengecualian berisiko. Membukanya akan membatalkan garis yang baru dikunci Epic 11 #21.

10. **`PredictiveService` tetap ada dan tetap di luar cakupan laporan terjadwal.** Tiga model yang sudah jalan (`complaint_volume_forecast`, `sla_breach_risk_forecast`, `survey_satisfaction_trend`) tidak dijadwalkan dan tidak dikirim sebagai laporan berkala. Alasan: menjadwalkannya memaksa keputusan tentang akurasi dan tanggung jawab atas ramalan yang belum matang; mengeluarkannya berarti membuang kerja yang sudah selesai.

11. **Format output: CSV + XLSX di Wave 1; PDF di Wave 2.** CSV sudah ada. XLSX ditambahkan karena laporan operasional selalu berakhir di Excel dan biayanya kecil (library murni JS). **PDF ditunda** karena membutuhkan renderer headless (memori, font, waktu proses) dengan beban operasional besar yang tidak sepadan untuk Wave 1.

12. **Artifact disimpan ke tabel `documents` yang sudah ada, dengan pembersihan default 6 bulan sekali.** Byte disimpan lewat `LocalFileStorage` (`FILE_STORAGE_ROOT`), metadata di `documents` (`storage_path`, `checksum`, `tenant_id`, `created_at`, `deleted_at`). Kaitan ke definisi laporan dan jadwal memakai kolom `entity_type`/`entity_id` yang sudah ada. Ini menolak dua ekstrem iDempiere: menyimpan selamanya di `AD_Archive` tanpa retensi (kekurangan yang tidak layak ditiru) dan menghapus file segera setelah kirim (`Scheduler.java:386`) sehingga user kehilangan riwayat. **Default retensi 6 bulan**, dapat di-override per definisi laporan (keputusan #13).

13. **Retensi dapat diatur per definisi laporan; default global 6 bulan.** Laporan keuangan dan laporan operasional punya kewajiban simpan berbeda, jadi satu angka untuk semua tidak cukup. Default global tetap ada supaya laporan tanpa konfigurasi tidak menumpuk tanpa batas. Proses pembersihannya memakai scheduler yang sudah diperkuat (keputusan #16).

14. **Laporan terjadwal dikirim sebagai tautan unduhan ke artifact tersimpan, bukan lampiran email.** Link memakai permission `reporting.read` dan `documents` yang sudah ada, dan setiap unduhan terekam. Lampiran email **ditolak** karena ia melewati seluruh authorization — siapa pun yang menerima email mendapat data, tanpa jejak akses. Lampiran sebagai opsi per jadwal untuk laporan kecil menjadi kandidat Wave 2.

15. **Tidak ada subsystem alert dengan query SQL user.** Pola iDempiere `AD_Alert` + `AD_AlertRule` + `AD_AlertProcessor` **tidak** diadopsi. Kebutuhan "pantau kondisi lalu beri tahu" dipenuhi oleh hook Epic 11 (kondisi terstruktur) + scheduler Epic 12 (berkala) + kanal Epic 12 (kirim). Condition builder terstruktur tanpa SQL dicatat sebagai kandidat, tetapi **bukan** keputusan Epic 12 — kalau dibutuhkan, itu wawancara lanjutan Epic 9 yang sudah memiliki kosakata condition.

16. **Scheduler: tambahkan catch-up saat boot (jalankan job yang jadwalnya terlewat); migrasi ke job runner tahan-restart tetap terbuka sebagai jalur upgrade terpisah.** Catch-up adalah perbaikan kecil di `SchedulerService.start()` tanpa infrastruktur baru, dan menutup kerugian nyata (eskalasi terlewat saat deploy). Migrasi ke pg-boss/BullMQ tetap terbuka tanpa migrasi skema, karena `implementation-notes.md:744` sudah menyatakan itu "penggantian implementasi murni, bukan desain ulang skema `scheduled_jobs`".

17. **Retry job scheduler hanya untuk job yang ditandai idempoten.** Retry buta pada job non-idempoten berbahaya: job yang menulis dokumen bisa menghasilkan duplikat. Tiga handler yang ada sudah idempoten, jadi flag itu murah untuk diisi — dan justru memaksa penilaian sadar setiap job baru ditambahkan. Sejalan dengan keputusan #6 (retry notifikasi) dan pola outbox.

18. **Konkurensi scheduler lintas instance tetap memakai lease DB yang ada; advisory lock dan afinitas IP ditolak.** Lease + heartbeat adalah mekanisme yang **lebih baik** dari iDempiere, yang hanya punya `AD_Schedule.RunOnlyOnIP` tanpa distributed lock sama sekali. Afinitas IP rapuh di lingkungan container. Advisory lock menambah kompleksitas tanpa masalah nyata selama heartbeat bekerja.

19. **Identitas eksekusi job terjadwal: satu user sistem khusus (`system`/`scheduler`).** Rantai empat kandidat iDempiere (supervisor → createdBy → updatedBy → superuser, `AdempiereServer.java:211-222`) **ditolak** karena identitas pelaku bisa berubah diam-diam saat kolom `createdBy`/`updatedBy` berubah — buruk untuk audit. Aksi manual (`triggerManually`) tetap memakai user yang menekan tombol, seperti sekarang.

20. **Permission eksplisit dengan batas scope: Tenant Admin mengelola jadwal tenant, jadwal sistem hanya Super Admin.** `scheduler.manage`, `reporting.read`, `reporting.export` sudah ada di `capabilities.ts` dan dipakai route sekarang — ini bukan permission baru, hanya penambahan batas scope. Model iDempiere (tanpa permission khusus scheduler) tidak berlaku di sini karena iDempiere tidak punya konsep multi-tenant SaaS.

21. **Laporan wajib menghormati Data Scope, dan scope yang dipakai dicetak di laporan.** Epic 1 sudah menetapkan scope sebagai fondasi RBAC, dan komentar `composition-root.ts:405` menyatakan Data Scope "enforced in the service/repository" — jadi ini melanjutkan yang berlaku, bukan aturan baru. Bagian yang baru: **laporan menampilkan scope yang dipakai**, supaya pembaca tidak menyangka angka terpotong sebagai angka lengkap.

22. **Retensi per jenis log, dengan audit log terpisah dan lebih lama.** Log operasional (hook execution Epic 11, notifikasi terkirim, scheduler run) dan audit keamanan (Epic 10) punya kewajiban simpan berbeda — mencampurnya memaksa salah satu ekstrem. Partisi bulan untuk `audit_log` masuk paket ini (open item Epic 10 di `§4.10` risk table).

23. **Layar monitoring "Dokumen Belum Terposting" plus notifikasi ke admin tenant saat `posted='E'`.** Epic 7 risk table sudah menyebut mitigasinya sebagai "layar monitoring (Epic 12) + status `posted='E'` tampil di dokumen" — jadi layar adalah bagian kontrak, bukan tambahan. Notifikasi menutup celah waktunya: tanpa itu, kegagalan posting hanya terlihat bila seseorang kebetulan membuka layarnya.

24. **Urutan gelombang: transport notifikasi → retry → preferensi & penerima → artifact → laporan terjadwal → monitoring → retensi.** Kanal lebih dulu karena semua gelombang berikutnya membutuhkannya.

#### Prinsip yang mengikat

- **Kanal dulu.** Transport dibangun sebelum konsumennya; setiap gelombang lain memakai kanal yang sama.
- **Channel adalah persepsi user; transport adalah cara mengirim.** Satu channel bisa punya beberapa transport (`push` = Web Push + mobile push). Jangan mencamp keduanya dalam satu kolom.
- **Setiap kiriman punya jejak.** Baris notifikasi mencatat status sebenarnya, bukan `sent` yang diasumsikan. Kegagalan transport adalah `failed`, bukan `sent`.
- **Tidak ada SQL dari user.** Query laporan berasal dari kode terdaftar atau dataset yang sudah diaudit. Garis ini sama dengan Epic 9 dan Epic 11 #21.
- **Scope tidak berhenti di layar.** Laporan, ekspor, dan artifact tunduk pada Data Scope yang sama; scope yang dipakai ditampilkan.
- **Artefak punya masa simpan.** Tidak ada tabel artifact tanpa retensi — kekurangan `AD_Archive` yang eksplisit tidak ditiru.
- **Beban laporan tidak menahan beban transaksi.** Laporan besar berjalan sebagai job terjadwal ke artifact, bukan sebagai request sinkron di jam sibuk.

#### Basis iDempiere (terverifikasi terhadap source resmi)

| Konsep | Sumber terverifikasi | Diadopsi/dimodifikasi |
|---|---|---|
| Mesin laporan print native (`ReportEngine`, `AD_PrintFormat`, `LayoutEngine`, `ArchiveEngine`) | `15-reporting.md` §2.1, §3.1–§3.2 | **Reject** — mesin print-format tidak dibangun (keputusan #1, #8); laporan tetap kode + BI |
| Plugin JasperReports OSGi (`ReportStarter`) | `15-reporting.md` §4.1 | **Reject** — tidak ada mesin template laporan eksternal di Wave 1 |
| SQL bebas di dalam `.jrxml` (`JRQuery`), tidak auto tenant-scoped | `15-reporting.md` §7.4 (anti-pattern terdokumentasi) | **Reject** tegas — garis yang sama dengan keputusan #9 |
| `AD_ReportView` — metadata deklaratif (tabel + where + order + fungsi kolom), bukan SQL | `X_AD_ReportView.java`, `X_AD_ReportView_Col.java` | **Needs interview** — bentuk Abixell One sudah diputuskan sebagai kode + dataset terdaftar (#8, #9) |
| Format export `createPDF`/`createCSV`/`createXLS`/`createXLSX` | `ReportEngine.java:599–1000` | **Modernize** — CSV + XLSX Wave 1, PDF Wave 2 (#11) |
| `AD_Archive` menyimpan PDF (`BinaryData`), **tanpa kolom retensi** | `X_AD_Archive.java`, `ArchiveEngine.java:58–93` | **Adopt** konsep artifact; **Reject** ketiadaan retensi → `documents` + retensi 6 bulan (#12, #13) |
| Arsip sinkron, `// TODO to be done async` | `ArchiveEngine.java:87`, `:144` | **Modernize** — artifact laporan dibuat oleh job terjadwal, bukan di jalur request (Prinsip) |
| Laporan terjadwal → `sendEMailAttachments`, file dihapus setelah kirim | `Scheduler.java:238–252`, `:274`, `:350`, `:386` (IDEMPIERE-2864) | **Reject** lampiran; **Adopt** prinsipnya sebagai tautan ke artifact tersimpan (#14, #12) |
| Jadwal dua mode: frequency interval + cron4j pattern; `MonthDay`/`WeekDay` tidak diimplementasi | `MSchedule.java:112–131`, `:297–346`, `:348` | **Adopt** dua mode jadwal; hanya mode yang benar-benar dipakai yang didaftarkan |
| Parameter job terjadwal (`AD_Scheduler_Para`, `fillParameter`, `parseVariable` termasuk aritmetika tanggal) | `Scheduler.java:517–633`, `:682–791`, `MScheduler.java:220–235` | **Modernize** — parameter job tetap data, divalidasi terhadap schema (konsisten Epic 11 keputusan #2) |
| **Tidak ada** retry/backoff pada scheduler | `X_AD_Scheduler.java`, `X_AD_Schedule.java`, `X_AD_SchedulerLog.java` (nol kolom retry) | **Modernize** — retry terbatas untuk job idempoten (#17, #6) |
| **Tidak ada** distributed lock; satu-satunya kontrol `AD_Schedule.RunOnlyOnIP` | `16-scheduler.md` §8, `MSchedule.java:139–206` | **Reject** afinitas IP; **Adopt** lease DB yang sudah ada (#18) |
| Thread-per-job, bukan pool terpusat | `AdempiereServer.java:49`, `16-scheduler.md` §8 | **Adopt** model satu job satu unit mandiri |
| Identitas run: supervisor → createdBy → updatedBy → superuser | `AdempiereServer.java:211–222`, `Scheduler.java:499–511` | **Reject** rantai berubah-ubah; **Modernize** ke satu user sistem (#19) |
| `AD_Scheduler.KeepLogDays` default 7 + proses `HouseKeeping` manual per tabel | `MScheduler.java:95`, `:195–204`, `HouseKeeping.java:76–162` | **Adopt** konsep retensi log terjadwal; **Modernize** ke retensi per jenis log (#22) |
| SMTP per client (`AD_Client.SMTPHost`, `SMTPPort`, `IsSecureSMTP`) | `MClient.java:1160–1225`, `EMail.java:92–110` | **Reject** SMTP per tenant; **Adopt** SMTP sebagai transport default via adapter (#2) |
| Setiap kiriman tercatat dengan `IsDelivered` | `MClient.java:827–876`, `X_AD_UserMail.java` | **Adopt** prinsip jejak per kiriman; **Modernize** ke status retry-aware (#6, Prinsip) |
| Preferensi user `AD_User.NotificationType` (`E`/`N`/`B`/`X`) | `X_AD_User.java`, `MUser.java:765–781` | **Adopt** saklar global Wave 1 (#4) |
| `AD_Note` sebagai notifikasi in-app (bukan `AD_Message`, yang hanya kamus pesan) | `X_AD_Note.java`, `MNote.java:90–159` | **Adopt** konsep inbox terpadu; diperluas ke mobile (#4) |
| `AD_Alert` + `AD_AlertRule` + `AD_AlertProcessor` — `MAlertRule.getSql()` = satu-satunya SQL user, dipakai bersama `MRole.addAccessSQL` | `AlertProcessor.java:130–255`, `MAlertRule.java:70–99` | **Reject** — tidak ada alert SQL user (#15); kebutuhan ditutup hook Epic 11 |
| **Tidak ada** report/query builder ad-hoc untuk user akhir (hanya Report Wizard untuk print format) | `15-reporting.md` §3.3 | **Modernize** — `BiService` + dataset terdaftar (#9) |
| **Tidak ada** retensi pada `AD_Archive`, `AD_UserMail`, `AD_Note` | `X_AD_Archive.java`, `X_AD_UserMail.java`, `X_AD_Note.java` | **Reject** ketiadaan retensi (#12, #22) |

#### Model target

Tabel baru Epic 12 (nama final saat desain; struktur mengikat):

| Tabel | Fungsi | Kolom kunci |
|---|---|---|
| `notification_deliveries` | Antrean + retry pengiriman per kanal | `notification_id` FK, `channel`, `transport`, `recipient_ref` (email address / device token / telegram chat id), `status` (`pending`/`sending`/`retry`/`sent`/`terminal_failed`/`skipped`), `attempt_count`, `next_attempt_at`, `locked_at`, `claim_token`, `last_error`, `sent_at` |
| `notification_preferences` | Saklar per user per kanal | `user_id`, `channel`, `enabled` — Wave 1 satu baris per kanal; Wave 2 menambah `event_type` |
| `notification_recipient_rules` | Override penerima per event type & tenant | `tenant_id`, `event_type`, `recipient_kind` (`user`/`role`/`document_owner`/`supervisor`/`tenant_admin`/`explicit`), `recipient_ref`, prioritas |
| `notification_digests` | Penampung digest + jadwal kirim | `user_id`, `period_start`, `period_end`, `item_count`, `status`, `delivered_at` |
| `report_definitions` | Katalog laporan resmi (kode) | `tenant_id` (nullable = sistem), `code`, `name`, `module`, `permission_code`, `default_format` (`csv`/`xlsx`), `retention_days` (default 180), `is_active` |
| `report_schedules` | Jadwal laporan + penerima + format | `report_definition_id`, `scheduled_job_id` FK, `format`, `params` (jsonb, divalidasi schema), `delivery` (`link`/`attachment`, Wave 1 hanya `link`), `recipient_rule_id`, `is_active` |
| `document_artifacts` **atau** kolom tambahan di `documents` | Tautan artifact laporan ke definisi & jadwalnya | `document_id` FK, `report_definition_id`, `report_schedule_id`, `run_at`, `format`, `row_count`, `scope_digest` |

Tabel yang **dipakai ulang**: `notifications` + `notification_templates` (sudah ada sejak `1755900000000` — Epic 12 menambah `notification_deliveries` sebagai lapisan transport di bawahnya, tanpa membongkar tabel yang ada); `documents` + `LocalFileStorage` untuk byte artifact; `scheduled_jobs` + `scheduled_job_runs` + lease (`locked_at`/`lock_token`) untuk semua penjadwalan Epic 12; `audit_log` (Epic 1/10) untuk jejak akses artifact dan perubahan konfigurasi.

**Perubahan skema yang wajib:** CHECK constraint `channel` pada `notifications` dan `notification_templates` saat ini berisi `('email','push','whatsapp','sms','in_app')`. **`telegram` belum ada di daftar itu** — migrasi Epic 12 harus memperluas CHECK tersebut. `whatsapp`/`sms` tetap di daftar meski belum punya transport, supaya penambahan transport nanti tidak memerlukan migrasi constraint lagi.

#### Mekanisme — kanal & pengiriman

```
CHANNEL vs TRANSPORT (pemisahan yang mengikat):
  channel    = yang dipersepsikan user     : in_app | email | push | telegram
  transport  = cara mengirim               : in_app | smtp | web_push | mobile_push | telegram_bot

  push  →  web_push (service worker di frontend)
        →  mobile_push (FCM/APNs, saat aplikasi mobile ada)
  email →  smtp (Wave 1) | provider API (adapter, Wave 2+)
  in_app → inbox terpadu: web app sekarang, mobile app menyusul (#4)

ALUR PENGIRIMAN:
  1. Event dari EventBus (atau hook Epic 11) masuk NotificationService
  2. Resolusi penerima (keputusan #5):
       payload targetUserId/targetUserIds/targetRoleCode → menang bila terisi
       kalau kosong → notification_recipient_rules per (tenant, event_type)
  3. Baca preferensi user (notification_preferences) → kanal yang aktif
       tidak ada baris → default sistem (email + in_app)
  4. Klasifikasi prioritas dari event type (data, bukan hardcode):
       high  → enqueue langsung
       normal→ masuk notification_digests, dikirim per periode
  5. Untuk tiap (notifikasi × kanal): INSERT notification_deliveries status='pending'
  6. Worker mengirim:
       claim (SKIP LOCKED) → transport adapter → status sent | retry | terminal_failed
       retry: attempt_count++ + next_attempt_at = now() + backoff
       telemetry: setiap transisi status ditulis, tidak ada 'sent' yang diasumsikan
```

#### Mekanisme — penjadwalan & artifact

```
SCHEDULER (diperkuat, bukan diganti):
  start():
    load jobs (is_enabled) → buat timer per job          // seperti sekarang
    CATCH-UP (keputusan #16):
      for job where date_next_run < now():
        log jadwal terlewat (scheduled_job_runs trigger='catchup')
        runJob(job) — tetap lewat lease, tetap satu run per job
    // tidak ada backfill tak terbatas: satu catch-up per job, bukan N
  runJob():
    claim lease (locked_at + lock_token, 5 menit, heartbeat lease/3)   // tidak diubah (#18)
    identitas = user sistem 'scheduler' (#19)
    handler (idempoten — flag, #17):
      sukses  → finishRun('success')
      gagal   → finishRun('failed') + (idempoten ? retry terbatas : tunggu tick berikutnya)

ARTIFACT LAPORAN:
  report_schedule → scheduled_job / manual trigger
    → jalankan report_definition dengan params + Data Scope aktor
    → serialize (CSV | XLSX)
    → LocalFileStorage.save() → documents row (checksum, size, mime)
    → documents_artifacts row: report_definition_id, run_at, row_count, scope_digest
    → kirim notifikasi berisi TAUTAN unduhan (bukan lampiran, #14)
    → setiap unduhan dicatat di audit_log

RETENSI (keputusan #12, #13, #22):
  job terjadwal harian:
    artifact : hapus (soft delete documents) bila age > retention_days
               retention_days berasal dari report_definitions, default 180
    log      : notifikasi terkirim & hook execution & scheduler run → retensi operasional
               audit_log → retensi lebih panjang, partisi bulan (§4.10 risk table)
```

#### Gelombang pengerjaan

| Wave | Isi | Syarat selesai |
|---|---|---|
| 12.1 | Transport email: `MailTransport` adapter + SMTP global + `notification_deliveries` + status sebenarnya (bukan `sent` asumsi) | Test: email sungguhan terkirim; kegagalan tercatat `failed`, bukan `sent` |
| 12.2 | Transport `push`: Web Push via service worker + kanal `telegram` (bot) + perluasan CHECK constraint `channel` | Test: notifikasi sampai lewat service worker; bot Telegram menerima; constraint diperluas |
| 12.3 | Retry pengiriman + backoff + `terminal_failed` (pola outbox Epic 11) | Test: kiriman gagal maju retry lalu berhenti terminal; tidak ada retry tak berujung |
| 12.4 | Preferensi user (saklar global) + resolusi penerima hybrid (payload + `notification_recipient_rules`) + klasifikasi prioritas + digest | Test: preferensi `X` menghentikan kiriman; override tenant menjangkau admin saat payload kosong; prioritas tinggi tidak masuk digest |
| 12.5 | Scheduler: catch-up saat boot + flag idempoten + retry job idempoten + user sistem | Test: restart di tengah interval → job terlewat dikejar sekali; job non-idempoten tidak diretry |
| 12.6 | Artifact: `report_definitions` + `report_schedules` + ekspor XLSX + simpan ke `documents` + pengiriman tautan + pencatatan unduhan | Test: laporan terjadwal menghasilkan artifact tersimpan; email berisi tautan; unduhan tercatat; scope tercetak di laporan |
| 12.7 | Monitoring dokumen `posted='E'` (layar + notifikasi admin) + retensi per jenis log + partisi `audit_log` | Test: dokumen gagal posting muncul di layar dan memicu notifikasi; artifact > 180 hari dibersihkan; log audit bertahan lebih lama dari log operasional |

#### Cross-epic handoff

| Ke/Dari | Kontrak |
|---|---|
| **Dari Epic 5** | Definisi "laporan sudah ditutup" dan prosedur reissue saat hierarchy backdate mengubah grouping historis — ditutup sebagai konfigurasi retensi + penanda periode, bukan mekanisme baru di Epic 12 (lihat Open item #3) |
| **Dari Epic 6** | Expiry/review date assignment memicu notifikasi via `notification_recipient_rules`; cadence review ditetapkan Epic 8 |
| **Dari Epic 7** | Layar monitoring `posted='E'` + notifikasi kegagalan posting (#23); artifact laporan memakai `documents` yang sudah ada |
| **Dari Epic 8** | Parameter notifikasi (ambang, penerima default) dan tampilan riwayat konsumsi nomor; kebijakan gap nomor pada laporan audit |
| **Dari Epic 9** | Epic 9 menyediakan evaluator deadline yang idempoten; **Epic 12 yang menjadwalkan pemanggilannya** dan mengirim reminder/eskalasi. Kanal routing eskalasi ditetapkan di sini (open item #2 Epic 9 tertutup) |
| **Dari Epic 10** | Notifikasi lockout, reset admin, verifikasi email (#4); export audit log security events (open item #3 Epic 10) masuk sebagai laporan resmi |
| **Dari Epic 11** | Hook adalah sumber event; **Epic 12 hanya kanal pengiriman** (baris 3393). Retensi `hook_executions` (open item #2 Epic 11) ditetapkan sebagai retensi log operasional di sini |
| **Ke Epic 13** | Halaman laporan, layar monitoring, dan panel preferensi notifikasi memakai theme system & generator UI |
| **Ke Epic 14** | Laporan keuangan memakai `report_definitions` dengan `retention_days` lebih panjang; GL posting gagal muncul di monitoring yang sama |

#### Out-of-scope Epic 12

- Mesin print-format `AD_PrintFormat`/`AD_PrintFormatItem` dan plugin template laporan eksternal (Jasper-style) — ditolak, bukan ditunda (#1, #8).
- Report/query builder dengan SQL bebas untuk user atau role tertentu — ditolak permanen (#9, #15), garis Epic 11 #21.
- Subsystem alert dengan query user-defined (`AD_Alert`/`AD_AlertRule`) — ditolak (#15).
- Format PDF dan rendering headless — Wave 2 (#11).
- Lampiran file di email laporan — Wave 2, hanya sebagai opsi per jadwal (#14).
- Kanal `whatsapp` dan `sms` — enum ada, transport menunggu kontrak vendor.
- Preferensi notifikasi per event type — Wave 2 (#4).
- Migrasi ke job runner tahan-restart (pg-boss/BullMQ) — jalur upgrade terpisah, bukan cakupan gelombang (#16).
- Digest lintas tenant atau ringkasan eksekutif multi-tenant — tidak diminta.

#### Open items

| # | Item | Perlu diselesaikan di |
|---|---|---|
| 1 | Daftar event type prioritas tinggi (mana yang langsung, mana yang digest) | Wave 12.4 saat registri event type diisi |
| 2 | Angka retensi konkret per jenis log (operasional vs audit) | Wave 12.7; angka policy, bukan keputusan arsitektur |
| 3 | Definisi teknis "laporan sudah ditutup" saat hierarchy backdate mengubah grouping historis (carry-over Epic 5 open item #2) | **Ditutup Epic 14 (2026-09-25).** Periode fiskal berstatus `open`/`closed`; `closed` hanya dicapai setelah daftar periksa penutupan lulus. Backdate yang mengubah grouping historis tetap menghormati status periode. Lihat §4.14 keputusan #10. |
| 4 | Kepemilikan & kredensial bot Telegram (siapa yang membuat, bagaimana rotasi token) | Sebelum Wave 12.2 — butuh keputusan operasional |
| 5 | Provider API email (Resend/SES/SendGrid) dan kapan adapter diaktifkan | Wave 2 atau saat deliverability SMTP jadi masalah |
| 6 | Kriteria flag idempoten untuk job baru (checklist review) | Sebelum Wave 12.5 |
| 7 | Bentuk laporan "Dokumen Belum Terposting" — layar khusus atau masuk katalog laporan | Wave 12.7 |
| 8 | Cakupan mobile app notification: device registration, token lifecycle, dedup lintas device | Saat aplikasi mobile masuk roadmap |

#### Risk mitigation

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Baris notifikasi tercatat `sent` padahal tidak terkirim | Operator percaya user sudah diberi tahu; kejadian penting terlewat | `notification_deliveries` memisahkan niat dari hasil; status hanya `sent` setelah transport mengonfirmasi (keputusan #6, Wave 12.1) |
| Volume notifikasi membanjir user lalu semua diabaikan | Notifikasi penting tenggelam bersama yang tidak penting | Klasifikasi prioritas + digest (keputusan #7); user punya saklar untuk mematikan kanal (#4) |
| Eskalasi deadline terlewat saat deploy | Approval menggantung, SLA bocor | Catch-up saat boot (keputusan #16); evaluator Epic 9 sudah idempoten sehingga pengulangan aman |
| Retry ganda menghasilkan aksi bisnis dua kali | Dokumen/notifikasi duplikat | Retry hanya untuk job bertanda idempoten (keputusan #17); backoff terbatas berakhir `terminal_failed` (#6) |
| Laporan besar dijalankan di jam sibuk | Transaksi operasional melambat | Laporan besar berjalan sebagai job terjadwal ke artifact, bukan request sinkron (Prinsip); batas ukuran/parameter per definisi |
| Laporan membocorkan data di luar scope aktor | Kebocoran data lintas unit/tenant | Data Scope ditegakkan di service/repository (keputusan #21); `scope_digest` tersimpan di artifact; unit test lintas tenant |
| Artifact laporan diakses tanpa izin lewat tautan yang tersebar | Data keuangan/operasional keluar dari kendali | Tautan memakai permission `reporting.read` + `documents`, bukan URL publik (keputusan #14); setiap unduhan dicatat di `audit_log` |
| Artifact menumpuk tanpa batas | Disk penuh, backup membengkak | Default retensi 180 hari + override per definisi (keputusan #12, #13); job pembersihan terjadwal |
| Kredensial transport bocor di log | Kompromi kanal pengiriman | Redaction di dispatcher (garis Epic 11 #20); error transport disanitasi sebelum dicatat |
| `telegram` lupa ditambahkan ke CHECK constraint | Insert gagal saat runtime, ketahuan terlambat | Perluasan constraint menjadi langkah eksplisit Wave 12.2 (lihat Model target) |

#### Completion gate

Epic 12 dianggap selesai jika:
(1) email benar-benar terkirim lewat `MailTransport` + SMTP; status `sent` hanya setelah transport mengonfirmasi.
(2) Web Push via service worker dan kanal `telegram` berjalan; CHECK constraint `channel` sudah diperluas.
(3) `notification_deliveries` menjalankan retry + backoff dan berhenti di `terminal_failed`; tidak ada retry tak berujung.
(4) saklar preferensi user berfungsi; resolusi penerima hybrid terbukti menjangkau admin tenant saat payload kosong.
(5) prioritas tinggi dikirim langsung; sisanya masuk digest; tidak ada notifikasi keamanan yang tertunda digest.
(6) scheduler catch-up terbukti: restart di tengah interval → job terlewat dijalankan sekali; job non-idempoten tidak diretry.
(7) artifact laporan tersimpan di `documents` dengan checksum, dikirim sebagai tautan, dan unduhannya tercatat di `audit_log`.
(8) laporan mencetak scope yang dipakai; test lintas tenant membuktikan data di luar scope tidak bocor.
(9) retensi berjalan: artifact melewati `retention_days` dibersihkan; log audit bertahan lebih lama dari log operasional; `audit_log` terpartisi bulan.
(10) layar monitoring `posted='E'` menampilkan dokumen gagal posting dan memicunya notifikasi ke admin tenant.

**Bukan** syarat selesai Epic 12: PDF dan rendering headless, lampiran file di email laporan, kanal `whatsapp`/`sms`, preferensi per event type, migrasi ke pg-boss/BullMQ, aplikasi mobile, mesin print-format.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci kontrak kanal, penjadwalan, dan artifact laporan; tidak memberi persetujuan backend implementation sekarang.
- **Notification Engine tidak dibongkar.** `notifications` dan `notification_templates` tetap; Epic 12 menambah `notification_deliveries` sebagai lapisan transport di bawahnya. Baris `notifications` tetap catatan niat; baris `notification_deliveries` catatan hasil per kanal.
- Nama tabel bersifat proposal penamaan; struktur dan kolom kunci yang mengikat. Penamaan final mengikuti konvensi migration yang berlaku.
- `LocalFileStorage` tetap dipakai apa adanya untuk byte artifact. Karena `FILE_STORAGE_ROOT` berada di luar PostgreSQL (tercatat di `.env.example`: "must be included in every backup set"), **artifact laporan mewarisi persyaratan backup yang sama** — ini wajib ikut tercatat saat deployment.
- Kanal `telegram` diperlakukan sebagai channel tersendiri, bukan transport dari `push`, karena ia punya identitas penerima sendiri (chat id) dan bukan perangkat milik user.
- Basis iDempiere diverifikasi terhadap `15-reporting.md` §2–§7, `16-scheduler.md` §2–§10, plus raw source `ReportEngine.java`, `ArchiveEngine.java`, `Scheduler.java`, `MSchedule.java`, `MScheduler.java`, `AdempiereServer.java`, `MClient.java`, `EMail.java`, `MAlertRule.java`, `AlertProcessor.java`, `MUser.java`, `MNote.java` (release-11).
- Ringkas "tidak ada" yang ditemukan di iDempiere dan menjadi alasan keputusan: retry/backoff scheduler, distributed lock, kolom retensi pada `AD_Archive`/`AD_UserMail`/`AD_Note`, report builder ad-hoc user, pengarsipan async, dan `EMailUtil` sebagai kelas (tidak ada; logika tersebar di `EMail` + `MClient` + `MSMTP`).
- Open item Epic 9 #2 (kanal routing notifikasi eskalasi) dan open item Epic 10 #3 (export audit log) tertutup di sini: keduanya menjadi `notification_recipient_rules` dan `report_definitions`.

---

### 4.13 EPIC 13 — UI/UX Theme System & Generic Rendering

#### Problem statement

Epic 13 adalah epic yang paling lama ditunda dan paling banyak menerima titipan. Ia muncul di register sejak awal, tetapi selalu ditulis "Belum digali" sementara epic lain menyelesaikan kontraknya. Akibatnya lima epic sudah menyerahkan pekerjaan ke sini dan tidak satu pun punya tempat mendarat.

Epic 2 memberi pijakan kamus: "Epic 1 (akses), Epic 3 (menu), Epic 4 (konfigurasi role), Epic 7 (dokumen), dan Epic 13 (tema) punya pijakan yang sama" (baris 430). Epic 2 juga mengunci batas generator: "**Generator terbatas.** Kamus boleh menghasilkan form sederhana untuk halaman admin/konfigurasi. Halaman transaksi utama tetap ditulis manual di React" (baris 438). Epic 11 menahan UI authoring callout: "kontrak backend-nya dikunci sekarang supaya generator UI Epic 13 tidak perlu membongkar engine" (baris 3233), dengan handoff eksplisit di baris 3394 dan open item #4 di baris 3413. Epic 12 menyerahkan tiga layar: "Halaman laporan, layar monitoring, dan panel preferensi notifikasi memakai theme system & generator UI" (baris 3667). Design system Epic 13 dibangun native di atas komponen Abixell yang sudah ada; tidak ada kode atau paket pihak ketiga yang menjadi sumber implementasi.

Kondisi kode saat ini menjelaskan mengapa penundaan ini punya biaya.

**Tidak ada token layer.** `apps/web/src/index.css` tiga baris, hanya tiga directive Tailwind. `apps/web/tailwind.config.js` menetapkan `theme: { extend: {} }`. Nol custom property, nol `:root`, nol `dark:`. Bahasanya hardcoded: **`slate-` muncul 1445 kali di 73 berkas**, dengan `bg-slate-900` dipakai sepuluh kali di tujuh berkas sebagai satu-satunya "warna primer" yang ada.

**Branding tenant belum mungkin.** Spec 08 baris 70 sudah mengunci bahwa "nama aplikasi, logo, warna, footer, judul halaman, isi email — bersumber dari Branding Configuration milik Tenant". Dengan warna hardcoded di 73 berkas, klaim itu hari ini tidak bisa dipenuhi tanpa satu build per tenant. Dan `apps/web` adalah PWA dengan service worker (`public/sw.js`, `manifest.webmanifest` `display: standalone`) — percabangan build per tenant bertabrakan langsung dengan lapisan cache-nya.

**Celah aksesibilitas terverifikasi.** `Field` (`ui.tsx:193`) membungkus anaknya dalam `<label>` tanpa prop `error`, tanpa `id` yang dihasilkan, tanpa `aria-describedby`, tanpa `aria-invalid`. Galat form karena itu tidak terbaca pembaca layar. Di seluruh 93 berkas `apps/web/src`, `aria-describedby` muncul **tepat sekali** (`OverlayDialog.tsx:138`) dan `aria-invalid` **tepat sekali** (`FinanceTransactionsPage.tsx:212`) — keduanya tidak berpasangan dengan apa pun. `prefers-reduced-motion` nol kemunculan, sementara `animate-spin` dan `transition-*` tersebar tanpa penjaga. Baris kartu `DataTable` (`ui.tsx:281`) memasang `onRowClick` pada `<li>` tanpa `role`, `tabIndex`, atau penangan tombol. Total atribut `aria-`/`role=`: **77 di 21 berkas** — 72 dari 93 berkas nol.

**Dua bahasa warna sudah hidup berdampingan.** `ui.tsx:8-9` menyatakan komponen "reuses the existing Tailwind design language (slate palette, subtle borders, `text-sm` scale)". Tetapi 502 pemanggilan `Field` dan 110 pemanggilan `DataTable` di 52 berkas tersebar di halaman modul yang masing-masing mengulang literalnya sendiri. `forwardRef` nol di seluruh `src`; nol komponen punya prop `size`. Runtime dependency tetap **tiga** (react, react-dom, react-router-dom) — angka yang keputusan wawancara ini pertahankan, dan salah satu alasan paket pihak ketiga ditolak (keputusan #6).

Epic 13 menutup kelima titipan itu dengan satu urutan kerja: **token lebih dulu, karena semua pekerjaan berikutnya menumpang di atasnya.** Mengerjakan komponen atau generator sebelum token berarti menulis ulang keduanya saat bahasa warna berubah.

#### Keputusan terkunci (2026-09-25)

Wawancara Epic 13: 24 pertanyaan, ditambah dua pertanyaan penyelesaian konflik. Nomor di bawah sama dengan nomor pertanyaan di sesi wawancara.

1. **Cakupan: theme system + design system komponen + generator terbatas untuk halaman admin/konfigurasi.** Generator terbatas adalah yang §4.2 baris 438 izinkan, dan dua handoff — UI authoring callout Epic 11 dan tiga layar Epic 12 — tidak punya tempat lain kalau generator di-drop.

2. **Token layer hibrida: literal tetap, variabel CSS hanya untuk subset brand.** Nilai default tetap literal di `tailwind.config.js` (seperti sekarang), sehingga 1445 pemakaian `slate-` tidak perlu diubah lebih dulu dan autocomplete Tailwind utuh. Hanya token yang boleh di-override tenant — `primary`, `accent`, `surface`, dan keluarga senada — didefinisikan sebagai custom property dengan fallback literal. **Format nilai: kanal RGB** (`--color-primary: 15 23 42`), dipakai sebagai `rgb(var(--color-primary) / <alpha-value>)` sehingga modifier alpha Tailwind (`bg-primary/50`) berfungsi tanpa kerja tambahan dan konversi dari nilai slate yang ada bersifat mekanis.

   > **Catatan penyelesaian konflik.** Jawaban awal #2 = D ("tanpa variabel CSS, literal saja") bertabrakan langsung dengan #4 = A (branding tenant runtime) dan #3 = C (dark mode disiapkan). Literal build-time tidak dapat diubah tanpa rebuild. Konflik diselesaikan lewat pertanyaan lanjutan 2026-09-25: **#4 dan #3 menang**, tetapi cakupan variabel dipersempit ke subset brand saja, bukan seluruh palet. #2 versi awal ("HSL, ikut shadcn") juga ditolak lewat pertanyaan yang sama.

3. **Dark mode masuk sebagai kandidat Wave 2; token disiapkan sekarang agar tidak perlu dibongkar nanti.** Konsekuensi konkret: setiap warna yang masuk subset brand harus melewati variabel sejak Wave 1, sehingga penambahan tema gelap nanti hanya menulis satu blok `[data-theme="dark"]`. Membangun tema gelap sekarang berarti menerapkan tema kedua ke 1445 kemunculan `slate-` sebelum token layer terbukti.

4. **Branding warna per tenant disuntikkan sebagai variabel CSS saat runtime**, bisa berubah tanpa deploy. Palet di-bake saat build **ditolak** karena bertabrakan dengan sifat PWA aplikasi ini (service worker menyimpan aset; satu build per tenant membuat deployment bercabang). Branding yang dibatasi ke logo dan nama **ditolak** karena menabrak spec 08 baris 70. Konsekuensi: nilai branding per tenant disimpan sebagai data dan diterapkan ke custom property di klien.

5. **API komponen dinaikkan secara terukur**: `forwardRef` dan prop `size` pada `Button`, tanpa dekomposisi `Card`. Alasan: prop opsional tidak merusak 502 pemanggilan `Field` dan 110 pemanggilan `DataTable`, sedangkan dekomposisi `Card` mengubah setiap pemakaian `Card` yang ada dan nilainya baru terasa setelah theme layer selesai. `forwardRef` dibutuhkan secara teknis oleh pemicu popover, tooltip, dan fokus programatik.

6. **Design system dibangun native di dalam repo; tidak ada kode pihak ketiga yang disalin.** Empat kebutuhan yang riset nilai layak — `Button` dengan matriks varian/ukuran, `Card` yang dapat didekomposisi, `Modal` dengan skala ukuran, dan `Field` dengan perangkaian galat — diimplementasikan langsung di atas komponen Abixell yang sudah ada (`ui.tsx`, `OverlayDialog.tsx`). Mengadopsi paket pihak ketiga **ditolak** karena menyeret sistem token yang bersaing, 28 dependency, dan persoalan provenance ke aplikasi yang sengaja hanya memegang tiga dependency runtime. **Direvisi 2026-09-25:** keputusan awal ("paket dipangkas ke empat komponen") dibatalkan atas permintaan pemilik produk — tidak boleh ada jejak pihak ketiga di dalam repo. Nama paket, kode, dokumentasi, dan strukturnya tidak dipakai sama sekali. Yang bertahan dari riset hanyalah **analisis celah** (apa yang kurang di Abixell), bukan bahannya.

7. **Bahasa warna diganti ke nama semantik** (`bg-surface`, `bg-elevated`, `text-muted`, `border-subtle`), dengan `slate` hanya muncul di definisi token. Literal slate dipertahankan **ditolak** karena membuat branding per tenant tidak mungkin: `bg-slate-900` hardcoded di 73 berkas tidak bisa diubah tenant. Migrasi berjalan **bertahap per gelombang**, tidak sekali jadi. Migrasi semantik hanya di `ui.tsx` dan shell **ditolak** karena meninggalkan dua bahasa yang hidup berdampingan — masalah yang sudah terlihat di basis kode sendiri, tempat 502 pemanggilan `Field` dan 110 pemanggilan `DataTable` masing-masing mengulang literalnya.

8. **Baseline aksesibilitas internal sekarang, naik ke WCAG 2.1 level AA setelah token layer selesai.** Baseline internal berarti: kontras terukur, semua aksi tercapai keyboard, fokus selalu terlihat. **Keputusan operasional: WCAG 2.1 level AA menjadi target Wave 2, dan kepatuhan baru boleh diklaim setelah audit manual.** Alat otomatis hanya menangkap sekitar sepertiga persoalan, jadi mengklaim level tanpa audit manual tidak jujur. "Sesuai apa adanya" ditolak karena `Field` hari ini sudah gagal menghubungkan galat ke input.

9. **`Field` mendapat prop `error` dan `hint`, menghasilkan `id` otomatis dan merangkai `aria-describedby` serta `aria-invalid` ke anak inputnya.** Serahkan ke library form **ditolak** karena menambah dependency ke paket yang sengaja hanya tiga dan memaksa 502 pemanggilan `Field` ditulis ulang. Lebih baik: `Field` memakai `useId` untuk menghasilkan id, menyalinnya ke anak lewat `React.cloneElement`, sehingga pemanggil tidak perlu menyediakan id.

10. **`prefers-reduced-motion`: satu aturan CSS global di Wave 1, varian per-elemen di Wave 2.** Satu aturan global menutup seluruh permukaan dengan biaya terkecil, sementara `animate-spin` dan `transition-*` tersebar tanpa penjaga. Varian `motion-reduce` per-elemen menyusul bila ada animasi yang memang harus tetap berjalan.

11. **Baris kartu `DataTable` tidak lagi klikabel sebagai satu unit; disisipkan tombol aksi eksplisit di dalam kartu.** Seluruh baris menjadi satu tombol **ditolak** karena buruk untuk pembaca layar dan bertabrakan dengan tombol lain di dalam baris. Membiarkan karena hanya muncul di layar kecil **ditolak** karena salah asumsi: pengguna keyboard di desktop sempit, pengguna switch, dan pembaca layar di ponsel menghadapi mode kartu yang sama.

12. **Generator dimulai dari layar baca-saja (layar monitoring `posted='E'` Epic 12), lalu form admin/konfigurasi.** Layar baca-saja lebih aman sebagai bukti konsep: tidak ada mutasi, tidak ada aturan wajib bersyarat, dan kegagalannya tidak merusak data. Form admin menyusul setelah pola render terbukti dari sisi layout, label, dan Data Scope. Memperluas ke halaman transaksi sederhana **ditolak** karena menabrak §4.2.

13. **Bahasa aturan field terstruktur**, konsisten dengan `app_field_rules` Epic 2: field, operator, nilai, digabung dengan AND/OR eksplisit. DSL string ala iDempiere (`@PaymentRule@=P & @Processed@=Y`) **ditolak** karena §4.2 baris 319–325 mencatat DSL itu tidak type-safe dan sulit di-debug saat rantainya panjang. Ekspresi JavaScript **ditolak** — garis yang sama dengan Epic 11 keputusan #21. Tanpa aturan bersyarat di Wave 1 **ditolak** karena membuat generator tidak berguna untuk form nyata.

14. **Layout yang boleh diatur generator: urutan field dan grup field saja.** Tata letak kolom diserahkan ke CSS grid yang responsif. Model iDempiere (satu-baris, koordinat X/Y, rentang kolom) **ditolak** karena riset mengaitkannya dengan keluhan render lambat pada window berisi ratusan field (`08-application-dictionary.md:321-324`).

15. **Daftar route dipindahkan ke satu tabel data bersama**, sehingga `NAV_SECTIONS` (`capabilities.ts`) dan router (`App.tsx`) membaca sumber yang sama. Hari ini setiap path muncul dua kali — 60 lebih halaman didaftarkan tangan di `App.tsx` dan digerbangi lagi di `NAV_SECTIONS` — dan itu sudah berbahaya: path berubah di satu tempat, gerbang tertinggal di tempat lain. Mengambil seluruh route dari `app_menus` Epic 2 **ditolak** karena membuat ketersediaan route bergantung pada data runtime, menabrak prinsip bahwa enforcement bukan di UI.

16. **Aturan: setiap string yang terlihat klien wajib lewat kunci terjemahan; string literal dilarang di komponen. Cakupan Wave 1: hanya istilah yang terdaftar di konfigurasi terminologi Epic 2.** Menerapkan aturan penuh ke seluruh basis kode adalah pekerjaan besar; memulainya dari istilah terdaftar memberi hasil nyata sambil menetapkan arah yang berlaku untuk kode baru.

17. **Halaman login dan survei publik mendapat branding tenant, termasuk logo dan warna.** Tidak ada branding pra-login **ditolak** untuk halaman survei, karena token survei sudah mengidentifikasi tenant sehingga branding bisa ditentukan sebelum sesi ada. **Catatan teknis yang mengikat: untuk halaman login, tenant belum tentu diketahui sebelum pengguna memasukkan email, sehingga urutan pemuatan branding harus dirancang tersendiri** — lihat Open item #1.

18. **Library ikon: tanpa library di Wave 1, SVG inline sesuai kebutuhan; tambahkan satu library dengan pohon yang bisa di-*tree-shake* bila jumlah ikon melewati sekitar dua puluh.** Ikon gaya seragam dari satu library tipis adalah ciri keluaran yang terasa generik, dan paket ini sengaja hanya punya tiga dependency runtime. Font ikon **ditolak** karena masalah aksesibilitas dan pemuatan font.

19. **Primitif notifikasi klien: keduanya** — toast dengan wilayah `aria-live` yang benar untuk umpan balik aksi, dan pusat notifikasi permanen untuk riwayat. Toast saja **ditolak** karena pesannya hilang sebelum sempat dibaca dan tidak bisa ditinjau ulang. Pusat notifikasi saja **ditolak** karena setiap aksi lambat terasa tanpa balasan. Epic 12 keputusan #4 sudah mendefinisikan `in_app` sebagai inbox terpadu, jadi ini menyelesaikan bagian kliennya.

20. **Keadaan kosong, memuat, dan galat wajib untuk setiap halaman, dengan komponen bersama dan pemeriksaan di CI.** Jadwal penerapannya bertahap: halaman lama diperbaiki menyusul, halaman baru wajib sejak awal. Pola ini sudah ada dan bagus di sebagian tempat (`AdminSectionState`, `AdminSection.tsx:20`) tetapi tidak merata; menetapkannya sekarang mencegah halaman generator baru lahir tanpa keadaan galat.

21. **`OverlayDialog` diperluas ke `sm` dan `2xl` saja**, sesuai kebutuhan nyata (`md` dan `lg` sudah ada). Skala penuh `sm`–`2xl` plus `full` **ditolak** karena menambah varian yang belum ada pemakainya. Mengganti ke primitif dialog pihak ketiga **ditolak** karena membuang keunggulan yang sudah dimiliki komponen ini — focus trap dengan wrap-around, pemulihan fokus, kunci scroll, penjaga `pending`, `aria-modal`, target sentuh 44 piksel.

22. **Dukungan ponsel: halaman baca dan approval didukung penuh; halaman input berat diarahkan ke desktop.** Semua halaman berfungsi penuh di ponsel **ditolak** karena realistis untuk sebagian halaman dan mahal untuk semuanya. Batas ini ditetapkan eksplisit supaya halaman generator baru tahu targetnya. `DataTable` yang beralih ke kartu di bawah 640 piksel sudah menunjukkan arah ini.

23. **`DESIGN.md` ditulis oleh pemilik produk, dibantu penyusunan strukturnya.** Arahan desain **tidak** boleh berasal dari model, karena arah buatan model cenderung monoton — persis yang antislop saring. Selama `DESIGN.md` belum ada, seluruh pekerjaan UI Epic 13 berstatus **"draft without direction"** dengan dial ENERGY/RHYTHM/MOTION = 1, dan bukan deliverable produksi.

24. **Urutan gelombang: token layer → komponen → aksesibilitas → generator baca-saja → form admin → branding tenant → dark mode.** Token layer lebih dulu karena setiap pekerjaan berikutnya menumpang di atasnya.

#### Prinsip yang mengikat

- **Token dulu, komponen kemudian.** Komponen yang ditulis sebelum token akan ditulis ulang saat bahasa warna berubah.
- **Enforcement bukan di UI.** Route, menu, tombol yang disembunyikan, dan Data Scope di klien hanyalah kenyamanan; backend menegakkan ulang. Generator tidak pernah menjadi batas keamanan.
- **Branding dari konfigurasi, bukan hardcode.** Warna, logo, nama aplikasi, dan judul halaman bersumber dari konfigurasi tenant (spec 08 baris 70). Design System hanya mendefinisikan struktur dan perilaku komponen.
- **Metadata sebagai kontrak, bukan mesin UI penuh.** Generator terbatas untuk halaman admin/konfigurasi; halaman transaksi tetap React manual (spec 05 baris 47–49, §4.2 baris 438, 462).
- **Aturan bersyarat terstruktur, tanpa script bebas.** Garis yang sama dengan Epic 9 dan Epic 11 keputusan #21.
- **Aksesibilitas adalah properti komponen, bukan tambahan per halaman.** Kalau `Field` benar, 502 pemanggilnya tidak perlu memperbaiki apa pun.
- **Tanpa `DESIGN.md`, keluaran berstatus draf.** Bukan deliverable.

#### Basis iDempiere (terverifikasi terhadap riset lokal)

| Konsep | Sumber terverifikasi | Diadopsi/dimodifikasi |
|---|---|---|
| Tema aktif dipilih lewat `ZK_THEME` System Configurator — operasi data runtime, bukan build-time | `14-ui.md:274–280` | **Adopt** prinsipnya: branding tenant via runtime config (keputusan #2, #4) |
| Bundel tema terpisah (`org.idempiere.zk.breeze.theme`, `iceblue_c`) untuk white-label tanpa mengubah core | `04-source-code.md:162–166`, `03-architecture.md:119–124` | **Adopt** konsepnya sebagai satu paket tema milik Abixell; **Reject** penambahan bundel per klien (keputusan #2 hibrida) |
| Variabel LESS `_zkvariables.less` sebagai layer variabel tema | `14-ui.md:268–272` | **Adopt** sebagai bentuk: variabel CSS, subset brand (keputusan #2) |
| Injeksi URI aset tema tambahan ke header saat tema aktif | `14-ui.md:280` | **Needs interview** — bentuk Abixell One sudah diputuskan sebagai custom property, bukan injeksi berkas CSS |
| Tema berbeda per Client/Tenant | `14-ui.md:282–285` — riset menyatakan "**kemungkinan**", "perlu verifikasi lebih lanjut" | **Needs interview** — arah disetujui (keputusan #4); mekanisme resolusi tema per sesi tidak terverifikasi di riset maupun source |
| `ITheme` / `ThemeManager` | **tidak ada di riset** | — (tidak dapat dinilai) |
| `AD_Theme` sebagai tabel preferensi tema | **tidak ada di riset** | — (dibuat sendiri: konfigurasi branding per tenant, keputusan #4) |
| Dark mode / tema gelap | **tidak ada di riset** — nol kemunculan, tidak ada versi | — (keputusan #3: disiapkan, bukan dibangun) |
| Palet per klien | **tidak ada di riset** | — (dibuat sendiri: subset token via variabel, keputusan #2) |
| Logo dan halaman login per klien | **tidak ada di riset** | — (keputusan #17) |
| Rantai `AD_Window` → `MWindow` → `GridWindow` → `GridTab` → `GridField` → `WEditor` | `08-application-dictionary.md:99–122`, `14-ui.md:128–139` | **Adopt** konsep: metadata sebagai kontrak yang dibaca klien (keputusan #12) |
| Rendering 100% data-driven dari baris `AD_Field` | `14-ui.md:141–158` ("Seluruh struktur — jumlah kolom, posisi, tipe editor, visibility, mandatory, readonly — 100% data-driven") | **Reject sebagai mesin penuh** — generator terbatas saja (§4.2 baris 438, 462); **Adopt** untuk layar baca-saja |
| Peta `AD_Reference` → editor (`WStringEditor`, `WNumberEditor`, `WDateEditor`, `WYesNoEditor`, `WListItemEditor`) | `08-application-dictionary.md:124–139` | **Modernize** — pemetaan tipe ke komponen React, dengan jumlah tipe yang dibatasi |
| Dua presentasi dari satu `GridField[]`: form dan grid/list (`switchRowPresentation()`) | `14-ui.md:231–233` | **Adopt** — satu deskriptor, dua tata letak |
| `DisplayLogic`/`MandatoryLogic`/`ReadOnlyLogic` sebagai DSL string (`@DocStatus@=DR`, `Evaluator.evaluateLogic()`) | `08-application-dictionary.md:189–204` | **Reject** DSL string (keputusan #13); **Adopt** semantiknya sebagai `app_field_rules` Epic 2 |
| Evaluasi ulang logic saat context berubah (`ADTabpanel.dynamicDisplay(int col)`) | `14-ui.md:160–185` | **Adopt** perilakunya: aturan dievaluasi ulang saat nilai berubah |
| Mandatory ditegakkan ulang di persistensi (`PO` melempar `FillMandatoryException`) | `08-application-dictionary.md:179–182` | **Adopt** prinsip: aturan klien bukan penegakan, backend menegakkan ulang |
| Layout authorable: `SeqNo`, `IsSameLine`, `XPosition`/`YPosition`, `ColumnSpan`, `AD_FieldGroup` | `08-application-dictionary.md:80–83`, `14-ui.md:139–152` | **Modernize** — urutan dan grup saja (keputusan #14) |
| Jumlah kolom grid default 4 dari `gridTab.getNumColumns()` | `14-ui.md:146–152` | **Reject** — tata letak kolom diserahkan CSS grid responsif (keputusan #14) |
| `AD_Form` — layar non-generic dengan `Classname` ke kelas ZK; menolak digenerate dari kamus | `08-application-dictionary.md:85–89`, `06-plugin-system.md:471–488` | **Adopt** pembatasannya: tidak semua layar layak digenerate; halaman transaksi tetap manual (keputusan #1) |
| Biaya form custom — kehilangan "gratisan" AD-driven (security per-field, translation, personalization) | `06-plugin-system.md:486–488` | **Adopt** sebagai peringatan: apa yang hilang saat layar ditulis manual |
| Kustomisasi halaman login ZUL non-generic (`admin.zul`, `error.zul`, `index.zul`) | `04-source-code.md:154–160` | **Needs interview** — mekanisme branding pra-login tidak dijelaskan riset (keputusan #17, Open item #1) |
| `AD_Process_Para` untuk parameter proses | `13-database.md:153` ("parameter di-render otomatis dari `AD_Process_Para`") | **Needs interview** — pemetaan tipe parameter ke widget tidak didokumentasikan riset |
| `AD_InfoWindow` / Smart Browse | **tidak ada skema maupun pipeline render di riset** | — (tidak dapat dinilai) |
| Aksesibilitas WebUI ZK (WCAG/ARIA/keyboard/pembaca layar) | **tidak ada di riset** — satu-satunya kemunculan aksesibilitas adalah ekspor HTML Jasper (`15-reporting.md:289`) | — (keputusan #8, #9, #10, #11 dibuat dari celah kode sendiri, bukan dari iDempiere) |
| Responsif/mobile ZK | `01-overview.md:56` ("Responsive ZK-based UI"), `14-ui.md:245` (`setWidgetOverride` untuk swipe-down) | **Modernize** — `DataTable` beralih kartu di bawah 640 piksel + batas ponsel eksplisit (keputusan #22) |
| Biaya arsitektur WebUI: pohon komponen digenggam di memori server, butuh sticky session; isu pembersihan `IDEMPIERE-5049` | `14-ui.md:388–396` | **Reject** model arsitekturnya — aplikasi ini klien-render, tidak ada pohon komponen di server |
| Rendering AD terikat keras ke API komponen ZK; Swing dan ZK butuh dua implementasi; Swing jadi jalan buntu | `14-ui.md:390–396` | **Adopt** pelajarannya: satu klien React, tidak ada dua renderer paralel |
| Keluhan: window ratusan field lambat saat cache dingin | `08-application-dictionary.md:321–324` | **Adopt** sebagai alasan membatasi tata letak (keputusan #14) |
| Keluhan AD: DSL tidak type-safe, reflektif, rantai callout sulit di-debug, UI terikat skema fisik | `08-application-dictionary.md:319–325` | **Adopt** sebagai alasan menolak DSL string (keputusan #13) |
| Kurva belajar AD curam dan kurang terdokumentasi | `20-limitations.md:38–45` | **Adopt** sebagai peringatan: kontrak `app_field_rules` harus lebih sederhana dari iDempiere |

#### Model target

**Epic 13 tidak membangun tabel baru sebagai sumber kebenaran.** Ia membaca kamus Epic 2 dan menambah satu perluasan.

**Dibaca (Epic 2, sudah dikontrak):** `app_windows`, `app_tabs`, `app_fields`, `app_processes`, `app_field_rules`, `app_menus`, `app_menu_tree`, konfigurasi terminologi (Gelombang 2 §4.2), `modules`.

**Tabel baru** (nama final saat desain):

| Tabel | Fungsi | Kolom kunci |
|---|---|---|
| `package_theme_configs` | Branding per tenant: subset token yang boleh di-override + logo | `tenant_id`, `tokens` (jsonb — kunci token ke nilai kanal RGB), `logo_document_id` (FK `documents`), `app_name`, `updated_by`, `updated_at` |

**Perluasan yang dibutuhkan:** konfigurasi terminologi Epic 2 (Gelombang 2) menampung pemetaan kunci istilah ke teks per tenant (keputusan #16).

**Berkas, bukan tabel:** `apps/web/src/lib/design-tokens.ts` sebagai sumber token bersama; `apps/web/src/theme/` untuk penyuntik variabel, pembaca preferensi, dan (Wave 2) tema gelap; `DESIGN.md` di akar repo.

**Perubahan non-skema yang mengikat:**

- `apps/web/src/index.css` mendapat blok `:root` berisi custom property subset brand dengan nilai default literal — **satu-satunya tempat nilai warna brand ditulis**.
- `apps/web/tailwind.config.js` memetakan warna brand ke `rgb(var(--color-…) / <alpha-value>)`; warna lain tetap literal.
- Daftar route bersama menggantikan duplikasi antara `App.tsx` dan `NAV_SECTIONS` (keputusan #15).
- `ui.tsx`: `Field` mendapat `error`/`hint` + `aria-describedby`/`aria-invalid` via `useId`; `Button` mendapat `forwardRef` + `size`; `DataTable` mode kartu mendapat tombol aksi eksplisit; satu aturan global `prefers-reduced-motion`; `OverlayDialog` mendapat `sm` dan `2xl`.

#### Mekanisme — token layer

```
:root {
  /* subset brand — satu-satunya tempat nilai brand ditulis */
  --color-primary: 15 23 42;        /* = slate-900, nilai hari ini */
  --color-primary-fg: 248 250 252;
  --color-accent: …;
  --color-surface: 255 255 255;
  --color-elevated: …;
  --color-subtle: …;
  /* slate lainnya tetap literal di tailwind.config.js */
}

tailwind.config.js
  colors: {
    primary:  "rgb(var(--color-primary) / <alpha-value>)",
    surface:  "rgb(var(--color-surface) / <alpha-value>)",
    slate:    { 50: "#f8fafc", …, 900: "#0f172a" },   // literal, tidak berubah
  }

// dipakai sebagai:
bg-primary      → rgb(15 23 42)
bg-primary/50   → rgb(15 23 42 / 0.5)
text-muted      → nama semantik (keputusan #7), nilainya tetap lewat variabel

BRANDING TENANT (runtime, tanpa rebuild):
  GET /tenant/theme  →  { tokens: { primary: "…", accent: "…" }, logoUrl, appName }
  klien menulis ke document.documentElement.style.setProperty('--color-primary', …)
  // hanya subset brand yang boleh di-override; sisanya tetap default

TEMA GELAP (Wave 2, disiapkan sekarang):
  [data-theme="dark"] { --color-primary: …; --color-surface: …; }
  // tidak ada pekerjaan Wave 1 selain memastikan setiap warna brand lewat variabel
```

#### Mekanisme — generator terbatas

```
BATAS (keputusan #1, #12; §4.2 baris 438):
  layar baca-saja  (daftar, monitoring, laporan)      → digenerate, Wave 13.4
  form admin/konfigurasi                              → digenerate, Wave 13.5
  halaman transaksi utama                             → React manual, selamanya

DESKRIPTOR (dibaca dari kamus Epic 2, bukan format baru):
  app_windows   → route + judul + module
  app_tabs      → bagian dalam halaman (fields | cards)
  app_fields    → label, wajib, bisa-edit, tampil, urutan, tipe
  app_field_rules → aturan bersyarat TERSTRUKTUR (keputusan #13):
        { field, operator, value, join: "AND" | "OR" }
        // tidak ada DSL string; tidak ada ekspresi JavaScript

PIPELINE RENDER:
  1. baca deskriptor (satu endpoint kamus)
  2. saring field lewat Data Scope di server          // bukan di klien
  3. petakan tipe → komponen React (tabel pemetaan tertutup)
  4. evaluasi app_field_rules saat nilai berubah      // perilaku iDempiere yang diadopsi
  5. render tata letak: urutan + grup (keputusan #14); kolom lewat CSS grid responsif
  6. wajib/read-only divalidasi ULANG di backend saat simpan   // klien bukan penegak

YANG TIDAK BOLEH DILAKUKAN GENERATOR:
  tidak menyediakan jalur menuju halaman transaksi
  tidak menjadi batas keamanan (route tetap digerbangi backend)
  tidak mengeksekusi ekspresi, script, atau SQL dari deskriptor
```

#### Gelombang pengerjaan

| Wave | Isi | Syarat selesai |
|---|---|---|
| 13.1 | Token layer: `:root` subset brand, pemetaan Tailwind `rgb(var(--…) / <alpha-value>)`, `design-tokens.ts`, `DESIGN.md` (dari pemilik produk) | Token terdefinisi; `bg-primary/50` bekerja; nol nilai brand ditulis di luar blok `:root`; `DESIGN.md` ada — kalau belum, Wave 13.2–13.7 tetap berstatus draf |
| 13.2 | Komponen: `Button` `forwardRef` + `size`; `Field` `error`/`hint` + ARIA via `useId`; `OverlayDialog` `sm`/`2xl`; `DataTable` tombol aksi eksplisit di kartu | 502 pemanggilan `Field` tetap kompilasi tanpa perubahan pemanggil; uji keyboard pada kartu; kontras terukur |
| 13.3 | Aksesibilitas: aturan global `prefers-reduced-motion`; pemeriksaan keadaan kosong/memuat/galat di CI; migrasi bahasa warna semantik pada `ui.tsx` + shell | Nol `slate-` di `ui.tsx` dan shell; CI gagal bila halaman tanpa keadaan galat; animasi mati saat preferensi aktif |
| 13.4 | Generator baca-saja: pipeline render dari kamus untuk layar daftar/monitoring; layar `posted='E'` Epic 12 sebagai kasus pertama | Layar monitoring dirender dari deskriptor; Data Scope tersaring di server; nol mutasi |
| 13.5 | Generator form admin: `app_field_rules` terstruktur, pemetaan tipe, validasi ulang di backend | Form admin dirender dari kamus; aturan bersyarat teruji; backend menolak field yang tidak lolos aturan klien |
| 13.6 | Branding tenant: `package_theme_configs`, endpoint tema, penyuntik variabel, branding di login dan survei publik, terminologi terdaftar | Warna tenant berubah tanpa rebuild; survei publik mendapat branding dari token; istilah terdaftar diganti |
| 13.7 | Dark mode (Wave 2): blok `[data-theme="dark"]`, saklar user, hormati `prefers-color-scheme`; naik ke WCAG 2.1 AA setelah audit manual | Tema gelap jalan tanpa menyentuh komponen; klaim WCAG hanya setelah audit manual |

#### Cross-epic handoff

| Ke/Dari | Kontrak |
|---|---|
| **Dari Epic 1** | `ActorContext`, `capabilities.ts`, gerbang route — klien tetap presentasi saja (§4.1 baris 397 "Theme (Epic 13)" ditutup) |
| **Dari Epic 2** | Kamus sebagai pijakan: `app_windows`/`app_tabs`/`app_fields`/`app_field_rules`/`app_menus` + terminologi; **Epic 13 tidak membuat format deskriptor baru** |
| **Dari Epic 3** | Struktur `app_menus`/`app_menu_tree` menjadi sumber tabel route bersama (keputusan #15); menu tetap digerbangi server |
| **Dari Epic 11** | **Menutup open item #4 Epic 11 (baris 3413):** UI authoring callout masuk generator setelah pola render terbukti (Wave 13.5+). Kontrak backend Callout tidak dibongkar (baris 3233) |
| **Dari Epic 12** | **Menutup handoff baris 3667:** halaman laporan, layar monitoring, panel preferensi notifikasi memakai theme system + generator. Layar `posted='E'` menjadi kasus pertama generator (keputusan #12); primitif toast + pusat notifikasi (keputusan #19) |
| **Dari riset tema** | Empat kebutuhan komponen (`Button` ukuran, `Card` terdekomposisi, `Modal` skala, `Field` galat) diimplementasikan native di repo (keputusan #6, direvisi 2026-09-25). Tidak ada paket pihak ketiga yang masuk |
| **Ke Epic 14** | Laporan keuangan memakai generator baca-saja + token yang sama |

#### Out-of-scope Epic 13

- Generator UI penuh untuk semua halaman, termasuk transaksi — ditolak (§1, §4.2 baris 559).
- DSL string aturan bersyarat ala iDempiere — ditolak (keputusan #13).
- Ekspresi JavaScript atau script bebas di deskriptor — ditolak (garis Epic 11 #21).
- Tata letak berkoordinat (X/Y, rentang kolom, jumlah kolom grid) — ditolak (keputusan #14).
- Palet penuh per tenant (semua 1445 warna dapat dikonfigurasi) — di luar cakupan; subset brand saja (keputusan #2).
- Dark mode sebagai pekerjaan Wave 1 — disiapkan, dibangun di Wave 13.7 (keputusan #3).
- Library ikon di Wave 1 — ditunda sampai jumlah ikon melewati sekitar dua puluh (keputusan #18).
- Font ikon — ditolak (keputusan #18).
- Mengganti `OverlayDialog` ke primitif dialog pihak ketiga — ditolak (keputusan #21).
- Library form (react-hook-form atau serupa) — ditolak (keputusan #9).
- `DESIGN.md` yang ditulis model — ditolak sebagai sumber arah (keputusan #23).
- Halaman transaksi berfungsi penuh di ponsel — di luar batas Wave 1 (keputusan #22).
- Dua renderer paralel (mis. Swing + ZK) — ditolak; satu klien React (pelajaran `14-ui.md:390–396`).

#### Open items

| # | Item | Perlu diselesaikan di |
|---|---|---|
| 1 | Urutan pemuatan branding pada halaman login saat tenant belum diketahui sebelum email dimasukkan (keputusan #17) | Wave 13.6; butuh keputusan desain alur |
| 2 | Daftar final token subset brand (mana saja yang boleh di-override tenant) | Wave 13.1 saat `design-tokens.ts` ditulis |
| 3 | Isi `DESIGN.md` — identitas, kepribadian, palet, tipografi, mood | Pemilik produk; **prasyarat Wave 13.2–13.7 sebagai deliverable produksi** |
| 4 | Tabel pemetaan tipe field kamus → komponen React (daftar tertutup) | Wave 13.4–13.5 |
| 5 | Halaman admin/konfigurasi pertama yang memakai generator form (open item #3 Epic 2, baris 569) | Wave 13.5 — dijawab di sini, bukan di Epic 4 |
| 6 | Ambang pasti jumlah ikon yang memicu penambahan library | Wave 13.3 (keputusan #18; patokan awal dua puluh) |
| 7 | Audit manual screen reader (prasyarat klaim WCAG 2.1 AA) | Wave 13.7 |
| 8 | Bentuk penyimpanan nilai branding tenant: `tokens` jsonb vs kolom per token | Desain `package_theme_configs`, Wave 13.6 |
| 9 | Apakah editor branding tenant perlu pratinjau langsung | Wave 13.6; tergantung keputusan UI |
| 10 | Voice over/nama aksesibel untuk tombol aksi per baris di halaman modul | Wave 13.3 (72 dari 93 berkas nol atribut ARIA) |
| 11 | Penyajian menu server ke klien: ikut `/me` atau endpoint tersendiri (§6 Open Decision #11, baris 3772) | Wave 13.4 saat tabel route bersama dibangun — "diputuskan lewat pengukuran" |
| 12 | Kelengkapan konsistensi tema gelap nanti (Wave 13.7) | Wave 13.7 |

#### Risk mitigation

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Migrasi 1445 pemakaian `slate-` ke semantik dilakukan sekaligus | Perubahan besar tak tertinjau, regresi visual tersebar | Migrasi bertahap per gelombang (keputusan #7); Wave 13.3 membatasi diri ke `ui.tsx` + shell (176 kemunculan) |
| Kode pihak ketiga masuk repo membawa sistem token yang bersaing dan 28 dependency | Tabrakan simbol senyap, UI dua palet, keunggulan tiga dependency hilang | Tidak ada paket pihak ketiga diambil (keputusan #6, direvisi 2026-09-25); yang diadopsi hanya analisis celah, implementasinya native di repo |
| Token layer dibangun sebelum `DESIGN.md` ada | Seluruh keluaran berstatus draf; token diarahkan ke bahasa yang mungkin belum final | Wave 13.1 menghasilkan `DESIGN.md` lebih dulu; kalau belum ada, Wave 13.2–13.7 berstatus draf dan arah token harus ditinjau ulang (keputusan #23) |
| Branding tenant merusak kontras | Warna tenant membuat teks tidak terbaca | Kontras terukur diuji saat Wave 13.6; validator token menolak kombinasi yang gagal ambang |
| Generator dipakai untuk halaman transaksi karena "kelihatan mudah" | Menabrak §4.2 dan menciptakan dua pola halaman | Batas ditulis di Prinsip dan Out-of-scope; jalur ke halaman transaksi tidak disediakan generator (keputusan #12) |
| Aturan field dipakai sebagai penegakan | Data tidak valid lolos karena klien dilewati | Validasi diulang di backend saat simpan (adopsi `FillMandatoryException`, `08-application-dictionary.md:179–182`) |
| Generator dengan ratusan field lambat dirender | Halaman admin berat | Tata letak dibatasi urutan + grup (keputusan #14); pelajaran `08-application-dictionary.md:321–324` |
| Perbaikan aksesibilitas hanya di `ui.tsx` | 72 berkas lain tetap tanpa ARIA | Wave 13.3 mengukur cakupan; Open item #10 mencatat tombol baris halaman modul |
| `prefers-reduced-motion` diterapkan per-elemen lebih dulu | Permukaan tidak tertutup selama pengerjaan | Aturan global lebih dulu (keputusan #10); varian per-elemen menyusul |
| Klaim WCAG 2.1 AA tanpa audit manual | Klaim tidak jujur; sekitar dua pertiga persoalan terlewat | Kepatuhan hanya diklaim setelah audit manual (keputusan #8, Open item #7) |
| Duplikasi route kembali muncul setelah tabel bersama dibuat | Path berubah di satu tempat, gerbang tertinggal | Satu tabel bersama (keputusan #15); `NAV_SECTIONS` dan router membaca sumber yang sama |
| Produk keluar dari paket tiga dependency | Keunggulan tiga dependency runtime hilang tanpa keputusan sadar | Setiap dependency baru butuh keputusan wawancara tersendiri; library ikon ditunda (keputusan #18), library form ditolak (keputusan #9), paket pihak ketiga ditolak (keputusan #6) |

#### Completion gate

Epic 13 dianggap selesai jika:
(1) blok `:root` menjadi satu-satunya tempat nilai warna brand ditulis; nol literal brand di luar blok itu.
(2) `bg-primary/50` dan modifier alpha Tailwind lain bekerja lewat `rgb(var(--…) / <alpha-value>)`.
(3) `Field` merangkai `aria-describedby` dan `aria-invalid` ke anak inputnya lewat `useId`; 502 pemanggilan `Field` tetap kompilasi tanpa perubahan pemanggil.
(4) baris kartu `DataTable` dapat diaktifkan keyboard lewat tombol aksi eksplisit; fokus terlihat.
(5) aturan global `prefers-reduced-motion` mematikan animasi saat preferensi aktif.
(6) `ui.tsx` dan shell nol kemunculan `slate-`; bahasa warna semantik berlaku di sana.
(7) tabel route bersama menjadi satu sumber untuk router dan `NAV_SECTIONS`; nol path terdaftar dua kali.
(8) layar baca-saja dirender dari kamus Epic 2; Data Scope tersaring di server; nol mutasi dari jalur generator.
(9) form admin dirender dari kamus; aturan `app_field_rules` terstruktur teruji; backend menolak field yang tidak lolos aturan klien.
(10) warna tenant berubah tanpa rebuild; survei publik dan halaman login mendapat branding; istilah terdaftar diganti.
(11) primitif toast (`aria-live`) dan pusat notifikasi permanen tersedia.
(12) setiap halaman baru punya keadaan kosong, memuat, dan galat; CI menegakkannya.
(13) **`DESIGN.md` ada dan ditulis pemilik produk.** Sebelum itu, Epic 13 dianggap belum menjadi deliverable produksi (keputusan #23).

**Bukan** syarat selesai Epic 13: dark mode (Wave 13.7), klaim WCAG 2.1 AA sebelum audit manual, library ikon, library form, generator untuk halaman transaksi, palet penuh per tenant.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci kontrak theme, design system, dan generator terbatas; tidak memberi persetujuan backend implementation sekarang.
- **Epic ini tidak menambah tabel sumber kebenaran baru.** Ia membaca kamus Epic 2. Satu-satunya tabel baru adalah `package_theme_configs` untuk branding tenant.
- **Konflik #2 vs #4/#3 diselesaikan 2026-09-25** lewat pertanyaan lanjutan; hasilnya tercatat di keputusan #2. Versi awal #2 (tanpa variabel CSS, dan varian "HSL ala shadcn") tidak berlaku.
- **Keputusan #8 naik ke WCAG 2.1 level AA adalah Wave 2 dan bersyarat audit manual.** Jangan mengklaim kepatuhan WCAG atas dasar alat otomatis.
- **Nama tabel dan berkas bersifat proposal penamaan**; struktur dan tanggung jawab yang mengikat. Penamaan final mengikuti konvensi yang berlaku.
- **Berkas `DESIGN.md` belum ada di repo.** Selama belum ada, seluruh pekerjaan Wave 13.2–13.7 berstatus "draft without direction" dengan dial ENERGY/RHYTHM/MOTION = 1, dan bukan deliverable produksi (antislop, baris 365 dan 3998).
- **iDempiere bukan sumber untuk keputusan aksesibilitas Epic 13.** Riset tidak membahas aksesibilitas WebUI sama sekali; keputusan #8–#11 berasal dari celah kode sendiri (77 atribut ARIA di 21 dari 93 berkas, `aria-describedby` sekali, `prefers-reduced-motion` nol).
- **iDempiere juga bukan sumber untuk dark mode, palet per klien, logo, atau halaman login per klien** — keempatnya tidak ada di riset. Semua itu keputusan baru, bukan adopsi.
- **Tidak ada paket pihak ketiga di Epic 13** (keputusan #6, direvisi 2026-09-25). Empat kebutuhan komponen diimplementasikan native di atas `ui.tsx` dan `OverlayDialog.tsx` yang sudah ada, dengan token Abixell sendiri dan tetap tiga dependency runtime.
- Basis iDempiere diverifikasi terhadap `14-ui.md` §1–§7, `08-application-dictionary.md` §2–§6, `06-plugin-system.md` §9–§11, `18-development-guide.md`, `20-limitations.md`, `13-database.md:153`, `04-source-code.md:154–166`, `01-overview.md:56`.
- **Handoff Epic 13 dari Epic 3 tidak eksplisit di §4.3** — riset verifikasi tidak menemukan referensi Epic 13 di §4.3 maupun §4.4. Kontrak di sini dijabarkan dari `app_menus`/`app_menu_tree` dan `NAV_SECTIONS` yang ada.

---

### 4.14 EPIC 14 — Finance & Accounting Posting

#### Problem statement

Epic 14 dibuat 2026-09-24 sebagai handoff dari Epic 7, dan sampai wawancara 2026-09-25 ia satu-satunya epic di register yang masih berstatus "Belum digali". Ia menerima empat titipan dan tidak satu pun punya tempat mendarat selama epic ini ditunda.

Epic 7 menyerahkan kontrak posting tetapi menahan isinya: kolom `posted` (`N`/`Y`/`E`), `reversal_id` yang sengaja dibiarkan kosong, status `RE`/`WP`/`WC` yang ditunda, aksi `PO`/`RC`/`RA` yang ditunda, dan dua open item eksplisit. Baris 2242 menulis pemetaan akun GL, jurnal akuntansi, multi-accounting-schema, serta Reverse Correct/Accrual bukan scope Epic 7 dan semuanya milik Epic 14. Baris 2263 mencatat risikonya: dokumen Complete dengan `posted='Y'` mentok tanpa jalur reverse. Epic 8 menyerahkan `document_codes` sebagai kunci klasifikasi pemetaan akun (baris 2435, 2442). Epic 11 menyediakan titik pemasangan: "Hook after-Complete adalah titik pemasangan GL posting Epic 14. Posting berjalan sebagai handler event, bukan modifikasi document engine" (baris 3395). Epic 12 menyediakan kanal dan layar: kegagalan posting masuk prioritas tinggi, dikirim langsung, dan punya layar monitoring (baris 3489, 3521, 3654).

Kondisi kode saat ini menjelaskan mengapa penundaan ini mahal.

**Tidak ada kernel akuntansi, dan tidak ada Document Engine.** Pencarian di seluruh repositori menemukan nol tabel `document_types`, `document_sequences`, `document_backdate`, nol kolom `posted`, nol kolom `reversal_id`. Kontrak Epic 7 belum punya wujudnya. Yang ada hanya dua tabel finance: `finance_accounts` (`account_type` dibatasi `cash`/`bank`/`petty_cash`, `balance numeric(18,2)` dengan `CHECK (balance >= 0)`) dan `finance_transactions` (`direction` dibatasi `income`/`expense`, `amount numeric(18,2)`, `reverses_transaction_id` dengan indeks unik parsial sehingga pembalikan maksimal sekali). Migrasi `1767000000000` menulis batasnya sendiri di kepala berkas: "Chart of accounts, journals, general ledger, AP/AR, aging, budgeting, cost centres, reconciliation, tax, depreciation, consolidation, and financial statements are Advanced and deliberately absent." `finance_accounts` adalah dompet, bukan bagan akun.

**Outbox SCM sudah ada tetapi tidak punya pembaca.** `scm_accounting_ready_events` dibangun di Wave A5.1 dengan perangkat lengkap: `UNIQUE (tenant_id, idempotency_key)`, `account_assignment_dimensions` jsonb, `outbox_state` (`pending`/`published`/`failed`/`suppressed`), `reconciliation_state` (`unmatched`/`matched`/`reversed`/`ignored`), `reversal_of_event_id` yang menunjuk dirinya sendiri, trigger imutabilitas `trg_scm_accounting_ready_events_immutable_facts`, dan tabel transisi state. Tetapi dari 10 tipe event yang dideklarasikan, hanya 4 yang benar-benar dikirim (`inventory.goods_received` dari penggantian barang dan dari penyelesaian konsinyasi, `service.accepted`, `inventory.disposed`). Pencarian `scm_accounting_ready_events` di luar modul `supply-chain` menghasilkan nol baris: **tidak ada satu pun konsumen.** Emisi hari ini berakhir di ruang kosong.

**Dua emitter bolong membuat kolom yang sudah dibangun tidak terisi.** `createReturnToVendor` hanya meneruskan `line.accountingReadyEventId` tanpa mengirim event apa pun, sehingga barang yang dikembalikan ke pemasok tidak pernah masuk akuntansi. `createReceiptReversal` juga tidak mengirim event, sehingga `scm_receipt_reversals.reversal_event_id` dibiarkan kosong.

**Tidak ada satu pun layar akuntansi.** `apps/web/src/modules/finance/` berisi `FinanceAccountsPage`, `FinanceTransactionsPage`, `FinanceTransactionDetailPage`, `CashflowPage`, dan `money.ts`. Tidak ada UI untuk outbox maupun untuk monitoring posting. Empat dari sepuluh rute `finance.routes.ts` memakai `moneySchema = z.union([z.string().min(1), z.number()])`, sementara invariant modulnya adalah `Money = string` end-to-end.

**Arsitekturnya sudah dikontrak tetapi belum diotorisasi.** Delapan ADR (0015 sampai 0022) menyimpan keputusan desain lengkap untuk seluruh Wave A6 dengan status `PROPOSED`, masing-masing dengan blok "Runtime authorization gate". ADR-0023 berstatus `ACCEPTED` dan mengikat batas kepemilikan: Finance memiliki account determination, journal generation, posting, GL, GR/IR, AP invoice, pajak, settlement, fiscal close, dan laporan; SCM tidak boleh membuat jurnal, menentukan akun, menghitung pajak, atau memegang state periode. ADR-0023 juga menolak alternatif yang berbunyi "Storing accounting state as columns on operational documents and treating them as the ledger".

Epic 14 karena itu bukan "tambahkan kolom posting". Ia adalah **kernel akuntansi beserta adapter ke Document Engine**: dari dokumen dan event operasional menjadi fakta akuntansi yang immutable, seimbang, dan patuh periode.

#### Keputusan terkunci (2026-09-25)

Wawancara Epic 14: lima putaran pertanyaan, ditambah dua putaran penyelesaian konflik dan satu pertanyaan yang diulang atas permintaan pemilik produk. Nomor di bawah adalah nomor keputusan, bukan nomor pertanyaan. Dua jawaban berisi "[Tanpa preferensi]" dan diisi rekomendasi perancang; keduanya ditandai eksplisit di butir yang bersangkutan.

1. **Cakupan: kernel posting saja.** Yang dibangun adalah bagan akun, accounting schema dan ledger, pemetaan akun, jurnal, pipeline posting, status dan percobaan ulang posting, periode fiskal dengan daftar periksa penutupan, koreksi lewat jurnal balik, Neraca Saldo, Rincian Buku Besar, dan pemeriksaan rekonsiliasi kas. Enam kapabilitas sisanya dari Wave A6 (AP/AR dan aging, budgeting dan cost center, bank rekonsiliasi, aset tetap dan depresiasi, pajak kumulatif, konsolidasi dan empat laporan sisa) masuk **sesi Wave A6 terpisah** karena ukurannya dan karena masing-masing menunggu pemicu di luar kernel: data master pemasok dan pelanggan, impor rekening koran, atau sign-off spesialis pajak. Membawa keenamnya ke Epic 14 akan membuat §4.14 berisi janji yang tidak dapat ditepati sesi ini.

   > **Catatan penomoran.** Yang dimaksud "Wave 6" pada sesi wawancara adalah **Wave A6 Finance Advanced, 21 poin** di `ROADMAP-TO-100.md` baris 263 sampai 305, berstatus `planned / optional`. Itu berbeda dari **Phase 6 Finance Core** (12 poin, `FIN.1` sampai `FIN.6`) yang sudah COMPLETED sejak 2026-08-20. Epic 14 mendetailkan bagian pertama dari item pertama Wave A6 ("GL, chart of accounts, and journal", 5 poin) dan tidak menambah poin baru ke roadmap.

2. **Kolom `posted` tetap sebagai penunjuk cepat; otoritas kebenaran akuntansi adalah tabel jurnal.** §4.7 keputusan #5 tidak direvisi, sehingga layar monitoring Epic 12 tetap bekerja tanpa perubahan kontrak. Yang ditetapkan di sini adalah **arah kebenarannya**: bila penanda dan jurnal berbeda cerita, yang benar adalah jurnal, dan ada proses rekonsiliasi yang memperbaiki penanda dari jurnal, bukan sebaliknya. Konsekuensinya penanda boleh dihitung ulang kapan saja tanpa kehilangan informasi. ADR-0023 menolak "menyimpan state akuntansi sebagai kolom di dokumen operasional **dan memperlakukannya sebagai ledger**"; yang ditolak adalah bagian keduanya. Menghapus penanda dan menurunkannya dari tabel posting **ditolak** karena merevisi kontrak Epic 7 dan mengubah kontrak layar Epic 12 demi keuntungan yang tidak sepadan.

3. **Dua jalur sumber data menuju satu generator jurnal.** Dokumen internal masuk lewat event handler after-`Complete` Epic 11. Mutasi stok dan pengadaan dari SCM masuk lewat `scm_accounting_ready_events` yang sudah ada, ditulis atomik di transaksi yang sama dengan mutasi operasionalnya sesuai ADR-0023. Keduanya berujung pada generator jurnal yang sama. **Hook setelah commit sebagai satu-satunya jalur ditolak** karena `EventBus` menyimpan `domain_events`, mengirim sinkron, dan sengaja menelan exception subscriber, sehingga tidak atomik untuk data SCM. **Accounting-ready event untuk semua dokumen ditolak** karena menambah tabel event baru bagi seluruh Document Engine padahal dokumen internal tidak punya problem atomisitas yang sama.

4. **Status ADR tidak berubah di sesi ini, kecuali satu pembukaan terbatas.** ADR-0015 sampai 0022 tetap `PROPOSED`; ADR-0023 yang sudah `ACCEPTED` tetap mengikat. Yang dibuka adalah **izin implementasi runtime untuk kernel Epic 14 saja**, dan itu pun baru berlaku setelah pemilik produk menetapkan prioritasnya di sesi terpisah. AP/AR, budgeting, bank rekonsiliasi, aset tetap, pajak, dan konsolidasi tetap tanpa izin bangun. Dengan begitu tidak ada angka baseline roadmap yang bergerak karena sesi dokumentasi ini.

5. **Pemisahan kernel dan Wave A6 disetujui apa adanya.** Alasan pemisahannya bukan kesopanan cakupan melainkan ketergantungan: kernel adalah satu-satunya blok yang **semua** item Wave A6 bergantung padanya. Membangun AP/AR sebelum jurnal ada berarti piutang tidak punya tempat menyimpan fakta akuntansinya, dan itu melanggar ADR-0017 ayat 1 tentang control account otomatis. Tiga dari enam titik sisanya juga mengharuskan adanya sesuatu di luar kernel: data master lawan transaksi, impor rekening koran, dan sign-off spesialis pajak Indonesia.

6. **Izin bangun hanya untuk kernel Epic 14.** Bukan untuk seluruh Wave A6, bukan pula nol. Alternatif "semua ADR diangkat menjadi ACCEPTED" ditolak karena membuka 21 poin sekaligus dan menghapus kemampuan memilih prioritas antar-kapabilitas. Alternatif "tidak ada izin sama sekali" ditolak karena membuat §4.14 menjadi desain yang menggantung tanpa jalan.

7. **Bagan akun memakai template bawaan Indonesia yang dapat disesuaikan**, bukan wadah kosong dan bukan paket industri. Sembilan kelompok ADR-0015 (Aset, Kewajiban, Ekuitas, Pendapatan, Harga Pokok Penjualan, Beban Operasional, Pendapatan dan Beban Lain, Pajak dan Penghasilan Komprehensif, Statistik dan Memorandum) dikirim sebagai data awal ber-versi. Admin tenant boleh menyesuaikannya, dengan dua penjaga: akun yang sudah dipakai jurnal tidak dapat dihapus, dan perubahan yang mengubah tafsir historis membuat versi baru bertanggal berlaku alih-alih mengubah versi lama (ADR-0015 ayat 2). **Wadah kosong ditolak** karena setiap tenant baru akan menyusun struktur akun dari nol dan berisiko salah struktur. **Paket industri ditolak** karena ADR-0015 sendiri menempatkan Mining Industry COA Pack sebagai opsi yang belum diotorisasi.

8. **Jurnal disimpan di tabel tersendiri, terpisah dari Finance Core.** Tabel baru `finance_journals` (kepala) dan `finance_journal_lines` (baris). `finance_transactions` tidak disentuh maknanya dan tetap catatan kas operasional dengan `applied_at` sebagai kenyataannya. **Memperluas `finance_transactions` menjadi jurnal ditolak** karena menumpuk dua makna pada satu tabel dan melanggar keputusan Phase 6 yang sengaja menolak kata "posted" di tabel itu, sekaligus menempatkan migrasi berisiko pada data yang sudah jalan dan punya 21 test.

9. **Pemetaan akun adalah data yang diisi admin tenant, bukan kode.** `finance_posting_rules` memetakan `document_type_id` + `document_code_id` + kondisi dimensi menuju akun debit dan kredit, dan diisi lewat layar admin. Mengikuti pola Epic 11: admin memilih dari daftar tertutup, developer yang menentukan isi daftarnya. **Pemetaan tertanam di kode aplikasi ditolak** karena setiap variasi kode dokumen menuntut deploy ulang. **Pemetaan tanpa kondisi dimensi ditolak** karena divisi yang berbeda memakai akun beban yang berbeda pada dokumen yang sama.

10. **Periode fiskal: tahun, dua belas bulan, status buka dan tutup, dengan daftar periksa penutupan.** Ini yang menutup open item Epic 12 nomor 3 tentang definisi "laporan sudah ditutup" yang menggantung sejak Epic 5. Yang ditutup bukan retensinya, melainkan **definisi teknisnya**: sebuah periode dianggap tutup ketika statusnya `closed`, dan status itu hanya dapat dicapai setelah daftar periksa penutupan lulus. Penutupan tahun memindahkan saldo laba rugi ke laba ditahan; tidak ada posting historis yang dihapus.

11. **Koreksi jurnal adalah jurnal balik tertaut, tanpa edit dan tanpa hapus.** Dua jenis sesuai ADR-0016 ayat 3: Reverse Correct dengan tanggal transaksi asli, dan Reverse Accrual dengan tanggal berjalan. Setiap koreksi wajib membawa alasan, tanggal berlaku, rujukan jurnal asli, dan operatornya. **Ini yang mengisi `reversal_id` yang sejak Epic 7 baris 2242 sengaja dibiarkan kosong, sekaligus menutup open item #2 Epic 7.**

12. **Kegagalan posting tidak membatalkan dokumen, dan selalu terlihat.** Dokumen tetap Complete; jurnal berstatus `failed` dengan pesan galat tersanitasi, kelayakan coba ulang, dan riwayat percobaan. Kegagalan muncul di layar monitoring Epic 12, dan admin menerima notifikasi prioritas tinggi sesuai klasifikasi Epic 12. **Coba ulang memakai kunci idempotensi yang sama**, sehingga percobaan ulang tidak dapat menggandakan jurnal. **Rollback dokumen sumber ditolak** karena membatalkan transaksi bisnis yang sah hanya karena masalah akuntansi. **Coba ulang sebagai posting baru ditolak** karena itulah cara jurnal ganda lahir.

13. **Tanggal posting mengikuti tanggal transaksi dokumen; periode tertutup menolak, tidak menimpa.** Tanggal audit jurnal adalah kapan jurnal dibuat dan **tidak pernah di-backdate**. Bila periode untuk tanggal transaksi sudah tutup, posting gagal secara tertutup. Untuk koreksi, tanggal default adalah periode terbuka berikutnya, mengikuti keputusan Founder di ADR-0016. Membuka ulang periode yang sudah tutup adalah alur maker-checker tersendiri dengan alasan dan bukti dampak, dan tidak ada jalan pintas untuk Super Admin. **Backdate ke periode tertutup ditolak.** **Mundur otomatis ke periode berikutnya untuk semua posting ditolak** karena menyembunyikan perbedaan antara "periode tutup" dan "kesalahan tanggal".

14. **Neraca Saldo dan Rincian Buku Besar disertakan di Epic 14**, lewat jalur `report_definitions` Epic 12 sehingga keduanya otomatis mendapat izin akses, penjadwalan, ekspor CSV dan XLSX, serta retensi yang sudah dikontrak, dan dirender generator baca-saja Epic 13. **Alasannya bukan kelengkapan laporan melainkan ketergantungan pipeline:** daftar periksa penutupan butuh validasi neraca saldo seimbang, jadi neraca saldo adalah kebutuhan fungsional, bukan pelengkap. Neraca, Laba Rugi, Arus Kas, Laporan Ekuitas, dan aging tetap di Wave A6. Catatan: pertanyaan laporan ini terlewat di putaran pertama wawancara dan ditanyakan ulang atas permintaan pemilik produk; jawaban "[Tanpa preferensi]" diganti rekomendasi ini dan dicatat sebagai keputusan perancang, bukan keputusan pemilik produk.

15. **Epic 14 mengisi dua emitter SCM yang bolong:** Return-to-Vendor dan Receipt-Reversal. Keduanya saat ini tidak mengirim event sama sekali sehingga barang yang dikembalikan ke pemasok tidak pernah masuk akuntansi, dan `scm_receipt_reversals.reversal_event_id` dibiarkan kosong. Sisa enam tipe yang belum aktif (`inventory.goods_issued`, `inventory.transferred`, `inventory.adjusted`, `inventory.returned_to_vendor` dari jalur lain, `inventory.landed_cost_applied`, `inventory.consignment_consumed`) tetap tugas modul SCM, bukan ditambal dari sisi Finance.

16. **Pembagian hak akses: Super Admin mengelola template dan daftar akun global; Tenant Admin mengelola pemetaan akun dan periode tenant-nya.** Empat permission baru: `finance.accounting.read`, `finance.accounting.configure`, `finance.accounting.post`, `finance.accounting.close`. Penutupan periode dipisahkan dari konfigurasi karena penutupan adalah tindakan operasional dengan konsekuensi, bukan pekerjaan penyiapan.

17. **Mata uang: struktur siap, isi IDR saja di gelombang awal.** Jurnal menyimpan mata uang transaksi, kurs, dan nilai dalam mata uang fungsional sejak awal; konversi otomatis, revaluasi valuta asing, dan gain/loss kurs masuk Wave A6. **Menyimpan angka tanpa kolom mata uang dan kurs ditolak** karena menambahkannya kemudian berarti migrasi yang menyentuh seluruh jurnal historis.

18. **Jurnal manual (input layar) diizinkan dengan approval wajib.** Dipakai untuk saldo awal, koreksi tak terduga, dan penyesuaian penutup. Alurnya: input di layar, wajib seimbang sebelum dapat disimpan, wajib melewati Workflow Engine sebelum berstatus `posted` — persis ADR-0016 ayat 2. **Jurnal manual tanpa approval ditolak** karena itu jalur tercepat menyembunyikan selisih. **Jurnal manual hanya lewat skrip basis data ditolak** karena tidak meninggalkan jejak approval.

19. **Alat periksa rekonsiliasi kas disertakan di Epic 14.** Membandingkan `finance_accounts.balance` (Finance Core) dengan saldo akun kas pada jurnal, per akun dan per periode, dan melaporkan selisih sebagai temuan alih-alih memperbaikinya otomatis. Ini yang memenuhi persyaratan ADR-0015 bahwa saldo kas Finance Core "must reconcile through owned application services" tanpa menyentuh tabel Finance Core.

20. **Penanda perilaku akun disiapkan sekarang meski pemakainya di Wave A6.** `open_item`, `control`, `automatic_only`, dan `reconciliation_type` dibuat sejak awal karena AP/AR Wave A6 bergantung padanya dan menambahkannya kemudian berarti migrasi yang menyentuh bagan akun, pemetaan, dan jurnal historis sekaligus. Akun `control` menolak jurnal manual dan akun `automatic_only` menolak jurnal manual sejak gelombang pertama, bukan sejak AP/AR ada.

21. **Cutover bertanggal, dengan event SCM lama ditandai `suppressed`, bukan dihapus.** Saat kernel mulai berjalan, event yang sudah terlanjur dikirim sebelum cutover ditandai `suppressed` secara massal sehingga tidak ada jurnal retroaktif di luar kendali, sementara jejaknya tetap utuh untuk audit. Saldo awal masuk lewat jurnal manual (**keputusan #18**), bukan lewat pemrosesan ulang event lama.

22. **Bentuk laporan Neraca Saldo dan Rincian Buku Besar: satu definisi laporan per format, keduanya menghormati Data Scope Epic 12 dan mencetak scope yang dipakai.** Kolom minimum Neraca Saldo: nomor akun, nama akun, saldo awal debit dan kredit, mutasi debit dan kredit periode, saldo akhir debit dan kredit. Kolom minimum Rincian Buku Besar: tanggal, nomor jurnal, kode dokumen, sumber, akun, keterangan, debit, kredit, dan saldo berjalan. Keduanya wajib memiliki keadaan kosong yang menjelaskan **mengapa** kosong (belum ada jurnal, atau seluruh jurnal periode tersebut tersaring oleh scope pengguna), bukan tabel kosong tanpa keterangan.

#### Prinsip yang mengikat

- **Kebenaran akuntansi ada di jurnal, bukan di dokumen operasional.** Penanda `posted` adalah kenyamanan tampilan.
- **Fakta akuntansi tidak pernah diubah dan tidak pernah dihapus.** Koreksi selalu berupa jurnal balik atau penyesuaian yang tertaut.
- **Satu kejadian, satu jurnal.** Kunci idempotensi adalah identitas kejadiannya; percobaan ulang memakai kunci yang sama dan karena itu tidak dapat menggandakan.
- **Posting tidak boleh membatalkan transaksi bisnis yang sah.** Kegagalan posting menghasilkan status yang terlihat, bukan rollback.
- **Batas kepemilikan ADR-0023 mengikat.** SCM mengirim fakta operasional, Finance yang menentukan akun dan menghasilkan jurnal; tidak ada mesin jurnal lokal di modul operasional.
- **Angka uang tidak pernah melewati bilangan pecahan biner JavaScript.** `numeric` di basis data dan string desimal di atasnya, meneruskan invariant Finance Core dan ADR-0015 ayat 4.
- **Periode tertutup gagal secara tertutup.** Tidak ada penimpaan periode tertutup tanpa alur maker-checker, alasan, dan bukti dampak.
- **Enforcement bukan di UI.** Layar admin, pemetaan, dan tombol adalah kenyamanan; yang menegakkan aturan adalah basis data dan layanan.

#### Basis iDempiere (terverifikasi terhadap riset lokal)

| Konsep | Sumber terverifikasi | Diadopsi/dimodifikasi |
|---|---|---|
| Tabel fakta akuntansi immutable terpisah dari dokumen sumber | `13-database.md:117,125,384`, `09-document-engine.md:208–212` | **Adopt** sebagai bentuk tabel jurnal (keputusan #8) |
| Debit sama dengan kredit dan aritmetika desimal eksak | `09-document-engine.md:207–212` | **Adopt** sebagai kendala basis data (ADR-0016 ayat 2) |
| Kombinasi akun dengan dimensi Organisasi, Produk, Mitra Bisnis | `13-database.md:114–117` | **Adopt**; dimensi tidak dikodekan ke nomor akun (ADR-0015 ayat 1) |
| Resolusi akun bawaan lewat master data | `13-database.md:125`, pola `M_Product_Category_Acct` | **Adopt** sebagai gagasan; implementasinya tabel pemetaan yang diisi admin (keputusan #9) |
| Rujukan dokumen sumber dan kunci idempotensi pada baris fakta | `09-document-engine.md:211`, `13-database.md:226,352` | **Adopt**; `AD_Table_ID` dan `Record_ID` diganti rujukan dokumen bertipe |
| Kontrol periode buka dan tutup | `13-database.md:121`, `09-document-engine.md:167` | **Adopt** sebagai bentuk periode fiskal (keputusan #10) |
| Jurnal balik tertaut, dokumen tidak pernah dihapus | `09-document-engine.md:218` | **Adopt**; kolom `reversal_id` Epic 7 terisi di sini (keputusan #11) |
| Riwayat status dokumen dipisah dari mesin posting | `09-document-engine.md:288,304` | **Adopt**; sudah diputus Epic 7 |
| Transaksi atomik dengan status gagal yang terlihat dan dapat diulang | `09-document-engine.md:279–281,297` | **Adopt** sebagai `pending`/`posted`/`failed` (ADR-0016 ayat 1) |
| `Posted='E'` dan jendela "Unposted Documents" | `09-document-engine.md:215,297` | **Adopt**; sudah menjadi kontrak Epic 12 baris 3521 |
| Validator fakta akuntansi yang dapat memveto, dan event sebelum/sesudah posting | `17-event-system.md:713–758` | **Modernize**; titik veto dipakai untuk memvalidasi keseimbangan sebelum jurnal ditulis, bukan lewat topic OSGi |
| Skema akuntansi paralel | `09-document-engine.md:212,290,305` | **Modernize dan batasi**: satu ledger primer aktif per entitas legal, siap multi-ledger (ADR-0015 ayat 3) |
| Posting sinkron `AutoPost` menahan antarmuka | `09-document-engine.md:215,296` | **Modernize**: asinkron, antarmuka tidak menunggu |
| Kontrak jurnal balik generik dengan uji otomatis | `09-document-engine.md:295,307` | **Modernize**; melawan edge case manual iDempiere |
| Penanda `Processing` sebagai kunci optimistik | `09-document-engine.md:279,306` | **Modernize**: penguncian baris dan token versi, aman untuk banyak instance |
| Transisi status sebagai state machine hardcoded di Java | `09-document-engine.md:294` | **Modernize**: perilaku periodik menjadi data bertanggal berlaku |
| Transisi status dokumen dikerjakan mesin akuntansi | `09-document-engine.md:294,295` | **Reject**: melanggar batas kepemilikan ADR-0023 |
| Kolom ledger di setiap dokumen sumber | `09-document-engine.md:288` | **Reject**: ADR-0016 ayat 1 menolak "storing accounting fields directly on every source document as the ledger" |
| Menyunting atau menghapus baris jurnal yang sudah diposting | `09-document-engine.md:218` | **Reject** (keputusan #11) |
| Pemeriksaan keseimbangan hanya di aplikasi tanpa kendala basis data | `09-document-engine.md:281` | **Reject**: ADR-0016 mensyaratkan penegakan di basis data |
| Re-Activate sebagai jalur koreksi umum | `09-document-engine.md:273,295,307` | **Reject**; sudah diblokir `posted='Y'` di Epic 7 baris 2166 |
| Ledger sekunder, paralel, atau pajak aktif di gelombang awal | `09-document-engine.md:305` berbanding ADR-0015 baris 60 | **Reject dan tunda**: butuh persetujuan pemilik produk terpisah |
| Mesin jurnal, reversal, atau kontrol periode lokal per modul | ADR-0023 ayat 3 baris 62–65 | **Reject**: dilarang sebagai bayangan ledger |
| Rekonsiliasi bank terperinci, e-Faktur dan pemotongan PPh Indonesia, GR/IR clearing, aset tetap, konsolidasi | **tidak ada di riset** | Tidak dapat diambil dari basis ini; cakupannya di ADR-0017 sampai 0022 dan berada di Wave A6 |

#### Model target

##### Dibaca

**Tanpa perubahan struktur:**

- `document_types`, `document_codes`, `document_sequences` (Epic 8) — kunci klasifikasi untuk pemetaan akun; tanpa `document_code_id` pemetaan tidak dapat diarahkan.
- `finance_accounts`, `finance_transactions` (Finance Core, Phase 6) — dibaca oleh alat pemeriksa rekonsiliasi kas. Tidak ada kolom yang ditambah, tidak ada makna yang diubah.
- `scm_accounting_ready_events` (Wave A5.1) — dibaca sebagai sumber fakta operasional SCM.
- `report_definitions`, `notifications`, `notification_deliveries` (Epic 12) — jalur penyajian Neraca Saldo dan Buku Besar, dan jalur peringatan kegagalan posting.
- `workflow_instance_id` (Epic 9) — satu-satunya otoritas approval untuk jurnal manual.
- Hook after-`Complete` (Epic 11) — titik masuk dokumen internal.
- `audit_log` (Epic 1) — jejak setiap perubahan pemetaan akun, pembukaan periode, dan penutupan periode.

**Perluasan pada kontrak yang sudah ada, bukan tabel baru:**

- Dokumen Epic 7 — kolom `posted` (`N`/`Y`/`E`) dan `reversal_id` yang selama ini ditahan kini punya penulisnya. Keduanya sudah dikontrak di baris 2166 dan 2242; Epic 14 hanya mulai mengisinya.
- `scm_accounting_ready_events` — dua emitter bolong diisi (keputusan #13).

##### Tabel baru

Nama final saat desain migrasi; yang dikunci di sini adalah bentuk dan batasnya.

| Tabel | Isi | Kendala kunci |
|---|---|---|
| `finance_schemas` | Skema akuntansi per entitas legal: mata uang fungsional, versi bagan akun yang aktif, status | Unik satu skema aktif per entitas legal (ADR-0015 ayat 3) |
| `finance_ledgers` | Ledger per skema: `primary`, kelak `secondary` dan `tax` | Satu `primary` aktif per entitas legal; jenis lain butuh persetujuan terpisah |
| `finance_gl_accounts` | Bagan akun: nomor (maksimal 10 digit), nama, kelompok 1 sampai 9, tipe akun, saldo normal, `header`/`control`/`posting`, penanda `automatic_only`, `open_item`, `reconciliation_type`, kategori pajak, pemetaan arus kas, keberlakuan entitas legal | Nomor unik per skema per versi; akun `control` menolak jurnal manual; akun yang sudah dipakai tidak dapat dihapus (keputusan #7) |
| `finance_coa_versions` | Versi bagan akun beserta tanggal berlaku, status approval, dan penanda immutable-after-use | Versi lama tidak pernah diubah (ADR-0015 ayat 2) |
| `finance_posting_rules` | Pemetaan akun: `document_type_id` + `document_code_id` + kondisi dimensi menuju akun debit dan akun kredit | Berversi, bertanggal berlaku, immutable setelah dipakai; diisi admin tenant (keputusan #9) |
| `finance_journals` | Kepala jurnal: dokumen sumber bertipe, `document_code_id`, entitas legal, skema, ledger, periode fiskal, tanggal transaksi, tanggal audit, mata uang dan kurs, `posting_rule_version_id`, `idempotency_key`, status `pending`/`posted`/`failed`, `reversal_id` menunjuk dirinya sendiri, alasan koreksi, `workflow_instance_id` untuk jurnal manual | `UNIQUE (tenant_id, idempotency_key)`; jurnal berstatus `posted` immutable |
| `finance_journal_lines` | Baris jurnal: akun, debit (`numeric`), kredit (`numeric`), dan dimensi terstruktur (entitas legal, organisasi, proyek, cost center, mitra bisnis, produk) | Satu baris tidak boleh mengisi debit dan kredit sekaligus; jumlah seluruh debit sama dengan jumlah seluruh kredit per jurnal, ditegakkan basis data (ADR-0016 ayat 2) |
| `finance_fiscal_years` | Tahun fiskal per skema: tanggal mulai, tanggal selesai, status | Tidak boleh ada tahun fiskal bertumpang tindih dalam satu skema |
| `finance_fiscal_periods` | Dua belas periode per tahun fiskal dengan status `open`/`closed` dan tanggal tutup | Posting ke periode `closed` gagal secara tertutup (ADR-0016) |
| `finance_close_checklists` | Daftar periksa penutupan per periode: dokumen belum terposting, dokumen gagal posting, status rekonsiliasi kas, validasi neraca saldo seimbang, item penyesuaian | Penutupan tidak dapat selesai selama daftar periksa berisi butir gagal, kecuali penimpaan oleh Super Admin dengan alasan tercatat |
| `finance_open_items` | Item terbuka per akun `control`/`open_item`: saldo awal, mutasi, sisa, status `open`/`settled`/`written_off` | Struktur disiapkan sekarang, dipakai AP/AR di Wave A6 (keputusan #19) |

**Catatan tentang `finance_accounts` yang sudah ada.** Tabel itu adalah dompet kas operasional, bukan bagan akun, dan dua makna itu tidak boleh digabung ke satu tabel. Bagan akun baru memakai nama `finance_gl_accounts`. Tidak ada migrasi data dari `finance_accounts`; alat periksa rekonsiliasi kas yang menjembatani keduanya.

##### Perluasan

Tidak ada. Epic 14 tidak menambah kolom pada `finance_accounts` maupun `finance_transactions`.

#### Mekanisme

##### Pipeline posting

Satu jalur untuk semua sumber: hook after-`Complete` (dokumen internal) dan `scm_accounting_ready_events` (mutasi SCM) sama-sama masuk ke generator yang sama.

1. **Klaim.** Baris kerja diambil dengan penguncian baris dan token versi. Pekerja kedua yang mengambil baris sama kehilangan klaim dan keluar tanpa menulis apa pun.
2. **Idempotensi.** Generator menghitung kunci dari identitas kejadian, bukan dari waktunya. Kunci sudah ada di jurnal berarti jurnal sudah pernah dibuat; jalur berhenti di situ dengan status `posted` yang sudah ada.
3. **Resolusi akun.** Pemetaan dicari lewat `document_type_id` + `document_code_id` + kondisi dimensi, memakai versi pemetaan yang berlaku pada tanggal transaksi, bukan versi terbaru. Pemetaan yang tidak ketemu bukan kesalahan sementara; jurnal gagal dengan pesan yang menyebut pemetaan mana yang kosong.
4. **Penyusunan.** Baris jurnal dibentuk lengkap dengan dimensinya. Aritmetika uang memakai desimal eksak: `numeric` di basis data, string desimal di aplikasi, tidak ada bilangan pecahan biner JavaScript di jalur mana pun.
5. **Validasi.** Sebelum menulis: jumlah debit sama dengan jumlah kredit, tidak ada baris berisi debit dan kredit sekaligus, setiap akun berstatus `posting`, tidak ada akun `automatic_only` di jurnal manual, periode untuk tanggal transaksi berstatus `open`, mata uang jurnal sesuai, dan rujukan dokumen sumber valid. Validasi yang gagal membatalkan seluruh jurnal, bukan sebagian baris.
6. **Tulis.** Kepala dan baris jurnal ditulis dalam satu transaksi bersama pembaruan penanda `posted` pada dokumen sumber dan penandaan event SCM sebagai terpakai. Ketiganya berhasil atau ketiganya batal.
7. **Status akhir.** `posted` berarti jurnal ada dan seimbang. `failed` berarti jurnal tidak terbentuk, dengan pesan galat tersanitasi, kelayakan coba ulang, dan riwayat percobaan. Dokumen sumber tetap berstatus Complete — keputusan #10 dan ADR-0016 ayat 1.

**Aturan sanitasi pesan galat.** `posted='E'` adalah sumbu utama dan `posted='E'` tidak boleh membocorkan skema basis data, potongan kueri, nama tabel internal, jalur berkas, atau nilai rahasia apa pun ke dokumen maupun ke UI. Pesan yang aman: kode galat stabil, nama pemetaan atau akun yang tidak ditemukan, dan nama periode yang menutup posting. Kalau jawabannya butuh stack trace, stack trace-nya masuk log server, bukan ke dalam baris data.

##### Koreksi

Jurnal berstatus `posted` tidak pernah diubah dan tidak pernah dihapus. Koreksi selalu berupa jurnal baru yang menunjuk jurnal lama lewat `reversal_id`, dan jurnal lama menunjuk balik ke jurnal koreksinya.

| Jenis | Tanggal | Dipakai untuk |
|---|---|---|
| Reverse Correct | Tanggal transaksi asli | Kesalahan ditemukan sebelum periode tutup; koreksi harus berada di periode yang sama |
| Reverse Accrual | Tanggal berjalan | Periode asli sudah tutup, atau koreksi sengaja ditempatkan di periode berjalan |

Setiap koreksi wajib membawa alasan, tanggal berlaku, rujukan jurnal asli, dan operatornya. Bila periode asli sudah tutup, tanggal defaultnya adalah periode terbuka berikutnya; koreksi tidak dapat dipaksa masuk ke periode yang sudah tutup kecuali lewat pembukaan ulang.

##### Penutupan periode

Menutup periode bukan tindakan administratif di UI, melainkan **keputusan yang hanya boleh diambil setelah daftar periksa lulus**.

Daftar periksa penutupan minimal, semuanya berasal dari ADR-0016 dan semuanya terisi dari data yang sudah ada:

1. Dokumen belum terposting untuk periode tersebut — dari penanda `posted`.
2. Dokumen gagal posting dan belum berhasil dicoba ulang.
3. Status rekonsiliasi kas.
4. Validasi neraca saldo: jumlah debit sama dengan jumlah kredit pada seluruh jurnal periode tersebut.
5. Jurnal manual yang belum mendapat approval.
6. Jurnal yang menunggu keputusan koreksi.

Penutupan tahun fiskal memindahkan saldo akun laba rugi ke akun laba ditahan lewat jurnal penutup yang idempotent, tidak menghapus posting historis, dan tidak menulis ulang periode yang sudah tutup.

Pembukaan ulang periode **yang sudah tutup** adalah alur maker-checker tersendiri: pengaju dan penyetuju harus dua orang berbeda, alasan wajib, bukti dampak wajib, dan seluruh jejaknya append-only. Super Admin tidak punya jalan pintas yang melewati alur ini.

##### Rekonsiliasi penanda dan jurnal

Periode tutup tidak boleh bergantung pada penanda yang bisa salah. Karena itu ada proses rekonsiliasi yang membandingkan penanda `posted` pada dokumen dengan keberadaan jurnal yang sebenarnya, dan **memperbaiki penanda dari jurnal**, bukan sebaliknya. Prosesnya idempotent dan boleh dijalankan kapan saja. Ini yang membuat keputusan #2 bukan sekadar kompromi: penanda tetap ada, tetapi tidak satu pun keputusan penting bergantung padanya.

##### Rekonsiliasi kas

Alat periksa membandingkan `finance_accounts.balance` (Finance Core) dengan saldo akun kas pada jurnal, per akun kas dan per periode. Selisih dilaporkan sebagai temuan, bukan diperbaiki otomatis: menyentuh `finance_transactions` dari luar modul finance adalah hal yang dilarang keputusan #8.

##### Penyajian

**Neraca Saldo** dan **Rincian Buku Besar** tidak dibangun sebagai modul laporan baru. Keduanya menjadi definisi laporan pada `report_definitions` Epic 12, sehingga otomatis mendapatkan izin akses, penjadwalan, ekspor CSV dan XLSX, serta retensi yang sudah dikontrak. Rendering memakai generator baca-saja Epic 13 dengan token yang sama.

Alasan keduanya masuk kernel, bukan Wave A6: daftar periksa penutupan butuh validasi neraca saldo seimbang, jadi neraca saldo adalah **kebutuhan fungsional pipeline**, bukan pelengkap. Neraca, Laba Rugi, Arus Kas, Ekuitas, dan aging tetap di Wave A6 bersama ADR-0019 sampai 0022.

##### UI

Semua layar baru masuk kategori gelombang yang sudah dikontrak Epic 13, dan seluruhnya berstatus **"draft without direction"** sampai `DESIGN.md` ditulis pemilik produk (R-37, §4.13 keputusan #23). Yang akan dibangun:

- **Layar monitoring posting** — daftar jurnal `failed` dan `pending`, dengan penyebab, kelayakan coba ulang, riwayat percobaan, dan tombol coba ulang. Ini layar yang dititipkan Epic 7 dan Epic 12.
- **Layar bagan akun** — daftar, tambah, ubah, dan versi; akun yang sudah dipakai jurnal menampilkan alasan mengapa tombol hapus tidak aktif, bukan tombol mati tanpa keterangan (R-26).
- **Layar pemetaan akun** — pilih tipe dokumen dan kode dokumen dari daftar, pilih akun debit dan kredit, tambahkan kondisi dimensi.
- **Layar periode fiskal** — tahun dan dua belas periode, status, daftar periksa penutupan per periode.
- **Layar jurnal manual** — input kepala dan baris, dengan penyeimbang debit-kredit sebelum dapat disimpan, lalu wajib melewati Workflow Engine sebelum berstatus `posted`.
- **Layar jurnal** — daftar dan rincian, termasuk jurnal balik dan rantai koreksinya.
- **Neraca Saldo dan Rincian Buku Besar** — dua definisi laporan Epic 12.

Setiap layar wajib punya keadaan kosong, memuat, dan galat (R-38 dan C-4); tidak ada tombol yang tidak melakukan apa-apa (R-26); tidak ada tautan ke halaman yang belum ada (R-24); teks dan label memakai istilah Indonesia yang konsisten dengan terminologi Epic 8, dan singkatan asing dijelaskan pertama kali muncul.

#### Gelombang

Empat belas gelombang. Urutannya bukan preferensi: setiap gelombang memakai keluaran gelombang sebelumnya, dan gelombang 14.13 serta 14.14 adalah gerbang produksi.

| Gelombang | Isi | Bergantung pada |
|---|---|---|
| 14.1 | Kerangka akuntansi: `finance_schemas`, `finance_ledgers`, satu ledger primer per entitas legal, mata uang fungsional | Epic 1 (tenant, entitas legal) |
| 14.2 | Bagan akun: `finance_gl_accounts` dengan sembilan kelompok, tipe akun, saldo normal, penanda perilaku (keputusan #20), versi, dan template bawaan Indonesia | 14.1 |
| 14.3 | Pemetaan akun: `finance_posting_rules` beserta layar admin tenant dan versi bertanggal berlaku | 14.2, Epic 8 (`document_codes`) |
| 14.4 | Tahun dan periode fiskal: `finance_fiscal_years`, `finance_fiscal_periods`, status buka dan tutup | 14.1 |
| 14.5 | Tabel jurnal: `finance_journals` dan `finance_journal_lines` beserta seluruh kendala basis data (keseimbangan, satu sisi per baris, imutabilitas) | 14.1, 14.4 |
| 14.6 | Generator jurnal dan adapter sumber: hook after-`Complete` Epic 11 untuk dokumen internal, dan konsumen pertama `scm_accounting_ready_events` untuk mutasi SCM, menuju generator yang sama | 14.3, 14.5, Epic 11 |
| 14.7 | Status posting dan pemulihan: `pending`/`posted`/`failed`, sanitasi pesan galat, coba ulang manual dengan kunci idempotensi yang sama, riwayat percobaan, penulisan penanda `posted` pada dokumen sumber | 14.6 |
| 14.8 | Emitter SCM yang bolong: Return-to-Vendor dan Receipt-Reversal | 14.6 |
| 14.9 | Koreksi: jurnal balik Reverse Correct dan Reverse Accrual, pengisian `reversal_id`, rantai koreksi di layar jurnal | 14.7 |
| 14.10 | Jurnal manual dengan approval Workflow Engine, dan rekonsiliasi penanda dengan jurnal | 14.7, Epic 9 |
| 14.11 | Penutupan periode: daftar periksa, penutupan bulanan, penutupan tahun dengan pemindahan laba ditahan, pembukaan ulang maker-checker | 14.7, 14.8, 14.10 |
| 14.12 | Alat periksa rekonsiliasi kas | 14.5, Finance Core Phase 6 |
| 14.13 | Neraca Saldo dan Rincian Buku Besar lewat `report_definitions`, dan rendering generator baca-saja | 14.11, Epic 12, Epic 13 |
| 14.14 | Cutover bertanggal: penandaan `suppressed` massal untuk event SCM lama, jurnal saldo awal, dan pembuktian bahwa tidak ada jurnal ganda | 14.1 sampai 14.13 |

#### Handoff

| Ke/Dari | Kontrak |
|---|---|
| **Dari Epic 1** | Tenant, entitas legal, `audit_log`, permission. Epic 14 menambah empat permission `finance.accounting.*`. |
| **Dari Epic 6** | Data master mitra bisnis, organisasi, produk, dan cost center dipakai sebagai dimensi baris jurnal; Epic 14 tidak membuat dimensi baru. |
| **Dari Epic 7** | **Menutup open item #1 Epic 7** (pemetaan akun GL, multi-accounting-schema, jurnal, Reverse Correct dan Reverse Accrual). **Menutup open item #2 Epic 7** (`reversal_id` mulai diisi lewat keputusan #11). **Mulai mengisi** kolom `posted` (`N`/`Y`/`E`) dan `reversal_id` yang ditahan sejak baris 2166 dan 2242. Status `RE`/`WP`/`WC` dan aksi `PO`/`RC`/`RA` tetap urusan Document Engine, bukan Epic 14. |
| **Dari Epic 8** | `document_types` dan `document_codes` menjadi kunci klasifikasi pemetaan akun. Epic 14 tidak membuat tipe atau kode dokumen baru. |
| **Dari Epic 9** | Workflow Engine adalah satu-satunya otoritas approval untuk jurnal manual; Epic 14 tidak punya state machine approval sendiri, persis larangan ADR-0016 ayat 3. |
| **Dari Epic 11** | Hook after-`Complete` menjadi titik masuk dokumen internal. Handler posting terdaftar di allowlist Epic 11 dan tunduk pada kontraknya, termasuk larangan skrip bebas. |
| **Dari Epic 12** | Layar monitoring `posted='E'` menjadi rumah bagi jurnal `failed`; klasifikasi prioritas tinggi untuk kegagalan posting sudah dikontrak di baris 3489. `report_definitions` menjadi jalur Neraca Saldo dan Buku Besar. **Menutup open item #3 Epic 12** (definisi teknis "laporan sudah ditutup": periode berstatus `closed`, dicapai hanya setelah daftar periksa penutupan lulus). |
| **Dari Epic 13** | Seluruh layar Epic 14 tunduk pada §4.13 keputusan #23: berstatus "draft without direction" sampai `DESIGN.md` ditulis pemilik produk. Neraca Saldo dan Buku Besar adalah kandidat kuat pemakai generator baca-saja pertama bersama layar monitoring. |
| **Ke Wave A6** | Kernel ini adalah prasyarat **semua** item Wave A6: AP/AR dan aging, budgeting dan cost center, bank rekonsiliasi, aset tetap dan depresiasi, pajak dan konsolidasi, serta Neraca, Laba Rugi, Arus Kas, dan Laporan Ekuitas. `finance_open_items` sudah disiapkan (keputusan #20) supaya AP/AR tidak perlu migrasi struktur. |
| **Dari ADR-0023** | Batas kepemilikan mengikat: SCM mengirim fakta operasional, Finance menentukan akun dan membuat jurnal. Tidak ada mesin jurnal, reversal, atau kontrol periode di modul operasional. |

#### Out-of-scope

Ditulis eksplisit supaya tidak ada yang mengira sudah tercakup:

- **AP/AR dan aging** (ADR-0017) — Wave A6. Termasuk control account otomatis untuk piutang dan utang, meski `finance_open_items` dan penanda `control` sudah disiapkan di sini.
- **Budgeting dan cost center** (ADR-0020) — Wave A6. Cost center sudah ada sebagai dimensi baris jurnal, bukan sebagai anggaran.
- **Bank rekonsiliasi** (ADR-0018) — Wave A6. Alat periksa rekonsiliasi kas di Epic 14 berbeda: ia membandingkan saldo internal dengan jurnal, bukan impor rekening koran.
- **Aset tetap dan depresiasi** (ADR-0021) — Wave A6.
- **Pajak kumulatif, e-Faktur, dan pemotongan PPh** (ADR-0019) — Wave A6, menunggu sign-off spesialis pajak Indonesia.
- **Konsolidasi lintas entitas dan Neraca, Laba Rugi, Arus Kas, Laporan Ekuitas** (ADR-0022) — Wave A6. Neraca Saldo dan Rincian Buku Besar yang masuk Epic 14 bukan pengganti keduanya.
- **Ledger sekunder, ledger pajak, dan akuntansi paralel** — butuh persetujuan pemilik produk terpisah (ADR-0015 ayat 3). Struktur `finance_ledgers` menyiapkannya tanpa mengaktifkannya.
- **Konversi valuta asing dan revaluasi kurs** — Wave A6. Struktur mata uang disiapkan di sini.
- **Industry Pack** (mis. Mining COA Pack) — belum diotorisasi di ADR-0015; hanya template Indonesia yang dikirim.
- **Mesin print-format, BPMN, dan SQL bebas untuk user** — sudah ditolak Epic 11 dan 12; Epic 14 tidak membukanya kembali.
- **Status dokumen `RE`/`WP`/`WC` dan aksi `PO`/`RC`/`RA`** — kontrak Epic 7 untuk Document Engine, bukan mesin posting.
- **Perubahan pada `finance_accounts` dan `finance_transactions`** — Finance Core Phase 6 tidak disentuh sama sekali.

#### Open items

1. **Daftar final akun template bawaan Indonesia** — 14.2. Kandidat berdasarkan sembilan kelompok ADR-0015, tetapi daftar konkretnya butuh tinjauan akuntan.
2. **Jumlah digit dan skema penomoran akun final** — 14.2. Batas maksimal 10 digit sudah dikunci; pola penomoran yang dibaca manusia (mis. `1-1000`, `1100`) belum.
3. **Bentuk konkret kondisi dimensi pada pemetaan akun** — 14.3. Keputusan #9 mengunci bahwa kondisi dimensi ada; apakah disimpan sebagai kolom terstruktur atau sebagai pasangan kunci-nilai masih terbuka. Pola Epic 13 keputusan #13 (`{ field, operator, value, join }`) adalah kandidat terkuat.
4. **Nama kolom `posted` pada tabel dokumen mana saja** — 14.7. Epic 7 mengontrak nilai `N`/`Y`/`E` tetapi tidak menyebut tabel mana yang memiliki kolom itu; daftar ini ditetapkan saat Document Engine dieksekusi.
5. **Ambang batas batas hari backdate** — 14.4. ADR-0016 dan §6 open decision #14 sudah menyebut "batas hari backdate"; angkanya adalah parameter policy, bukan arsitektur.
6. **Bentuk pesan galat tersanitasi yang aman namun berguna** — 14.7. Bentuk pesan yang cukup untuk admin menelusuri pemetaan atau periode yang salah tanpa membocorkan skema basis data.
7. **Ambang dan isi notifikasi kegagalan posting** — 14.7. Prioritas tinggi sudah dikontrak Epic 12; apakah dikirim per kegagalan atau digabung per periode masih perlu diputuskan bersama Epic 12.
8. **Titik cutover dan cara mengukur cakupan penandaan `suppressed`** — 14.14. Berapa event lama yang ditandai, dan bagaimana membuktikan tidak ada yang terlewat.
9. **Mata uang fungsional per entitas legal** — 14.1. IDR untuk gelombang awal; apakah satu entitas legal dapat punya mata uang fungsional selain IDR masih terbuka dan menunggu kebutuhan nyata.
10. **Apakah Rincian Buku Besar perlu pagar jumlah baris** — 14.13. Akun dengan volume tinggi bisa menghasilkan rincian sangat besar; bentuk pagar atau agregasi belum diputuskan.

#### Risk mitigation

| Risiko | Mitigasi |
|---|---|
| Jurnal ganda karena percobaan ulang | Kunci idempotensi dari identitas kejadian, bukan dari waktu; kendala unik di basis data; percobaan ulang selalu memakai kunci yang sama (keputusan #12) |
| Saldo tidak seimbang lolos ke produksi | Keseimbangan ditegakkan sebagai kendala basis data, bukan hanya pemeriksaan aplikasi (ADR-0016 ayat 2) |
| Penanda `posted` menyimpang dari jurnal | Rekonsiliasi penanda dari jurnal, berjalan idempotent dan boleh kapan saja (keputusan #2, gelombang 14.10) |
| Angka uang kehilangan presisi | `numeric` di basis data, string desimal di aplikasi, tanpa bilangan pecahan biner JavaScript di jalur mana pun; meneruskan invariant Finance Core |
| Kegagalan posting membatalkan transaksi bisnis yang sah | Dokumen tetap Complete; kegagalan menjadi status yang terlihat, bukan rollback |
| Koreksi menyelinap ke periode yang sudah tutup | Periode `closed` gagal secara tertutup; pembukaan ulang wajib maker-checker dengan alasan dan bukti dampak; tidak ada jalan pintas Super Admin |
| Saldo awal ganda saat cutover | Cutover bertanggal; event lama ditandai `suppressed` bukan diproses ulang; saldo awal lewat jurnal manual ber-approval (keputusan #21) |
| Pemetaan akun salah dan tidak terdeteksi | Pemetaan tidak ditemukan menghasilkan kegagalan yang menyebut pemetaan mana yang kosong, bukan jurnal dengan akun default yang salah |
| Kebocoran skema basis data lewat pesan galat | Pesan galat disanitasi; stack trace hanya masuk log server |
| Memperluas cakupan ke AP/AR, pajak, atau konsolidasi secara diam-diam | Out-of-scope ditulis eksplisit; setiap ADR di luar kernel tetap `PROPOSED` tanpa izin bangun (keputusan #4 dan #6) |
| Jurnal manual dipakai menyembunyikan selisih | Semua jurnal manual wajib melewati Workflow Engine sebelum `posted`; tidak ada jalur skrip basis data |
| UI mendahului arah desain yang belum ada | Seluruh layar berstatus "draft without direction" sampai `DESIGN.md` ditulis pemilik produk (R-37, §4.13 keputusan #23) |

#### Completion gate

Epic 14 dinyatakan selesai bila seluruh butir berikut terbukti, masing-masing dengan bukti yang dapat diperiksa ulang:

1. `finance_schemas`, `finance_ledgers`, `finance_gl_accounts`, `finance_coa_versions`, `finance_posting_rules`, `finance_journals`, `finance_journal_lines`, `finance_fiscal_years`, `finance_fiscal_periods`, `finance_close_checklists`, dan `finance_open_items` ada di basis data dengan kendala yang dikontrak.
2. Kendala basis data menolak jurnal tidak seimbang, baris berisi debit dan kredit sekaligus, dan akun `automatic_only` pada jurnal manual — dibuktikan dengan percobaan yang gagal.
3. Jurnal berstatus `posted` menolak pembaruan dan penghapusan — dibuktikan dengan percobaan yang gagal.
4. Dokumen internal dapat menghasilkan jurnal lewat hook after-`Complete` Epic 11.
5. **`scm_accounting_ready_events` punya konsumen nyata** — event `inventory.goods_received` menghasilkan jurnal yang dapat ditelusuri kembali ke event asalnya.
6. **Return-to-Vendor dan Receipt-Reversal mengirim event**, dan `scm_receipt_reversals.reversal_event_id` terisi.
7. Percobaan ulang posting dengan kunci idempotensi yang sama tidak menghasilkan jurnal kedua — dibuktikan dengan menjalankan percobaan ulang dan menghitung jurnal.
8. Posting ke periode `closed` gagal, dan tidak ada baris jurnal yang terbentuk.
9. Pembukaan ulang periode tutup memerlukan dua orang berbeda dan menolak alasan kosong.
10. Posting ulang event yang sudah terpakai tidak menghasilkan jurnal kedua.
11. Koreksi jurnal menghasilkan jurnal balik tertaut, dan `reversal_id` terisi di kedua arah.
12. Penutupan tahun memindahkan saldo laba rugi ke laba ditahan tanpa menghapus posting historis dan tanpa menulis ulang periode yang sudah tutup.
13. Rekonsiliasi penanda mengubah penanda dari jurnal, bukan sebaliknya — dibuktikan dengan sengaja menyimpangkan sebuah penanda lalu menjalankan rekonsiliasi.
14. **Neraca Saldo dan Rincian Buku Besar dapat dihasilkan, diekspor CSV dan XLSX, dan menghormati Data Scope Epic 12.**
15. Setiap layar baru punya keadaan kosong, memuat, dan galat; tidak ada kontrol tanpa perilaku; tidak ada tautan ke halaman yang belum ada.
16. **`DESIGN.md` ada, ditulis pemilik produk.** Sebelum itu seluruh UI Epic 14 berstatus "draft without direction" dan Epic 14 belum deliverable produksi — persyaratan yang sama dengan §4.13.

#### Catatan implementasi terhadap keputusan roadmap

Empat catatan yang harus dibaca sebelum pekerjaan dimulai:

- **Epic 14 membuka izin bangun untuk kernel posting saja, dan hanya setelah pemilik produk menetapkan prioritasnya.** ADR-0015 sampai 0022 tetap `PROPOSED`; ADR-0023 tetap `ACCEPTED` dan mengikat. §4.14 tidak mengubah status ADR mana pun dan tidak menggeser satu angka pun di baseline roadmap. Yang berubah adalah bahwa kernel posting berhenti menjadi desain tanpa pemilik.
- **Kernel ini adalah prasyarat, bukan pelengkap Wave A6.** Enam kapabilitas sisanya tidak dapat dimulai dengan aman sebelum jurnal, pemetaan akun, dan periode fiskal ada. Karena itu urutannya bukan pilihan gaya, melainkan urutan ketergantungan yang sudah dinyatakan ADR-0017 ayat 1.
- **Pekerjaan pertama yang paling berisiko bukan generator jurnal, melainkan daftar akun template.** Sebelas tabel baru dapat dibangun mengikuti kontrak, tetapi daftar akun bawaan Indonesia memerlukan tinjauan akuntan dan itulah butir pada open item #1 dan #2. Menunda tinjauan itu berarti seluruh gelombang 14.2 sampai 14.5 dibangun di atas bagan akun yang belum disahkan.
- **`docs/plans/` masih untracked dan §4.14 belum masuk riwayat git.** Sesi perancangan ini menghasilkan dokumentasi, bukan backend, bukan migrasi, bukan commit. Verifikasi tampilan dan uji coba basis data dilaporkan terpisah; lihat "Basis iDempiere" di atas untuk proyek yang dirujuk.

---

### 4.15 EPIC 15 — Panel Admin: Pusat Konfigurasi Tunggal

#### Problem statement

Konfigurasi Abixell One hari ini tersebar di tiga tempat dengan tiga sejarah berbeda: halaman Administration (`/administration`, permission `config.manage`, Phase 0) yang menampung panel Modules, Feature Flags, Terminology, Reference Data, Numbering, Workflow, dan Shared Services dalam satu halaman; halaman Complaint Configuration (`/administration/complaints`, permission `complaint.configure`, Phase 1B) yang menjadi satu-satunya konfigurasi per modul dengan halaman sendiri; dan Admin Console (`/admin`, permission `admin.console.read`, Phase 11C/11F) yang bersifat baca dengan dua pengecualian tulis (assignment user-role dan nama tenant).

Pemilik produk menetapkan arah baru pada 2026-09-28: hanya boleh ada **satu menu pengaturan** — pusat administrasi, setup, konfigurasi, dan setting seluruh Abixell One, bernama **Panel Admin**. Admin Console yang sekarang menjadi dasbor detail: setiap tombol, angka, dan hasil di dalamnya merujuk ke informasi detail hingga ke konfigurasi terdalam. Klik menu Administration membuka satu halaman dasbor konfigurasi.

Arsitektur target ini sejalan dengan `docs/architecture/dual-admin-console.md` §3.2, yang sejak 2026-08-23 sudah memuat daftar wewenang Business Admin Console: user dan role, hierarchy organisasi, terminology dan branding, reference data dan numbering, template notifikasi, workflow definition, feature flag dan aktivasi modul, validasi konfigurasi tenant, dan eksplorasi audit. Panel Admin bukan ide baru; dia adalah bentuk UI dari kontrak yang sudah disetujui. Yang belum ada adalah struktur menu kategorinya.

#### Keputusan terkunci 2026-09-28 (disetujui pemilik produk dari pembahasan kategori)

##### Putaran 1 — Struktur kategori

1. **Delapan kategori konfigurasi, bukan sembilan.** Finance tidak menjadi kategori sendiri karena dia modul; konfigurasi finance masuk Module Config. Kategori: Module, Platform, Org, System, User & Akses, Workflow & Approval, Notification & Kanal, Document.
2. **Kategori adalah rumah, bukan jadwal wave.** Rumah konfigurasi sebuah modul disiapkan walau isinya belum dieksekusi (contoh: Finance sebelum Wave A6, HSE dan Project Delivery sebelum Wave A7). Tidak ada kategori "nanti"; perbedaannya hanya penanda status isian, bukan keberadaan rumah.
3. **Kategori 2–8 lintas modul; hanya Module Config yang per modul.** Itulah alasan pemisahan: Workflow, Notification, Document, dan kategori lainnya melayani semua modul sekaligus.
4. **Module Config berisi slot terpisah per modul — tidak ada penggabungan.** Asset, Service Operations, Project Delivery, dan HSE masing-masing slot sendiri; digabung dalam satu baris dilarang.
5. **Istilah Workforce berganti HRIS.** Label modul `workforce` di Panel Admin adalah HRIS. Penerapan (terminology override per tenant vs penggantian label platform) adalah keputusan implementasi yang dibahas saat wawancara desain — lihat open item #4.

##### Putaran 2 — Tiga belas slot Module Config

Sumber daftar: katalog modul nyata `MODULE_METADATA` (`apps/web/src/lib/capabilities.ts:165`), 13 kode modul.

| # | Kode modul | Label di Panel Admin | Isi konfigurasi | Status isian |
|---|---|---|---|---|
| 1 | `customer_complaint` | Customer Complaints | Kategori, SLA, eskalasi | Existing — ComplaintConfigPage |
| 2 | `survey_assessment` | Surveys & Assessments | Survey content (CFG-011), outcome policy (CFG-012) | API delivered, UI belum |
| 3 | `service_operations` | Service Operations | Vertical service packs, route/roster/workload policy | Wave A3 delivered; WP-OPS-01 (2026-10-11) menutup gerbang aktivasi: tulisan vertikal catering (`/catering/*`) wajib `service_pack_activations.is_active = true` untuk `pack_code = 'catering'`; bacaan tetap bebas supaya admin bisa inspeksi sebelum reaktivasi; pola yang sama berlaku untuk vertikal paket berikutnya |
| 4 | `customer_commercial` | Customers & Commercial | Sales pipeline, quotation & pricing policy, portal | Wave A1 delivered |
| 5 | `workforce` | HRIS | Payroll policy, BPJS, PPh21, shift, leave, overtime | Wave A4 delivered |
| 6 | `supply_chain` | Supply Chain | Valuation policy (FIFO/landed cost), reorder, supplier evaluation | Wave A5 delivered |
| 7 | `warehouse_management` | Warehouse Management | Topologi gudang, bin/location, batch quarantine | Wave A5 delivered |
| 8 | `procurement_management` | Procurement Management | RFQ/tender, kontrak pembelian, approval belanja | Wave A5 delivered |
| 9 | `asset` | Asset Management | Preventive maintenance schedule, meter, spare part, reliability | Wave A3 delivered |
| 10 | `finance` | Finance | Accounting policy, GL mapping, COA, fiscal period, posting/reversal | Belum dieksekusi (Wave A6) — slot tetap disiapkan |
| 11 | `hse` | Health, Safety & Environment | Investigation, JSA/HIRA, Permit to Work, inspection programme | Belum dieksekusi (Wave A7) — slot tetap disiapkan |
| 12 | `project_delivery` | Project Delivery | WBS/baseline, resource loading, earned value | Belum dieksekusi (Wave A7) — slot tetap disiapkan |
| 13 | `reporting_insight` | Reporting & Insights | Governed BI registry, report/view definition | Wave A2 delivered |

##### Putaran 3 — Isi kategori lintas modul

| Kategori | Isi | Sumber |
|---|---|---|
| Platform Config | Branding client-facing (CFG-013, ADR-0003), terminology (CFG-001), theme system native (Epic 13), extension hooks registry (Epic 11), numbering global (pattern builder Epic 8 #3–#7), slot Wave A8 (partner API, AI readiness, marketplace) | Epic 11, 13; PRD 07; ADR-0003 |
| Org Config | Tenant profile, Legal Entity (profil legal lengkap, lifecycle `draft → active → inactive → tombstone`), Organization Unit + hierarchy effective-dated, Department master, usulan perubahan struktur (draft → Super Admin publish/reject), scope `legal_entity` | Epic 5 §4.5 |
| System Config | Parameter berjenjang System → Client → Organization dengan tampilan nilai efektif + level asal (Epic 8 #16, pola `AD_SysConfig.ConfigurationLevel`), password & session policy (Epic 10), audit retention, reference data (CFG-002) | Epic 8, 10; ADR-0006 |
| User & Akses Config | User management + role assignment (Epic 4), role definition dari katalog permission (CFG-010), permission catalog, user security (reset password via admin, force logout) | Epic 4, 10; Phase 11F |
| Workflow & Approval Config | Definisi workflow metadata-driven + versioning (Epic 9), approval matrix (approver role, batas nominal, akumulasi, anti self-approval — Epic 1), SLA per step (CFG-004), monitor approval instance | Epic 1, 9; CFG-003/014 |
| Notification & Kanal Config | Kanal SMTP / Web Push / Telegram (Epic 12 — kanal dulu), template per event × kanal (CFG-006), parameter ambang & penerima default | Epic 12; CFG-006 |
| Document Config | Document type registry + `config_extra` per modul (Epic 8 #1), document codes sebagai kunci klasifikasi GL (Epic 8 #2), sequence & audit penomoran dengan reset bulanan per kode (Epic 8 #5/#11), counter document (Epic 8 #19, eksekusi Epic 11), export/import JSON (Epic 8 #21) | Epic 7, 8 |

##### Putaran 4 — Prinsip yang mengikat

1. **Konfigurasi adalah data terstruktur, bukan permukaan pemrograman** (CFG-R3). Panel Admin adalah authoring UI atas nilai finite; tanpa script, SQL, atau DSL bebas — konsisten dengan larangan `dual-admin-console.md` §3.3.
2. **Presedensi scope selalu tampak.** Tiap parameter berjenjang ditampilkan dengan nilai efektif + level asal (Organization → Client → System). Ini syarat UI, bukan opsi (ADR-0006, Epic 8 #16).
3. **Panel Admin tidak hardcode daftar modul.** Daftar dibaca dari registry modul; tiap modul mendeklarasikan konfigurasinya lewat kontrak registrasi — pola yang sama dengan registrasi tipe dokumen Epic 8 #22. Modul belum dibangun → slot tampil terkunci/kosong dengan alasan, bukan tidak ada.
4. **Server yang menentukan visibilitas slot terkunci.** Konsep `locked` + `lockedReason` sudah ada di payload menu (Epic 3 Wave 2, [servedNav.ts:76](apps/web/src/lib/servedNav.ts:76)); client tidak menebak.
5. **Admin Console menjadi dasbor detail.** Setiap tombol, angka, dan hasilnya merujuk ke informasi detail hingga konfigurasi terdalam — tautan mengarah ke Panel Admin, bukan duplikasi kontrol tulis.

#### Basis arsitektur dan bukti existing

| Fakta | Sumber | Relevansi |
|---|---|---|
| Daftar wewenang Business Admin Console | `docs/architecture/dual-admin-console.md` §3.2 (2026-08-23, APPROVED) | Panel Admin adalah bentuk UI dari kontrak ini |
| Larangan script/SQL/DSL bebas | `dual-admin-console.md` §3.3; CFG-R3 | Batas keras isi Panel Admin |
| Konfigurasi adalah data per client | `docs/prd/abixell-one/07-client-configuration.md` CFG-001…015 | Peta kebutuhan; CFG-010 dan CFG-015 masih PARTIAL |
| Presedensi scope + partial unique index | `docs/adr/0006-configuration-scope-precedence-0c.md` | Pola penyimpanan dan resolusi konfigurasi berjenjang |
| Menu served dari server + `locked`/`lockedReason` | Epic 3 Wave 2; `apps/web/src/lib/servedNav.ts` | Mekanisme render tree dan slot terkunci |
| Guard kedalaman menu 4 level | Trigger `config_guard_menu_depth` (migrasi 1787400000000): Grup > Modul > Sub-menu > Halaman | Panel Admin = Modul, kategori = Sub-menu, halaman = Halaman |
| Katalog modul nyata (13 kode) | `MODULE_METADATA` [capabilities.ts:165](apps/web/src/lib/capabilities.ts:165) | Sumber daftar slot Module Config |
| Registry tipe/kode dokumen lewat kontrak registrasi | Epic 8 §4.8 keputusan #22 | Pola registrasi konfigurasi per modul |

#### Yang belum diputuskan (bahan wawancara desain)

1. **Model permission Panel Admin.** Satu `config.manage` untuk seluruh kategori, atau permission per kategori (`config.module.manage`, `config.platform.manage`, dst.), atau per modul (`<module>.configure` seperti pola `complaint.configure`)?
2. **Nasib route `/administration` dan `/admin`.** Panel Admin menggantikan `/administration`; Admin Console tetap `/admin` sebagai dasbor detail baca? Apakah nama menu di tree berubah ("Administration" → "Panel Admin")?
3. **Bentuk halaman Module Config.** Satu halaman kategori berisi daftar modul (klik modul → halaman konfigurasinya; modul tanpa isian render "belum tersedia"), atau setiap modul langsung jadi halaman di tree? Rekomendasi awal pembahasan: bentuk pertama — menghindari puluhan halaman stub di tree.
4. **Penerapan istilah HRIS.** Terminology override per tenant (CFG-001, nol perubahan kode) atau penggantian label platform (`MODULE_METADATA` + seed menu + parity test — perubahan backend)?
5. **Relasi dengan gelombang eksekusi Epics 2–14.** Panel Admin dibangun setelah Epics 2–5 ada (registry, menu, user, org) sebagai permukaan konsolidasi, atau bertahap per kategori mengikuti epic yang selesai?
6. **Dashboard Panel Admin.** Apa yang tampil di halaman pertama: ringkasan status konfigurasi per kategori (terisi/belum), validasi konfigurasi (dual-admin-console §3.2 "tenant configuration validation"), atau keduanya?

#### Out-of-scope Epic 15

- Membangun konfigurasi yang epic-nya belum dieksekusi — Panel Admin hanya menyiapkan rumahnya (slot), isi mengikuti epic pemilik.
- Melewati guardrail: parameter yang menyentuh keamanan/audit tetap dipaksa ke level konfigurasi lebih tinggi (Epic 8 prinsip).
- Platform Architect / Builder Console — ranah `dual-admin-console.md` §4, bukan Panel Admin.
- Eksekusi implementasi apa pun sebelum wawancara desain dan kontrak §4.15 final.

#### Catatan implementasi terhadap keputusan roadmap

- Bagian ini mengunci struktur kategori dan slot sebagai **bahan wawancara**; enam keputusan putaran 1–4 sudah disetujui pemilik produk pada 2026-09-28, enam item "yang belum diputuskan" menunggu wawancara desain.
- Tidak ada migration, perubahan backend, atau commit implementasi yang diberi persetujuan oleh bagian ini.
- Rekonsiliasi dengan kontrak CFG-010/CFG-015 (masih PARTIAL di PRD) dilakukan saat wawancara desain.

---

## 5. Koreksi terhadap Riset

Klaim riset di `D:\RESEARCH AREA\research\idempiere` yang **tidak sesuai** dengan source code. Dokumen riset perlu dikoreksi agar tidak menyesatkan pekerjaan berikutnya.

| # | Riset menulis | Fakta terverifikasi | Dampak |
|---|---|---|---|
| 1 | `AD_Role.Amt_Approval` | Kolom sebenarnya `AmtApproval` — tanpa underscore (`I_AD_Role.java:210`) | Nama kolom salah |
| 2 | "`Amt_Approval`: batas nominal approval workflow" — satu kalimat | Ada tiga kolom berpasangan (`AmtApproval`, `AmtApprovalAccum`, `DaysApprovalAccum`) plus `C_Currency_ID` dan konversi kurs (`MWFActivity.java:771-798`) | Riset menggambarkan model approval jauh lebih sederhana dari kenyataan; implementasi yang mengikuti riset akan langsung salah |
| 3 | `AD_Role_OrgAccess` punya kolom `IsReadWrite` | Kolom sebenarnya **`IsReadOnly`** — polaritas terbalik. Kolom lengkap: `AD_Client_ID`, `AD_Org_ID`, `AD_Role_ID`, `IsActive`, `IsReadOnly` | Salah polaritas flag |
| 4 | Riset §11 menyebut role, window/process/form/table/column/record access — **tidak menyinggung SoD sama sekali** | iDempiere punya `AD_Role.IsCanApproveOwnDoc` (`I_AD_Role.java:342`) yang diperiksa di `MWFActivity.java:766` | **Temuan terbesar.** Kebutuhan SoD yang diminta user ternyata sudah menjadi fitur bawaan iDempiere, dengan pola role flag + approval limit + eskalasi |

Catatan tambahan yang memperkaya tapi tidak mengoreksi:

- `Doc_User_ID` bukan kolom per tabel, melainkan method di interface `DocAction` (`DocAction.java:244`). Riset tidak membahas ini.
- `AD_PasswordRule` memiliki aturan berbasis kamus (`IsDictMatchBackwards`, `PathDictionary`), deteksi sequence (`AlphabeticalSequence`, `NumericalSequence`, `QWERTYSequence`), dan `RepeatCharacterRegex` — melampaui "kompleksitas + masa berlaku" yang disebut riset.
- `AD_SysConfig` punya `ConfigurationLevel`, yang tidak disebut riset — inilah yang membuat parameter setup berjenjang, bukan sekadar key-value.

---

## 6. Open Decisions

| # | Keputusan | Epic | Status |
|---|---|---|---|
| 1 | Format workflow engine: BPMN 2.0 (Flowable/Camunda) atau engine sendiri? | 9 | Belum |
| 2 | Kedalaman Postgres RLS sebagai lapisan kedua setelah `addAccessSQL`-setara | 1 | Belum |
| 3 | Apakah `addAccessSQL`-setara diimplementasikan sebagai query builder terpusat atau filter per-repository? | 1 | Belum |
| 4 | Cakupan whitelabel per klien — memengaruhi batas Core vs Client Configuration | 5, 13 | **Dijawab Epic 13 (2026-09-25):** whitelabel per tenant dibatasi pada **subset brand** (warna brand, logo, nama aplikasi), bukan palet penuh. Token brand wajib runtime-swappable lewat `package_theme_configs`; sisanya literal build-time. Lihat §4.13 keputusan #2 dan #4. |
| 5 | Entitas transaksi mana yang masuk document engine lebih dulu | 7 | Belum |
| 6 | Preseden `AD_SysConfig.ConfigurationLevel` (System / Client / Organization) — berapa jenjang di Abixell One? | 8 | Belum |
| 7 | Urutan pengerjaan Epic | semua | **Diputuskan 2026-09-23: wawancara dimulai dari Epic 2 (Application Dictionary & Metadata Engine).** Alasan: Epic 2 memblokir Epic 3, 4, 7, 11, dan 13. Menggali fondasi metadata lebih dulu mencegah keputusan di Epic lain yang harus dibongkar ulang. |
| 8 | Apakah paket tema pihak ketiga dijadikan package workspace | 13 | **Diputuskan 2026-09-23: ya. Direvisi 2026-09-25: tidak** — design system dibangun native di repo, tidak ada kode pihak ketiga (§4.13 keputusan #6) |
| 9 | Susunan menu final untuk user eksternal dan aturan customer scope | Service Operation / 4 | **Dipindahkan ke session wawancara Customer Scope terpisah pada 2026-09-24.** Epic 4 mempertahankan backend tetapi mengunci opsi UI sampai enam aturan di §4.4 selesai. |
| 10 | Apakah `belum terdaftar` diberi tenggat, atau dilaporkan selamanya sebagai pekerjaan tertunda | 3 | Belum. Lihat §4.3 item terbuka nomor 2 |
| 11 | Cara penyajian menu dari server ke klien: ikut `/me` atau endpoint tersendiri | 3 | Belum. Harus diputuskan lewat pengukuran, bukan asumsi. Lihat §4.3 item terbuka nomor 1 |
| 12 | Lifecycle role yang masih memiliki assignment: deactivate, restore, dan syarat delete | 4 | Belum. Delete hanya jika tidak punya user sudah terkunci; detail deactivate/restore diputuskan sebelum implementasi. |
| 13 | Atomic atau partial success untuk batch role+scope assignment | 4 | **Selesai 2026-09-28 — atomic all-or-nothing.** Item terbuka 4 Epic 4 dikunci: satu pasangan gagal membatalkan seluruh batch, satu governed transaction, satu hasil, satu audit batch. Implementasi sudah sesuai tanpa perubahan kode. |
| 14 | Batas hari backdate: perubahan hierarchy Organization Unit dan Backdate Transaction | 5, 7, 8 | Sebagian dijawab Epic 14 (2026-09-25): dokumen tidak dapat di-backdate ke periode yang sudah `closed`; koreksi memakai periode terbuka berikutnya. **Angka batas hari tetap parameter policy** dan belum diputuskan. Lihat §4.14 keputusan #13. |
| 15 | Definisi periode laporan tertutup dan prosedur koreksi saat hierarchy di-backdate | 5, 7, 12 | **Dijawab Epic 14 (2026-09-25):** periode tertutup = `finance_fiscal_periods.status = 'closed'`, dicapai hanya setelah daftar periksa penutupan lulus; koreksi memakai jurnal balik (Reverse Correct/Accrual) ke periode terbuka berikutnya bila periode asli tutup. Prosedur buka ulang = maker-checker + alasan + bukti dampak. Lihat §4.14 keputusan #10, #11, #13. |
| 16 | Kebijakan file: storage, scan, versioning, expiry, retention, dan akses dokumen legal, identity file slot, maupun lampiran backdate | 5, 6, 7 | Belum. Epic 5 hanya menyiapkan slot metadata; identity file slot terkait Epic 6; dibahas pada session dokumen/file terpisah. |
| 17 | Model User, Employee, Role, dan Business Partner beserta batas Epic 4, 5, dan 10 | 4, 5, 6, 10 | **Resolved di Epic 6 §4.6:** Business Partner canonical Individual/Organization; Employee role + profile; Department bukan scope; satu primary dan secondary placement terbatas, effective-dated. Customer Scope tetap pending karena external identity boundary sudah settled tetapi service portal belum dirinci. |
| 18 | Model permission Panel Admin, nasib route `/administration` dan `/admin`, bentuk halaman Module Config, penerapan istilah HRIS, urutan eksekusi, dan isi dashboard | 15 | **Dibuka Epic 15 (2026-09-28)** — struktur 8 kategori dan 13 slot modul terkunci; enam butir ini menunggu wawancara desain. Lihat §4.15 "Yang belum diputuskan". |

---

## 7. Research Traceability Matrix

Setiap konsep yang dipakai dokumen ini, sumber verifikasinya, dan wujud di Abixell One.

| Konsep | Sumber iDempiere | Baris | Wujud Abixell One | Penanda |
|---|---|---|---|---|
| Document action constants | `org.compiere.process.DocAction` | 36–64 | belum ada | Adopt |
| Document status constants | `org.compiere.process.DocAction` | 67–85 | belum ada | Adopt |
| Document user | `org.compiere.process.DocAction` | 244 | konvensi baru | Adopt |
| Multi-role login | `org.compiere.util.Login` | 89, 103, 177, 213 | `RoleSiteSelectionPage` | Modernize |
| Role aktif di sesi | `org.compiere.model.I_AD_Session` | kolom penuh | tabel `sessions` baru | Adopt |
| Approval amount | `org.compiere.model.I_AD_Role` | 210 | `roles.amt_approval` | Adopt |
| Approval accumulation | `org.compiere.model.I_AD_Role` | 223, 281, 236 | `roles.amt_approval_accum`, `days_approval_accum`, `currency_code` | Adopt |
| Self-approval block | `org.compiere.model.I_AD_Role` | 342 | `roles.is_can_approve_own_doc` | Adopt |
| Approval resolution | `org.compiere.wf.MWFActivity` | 722–802 | `ApprovalAuthority` service | Adopt |
| Self-approval check | `org.compiere.wf.MWFActivity` | 766 | `ApprovalAuthority` | Adopt |
| Currency conversion | `org.compiere.wf.MWFActivity` | 771–779 | `ApprovalAuthority` | Adopt |
| Accumulation query | `org.compiere.wf.MWFActivity` | 854+ | `ApprovalAuthority` | Modernize |
| Supervisor escalation | `org.compiere.wf.MWFActivity` | 807–824 | `users.supervisor_user_id`, `organization_units.supervisor_user_id` | Adopt |
| Cycle guard | `org.compiere.wf.MWFActivity` | 752–758 | `ApprovalAuthority` | Adopt |
| Window access | `org.compiere.model.I_AD_Window_Access` | 66, 123, 136 | `role_window_access` | Adopt |
| Process access | `org.compiere.model.I_AD_Process_Access` | 91, 123, 136 | `role_process_access` | Adopt |
| Form access | `org.compiere.model.I_AD_Form_Access` | 91, 123, 136 | digabung ke process access | Modernize |
| Workflow access | `org.compiere.model.I_AD_Workflow_Access` | 66, 123, 136 | Epic 9 | Adopt |
| Task access | `org.compiere.model.I_AD_Task_Access` | 66, 123, 136 | `Reject` — tak relevan di stack web | Reject |
| Table access | `org.compiere.model.I_AD_Table_Access` | 148–167 | `role_table_access` | Adopt |
| Column access | `org.compiere.model.I_AD_Column_Access` | 151–170 | `role_column_access` | Adopt |
| Org access | `org.compiere.model.I_AD_Role_OrgAccess` | kolom penuh | `user_role_assignments.is_read_only` | Adopt |
| Record access | `org.compiere.model.I_AD_Record_Access` | — | `role_record_access` | Adopt |
| Private access | `org.compiere.model.I_AD_Private_Access` | — | Epic 4 | Adopt |
| Query filter injection | `org.compiere.model.MRole` | 2076–2244 | Epic 1 §4.1B | Modernize |
| SQL mode constants | `org.compiere.model.MRole` | 284–288 | — | Adopt |
| Application Dictionary | `org.compiere.model.I_AD_Table`…`I_AD_Field` | — | Epic 2 | Modernize |
| Field logic | `org.compiere.model.I_AD_Field` | 342, 643, 700 | Epic 2 | Adopt |
| Module descriptor | `org.compiere.model.I_AD_EntityType` | 130–222 | `modules` diperluas | Modernize |
| Parameter setup | `org.compiere.model.I_AD_SysConfig` | 84–183 | Epic 8 | Adopt |
| Menu tree | `org.compiere.model.I_AD_Menu`, `I_AD_Tree`, `I_AD_TreeNodeMM` | kolom penuh | `app_menus`, `app_menu_tree` (§4.3) | Adopt |
| Menu action types | `org.compiere.model.X_AD_Menu` | `ACTION_*` | `app_menus.action` | Modernize |
| Menu tanpa tabel akses | `I_AD_Menu_Access` **tidak ada** (404); `MMenu.java` tanpa penyaring | — | prinsip §4.3 | **Reject** |
| Doc type | `org.compiere.model.I_C_DocType` | 209–449 | Epic 8 | Adopt |
| Numbering sequence | `org.compiere.model.I_AD_Sequence` | 104–321 | Epic 8 | Adopt |
| Counter document | `org.compiere.model.I_C_DocTypeCounter` | 104–175 | Epic 8 | Adopt |
| Model validator | `org.compiere.model.ModelValidator` | 33–203 | `hook_handlers` type `validator` (§4.11) | Adopt |
| Event topics | `org.adempiere.base.event.IEventTopics` | 24–59 | trigger point registry (§4.11) | Adopt |
| Event handler base | `org.adempiere.base.event.AbstractEventHandler` | — | dispatcher event (§4.11) | Adopt |
| Process | `org.compiere.process.SvrProcess` | — | `hook_handlers` type `process` + `scheduled_jobs` (§4.11) | Modernize |
| Callout | `org.compiere.model.Callout`, `CalloutEngine` | — | `hook_handlers` type `callout` (§4.11, UI Epic 13) | Modernize |
| Validator veto (return non-null = rollback) | `ModelValidator.modelChange`/`docValidate` (javadoc) | — | `HookVetoError` → rollback (§4.11 keputusan #8) | Adopt |
| `TIMING_*` siklus dokumen (16 nilai) | `ModelValidator` (`06-plugin-system.md:253–258`) | — | dipangkas ke 4 aksi Epic 7 (§4.11 keputusan #5) | Modernize |
| `postEvent` async vs `sendEvent` sync | `org.adempiere.base.event.IEventManager` | — | post-commit event vs in-transaction validator (§4.11 keputusan #8, #11) | Adopt |
| Registrasi `Classname` string bebas | `AD_Client.Validator`, `AD_Process.Classname` | — | **ditolak** → allowlist + `tenant_safe` (§4.11 keputusan #2, #3) | **Reject** |
| Script ModelValidator JSR-223 | `AD_Table_ScriptValidator` (`17-event-system.md` §4.3) | — | **ditolak** — tidak ada script apapun (§4.11 keputusan #21) | **Reject** |
| Scheduler tanpa distributed lock | `AdempiereServerMgr` (`16-scheduler.md` §8) | — | lease `scheduled_jobs` yang sudah ada (§4.11 keputusan #15) | Modernize |
| Jadwal dua mode (interval + cron4j), parameter job (`AD_Scheduler_Para`) | `MSchedule.java`, `Scheduler.java:517–633` | — | dua mode + parameter tervalidasi schema (§4.12 keputusan #8, Model target) | Adopt/Modernize |
| Identitas run supervisor → createdBy → updatedBy | `AdempiereServer.java:211–222` | — | **ditolak** → satu user sistem `scheduler` (§4.12 keputusan #19) | **Reject** |
| Scheduler job engine | `org.compiere.model.I_AD_Scheduler` | — | catch-up boot + retry idempoten + lease ada (§4.12 keputusan #16–#18) | Modernize |
| Reporting engine print native | `org.compiere.print.ReportEngine` | — | **ditolak** — laporan tetap kode + BI + artifact (§4.12 keputusan #1, #8) | **Reject** |
| Jasper integration | `org.adempiere.report.jasper.ReportStarter` | — | **ditolak** — tanpa mesin template eksternal (§4.12 keputusan #1) | **Reject** |
| Print format | `org.compiere.model.I_AD_PrintFormat`, `I_AD_PrintFormatItem` | — | **ditolak** — mesin print-format tidak dibangun (§4.12 keputusan #1, #8) | **Reject** |
| Export format CSV/XLS/XLSX/PDF | `ReportEngine.java:599–1000` | — | CSV + XLSX Wave 1, PDF Wave 2 (§4.12 keputusan #11) | Modernize |
| Archive `AD_Archive` tanpa retensi | `ArchiveEngine.java`, `X_AD_Archive.java` | — | konsep artifact diadopsi ke `documents` + retensi 180 hari (§4.12 keputusan #12, #13) | Adopt/Modernize |
| Email attachment + hapus file setelah kirim | `Scheduler.java:238–252`, `:386` | — | **ditolak** → tautan ke artifact tersimpan (§4.12 keputusan #14) | **Reject** |
| SMTP per client | `MClient.java:1160–1225` | — | **ditolak** → SMTP global via `MailTransport` adapter (§4.12 keputusan #2) | Reject/Modernize |
| `AD_UserMail` jejak kiriman `IsDelivered` | `MClient.java:827–876` | — | jejak per kiriman → `notification_deliveries` retry-aware (§4.12 keputusan #6) | Adopt/Modernize |
| `AD_User.NotificationType` | `MUser.java:765–781` | — | saklar preferensi global Wave 1 (§4.12 keputusan #4) | Adopt |
| `AD_Note` in-app notice | `MNote.java`, `X_AD_Note.java` | — | inbox terpadu web + mobile (§4.12 keputusan #4) | Adopt |
| Alert + `AD_AlertRule` SQL user | `AlertProcessor.java:130–255`, `MAlertRule.java:70–99` | — | **ditolak** — hook Epic 11 + scheduler + kanal (§4.12 keputusan #15) | **Reject** |
| Tema runtime via `ZK_THEME` System Configurator | `14-ui.md:274–280` | — | branding tenant via runtime config, subset brand lewat custom property (§4.13 keputusan #2, #4) | Adopt |
| Bundel tema terpisah (breeze, iceblue_c) | `04-source-code.md:162–166` | — | satu paket tema milik Abixell; tanpa bundel per klien (§4.13 keputusan #2) | Modernize |
| Variabel LESS `_zkvariables.less` | `14-ui.md:268–272` | — | variabel CSS subset brand, format kanal RGB (§4.13 keputusan #2) | Adopt |
| Tema per Client/Tenant | `14-ui.md:282–285` — "kemungkinan", tak terverifikasi | — | branding tenant disetujui; mekanisme resolusi per sesi dibuat sendiri (§4.13 keputusan #4) | Needs interview |
| `ITheme` / `ThemeManager`, `AD_Theme`, dark mode, palet per klien, branding login | **tidak ada di riset** | — | keputusan dibuat dari celah kode sendiri (§4.13 keputusan #3, #4, #17) | — |
| Rendering 100% data-driven dari `AD_Field` | `14-ui.md:141–158` | — | generator terbatas baca-saja + form admin; transaksi manual (§4.13 keputusan #12; §4.2 baris 438) | Modernize |
| Peta `AD_Reference` → editor ZK | `08-application-dictionary.md:124–139` | — | tabel pemetaan tipe → komponen React, daftar tertutup (§4.13 Open item #4) | Modernize |
| Dua presentasi dari satu deskriptor (`switchRowPresentation`) | `14-ui.md:231–233` | — | form + daftar dari deskriptor yang sama (§4.13 keputusan #12) | Adopt |
| `DisplayLogic`/`MandatoryLogic`/`ReadOnlyLogic` DSL string | `08-application-dictionary.md:189–204` | — | **ditolak** → `app_field_rules` terstruktur (§4.13 keputusan #13) | **Reject** |
| Mandatory ditegakkan ulang di persistensi (`FillMandatoryException`) | `08-application-dictionary.md:179–182` | — | backend menegakkan ulang aturan klien (§4.13 Mekanisme generator, langkah 6) | Adopt |
| Layout berkoordinat (`XPosition`, `ColumnSpan`, `SeqNo`, grid 4 kolom) | `08-application-dictionary.md:80–83`, `14-ui.md:139–152` | — | **ditolak** → urutan + grup saja, kolom lewat CSS grid (§4.13 keputusan #14) | Modernize |
| `AD_Form` non-generic + kehilangan "gratisan" AD | `08-application-dictionary.md:85–89`, `06-plugin-system.md:471–488` | — | pembatasan diadopsi: tidak semua layar layak digenerate (§4.13 keputusan #1) | Adopt |
| Aksesibilitas WebUI ZK | **tidak ada di riset** (`15-reporting.md:289` hanya Jasper export) | — | keputusan #8–#11 dari celah kode sendiri (§4.13 Catatan implementasi) | — |
| Arsitektur server-side component tree + sticky session (`IDEMPIERE-5049`) | `14-ui.md:388–396` | — | **ditolak** — klien-render, satu renderer React (§4.13 Out-of-scope) | **Reject** |
| Keluhan AD: DSL tak type-safe, render lambat, kurva belajar curam | `08-application-dictionary.md:319–325`, `20-limitations.md:38–45` | — | alasan menolak DSL string & membatasi tata letak (§4.13 keputusan #13, #14) | Adopt (pelajaran) |
| Fakta akuntansi immutable (`Fact_Acct`) | `org.compiere.acct.Fact`, `MFactAcct` (`13-database.md:117,125,384`, `09-document-engine.md:208–212`) | kolom penuh | `finance_journals` + `finance_journal_lines` (§4.14 keputusan #8) | Adopt |
| Document Engine `Doc_*` + `DocumentEngine.processIt` | `09-document-engine.md:208–212` | — | **dipisah**: mesin posting Epic 14 menerima dokumen, tidak memiliki siklus hidup dokumen (ADR-0023) | Modernize |
| Debit = kredit, aritmetika desimal eksak | `09-document-engine.md:207–212` | — | kendala basis data pada `finance_journal_lines` (§4.14 Prinsip; ADR-0016 ayat 2) | Adopt |
| Akun + dimensi (`C_ValidCombination`; Org/Product/BPartner) | `13-database.md:114–117` | kolom penuh | akun + dimensi jsonb/kolom pada baris jurnal; dimensi tidak dikodekan ke nomor akun (§4.14) | Adopt |
| Resolusi akun default (`M_Product_Category_Acct`) | `13-database.md:125` | — | `finance_posting_rules` diisi admin tenant (§4.14 keputusan #9) | Modernize |
| Nomor akun ≤10 digit, `C_ElementValue` | ADR-0015 (dari AD `C_ElementValue`) | — | `finance_gl_accounts.account_no`; template bawaan Indonesia 9 kelompok (§4.14 keputusan #7) | Adopt/Modernize |
| `C_AcctSchema` + `MAcctSchema` | `09-document-engine.md:212,290,305` | — | `finance_schemas` + `finance_ledgers`; satu ledger primer aktif per entitas legal (§4.14 keputusan #4) | Modernize (dibatasi) |
| Multi-ledger paralel/sekunder/pajak | `09-document-engine.md:305` | — | **ditunda** — butuh persetujuan pemilik produk terpisah (§4.14 Out-of-scope) | Reject (sementara) |
| `C_Period` + `C_PeriodControl` kontrol periode | `13-database.md:121`, `09-document-engine.md:167` | — | `finance_fiscal_years` + `finance_fiscal_periods`; posting ke periode tutup gagal tertutup (§4.14 keputusan #13) | Adopt |
| Jurnal balik tertaut, dokumen tak pernah dihapus | `09-document-engine.md:218` | — | `reversal_id` dua arah + Reverse Correct/Accrual (§4.14 keputusan #11) | Adopt |
| Reverse Correct / Reverse Accrual (tanggal sama vs berjalan) | ADR-0016 (dari perilaku `Doc_*`) | — | dua jenis koreksi terkunci (§4.14 keputusan #11) | Adopt |
| `Posted` = `N`/`Y`/`E` + jendela "Unposted Documents" | `09-document-engine.md:215,297` | — | penanda `posted` = indikator cepat; jurnal = kebenaran; rekonsiliasi memperbaiki dari jurnal (§4.14 keputusan #2) | Modernize |
| `ACCT_FACTS_VALIDATE`, `DOC_BEFORE_POST`/`DOC_AFTER_POST` | `17-event-system.md:713–758` | — | validasi sebelum tulis dalam satu transaksi; tanpa topic OSGi (§4.14 Basis iDempiere) | Modernize |
| `AutoPost` sinkron menahan UI | `09-document-engine.md:215,296` | — | posting asinkron, UI tidak menunggu (§4.14 Modernize) | Modernize |
| Flag `Processing` sebagai kunci optimistik | `09-document-engine.md:279,306` | — | penguncian baris + token versi (aman multi-instance) | Modernize |
| `M_Product_Category_Acct`-style control account | `13-database.md:125` | — | penanda `control`/`open_item`/`automatic_only` disiapkan Wave 1, dipakai AP/AR Wave A6 (§4.14 keputusan #20) | Adopt |
| Rekonsiliasi bank iDempiere (`C_BankStatement`) | **tidak ada di riset ini** | — | alat periksa rekonsiliasi kas Epic 14 berbeda: bandingkan Finance Core vs jurnal (§4.14 keputusan #19); Bank rec penuh = Wave A6 | — |
| e-Faktur, PPh, PPn Indonesia | **tidak ada di riset** | — | Wave A6, ADR-0019, menunggu sign-off spesialis pajak (§4.14 Out-of-scope) | — |
| `scm_accounting_ready_events` sebagai batas SCM→Finance | ADR-0023 (`ACCEPTED`) | — | 10 event type; Epic 14 isi 2 emitter bolong (§4.14 keputusan #15) | Adopt |
| Mesin jurnal/reversal/kontrol periode lokal per modul | ADR-0023 ayat 3 (`09-document-engine.md` dilarang) | — | **ditolak** — bayangan ledger dilarang (§4.14 Out-of-scope) | **Reject** |
| Password rule | `org.compiere.model.I_AD_PasswordRule` | kolom penuh | Epic 10 | Adopt |
| Password history | `org.compiere.model.I_AD_Password_History` | — | Epic 10 | Adopt |
| User locking | `org.compiere.model.I_AD_User` | 496 | Epic 10 | Adopt |
| User supervisor | `org.compiere.model.I_AD_User` | 825 | `users.supervisor_user_id` | Adopt |
| Org supervisor | `org.compiere.model.I_AD_OrgInfo` | 286 | `organization_units.supervisor_user_id` | Adopt |
| User preferences | `org.compiere.model.I_AD_Preference` | — | Epic 4 | Adopt |
| User-role assignment | `org.compiere.model.I_AD_User_Roles` | — | `user_role_assignments` | Adopt |
| Menu bukan security | Wiki *Securing iDempiere* | verbatim | prinsip §1 | Adopt |
| Multi-tenancy shared schema | `AD_Client_ID` di seluruh tabel | — | `tenant_id` | Adopt |
| Persistent object layer | `org.compiere.model.PO` | — | domain entity + repository | Modernize |
| OSGi module system | `org.osgi` / Equinox | — | — | **Reject** |
| Dual UI | Swing + ZK | — | — | **Reject** |
| Schema sync via UI | "Synchronize Column" | — | migration-as-code | **Reject** |
| Metadata → UI generation | `GridWindow`/`GridField` | — | metadata sebagai kontrak API | **Reject** |
| Workflow proprietary | `AD_Workflow` | — | Epic 9, belum diputuskan | Needs interview |

**Referensi eksternal yang dipakai:**

- `https://wiki.idempiere.org/en/Securing_iDempiere`
- `https://idempiere.dev/learn/user-roles-and-security/`
- `https://github.com/idempiere/idempiere` (branch `master`, diakses 2026-09-23)

---

## 8. Batasan

- Tidak ada stage/commit/push sampai diminta.
- Tidak mengubah konfigurasi lokal user maupun data production.
- Suite vitest tidak dijalankan pada `abixell_one_dev`.
- Urutan pengerjaan Epic tidak ditetapkan di dokumen ini; ditanyakan setelah user selesai review.

---

---

## 9. Celah Design System Abixell — Bahan Epic 13

**Diperiksa:** 2026-09-23, direvisi 2026-09-25 · **Sifat:** analisis internal; tidak ada berkas di luar repo yang dibaca untuk §9 versi ini

### 9.1 Keputusan

> **Design system Epic 13 dibangun native di atas komponen Abixell yang sudah ada. Tidak ada paket pihak ketiga yang diambil.**

Diputuskan pemilik produk, 2026-09-25. **Revisi:** keputusan 2026-09-23 yang mengadopsi sebuah paket tema pihak ketiga sebagai package workspace dibatalkan. Tidak boleh ada nama paket, kode, dokumentasi, struktur ekspor, atau berkas tema pihak ketiga di dalam repo maupun di dalam dokumen ini.

Alasan revisi: paket itu membawa sistem token yang bersaing, 28 dependency runtime, dan persoalan provenance tanpa berkas lisensi. Yang benar-benar dibutuhkan dari penilaian itu hanyalah **analisis celah** — apa yang kurang di Abixell — dan analisis celah tidak memerlukan kode pihak lain.

**Catatan provenance.** Karena tidak ada kode pihak ketiga yang disalin, tidak ada kewajiban lisensi, atribusi, atau third-party notice yang muncul dari keputusan ini. Aplikasi tetap memegang **tiga dependency runtime**: `react`, `react-dom`, `react-router-dom`.

Empat kebutuhan yang dicatat dari analisis §9.4, semuanya diimplementasikan di dalam repo:

| # | Kebutuhan | Titik implementasi |
|---|---|---|
| 1 | `Button` dengan matriks varian/ukuran dan `forwardRef` | `apps/web/src/shell/components/ui.tsx:22-45` |
| 2 | `Card` yang dapat didekomposisi (header/isi/footer) | `apps/web/src/shell/components/ui.tsx:49-58` |
| 3 | `Modal` dengan skala ukuran lebih dari `md`/`lg` | `apps/web/src/shell/components/OverlayDialog.tsx` |
| 4 | `Field` dengan perangkaian galat ke input | `apps/web/src/shell/components/ui.tsx:193-209` |

Kebutuhan #4 bukan soal kosmetik — §9.3 mencatatnya sebagai celah aksesibilitas nyata.

**Alasan pokok penolakan paket pihak ketiga** — dicatat agar tidak hilang:

**1. Tidak dapat dipakai sebagai paket.** Tiga cacat independen yang terverifikasi saat pemeriksaan: barrel ekspor menunjuk direktori yang salah eja (`primatives` vs `primitives`) sehingga impor gagal keras; konfigurasi build tidak pernah menghasilkan `dist/` yang ditunjuk `main`/`types`; dan konfigurasi lint mengimpor paket yang tidak terpasang. Pemeriksaan tipe berhenti dengan puluhan galat. Memperbaiki semua itu untuk memakai empat komponen tidak sebanding dengan menulis empat komponen sendiri.

**2. Masalah provenance.** Tidak ada berkas lisensi di repo, dan `git remote` menunjuk repositori pihak lain. Menyalin kode tanpa lisensi adalah masalah provenance, bukan preferensi teknis. Karena keputusan 2026-09-25 memilih tidak mengambil kodenya sama sekali, persoalan ini hilang dari Epic 13.

**3. Membawa sistem token yang bersaing.** Lihat §9.2.

**4. Menambah 28 dependensi runtime** ke aplikasi yang sengaja hanya memegang 3.

### 9.2 Konflik token — dua sistem yang tidak berbagi satu kelas pun

| | Abixell One | Paket pihak ketiga |
|---|---|---|
| Token layer | **Tidak ada.** `apps/web/src/index.css` 3 baris, hanya tiga directive Tailwind | Custom properties lengkap + blok `.dark` |
| Tailwind theme | `apps/web/tailwind.config.js:4-7` → `theme: { extend: {} }` | seluruh warna, radius, keyframes |
| Bahasa desain | Literal slate hardcoded: `bg-slate-900`, `border-slate-200` | Kelas semantik: `bg-primary`, `border-input` |
| Dark mode | **0 kemunculan `dark:`** di seluruh `apps/web/src` | Blok `.dark` penuh |
| Runtime deps | **3** (react, react-dom, react-router-dom) | **28** |
| Overlap deps | — | **Nol** |

Abixell menyatakan bahasanya secara eksplisit di `apps/web/src/shell/components/ui.tsx:8-9`: *"Every component reuses the existing Tailwind design language (slate palette, subtle borders, `text-sm` scale) rather than introducing a new visual system."*

Kedua pihak mendefinisikan `Button`, `Card`, `Badge`, `Alert`, `Input`, `Select`, `Table` dengan **nama sama, props berbeda, visual berbeda**. Menggabungkan keduanya menghasilkan tabrakan simbol senyap dan UI dua palet. Inilah alasan teknis utama mengapa jalur native dipilih: satu bahasa, satu token, tiga dependency.

### 9.3 Temuan yang membalik asumsi: Abixell sudah lebih maju di aksesibilitas

| | Abixell One | Paket pihak ketiga |
|---|---|---|
| Kepadatan atribut a11y | **77** | **18** |
| Modal | `OverlayDialog.tsx` — focus trap dengan wrap-around, focus capture/restore, `requestAnimationFrame` initial focus, body scroll lock, `aria-modal`/`aria-busy`, guard `pending` yang memblokir Escape saat mutasi berjalan, touch target 44px | pembungkus tipis, tanpa jaminan focus-restore, tanpa guard pending |
| Tabel di mobile | `ui.tsx:262-269` — `DataTable` merender kartu bertumpuk di bawah 640px | — |
| Reduced motion | 0 kemunculan `prefers-reduced-motion` | 0 kemunculan |

Modal Abixell sudah lebih kuat dari padanan mana pun yang diperiksa. Yang benar-benar kurang di Abixell bukan perilaku dialog, melainkan **perangkaian galat pada `Field`** dan **matriks ukuran pada `Button`**.

### 9.4 Empat celah yang menjadi kebutuhan Epic 13

| # | Celah di Abixell | Titik | Kebutuhan |
|---|---|---|---|
| 1 | `Button` punya 3 varian, tanpa prop `size`, tanpa `forwardRef` | `ui.tsx:22-45` | Matriks varian/ukuran yang bersih, `forwardRef` untuk fokus programatik |
| 2 | `Card` hanya header-less dan padding | `ui.tsx:49-58` | Dekomposisi header/isi/footer — **ditolak** untuk Wave 1 (§4.13 keputusan #5) |
| 3 | `OverlayDialog` hanya punya `md`/`lg` | `OverlayDialog.tsx` | Skala ukuran `sm…2xl/full` |
| 4 | `Field` membungkus child dalam `<label>`, **tanpa** wiring error/`aria-describedby` | `ui.tsx:193-209` | **Celah a11y nyata.** `useId` + `error`/`hint` + `aria-describedby`/`aria-invalid` |

Semuanya diimplementasikan sebagai perubahan pada berkas yang sudah ada. Tidak ada berkas baru untuk keempatnya; hanya `design-tokens.ts` yang merupakan berkas baru di Wave 13.1.

### 9.5 Prinsip yang mengikat pekerjaan tema

| Prinsip | Konsekuensi |
|---|---|
| Satu bahasa warna | Nama semantik (`bg-surface`, `text-muted`), `slate` hanya di definisi token (§4.13 keputusan #7) |
| Satu sumber token | `:root` dan `[data-theme="dark"]` satu-satunya tempat nilai warna brand ditulis |
| Token runtime-swappable hanya pada subset brand | Branding tenant berubah tanpa rebuild; sisa palet tetap literal build-time (#2, #4) |
| Tiga dependency runtime dipertahankan | Setiap dependency baru butuh keputusan wawancara tersendiri |
| Tidak ada kode pihak ketiga | Implementasi native; tidak ada lisensi, atribusi, atau notice yang muncul (§9.1) |

### 9.6 Dampak ke Epic 13

**Diputuskan 2026-09-25:** tidak ada paket pihak ketiga yang diambil; design system dibangun native di repo (§9.1, **menggantikan** keputusan 2026-09-23).

Pertanyaan yang menggantung di sini sudah dijawab §4.13:

1. **Dark mode masuk kandidat Wave 2**, dan token disiapkan sejak Wave 1 supaya tidak perlu dibongkar ulang. Ditolak sebagai pekerjaan Wave 1 karena menerapkan tema kedua ke 1445 kemunculan `slate-` sebelum token layer terbukti terlalu berisiko. (§4.13 keputusan #3, gelombang 13.7.)
2. **Penamaan langsung, dengan format kanal RGB** (`--color-primary: 15 23 42`) supaya modifier alpha Tailwind (`bg-primary/50`) tetap jalan lewat `rgb(var(--color-primary) / <alpha-value>)`. (§4.13 keputusan #2, `Mekanisme — token layer`.)
3. **Ya — satu tenant boleh punya palet sendiri, tetapi hanya pada subset brand.** Karena itu token wajib runtime-swappable untuk subset itu, sementara sisanya (mis. seluruh 1445 `slate-`) tetap literal build-time. Palet penuh per tenant ditolak. (§4.13 keputusan #2, #4, tabel `package_theme_configs`.)
4. **Dinaikkan terukur.** `forwardRef` + prop `size` pada `Button`; dekomposisi `Card` **ditolak** karena mengubah setiap pemakaian `Card` yang ada sementara nilainya baru terasa setelah theme layer selesai. (§4.13 keputusan #5.)

**Catatan antislop.** Modul antislop belum diarahkan untuk pekerjaan ini. Karena tidak ada `DESIGN.md` dan tidak ada arahan desain dari user, setiap pekerjaan UI yang keluar dari dokumen ini diperlakukan sebagai **draft without direction** (dial ENERGY/RHYTHM/MOTION = 1) dan bukan deliverable produksi. **Tidak ada berkas arah desain dari pihak luar** — `DESIGN.md` tetap wajib ditulis pemilik produk (§4.13 keputusan #23).

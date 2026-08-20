# 01 — Tenant, Legal Entity & Organization Model

Phase 0 — Enterprise Core Foundation | Abixell One
Status: DRAFT — FOR FOUNDER REVIEW

---

## Purpose

Dokumen ini mendefinisikan struktur organisasi generik yang menjadi tulang punggung seluruh data dan akses di Abixell One, menggantikan struktur GS-spesifik (`Company → Branch → Project → Site`) sesuai Founder Decision 2.

Struktur ini menentukan bagaimana data disekat (data scope), bagaimana akses ditentukan (security scope), dan bagaimana laporan lintas level disusun. Kesalahan di sini akan terasa di setiap modul yang dibangun setelahnya — sehingga dirancang seumum mungkin sejak awal.

---

## Hierarchy

```
Tenant
  └── Legal Entity  (1 atau lebih per Tenant)
        └── Organization Unit  (rekursif — bisa bertingkat)
              └── Project  (opsional, bisa langsung di bawah Org Unit)
                    └── Site / Location  (1 atau lebih per Project)
```

Catatan penting: **Project bersifat opsional**. Tidak semua Organization Unit menjalankan sesuatu dalam bentuk "project" — sebuah divisi HO administratif misalnya tidak perlu Project untuk punya Site (kantor pusatnya sendiri). Site/Location dapat menempel langsung ke Organization Unit bila tidak ada konteks project.

---

## Entity Definition

### Tenant
Boundary implementasi untuk satu klien. Satu Tenant = satu deployment dedicated (sesuai Founder Decision 1). Tenant menyimpan konfigurasi tertinggi: branding, modul aktif, domain, terminologi, dan seluruh data klien tersebut berada di bawah satu Tenant — baik dalam skema database shared-with-discriminator maupun dalam deployment fisik terpisah.

### Legal Entity
Badan hukum/perusahaan di bawah Tenant. Satu Tenant bisa punya lebih dari satu Legal Entity (holding dengan beberapa anak perusahaan). Legal Entity adalah unit yang relevan secara hukum dan finansial — nomor pajak, alamat resmi, mata uang pelaporan, entitas yang muncul di invoice dan dokumen legal.

### Organization Unit
Struktur internal yang fleksibel: Head Office, Branch, Division, Department, Business Unit, Area, Region, atau fungsi lain sesuai kebutuhan klien. Bersifat rekursif (Organization Unit bisa punya Organization Unit anak) sehingga dapat merepresentasikan struktur organisasi datar maupun berlapis-lapis tanpa mengubah model data.

### Project
Kontrak, engagement, atau operation yang dikelola sebagai business scope tersendiri — punya start/end date, customer, contract value, dan tim sendiri. Relevan untuk klien berbasis kontrak (GS, konstruksi, tambang kontraktor) tapi tidak wajib untuk klien yang beroperasi tanpa model project (misal perkantoran dengan operasi berkelanjutan).

### Site / Location
Lokasi fisik atau operasional tempat aktivitas benar-benar terjadi: camp, mine site, kantor, gudang, pabrik, dapur (kitchen), gedung, workshop, atau area lain. Site adalah level tempat sebagian besar transaksi lapangan (checklist, inspeksi, komplain, absensi) tercatat.

---

## Configurability

Seluruh label level (nama "Organization Unit", nama "Site") harus dapat diganti terminologinya per Tenant tanpa mengubah struktur data — misalnya klien tambang menyebut Site sebagai "Pit" atau "Camp", klien perkantoran menyebut sebagai "Building" atau "Floor". Ini ditangani oleh Configuration & Metadata Engine (lihat dokumen 05), bukan dengan membuat tabel/kolom baru per klien.

Kedalaman hierarchy Organization Unit tidak dibatasi secara hardcode — klien kecil bisa punya satu level (langsung HO), klien besar bisa punya lima level (HO → Regional → Branch → Division → Team).

---

## Contoh Lintas Industri

| Level | Klien General Services | Klien Tambang Kontraktor | Klien Perkantoran |
|---|---|---|---|
| Tenant | PT Adrina Jaya Abadi | PT Kontraktor Tambang X | PT Layanan Gedung Y |
| Legal Entity | PT Adrina Jaya Abadi | PT Kontraktor Tambang X | PT Layanan Gedung Y |
| Organization Unit | Divisi Catering, Divisi Housekeeping | Divisi Operasional, Divisi HSE | Divisi Facility |
| Project | Kontrak Wilmar, Kontrak Petrosea | Kontrak Site A, Kontrak Site B | Kontrak Gedung Menara Z |
| Site/Location | Camp Wilmar, Camp Petrosea | Pit 1, Workshop, Fuel Station | Lantai 1–20, Basement, Rooftop |

Contoh ini menunjukkan struktur yang sama persis dapat merepresentasikan tiga industri berbeda hanya lewat penamaan dan kedalaman — tanpa perubahan skema.

---

## Dampak ke Data Scope & Security

Setiap record transaksi (komplain, survei, purchase request, dst.) wajib menyimpan referensi ke Tenant dan minimal satu level di bawahnya (biasanya Organization Unit, Project, atau Site) sebagai **data scope**. RBAC (dokumen 02) menggunakan kombinasi Role + Organization Unit/Project/Site scope untuk menentukan data apa yang boleh dilihat/diubah seorang pengguna — misalnya Supervisor hanya melihat data Site tempatnya bertugas, sementara Regional Manager melihat seluruh Site di bawah Organization Unit-nya.

Tenant selalu menjadi discriminator tertinggi dan wajib ada di setiap query — ini mencegah kebocoran data lintas klien pada level database, sejalan dengan prinsip multi-tenant-ready meski deployment bersifat dedicated per klien.

---

## Yang Belum Diputuskan (menunggu data klien pilot)

- Apakah Legal Entity wajib diisi untuk klien single-company kecil, atau boleh diskip (auto-generate satu Legal Entity default)?
- Berapa kedalaman maksimum Organization Unit yang perlu didukung di UI (rekursi teknis tidak terbatas, tapi navigasi UI perlu batas praktis)?

Pertanyaan ini diteruskan ke `11-Founder-Review.md`.

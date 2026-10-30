Field Requirements (Data yang Harus Dicatat)
Ini bagian penting karena menentukan kualitas informasi yang dihasilkan sistem.
Saya mau seluruh transaksi memiliki struktur field yang konsisten.

A. Standard Transaction Fields
Setiap transaksi minimal memiliki:
Field	Type	Keterangan
Transaction ID	UUID	Primary identifier
Transaction Number	String	Nomor transaksi
Tenant ID	UUID	Identitas organisasi
Client ID	UUID	Identitas client
Site ID	UUID	Lokasi
Transaction Date	Date	Tanggal transaksi
Status	Enum	Status transaksi
Created By	UUID	Pembuat
Created At	Timestamp	Waktu pembuatan
Updated By	UUID	Pengubah
Updated At	Timestamp	Waktu perubahan
Approved By	UUID	Approver
Approved At	Timestamp	Waktu persetujuan
Remarks	Text	Catatan
Attachments	Array	Dokumen pendukung


Gunakan UUID sebagai internal identifier dan human-readable transaction number untuk kebutuhan operasional.
B. Meal Order Fields
Field	Type
Order Number	String
Client	Reference
Site	Reference
Meal Date	Date
Meal Type	Enum
Menu	Reference
Requested Quantity	Integer
Confirmed Quantity	Integer
Special Dietary Requirement	Reference
Cut-off Time	Timestamp
Requested By	User
Approved By	User
Order Status	Enum


C. Production Fields
Field	Type
Production Number	String
Kitchen	Reference
Meal Order	Reference
Menu	Reference
Production Date	Date
Planned Quantity	Integer
Actual Quantity	Integer
Production Start	Timestamp
Production End	Timestamp
Ingredients Used	Relation
Food Temperature	Decimal
Quality Status	Enum
Supervisor	User
Production Remarks	Text


D. Distribution Fields
Field	Type
Delivery Number	String
Origin Kitchen	Reference
Destination	Reference
Meal Type	Enum
Dispatch Quantity	Integer
Received Quantity	Integer
Dispatch Time	Timestamp
Received Time	Timestamp
Driver	Reference
Receiver	User
Delivery Temperature	Decimal
Delivery Condition	Enum
Evidence	Attachment


E. Serving Fields
Field	Type
Serving Number	String
Service Point	Reference
Meal Date	Date
Meal Type	Enum
Opening Time	Timestamp
Closing Time	Timestamp
Received Quantity	Integer
Served Quantity	Integer
Returned Quantity	Integer
Remaining Quantity	Integer
Wasted Quantity	Integer
Serving Supervisor	User


F. Quality Inspection Fields
Field	Type
Inspection Number	String
Inspection Type	Enum
Client	Reference
Site	Reference
Kitchen	Reference
Inspection Date	Timestamp
Inspection Checklist	Relation
Inspection Result	Pass / Fail
Finding	Text
Corrective Action	Text
Inspector	User
Evidence	Attachment


Rekomendasi: Hindari membuat semua checklist sebagai hardcoded fields. Buat configurable inspection template sehingga setiap client dapat mempunyai standar inspeksi berbeda.

-----------------------------------------------------------------------

Reporting & Dashboard
Level 1 — Catering Services Dashboard
Untuk Tenant.

Informasi:
- Total Clients.
- Total Active Sites.
- Total Transactions.
- Platform Usage.
- Active Users.
- System Health.
- Tenant Activity.


Level 2 — Catering Management Dashboard - Project/Site
Untuk manajemen Project/Site Catering Provider.

KPI utama:
KPI	Description
Total Meal Orders	Jumlah pesanan
Total Meals Produced	Total produksi
Total Meals Served	Total penyajian
Production Achievement	Actual vs Plan
Delivery Performance	Ketepatan distribusi
Food Waste	Persentase makanan terbuang
Food Cost	Biaya makanan
Complaint Rate	Rasio keluhan
Client Satisfaction	Tingkat kepuasan
SLA Achievement	Pencapaian SLA


Level 3 — Client Dashboard 
Untuk perusahaan pengguna jasa catering.

Fokusnya bukan mengelola dapur, tetapi mengawasi performa layanan.

Informasi:
- Meal Request vs Actual Served.
- Daily Meal Consumption.
- Food Quality.
- Delivery Performance.
- Complaint Status.
- SLA Achievement.
- Monthly Catering Cost.
- Catering Performance Score.
Client harus dapat memonitor performa provider tanpa melihat data internal provider yang bersifat confidential.
Level 4 — Site Operational Dashboard
Untuk Supervisor dan petugas lapangan.

Informasi:
- Today's Meal Schedule.
- Meal Order.
- Production Status.
- Delivery Status.
- Meal Serving Progress.
- Food Temperature.
- Inspection Checklist.
- Outstanding Complaint.


Reporting yang Saya mau
Jangan hanya menyediakan laporan harian dan bulanan.

Buat report berdasarkan kebutuhan keputusan manajemen.
No.	Report	Frequency
01	Daily Catering Operation Report	Daily
02	Meal Order vs Actual Report	Daily
03	Meal Production Report	Daily
04	Meal Distribution Report	Daily
05	Meal Serving Report	Daily
06	Food Waste Report	Daily/Monthly
07	Food Inventory Report	Daily
08	Food Cost Analysis	Monthly
09	Food Quality Inspection Report	Daily/Monthly
10	Kitchen Hygiene Report	Daily/Monthly
11	Customer Satisfaction Report	Monthly
12	Complaint & Resolution Report	Monthly
13	SLA Performance Report	Monthly
14	Client Performance Report	Monthly
15	Catering Financial Report	Monthly
16	Supplier Performance Report	Monthly
17	Contract Utilization Report	Monthly
18	Overall Catering Performance Report	Monthly


Beberapa KPI yang wajib dihitung
1. Production Achievement

Actual Production / Planned Production × 100%

2. Meal Fulfillment Rate

Actual Served / Confirmed Meal Order × 100%

3. Delivery Accuracy

Quantity Received / Quantity Dispatched × 100%

4. Food Waste Percentage

Food Waste Quantity / Total Food Produced × 100%

5. Complaint Rate

Number of Complaints / Total Meals Served × 1.000

6. SLA Achievement

Number of SLA-Compliant Services / Total Services × 100%

7. Food Cost per Meal

Total Food Ingredient Cost / Total Meals Served

Pastikan setiap KPI memiliki definisi, sumber transaksi, periode perhitungan, dan aturan penanganan data yang belum lengkap.


----------------------------------------------------------------------------------------


Performance Evaluation
Mengukur kinerja Catering Provider berdasarkan data aktual.

Parameter:
- SLA compliance.
- Food quality score.
- Delivery punctuality.
- Complaint rate.
- Food waste percentage.
- Inventory variance.
- Cost per meal.
- Client satisfaction score.
Hasilnya dapat digunakan sebagai dasar vendor performance evaluation.

----------------------------------------------------------------------------------------


Quality & Food Safety Monitoring
Modul untuk menjaga kualitas dan keamanan pangan.

Aktivitas:
- Food quality inspection.
- Temperature monitoring.
- Kitchen hygiene inspection.
- Food sample monitoring.
- Equipment sanitation.
- Personal hygiene inspection.
- Pest control monitoring.
- Food safety checklist.
Sebaiknya mengadopsi prinsip HACCP sebagai referensi pengendalian keamanan pangan.

Contoh parameter:
Parameter	Requirement
Food Temperature	Sesuai standar yang ditetapkan
Food Appearance	Pass / Fail
Food Taste	Pass / Fail
Food Freshness	Pass / Fail
Kitchen Hygiene	Pass / Fail
Food Sample	Available / Not Available


Nilai batas temperatur jangan ditentukan secara sembarangan. Buat configurable berdasarkan standar keamanan pangan yang berlaku dan jenis makanan.


Food Distribution & Delivery
Mengawasi distribusi makanan ke service point.

Contoh:

Kitchen Central → Mess A → Mess B → Office C. (jika menggunakan central kitchen)
Kitchen Site → Mess A → Mess B → Office C (jika menggunakan kitchen site)
Setiap distribusi harus memiliki:
- Delivery reference.
- Destination.
- Meal type.
- Quantity dispatched.
- Quantity received.
- Delivery time.
- Receiver.
- Temperature.
- Delivery condition.
- Supporting evidence.
Dengan demikian, sistem bisa mendeteksi selisih antara jumlah makanan yang dikirim dan diterima.

----------------------------------------------------------------------------------------


Meal Serving & Consumption Monitoring
Ini merupakan salah satu modul paling penting.

Sistem harus mampu membedakan:
1. Meal Ordered.
2. Meal Produced.
3. Meal Dispatched.
4. Meal Received.
5. Meal Served.
6. Meal Consumed (jika dapat diukur).
7. Meal Returned.
8. Meal Wasted.
Contoh:
Activity	Quantity
Ordered	1.200
Produced	1.220
Dispatched	1.210
Received	1.205
Served	1.180
Returned	25
Wasted	15


Jangan menyamakan Served dengan Consumed.

Jumlah makanan yang disajikan belum tentu sama dengan jumlah makanan yang benar-benar dikonsumsi.

Jika ingin mengukur konsumsi aktual, perlu mekanisme tambahan seperti meal attendance, tray tracking, atau pengukuran sisa makanan.
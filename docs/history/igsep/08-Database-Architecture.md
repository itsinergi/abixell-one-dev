# Phase 8 — Enterprise Database & Information Architecture

Project

Integrated General Services Enterprise Platform (IGSEP)

Version

1.0

Status

Mandatory

---

# Purpose

Dokumen ini mendefinisikan seluruh arsitektur data platform.

Fokus utama bukan membuat tabel.

Fokus utama adalah membangun Enterprise Information Architecture.

Database harus mampu berkembang minimal 10 tahun tanpa redesign besar.

---

# Claude Role

Claude bertindak sebagai:

Enterprise Data Architect

Database Architect

Information Architect

Solution Architect

Enterprise Analyst

---

# Primary Objective

Merancang struktur data enterprise.

Bukan hanya ERD.

Tetapi seluruh lifecycle data perusahaan.

---

# Architecture Principles

Seluruh desain harus mengikuti prinsip berikut.

Single Source of Truth

Master Data First

Normalized

Scalable

Auditable

Historical

Event Ready

API Ready

AI Ready

Cloud Ready

Multi Company Ready

Multi Project Ready

---

# Enterprise Data Domains

Claude harus mengelompokkan seluruh data perusahaan menjadi domain berikut.

Commercial

Customer

Contract

Projects

Sites

Employees

Organization

Industrial Catering

Housekeeping

Camp

Facilities

Inventory

Warehouse

Assets

Procurement

Finance Interface

Tax Interface

Reporting

Administration

Security

Audit

Documents

Notifications

Integration

Analytics

Setiap domain harus memiliki:

Purpose

Owner

Dependencies

Master Data

Transaction Data

History

Relationships

---

# Master Data Management

Claude harus mengidentifikasi seluruh Master Data.

Contoh.

Company

Business Unit

Branch

Department

Division

Project

Site

Customer

Vendor

Employee

Job Position

Menu

Food

Ingredients

Items

Warehouse

Storage

Assets

Buildings

Rooms

Vehicles

Equipment

Roles

Permissions

Currencies

Units

Tax

Location

Country

Province

City

Village

Checklist

Inspection Template

SOP

Risk Matrix

Approval Matrix

Document Type

Notification Type

Status

Priority

Seluruh Master Data harus memiliki governance.

---

# Reference Data

Claude harus menentukan seluruh Reference Data.

Status

Type

Category

Code

Classification

Reason

Severity

Priority

Risk Level

Approval Status

Workflow Status

Employment Status

Project Status

Asset Status

Inventory Status

Complaint Status

Incident Status

Inspection Status

Document Status

Semua Reference Data harus mudah dikembangkan.

---

# Transaction Data

Identifikasi seluruh transaksi.

Lead

Proposal

Quotation

Contract

Attendance

Meal Production

Meal Distribution

Cleaning

Inspection

Complaint

Corrective Action

Purchase Request

Purchase Order

Goods Receipt

Inventory Issue

Inventory Transfer

Asset Maintenance

Room Occupancy

Laundry

Transportation

Invoice

Billing

Payment Interface

Tax Interface

Semua transaksi harus memiliki:

Header

Detail

History

Audit

Attachment

Approval

---

# Historical Data

Claude harus menentukan strategi penyimpanan historical.

Attendance History

Asset History

Inventory History

Approval History

Inspection History

Complaint History

Meal History

Customer History

Employee History

Room History

Vehicle History

Document Revision

Workflow History

Semua perubahan harus dapat ditelusuri.

---

# Canonical Data Model

Claude harus mendefinisikan model data utama platform.

Tidak boleh ada data ganda.

Seluruh modul menggunakan definisi data yang sama.

Contoh.

Customer hanya satu.

Employee hanya satu.

Vendor hanya satu.

Item hanya satu.

Asset hanya satu.

Site hanya satu.

Project hanya satu.

---

# Domain Relationships

Claude harus membuat hubungan antar domain.

Customer

↓

Contract

↓

Project

↓

Site

↓

Operation

↓

Inventory

↓

Finance

↓

Reporting

Seluruh relasi harus dijelaskan.

---

# Naming Convention

Claude harus membuat standar.

Table

Column

Primary Key

Foreign Key

Index

Constraint

Sequence

View

Materialized View

Stored Procedure (jika diperlukan)

Function

Trigger (hindari jika memungkinkan)

---

# Primary Key Strategy

Analisis.

UUID

BIGINT

Hybrid

Berikan rekomendasi.

Jangan hanya memilih.

---

# Multi Company Strategy

Database harus mendukung.

Single Company

Multi Company

Multi Business Unit

Multi Branch

Multi Project

Multi Site

Multi Customer

Claude harus menentukan strategi isolasi data.

---

# Partition Strategy

Analisis kebutuhan partition.

Attendance

Logs

Notifications

Audit

History

Reports

Photo

Documents

Berikan rekomendasi.

---

# Index Strategy

Claude harus menentukan.

Primary Index

Unique Index

Composite Index

Search Index

GIN

Full Text Search

Partial Index

---

# Search Strategy

Global Search

Customer Search

Employee Search

Contract Search

Asset Search

Inventory Search

Document Search

Full Text Search

Barcode Ready

QR Ready

---

# Attachment Strategy

Photo

Video

Document

PDF

Excel

Word

Checklist

Inspection

Complaint

Invoice

Drawing

Storage

Retention

Archive

Compression

Encryption

---

# Audit Strategy

Seluruh tabel transaksi wajib memiliki.

Created By

Created At

Updated By

Updated At

Deleted By

Deleted At

Revision

Source

Device

Synchronization Status

---

# Soft Delete Strategy

Claude harus menentukan.

Soft Delete

Hard Delete

Archive

Restore

Purge

---

# Data Retention

Tentukan rekomendasi.

Attendance

Logs

Audit

Documents

Photo

Invoice

Contracts

Customer

Project

Complaint

Inspection

History

---

# Backup Strategy

Full Backup

Incremental

Point In Time Recovery

Archive

Replication

Retention

---

# Data Migration

Claude harus menyusun strategi.

Excel

Legacy System

Manual Data

CSV

API

Import Wizard

Validation

Duplicate Detection

Rollback

---

# Database Security

Encryption

PII Protection

Field Masking

Access Control

Audit

Password

Secrets

Token

Key Management

---

# AI Ready Data Layer

Walaupun AI belum digunakan.

Seluruh data harus siap.

Knowledge Base

Embedding Ready

Vector Ready

Prompt Ready

Semantic Search Ready

LLM Ready

---

# Deliverables

Claude WAJIB menghasilkan.

Enterprise Data Architecture

Logical Data Model

Physical Data Model

Canonical Data Model

Master Data Catalog

Reference Data Catalog

Transaction Catalog

Data Dictionary

ERD

Relationship Matrix

CRUD Matrix

Retention Matrix

Migration Strategy

Backup Strategy

Security Strategy

Naming Convention

Data Governance

Future AI Data Layer

---

# Founder Review

Sebelum lanjut.

Claude harus menjelaskan.

Apakah seluruh data perusahaan sudah terwakili.

Apakah ada Master Data yang belum ditemukan.

Apakah ada relasi yang masih ambigu.

Apakah terdapat duplikasi.

Apakah database siap berkembang.

Founder memberikan keputusan.

Approve.

Revisi.

Tambahan.

---

# Exit Criteria

Phase dianggap selesai apabila.

Seluruh domain data telah dipetakan.

Seluruh Master Data telah diidentifikasi.

Seluruh Transaction Data telah dipetakan.

ERD telah selesai.

Data Dictionary telah selesai.

Database Governance telah selesai.

Status

READY FOR PHASE 9
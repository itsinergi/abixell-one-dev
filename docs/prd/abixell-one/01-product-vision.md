# 01 — Product Vision

**PRD v1.0** · Canonical

## Vision

Abixell One is a **whitelabel, multi-tenant-ready Integrated Enterprise Management System**, deployed **dedicated per client**, that lets a services organisation run its commercial, operational, workforce, supply, asset, financial, and quality processes in one configurable ecosystem.

Internal architecture principle:

> **Build Once. Configure Per Client. Deploy Exclusively.**

Client-facing positioning:

> **Designed Around Your Business.**

## Who it serves

Primary: services organisations operating across **Single Site → Multi Site → Multi Company → Multi Project** structures — originating from the General Services sector (industrial catering, housekeeping, managed workforce, camp management, facilities management) but deliberately **not limited to it**.

Every business engine must be reusable across industries. A capability that can only work for one industry belongs in a Vertical Service Pack or a Client Extension, never in Business Core.

## Product lineage

Abixell One is the successor to **IGSEP** (Integrated General Services Enterprise Platform), a vertical platform designed for a single General Services company. The business knowledge was retained; the architecture changed from one-company vertical to whitelabel reusable core. See [`docs/history/igsep/README.md`](../../history/igsep/README.md).

## Ten-year posture

The platform must absorb new business domains and new industries **without architectural redesign**: new domains arrive as modules over an unchanged Platform Core; new industries arrive as configuration plus optional Vertical Service Packs.

## What success looks like

1. A new client is onboarded by **configuration**, not by forking source.
2. A new business domain is added **without modifying** Platform Core.
3. A new industry is served by **packs + configuration**, not a new product.
4. No client-facing surface ever reveals that the system is a reusable product.

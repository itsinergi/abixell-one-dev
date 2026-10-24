# ADR-0019: Indonesia Taxation Policy and Scope

- **Status:** APPROVED - Founder final document review 2026-10-24; tax-specialist gate WAIVED by Founder sign-off on record (regulatory risk accepted by Founder). Implementation authorized. Note: tax rates remain rule data configured per Legal Entity, never hardcoded constants.
- **Date:** 2026-09-02
- **Source:** Founder Indonesia Taxation Policy decisions and Pre-Wave A6 interview confirmation that specialist sign-off precedes active rules

## Context

`FIN-ADV-006` authorizes taxation within Finance Advanced but does not define jurisdiction, taxpayer status, tax types, governance, rounding, or integration depth. The Founder selected an Indonesia-first approach that remains extensible to other jurisdictions and requires a controlled baseline rather than hardcoded historical rates.

Tax treatment is regulatory policy. Local SAP KBU and research material may demonstrate patterns, but historical rates and client configuration are not authoritative current law. A qualified Indonesian tax specialist must validate the requirements and rule catalog before runtime authorization.

## Decision

### 1. Adopt an Indonesia-first, extensible tax boundary

Wave A6 will target a **Controlled Indonesia Tax Baseline** under `FIN-ADV-006`. Jurisdiction-specific rules are isolated behind versioned tax policy contracts so another country can be added later without changing the Accounting Kernel.

The tax registration profile is configured per Legal Entity. During setup, the client selects and evidences whether that Legal Entity is **PKP** or **Non-PKP**:

- **PKP** activates the complete specialist-approved baseline applicable to the entity, including PPN and applicable withholding taxes.
- **Non-PKP** activates only taxes legally applicable to that entity and must not generate PKP-only output tax behavior.

Status changes are effective-dated, approval-gated, audited, and do not rewrite historical transactions.

### 2. Define included and excluded taxes

The controlled Wave A6 baseline includes:

- configurable, effective-dated **PPN** rules; and
- configurable withholding rules for **PPh 22**, **PPh 23**, and **PPh 26**.

**PPh Badan** is excluded from Wave A6 and requires separate Founder authorization. **PPh 21** calculation remains authoritative in Workforce; Finance receives only approved summarized accounting postings and must not implement a competing payroll-tax engine.

Tax applicability, object, counterparty status, registration evidence, rate, basis, exemption, document treatment, account mapping, and rounding are explicit rule data. No rate is inferred silently or embedded as an unversioned application constant.

### 3. Govern tax rules as immutable policy versions

Tax rules are scoped per Legal Entity, effective-dated, versioned, maker-checker approval-gated, and immutable after first use. A posting stores the exact rule version and calculation evidence used at the transaction date.

All calculations use exact decimal arithmetic. Rounding mode and precision are configurable per tax rule within a specialist-approved set. Any allocation residual is absorbed deterministically according to the rule and recorded in calculation evidence.

### 4. Remain export-ready, not directly integrated

The core may produce governed export-ready tax data and documents. Live Coretax, DJP, e-Faktur, credential exchange, submission, status polling, signing, or regulatory API integration is excluded and requires a Client Extension or separately authorized phase.

Historical SAP KBU rates, tax codes, and mappings are research evidence only and must not become active defaults.

### 5. Preserve roadmap governance

`FIN-ADV-006` remains within the existing 5-point Finance grouping. This proposal creates no new roadmap unit, weight, or denominator change. Expanded tax scope, PPh Badan, direct regulatory integration, or another jurisdiction requires separate classification and authorization.

## Rejected alternatives

- Hardcoding one current PPN or withholding rate without effective dating.
- Treating all Indonesian companies as PKP.
- Copying historical SAP KBU tax rates or client tax codes as defaults.
- Reimplementing PPh 21 calculation in Finance.
- Including PPh Badan without separate authorization.
- Building live Coretax, DJP, or e-Faktur integration into the base Wave A6 scope.
- Allowing tax rules already used by postings to be edited in place.
- Using binary floating-point arithmetic for tax calculation or allocation.

## Consequences

- PKP and Non-PKP entities receive different, explicit, historically reproducible tax behavior.
- Tax postings can be audited back to the exact approved rule version and rounding policy.
- The Accounting Kernel remains jurisdiction-neutral while Indonesia receives a governed baseline.
- Regulatory exports can be designed without committing the product to one external API.
- Tax specialist review is a blocking prerequisite, not a post-implementation advisory.

## Runtime authorization gate

The Founder interview confirms that specialist sign-off is required before any active tax rules, but this document remains proposed until final Founder review. Even after document approval, Wave A6 tax implementation is blocked until a qualified Indonesian tax specialist reviews and signs off the PKP/Non-PKP model, included tax types, applicability logic, terminology, effective-date policy, rounding set, document evidence, account mapping, and export boundary. Runtime authorization must also require exact-decimal golden tests, historical rule-version tests, PKP/Non-PKP negative tests, tenant and Legal Entity isolation, RBAC, Data Scope, audit, and correction/reversal evidence.

## Related documents

- [Finance Module PRD](../prd/abixell-one/modules/finance.md)
- [ADR-0015: Finance COA and Accounting Schema Governance](0015-finance-coa-and-accounting-schema-governance.md)
- [ADR-0016: Finance Posting, Reversal, and Fiscal Close](0016-finance-posting-reversal-and-fiscal-close.md)
- [ADR-0017: Finance AP/AR Open-Item Settlement](0017-finance-ap-ar-open-item-settlement.md)
- [ADR-0018: Finance Bank Reconciliation Readiness Gate](0018-finance-bank-reconciliation-readiness-gate.md)
- [ADR-0022: Finance Consolidation and Financial Statements](0022-finance-consolidation-and-financial-statements.md)

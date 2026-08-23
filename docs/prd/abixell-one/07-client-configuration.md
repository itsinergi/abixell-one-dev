# 07 — Client Configuration Requirements (`CFG-*`)

**PRD v1.0** · Canonical · Classification: **Client Configuration**

Configuration is **data**, changeable per client without touching Product Core. Configuration is *finite and structured* — it is not a programming surface (see non-goals in [03](03-product-scope.md)).

Future Builder-produced tenant configuration remains typed, tenant-scoped, versioned, validated, permission-controlled, approved where required, append-only audited, and rollback-capable. Persistence-affecting structural metadata is not ordinary runtime configuration: it follows the release-bound B3 path in the [Platform Builder risk model](../../architecture/platform-builder-risk-model.md), including engineering/security/data review, central migration discipline, backup/recovery, and deployment approval.

| ID | Requirement | Status |
|---|---|---|
| **CFG-001** | **Terminology.** Labels for business concepts shall be overridable per tenant so each client sees their own vocabulary. | DELIVERED |
| **CFG-002** | **Reference data.** Categories, severities, priorities, and similar catalogs shall be maintainable per tenant. | DELIVERED |
| **CFG-003** | **Workflow definition.** Lifecycle steps, transitions, conditions, assignment rules, and escalation rules shall be configured per tenant and versioned. | DELIVERED |
| **CFG-004** | **SLA settings.** Time targets shall be configurable per workflow step. | DELIVERED |
| **CFG-005** | **Numbering.** Business document numbering patterns shall be configurable per tenant and document type. | DELIVERED |
| **CFG-006** | **Notification templates.** Message subject/body per event type and channel shall be configurable per tenant. | DELIVERED |
| **CFG-007** | **Module activation.** Which modules a tenant may use shall be configurable. | DELIVERED |
| **CFG-008** | **Feature flags.** Optional behaviour shall be switchable per tenant with defined scope precedence. | DELIVERED |
| **CFG-009** | **Organisation structure.** Legal entities, organisation units, projects, and sites shall be defined per tenant. | DELIVERED |
| **CFG-010** | **Roles & permission grants.** Role composition shall be configurable per tenant from the platform permission catalog. | PARTIAL (no administration UI) |
| **CFG-011** | **Survey content.** Survey definitions, sections, questions, options, and option scores shall be configured, not coded. | DELIVERED |
| **CFG-012** | **Outcome policy.** Automation policies (source event, target survey, respondent strategy, question code, operator, threshold, target action, recipient capability) shall be configured as finite structured values. | DELIVERED |
| **CFG-013** | **Branding.** Client-facing naming, and any visual identity, shall be configured per tenant — never hardcoded (ADR-0003). | PARTIAL |
| **CFG-014** | **Approval matrix.** Approver roles and thresholds shall be expressible through workflow configuration. | DELIVERED |
| **CFG-015** | **Configuration administration UI.** Authorised client administrators shall maintain the configuration above through the application. | PARTIAL (Complaint config delivered; other areas API/seed only) |

## Boundaries

| Rule | Statement |
|---|---|
| **CFG-R1** | Configuration shall never require a source change, redeploy of product code, or client-specific branch. |
| **CFG-R2** | Configuration values shall be tenant-scoped and inaccessible across tenants. |
| **CFG-R3** | Configuration shall be finite and structured. Arbitrary expressions, scripts, or DSLs are prohibited. A Builder UI does not weaken this rule. |
| **CFG-R4** | Configuring one client's data is **delivery work**, not product development, and shall not count toward product progress. |
| **CFG-R5** | Where configuration cannot express a need, escalate through the three-question test (P-5/P-6) before considering Core or Extension. |

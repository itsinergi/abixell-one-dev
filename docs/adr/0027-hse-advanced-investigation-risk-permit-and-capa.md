# ADR-0027: HSE Advanced — Investigation, Risk, Permit to Work, and CAPA Boundary

- **Status:** ACCEPTED — Founder directive 2026-10-26 authorizes Wave A7 runtime implementation on this boundary
- **Date:** 2026-10-26
- **Source:** Pre-Wave A7 planning decision

## Context

HSE Core (`HSE.1–HSE.4`, migration `1768000000000`) already delivers incident register,
reporting, detail views, and a Core follow-up action model. Wave A7 adds seven Advanced
requirements: structured investigation (`HSE-ADV-001`), JSA/HIRA risk assessment
(`HSE-ADV-002`), Permit to Work (`HSE-ADV-003`), inspection and audit programmes
(`HSE-ADV-004`), environmental monitoring (`HSE-ADV-005`), formal CAPA (`HSE-ADV-006`), and
leading/lagging safety indicators (`HSE-ADV-007`).

Two collisions must be resolved before implementation:

1. **CAPA vs Core follow-up action.** Both record "something must be done about an incident."
   If they are the same table, Advanced depth silently changes Core behaviour. If they are
   unrelated, the product has two disconnected remediation lists.
2. **Permit to Work vs Workflow Engine.** A permit is an approval-gated, time-bounded,
   potentially revocable authorisation. Building a second state machine for it would repeat
   the mistake the Asset maintenance and Supply Chain waves explicitly avoided.

## Decision

### 1. Core follow-up action and Advanced CAPA are separate aggregates

The Core follow-up action stays exactly as delivered: a lightweight, incident-scoped
remediation record. Formal CAPA is a new Advanced aggregate with root-cause linkage, action
type (corrective / preventive), effectiveness verification, and closure evidence. CAPA may
reference a Core follow-up action but never replaces or mutates it. No Core path may require
CAPA to exist.

### 2. Investigation methodology is a structured, versioned framework

`HSE-ADV-001` records a chosen methodology (for example 5-Why, Fishbone, or TapRooT-shaped
cause taxonomy) as versioned metadata, with contributing factors and a root-cause
determination. Historical investigations keep the framework version they were recorded
under; changing the taxonomy does not rewrite history.

### 3. Risk assessment uses an explicit, configurable matrix

`HSE-ADV-002` stores JSA/HIRA assessments with likelihood and severity on a configured
matrix. The matrix is tenant configuration, not hardcoded. Risk ratings are computed from
the configured matrix and stored with the assessment so a later matrix change does not
silently re-rate a historical assessment.

### 4. Permit to Work delegates lifecycle to the Workflow Engine

`HSE-ADV-003` owns permit content, validity window, isolation/safety conditions, and
attachments. Lifecycle state is authoritative exclusively through the Workflow Engine via
`workflow_instance_id`, with zero competing local status machine. Permit expiry and
revocation are workflow transitions, not ad-hoc column updates.

### 5. Inspection and audit programmes are scheduled templates over findings

`HSE-ADV-004` defines programme templates (scope, frequency, checklist) and produces
scheduled inspections with findings. Scheduling uses the existing Scheduler (PC-10). A
finding may raise a CAPA; the programme itself never mutates incident or asset state.

### 6. Environmental monitoring is measurement plus threshold, not a second CAPA system

`HSE-ADV-005` records monitoring points, readings, and thresholds with breach detection.
A breach may raise a CAPA; environmental monitoring does not maintain its own parallel
corrective-action list.

### 7. Indicators are computed, never hand-maintained

`HSE-ADV-007` derives leading and lagging indicators (for example incident frequency,
severity rate, near-miss reporting rate, CAPA closure rate) from recorded facts. Indicators
are snapshots with the computation window recorded; no indicator value is operator-editable.

### 8. Documents and attachments reuse Document Core

Permits, investigation evidence, inspection findings, and CAPA closure evidence use the
Document Service with parent-entity authorization (ADR-0012). No HSE-owned file storage.

## Rejected alternatives

- Reusing the Core follow-up action table as the CAPA store.
- Building a permit state machine outside the Workflow Engine.
- Hardcoding the risk matrix so every tenant gets the same scale.
- Re-rating historical risk assessments when the matrix changes.
- Giving environmental monitoring its own corrective-action list.
- Letting operators type indicator values directly.
- A separate HSE attachment store.

## Consequences

- Core HSE behaviour is untouched; Advanced depth is independently activatable.
- Two remediation concepts coexist with an explicit link, which must be visible in the UI.
- Permit revocation and expiry inherit Workflow Engine guarantees and audit.
- Matrix changes are safe because assessments store their own rating.
- Indicator dashboards are reproducible from the recorded window.

## Runtime authorization gate

**Cleared 2026-10-26.** The Founder directive to start Wave A7 authorized the CAPA/Core split,
the versioned investigation framework, the configurable matrix and stored-rating rule,
Workflow-Engine-only permit lifecycle, Scheduler-based inspection programmes, threshold-based
environmental monitoring, and computed-only indicators. Runtime implementation must still carry
cross-tenant isolation, Data Scope, RBAC, workflow delegation, document authorization,
matrix-change regression, and indicator reproducibility tests. Approval alone earns no point:
`HSE-ADV-001…007` stay at 0 until the wave's closure evidence is accepted.

## Related documents

- [HSE Module PRD](../prd/abixell-one/modules/hse.md)
- [ADR-0012: Document/Attachment Authorization Follows the Parent Entity](0012-document-follows-parent-entity-authorization.md)
- [ADR-0009: Hierarchical Data Scope](0009-hierarchical-data-scope.md)
- [ADR-0026: Project Delivery Advanced and Finance Accounting Boundary](0026-project-delivery-advanced-and-finance-accounting-boundary.md)

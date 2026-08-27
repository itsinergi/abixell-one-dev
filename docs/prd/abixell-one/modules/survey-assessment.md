# Module PRD — Survey & Assessment (`SUR-*`)

**PRD v1.0** · Business Core module 3 of 11 · Status: **DELIVERED**

> **Core question:** What did we ask, who answered, what was the result?

This is a **generic** assessment engine. It must serve customer satisfaction, internal assessment, audit questionnaires, and evaluation use cases without knowing any of their business semantics.

## Core requirements

| ID | Requirement | Status |
|---|---|---|
| **SUR-CORE-001** | Authorised users shall define surveys per tenant, identified by a stable code. | DELIVERED |
| **SUR-CORE-002** | A survey shall be versioned. A published version shall be immutable. | DELIVERED |
| **SUR-CORE-003** | A version shall contain sections, questions, and options, each with a stable code. | DELIVERED |
| **SUR-CORE-004** | The engine shall support rating, single-choice, and long-text question types, with option scores where applicable. | DELIVERED |
| **SUR-CORE-005** | A version shall be publishable and retirable; only a published version may be assigned. | DELIVERED |
| **SUR-CORE-006** | A survey shall be assignable to an authenticated respondent in the same tenant, referencing a specific immutable version. | DELIVERED |
| **SUR-CORE-007** | An assignment may carry an opaque context entity reference, without the engine knowing what that entity is. | DELIVERED |
| **SUR-CORE-008** | Respondents shall see their own assignments and no one else's. | DELIVERED |
| **SUR-CORE-009** | Respondents shall save draft answers and resume later; drafts shall persist server-side. | DELIVERED |
| **SUR-CORE-010** | Submission shall be atomic and single-shot; a submitted assignment shall become read-only. | DELIVERED |
| **SUR-CORE-011** | The engine shall compute a score from answered questions at submission and store it immutably. | DELIVERED |
| **SUR-CORE-012** | Results shall be readable by authorised users, respecting tenant and any context-entity authorisation. | DELIVERED |
| **SUR-CORE-013** | Editing a later draft version shall never change an already-submitted response or its score. | DELIVERED |
| **SUR-CORE-014** | Retiring a version shall keep historical results readable while preventing new assignments. | DELIVERED |
| **SUR-CORE-015** | Survey assignment and submission shall publish domain events for other modules to consume. | DELIVERED |
| **SUR-CORE-016** | Survey authoring and respondent surfaces shall be responsive. | DELIVERED |

## Advanced requirements

| ID | Requirement | Status |
|---|---|---|
| **SUR-ADV-001** | **Feedback trigger → survey assignment** (orchestration): on a configured business lifecycle event, assign the configured survey to a validated respondent exactly once per source entity lifetime. | **DELIVERED** |
| **SUR-ADV-002** | **Outcome → management attention** (orchestration): on submission, evaluate a configured question-code numeric threshold and raise an auditable management-attention signal on match. | **DELIVERED** |
| **SUR-ADV-003** | Conditional branching and matrix/grid questions. | **DELIVERED** |
| **SUR-ADV-004** | Weighted, section-level, percentage, and NPS scoring models. | **DELIVERED** |
| **SUR-ADV-005** | Anonymous and public-token distribution to non-authenticated respondents. | **DELIVERED** |
| **SUR-ADV-006** | Multi-language survey content. | **DELIVERED** |
| **SUR-ADV-007** | Cross-survey analytics and benchmarking. | **DELIVERED** |

`SUR-ADV-001`/`SUR-ADV-002` are **orchestration-owned** (they span Survey, Service Quality, Notification, Events, Integration) and are classified Advanced, not Survey Core.

## Client Configuration

Survey definitions, sections, questions, options, option scores · integration policy (source event, target survey, respondent strategy, question code, operator, threshold, target action, recipient capability) · notification templates.

## Client Extension boundary

Client-specific distribution channels or external respondent identity schemes are Extensions.

## Dependencies

Platform Core: RBAC + data scope, configuration, audit, events, notification, entity authorisation resolver.
Orchestration: consumes Service Quality lifecycle events; never imports Service Quality internals.

## Implementation reality

Delivered across Phase 1D (Core engine, admin + respondent UX, stabilisation), Phase 1E (the two Advanced orchestration capabilities `SUR-ADV-001`/`002`), and Wave A2 (`SUR-ADV-003`..`007`). Evidence: `survey-engine.test.ts` (16), `survey-integration.test.ts` (18), `wave-a2-integration.test.ts` (23). Migration `1778000000000_wave-a2-survey-reporting-advanced.cjs` introduces `survey_branching_rules`, `survey_matrix_rows`, `survey_matrix_answers`, `survey_section_scores`, `survey_distribution_tokens` (with atomic quota claim and compensating release on failure), `survey_translations`, and `survey.analytics.read` permission. Small-cell privacy suppression (<5 respondents) and strict tenant isolation via root definition joins are enforced on all analytics and benchmarking endpoints. Answers reference the immutable published question by key rather than snapshotting text, so historical meaning cannot drift.

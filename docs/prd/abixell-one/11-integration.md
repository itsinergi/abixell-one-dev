# 11 — Integration Requirements (`INT-*`)

**PRD v1.0** · Canonical · Classification: **Platform Core** (with Advanced extensions)

| ID | Requirement | Status |
|---|---|---|
| **INT-001** | **Integration boundary.** All third-party traffic shall pass through a controlled boundary; external systems shall never write directly to domain tables or embed logic in the domain layer. | DELIVERED |
| **INT-002** | **Inbound verification.** Inbound calls shall be verified by signature against a per-endpoint secret before processing. | DELIVERED |
| **INT-003** | **Inbound idempotency.** A redelivered inbound message carrying an idempotency key shall be processed at most once. | DELIVERED |
| **INT-004** | **Inbound effect limit.** A verified inbound call shall produce a domain event, never a direct domain write. | DELIVERED |
| **INT-005** | **Outbound dispatch.** Domain events shall be dispatchable to configured outbound endpoints per tenant. | DELIVERED |
| **INT-006** | **Integration log.** Every inbound and outbound attempt shall be recorded with direction, event type, status, and error for troubleshooting. | DELIVERED |
| **INT-007** | **Endpoint configuration.** Integration endpoints shall be configured per tenant and independently activatable. | DELIVERED |
| **INT-008** | **Cross-domain orchestration.** Coordination between business domains shall occur in an orchestration layer using domain events and application ports — never by one module importing another's internals. | DELIVERED |
| **INT-009** | **Automation idempotency.** Automated cross-domain actions shall be exactly-once per source occurrence, enforced at the database, not in memory. | DELIVERED |
| **INT-010** | **Side-effect isolation.** Failure of an integration side effect shall never roll back the completed business action that triggered it; the failure shall be durably recorded instead. | DELIVERED |
| **INT-011** | **Delivery reliability.** The platform shall reconcile integration work that failed or was interrupted, without duplicating effects. | PLANNED (Platform Hardening) |
| **INT-012** | **Partner API surface.** The platform shall expose a documented, versioned API for partner/client system integration. | DEFERRED (Advanced) |
| **INT-013** | **Master-data synchronisation.** The platform shall support inbound synchronisation of client master data (e.g. customers, employees, items) through the integration boundary. | DEFERRED |

## Integration architecture rules

| ID | Rule |
|---|---|
| **INT-R1** | Domain events are the seam. A publisher shall not know its subscribers. |
| **INT-R2** | An event shall represent a **completed** domain action, not an intention. |
| **INT-R3** | Events shall not be emitted merely to mirror another event or to appear sophisticated. |
| **INT-R4** | Event loops shall be structurally prevented (e.g. one-per-lifetime guards on automation). |
| **INT-R5** | Automation shall act through the target domain's application service so that domain's eligibility rules apply. |
| **INT-R6** | Cross-tenant integration is prohibited in all directions. |

## Known reliability limitation

The event bus is in-process and fire-once: a subscriber failure is isolated and logged but not retried. Automation therefore persists its own durable execution record so failures remain observable. Reliable asynchronous reconciliation (`INT-011`) is an approved Platform Hardening item, not yet built.

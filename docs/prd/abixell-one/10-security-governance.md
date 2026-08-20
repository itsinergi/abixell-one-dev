# 10 — Security & Governance Requirements (`SEC-*`)

**PRD v1.0** · Canonical · Classification: **Platform Core**

| ID | Requirement | Status |
|---|---|---|
| **SEC-001** | **Authentication.** Every non-public endpoint shall require an authenticated session scoped to exactly one tenant. | DELIVERED |
| **SEC-002** | **Permission enforcement.** Every business action shall require an explicit permission from the catalog. Role names shall never be used as authorisation logic. | DELIVERED |
| **SEC-003** | **Data scope enforcement.** Authorisation shall additionally constrain which records may be read or acted upon (tenant / hierarchical organisation unit / customer). | DELIVERED |
| **SEC-004** | **Tenant isolation.** No access path — including trusted internal calls, automation, and integration — shall expose or mutate another tenant's data. | DELIVERED |
| **SEC-005** | **Trusted-caller limits.** An internal trusted call may bypass only the *human permission check*; it shall never bypass tenant integrity, ownership, or domain invariants. | DELIVERED |
| **SEC-006** | **Attachment authorisation.** Documents shall inherit their parent entity's authorisation; they shall have no independent access path. | DELIVERED |
| **SEC-007** | **Audit trail.** Every authorisation-relevant mutation shall be recorded append-only with actor, action, entity, and timestamp. Automated actions shall be attributed as automation, never impersonated as a user. | DELIVERED |
| **SEC-008** | **Credential handling.** Passwords shall be stored only as salted hashes; refresh material shall never be stored in reversible form. | DELIVERED |
| **SEC-009** | **Transport & headers.** The API shall apply standard security response headers and shall be served over TLS in any deployed environment. | PARTIAL |
| **SEC-010** | **Origin restriction.** Cross-origin access shall be restricted to the client's known frontend origins. | PLANNED (Platform Hardening) |
| **SEC-011** | **Abuse protection.** Authentication and general endpoints shall be rate limited, tuned against real traffic. | PARTIAL |
| **SEC-012** | **Client-facing vocabulary.** Internal product terms shall never appear in client-facing surfaces (ADR-0003). | DELIVERED |
| **SEC-013** | **Sensitive data minimisation.** Notifications and cross-domain signals shall carry only the context needed, never bulk business content. | DELIVERED |
| **SEC-014** | **Offline data safety.** Business data shall never be persisted to client-side offline caches. | DELIVERED |
| **SEC-015** | **Inbound integration verification.** Inbound integration traffic shall be cryptographically verified before any processing, with replay protection. | DELIVERED |
| **SEC-016** | **Session governance.** Session lifetime shall be configurable per tenant, and sessions shall be revocable. | PARTIAL |
| **SEC-017** | **Segregation of duties.** The permission model shall allow a client to separate operational execution, verification, and administration. | DELIVERED |
| **SEC-018** | **Stronger authentication.** The platform shall support SSO/MFA for clients requiring it. | DEFERRED |

## Governance requirements

| ID | Requirement | Status |
|---|---|---|
| **SEC-GOV-001** | Architectural decisions shall be recorded as ADRs; product decisions in the decision log. | DELIVERED |
| **SEC-GOV-002** | Every capability change shall keep the regression suite green before acceptance. | DELIVERED |
| **SEC-GOV-003** | Permission catalog changes shall ship as migrations, with explicit grants for curated roles. | DELIVERED |
| **SEC-GOV-004** | Security-relevant technical debt shall be tracked with an explicit pilot/production gate. | DELIVERED |

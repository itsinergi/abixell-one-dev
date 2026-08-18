# ADR-0004: Tenant Creation is a Platform-Bootstrap Operation, Not RBAC-Guarded

- **Status:** APPROVED (implementation-level, documented per "small decisions use a safe default" rule)
- **Date:** 2026-08-18 (Checkpoint 0B)
- **Source:** Founder Decision 1 (Dedicated Deployment per Client),
  `02-Identity-Security-RBAC-Foundation.md`

## Context

RBAC (Role Permission + Data Scope) requires a User, which requires a
Tenant to belong to. The very first Tenant in a dedicated deployment is
therefore created before any User, Role, or Permission assignment exists —
there is nothing for RBAC to check yet. Guarding `POST /tenants` with the
same `authenticate` + `requirePermission` mechanism as every other endpoint
is not possible for this one case.

## Decision

`POST /tenants` is guarded by a separate mechanism: a shared secret
(`PLATFORM_BOOTSTRAP_KEY`, header `x-bootstrap-key`) held only by Insting
Tekno Sinergi engineering, never distributed to a client. This is a
platform-operator credential, not a Tenant-scoped credential — it exists
outside the Tenant/RBAC model entirely, consistent with "Dedicated
Deployment per Client": a deployment is provisioned with exactly one
Tenant at setup time, by the platform operator, before the client's users
ever log in.

Every other endpoint (Legal Entity, Organization Unit, User, Audit Log
reads) uses ordinary `authenticate` + RBAC — this exception is intentionally
narrow and does not set a precedent for bypassing RBAC elsewhere.

## Consequences

- A real production deployment must set `PLATFORM_BOOTSTRAP_KEY` to a
  strong, per-deployment secret — never the `.env.example` placeholder —
  and rotate/remove it from reachability once the Tenant is provisioned if
  the threat model calls for it (out of scope to decide in Checkpoint 0B).
- There is deliberately no "list all tenants across deployments" endpoint —
  a dedicated deployment only ever has one Tenant, and cross-deployment
  tenant listing is a platform-operator concern outside this codebase, not
  an API surface of the product itself.
- The very first Administrator User + Role + Permission assignment for a
  new Tenant is also provisioned out-of-band (direct database write by a
  provisioning script), for the same chicken-and-egg reason. See
  `apps/api/scripts/seed.ts` for the reference implementation used in
  development/testing; a production provisioning script would follow the
  same shape.

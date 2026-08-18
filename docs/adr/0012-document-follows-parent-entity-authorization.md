# ADR-0012: Document/Attachment Authorization Follows the Parent Entity

- **Status:** APPROVED for Checkpoint 1A
- **Date:** 2026-08-18
- **Source:** Explicit Phase 1 Founder binding decision (section 7):
  "Document / Attachment mengikuti authorization dan Data Scope dari
  parent entity ... Attachment tidak memiliki independent business
  authorization yang terpisah dari parent business entity." Resolves the
  open item Checkpoint 0E and the Checkpoint 0F Technical Debt Register
  flagged explicitly: "Document Service akses masih di-gate di level
  Tenant, BELUM mengikuti Data Scope entity induk ... WAJIB diputuskan
  secara eksplisit di awal Phase 1."

## Context

The Document Service (Checkpoint 0E) is a generic, entity-agnostic
polymorphic attachment store: every Document points at `(entityType,
entityId)`, the same opaque reference pattern as Workflow Instance and
Domain Event. Checkpoint 0E documented, as an explicit known gap, that it
enforced only a Tenant-wide `document.read`/`document.manage` permission
— it could not know how to check "does this actor have access to
Complaint #123" without depending on a Complaint module, which would have
broken the Document Service's deliberate agnosticism.

Now that Checkpoint 1A has a first real parent entity with a real Data
Scope (Customer, via ADR-0011), this gap has to be resolved with an
actual mechanism, not deferred again.

## Decision

**Entity Authorization Resolver registry.** A new interface,
`EntityAuthorizationResolver` (`application/document/
entity-authorization-resolver.ts`): `canAccess(actor, entityId):
Promise<boolean>`. `DocumentService` takes an `EntityAuthorizationResolverRegistry`
(`Map<entityType, EntityAuthorizationResolver>`) as a constructor
dependency, defaulting to an empty Map.

On every operation (upload / list / download / delete), `DocumentService`
looks up a resolver for the Document's `entityType`:

- **A resolver is registered** (Checkpoint 1A: `"customer"`, backed by
  `CustomerService.canAccessForDocument`): the resolver's answer is the
  SOLE authorization gate. `document.read`/`document.manage` is NOT also
  required — this is the binding decision applied literally: an
  attachment has no independent business authorization separate from its
  parent's.
- **No resolver is registered** (still true for `demo_transaction`, the
  only entityType Phase 0's regression suite exercises): the Checkpoint
  0E behavior is preserved byte-for-byte — Tenant-wide `document.read`/
  `.manage` permission, no per-entity Data Scope. Proven directly: the
  full Phase 0 regression suite (45 tests, including the 0E Document
  Service tests against `demo_transaction`) passes unmodified, and a new
  1A regression-guard test asserts a `demo_transaction` upload without
  `document.manage` is still rejected exactly as before.

Nothing about `DocumentRepository`'s polymorphic shape changed — the
resolver is purely an authorization-time lookup, not a schema or storage
change. A future business module (Complaint, Survey) opts in with one
line in the composition root, the same way Customer did:
`resolvers.set("complaint", complaintResolver)`.

## Consequences

- **A Customer User holds NO `document.*` permission at all** and can
  still upload/read/list evidence attached to their own Customer — proven
  directly in `customer-foundation.test.ts` (upload/list/download all
  succeed against `entityType='customer'`, with a role granted only
  `customer.read`/`contract.read`/`project.read`/`site.read`). This is
  the binding decision's practical effect, not an incidental permission
  gap: the resolver's Data Scope check is a strictly NARROWER gate than
  the old Tenant-wide permission was — a Customer User could never have
  been granted Tenant-wide `document.manage` safely in the first place
  (it would expose every other Customer's evidence too), so removing that
  requirement for resolver-backed entity types is what makes Customer
  Users able to use Document Service safely at all.
- **An internal Supervisor scoped only to an Organization Unit** (no
  `document.*` permission either) can equally reach a Customer's
  documents through the SAME resolver, via the `organization_unit` branch
  of `requireCustomerContextScope` (ADR-0011) — one resolver, two Data
  Scope axes, proven in the same test file.
- **`getOrThrow` now runs before the authorization check** for
  `download`/`delete` (it has to: the resolver needs the Document's
  `entityType`, which only the stored row has). This changes NOTHING
  observable — the prior code path also ended in the same 403/404 outcome
  for an unauthorized or nonexistent Document, just checked permission
  before existence.
- **Extensibility is proven, not just designed**: two authorization
  sources (permission-based legacy, Data-Scope-based resolver) coexist in
  the same service with zero `if (entityType === ...)` branching inside
  `DocumentService` itself — the branching lives entirely in the registry
  lookup, exactly the seam doc 06's original 0E comment predicted would
  be needed ("nothing about `DocumentRepository`'s polymorphic shape
  needs to change for that").
- **Resolvers for `contract`/`project`/`site` entityTypes are NOT
  registered in 1A** — no business module attaches documents to those
  directly yet (Complaint/Survey, 1B/1D, will attach to themselves, not
  directly to a Contract/Project/Site). Adding one later is the same
  one-line registration, not a design change.

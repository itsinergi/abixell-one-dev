# ADR-0031: Offline Field PWA and Bounded Mutation Queue

- **Status:** PROPOSED — draft for Founder review; no runtime authorization
- **Date:** 2026-10-27
- **Source:** Pre-Wave A8 planning decision; resolves the "Pending Founder ADR" gate on `SO-ADV-006`

## Context

`SO-ADV-006` (offline field execution with deferred synchronisation) is `DEFERRED (Pending
Founder ADR)` in the Service Operations PRD. Three delivered requirements currently forbid it:

- `UX-006`: offline capability covers the application shell only; business data and API
  responses are never cached client-side.
- `UX-007`: the application does not queue business writes while offline.
- `PLT-NFR-002`: business data is never cached in client-side offline storage.

Field supervisors work in locations without reliable connectivity. Today they cannot record
work-order progress until they are back online. Lifting the ban wholesale would put tenant
business data on unmanaged devices and create a second write path that bypasses the
authorization, Window, workflow, and maker-checker gates the server enforces per request.

This ADR proposes a deliberately narrow exception rather than a general offline mode.

## Decision

### 1. Offline scope is a named allowlist, not a mode

Only field-execution capabilities registered in an explicit offline allowlist may run offline.
Initial candidates: record work-order progress notes, record checklist item completion,
attach a captured photo, record start/stop timestamps. Finance, approvals, configuration,
roles, workflow, and master data are never offline-capable. Anything not on the allowlist
behaves exactly as today.

### 2. Data stored on the device is the minimum needed to perform the allowed action

The device holds only the assigned work orders the user is authorised to act on, trimmed to
the fields the allowlisted actions need. It never holds tenant-wide lists, other users'
records, financial values, or customer contact data beyond what the job card requires.
Stored data is bounded by count and age, encrypted at rest with a key that is not persisted
beside the data, and purged on sign-out, role switch, session revocation, and expiry.

### 3. Queued writes are intents, not authority

A queued item records a command (type, target, payload, client timestamp, idempotency key).
It carries no permission. On sync the server re-authenticates, re-resolves the active Role,
re-evaluates permissions, Window read-only state, module activation, and Organization Unit
Data Scope, exactly as for an online request. A write that would be refused online is refused
on sync. Offline never widens what a user may do.

### 4. Sync is idempotent, ordered per target, and server-authoritative

Every queued command carries a client-generated idempotency key; replays are no-ops. Commands
for one target replay in capture order. The server timestamps receipt and stores the client
capture time as evidence, never as the effective time for ledger or period purposes. Nothing
queued offline may post to the Accounting Kernel directly; downstream effects occur through
the normal outbox after a successful sync.

### 5. Conflicts are surfaced, never silently merged

If the target changed server-side since the device last read it (version mismatch, state
transition, reassignment), the command is held as a conflict. The user sees both versions and
chooses retry, edit, or discard. Last-write-wins is not permitted. Terminal-state targets
(completed, cancelled, locked) reject queued commands with a stated reason.

### 6. Failure and limits are visible and bounded

The queue has a maximum item count, payload size, and age. At the limit, capture is refused
with a clear message rather than evicting data. Photo capture is size-capped and compressed
before storage. Background sync is best-effort and must respect battery and metered-network
conditions; the interface always shows pending, syncing, failed, and conflicted counts.

### 7. Existing prohibitions are amended, not ignored

`UX-006`, `UX-007`, and `PLT-NFR-002` are amended to carve out exactly the allowlisted
capability under sections 1–6 and remain in force for everything else. The amendment lands
with runtime authorization, not with this ADR.

## Rejected alternatives

- General offline mode for the whole application.
- Caching API responses broadly in a service worker.
- Queueing writes with embedded permission claims evaluated on the device.
- Last-write-wins conflict resolution.
- Using the client capture time as the effective business time.
- Unbounded local storage or silent eviction when full.
- Unencrypted local storage of assigned work-order data.

## Consequences

- Field supervisors can capture progress without connectivity, within a small and auditable scope.
- Device-held business data becomes a real security surface: key handling, purge triggers, and
  lost-device behaviour need dedicated design and tests.
- Sync introduces conflict handling and idempotency obligations on every allowlisted command.
- Three delivered requirements are amended; the traceability matrix must be reconciled when
  runtime is authorised.
- No points are claimed by this ADR. `SO-ADV-006` remains `DEFERRED` until runtime authorization.

## Runtime authorization gate

This proposal does not authorize runtime implementation. Final Founder approval is required
for the allowlist, the on-device data minimum and encryption/purge rules, the intent-only
queue model, the idempotency and ordering rules, the conflict policy, the queue limits, and
the amendment of `UX-006`, `UX-007`, and `PLT-NFR-002`. Runtime authorization must include
permission-recheck-on-sync, Window-lock-on-sync, idempotent-replay, conflict-surfacing,
purge-on-sign-out/role-switch, queue-limit, and no-direct-ledger-write tests.

## Related documents

- [Experience Surfaces PRD](../prd/abixell-one/13-experience-surfaces.md)
- [Platform Core PRD](../prd/abixell-one/04-platform-core.md)
- [Service Operations module PRD](../prd/abixell-one/modules/service-operations.md)
- [ADR-0009: Hierarchical Data Scope](0009-hierarchical-data-scope.md)
- [ADR-0028: Partner API Surface and Versioning](0028-partner-api-surface-and-versioning.md)

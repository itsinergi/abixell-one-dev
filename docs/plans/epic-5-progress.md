# Epic 5 Progress

## 2026-09-30 — Commit 673b107

### Phase 1 — G3 UI Picker: COMPLETE
- `AdminAssignmentControls.tsx`: LE picker with `le:` prefix, selectable detection, default selection
- `AdminAssignAccessDialog.tsx`: LE preview summary display
- `api.ts`: LE types in `AdminAssignmentOptions`

### Phase 2 — G4 Attachment Metadata: COMPLETE
- Migration: `1789440000000_epic-5-g4-attachment-metadata.cjs` — `legal_entity_attachment_references` table
- Domain: `legal-entity-attachment-reference.entity.ts` — entity, repository port
- Repository: `legal-entity-attachment-reference.repository.pg.ts` — governed transactions, ownership lock
- Service: `legal-entity-attachment-reference.service.ts` — RBAC + lifecycle gating
- Routes: `legal-entity-attachment-references.ts` — GET/POST/PATCH sub-resource
- Wiring: composition-root + app.ts
- Backdate contract: `epic-5-g4-backdate-transaction-contract.md` — handoff spec for Epic 7/8/9

### Phase 3 — G1 Lifecycle Fix: COMPLETE
- `legal-entity.repository.pg.ts` line 377: exclude root Central from active-units guard
- Effect: Legal Entity can now be deactivated without deactivating root Central first
- Root Central stays active always (DB trigger invariant preserved)

### Phase 4 — Legacy Re-parent: NOT STARTED (DB admin task)
- Backfill Central roots for LEs that lack one
- Re-parent 45 orphan OUs under new Central roots
- Preserve grandfathered `unit_type` values

### Phase 5 — Documentation: PARTIAL
- G4 contract doc written
- Progress doc updated
- CORE-ROADMAP items #4 (jurisdiction/NPWP), #7 (tombstone UI): deferred to future interviews

### Typecheck
- `npm run typecheck -w apps/api`: clean
- `npm run typecheck -w apps/web`: clean (verified in prior session)

### DB Collision Cleanup: NOT AUTO-EXECUTED
- Separate operator task to resolve migration collision between dev DBs
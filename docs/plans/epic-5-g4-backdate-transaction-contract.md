# Backdate Transaction Contract — Epic 5 → Epic 7/8/9

**Status:** HANDOFF CONTRACT (Epic 5 deliverable, not an implementation spec)
**Author:** Epic 5 G4 (§4.5 step 19)
**Date:** 2026-09-30
**Spec ref:** CORE-ROADMAP.md §4.5 lines 1820–1839

---

## Owner

**Epic 7** — Document Engine & Transaction Lifecycle

## Contributors

- **Epic 8** — Document Numbering & Format Codes
- **Epic 9** — Workflow Engine, Approval Matrix & Escalation

---

## 1. UI Behavior

1. A checkbox labeled **"Backdate Transaction"** appears on every transaction
   form that supports backdating. Default state: **UNCHECKED**.
2. When checked, the form reveals:
   - **Backdate Transaction Date** picker (calendar control)
   - **Notes / Justification** text field (REQUIRED when checkbox is active)
   - **Attachment** slot (reference pointer only — file storage deferred to the
     document/file epic; see §3 boundary below)
3. **Date constraint:** Backdate Transaction Date MUST be strictly earlier than
   the normal Transaction Date. The form prevents submission otherwise.
4. **Calendar behavior:** the calendar selects the Backdate Transaction Date; it
   does NOT silently replace the normal Transaction Date. Both dates remain
   visible and independently meaningful.

## 2. Record Fields (stored per transaction)

| Field | Type | Notes |
|-------|------|-------|
| `transaction_date` | DATE | The normal (non-backdated) transaction date |
| `backdate_transaction_date` | DATE, nullable | Populated only when backdated |
| `input_time` | TIMESTAMPTZ | Actual wall-clock insertion timestamp; never backdated |
| `actor` | UUID (FK → users) | The user who created/approved the transaction |
| `reason` | TEXT | Justification text; required when backdating |
| `attachment_reference` | VARCHAR(500), nullable | Metadata pointer only (no file bytes) |
| `approval_status` | VARCHAR(20), nullable | Present when Epic 9 approval is required |
| `approval_instance_id` | UUID, nullable | FK to Epic 9's `approval_instances` when routed |

## 3. Attachment Boundary

The attachment slot in a backdated transaction uses the **same metadata-only
pattern** as `legal_entity_attachment_references` (Epic 5 G4 step 18):

- **In scope:** a reference string (document code, external URL, or future
  storage key), a category label, an optional expiry date
- **Out of scope:** object storage, virus scanning, file size limits,
  encryption at rest, versioning, retention policies, download access control,
  approval workflow for the attachment itself

These are deferred to a future document/file epic. Epic 7 may implement the
attachment slot as a column on the transaction record or as a join to
`legal_entity_attachment_references`; this contract does not prescribe the
storage mechanism.

## 4. Audit Trail

1. The audit log captures ALL fields listed in §2, including both dates, the
   actor, the justification, and the attachment reference.
2. The audit entry's own timestamp is **never backdated** — it always records
   the actual wall-clock time the entry was created.
3. Audit entries are **immutable**: no UPDATE or DELETE is permitted on an audit
   row once written.
4. The audit action should follow the governed audit pattern:
   `transaction.created_backdated` (distinguishable from `transaction.created`).

## 5. Authorization

1. Backdating requires either:
   - **Super Admin** role (tenant-wide scope), OR
   - A role with a policy-module-approved capability (e.g.,
     `transaction.backdate`) granted through the normal RBAC assignment system
2. When the policy module requires approval for backdating, the transaction
   enters a pending state and is routed to **Epic 9** (Workflow Engine, Approval
   Matrix & Escalation) for approval resolution.
3. The approval matrix configuration (which roles approve, escalation rules,
   amount thresholds) is owned entirely by Epic 9.

## 6. Epic Boundaries

| Epic | Responsibility |
|------|----------------|
| **Epic 5** | Writes this contract only. No backdate UI, button, validation, or storage is implemented. |
| **Epic 7** | Implements the checkbox, date picker, record storage, and audit hook. Owns the transaction lifecycle and the backdate validation rules. |
| **Epic 8** | Ensures the numbering sequence respects the backdate date when applicable (e.g., period-based document codes). |
| **Epic 9** | Provides the approval matrix for backdate authorization. Receives `approval_instance_id` from Epic 7 when routing is required. |

## 7. Open Questions for Epic 7–9 Interviews

These questions are explicitly **unresolved** by this contract. They must be
settled during the Epic 7, 8, and 9 interview sessions before implementation:

1. **Draft vs. posted:** Should backdating be allowed on already-posted
   transactions, or only on draft transactions before posting?
2. **Maximum window:** What is the maximum backdate window (in days)? Is it
   configurable per module or per Legal Entity?
3. **Re-numbering:** Does a backdated transaction trigger re-numbering of the
   existing sequence, or does it keep the next available number in the current
   sequence?
4. **Cross-period:** If the backdate date falls in a closed accounting period,
   should the system refuse, require additional approval, or allow with a
   warning?
5. **Bulk backdate:** Can multiple transactions be backdated in a single batch,
   or is it always one at a time?

---

*This contract was generated as a G4 deliverable of Epic 5 (§4.5 step 19).
It is a handoff specification, not an implementation. Epic 7 owns the first
implementation; Epics 8 and 9 contribute their domains as stated above.*

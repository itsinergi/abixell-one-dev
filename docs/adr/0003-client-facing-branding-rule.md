# ADR-0003: No Client-Facing "Whitelabel" Strings — Technical Enforcement

- **Status:** APPROVED / BINDING
- **Date:** 2026-08-18
- **Source:** `01-FOUNDER-DECISION-PRE-PHASE-0.md` (Decision 1 & 4),
  `02-Identity-Security-RBAC-Foundation.md`,
  `08-Application-Shell-Design-System-Foundation.md`

## Decision

No source code, template, or UI component may hardcode any user-facing
string. All strings shown to end users (application name, logo, footer,
email/notification templates, report titles, page titles, module labels)
must be sourced at runtime from per-Tenant Branding/Terminology
Configuration (Configuration Engine, ADR to follow in Checkpoint 0C).

This is a **technical control**, not just a writing-style guideline: by
construction, the application code never stores or renders client-facing
copy directly, so terms like "Whitelabel", "multi-tenant product", "shared
product core", "reusable platform", or "template platform" cannot leak into
any client-facing surface.

## Consequences

- `apps/web` ships with placeholder/neutral scaffolding strings only during
  Checkpoint 0A (no real client yet); once Configuration Engine (Checkpoint
  0C) exists, all such copy moves to Tenant Configuration.
- Code review / Architecture Review must reject any PR that hardcodes
  end-user-visible copy outside the configuration layer.

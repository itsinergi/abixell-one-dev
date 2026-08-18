/**
 * Cross-cutting types shared by every domain module. Kept in
 * shared-kernel so no domain module has to depend on another domain
 * module just to express "who did this" or "what can they see".
 */

/** Identity of the actor performing a mutating action, for audit purposes. */
export interface ActorContext {
  userId: string;
  tenantId: string;
}

/** Data Scope, per 01-Tenant-Legal-Entity-Organization-Model.md /
 * 02-Identity-Security-RBAC-Foundation.md — determines WHICH data an
 * authenticated user may act on, independent of WHAT action (permission)
 * they are allowed to perform.
 *
 * 0B scope is intentionally exact-match only:
 * - 'tenant'            -> the whole Tenant
 * - 'organization_unit' -> exactly one Organization Unit (not its
 *                          descendants — descendant-aware scope is a
 *                          documented gap, see docs/decision-log.md)
 */
export type DataScope =
  | { type: "tenant" }
  | { type: "organization_unit"; organizationUnitId: string };

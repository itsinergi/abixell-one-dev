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
 * - 'tenant'            -> the whole Tenant
 * - 'organization_unit' -> one Organization Unit AND every descendant of
 *                          it (Checkpoint 0F / ADR-0009, hierarchical)
 * - 'customer'          -> exactly one Customer (Checkpoint 1A /
 *                          ADR-0011). No hierarchy: a Customer has no
 *                          descendants, so this is exact-match, the same
 *                          shape 0B's Organization Unit scope originally
 *                          had before ADR-0009. This is the axis a
 *                          Customer User's Role assignment carries.
 */
export type DataScope =
  | { type: "tenant" }
  | { type: "organization_unit"; organizationUnitId: string }
  | { type: "customer"; customerId: string };

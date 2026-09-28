/**
 * Cross-cutting types shared by every domain module. Kept in
 * shared-kernel so no domain module has to depend on another domain
 * module just to express "who did this" or "what can they see".
 */

/** Identity of the actor performing a mutating action, for audit purposes.
 *
 * Epic 1 (§4.1 B): the active Role is server-side session state, resolved
 * here — never trusted from the token. `assignmentId` is null when the
 * session has no currently effective assignment (none granted, or the one it
 * held was revoked): such an actor is authenticated for `/me` but every
 * permissioned route must fail closed with 403. `roleId` and the scope
 * fields are the assignment's columns, carried so downstream checks do not
 * re-query what authentication just resolved.
 */
export interface ActorContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  assignmentId: string | null;
  roleId: string | null;
  /** The active Role's code, resolved with the assignment so scope and
   * role-match checks (workflow eligibility, menu filtering) never need a
   * second query for what authentication already resolved. */
  roleCode: string | null;
  scopeType: "tenant" | "organization_unit" | "customer" | null;
  scopeOrganizationUnitId: string | null;
  scopeCustomerId: string | null;
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

import { createHash } from "node:crypto";
import type { GovernedRoleAssignmentInput } from "./rbac.entity.js";

/**
 * The set of Users one administrative actor may see and act on (§4.4 C/D/E,
 * step 16).
 *
 * Derived on the server from the actor's OWN effective assignments that
 * ALREADY CARRY the administration permission in question — never from the
 * union of their effective permissions. An actor holding `user.read` from a
 * narrow unit assignment plus an unrelated tenant-wide role with no
 * administration permission has a one-unit visibility, not a tenant one; the
 * same-assignment rule (§4.4 risk row 3) forbids the other reading, and the
 * aggregate-token regression in `admin-access-management.test.ts` pins it.
 *
 * - `tenant` — a tenant-wide assignment carries the permission, so the whole
 *   tenant is visible and governable.
 * - `units`  — only Organization Unit assignments carry it. `organizationUnitIds`
 *   is the actor's OWN anchors EXPANDED TO EVERY DESCENDANT (ADR-0009
 *   hierarchical Data Scope): an authority on a Region covers every Site under
 *   it, and §4.4 E says so in as many words. Expansion happens in SQL
 *   (`PgRbacRepository.listOrganizationUnitSubtreeIds`) so the browser never
 *   computes a hierarchy.
 *
 * An empty `units` list is NO visibility, never "everything". A `customer`
 * assignment contributes no internal-User visibility: §4.4 E keeps Customer
 * scope out of the Epic 4 UI, so it can never be the route by which an actor
 * sees internal Users. Both cases collapse to the same answer as "no
 * assignment".
 */
export type AdministrativeVisibility =
  | { kind: "tenant" }
  | { kind: "units"; organizationUnitIds: string[] };

/**
 * The reportable shape of one proposed assignment pair, as the preview and the
 * audit trail describe it. Deliberately carries display names so an operator
 * confirms against what they read on screen, not against opaque ids.
 */
export interface AssignmentPairSummary {
  roleCode: string;
  roleName: string;
  scopeType: "tenant" | "legal_entity" | "organization_unit" | "customer";
  scopeLegalEntityId: string | null;
  scopeLegalEntityName: string | null;
  scopeOrganizationUnitId: string | null;
  scopeOrganizationUnitName: string | null;
  scopeCustomerId: string | null;
  scopeCustomerName: string | null;
}

/**
 * A previewed, confirmable batch of assignment pairs (§4.4 C: "beberapa
 * pasangan role + scope diproses sebagai satu transaksi dan satu konfirmasi";
 * §4.4 D: "preview dampak; konfirmasi satu kali").
 *
 * `previewHash` is a content address over the pairs AND the actor and target
 * they were previewed for, so a confirmation bound to one review can never be
 * replayed against a different actor, a different User, or a different set of
 * pairs.
 */
export interface AssignmentBatchPreview {
  previewHash: string;
  targetUserId: string;
  pairs: AssignmentPairSummary[];
}

/**
 * Deterministic content address for one proposed batch. Covers the target and
 * the actor as well as the pairs: the same pairs are a different request when
 * proposed by a different administrator, because the delegation ceiling is
 * evaluated against the proposing actor.
 */
export function computeAssignmentBatchHash(
  actorUserId: string,
  targetUserId: string,
  pairs: readonly GovernedRoleAssignmentInput[],
): string {
  const canonical = {
    actorUserId,
    targetUserId,
    pairs: pairs
      .map((pair) =>
        pair.scopeType === "tenant"
          ? { roleCode: pair.roleCode, scopeType: "tenant" as const }
          : pair.scopeType === "legal_entity"
            ? {
                roleCode: pair.roleCode,
                scopeType: "legal_entity" as const,
                scopeLegalEntityId: pair.scopeLegalEntityId,
              }
            : pair.scopeType === "organization_unit"
              ? {
                  roleCode: pair.roleCode,
                  scopeType: "organization_unit" as const,
                  scopeOrganizationUnitId: pair.scopeOrganizationUnitId,
                }
              : {
                  roleCode: pair.roleCode,
                  scopeType: "customer" as const,
                  scopeCustomerId: pair.scopeCustomerId,
                },
      )
      .sort((a, b) => {
        const left = `${a.scopeType}:${a.roleCode}:${JSON.stringify(a)}`;
        const right = `${b.scopeType}:${b.roleCode}:${JSON.stringify(b)}`;
        return left < right ? -1 : left > right ? 1 : 0;
      }),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

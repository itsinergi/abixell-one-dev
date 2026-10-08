import type { Pool, PoolClient } from "pg";
import { ForbiddenError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import type { GovernedActor } from "../../../domain/rbac/rbac.entity.js";

// Cooperating lifecycle and RBAC writers serialize on the tenant row.
export async function inGovernedTransaction<T>(
  pool: Pool,
  tenantId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockedTenant = await client.query(
      `SELECT id FROM tenants WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [tenantId],
    );
    if (!lockedTenant.rows[0]) throw new NotFoundError("Tenant", tenantId);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listOrganizationUnitAncestorIds(
  client: Pool | PoolClient,
  id: string,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, tenant_id
         FROM organization_units WHERE id = $1 AND deleted_at IS NULL
       UNION
       SELECT ou.id, ou.parent_id, ou.tenant_id
         FROM organization_units ou
         JOIN ancestors a ON ou.id = a.parent_id AND ou.tenant_id = a.tenant_id
        WHERE ou.deleted_at IS NULL
     ) SELECT id FROM ancestors`,
    [id],
  );
  return result.rows.map((row) => row.id);
}

// Permission and scope must belong to the same effective assignment.
// Without a scope target, mutations govern tenant-wide resources (users/LEs).
//
// Epic 1 (§4.1 C): the assignment is named explicitly (`$5`) rather than
// being re-derived from the user, so this write gate consults the SESSION'S
// ACTIVE Role. Without the pin, a user who holds a permission through any
// switched-away Role would satisfy this check inside a transaction whose
// other reads were already scoped to the active Role.
//
// Epic 5 G3 (§4.5 step 15): the target may be an Organization Unit OR a Legal
// Entity, and the coverage chain is tenant → Legal Entity → Organization Unit.
// `legalEntityId` is the explicit form; when only an Organization Unit is
// named, its Legal Entity is resolved from the unit row inside this same
// query, so a Legal Entity-scoped assignment covers every unit of that Legal
// Entity — including units it would not reach through the ancestor walk — and
// never a unit of a sibling Legal Entity. A caller that names no target at all
// still requires a tenant-wide active assignment: the Legal Entity branch
// compares against NULL and matches nothing.
export async function requireTransactionActorPermission(
  client: PoolClient,
  actor: GovernedActor,
  permissionCode: string,
  organizationUnitId?: string,
  legalEntityId?: string,
): Promise<void> {
  if (actor.assignmentId === null) {
    throw new ForbiddenError(
      `No active Role in this session; switch to a Role that grants permission '${permissionCode}'`,
    );
  }
  const ancestors = organizationUnitId
    ? await listOrganizationUnitAncestorIds(client, organizationUnitId)
    : [];
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM users u
         JOIN authorization_effective_user_role_assignments aura
           ON aura.user_id = u.id
          AND aura.tenant_id = u.tenant_id
          AND aura.id = $5
         JOIN role_permissions rp ON rp.role_id = aura.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE u.id = $2
          AND u.tenant_id = $1
          AND u.status = 'active'
          AND u.deleted_at IS NULL
          AND p.code = $3
          AND (
            aura.scope_type = 'tenant'
            OR (aura.scope_type = 'organization_unit'
                AND aura.scope_organization_unit_id = ANY($4::uuid[]))
            OR (aura.scope_type = 'legal_entity'
                AND aura.scope_legal_entity_id = COALESCE(
                  $6::uuid,
                  (
                    SELECT ou.legal_entity_id
                      FROM organization_units ou
                     WHERE ou.id = $7::uuid
                       AND ou.tenant_id = $1
                       AND ou.deleted_at IS NULL
                  )
                ))
          )
     ) AS allowed`,
    [
      actor.tenantId,
      actor.userId,
      permissionCode,
      ancestors,
      actor.assignmentId,
      legalEntityId ?? null,
      organizationUnitId ?? null,
    ],
  );
  if (result.rows[0]?.allowed !== true) {
    throw new ForbiddenError(`Missing permission or Data Scope for '${permissionCode}'`);
  }
}

export async function recordGovernedAudit(
  client: PoolClient,
  input: {
    tenantId: string;
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log
       (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [input.tenantId, input.actorUserId, input.action, input.entityType,
      input.entityId, JSON.stringify(input.metadata ?? {})],
  );
}

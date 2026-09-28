import type { Pool } from "pg";
import type {
  ApprovalAuthorityRepository,
  ConversionRateRow,
  RoleApprovalLimits,
  SupervisorChainNode,
} from "../../../domain/rbac/approval-authority.entity.js";

/**
 * Epic 1 (§4.1 D) — PostgreSQL reads for the approval-authority resolver.
 *
 * Every read is tenant-pinned (`tenant_id = $1`) because the resolver
 * trusts the document's row only for its OWN table's tenant; a document
 * naming a foreign user or unit must yield null, not cross-tenant data.
 *
 * `getActiveRoleApprovalLimits` consults the session's ACTIVE assignment
 * (`assignmentId`) for the actor and the effective view for anyone else in
 * the escalation chain: same §4.1 C rule as every other authority read —
 * an approval limit a user merely HOLDS through a switched-away Role
 * grants nothing.
 */
export class PgApprovalAuthorityRepository implements ApprovalAuthorityRepository {
  constructor(private readonly pool: Pool) {}

  async getActiveRoleApprovalLimits(
    tenantId: string,
    userId: string,
    assignmentId: string | null,
  ): Promise<RoleApprovalLimits | null> {
    // The actor's ACTIVE assignment when we have one; otherwise (candidate
    // deeper in the chain, or actor with no active role) the FIRST
    // effective assignment the user holds, in the picker order, so the
    // escalation walk still sees each hop's own limits.
    const result = await this.pool.query<{
      role_amt: string | null;
      amt_approval_accum: string | null;
      days_approval_accum: number | null;
      currency_code: string | null;
      is_can_approve_own_doc: boolean;
    }>(
      `SELECT r.amt_approval            AS role_amt,
              r.amt_approval_accum,
              r.days_approval_accum,
              r.currency_code,
              r.is_can_approve_own_doc
         FROM authorization_effective_user_role_assignments aura
         JOIN roles r ON r.id = aura.role_id
        WHERE aura.tenant_id = $1
          AND aura.user_id = $2
          AND ($3::uuid IS NULL OR aura.id = $3)
        ORDER BY ($3::uuid IS NOT NULL) DESC, r.name, aura.id
        LIMIT 1`,
      [tenantId, userId, assignmentId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      roleAmt: row.role_amt,
      amtApprovalAccum: row.amt_approval_accum,
      daysApprovalAccum: row.days_approval_accum,
      currencyCode: row.currency_code,
      isCanApproveOwnDoc: row.is_can_approve_own_doc,
    };
  }

  async getSupervisorChain(
    tenantId: string,
    userId: string,
    limit: number,
  ): Promise<SupervisorChainNode[]> {
    const result = await this.pool.query<{
      user_id: string;
      supervisor_user_id: string | null;
    }>(
      `WITH RECURSIVE chain AS (
         SELECT id AS user_id, supervisor_user_id
           FROM users
          WHERE id = $2
            AND tenant_id = $1
          UNION
         SELECT u.id AS user_id, u.supervisor_user_id
           FROM users u
           JOIN chain c ON u.id = c.supervisor_user_id
          WHERE u.tenant_id = $1
            AND c.supervisor_user_id IS NOT NULL
       )
       SELECT user_id, supervisor_user_id FROM chain LIMIT $3`,
      [tenantId, userId, limit],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      supervisorUserId: row.supervisor_user_id,
    }));
  }

  async getOrganizationUnitSupervisor(
    tenantId: string,
    organizationUnitId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ supervisor_user_id: string | null }>(
      `SELECT supervisor_user_id
         FROM organization_units
        WHERE id = $2
          AND tenant_id = $1
          AND deleted_at IS NULL`,
      [tenantId, organizationUnitId],
    );
    return result.rows[0]?.supervisor_user_id ?? null;
  }

  async getConversionRate(
    tenantId: string,
    fromCode: string,
    toCode: string,
  ): Promise<ConversionRateRow | null> {
    // Latest window in effect: rows are unique on (tenant, from, to,
    // valid_from); "in effect" means now() inside [valid_from, valid_to]
    // (or valid_to open-ended). The most recently STARTING window wins.
    const result = await this.pool.query<{ rate: string }>(
      `SELECT rate
         FROM currency_conversion_rates
        WHERE tenant_id = $1
          AND from_currency_code = $2
          AND to_currency_code = $3
          AND valid_from <= now()
          AND (valid_to IS NULL OR valid_to >= now())
        ORDER BY valid_from DESC
        LIMIT 1`,
      [tenantId, fromCode, toCode],
    );
    const row = result.rows[0];
    return row ? { rate: row.rate } : null;
  }

  async getAccumulatedApprovedAmount(
    tenantId: string,
    userId: string,
    documentTable: string,
    days: number,
  ): Promise<string> {
    // iDempiere's getAmtAccum (MWFActivity.java:854): the amounts THIS user
    // approved within the window. The product's decision ledger is
    // `workflow_history.decision_amount` (migration 1789100000000); the
    // engine writes the amount on 'approve' rows only. `documentTable` maps
    // to `workflow_instances.entity_type` — the caller's document table —
    // so the sum stays per-table the way getAmtAccum's FROM-clause does.
    // Entities with no amount in contextData carry NULL and fall out of
    // the SUM naturally.
    const result = await this.pool.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(wih.decision_amount), 0)::text AS total
         FROM workflow_history wih
         JOIN workflow_instances wi ON wi.id = wih.workflow_instance_id
        WHERE wi.tenant_id = $1
          AND wih.actor_user_id = $2
          AND wih.action_code = 'approve'
          AND wih.decision_amount IS NOT NULL
          AND wi.entity_type = $4
          AND wih.occurred_at >= now() - ($3 || ' days')::interval`,
      [tenantId, userId, days, documentTable],
    );
    return result.rows[0]?.total ?? "0";
  }
}

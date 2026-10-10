import type { Pool, PoolClient } from "pg";
import type {
  CreateSodRuleInput,
  SodForbiddenRule,
  SodRepository,
} from "../../../domain/rbac/sod.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRuleRow(row: any): SodForbiddenRule {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    roleCodeA: row.role_code_a,
    roleCodeB: row.role_code_b,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * SoD rule persistence (WP-APR-03). Rules are governed tenant data; the
 * actual enforcement lives in the DB trigger (migration
 * 1793000000010_phase4-apr-03-sod-rules.cjs), so this repository only manages
 * the rules and runs the violation survey.
 */
export class PgSodRepository implements SodRepository {
  constructor(private readonly pool: Pool) {}

  async createRule(
    tenantId: string,
    input: CreateSodRuleInput,
    actor: ActorContext,
  ): Promise<SodForbiddenRule> {
    return inGovernedTransaction(this.pool, tenantId, async (client: PoolClient) => {
      await requireTransactionActorPermission(client, actor, "config.manage");

      // Referential honesty: both codes must exist as roles in the tenant.
      const codes = [input.roleCodeA, input.roleCodeB];
      const found = await client.query(
        `SELECT code FROM roles WHERE tenant_id = $1 AND code = ANY($2)`,
        [tenantId, codes],
      );
      if (found.rows.length < 2) {
        throw new NotFoundError("Role", codes.join(" or "));
      }

      let created;
      try {
        created = await client.query(
          `INSERT INTO sod_forbidden_rules (tenant_id, role_code_a, role_code_b, reason, created_by)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [tenantId, input.roleCodeA, input.roleCodeB, input.reason, actor.userId],
        );
      } catch (error) {
        if (
          typeof error === "object" && error !== null &&
          (error as { code?: string }).code === "23505"
        ) {
          throw new ConflictError("A forbidden pair rule for these roles already exists");
        }
        throw error;
      }

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "sod_rule.created",
        entityType: "sod_forbidden_rule",
        entityId: created.rows[0].id as string,
        metadata: { roleCodeA: input.roleCodeA, roleCodeB: input.roleCodeB },
      });

      return mapRuleRow(created.rows[0]);
    });
  }

  async listRules(tenantId: string): Promise<SodForbiddenRule[]> {
    const result = await this.pool.query(
      `SELECT * FROM sod_forbidden_rules WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [tenantId],
    );
    return result.rows.map(mapRuleRow);
  }

  async deleteRule(tenantId: string, ruleId: string, actor: ActorContext): Promise<void> {
    return inGovernedTransaction(this.pool, tenantId, async (client: PoolClient) => {
      await requireTransactionActorPermission(client, actor, "config.manage");

      const deleted = await client.query(
        `DELETE FROM sod_forbidden_rules WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [ruleId, tenantId],
      );
      if (!deleted.rows[0]) throw new NotFoundError("SodForbiddenRule", ruleId);

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "sod_rule.deleted",
        entityType: "sod_forbidden_rule",
        entityId: ruleId,
        metadata: {},
      });
    });
  }

  async listHeldPairs(
    tenantId: string,
  ): Promise<Array<{ userId: string; codeA: string; codeB: string }>> {
    // `user_role_assignments` has no tenant_id column: the tenant is held by
    // the ROLE (roles.tenant_id), joined here for both sides of the pair.
    const result = await this.pool.query(
      `SELECT ra1.user_id AS user_id,
              LEAST(r1.code, r2.code) AS code_a,
              GREATEST(r1.code, r2.code) AS code_b
         FROM user_role_assignments ra1
         JOIN roles r1 ON r1.id = ra1.role_id AND r1.tenant_id = $1
         JOIN user_role_assignments ra2
           ON ra2.user_id = ra1.user_id
          AND ra2.id > ra1.id
         JOIN roles r2 ON r2.id = ra2.role_id AND r2.tenant_id = $1
        WHERE ra1.scope_invalidated_at IS NULL AND ra1.revoked_at IS NULL
          AND ra2.scope_invalidated_at IS NULL AND ra2.revoked_at IS NULL`,
      [tenantId],
    );
    return result.rows.map((row: { user_id: string; code_a: string; code_b: string }) => ({
      userId: row.user_id,
      codeA: row.code_a,
      codeB: row.code_b,
    }));
  }
}

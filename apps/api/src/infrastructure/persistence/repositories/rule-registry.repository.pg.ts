import type { Pool, PoolClient } from "pg";
import type {
  RegisterRuleInput,
  RuleRegistryEntry,
  RuleRegistryRepository,
  RuleRegistryStatus,
} from "../../../domain/rules/rule-registry.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  requireTransactionActorPermission,
  recordGovernedAudit,
} from "./governed-transaction.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): RuleRegistryEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    ruleKey: row.rule_key,
    version: row.version,
    payload: row.payload,
    status: row.status,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    moduleCode: row.module_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/**
 * Rule Registry persistence (WP-APR-02). Versions are immutable content-wise;
 * the single-active invariant is enforced by the DB trigger
 * (1793000000020_phase4-apr-02-rule-registry.cjs) — activating a version
 * supersedes the previous active one.
 */
export class PgRuleRegistryRepository implements RuleRegistryRepository {
  constructor(private readonly pool: Pool) {}

  async createEntry(
    tenantId: string,
    input: RegisterRuleInput,
    actor: ActorContext,
  ): Promise<RuleRegistryEntry> {
    return inGovernedTransaction(this.pool, tenantId, async (client: PoolClient) => {
      await requireTransactionActorPermission(client, actor, "config.manage");

      const version = await this.nextVersionWith(client, tenantId, input.ruleKey);
      let created;
      try {
        created = await client.query(
          `INSERT INTO rule_registry_entries
             (tenant_id, rule_key, version, payload, status, module_code, created_by, updated_by)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
           RETURNING *`,
          [
            tenantId,
            input.ruleKey,
            version,
            JSON.stringify(input.payload),
            input.activate ? "active" : "draft",
            null,
            actor.userId,
            actor.userId,
          ],
        );
      } catch (error) {
        if (
          typeof error === "object" && error !== null &&
          (error as { code?: string }).code === "23505"
        ) {
          throw new ConflictError("A rule version already exists for this key");
        }
        throw error;
      }

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "rule_registry.entry_created",
        entityType: "rule_registry_entry",
        entityId: created.rows[0].id as string,
        metadata: { ruleKey: input.ruleKey, version, activate: input.activate ?? false },
      });

      return mapRow(created.rows[0]);
    });
  }

  async nextVersion(tenantId: string, ruleKey: string): Promise<number> {
    return this.nextVersionWith(this.pool, tenantId, ruleKey);
  }

  private async nextVersionWith(
    executor: Pool | PoolClient,
    tenantId: string,
    ruleKey: string,
  ): Promise<number> {
    const r = await executor.query<{ next: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next FROM rule_registry_entries
        WHERE tenant_id = $1 AND rule_key = $2`,
      [tenantId, ruleKey],
    );
    return r.rows[0].next;
  }

  async findById(tenantId: string, id: string): Promise<RuleRegistryEntry | null> {
    const r = await this.pool.query(
      `SELECT * FROM rule_registry_entries WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }

  async findActive(tenantId: string, ruleKey: string): Promise<RuleRegistryEntry | null> {
    const r = await this.pool.query(
      `SELECT * FROM rule_registry_entries
        WHERE tenant_id = $1 AND rule_key = $2 AND status = 'active'
        ORDER BY version DESC
        LIMIT 1`,
      [tenantId, ruleKey],
    );
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }

  async listByKey(tenantId: string, ruleKey: string): Promise<RuleRegistryEntry[]> {
    const r = await this.pool.query(
      `SELECT * FROM rule_registry_entries
        WHERE tenant_id = $1 AND rule_key = $2
        ORDER BY version DESC`,
      [tenantId, ruleKey],
    );
    return r.rows.map(mapRow);
  }

  async setStatus(
    tenantId: string,
    id: string,
    status: "draft" | "active" | "retired",
    actor: ActorContext,
  ): Promise<RuleRegistryEntry> {
    return inGovernedTransaction(this.pool, tenantId, async (client: PoolClient) => {
      await requireTransactionActorPermission(client, actor, "config.manage");

      const updated = await client.query(
        `UPDATE rule_registry_entries
            SET status = $3,
                valid_to = CASE WHEN $3 IN ('superseded', 'retired') THEN now() ELSE valid_to END,
                updated_by = $4,
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2
            AND status <> 'retired'
          RETURNING *`,
        [id, tenantId, status, actor.userId],
      );
      if (!updated.rows[0]) throw new NotFoundError("RuleRegistryEntry", id);

      await recordGovernedAudit(client, {
        tenantId,
        actorUserId: actor.userId,
        action: "rule_registry.entry_status_changed",
        entityType: "rule_registry_entry",
        entityId: id,
        metadata: { status: status as RuleRegistryStatus },
      });

      return mapRow(updated.rows[0]);
    });
  }
}

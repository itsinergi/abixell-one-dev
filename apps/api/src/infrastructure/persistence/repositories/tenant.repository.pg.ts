import type { Pool } from "pg";
import type {
  CreateTenantInput,
  Tenant,
  TenantRepository,
  UpdatedTenantProfile,
  UpdateTenantInput,
} from "../../../domain/tenant/tenant.entity.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { NotFoundError } from "../../../domain/shared-kernel/errors.js";
import {
  inGovernedTransaction,
  recordGovernedAudit,
  requireTransactionActorPermission,
} from "./governed-transaction.js";

/** `UpdateTenantInput` field → column. Fixed, so the dynamic SET below can
 * never interpolate a caller-supplied identifier. */
const PROFILE_COLUMNS: ReadonlyArray<readonly [keyof UpdateTenantInput & string, string]> = [
  ["defaultTimezone", "default_timezone"],
  ["defaultLocale", "default_locale"],
  ["defaultCurrency", "default_currency"],
  ["contactAdminName", "contact_admin_name"],
  ["contactAdminEmail", "contact_admin_email"],
  ["contactAdminPhone", "contact_admin_phone"],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): Tenant {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    defaultTimezone: row.default_timezone ?? null,
    defaultLocale: row.default_locale ?? null,
    defaultCurrency: row.default_currency ?? null,
    contactAdminName: row.contact_admin_name ?? null,
    contactAdminEmail: row.contact_admin_email ?? null,
    contactAdminPhone: row.contact_admin_phone ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PgTenantRepository implements TenantRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateTenantInput, createdBy: string | null): Promise<Tenant> {
    const result = await this.pool.query(
      `INSERT INTO tenants (code, name, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING *`,
      [input.code, input.name, createdBy],
    );
    return mapRow(result.rows[0]);
  }

  async findById(id: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findByCode(code: string): Promise<Tenant | null> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE code = $1 AND deleted_at IS NULL`,
      [code],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /**
   * Profile update — the existing governed path, widened.
   *
   * The name-only behaviour is preserved exactly: only the columns whose keys
   * are present in `input` are written, so omitting a profile field leaves the
   * stored value alone and sending `null` clears it. The audit event still
   * carries `{ previousName, name }` for a name-only request, with the supplied
   * profile fields added beside them, and the response echoes exactly the
   * fields that were written.
   */
  async updateName(
    input: UpdateTenantInput,
    actor: ActorContext,
  ): Promise<UpdatedTenantProfile> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(client, actor, "tenant.update");

      const current = await client.query(
        `SELECT * FROM tenants WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [actor.tenantId],
      );
      if (!current.rows[0]) throw new NotFoundError("Tenant", actor.tenantId);

      const assignments: string[] = ["name = $1", "updated_by = $2", "updated_at = now()"];
      const values: unknown[] = [input.name, actor.userId];
      const written: UpdatedTenantProfile = { name: input.name };
      const auditMetadata: Record<string, unknown> = {
        previousName: current.rows[0].name,
        name: input.name,
      };

      for (const [field, column] of PROFILE_COLUMNS) {
        const value = input[field];
        if (value === undefined) continue;
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
        written[field] = value as string;
        auditMetadata[field] = value;
      }

      values.push(actor.tenantId);
      const updated = await client.query(
        `UPDATE tenants
            SET ${assignments.join(", ")}
          WHERE id = $${values.length}
            AND deleted_at IS NULL
        RETURNING *`,
        values,
      );
      if (!updated.rows[0]) throw new NotFoundError("Tenant", actor.tenantId);

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "tenant.updated",
        entityType: "tenant",
        entityId: actor.tenantId,
        metadata: auditMetadata,
      });

      const row = mapRow(updated.rows[0]);
      // Echo what was written, not the whole row: a caller that sent only a
      // name still gets `{ name }` back.
      written.name = row.name;
      return written;
    });
  }

  async list(): Promise<Tenant[]> {
    const result = await this.pool.query(
      `SELECT * FROM tenants WHERE deleted_at IS NULL ORDER BY created_at ASC`,
    );
    return result.rows.map(mapRow);
  }
}

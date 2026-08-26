import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";

/**
 * Test helpers mirror the REAL bootstrap flow for a brand-new dedicated
 * deployment: (1) Tenant is created via the platform-bootstrap endpoint
 * (shared secret, no user exists yet), then (2) the very first
 * Administrator is provisioned directly against the database — exactly
 * what a provisioning script would do, because there is no authenticated
 * user yet to call an API with. Every step after that goes through the
 * real HTTP API + RBAC, no shortcuts.
 */

export async function bootstrapTenant(app: FastifyInstance, code: string, name: string) {
  const response = await app.inject({
    method: "POST",
    url: "/tenants",
    headers: { "x-bootstrap-key": process.env.PLATFORM_BOOTSTRAP_KEY! },
    payload: { code, name },
  });
  if (response.statusCode !== 201) {
    throw new Error(`bootstrapTenant failed: ${response.statusCode} ${response.body}`);
  }
  return response.json() as { id: string; code: string };
}

export async function provisionFirstAdmin(params: {
  tenantId: string;
  email: string;
  password: string;
}) {
  const roleResult = await pool.query(
    `INSERT INTO roles (tenant_id, code, name, is_full_access) VALUES ($1, 'ADMIN', 'Administrator', true) RETURNING id`,
    [params.tenantId],
  );
  const roleId = roleResult.rows[0].id;

  const permissionRows = (await pool.query(`SELECT id FROM permissions`)).rows;
  for (const p of permissionRows) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [roleId, p.id],
    );
  }

  const passwordHash = await hashPassword(params.password);
  const userResult = await pool.query(
    `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, 'Test Admin') RETURNING id`,
    [params.tenantId, params.email, passwordHash],
  );
  const userId = userResult.rows[0].id;

  await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type) VALUES ($1, $2, 'tenant')`,
    [userId, roleId],
  );

  return { userId, roleId };
}

export async function createReadOnlyRole(tenantId: string, code: string, permissionCodes: string[]) {
  const roleResult = await pool.query(
    `INSERT INTO roles (tenant_id, code, name) VALUES ($1, $2, $2) RETURNING id`,
    [tenantId, code],
  );
  const roleId = roleResult.rows[0].id;
  const permissionRows = (
    await pool.query(`SELECT id FROM permissions WHERE code = ANY($1)`, [permissionCodes])
  ).rows;
  for (const p of permissionRows) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [roleId, p.id],
    );
  }
  return roleId as string;
}

export async function login(app: FastifyInstance, tenantCode: string, email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { tenantCode, email, password },
  });
  return { statusCode: response.statusCode, body: response.json() };
}

export async function createScheduledJobFixture(params: {
  jobCode: string;
  handlerKey: string;
  name: string;
}) {
  const result = await pool.query(
    `INSERT INTO scheduled_jobs
       (job_code, name, description, interval_seconds, handler_key, is_enabled)
     VALUES ($1, $2, 'Integration-test Scheduler fixture', 60, $3, true)
     RETURNING id`,
    [params.jobCode, params.name, params.handlerKey],
  );
  return result.rows[0].id as string;
}

export async function deleteScheduledJobFixture(jobCode: string) {
  await pool.query(`DELETE FROM scheduled_jobs WHERE job_code = $1`, [jobCode]);
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

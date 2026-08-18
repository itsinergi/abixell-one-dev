/**
 * Checkpoint 0B demo/testing seed.
 *
 * Creates one demo Tenant with a minimal but complete Identity &
 * Organization structure so the vertical slice (Tenant -> Legal Entity ->
 * Organization Unit -> User -> Auth -> RBAC -> Audit) can be exercised
 * from the thin frontend or integration tests without hand-crafting data
 * through the API every time.
 *
 * Idempotent: safe to re-run, skips creation if the demo Tenant already
 * exists.
 *
 * Usage: npm run seed -w apps/api
 */
import "dotenv/config";
import { pool } from "../src/infrastructure/persistence/db.js";
import { hashPassword } from "../src/infrastructure/security/password.js";

const DEMO_TENANT_CODE = "demo-gs";

async function main() {
  const existing = await pool.query("SELECT id FROM tenants WHERE code = $1", [
    DEMO_TENANT_CODE,
  ]);
  if (existing.rows[0]) {
    console.log(`Seed skipped: tenant '${DEMO_TENANT_CODE}' already exists.`);
    await pool.end();
    return;
  }

  const tenant = (
    await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, $2) RETURNING id`,
      [DEMO_TENANT_CODE, "Demo Enterprise Client"],
    )
  ).rows[0];

  const legalEntity = (
    await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, $2) RETURNING id`,
      [tenant.id, "Demo Legal Entity Pte Ltd"],
    )
  ).rows[0];

  const headOffice = (
    await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type)
       VALUES ($1, $2, NULL, $3, $4) RETURNING id`,
      [tenant.id, legalEntity.id, "Head Office", "Head Office"],
    )
  ).rows[0];

  const siteA = (
    await pool.query(
      `INSERT INTO organization_units (tenant_id, legal_entity_id, parent_id, name, unit_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenant.id, legalEntity.id, headOffice.id, "Site A", "Site"],
    )
  ).rows[0];

  const adminRole = (
    await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'ADMIN', 'Administrator') RETURNING id`,
      [tenant.id],
    )
  ).rows[0];

  const supervisorRole = (
    await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'SUPERVISOR', 'Site Supervisor') RETURNING id`,
      [tenant.id],
    )
  ).rows[0];

  const allPermissions = (await pool.query(`SELECT id FROM permissions`)).rows;
  for (const p of allPermissions) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [adminRole.id, p.id],
    );
  }

  // Supervisor: read-only. No *.create permissions — proves the backend
  // rejects create attempts from this role, not just hides the button.
  const readOnlyPermissionCodes = ["organization_unit.read", "user.read", "tenant.read"];
  const readOnlyPermissions = (
    await pool.query(`SELECT id FROM permissions WHERE code = ANY($1)`, [
      readOnlyPermissionCodes,
    ])
  ).rows;
  for (const p of readOnlyPermissions) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
      [supervisorRole.id, p.id],
    );
  }

  const adminPasswordHash = await hashPassword("Admin12345!");
  const admin = (
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, 'admin@demo.local', $2, 'Demo Administrator') RETURNING id`,
      [tenant.id, adminPasswordHash],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
     VALUES ($1, $2, 'tenant')`,
    [admin.id, adminRole.id],
  );

  const supervisorPasswordHash = await hashPassword("Supervisor12345!");
  const supervisor = (
    await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, 'supervisor@demo.local', $2, 'Demo Site Supervisor') RETURNING id`,
      [tenant.id, supervisorPasswordHash],
    )
  ).rows[0];
  await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, role_id, scope_type, scope_organization_unit_id)
     VALUES ($1, $2, 'organization_unit', $3)`,
    [supervisor.id, supervisorRole.id, siteA.id],
  );

  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, NULL, 'tenant.seeded', 'tenant', $1, $2)`,
    [tenant.id, JSON.stringify({ source: "seed script" })],
  );

  console.log("Seed complete:");
  console.log(`  Tenant code:        ${DEMO_TENANT_CODE}`);
  console.log(`  Legal Entity:       ${legalEntity.id}`);
  console.log(`  Organization Units: Head Office=${headOffice.id}, Site A=${siteA.id}`);
  console.log(`  Admin login:        admin@demo.local / Admin12345! (tenant-wide scope)`);
  console.log(
    `  Supervisor login:   supervisor@demo.local / Supervisor12345! (Site A scope only, read-only permissions)`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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

  // Supervisor: read-only. No *.create/*.manage permissions — proves the
  // backend rejects create/manage attempts from this role, not just
  // hides the button.
  const readOnlyPermissionCodes = [
    "organization_unit.read",
    "user.read",
    "tenant.read",
    "config.read",
  ];
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

  // --- Checkpoint 0C: Configuration & Metadata demo data ---------------------
  // Demonstrates that Module Activation, Feature Flags (with Configuration
  // Scope precedence), Terminology, Reference Data, and Numbering are all
  // genuinely tenant-specific -- nothing here is hardcoded in Product Core,
  // it is all rows created for THIS demo tenant against the Product Core
  // catalog seeded by the migration.

  // Module Activation: activate "customer_complaint" for this tenant only.
  const complaintModule = (
    await pool.query(`SELECT id FROM modules WHERE code = 'customer_complaint'`)
  ).rows[0];
  if (complaintModule) {
    await pool.query(
      `INSERT INTO tenant_module_activations (tenant_id, module_id, is_active)
       VALUES ($1, $2, true)`,
      [tenant.id, complaintModule.id],
    );
  }

  // Feature Flag: set a tenant-wide value, then override it at Site A to
  // prove Configuration Scope precedence (Organization Unit > Tenant).
  const offlineFlag = (
    await pool.query(`SELECT id FROM feature_flags WHERE code = 'offline_field_mode'`)
  ).rows[0];
  if (offlineFlag) {
    await pool.query(
      `INSERT INTO tenant_feature_flags
         (tenant_id, feature_flag_id, scope_type, scope_organization_unit_id, is_enabled)
       VALUES ($1, $2, 'tenant', NULL, false)`,
      [tenant.id, offlineFlag.id],
    );
    await pool.query(
      `INSERT INTO tenant_feature_flags
         (tenant_id, feature_flag_id, scope_type, scope_organization_unit_id, is_enabled)
       VALUES ($1, $2, 'organization_unit', $3, true)`,
      [tenant.id, offlineFlag.id, siteA.id],
    );
  }

  // Terminology: rename "Organization Unit" to a client-specific term to
  // prove UI labels come from Terminology, not hardcoded strings.
  const orgUnitTerm = (
    await pool.query(`SELECT id FROM terminology_keys WHERE code = 'organization_unit.label'`)
  ).rows[0];
  if (orgUnitTerm) {
    await pool.query(
      `INSERT INTO tenant_terminology_overrides (tenant_id, terminology_key_id, value)
       VALUES ($1, $2, 'Site')`,
      [tenant.id, orgUnitTerm.id],
    );
  }

  // Reference Data: seed two Priority Level items for this tenant.
  const priorityType = (
    await pool.query(`SELECT id FROM reference_data_types WHERE code = 'priority_level'`)
  ).rows[0];
  if (priorityType) {
    await pool.query(
      `INSERT INTO tenant_reference_data_items
         (tenant_id, reference_data_type_id, code, label, sort_order)
       VALUES ($1, $2, 'high', 'High', 1), ($1, $2, 'low', 'Low', 2)`,
      [tenant.id, priorityType.id],
    );
  }

  // Numbering: a tenant-specific ticket numbering sequence, e.g.
  // TCK-2026-00001, proving numbering patterns are per-tenant configuration.
  await pool.query(
    `INSERT INTO numbering_sequences (tenant_id, code, pattern, current_sequence)
     VALUES ($1, 'demo_ticket', 'TCK-{YYYY}-{SEQ:5}', 0)`,
    [tenant.id],
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

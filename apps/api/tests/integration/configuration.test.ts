import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  authHeader,
  bootstrapTenant,
  createReadOnlyRole,
  login,
  provisionFirstAdmin,
} from "./helpers.js";

/**
 * Checkpoint 0C integration test — proves the Configuration & Metadata
 * Foundation end-to-end:
 *
 *   Schema Registry (Ajv validation) -> Module Activation -> Feature Flags
 *   with Configuration Scope precedence -> Terminology -> Reference Data
 *   -> Numbering -> Configuration Audit -> PostgreSQL
 *
 * Runs against the real PostgreSQL database, same pattern as the 0B
 * vertical-slice suite: no mocking, direct `pool` assertions at the end
 * confirm data actually landed, not just that the API responded 2xx.
 */

const TENANT_CODE = `test-0c-${Date.now()}`;

describe("Checkpoint 0C — Configuration & Metadata Foundation", () => {
  const app = buildApp();
  let tenantId: string;
  let adminToken: string;
  let legalEntityId: string;
  let headOfficeId: string;
  let siteId: string;

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant 0C");
    tenantId = tenant.id;
    await provisionFirstAdmin({
      tenantId,
      email: "admin@test-0c.local",
      password: "AdminPass123!",
    });

    const loginResult = await login(app, TENANT_CODE, "admin@test-0c.local", "AdminPass123!");
    adminToken = loginResult.body.accessToken;

    const legalEntityResponse = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { name: "Test Legal Entity 0C" },
    });
    legalEntityId = legalEntityResponse.json().id;

    const headOfficeResponse = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, name: "Head Office" },
    });
    headOfficeId = headOfficeResponse.json().id;

    const siteResponse = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, parentId: headOfficeId, name: "Site A", unitType: "Site" },
    });
    siteId = siteResponse.json().id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await app.close();
  });

  it("lists the Product Core Module catalog with none activated for a fresh Tenant", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/config/modules",
      headers: authHeader(adminToken),
    });
    expect(response.statusCode).toBe(200);
    const modules = response.json();
    expect(modules.some((m: { moduleCode: string }) => m.moduleCode === "customer_complaint")).toBe(
      true,
    );
    expect(modules.every((m: { isActive: boolean }) => m.isActive === false)).toBe(true);
  });

  it("activates a Module for this Tenant only and persists it in tenant_module_activations", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/config/modules/customer_complaint",
      headers: authHeader(adminToken),
      payload: { isActive: true },
    });
    expect(response.statusCode).toBe(200);

    const row = await pool.query(
      `SELECT tma.is_active FROM tenant_module_activations tma
       JOIN modules m ON m.id = tma.module_id
       WHERE tma.tenant_id = $1 AND m.code = 'customer_complaint'`,
      [tenantId],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].is_active).toBe(true);
  });

  it("resolves Feature Flags with Configuration Scope precedence: Organization Unit overrides Tenant overrides catalog default", async () => {
    // catalog default for offline_field_mode is false
    let effective = await app.inject({
      method: "GET",
      url: `/config/feature-flags/effective?organizationUnitId=${siteId}`,
      headers: authHeader(adminToken),
    });
    expect(effective.json().find((f: { code: string }) => f.code === "offline_field_mode")).toMatchObject(
      { isEnabled: false, source: "catalog_default" },
    );

    // set tenant-level override -> true
    const tenantSet = await app.inject({
      method: "PUT",
      url: "/config/feature-flags/offline_field_mode",
      headers: authHeader(adminToken),
      payload: { isEnabled: true, scopeType: "tenant" },
    });
    expect(tenantSet.statusCode).toBe(200);

    effective = await app.inject({
      method: "GET",
      url: `/config/feature-flags/effective?organizationUnitId=${siteId}`,
      headers: authHeader(adminToken),
    });
    expect(effective.json().find((f: { code: string }) => f.code === "offline_field_mode")).toMatchObject(
      { isEnabled: true, source: "tenant" },
    );

    // set organization_unit-level override at Site A -> false (opposite of tenant)
    const orgUnitSet = await app.inject({
      method: "PUT",
      url: "/config/feature-flags/offline_field_mode",
      headers: authHeader(adminToken),
      payload: {
        isEnabled: false,
        scopeType: "organization_unit",
        scopeOrganizationUnitId: siteId,
      },
    });
    expect(orgUnitSet.statusCode).toBe(200);

    // Site A now resolves to the org-unit override, not the tenant value
    effective = await app.inject({
      method: "GET",
      url: `/config/feature-flags/effective?organizationUnitId=${siteId}`,
      headers: authHeader(adminToken),
    });
    expect(effective.json().find((f: { code: string }) => f.code === "offline_field_mode")).toMatchObject(
      { isEnabled: false, source: "organization_unit" },
    );

    // Head Office (no org-unit override) still resolves to the tenant value
    const headOfficeEffective = await app.inject({
      method: "GET",
      url: `/config/feature-flags/effective?organizationUnitId=${headOfficeId}`,
      headers: authHeader(adminToken),
    });
    expect(
      headOfficeEffective.json().find((f: { code: string }) => f.code === "offline_field_mode"),
    ).toMatchObject({ isEnabled: true, source: "tenant" });
  });

  it("enforces the Schema Registry via Ajv: rejects an out-of-schema Terminology value", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/config/terminology/legal_entity.label",
      headers: authHeader(adminToken),
      payload: { value: "" }, // schema requires minLength 1
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Schema Registry validation");
  });

  it("accepts a valid Terminology override and it is reflected in the catalog", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/config/terminology/organization_unit.label",
      headers: authHeader(adminToken),
      payload: { value: "Site" },
    });
    expect(response.statusCode).toBe(204);

    const list = await app.inject({
      method: "GET",
      url: "/config/terminology",
      headers: authHeader(adminToken),
    });
    const entry = list
      .json()
      .find((t: { code: string }) => t.code === "organization_unit.label");
    expect(entry).toMatchObject({ value: "Site", isOverridden: true });
  });

  it("creates a Reference Data item and rejects a duplicate code with 409 (not a 500)", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/config/reference-data/priority_level",
      headers: authHeader(adminToken),
      payload: { code: "urgent", label: "Urgent", sortOrder: 1 },
    });
    expect(created.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: "/config/reference-data/priority_level",
      headers: authHeader(adminToken),
      payload: { code: "urgent", label: "Urgent Again" },
    });
    expect(duplicate.statusCode).toBe(409);

    const rows = await pool.query(
      `SELECT * FROM tenant_reference_data_items WHERE tenant_id = $1 AND code = 'urgent'`,
      [tenantId],
    );
    expect(rows.rows).toHaveLength(1); // duplicate was rejected, not double-inserted
  });

  it("generates atomically-incrementing Numbers from a Tenant-specific pattern", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/config/numbering/complaint_ticket",
      headers: authHeader(adminToken),
      payload: { pattern: "CMP-{YYYY}-{SEQ:4}" },
    });
    expect(created.statusCode).toBe(201);

    const first = await app.inject({
      method: "POST",
      url: "/config/numbering/complaint_ticket/generate",
      headers: authHeader(adminToken),
    });
    const second = await app.inject({
      method: "POST",
      url: "/config/numbering/complaint_ticket/generate",
      headers: authHeader(adminToken),
    });
    expect(first.json().sequence).toBe(1);
    expect(second.json().sequence).toBe(2);
    expect(second.json().number).toMatch(/^CMP-\d{4}-0002$/);

    const row = await pool.query(
      `SELECT current_sequence FROM numbering_sequences WHERE tenant_id = $1 AND code = 'complaint_ticket'`,
      [tenantId],
    );
    expect(Number(row.rows[0].current_sequence)).toBe(2);
  });

  it("REJECTS a read-only Role's attempt to mutate Configuration (403, backend-enforced)", async () => {
    await createReadOnlyRole(tenantId, "AUDITOR", ["config.read"]);
    const auditorPasswordResponse = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "auditor@test-0c.local",
        fullName: "Test Auditor",
        password: "AuditorPass123!",
        roleCode: "AUDITOR",
        scopeType: "tenant",
      },
    });
    expect(auditorPasswordResponse.statusCode).toBe(201);

    const auditorLogin = await login(app, TENANT_CODE, "auditor@test-0c.local", "AuditorPass123!");
    expect(auditorLogin.statusCode).toBe(200);

    const readResponse = await app.inject({
      method: "GET",
      url: "/config/modules",
      headers: authHeader(auditorLogin.body.accessToken),
    });
    expect(readResponse.statusCode).toBe(200);

    const writeResponse = await app.inject({
      method: "PUT",
      url: "/config/modules/survey_assessment",
      headers: authHeader(auditorLogin.body.accessToken),
      payload: { isActive: true },
    });
    expect(writeResponse.statusCode).toBe(403);

    const row = await pool.query(
      `SELECT tma.* FROM tenant_module_activations tma
       JOIN modules m ON m.id = tma.module_id
       WHERE tma.tenant_id = $1 AND m.code = 'survey_assessment'`,
      [tenantId],
    );
    expect(row.rows).toHaveLength(0); // nothing was written despite the attempt
  });

  it("records a Configuration Audit entry for every mutating action performed above", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/audit-log/recent",
      headers: authHeader(adminToken),
    });
    const actions = response.json().map((e: { action: string }) => e.action);

    expect(actions).toContain("config.module_activation.changed");
    expect(actions).toContain("config.feature_flag.changed");
    expect(actions).toContain("config.terminology.changed");
    expect(actions).toContain("config.reference_data_item.created");
    expect(actions).toContain("config.numbering_sequence.created");
    expect(actions).toContain("config.numbering.generated");
  });
});

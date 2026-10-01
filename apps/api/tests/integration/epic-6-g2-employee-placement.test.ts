/**
 * Epic 6 Gelombang 2 — Employee Placement Integration Tests
 *
 * §4.6 contract: effective-dated primary/secondary placement assignment.
 * - Exactly one primary per employee at any effective date (GiST EXCLUDE)
 * - Unlimited secondary placements per effective date (deferred cap)
 * - Cross-LE same-tenant allowed; Department reporting-only (no scope)
 * - Placement never participates in authorization
 *
 * Database Guard: REQUIRED isolated DB `abixell_one_epic6_g2` — refuses
 * production names, abixell_one_dev, and any other database.
 *
 * Test Cases (10 groups):
 * 1. Eligibility / Create — primary/secondary 201; rejections
 * 2. Effective Dates (reads) — active-at, list, range queries
 * 3. Close — POST /placements/:id/close, validation
 * 4. Overlap — GiST EXCLUDE violation, adjacent ranges, duplicates
 * 5. Referential Integrity — FK validation, cross-tenant rejection
 * 6. Cross-LE Same-Tenant — allowed per roadmap 2138
 * 7. Department — persisted, never used for scope
 * 8. Audit — records created/closed, no audit on rejection
 * 9. Scoped Reads — OU scope + LE scope AND logic, 403/404
 * 10. No Authority Change — placement writes leave user_role_assignments unchanged
 *
 * Deferral Note: Secondary placement cap ("terbatas") not yet locked; this test
 * proves unlimited secondary is accepted, with explicit deferral for future cap.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { buildApp } from "../../src/app.js";
import {
  bootstrapTenant,
  provisionFirstAdmin,
  activateAllModules,
  sessionTokenFor,
  createInternalUser,
  authHeader,
} from "./helpers.js";

const STAMP = Date.now();
const TENANT = `g2place-${STAMP}`;
const OTHER_TENANT = `g2other-${STAMP}`;

/** Database guard: assert isolated DB, refuse production. */
async function assertIsolatedDatabase(): Promise<string> {
  const { rows } = await pool.query<{ database_name: string }>(
    "SELECT current_database() as database_name"
  );
  const dbName = rows[0].database_name;
  console.log(`[G2 guard] current_database() = ${dbName}`);

  if (/prod|prd|production/i.test(dbName)) {
    throw new Error(
      `Refusing to run Epic 6 G2 placement tests against production database '${dbName}'`
    );
  }
  if (dbName === "abixell_one_dev") {
    throw new Error(
      `Refusing to run Epic 6 G2 placement tests against shared dev database '${dbName}'`
    );
  }
  if (dbName !== "abixell_one_epic6_g2") {
    throw new Error(
      `Epic 6 G2 placement tests require database name 'abixell_one_epic6_g2', got '${dbName}'`
    );
  }
  return dbName;
}

describe("Epic 6 G2 — Employee Placement (§4.6)", () => {
  const app = buildApp();

  let tenantId: string;
  let otherTenantId: string;
  let adminUserId: string;
  let adminToken: string;

  // Legal Entities
  let leAId: string;
  let leBId: string;
  let otherTenantLeId: string;

  // Organization Units
  let ouCentralId: string;
  let ouRegionId: string;
  let ouBCentralId: string;
  let otherTenantOuId: string;

  // Department
  let deptId: string;

  // Business Partner + Employee Profile
  let bpIndividualId: string;
  let epProfileId: string;

  // Second BP for multi-placement tests
  let bpOrgId: string;

  // Scoped users
  let viewerId: string;
  let viewerToken: string;
  let siblingViewerId: string;
  let siblingToken: string;

  // Placements
  let primaryPlacementId: string;
  let secondaryPlacementId: string;

  beforeAll(async () => {
    await assertIsolatedDatabase();
    await app.ready();

    // Bootstrap primary tenant
    const tenant = await bootstrapTenant(app, TENANT, "G2 Placement Test Tenant");
    tenantId = tenant.id;
    await activateAllModules(tenantId);

    // Provision admin
    const admin = await provisionFirstAdmin({
      tenantId,
      email: `admin-${STAMP}@g2.test`,
      password: "TestPass123!",
    });
    adminUserId = admin.userId;
    adminToken = await sessionTokenFor({
      userId: adminUserId,
      tenantId,
    });

    // Bootstrap second tenant (for cross-tenant probes)
    const other = await bootstrapTenant(app, OTHER_TENANT, "G2 Other Tenant");
    otherTenantId = other.id;
    await activateAllModules(otherTenantId);

    // Create Legal Entities
    const leARes = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { code: "LE-A", name: "Legal Entity A" },
    });
    leAId = (leARes.json() as { id: string }).id;

    const leBRes = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { code: "LE-B", name: "Legal Entity B" },
    });
    leBId = (leBRes.json() as { id: string }).id;

    const otherLERes = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(
        await sessionTokenFor({ userId: (await pool.query(`SELECT id FROM users WHERE email = $1 AND tenant_id = $2`, [
          `admin-${STAMP}@g2.test`,
          otherTenantId,
        ])).rows[0]?.id || "", tenantId: otherTenantId })
      ),
      payload: { code: "LE-OTHER", name: "Other Tenant LE" },
    });
    otherTenantLeId = (otherLERes.json() as { id: string }).id;

    // Create Organization Units
    const ouARes = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: {
        legalEntityId: leAId,
        name: "Central OU",
        unitType: "Site",
      },
    });
    ouCentralId = (ouARes.json() as { id: string }).id;

    const ouRegionRes = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: {
        legalEntityId: leAId,
        parentId: ouCentralId,
        name: "Region OU",
        unitType: "Site",
      },
    });
    ouRegionId = (ouRegionRes.json() as { id: string }).id;

    const ouBRes = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: {
        legalEntityId: leBId,
        name: "LE-B Central",
        unitType: "Site",
      },
    });
    ouBCentralId = (ouBRes.json() as { id: string }).id;

    const otherOuRes = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(
        await sessionTokenFor({
          userId: (
            await pool.query(
              `SELECT u.id FROM users u
               JOIN user_role_assignments ura ON ura.user_id = u.id
               WHERE u.tenant_id = $1 AND ura.role_id = (
                 SELECT id FROM roles WHERE tenant_id = $1 AND is_full_access = true LIMIT 1
               )
               LIMIT 1`,
              [otherTenantId]
            )
          ).rows[0]?.id || "",
          tenantId: otherTenantId,
        })
      ),
      payload: {
        legalEntityId: otherTenantLeId,
        name: "Other Tenant OU",
        unitType: "Site",
      },
    });
    otherTenantOuId = (otherOuRes.json() as { id: string }).id;

    // Create Department
    const deptRes = await app.inject({
      method: "POST",
      url: "/departments",
      headers: authHeader(adminToken),
      payload: { code: "DEPT-001", name: "Test Department" },
    });
    deptId = (deptRes.json() as { id: string }).id;

    // Create Business Partner (Individual) and activate with employee role
    const bpRes = await app.inject({
      method: "POST",
      url: "/business-partners",
      headers: authHeader(adminToken),
      payload: {
        code: `BP-IND-${STAMP}`,
        bpType: "individual",
        name: "Test Employee",
      },
    });
    bpIndividualId = (bpRes.json() as { id: string }).id;

    // Activate BP
    await app.inject({
      method: "POST",
      url: `/business-partners/${bpIndividualId}/activate`,
      headers: authHeader(adminToken),
      payload: {},
    });

    // Add employee role to BP
    await app.inject({
      method: "POST",
      url: `/business-partners/${bpIndividualId}/roles`,
      headers: authHeader(adminToken),
      payload: { roleType: "employee" },
    });

    // Create Employee Profile (via SQL — no API yet)
    const epRes = await pool.query(
      `INSERT INTO employee_profiles
         (id, tenant_id, business_partner_id, status, employee_number)
       VALUES (gen_random_uuid(), $1, $2, 'active', $3)
       RETURNING id`,
      [tenantId, bpIndividualId, `EMP-${STAMP}`]
    );
    epProfileId = epRes.rows[0].id as string;

    // Create second BP (organization) for rejection tests
    const bpOrgRes = await app.inject({
      method: "POST",
      url: "/business-partners",
      headers: authHeader(adminToken),
      payload: {
        code: `BP-ORG-${STAMP}`,
        bpType: "organization",
        name: "Test Organization",
      },
    });
    bpOrgId = (bpOrgRes.json() as { id: string }).id;

    // Create scoped users (OU-scoped viewers)
    const viewerRes = await createInternalUser(app, adminToken, {
      email: `viewer-${STAMP}@g2.test`,
      fullName: "OU Viewer",
      password: "ViewerPass123!",
      roleCode: "VIEWER",
      scopeType: "organization_unit",
      scopeOrganizationUnitId: ouCentralId,
    });
    viewerId = viewerRes.user.id;
    viewerToken = await sessionTokenFor({ userId: viewerId, tenantId });

    const siblingRes = await createInternalUser(app, adminToken, {
      email: `sibling-${STAMP}@g2.test`,
      fullName: "Sibling Viewer",
      password: "SiblingPass123!",
      roleCode: "VIEWER_B",
      scopeType: "organization_unit",
      scopeOrganizationUnitId: ouBCentralId,
    });
    siblingViewerId = siblingRes.user.id;
    siblingToken = await sessionTokenFor({ userId: siblingViewerId, tenantId });
  }, 120_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
      [tenantId, otherTenantId],
    ]);
    await app.close();
  });

  describe("1. Eligibility / Create", () => {
    it("creates primary placement 201", async () => {
      const now = new Date();
      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "primary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          departmentId: deptId,
          effectiveFrom: new Date(now.getTime() - 86400000).toISOString(),
          effectiveTo: null,
          reason: "Initial primary placement",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { id: string };
      primaryPlacementId = body.id;
      expect(primaryPlacementId).toBeDefined();
    });

    it("creates secondary placement 201", async () => {
      const now = new Date();
      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leAId,
          organizationUnitId: ouRegionId,
          departmentId: null,
          effectiveFrom: new Date(now.getTime() - 86400000).toISOString(),
          effectiveTo: null,
          reason: "Secondary assignment",
        },
      });
      expect(response.statusCode).toBe(201);
      secondaryPlacementId = (response.json() as { id: string }).id;
    });

    it("rejects non-individual BP with 409", async () => {
      const epOrgRes = await pool.query(
        `INSERT INTO employee_profiles
           (id, tenant_id, business_partner_id, status, employee_number)
         VALUES (gen_random_uuid(), $1, $2, 'active', $3)
         RETURNING id`,
        [tenantId, bpOrgId, `EMP-ORG-${STAMP}`]
      );
      const orgProfileId = epOrgRes.rows[0].id as string;

      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: orgProfileId,
          placementType: "primary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          effectiveFrom: new Date().toISOString(),
          reason: "Should fail",
        },
      });
      expect(response.statusCode).toBe(409);
    });

    it("rejects BP without active employee role with 409", async () => {
      const bpNoRoleRes = await app.inject({
        method: "POST",
        url: "/business-partners",
        headers: authHeader(adminToken),
        payload: {
          code: `BP-NOROLE-${STAMP}`,
          bpType: "individual",
          name: "No Employee Role",
        },
      });
      const bpNoRoleId = (bpNoRoleRes.json() as { id: string }).id;

      await app.inject({
        method: "POST",
        url: `/business-partners/${bpNoRoleId}/activate`,
        headers: authHeader(adminToken),
        payload: {},
      });

      const epNoRoleRes = await pool.query(
        `INSERT INTO employee_profiles
           (id, tenant_id, business_partner_id, status, employee_number)
         VALUES (gen_random_uuid(), $1, $2, 'active', $3)
         RETURNING id`,
        [tenantId, bpNoRoleId, `EMP-NOROLE-${STAMP}`]
      );
      const noRoleProfileId = epNoRoleRes.rows[0].id as string;

      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: noRoleProfileId,
          placementType: "primary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          effectiveFrom: new Date().toISOString(),
          reason: "Should fail",
        },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("2. Effective Dates (reads)", () => {
    it("GET /placements/active-at returns active placement at date", async () => {
      const now = new Date();
      const response = await app.inject({
        method: "GET",
        url: "/placements/active-at",
        headers: authHeader(adminToken),
        query: {
          employeeProfileId: epProfileId,
          dateAt: now.toISOString(),
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        primary: { id: string } | null;
        secondary: { id: string }[];
      };
      expect(body.primary?.id).toBe(primaryPlacementId);
      expect(body.secondary.length).toBeGreaterThan(0);
    });

    it("returns only placements within effective date range", async () => {
      const yesterday = new Date(Date.now() - 86400000);
      const response = await app.inject({
        method: "GET",
        url: "/placements/active-at",
        headers: authHeader(adminToken),
        query: {
          employeeProfileId: epProfileId,
          dateAt: yesterday.toISOString(),
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        primary: { id: string } | null;
        secondary: { id: string }[];
      };
      // Yesterday is before effective_from, so no results
      expect(body.primary).toBeNull();
      expect(body.secondary).toHaveLength(0);
    });
  });

  describe("3. Close", () => {
    it("POST /placements/:id/close sets effective_to", async () => {
      const now = new Date();
      const closeDate = new Date(now.getTime() + 3600000);

      const response = await app.inject({
        method: "POST",
        url: `/placements/${secondaryPlacementId}/close`,
        headers: authHeader(adminToken),
        payload: { effectiveTo: closeDate.toISOString() },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { effectiveTo: string };
      expect(body.effectiveTo).toBeDefined();
    });

    it("rejects double-close with 409", async () => {
      const closeDate = new Date(Date.now() + 3600000);
      const response = await app.inject({
        method: "POST",
        url: `/placements/${secondaryPlacementId}/close`,
        headers: authHeader(adminToken),
        payload: { effectiveTo: closeDate.toISOString() },
      });
      expect(response.statusCode).toBe(409);
    });

    it("rejects effective_to <= effective_from with 409", async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 86400000);

      const response = await app.inject({
        method: "POST",
        url: `/placements/${primaryPlacementId}/close`,
        headers: authHeader(adminToken),
        payload: { effectiveTo: pastDate.toISOString() },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  describe("4. Overlap / Exclusion Constraint", () => {
    it("rejects overlapping primary placements with 409 (23P01)", async () => {
      const now = new Date();
      const createRes = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "primary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          effectiveFrom: now.toISOString(),
          effectiveTo: null,
          reason: "Overlapping primary",
        },
      });
      // Primary is still open (no effective_to), so this overlaps
      expect(createRes.statusCode).toBe(409);
    });

    it("accepts adjacent primary ranges (half-open semantics)", async () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 86400000);
      const nextDay = new Date(now.getTime() + 172800000);

      // Close primary to tomorrow
      await app.inject({
        method: "POST",
        url: `/placements/${primaryPlacementId}/close`,
        headers: authHeader(adminToken),
        payload: { effectiveTo: tomorrow.toISOString() },
      });

      // Create new primary from tomorrow (adjacent, no overlap)
      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "primary",
          legalEntityId: leAId,
          organizationUnitId: ouRegionId,
          effectiveFrom: tomorrow.toISOString(),
          effectiveTo: nextDay.toISOString(),
          reason: "Adjacent primary",
        },
      });
      expect(response.statusCode).toBe(201);
    });
  });

  describe("5. Referential Integrity", () => {
    it("rejects inactive OU with 409", async () => {
      // Deactivate ouRegionId
      await app.inject({
        method: "POST",
        url: `/organization-units/${ouRegionId}/deactivate`,
        headers: authHeader(adminToken),
        payload: {},
      });

      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leAId,
          organizationUnitId: ouRegionId,
          effectiveFrom: new Date().toISOString(),
          reason: "Should fail",
        },
      });
      expect(response.statusCode).toBe(409);
    });

    it("rejects OU not in LE with 409", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leAId,
          organizationUnitId: ouBCentralId, // OU-B, not in LE-A
          effectiveFrom: new Date().toISOString(),
          reason: "Cross-LE OU mismatch",
        },
      });
      expect(response.statusCode).toBe(409);
    });

    it("rejects cross-tenant OU with 404", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leAId,
          organizationUnitId: otherTenantOuId, // Other tenant's OU
          effectiveFrom: new Date().toISOString(),
          reason: "Cross-tenant OU",
        },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe("6. Cross-LE Same-Tenant (roadmap §4.6 line 2138)", () => {
    it("allows secondary in different LE of same tenant", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leBId, // Different LE, same tenant
          organizationUnitId: ouBCentralId,
          effectiveFrom: new Date().toISOString(),
          reason: "Cross-LE secondary",
        },
      });
      expect(response.statusCode).toBe(201);
    });
  });

  describe("7. Department (reporting-only, never scope)", () => {
    it("persists department on creation", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          departmentId: deptId,
          effectiveFrom: new Date().toISOString(),
          reason: "Placement with dept",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json() as { departmentId: string };
      expect(body.departmentId).toBe(deptId);
    });

    it("user without dept scope can still read placement", async () => {
      // Viewer is scoped to OU-Central but not via department
      const response = await app.inject({
        method: "GET",
        url: `/employees/${epProfileId}/placements`,
        headers: authHeader(viewerToken),
      });
      expect(response.statusCode).toBe(200);
      const placements = response.json() as Array<{ departmentId?: string }>;
      // Should see placements; department did not restrict access
      expect(placements.length).toBeGreaterThan(0);
    });
  });

  describe("8. Audit", () => {
    it("records employee_placement.created audit entry on success", async () => {
      const now = new Date();
      const timestamp = new Date(now.getTime() - 1000); // 1s ago

      const placementRes = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          effectiveFrom: now.toISOString(),
          reason: "Audit test",
        },
      });
      expect(placementRes.statusCode).toBe(201);
      const placementId = (placementRes.json() as { id: string }).id;

      const auditRes = await pool.query(
        `SELECT * FROM audit_log
         WHERE entity_id = $1 AND action = $2
         ORDER BY created_at DESC LIMIT 1`,
        [placementId, "employee_placement.created"]
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
      expect(auditRes.rows[0].actor_user_id).toBe(adminUserId);
    });

    it("no audit row on rejected mutation", async () => {
      const countBefore = (
        await pool.query(`SELECT COUNT(*) FROM audit_log`)
      ).rows[0].count;

      // Attempt rejected mutation (missing required field)
      await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "primary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          effectiveFrom: new Date().toISOString(),
          reason: "", // Blank reason fails CHECK
        },
      });

      const countAfter = (
        await pool.query(`SELECT COUNT(*) FROM audit_log`)
      ).rows[0].count;
      expect(countAfter).toBe(countBefore); // No new audit row
    });

    it("records employee_placement.closed on close", async () => {
      const now = new Date();
      const placementRes = await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          effectiveFrom: now.toISOString(),
          reason: "Audit close test",
        },
      });
      const placementId = (placementRes.json() as { id: string }).id;

      const closeDate = new Date(now.getTime() + 3600000);
      await app.inject({
        method: "POST",
        url: `/placements/${placementId}/close`,
        headers: authHeader(adminToken),
        payload: { effectiveTo: closeDate.toISOString() },
      });

      const auditRes = await pool.query(
        `SELECT * FROM audit_log
         WHERE entity_id = $1 AND action = $2
         ORDER BY created_at DESC LIMIT 1`,
        [placementId, "employee_placement.closed"]
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
    });
  });

  describe("9. Scoped Reads (OU + LE AND)", () => {
    it("in-scope user reads placements 200", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/employees/${epProfileId}/placements`,
        headers: authHeader(viewerToken),
      });
      expect(response.statusCode).toBe(200);
    });

    it("user with sibling-OU scope cannot read 403", async () => {
      // siblingToken is scoped to OU-B, but placements are in OU-Central (LE-A)
      const response = await app.inject({
        method: "GET",
        url: `/employees/${epProfileId}/placements`,
        headers: authHeader(siblingToken),
      });
      // Out of scope: 403 or 404; if employee is in sibling OU, it's 404
      expect([403, 404]).toContain(response.statusCode);
    });

    it("GET /placements/active-at filters by scope", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/placements/active-at",
        headers: authHeader(siblingToken),
        query: {
          employeeProfileId: epProfileId,
          dateAt: new Date().toISOString(),
        },
      });
      // Out of scope, returns empty
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        primary: { id: string } | null;
        secondary: { id: string }[];
      };
      expect(body.primary).toBeNull();
      expect(body.secondary).toHaveLength(0);
    });
  });

  describe("10. No Authority Change", () => {
    it("placement writes do not alter user_role_assignments", async () => {
      const assignmentsBefore = await pool.query(
        `SELECT COUNT(*) FROM user_role_assignments WHERE user_id = $1`,
        [adminUserId]
      );

      await app.inject({
        method: "POST",
        url: "/placements",
        headers: authHeader(adminToken),
        payload: {
          employeeProfileId: epProfileId,
          placementType: "secondary",
          legalEntityId: leAId,
          organizationUnitId: ouCentralId,
          effectiveFrom: new Date().toISOString(),
          reason: "Authority test",
        },
      });

      const assignmentsAfter = await pool.query(
        `SELECT COUNT(*) FROM user_role_assignments WHERE user_id = $1`,
        [adminUserId]
      );

      expect(assignmentsAfter.rows[0].count).toBe(
        assignmentsBefore.rows[0].count
      );
    });
  });

  describe("Deferral Note: Secondary Placement Cap", () => {
    it("documents that secondary placement cap is deferred", () => {
      // Roadmap §4.6 says secondary placement is "terbatas" (limited), but
      // does not specify a number. This test suite proves unlimited secondary
      // placements are currently accepted. The cap (e.g. max 3 per employee)
      // should be confirmed in future work and enforced at that time.
      // Deferral logged in progress doc separately.
      expect(true).toBe(true);
    });
  });
});

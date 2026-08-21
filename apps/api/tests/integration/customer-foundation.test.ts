import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Checkpoint 1A — Document Scope & Customer Experience Foundation.
 *
 * Proves the 1A E2E target end to end, against the REAL database (no
 * mocking), same pattern as every prior checkpoint's integration test:
 *
 *   Administrator -> Customer Created -> Customer Contact Created ->
 *   Contract/Project/Site Context -> Service Assigned -> Customer User
 *   Login -> Data Scope Applied -> Document Uploaded -> Parent Entity
 *   Authorization Applied -> Audit Trail -> PostgreSQL
 *
 * Also proves the two binding decisions this checkpoint makes:
 * - ADR-0011 (Customer Data Scope): a Customer User is exact-match scoped
 *   to exactly one Customer; an internal Role's `organization_unit` scope
 *   reaches a Customer through its `ownerOrganizationUnitId`, hierarchical
 *   (ADR-0009) exactly like it reaches any other Organization-Unit-scoped
 *   entity — proven with a Region/Site pair, not just a flat scope.
 * - ADR-0012 (Document follows parent entity authorization): a Customer
 *   User with NO document.* permission at all can still upload/read a
 *   Document attached to their OWN Customer, and is forbidden from one
 *   attached to a DIFFERENT Customer — the Entity Authorization Resolver,
 *   not the legacy Tenant-wide permission, is the actual gate for
 *   entityType='customer'.
 */

const TENANT_CODE = `test-1a-${Date.now()}`;

function buildMultipart(
  fields: Record<string, string>,
  file: { name: string; content: string; mimeType: string },
) {
  const boundary = `----vitest${Date.now()}`;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mimeType}\r\n\r\n${file.content}\r\n`,
  );
  parts.push(`--${boundary}--\r\n`);
  return { body: Buffer.from(parts.join("")), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("Checkpoint 1A — Customer Experience Foundation", () => {
  const app = buildApp();
  let tenantId: string;
  let adminToken: string;
  let regionId: string;
  let siteOrgUnitId: string;
  let siblingOrgUnitId: string;
  let customerAId: string;
  let customerBId: string;
  let contactId: string;
  let contractId: string;
  let projectId: string;
  let customerSiteId: string;
  let serviceId: string;
  let customerServiceLinkId: string;
  let supervisorToken: string;
  let scopedManagerToken: string;
  let outOfScopeManagerToken: string;
  let crossTenantAdminToken: string;
  let customerUserAToken: string;
  let customerUserBToken: string;
  let documentIdOnCustomerA: string;

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant 1A");
    tenantId = tenant.id;
    await provisionFirstAdmin({ tenantId, email: "admin@test1a.local", password: "Admin12345!" });
    const adminLogin = await login(app, TENANT_CODE, "admin@test1a.local", "Admin12345!");
    adminToken = adminLogin.body.accessToken;

    const legalEntity = await app.inject({
      method: "POST",
      url: "/legal-entities",
      headers: authHeader(adminToken),
      payload: { name: "Test Legal Entity 1A" },
    });
    const legalEntityId = legalEntity.json().id;

    // Region -> Site (child), to prove the ADR-0009 hierarchical walk also
    // covers a Customer through `ownerOrganizationUnitId` (ADR-0011).
    const region = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, name: "Region 1A", unitType: "Region", parentId: null },
    });
    regionId = region.json().id;

    const site = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, name: "Site 1A", unitType: "Site", parentId: regionId },
    });
    siteOrgUnitId = site.json().id;

    const sibling = await app.inject({
      method: "POST",
      url: "/organization-units",
      headers: authHeader(adminToken),
      payload: { legalEntityId, name: "Sibling Region 1A", unitType: "Region", parentId: null },
    });
    siblingOrgUnitId = sibling.json().id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("Administrator creates Customer A owned by Site (descendant of Region)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(adminToken),
      payload: { code: "CUST-A", name: "Customer A", ownerOrganizationUnitId: siteOrgUnitId },
    });
    expect(response.statusCode).toBe(201);
    customerAId = response.json().id;

    const auditRow = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'customer' AND entity_id = $1 AND action = 'customer.created'`,
      [customerAId],
    );
    expect(auditRow.rows).toHaveLength(1);
  });

  it("Administrator creates Customer B owned by the sibling Organization Unit", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(adminToken),
      payload: { code: "CUST-B", name: "Customer B", ownerOrganizationUnitId: siblingOrgUnitId },
    });
    expect(response.statusCode).toBe(201);
    customerBId = response.json().id;
  });

  it("Administrator creates a Customer Contact for Customer A", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/customer-contacts",
      headers: authHeader(adminToken),
      payload: { customerId: customerAId, name: "Test PIC", email: "pic@customer-a.local", isPrimary: true },
    });
    expect(response.statusCode).toBe(201);
    contactId = response.json().id;

    const auditRow = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'customer_contact' AND action = 'customer.contact_created'`,
    );
    expect(auditRow.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("Administrator creates Contract, Project, and Site context for Customer A", async () => {
    const contract = await app.inject({
      method: "POST",
      url: "/contracts",
      headers: authHeader(adminToken),
      payload: { customerId: customerAId, code: "CTR-A-1", name: "Contract A1" },
    });
    expect(contract.statusCode).toBe(201);
    contractId = contract.json().id;

    const project = await app.inject({
      method: "POST",
      url: "/projects",
      headers: authHeader(adminToken),
      payload: { customerId: customerAId, contractId, code: "PRJ-A-1", name: "Project A1" },
    });
    expect(project.statusCode).toBe(201);
    projectId = project.json().id;

    const site = await app.inject({
      method: "POST",
      url: "/sites",
      headers: authHeader(adminToken),
      payload: { customerId: customerAId, projectId, code: "SITE-A-1", name: "Site A1" },
    });
    expect(site.statusCode).toBe(201);
    customerSiteId = site.json().id;
  });

  it("Administrator creates a Service and assigns it to Customer A (Service Assigned)", async () => {
    const service = await app.inject({
      method: "POST",
      url: "/services",
      headers: authHeader(adminToken),
      payload: { code: "SVC-A", name: "Demo Service" },
    });
    expect(service.statusCode).toBe(201);
    serviceId = service.json().id;

    const link = await app.inject({
      method: "POST",
      url: "/customer-service-links",
      headers: authHeader(adminToken),
      payload: {
        customerId: customerAId,
        serviceId,
        contractId,
        projectId,
        siteId: customerSiteId,
      },
    });
    expect(link.statusCode).toBe(201);
    customerServiceLinkId = link.json().id;

    const auditRow = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'customer_service_link' AND action = 'customer.service_assigned'`,
    );
    expect(auditRow.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("a Supervisor scoped to Region (ancestor of Site) can reach Customer A via hierarchical Data Scope", async () => {
    const supervisorRoleId = await createReadOnlyRole(tenantId, "SUPERVISOR_1A", [
      "customer.read",
      "contract.read",
      "project.read",
      "site.read",
    ]);
    const supervisorUser = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "supervisor@test1a.local",
        fullName: "Test Supervisor",
        password: "Supervisor12345!",
        roleCode: "SUPERVISOR_1A",
        scopeType: "organization_unit",
        scopeOrganizationUnitId: regionId,
      },
    });
    expect(supervisorUser.statusCode).toBe(201);
    void supervisorRoleId;

    const supervisorLogin = await login(app, TENANT_CODE, "supervisor@test1a.local", "Supervisor12345!");
    supervisorToken = supervisorLogin.body.accessToken;

    const contracts = await app.inject({
      method: "GET",
      url: `/contracts?customerId=${customerAId}`,
      headers: authHeader(supervisorToken),
    });
    expect(contracts.statusCode).toBe(200);
  });

  it("the same Supervisor (Region scope) CANNOT reach Customer B (sibling Organization Unit — no hierarchy across branches)", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/contracts?customerId=${customerBId}`,
      headers: authHeader(supervisorToken),
    });
    expect(response.statusCode).toBe(403);
  });

  it("CUS-CORE-009: scoped manager updates commercial records and transitions active/inactive without hard delete", async () => {
    await createReadOnlyRole(tenantId, "COMMERCIAL_MANAGER_1A", [
      "customer.read",
      "customer.manage",
      "contract.read",
      "contract.manage",
      "project.read",
      "project.manage",
      "site.read",
      "site.manage",
      "service.read",
      "service.manage",
    ]);

    const manager = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "commercial-manager@test1a.local",
        fullName: "Commercial Manager",
        password: "Manager12345!",
        roleCode: "COMMERCIAL_MANAGER_1A",
        scopeType: "organization_unit",
        scopeOrganizationUnitId: regionId,
      },
    });
    expect(manager.statusCode).toBe(201);

    const managerLogin = await login(app, TENANT_CODE, "commercial-manager@test1a.local", "Manager12345!");
    expect(managerLogin.statusCode).toBe(200);
    scopedManagerToken = managerLogin.body.accessToken;

    const customer = await app.inject({
      method: "PATCH",
      url: `/customers/${customerAId}`,
      headers: authHeader(scopedManagerToken),
      payload: { name: "Customer A Maintained", status: "inactive" },
    });
    expect(customer.statusCode).toBe(200);
    expect(customer.json().name).toBe("Customer A Maintained");
    expect(customer.json().status).toBe("inactive");

    const contact = await app.inject({
      method: "PATCH",
      url: `/customer-contacts/${contactId}`,
      headers: authHeader(scopedManagerToken),
      payload: { phone: "+62-21-0001", isPrimary: false },
    });
    expect(contact.statusCode).toBe(200);
    expect(contact.json().phone).toBe("+62-21-0001");
    expect(contact.json().isPrimary).toBe(false);

    const contract = await app.inject({
      method: "PATCH",
      url: `/contracts/${contractId}`,
      headers: authHeader(scopedManagerToken),
      payload: { name: "Contract A1 Maintained", status: "inactive" },
    });
    expect(contract.statusCode).toBe(200);
    expect(contract.json().status).toBe("inactive");

    const project = await app.inject({
      method: "PATCH",
      url: `/projects/${projectId}`,
      headers: authHeader(scopedManagerToken),
      payload: { name: "Project A1 Maintained", status: "inactive" },
    });
    expect(project.statusCode).toBe(200);
    expect(project.json().status).toBe("inactive");

    const site = await app.inject({
      method: "PATCH",
      url: `/sites/${customerSiteId}`,
      headers: authHeader(scopedManagerToken),
      payload: { address: "Maintained Address", status: "inactive" },
    });
    expect(site.statusCode).toBe(200);
    expect(site.json().status).toBe("inactive");

    const service = await app.inject({
      method: "PATCH",
      url: `/services/${serviceId}`,
      headers: authHeader(scopedManagerToken),
      payload: { name: "Demo Service Maintained", isActive: false },
    });
    expect(service.statusCode).toBe(200);
    expect(service.json().isActive).toBe(false);

    const link = await app.inject({
      method: "PATCH",
      url: `/customer-service-links/${customerServiceLinkId}`,
      headers: authHeader(scopedManagerToken),
      payload: { status: "inactive" },
    });
    expect(link.statusCode).toBe(200);
    expect(link.json().status).toBe("inactive");

    const notDeleted = await pool.query(
      `SELECT
         (SELECT count(*) FROM customers WHERE id = $1 AND deleted_at IS NULL) AS customers,
         (SELECT count(*) FROM customer_contacts WHERE id = $2 AND deleted_at IS NULL) AS contacts,
         (SELECT count(*) FROM contracts WHERE id = $3 AND deleted_at IS NULL) AS contracts,
         (SELECT count(*) FROM projects WHERE id = $4 AND deleted_at IS NULL) AS projects,
         (SELECT count(*) FROM sites WHERE id = $5 AND deleted_at IS NULL) AS sites`,
      [customerAId, contactId, contractId, projectId, customerSiteId],
    );
    expect(notDeleted.rows[0]).toMatchObject({ customers: "1", contacts: "1", contracts: "1", projects: "1", sites: "1" });

    const reactivated = await Promise.all([
      app.inject({ method: "PATCH", url: `/customers/${customerAId}`, headers: authHeader(scopedManagerToken), payload: { status: "active" } }),
      app.inject({ method: "PATCH", url: `/contracts/${contractId}`, headers: authHeader(scopedManagerToken), payload: { status: "active" } }),
      app.inject({ method: "PATCH", url: `/projects/${projectId}`, headers: authHeader(scopedManagerToken), payload: { status: "active" } }),
      app.inject({ method: "PATCH", url: `/sites/${customerSiteId}`, headers: authHeader(scopedManagerToken), payload: { status: "active" } }),
      app.inject({ method: "PATCH", url: `/services/${serviceId}`, headers: authHeader(scopedManagerToken), payload: { isActive: true } }),
      app.inject({ method: "PATCH", url: `/customer-service-links/${customerServiceLinkId}`, headers: authHeader(scopedManagerToken), payload: { status: "active" } }),
    ]);
    expect(reactivated.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("CUS-CORE-009: read-only, out-of-scope, and cross-tenant actors cannot maintain commercial records", async () => {
    const readOnly = await app.inject({
      method: "PATCH",
      url: `/contracts/${contractId}`,
      headers: authHeader(supervisorToken),
      payload: { status: "inactive" },
    });
    expect(readOnly.statusCode).toBe(403);

    await createReadOnlyRole(tenantId, "COMMERCIAL_MANAGER_OUT_OF_SCOPE_1A", [
      "customer.manage",
      "contract.manage",
      "project.manage",
      "site.manage",
      "service.manage",
    ]);
    const outOfScopeManager = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "commercial-out-of-scope@test1a.local",
        fullName: "Commercial Out Of Scope",
        password: "Manager12345!",
        roleCode: "COMMERCIAL_MANAGER_OUT_OF_SCOPE_1A",
        scopeType: "organization_unit",
        scopeOrganizationUnitId: siblingOrgUnitId,
      },
    });
    expect(outOfScopeManager.statusCode).toBe(201);
    const outOfScopeLogin = await login(app, TENANT_CODE, "commercial-out-of-scope@test1a.local", "Manager12345!");
    outOfScopeManagerToken = outOfScopeLogin.body.accessToken;

    const outOfScope = await app.inject({
      method: "PATCH",
      url: `/customers/${customerAId}`,
      headers: authHeader(outOfScopeManagerToken),
      payload: { status: "inactive" },
    });
    expect(outOfScope.statusCode).toBe(403);

    const otherTenant = await bootstrapTenant(app, `${TENANT_CODE}-other`, "Other Tenant 1A");
    await provisionFirstAdmin({ tenantId: otherTenant.id, email: "admin@other1a.local", password: "Admin12345!" });
    const otherLogin = await login(app, `${TENANT_CODE}-other`, "admin@other1a.local", "Admin12345!");
    crossTenantAdminToken = otherLogin.body.accessToken;

    const crossTenant = await app.inject({
      method: "PATCH",
      url: `/customers/${customerAId}`,
      headers: authHeader(crossTenantAdminToken),
      payload: { status: "inactive" },
    });
    expect(crossTenant.statusCode).toBe(404);
  });

  it("Administrator creates a Customer User for Customer A (Customer Data Scope, ADR-0011)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "user@customer-a.local",
        fullName: "Customer A User",
        password: "CustomerUser12345!",
        roleCode: "CUSTOMER_USER_1A",
        scopeType: "customer",
        scopeCustomerId: customerAId,
      },
    });
    // Role does not exist yet — expect a clean NotFoundError, not a crash,
    // proving role lookup runs before scope assignment.
    expect(response.statusCode).toBe(404);
  });

  it("Customer User login: full path with a real CUSTOMER_USER role", async () => {
    await createReadOnlyRole(tenantId, "CUSTOMER_USER_1A", [
      "customer.read",
      "contract.read",
      "project.read",
      "site.read",
    ]);

    const created = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "user@customer-a.local",
        fullName: "Customer A User",
        password: "CustomerUser12345!",
        roleCode: "CUSTOMER_USER_1A",
        scopeType: "customer",
        scopeCustomerId: customerAId,
      },
    });
    expect(created.statusCode).toBe(201);

    const createdB = await app.inject({
      method: "POST",
      url: "/users",
      headers: authHeader(adminToken),
      payload: {
        email: "user@customer-b.local",
        fullName: "Customer B User",
        password: "CustomerUser12345!",
        roleCode: "CUSTOMER_USER_1A",
        scopeType: "customer",
        scopeCustomerId: customerBId,
      },
    });
    expect(createdB.statusCode).toBe(201);

    const loginA = await login(app, TENANT_CODE, "user@customer-a.local", "CustomerUser12345!");
    expect(loginA.statusCode).toBe(200);
    customerUserAToken = loginA.body.accessToken;

    const loginB = await login(app, TENANT_CODE, "user@customer-b.local", "CustomerUser12345!");
    customerUserBToken = loginB.body.accessToken;
  });

  it("Customer A User (Data Scope Applied) sees Customer A's Contract/Project/Site but not Customer B's", async () => {
    const ownContracts = await app.inject({
      method: "GET",
      url: `/contracts?customerId=${customerAId}`,
      headers: authHeader(customerUserAToken),
    });
    expect(ownContracts.statusCode).toBe(200);
    expect(ownContracts.json()).toHaveLength(1);

    const otherContracts = await app.inject({
      method: "GET",
      url: `/contracts?customerId=${customerBId}`,
      headers: authHeader(customerUserAToken),
    });
    expect(otherContracts.statusCode).toBe(403);
  });

  it("Document Uploaded + Parent Entity Authorization Applied (ADR-0012): Customer A User uploads evidence against entityType='customer' with NO document.* permission", async () => {
    const { body, contentType } = buildMultipart(
      { entityType: "customer", entityId: customerAId },
      { name: "evidence.txt", content: "hello from customer A", mimeType: "text/plain" },
    );
    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(customerUserAToken), "content-type": contentType },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    documentIdOnCustomerA = upload.json().id;

    const auditRow = await pool.query(
      `SELECT * FROM audit_log WHERE entity_type = 'document' AND entity_id = $1 AND action = 'document.uploaded'`,
      [documentIdOnCustomerA],
    );
    expect(auditRow.rows).toHaveLength(1);
  });

  it("Customer A User can list/download their own Customer's document", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/documents?entityType=customer&entityId=${customerAId}`,
      headers: authHeader(customerUserAToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const download = await app.inject({
      method: "GET",
      url: `/documents/${documentIdOnCustomerA}/download`,
      headers: authHeader(customerUserAToken),
    });
    expect(download.statusCode).toBe(200);
  });

  it("Customer B User CANNOT read Customer A's document (Data Scope, not just Tenant)", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/documents?entityType=customer&entityId=${customerAId}`,
      headers: authHeader(customerUserBToken),
    });
    expect(list.statusCode).toBe(403);

    const download = await app.inject({
      method: "GET",
      url: `/documents/${documentIdOnCustomerA}/download`,
      headers: authHeader(customerUserBToken),
    });
    expect(download.statusCode).toBe(403);
  });

  it("the Supervisor (Region scope, covers Customer A via hierarchy) CAN read Customer A's document without holding document.read", async () => {
    // supervisorToken's SUPERVISOR_1A role (created above) was never
    // granted any document.* permission either — same proof as the
    // Customer User case, from the INTERNAL Data Scope axis instead of
    // the `customer` axis.
    const list = await app.inject({
      method: "GET",
      url: `/documents?entityType=customer&entityId=${customerAId}`,
      headers: authHeader(supervisorToken),
    });
    expect(list.statusCode).toBe(200);
  });

  it("Administrator (tenant-wide scope) can also reach Customer A's document", async () => {
    const download = await app.inject({
      method: "GET",
      url: `/documents/${documentIdOnCustomerA}/download`,
      headers: authHeader(adminToken),
    });
    expect(download.statusCode).toBe(200);
  });

  it("Phase 0 regression guard: entityType without a registered resolver (demo_transaction) still falls back to Tenant-wide document.manage/read (Checkpoint 0E behavior unchanged)", async () => {
    const { body, contentType } = buildMultipart(
      { entityType: "demo_transaction", entityId: "00000000-0000-0000-0000-000000000000" },
      { name: "x.txt", content: "x", mimeType: "text/plain" },
    );
    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      // Customer A User (CUSTOMER_USER_1A) holds no document.* permission
      // at all — for a resolver-backed entityType this succeeds via Data
      // Scope (proven above); for a NON-resolver entityType the legacy
      // Tenant-wide permission gate still applies and correctly forbids it.
      headers: { ...authHeader(customerUserAToken), "content-type": contentType },
      payload: body,
    });
    expect(upload.statusCode).toBe(403);
  });
});

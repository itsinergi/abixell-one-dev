import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

const TENANT_CODE = `test-p8-${Date.now()}`;
const OTHER_TENANT_CODE = `test-p8o-${Date.now()}`;

function buildMultipart(
  fields: Record<string, string>,
  file: { name: string; content: string; mimeType: string },
) {
  const boundary = `----p8${Date.now()}`;
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

describe("Phase 8 — Project Delivery Core", () => {
  const app = buildApp();
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;
  let otherAdminToken: string;
  let customerAId: string;
  let customerBId: string;
  let projectAId: string;
  let projectBId: string;
  let scopedToken: string;
  let readOnlyToken: string;
  let noDocumentToken: string;
  let picUserId: string;
  let picEmployeeId: string;
  let employeeActivityId: string;
  let activityId: string;
  let milestoneId: string;

  async function post(url: string, token: string, payload: unknown) {
    return app.inject({ method: "POST", url, headers: authHeader(token), payload });
  }

  async function patch(url: string, token: string, payload: unknown) {
    return app.inject({ method: "PATCH", url, headers: authHeader(token), payload });
  }

  async function get(url: string, token: string) {
    return app.inject({ method: "GET", url, headers: authHeader(token) });
  }

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Project Delivery Tenant");
    tenantId = tenant.id;
    await provisionFirstAdmin({ tenantId, email: "admin@p8.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT_CODE, "admin@p8.local", "Admin12345!")).body.accessToken;

    const other = await bootstrapTenant(app, OTHER_TENANT_CODE, "Other Project Delivery Tenant");
    otherTenantId = other.id;
    await provisionFirstAdmin({ tenantId: otherTenantId, email: "admin@p8-other.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER_TENANT_CODE, "admin@p8-other.local", "Admin12345!")).body.accessToken;

    const legalEntity = await post("/legal-entities", adminToken, { name: "P8 Legal Entity" });
    const legalEntityId = legalEntity.json().id;
    const region = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "P8 Region",
      unitType: "Region",
      parentId: null,
    });
    const regionId = region.json().id;
    const site = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "P8 Site",
      unitType: "Site",
      parentId: regionId,
    });
    const siteOrgUnitId = site.json().id;
    const sibling = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "P8 Sibling",
      unitType: "Region",
      parentId: null,
    });
    const siblingOrgUnitId = sibling.json().id;

    const customerA = await post("/customers", adminToken, {
      code: "P8-CUST-A",
      name: "P8 Customer A",
      ownerOrganizationUnitId: siteOrgUnitId,
    });
    customerAId = customerA.json().id;
    const customerB = await post("/customers", adminToken, {
      code: "P8-CUST-B",
      name: "P8 Customer B",
      ownerOrganizationUnitId: siblingOrgUnitId,
    });
    customerBId = customerB.json().id;

    const projectA = await post("/projects", adminToken, {
      customerId: customerAId,
      code: "P8-PRJ-A",
      name: "P8 Project A",
    });
    projectAId = projectA.json().id;
    const projectB = await post("/projects", adminToken, {
      customerId: customerBId,
      code: "P8-PRJ-B",
      name: "P8 Project B",
    });
    projectBId = projectB.json().id;

    const picUser = await post("/users", adminToken, {
      email: "pic@p8.local",
      fullName: "P8 PIC User",
      password: "PicUser12345!",
      roleCode: "ADMIN",
      scopeType: "tenant",
    });
    picUserId = picUser.json().user.id;

    const picEmployee = await post("/employees", adminToken, {
      employeeNumber: "P8-PIC-EMP",
      fullName: "P8 Employee PIC",
    });
    expect(picEmployee.statusCode).toBe(201);
    picEmployeeId = picEmployee.json().id;

    await createReadOnlyRole(tenantId, "P8_DELIVERY_SCOPED", [
      "project_delivery.read",
      "project_delivery.manage",
      "project_delivery.documents.read",
      "project.read",
      "customer.read",
    ]);
    const scopedUser = await post("/users", adminToken, {
      email: "scoped@p8.local",
      fullName: "P8 Scoped User",
      password: "Scoped12345!",
      roleCode: "P8_DELIVERY_SCOPED",
      scopeType: "organization_unit",
      scopeOrganizationUnitId: regionId,
    });
    expect(scopedUser.statusCode).toBe(201);
    scopedToken = (await login(app, TENANT_CODE, "scoped@p8.local", "Scoped12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "P8_DELIVERY_READ", [
      "project_delivery.read",
      "project_delivery.documents.read",
      "project.read",
      "customer.read",
    ]);
    const readOnlyUser = await post("/users", adminToken, {
      email: "reader@p8.local",
      fullName: "P8 Reader",
      password: "Reader12345!",
      roleCode: "P8_DELIVERY_READ",
      scopeType: "customer",
      scopeCustomerId: customerAId,
    });
    expect(readOnlyUser.statusCode).toBe(201);
    readOnlyToken = (await login(app, TENANT_CODE, "reader@p8.local", "Reader12345!")).body.accessToken;

    await createReadOnlyRole(tenantId, "P8_DELIVERY_NO_DOC", [
      "project_delivery.read",
      "project.read",
      "customer.read",
    ]);
    const noDocUser = await post("/users", adminToken, {
      email: "nodoc@p8.local",
      fullName: "P8 No Document",
      password: "NoDoc12345!",
      roleCode: "P8_DELIVERY_NO_DOC",
      scopeType: "customer",
      scopeCustomerId: customerAId,
    });
    expect(noDocUser.statusCode).toBe(201);
    noDocumentToken = (await login(app, TENANT_CODE, "nodoc@p8.local", "NoDoc12345!")).body.accessToken;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("requires a PIC and creates activities with user or employee PIC", async () => {
    const missingPic = await post(`/project-delivery/projects/${projectAId}/activities`, adminToken, {
      title: "Missing PIC should fail",
    });
    expect(missingPic.statusCode).toBe(400);

    const response = await post(`/project-delivery/projects/${projectAId}/activities`, adminToken, {
      title: "Mobilize site team",
      description: "Prepare the project team for execution",
      picUserId,
      plannedStartDate: "2026-08-22",
      plannedEndDate: "2026-08-25",
      status: "in_progress",
      progressPercent: 25,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    activityId = body.id;
    expect(body.projectId).toBe(projectAId);
    expect(body.picUserId).toBe(picUserId);
    expect(body.status).toBe("in_progress");
    expect(body.progressPercent).toBe(25);

    const employeePic = await post(`/project-delivery/projects/${projectAId}/activities`, adminToken, {
      title: "Employee PIC activity",
      picEmployeeId,
      progressPercent: 0,
    });
    expect(employeePic.statusCode).toBe(201);
    employeeActivityId = employeePic.json().id;
    expect(employeePic.json().picEmployeeId).toBe(picEmployeeId);

    const invalid = await post(`/project-delivery/projects/${projectAId}/activities`, adminToken, {
      title: "Invalid progress",
      picUserId,
      progressPercent: 101,
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("creates and achieves a milestone with audit-safe achievement metadata", async () => {
    const response = await post(`/project-delivery/projects/${projectAId}/milestones`, adminToken, {
      title: "Site ready",
      description: "Core readiness checkpoint",
      plannedDate: "2026-08-26",
    });
    expect(response.statusCode).toBe(201);
    milestoneId = response.json().id;

    const achieved = await patch(`/project-delivery/milestones/${milestoneId}`, adminToken, {
      status: "achieved",
      achievementNote: "Accepted by project lead",
    });
    expect(achieved.statusCode).toBe(200);
    expect(achieved.json().status).toBe("achieved");
    expect(achieved.json().achievedAt).toBeTruthy();
  });

  it("lists detail and derives project progress deterministically from activities", async () => {
    await post(`/project-delivery/projects/${projectAId}/activities`, adminToken, {
      title: "Commission handover checklist",
      picUserId,
      status: "completed",
      progressPercent: 40,
      actualStartDate: "2026-08-27",
      actualEndDate: "2026-08-27",
    });

    const detail = await get(`/project-delivery/projects/${projectAId}`, adminToken);
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.project.id).toBe(projectAId);
    expect(body.activities).toHaveLength(3);
    expect(body.milestones).toHaveLength(1);
    // Activities at 25%, 0%, and completed-forced 100% => rounded average 42%.
    expect(body.progress.progressPercent).toBe(42);
    expect(body.progress.completedActivityCount).toBe(1);
    expect(body.progress.achievedMilestoneCount).toBe(1);
  });

  it("updates activity dates, status, actual dates, and completed progress", async () => {
    const updated = await patch(`/project-delivery/activities/${activityId}`, adminToken, {
      actualStartDate: "2026-08-22",
      actualEndDate: "2026-08-24",
      status: "completed",
      progressPercent: 80,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().status).toBe("completed");
    expect(updated.json().progressPercent).toBe(100);
    expect(updated.json().actualEndDate).toBe("2026-08-24");

    const preservePic = await patch(`/project-delivery/activities/${activityId}`, adminToken, {
      title: "Mobilize site team — updated",
    });
    expect(preservePic.statusCode).toBe(200);
    expect(preservePic.json().picUserId).toBe(picUserId);

    const clearOnlyPic = await patch(`/project-delivery/activities/${employeeActivityId}`, adminToken, {
      picEmployeeId: null,
    });
    expect(clearOnlyPic.statusCode).toBe(400);
  });

  it("validates merged planned and actual date pairs on one-sided PATCH", async () => {
    const badPlannedEnd = await patch(`/project-delivery/activities/${activityId}`, adminToken, {
      plannedEndDate: "2026-08-21",
    });
    expect(badPlannedEnd.statusCode).toBe(400);

    const badActualStart = await patch(`/project-delivery/activities/${activityId}`, adminToken, {
      actualStartDate: "2026-08-25",
    });
    expect(badActualStart.statusCode).toBe(400);

    const stillValid = await patch(`/project-delivery/activities/${activityId}`, adminToken, {
      plannedEndDate: "2026-08-26",
    });
    expect(stillValid.statusCode).toBe(200);
    expect(stillValid.json().plannedEndDate).toBe("2026-08-26");
  });

  it("applies Data Scope to list and detail views", async () => {
    const list = await get("/project-delivery/projects", scopedToken);
    expect(list.statusCode).toBe(200);
    const ids = list.json().map((row: { project: { id: string } }) => row.project.id);
    expect(ids).toContain(projectAId);
    expect(ids).not.toContain(projectBId);

    const own = await get(`/project-delivery/projects/${projectAId}`, scopedToken);
    expect(own.statusCode).toBe(200);

    const sibling = await get(`/project-delivery/projects/${projectBId}`, scopedToken);
    expect(sibling.statusCode).toBe(403);
  });

  it("rejects cross-tenant project and PIC references", async () => {
    const otherProject = await post("/customers", otherAdminToken, {
      code: "P8-OTHER-CUST",
      name: "Other Customer",
    });
    const otherCustomerId = otherProject.json().id;
    const otherProjectRes = await post("/projects", otherAdminToken, {
      customerId: otherCustomerId,
      code: "P8-OTHER-PRJ",
      name: "Other Project",
    });
    const otherProjectId = otherProjectRes.json().id;

    const projectDenied = await post(`/project-delivery/projects/${otherProjectId}/activities`, adminToken, {
      title: "Should not attach to other tenant project",
      picUserId,
    });
    expect(projectDenied.statusCode).toBe(404);

    const otherPic = await post("/users", otherAdminToken, {
      email: "other-pic@p8.local",
      fullName: "Other PIC",
      password: "OtherPic12345!",
      roleCode: "ADMIN",
      scopeType: "tenant",
    });
    const picDenied = await post(`/project-delivery/projects/${projectAId}/activities`, adminToken, {
      title: "Should reject other tenant PIC",
      picUserId: otherPic.json().user.id,
    });
    expect(picDenied.statusCode).toBe(404);
  });

  it("enforces document authorization for activity attachments", async () => {
    const { body, contentType } = buildMultipart(
      { entityType: "project_delivery_activity", entityId: activityId },
      { name: "delivery-note.txt", content: "project delivery evidence", mimeType: "text/plain" },
    );
    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(adminToken), "content-type": contentType },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    const documentId = upload.json().id;

    const listAllowed = await get(`/documents?entityType=project_delivery_activity&entityId=${activityId}`, readOnlyToken);
    expect(listAllowed.statusCode).toBe(200);
    expect(listAllowed.json()).toHaveLength(1);

    const downloadAllowed = await get(`/documents/${documentId}/download`, readOnlyToken);
    expect(downloadAllowed.statusCode).toBe(200);
    expect(downloadAllowed.payload).toContain("project delivery evidence");

    const noDocDenied = await get(`/documents?entityType=project_delivery_activity&entityId=${activityId}`, noDocumentToken);
    expect(noDocDenied.statusCode).toBe(403);

    const crossTenantDenied = await get(`/documents/${documentId}/download`, otherAdminToken);
    expect([403, 404]).toContain(crossTenantDenied.statusCode);
  });

  it("enforces document authorization for milestone attachments", async () => {
    const { body, contentType } = buildMultipart(
      { entityType: "project_delivery_milestone", entityId: milestoneId },
      { name: "milestone-note.txt", content: "milestone acceptance evidence", mimeType: "text/plain" },
    );
    const upload = await app.inject({
      method: "POST",
      url: "/documents",
      headers: { ...authHeader(adminToken), "content-type": contentType },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);
    const documentId = upload.json().id;

    const listAllowed = await get(`/documents?entityType=project_delivery_milestone&entityId=${milestoneId}`, readOnlyToken);
    expect(listAllowed.statusCode).toBe(200);
    expect(listAllowed.json()).toHaveLength(1);

    const downloadAllowed = await get(`/documents/${documentId}/download`, readOnlyToken);
    expect(downloadAllowed.statusCode).toBe(200);
    expect(downloadAllowed.payload).toContain("milestone acceptance evidence");

    const noDocDenied = await get(`/documents?entityType=project_delivery_milestone&entityId=${milestoneId}`, noDocumentToken);
    expect(noDocDenied.statusCode).toBe(403);

    const crossTenantDenied = await get(`/documents/${documentId}/download`, otherAdminToken);
    expect([403, 404]).toContain(crossTenantDenied.statusCode);
  });
});

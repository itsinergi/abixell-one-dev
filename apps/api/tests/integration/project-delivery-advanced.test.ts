import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, createReadOnlyRole, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Wave A7 — Project Delivery Advanced (PRJ-ADV-001…008, ADR-0026).
 *
 * The tests are grouped by the promise each work package makes, not by route:
 *
 * - PRJ-ADV-001 WBS is a tree with rolled-up cost, and depth is bounded.
 * - PRJ-ADV-002/003 dependencies refuse to become a cycle, and the schedule
 *   that comes out is a real forward/backward pass (float, critical path).
 * - PRJ-ADV-004 resource loading compares demand against capacity per day.
 * - PRJ-ADV-005 a baseline snapshots the plan at creation, and variance is
 *   refused until it is approved.
 * - PRJ-ADV-006/007 cost is an append-only ledger: idempotent, reversible
 *   once, with commitments never folded into actual cost. Earned value
 *   refuses to answer without an approved baseline.
 * - PRJ-ADV-008 posting hands the entry to the Accounting Kernel exactly once.
 */

const TENANT_CODE = `test-a7pd-${Date.now()}`;
const OTHER_TENANT_CODE = `test-a7pd-o-${Date.now()}`;

describe("Wave A7 — Project Delivery Advanced", () => {
  const app = buildApp();

  let tenantId: string;
  let adminToken: string;
  let readerToken: string;
  let picUserId: string;
  let otherAdminToken: string;

  let projectAId: string;
  let projectBId: string;
  let otherProjectId: string;

  // projectA — WBS / dependencies / schedule / resources / cost ledger
  let actA1: string;
  let actA2: string;
  let actA3: string;
  let nodeParentId: string;
  let nodeChildId: string;

  // projectB — baseline / earned value / posting
  let actB1: string;

  const post = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: authHeader(token), payload });
  const get = (url: string, token: string) =>
    app.inject({ method: "GET", url, headers: authHeader(token) });
  const patch = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "PATCH", url, headers: authHeader(token), payload });
  const put = (url: string, token: string, payload: unknown = {}) =>
    app.inject({ method: "PUT", url, headers: authHeader(token), payload });
  const del = (url: string, token: string) =>
    app.inject({ method: "DELETE", url, headers: authHeader(token) });

  async function createActivity(projectId: string, body: Record<string, unknown>) {
    const res = await post(`/project-delivery/projects/${projectId}/activities`, adminToken, body);
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  async function recordCost(
    projectId: string,
    body: Record<string, unknown>,
  ) {
    const res = await post(`/project-delivery/projects/${projectId}/cost-entries`, adminToken, body);
    return res;
  }

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "A7 Project Delivery Tenant");
    await activateAllModules(tenant.id);
    tenantId = tenant.id;
    await provisionFirstAdmin({ tenantId, email: "admin@a7pd.local", password: "Admin12345!" });
    adminToken = (await login(app, TENANT_CODE, "admin@a7pd.local", "Admin12345!")).body.accessToken;

    const legal = await post("/legal-entities", adminToken, { name: "A7PD Legal Entity" });
    const legalEntityId = legal.json().id;
    const unit = await post("/organization-units", adminToken, {
      legalEntityId,
      name: "A7PD Unit",
      unitType: "Region",
      parentId: null,
    });
    const unitId = unit.json().id;
    void unitId;

    const customer = await post("/customers", adminToken, { code: "A7PD-CUST", name: "A7PD Customer" });
    const customerId = customer.json().id;

    projectAId = (
      await post("/projects", adminToken, { customerId, code: "A7PD-PRJ-A", name: "A7PD Project A" })
    ).json().id;
    projectBId = (
      await post("/projects", adminToken, { customerId, code: "A7PD-PRJ-B", name: "A7PD Project B" })
    ).json().id;

    const pic = await post("/admin/users", adminToken, {
      email: "pic@a7pd.local",
      fullName: "A7PD PIC",
      password: "PicUser12345!",
      pairs: [{ roleCode: "ADMIN", scopeType: "tenant" }],
    });
    picUserId = pic.json().user.id;

    await createReadOnlyRole(tenantId, "A7PD_READER", [
      "project_delivery.read",
      "project_delivery.advanced.read",
      "project_delivery.cost.read",
      "project.read",
      "customer.read",
    ]);
    const reader = await post("/admin/users", adminToken, {
      email: "reader@a7pd.local",
      fullName: "A7PD Reader",
      password: "Reader12345!",
      pairs: [{ roleCode: "A7PD_READER", scopeType: "tenant" }],
    });
    expect(reader.statusCode).toBe(201);
    readerToken = (await login(app, TENANT_CODE, "reader@a7pd.local", "Reader12345!")).body.accessToken;

    // projectA plan: A1 (01-05 → 01-09), A2 (01-12 → 01-16) chained FS, A3 dateless.
    actA1 = (
      await createActivity(projectAId, {
        title: "A7PD A1",
        picUserId,
        plannedStartDate: "2026-01-05",
        plannedEndDate: "2026-01-09",
        status: "in_progress",
        progressPercent: 40,
      })
    ).id;
    actA2 = (
      await createActivity(projectAId, {
        title: "A7PD A2",
        picUserId,
        plannedStartDate: "2026-01-12",
        plannedEndDate: "2026-01-16",
      })
    ).id;
    actA3 = (await createActivity(projectAId, { title: "A7PD A3", picUserId })).id;

    // projectB plan: one activity so earned value has a single, exact line.
    actB1 = (
      await createActivity(projectBId, {
        title: "A7PD B1",
        picUserId,
        plannedStartDate: "2026-02-02",
        plannedEndDate: "2026-02-06",
        status: "in_progress",
        progressPercent: 50,
      })
    ).id;

    const other = await bootstrapTenant(app, OTHER_TENANT_CODE, "A7 Other PD Tenant");
    await activateAllModules(other.id);
    await provisionFirstAdmin({ tenantId: other.id, email: "admin@a7pd-o.local", password: "Admin12345!" });
    otherAdminToken = (await login(app, OTHER_TENANT_CODE, "admin@a7pd-o.local", "Admin12345!")).body.accessToken;
    const otherCustomer = await post("/customers", otherAdminToken, {
      code: "A7PD-O-CUST",
      name: "A7PD Other Customer",
    });
    otherProjectId = (
      await post("/projects", otherAdminToken, {
        customerId: otherCustomer.json().id,
        code: "A7PD-O-PRJ",
        name: "A7PD Other Project",
      })
    ).json().id;
  });

  afterAll(async () => {
    await pool.end();
  });

  // ========================================================================
  // PRJ-ADV-001 — WBS
  // ========================================================================

  it("creates a WBS tree and rolls cost up the ancestor chain", async () => {
    const parent = await post(`/project-delivery/projects/${projectAId}/wbs`, adminToken, {
      code: "1",
      name: "Phase 1",
      sortOrder: 1,
    });
    expect(parent.statusCode).toBe(201);
    nodeParentId = parent.json().id;
    expect(parent.json().depth).toBe(0);

    const child = await post(`/project-delivery/projects/${projectAId}/wbs`, adminToken, {
      parentId: nodeParentId,
      code: "1.1",
      name: "Phase 1.1",
      sortOrder: 1,
    });
    expect(child.statusCode).toBe(201);
    nodeChildId = child.json().id;
    expect(child.json().depth).toBe(1);

    const assigned = await put(`/project-delivery/activities/${actA1}/wbs-node`, adminToken, {
      wbsNodeId: nodeChildId,
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().wbsNodeId).toBe(nodeChildId);

    const cost = await recordCost(projectAId, {
      activityId: actA1,
      entryType: "actual",
      amount: "1250.00",
      currency: "IDR",
      entryDate: "2026-01-06",
      idempotencyKey: `wbs-rollup-${Date.now()}`,
    });
    expect(cost.statusCode).toBe(201);

    const tree = await get(`/project-delivery/projects/${projectAId}/wbs`, adminToken);
    expect(tree.statusCode).toBe(200);
    const root = (tree.json() as { id: string; rolledUpCost: string; activityCount: number; children: unknown[] }[]).find(
      (n) => n.id === nodeParentId,
    );
    expect(root).toBeDefined();
    // The parent holds no activity of its own; the figure comes from the child.
    expect(root!.rolledUpCost).toBe("1250.00");
    expect(root!.activityCount).toBe(1);
    expect(root!.children).toHaveLength(1);
  });

  it("refuses a WBS node deeper than twelve levels", async () => {
    let parentId: string | null = null;
    // 13 creates = depth 0..12; the 13th (depth 13) must be refused.
    for (let i = 0; i <= 12; i += 1) {
      const res = await post(`/project-delivery/projects/${projectBId}/wbs`, adminToken, {
        parentId,
        code: `D${i}`,
        name: `Depth ${i}`,
      });
      expect(res.statusCode).toBe(201);
      parentId = res.json().id as string;
    }
    const tooDeep = await post(`/project-delivery/projects/${projectBId}/wbs`, adminToken, {
      parentId,
      code: "D13",
      name: "Depth 13",
    });
    expect(tooDeep.statusCode).toBe(400);
  });

  it("refuses to attach an activity to another project's WBS node", async () => {
    const res = await put(`/project-delivery/activities/${actA2}/wbs-node`, adminToken, {
      wbsNodeId: nodeParentId,
    });
    expect(res.statusCode).toBe(200);

    const cross = await post(`/project-delivery/projects/${projectBId}/wbs`, adminToken, {
      code: "XB",
      name: "Cross project node",
    });
    expect(cross.statusCode).toBe(201);
    const bad = await put(`/project-delivery/activities/${actB1}/wbs-node`, adminToken, {
      wbsNodeId: nodeParentId,
    });
    // actB1 belongs to projectB, nodeParentId to projectA.
    expect(bad.statusCode).toBe(404);
  });

  // ========================================================================
  // PRJ-ADV-002/003 — dependencies, schedule, critical path
  // ========================================================================

  it("refuses a self-dependency", async () => {
    const res = await post(`/project-delivery/projects/${projectAId}/dependencies`, adminToken, {
      predecessorActivityId: actA1,
      successorActivityId: actA1,
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a dependency that would create a cycle", async () => {
    const forward = await post(`/project-delivery/projects/${projectAId}/dependencies`, adminToken, {
      predecessorActivityId: actA1,
      successorActivityId: actA2,
      dependencyType: "FS",
    });
    expect(forward.statusCode).toBe(201);

    const back = await post(`/project-delivery/projects/${projectAId}/dependencies`, adminToken, {
      predecessorActivityId: actA2,
      successorActivityId: actA1,
      dependencyType: "FS",
    });
    expect(back.statusCode).toBe(400);
    expect(back.json().error).toMatch(/cycle/i);
  });

  it("computes a schedule with float and a critical path", async () => {
    const res = await get(`/project-delivery/projects/${projectAId}/schedule`, adminToken);
    expect(res.statusCode).toBe(200);
    const schedule = res.json() as {
      activities: { activityId: string; totalFloatDays: number; isCritical: boolean; earliestStart: string }[];
      projectFinish: string | null;
      criticalPath: string[];
      unscheduledActivityIds: string[];
      hasCycle: boolean;
    };

    expect(schedule.hasCycle).toBe(false);
    expect(schedule.projectFinish).toBe("2026-01-16");
    // A3 has no planned dates, so it is excluded from the schedule rather than
    // given invented ones.
    expect(schedule.unscheduledActivityIds).toContain(actA3);

    const a1 = schedule.activities.find((a) => a.activityId === actA1)!;
    const a2 = schedule.activities.find((a) => a.activityId === actA2)!;
    // A2 starts the day after A1's earliest finish, so A1 carries two days of float.
    expect(a1.totalFloatDays).toBe(2);
    expect(a1.isCritical).toBe(false);
    expect(a2.totalFloatDays).toBe(0);
    expect(a2.isCritical).toBe(true);
    expect(schedule.criticalPath).toEqual([actA2]);
  });

  it("produces gantt rows that mirror the schedule", async () => {
    const res = await get(`/project-delivery/projects/${projectAId}/gantt`, adminToken);
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { activityId: string; isCritical: boolean; wbsNodeId: string | null }[];
    const a2 = rows.find((r) => r.activityId === actA2)!;
    expect(a2.isCritical).toBe(true);
    const a1 = rows.find((r) => r.activityId === actA1)!;
    expect(a1.wbsNodeId).toBe(nodeChildId);
  });

  it("deletes a dependency and leaves the graph intact", async () => {
    const list = await get(`/project-delivery/projects/${projectAId}/dependencies`, adminToken);
    expect(list.statusCode).toBe(200);
    const dep = (list.json() as { id: string }[])[0];
    const removed = await del(`/project-delivery/dependencies/${dep.id}`, adminToken);
    expect(removed.statusCode).toBe(204);

    const after = await get(`/project-delivery/projects/${projectAId}/dependencies`, adminToken);
    expect(after.json()).toHaveLength(0);
  });

  // ========================================================================
  // PRJ-ADV-004 — resources and loading
  // ========================================================================

  it("reports a resource overallocation against capacity", async () => {
    const resource = await post("/project-delivery/resources", adminToken, {
      code: "A7PD-CREW",
      name: "Crew",
      resourceType: "labor",
      unit: "person-day",
      capacityPerDay: "2.0000",
      costRate: "150000.00",
    });
    expect(resource.statusCode).toBe(201);
    const resourceId = resource.json().id as string;

    const assignment = await post(
      `/project-delivery/projects/${projectAId}/resource-assignments`,
      adminToken,
      {
        activityId: actA1,
        resourceId,
        plannedUnits: "10.0000",
        startDate: "2026-01-05",
        endDate: "2026-01-09",
      },
    );
    expect(assignment.statusCode).toBe(201);

    const loading = await get(
      `/project-delivery/projects/${projectAId}/resource-loading?from=2026-01-05&to=2026-01-09`,
      adminToken,
    );
    expect(loading.statusCode).toBe(200);
    const body = loading.json() as {
      overallocations: { resourceId: string; date: string; demandedUnits: string; capacityUnits: string }[];
      isLevellable: boolean;
    };
    // 10 units over 5 days = 2/day, exactly at capacity — nothing to report.
    expect(body.overallocations).toHaveLength(0);
    expect(body.isLevellable).toBe(true);
  });

  it("flags demand above capacity on a specific day", async () => {
    const resource = await post("/project-delivery/resources", adminToken, {
      code: "A7PD-CRANE",
      name: "Crane",
      resourceType: "equipment",
      unit: "unit-day",
      capacityPerDay: "1.0000",
    });
    expect(resource.statusCode).toBe(201);
    const resourceId = resource.json().id as string;

    // 2 units over 1 day = 2/day against a capacity of 1/day.
    const assignment = await post(
      `/project-delivery/projects/${projectAId}/resource-assignments`,
      adminToken,
      {
        activityId: actA2,
        resourceId,
        plannedUnits: "2.0000",
        startDate: "2026-01-13",
        endDate: "2026-01-13",
      },
    );
    expect(assignment.statusCode).toBe(201);

    const loading = await get(
      `/project-delivery/projects/${projectAId}/resource-loading?from=2026-01-13&to=2026-01-13`,
      adminToken,
    );
    expect(loading.statusCode).toBe(200);
    const body = loading.json() as {
      overallocations: { resourceId: string; date: string; demandedUnits: string; capacityUnits: string }[];
    };
    expect(body.overallocations).toHaveLength(1);
    expect(body.overallocations[0].resourceId).toBe(resourceId);
    expect(body.overallocations[0].date).toBe("2026-01-13");
    expect(body.overallocations[0].demandedUnits).toBe("2.0000");
    expect(body.overallocations[0].capacityUnits).toBe("1.0000");
  });

  it("rejects a resource assignment whose dates run backwards", async () => {
    const resources = await get("/project-delivery/resources", adminToken);
    const resourceId = (resources.json() as { id: string }[])[0].id;
    const res = await post(`/project-delivery/projects/${projectAId}/resource-assignments`, adminToken, {
      activityId: actA1,
      resourceId,
      plannedUnits: "1.0000",
      startDate: "2026-01-09",
      endDate: "2026-01-05",
    });
    expect(res.statusCode).toBe(400);
  });

  // ========================================================================
  // PRJ-ADV-006/007 — cost ledger
  // ========================================================================

  it("records an actual cost and treats a replay of the same key as a no-op", async () => {
    const key = `idem-actual-${Date.now()}`;
    const first = await recordCost(projectAId, {
      activityId: actA2,
      entryType: "actual",
      amount: "400.00",
      currency: "IDR",
      entryDate: "2026-01-14",
      idempotencyKey: key,
    });
    expect(first.statusCode).toBe(201);

    const replay = await recordCost(projectAId, {
      activityId: actA2,
      entryType: "actual",
      amount: "400.00",
      currency: "IDR",
      entryDate: "2026-01-14",
      idempotencyKey: key,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(first.json().id);
  });

  it("rejects a cost amount that is not an exact 2-decimal string", async () => {
    const res = await recordCost(projectAId, {
      entryType: "actual",
      amount: "12.345",
      currency: "IDR",
      entryDate: "2026-01-14",
      idempotencyKey: `bad-amount-${Date.now()}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("keeps commitments out of actual cost in the cost position", async () => {
    await recordCost(projectAId, {
      activityId: actA2,
      entryType: "commitment",
      amount: "500.00",
      currency: "IDR",
      entryDate: "2026-01-14",
      idempotencyKey: `commit-${Date.now()}`,
    });
    await recordCost(projectAId, {
      entryType: "adjustment",
      amount: "100.00",
      currency: "IDR",
      entryDate: "2026-01-14",
      idempotencyKey: `adjust-${Date.now()}`,
    });

    const res = await get(
      `/project-delivery/projects/${projectAId}/cost-position?asOfDate=2026-01-31`,
      adminToken,
    );
    expect(res.statusCode).toBe(200);
    const position = res.json() as {
      actualCost: string;
      commitmentCost: string;
      adjustmentCost: string;
      totalCommittedCost: string;
    };
    // 1250 (WBS test) + 400 (idempotency test) = 1650 actual; the 500
    // commitment stays in its own bucket.
    expect(position.actualCost).toBe("1650.00");
    expect(position.commitmentCost).toBe("500.00");
    expect(position.adjustmentCost).toBe("100.00");
    expect(position.totalCommittedCost).toBe("2250.00");
  });

  it("reverses a cost entry exactly once and refuses a reversal of a reversal", async () => {
    const entry = await recordCost(projectAId, {
      entryType: "actual",
      amount: "300.00",
      currency: "IDR",
      entryDate: "2026-01-20",
      idempotencyKey: `reversible-${Date.now()}`,
    });
    expect(entry.statusCode).toBe(201);
    const entryId = entry.json().id as string;

    const reversal = await post(`/project-delivery/cost-entries/${entryId}/reverse`, adminToken, {
      note: "duplicate invoice",
    });
    expect(reversal.statusCode).toBe(201);
    expect(reversal.json().entryType).toBe("reversal");
    expect(reversal.json().reversesId).toBe(entryId);

    const second = await post(`/project-delivery/cost-entries/${entryId}/reverse`, adminToken, {});
    expect(second.statusCode).toBe(409);

    const reversalId = reversal.json().id as string;
    const chained = await post(`/project-delivery/cost-entries/${reversalId}/reverse`, adminToken, {});
    expect(chained.statusCode).toBe(400);
  });

  // ========================================================================
  // PRJ-ADV-005 — baseline and variance
  // ========================================================================

  it("refuses baseline variance before any baseline is approved", async () => {
    const res = await get(
      `/project-delivery/projects/${projectAId}/baseline-variance?asOfDate=2026-01-31`,
      adminToken,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/approved baseline/i);
  });

  it("snapshots the plan at baseline creation, then reports variance once approved", async () => {
    // projectB has one activity and one actual cost entry recorded in beforeAll
    // plus the one below, so the baseline line carries a real planned cost.
    const cost = await recordCost(projectBId, {
      activityId: actB1,
      entryType: "actual",
      amount: "1000.00",
      currency: "IDR",
      entryDate: "2026-02-03",
      idempotencyKey: `ev-baseline-${Date.now()}`,
    });
    expect(cost.statusCode).toBe(201);

    const created = await post(`/project-delivery/projects/${projectBId}/baselines`, adminToken, {
      name: "Baseline 1",
      notes: "first cut",
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().version).toBe(1);
    expect(created.json().status).toBe("draft");
    const baselineId = created.json().id as string;

    // A draft baseline is not a baseline: variance still refuses.
    const draft = await get(
      `/project-delivery/projects/${projectBId}/baseline-variance?asOfDate=2026-02-28`,
      adminToken,
    );
    expect(draft.statusCode).toBe(400);

    const approved = await post(`/project-delivery/baselines/${baselineId}/approve`, adminToken, {});
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe("approved");

    // Approval is idempotent — a second call returns the same row, not an error.
    const again = await post(`/project-delivery/baselines/${baselineId}/approve`, adminToken, {});
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(baselineId);

    const variance = await get(
      `/project-delivery/projects/${projectBId}/baseline-variance?asOfDate=2026-02-28`,
      adminToken,
    );
    expect(variance.statusCode).toBe(200);
    const body = variance.json() as {
      baselineVersion: number;
      totalBaselineCost: string;
      totalActualCost: string;
      totalCostVariance: string;
      slippedActivityCount: number;
      lines: { finishVarianceDays: number | null }[];
    };
    expect(body.baselineVersion).toBe(1);
    expect(body.totalBaselineCost).toBe("1000.00");
    expect(body.totalActualCost).toBe("1000.00");
    expect(body.totalCostVariance).toBe("0.00");
    expect(body.slippedActivityCount).toBe(0);

    // Push the activity's planned finish out by four days: the baseline keeps
    // the old date, so the slip is measured against what was approved.
    const moved = await patch(`/project-delivery/activities/${actB1}`, adminToken, {
      plannedEndDate: "2026-02-10",
    });
    expect(moved.statusCode).toBe(200);

    const slipped = await get(
      `/project-delivery/projects/${projectBId}/baseline-variance?asOfDate=2026-02-28`,
      adminToken,
    );
    const slippedBody = slipped.json() as {
      slippedActivityCount: number;
      lines: { finishVarianceDays: number | null }[];
    };
    expect(slippedBody.slippedActivityCount).toBe(1);
    expect(slippedBody.lines[0].finishVarianceDays).toBe(4);
  });

  // ========================================================================
  // PRJ-ADV-006 — earned value
  // ========================================================================

  it("refuses earned value without an approved baseline", async () => {
    const res = await get(
      `/project-delivery/projects/${projectAId}/earned-value?asOfDate=2026-01-31`,
      adminToken,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/approved baseline/i);
  });

  it("computes earned value from the approved baseline and the ledger", async () => {
    const res = await get(
      `/project-delivery/projects/${projectBId}/earned-value?asOfDate=2026-02-28`,
      adminToken,
    );
    expect(res.statusCode).toBe(200);
    const ev = res.json() as Record<string, string | null>;

    // BAC 1000.00, progress 50% → EV 500.00; AC is the 1000.00 actually spent.
    expect(ev.budgetAtCompletion).toBe("1000.00");
    expect(ev.plannedValue).toBe("1000.00");
    expect(ev.earnedValue).toBe("500.00");
    expect(ev.actualCost).toBe("1000.00");
    expect(ev.scheduleVariance).toBe("-500.00");
    expect(ev.costVariance).toBe("-500.00");
    expect(ev.schedulePerformanceIndex).toBe("0.5000");
    expect(ev.costPerformanceIndex).toBe("0.5000");
    // EAC = AC + (BAC - EV) = 1000 + 500.
    expect(ev.estimateAtCompletion).toBe("1500.00");
    expect(ev.estimateToComplete).toBe("500.00");
    expect(ev.varianceAtCompletion).toBe("-500.00");
    expect(ev.percentComplete).toBe("50.00");
  });

  it("freezes an earned-value snapshot and refuses a second one for the same date", async () => {
    const first = await post(`/project-delivery/projects/${projectBId}/earned-value-snapshots`, adminToken, {
      asOfDate: "2026-02-28",
      notes: "month end",
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().earnedValue).toBe("500.00");

    const duplicate = await post(`/project-delivery/projects/${projectBId}/earned-value-snapshots`, adminToken, {
      asOfDate: "2026-02-28",
    });
    expect(duplicate.statusCode).toBe(409);

    const list = await get(`/project-delivery/projects/${projectBId}/earned-value-snapshots`, adminToken);
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
  });

  // ========================================================================
  // PRJ-ADV-008 — hand-off to the Accounting Kernel
  // ========================================================================

  it("refuses to post a commitment to the ledger", async () => {
    const commitment = await recordCost(projectBId, {
      entryType: "commitment",
      amount: "250.00",
      currency: "IDR",
      entryDate: "2026-02-10",
      idempotencyKey: `post-commit-${Date.now()}`,
    });
    expect(commitment.statusCode).toBe(201);
    const res = await post(`/project-delivery/cost-entries/${commitment.json().id}/post`, adminToken, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/commitment/i);
  });

  it("emits a cost entry to the kernel once, then reports the replay as a duplicate", async () => {
    const entry = await recordCost(projectBId, {
      entryType: "actual",
      amount: "75.00",
      currency: "IDR",
      entryDate: "2026-02-11",
      idempotencyKey: `post-actual-${Date.now()}`,
    });
    expect(entry.statusCode).toBe(201);
    const entryId = entry.json().id as string;

    const first = await post(`/project-delivery/cost-entries/${entryId}/post`, adminToken, {});
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("emitted");

    const second = await post(`/project-delivery/cost-entries/${entryId}/post`, adminToken, {});
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe("skipped_duplicate");
    expect(second.json().postingId).toBe(first.json().postingId);
  });

  // ========================================================================
  // RBAC, scope and tenant isolation
  // ========================================================================

  it("lets a read-only role read the plan but not change it", async () => {
    const read = await get(`/project-delivery/projects/${projectAId}/schedule`, readerToken);
    expect(read.statusCode).toBe(200);

    const write = await post(`/project-delivery/projects/${projectAId}/wbs`, readerToken, {
      code: "X",
      name: "Should not exist",
    });
    expect(write.statusCode).toBe(403);
  });

  it("does not see another tenant's project", async () => {
    const res = await get(`/project-delivery/projects/${projectAId}/wbs`, otherAdminToken);
    expect(res.statusCode).toBe(404);
    void otherProjectId;
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import {
  activateAllModules,
  authHeader,
  bootstrapTenant,
  provisionFirstAdmin,
  sessionTokenFor,
} from "./helpers.js";

/**
 * WP-APR-02 — Central Rule Registry end-to-end.
 *
 * The single-active invariant is enforced by the DB trigger
 * `rule_registry_supersede_on_activate` (migration 1793000000020): activating
 * a version supersedes the currently active one (sets it `superseded` +
 * `valid_to`). This test proves:
 *
 *   1. registering with `activate: true` produces an `active` v1;
 *   2. registering a second version with `activate: true` supersedes v1 (it
 *      becomes `superseded` with a `valid_to`) and v2 is `active`;
 *   3. `GET /rule-registry/:key` returns both versions in version-desc order;
 *   4. the supersede happens at the DB trigger level, not in the service, so
 *      asserting on the rows directly is the proof.
 *
 * The kernel resolve path (registry consulted before `posting_rules`) is
 * covered by `accounting-kernel-posting-rules.test.ts` plus the fallback unit;
 * here we cover the registry's own contract.
 */

const stamp = `${Date.now().toString(36)}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const TENANT = `p4rr-${stamp}`;
const PASSWORD = "Passw0rd12345!";

const app = buildApp();

describe("WP-APR-02 — Central Rule Registry", () => {
  let tenantId: string;
  let adminToken: string;
  const ruleKey = `test.celebration_rule:${stamp}`;

  beforeAll(async () => {
    const primary = await bootstrapTenant(app, TENANT, "Tenant Phase 4 Rule Registry");
    tenantId = primary.id;
    await activateAllModules(tenantId);
    const admin = await provisionFirstAdmin({
      tenantId,
      email: `p4rr-admin.${stamp}@p4rr.local`,
      password: PASSWORD,
    });
    adminToken = await sessionTokenFor({ userId: admin.userId, tenantId });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE code = ANY($1::text[])`, [
      [TENANT],
    ]);
    await app.close();
    await pool.end();
  });

  it("registers and activates v1", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rule-registry",
      headers: authHeader(adminToken),
      payload: {
        ruleKey,
        payload: { legs: [{ accountCode: "1000", side: "debit", amountExpression: "AMOUNT" }] },
        activate: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.status).toBe("active");
    expect(body.validTo).toBeNull();
  });

  it("lists the active version under the key", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/rule-registry/${encodeURIComponent(ruleKey)}`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe(1);
    expect(list[0].status).toBe("active");
  });

  it("activating v2 supersedes v1 at the DB trigger", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/rule-registry",
      headers: authHeader(adminToken),
      payload: {
        ruleKey,
        payload: { legs: [{ accountCode: "2000", side: "credit", amountExpression: "AMOUNT" }] },
        activate: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const v2 = res.json();
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("active");

    // The trigger must have superseded v1 in the same statement — read the
    // rows directly to prove it was not the service that did it.
    const rows = await pool.query(
      `SELECT version, status, valid_to
         FROM rule_registry_entries
        WHERE tenant_id = $1 AND rule_key = $2
        ORDER BY version ASC`,
      [tenantId, ruleKey],
    );
    const v1Row = rows.rows.find((r) => r.version === 1);
    const v2Row = rows.rows.find((r) => r.version === 2);
    expect(v1Row.status).toBe("superseded");
    expect(v1Row.valid_to).not.toBeNull();
    expect(v2Row.status).toBe("active");
    expect(v2Row.valid_to).toBeNull();
  });

  it("lists both versions in version-desc order", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/rule-registry/${encodeURIComponent(ruleKey)}`,
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(2);
    expect(list[0].version).toBe(2);
    expect(list[1].version).toBe(1);
  });
});

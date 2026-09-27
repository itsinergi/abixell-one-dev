/**
 * Epic 3 Wave 3 — module-active enforcement end-to-end (CORE-ROADMAP.md §4.3
 * step 9 and step 10).
 *
 * Reaches the check the way an attacker would — direct URL, ordinary actor,
 * no menu involved (§4.3 safe order item 8: "uji jalur langsung, bukan hanya
 * klik dari menu"), and against a database separate from `abixell_one_dev`
 * (§4.3 release gate). Run it with DATABASE_URL pointed at a dedicated test
 * database.
 *
 * Everything §4.3's consequence table promises for MODUL NONAKTIF is asserted
 * here against the real app:
 *
 *   create/update/action  → 403 "Modul ini tidak aktif untuk tenant Anda."
 *   baca arsip            → still allowed through the ordinary permissioned
 *                           read path (same actor, same module, GET only)
 *   data                  → untouched: the rejected write leaves no row
 *
 * A positive control closes the loop: the SAME request, with the module turned
 * on, must succeed. Without it a gate that rejected everything would pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { pool } from "../src/infrastructure/persistence/db.js";
import {
  authHeader,
  bootstrapTenant,
  login,
  provisionFirstAdmin,
} from "./integration/helpers.js";

const RUN = Date.now();
const TENANT_CODE = `test-mod-act-${RUN}`;
const OTHER_TENANT_CODE = `test-mod-act-other-${RUN}`;
const ADMIN_EMAIL = `mod-act-${RUN}@example.test`;
const ADMIN_PASSWORD = "Module-Active-1!";
const OTHER_ADMIN_EMAIL = `mod-act-other-${RUN}@example.test`;

const MODULE_INACTIVE_REASON = "Modul ini tidak aktif untuk tenant Anda.";
const bootstrapKey = () =>
  process.env.PLATFORM_BOOTSTRAP_KEY || "dev-only-change-me-bootstrap";

/** A schema-valid HSE report: Fastify validates BEFORE `preHandler`, so an
 * invalid body would return 400 and never exercise the gate's 403. */
const validReport = {
  recordType: "observation" as const,
  occurredAt: new Date().toISOString(),
  title: "Gate probe",
};

describe("Epic 3 Wave 3 — module-active enforcement", () => {
  let app: ReturnType<typeof buildApp>;
  let tenantId: string;
  let otherTenantId: string;
  let adminToken: string;

  const write = (method: string, url: string, payload?: unknown) =>
    app.inject({
      method: method as "POST" | "PATCH" | "PUT" | "DELETE",
      url,
      headers: authHeader(adminToken),
      ...(payload !== undefined ? { payload } : {}),
    });

  /**
   * Runs `body` with `code` activated, then restores the prior state. The
   * activation call itself needs the platform-operator credential (step 10).
   */
  async function withModule(code: string, isActive: boolean, body: () => Promise<void>) {
    const response = await app.inject({
      method: "PUT",
      url: `/config/modules/${code}`,
      headers: { ...authHeader(adminToken), "x-bootstrap-key": bootstrapKey() },
      payload: { isActive },
    });
    expect(response.statusCode).toBe(200);
    try {
      await body();
    } finally {
      await app.inject({
        method: "PUT",
        url: `/config/modules/${code}`,
        headers: { ...authHeader(adminToken), "x-bootstrap-key": bootstrapKey() },
        payload: { isActive: !isActive },
      });
    }
  }

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const tenant = await bootstrapTenant(app, TENANT_CODE, "Module Enforcement");
    tenantId = tenant.id;
    await provisionFirstAdmin({
      tenantId,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    const other = await bootstrapTenant(app, OTHER_TENANT_CODE, "Module Enforcement Other");
    otherTenantId = other.id;
    await provisionFirstAdmin({
      tenantId: otherTenantId,
      email: OTHER_ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    const loginRes = await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(loginRes.statusCode).toBe(200);
    adminToken = loginRes.body.accessToken;

    // The HSE handler mints a business number via the Numbering Core before
    // creating the row; without a sequence the positive control would 404 on
    // `NotFoundError("NumberingSequence", ...)` and prove nothing. /config/*
    // attributes to the `platform` module, which the gate exempts — so a
    // fresh tenant can always configure its own numbering.
    const numbering = await write("POST", "/config/numbering/hse_record", {
      pattern: "HSE-{SEQ:5}",
    });
    expect(numbering.statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
    // FK cascade takes roles, users, permissions grants and activation rows.
    await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
      [tenantId, otherTenantId],
    ]);
  });

  describe("step 9 — inactive module rejects create/update/action", () => {
    it("starts from the default: a fresh tenant has no module active", async () => {
      const me = await app.inject({ method: "GET", url: "/me", headers: authHeader(adminToken) });
      expect(me.statusCode).toBe(200);
      expect(me.json().activeModuleCodes).toEqual([]);
    });

    it("rejects create, update and action with the §4.3 reason, at the URL directly", async () => {
      const probes = [
        ["POST", "/hse/records", validReport],
        ["PATCH", `/hse/records/${"00000000-0000-0000-0000-000000000000"}`, { title: "x" }],
        ["POST", `/hse/records/${"00000000-0000-0000-0000-000000000000"}/lifecycle`, undefined],
      ] as const;

      for (const [method, url, payload] of probes) {
        const response = await write(method, url, payload);
        // 403, not 404 and not 401: the address is real and the actor is
        // authorized — the TENANT turned the module off. §4.3's three-cause
        // table gives each cause a different status and this is the one.
        expect(response.statusCode).toBe(403);
        expect(response.json().error).toBe(MODULE_INACTIVE_REASON);
      }
    });

    it("stops the request before the handler: no data row is created", async () => {
      const before = await pool.query(
        `SELECT count(*)::int AS n FROM hse_records WHERE tenant_id = $1`,
        [tenantId],
      );
      const response = await write("POST", "/hse/records", validReport);
      expect(response.statusCode).toBe(403);

      const after = await pool.query(
        `SELECT count(*)::int AS n FROM hse_records WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(after.rows[0].n).toBe(before.rows[0].n);
    });

    it("still allows the archive read through the ordinary permissioned path", async () => {
      // The actor holds every permission, so a 403 here could only come from
      // the module gate — which must not touch reads (§4.3 "baca arsip tetap
      // boleh"). Data is never deleted, so the register must still open.
      const response = await app.inject({
        method: "GET",
        url: "/hse/records",
        headers: authHeader(adminToken),
      });
      expect(response.statusCode).toBe(200);
    });

    it("does not let one tenant's activation cover another tenant", async () => {
      await withModule("hse", true, async () => {
        // Activated for the first tenant; the second must stay closed.
        const otherLogin = await login(app, OTHER_TENANT_CODE, OTHER_ADMIN_EMAIL, ADMIN_PASSWORD);
        expect(otherLogin.statusCode).toBe(200);
        const response = await app.inject({
          method: "POST",
          url: "/hse/records",
          headers: authHeader(otherLogin.body.accessToken),
          payload: validReport,
        });
        expect(response.statusCode).toBe(403);
        expect(response.json().error).toBe(MODULE_INACTIVE_REASON);
      });
    });

    it("positive control: the same request succeeds once the module is active", async () => {
      await withModule("hse", true, async () => {
        const response = await write("POST", "/hse/records", validReport);
        expect(response.statusCode).toBe(201);
        expect(response.json().id).toBeTruthy();
      });
    });

    it("exempts the platform module, so activation is never blocked by itself", async () => {
      // A fresh tenant has nothing active, including `platform` — yet the
      // activation route must work, or the workspace could never be opened.
      const response = await app.inject({
        method: "PUT",
        url: "/config/modules/hse",
        headers: { ...authHeader(adminToken), "x-bootstrap-key": bootstrapKey() },
        payload: { isActive: false },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("step 10 — only the platform authority may deactivate a module", () => {
    it("refuses a Tenant Admin holding config.manage but no platform credential", async () => {
      // `provisionFirstAdmin` grants every permission, so `config.manage` is
      // held. Without the platform credential the request must stop at 401 —
      // RBAC alone is deliberately not enough (§4.4 "otoritas platform").
      const response = await app.inject({
        method: "PUT",
        url: "/config/modules/hse",
        headers: authHeader(adminToken),
        payload: { isActive: true },
      });
      expect(response.statusCode).toBe(401);
    });

    it("refuses the platform credential alone, with no valid actor", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/config/modules/hse",
        headers: { "x-bootstrap-key": bootstrapKey() },
        payload: { isActive: true },
      });
      expect(response.statusCode).toBe(401);
    });

    it("accepts both together, and the change is real", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/config/modules/hse",
        headers: { ...authHeader(adminToken), "x-bootstrap-key": bootstrapKey() },
        payload: { isActive: true },
      });
      expect(response.statusCode).toBe(200);

      const me = await app.inject({ method: "GET", url: "/me", headers: authHeader(adminToken) });
      expect(me.json().activeModuleCodes).toContain("hse");

      await app.inject({
        method: "PUT",
        url: "/config/modules/hse",
        headers: { ...authHeader(adminToken), "x-bootstrap-key": bootstrapKey() },
        payload: { isActive: false },
      });
    });
  });
});

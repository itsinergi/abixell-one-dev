import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

describe("Phase 4 — WMS & Procurement Routes with Backward Compatibility Shim", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Authentication gate on new canonical namespaces", () => {
    it("returns 401 Unauthorized for unauthenticated /wms/warehouses", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/wms/warehouses",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 Unauthorized for unauthenticated /procurement/rfqs", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/procurement/rfqs",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 Unauthorized for unauthenticated /procurement/contracts", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/procurement/contracts",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 Unauthorized for unauthenticated /wms/balances", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/wms/balances",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("Backward-compatibility shim on legacy /supply-chain/advanced/*", () => {
    it("attaches Deprecation and Sunset headers to legacy route requests", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/supply-chain/advanced/warehouses",
      });
      // Even on 401 Unauthorized, the onSend hook runs and attaches the headers
      expect(res.statusCode).toBe(401);
      expect(res.headers["deprecation"]).toBe("true");
      expect(res.headers["sunset"]).toBeDefined();
    });

    it("does NOT attach Deprecation header to canonical /wms routes", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/wms/warehouses",
      });
      expect(res.statusCode).toBe(401);
      expect(res.headers["deprecation"]).toBeUndefined();
    });
  });
});

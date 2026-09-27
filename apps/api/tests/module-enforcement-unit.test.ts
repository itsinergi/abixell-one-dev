/**
 * Epic 3 Wave 3 — module-active enforcement, unit matrix (CORE-ROADMAP.md §4.3
 * step 9).
 *
 * The wiring is proved end-to-end in module-enforcement.test.ts. This file
 * pins the decision rule alone, so a failure here says the RULE is wrong
 * rather than "the hook did not run", and every branch is exercised without a
 * database.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateModuleActivity,
  MODULE_INACTIVE_REASON,
  MUTATING_METHODS,
} from "../src/domain/configuration/module-enforcement.js";

const ACTIVE_NONE: string[] = [];
const ACTIVE_HSE = ["hse"];

describe("evaluateModuleActivity — method axis", () => {
  it("never blocks a read, whatever the module state", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(
        evaluateModuleActivity({ method, path: "/hse/records", activeModuleCodes: ACTIVE_NONE }),
      ).toEqual({ allowed: true });
    }
  });

  it("blocks each mutating method §4.3 calls create/update/action", () => {
    for (const method of MUTATING_METHODS) {
      const decision = evaluateModuleActivity({
        method,
        path: "/hse/records",
        activeModuleCodes: ACTIVE_NONE,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.moduleCode).toBe("hse");
      expect(decision.reason).toBe(MODULE_INACTIVE_REASON);
    }
  });
});

describe("evaluateModuleActivity — the platform exemption", () => {
  // Without this, PUT /config/modules/:code — the route that activates
  // anything — would be rejected for every tenant whose modules are all
  // inactive, which is the default state of a fresh tenant.
  it("lets platform mutating routes through even with nothing active", () => {
    for (const path of ["/config/modules/hse", "/users/abc", "/auth/logout", "/tenants"]) {
      expect(
        evaluateModuleActivity({ method: "PUT", path, activeModuleCodes: ACTIVE_NONE }).allowed,
      ).toBe(true);
    }
  });
});

describe("evaluateModuleActivity — attribution", () => {
  it("passes a path with no first segment (the root) rather than defaulting it", () => {
    expect(
      evaluateModuleActivity({ method: "POST", path: "/", activeModuleCodes: ACTIVE_NONE }).allowed,
    ).toBe(true);
  });

  it("passes an unknown first segment: no module to consult", () => {
    expect(
      evaluateModuleActivity({ method: "POST", path: "/not-a-module/x", activeModuleCodes: ACTIVE_NONE })
        .allowed,
    ).toBe(true);
  });

  it("resolves a module from the first segment only, ignoring the rest of the path", () => {
    expect(
      evaluateModuleActivity({
        method: "POST",
        path: "/work-orders/:id/complete",
        activeModuleCodes: ACTIVE_NONE,
      }).moduleCode,
    ).toBe("service_operations");
  });
});

describe("evaluateModuleActivity — activity axis", () => {
  it("allows the write when that module is active", () => {
    expect(
      evaluateModuleActivity({ method: "POST", path: "/hse/records", activeModuleCodes: ACTIVE_HSE }),
    ).toEqual({ allowed: true, moduleCode: "hse" });
  });

  it("treats a module with no activation row the same as an explicit false", () => {
    // `listActiveModuleCodes` returns `is_active = true` rows only — absence
    // and false are the same state on this axis, and both must reject.
    const absent = evaluateModuleActivity({
      method: "POST",
      path: "/hse/records",
      activeModuleCodes: ["asset", "finance"],
    });
    expect(absent.allowed).toBe(false);
  });

  it("does not let one active module carry another", () => {
    expect(
      evaluateModuleActivity({
        method: "DELETE",
        path: "/finance/transactions/:id",
        activeModuleCodes: ACTIVE_HSE,
      }).allowed,
    ).toBe(false);
  });
});

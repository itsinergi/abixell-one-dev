import { describe, expect, it } from "vitest";
import type { ParameterReader } from "../src/domain/configuration/parameter-reader.js";
import { PgParameterReader } from "../src/infrastructure/configuration/parameter-reader.pg.js";
import type { ConfigurationService } from "../src/application/configuration/configuration.service.js";
import { DocumentService } from "../src/application/document/document.service.js";
import { newRefreshTokenExpiry } from "../src/infrastructure/security/jwt.js";
import { ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS } from "../src/domain/organization-unit/organization-unit-hierarchy.entity.js";
import { OrganizationUnitHierarchyService } from "../src/application/organization-unit/organization-unit-hierarchy.service.js";
import { ConflictError } from "../src/domain/shared-kernel/errors.js";
import type { ActorContext } from "../src/domain/shared-kernel/audit-context.js";

/** A reader that answers from a fixed map and records what was asked. */
function reader(values: Record<string, number>): ParameterReader & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async getInteger(_tenantId, code, fallback) {
      asked.push(code);
      return code in values ? values[code]! : fallback;
    },
  };
}

function readerFromStored(value: unknown): PgParameterReader {
  const configuration = {
    getEffectiveParameterValueForTrustedCaller: async () => value,
  } as unknown as ConfigurationService;
  return new PgParameterReader(configuration);
}

describe("PgParameterReader", () => {
  it("returns a stored integer", async () => {
    expect(await readerFromStored(7).getInteger("t", "c", 99)).toBe(7);
  });

  it("returns an integer stored as a numeric string", async () => {
    expect(await readerFromStored("12").getInteger("t", "c", 99)).toBe(12);
  });

  it("falls back for null, undefined and an empty string — never turns them into 0", async () => {
    expect(await readerFromStored(null).getInteger("t", "c", 99)).toBe(99);
    expect(await readerFromStored(undefined).getInteger("t", "c", 99)).toBe(99);
    expect(await readerFromStored("").getInteger("t", "c", 99)).toBe(99);
    expect(await readerFromStored("   ").getInteger("t", "c", 99)).toBe(99);
  });

  it("falls back for a non-integer or non-numeric value", async () => {
    expect(await readerFromStored(1.5).getInteger("t", "c", 99)).toBe(99);
    expect(await readerFromStored("abc").getInteger("t", "c", 99)).toBe(99);
    expect(await readerFromStored(NaN).getInteger("t", "c", 99)).toBe(99);
  });

  it("keeps a legitimate zero (backdate limit 0 = no backdating)", async () => {
    expect(await readerFromStored(0).getInteger("t", "c", 90)).toBe(0);
  });
});

describe("refresh token expiry", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("defaults to 7 days when no TTL is supplied", () => {
    const before = Date.now();
    const expiry = newRefreshTokenExpiry().getTime();
    expect(expiry - before).toBeGreaterThanOrEqual(7 * DAY - 1000);
    expect(expiry - before).toBeLessThanOrEqual(7 * DAY + 1000);
  });

  it("uses the supplied number of days", () => {
    const before = Date.now();
    const expiry = newRefreshTokenExpiry(3).getTime();
    expect(expiry - before).toBeGreaterThanOrEqual(3 * DAY - 1000);
    expect(expiry - before).toBeLessThanOrEqual(3 * DAY + 1000);
  });
});

describe("DocumentService upload ceiling", () => {
  const actor = { tenantId: "t1", userId: "u1" } as unknown as ActorContext;
  const MB = 1024 * 1024;

  function service(parameters?: ParameterReader) {
    const rbac = { requirePermission: async () => undefined };
    return new DocumentService(
      {} as never,
      {} as never,
      {} as never,
      rbac as never,
      {} as never,
      new Map(),
      parameters,
    );
  }
  const input = (bytes: number) => ({
    entityType: "demo_transaction",
    entityId: "e1",
    fileName: "f.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(bytes),
  });

  it("refuses a file over the configured limit and names that limit", async () => {
    const r = reader({ "platform.document.max_upload_mb": 2 });
    await expect(service(r).upload(actor, input(3 * MB))).rejects.toThrow(/2MB upload cap/);
    expect(r.asked).toEqual(["platform.document.max_upload_mb"]);
  });

  it("refuses over the 20 MB default when nothing is configured", async () => {
    await expect(service(reader({})).upload(actor, input(21 * MB))).rejects.toThrow(/20MB upload cap/);
  });

  it("refuses over the 20 MB default when no reader is wired at all", async () => {
    await expect(service().upload(actor, input(21 * MB))).rejects.toThrow(/20MB upload cap/);
  });
});

describe("OrganizationUnitHierarchyService backdate bound", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const actor = { tenantId: "t1", userId: "u1" } as unknown as ActorContext;

  function service(parameters?: ParameterReader) {
    const rbac = {
      requirePermission: async () => undefined,
      requireOrganizationUnitScopeForActor: async () => undefined,
    };
    const units = { findById: async () => ({ id: "ou1", tenantId: "t1" }) };
    const repo = { createChangeRequest: async () => ({ id: "cr1" }) };
    return new OrganizationUnitHierarchyService(repo as never, units as never, rbac as never, parameters);
  }
  const request = (daysAgo: number) =>
    ({
      organizationUnitId: "ou1",
      requestedEffectiveFrom: new Date(Date.now() - daysAgo * DAY),
      reason: "restructure",
    }) as never;

  it("keeps 90 days as the default bound", () => {
    expect(ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS).toBe(90);
  });

  it("accepts a 60-day backdate under the default and refuses a 100-day one", async () => {
    const s = service(reader({}));
    await expect(s.createChangeRequest(actor, request(60))).resolves.toBeDefined();
    await expect(s.createChangeRequest(actor, request(100))).rejects.toThrow(ConflictError);
  });

  it("tightens to the configured bound and reports it in the refusal", async () => {
    const s = service(reader({ "platform.organization_unit.backdate_limit_days": 30 }));
    await expect(s.createChangeRequest(actor, request(60))).rejects.toThrow(/limited to 30 days/);
  });

  it("widens to the configured bound", async () => {
    const s = service(reader({ "platform.organization_unit.backdate_limit_days": 200 }));
    await expect(s.createChangeRequest(actor, request(150))).resolves.toBeDefined();
  });

  it("treats a configured 0 as 'no backdating', not as 'unset'", async () => {
    const s = service(reader({ "platform.organization_unit.backdate_limit_days": 0 }));
    await expect(s.createChangeRequest(actor, request(1))).rejects.toThrow(/limited to 0 days/);
  });

  it("behaves as before when no reader is wired", async () => {
    const s = service();
    await expect(s.createChangeRequest(actor, request(60))).resolves.toBeDefined();
    await expect(s.createChangeRequest(actor, request(100))).rejects.toThrow(/limited to 90 days/);
  });
});

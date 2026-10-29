import { describe, expect, it } from "vitest";
import type {
  ModuleConfigManifest,
  ModuleConfigParameterManifest,
} from "../src/domain/configuration/module-config-manifest.entity.js";
import { encodeLevels } from "../src/domain/configuration/module-config-manifest.entity.js";
import type {
  ModuleConfigSyncEntry,
  ModuleConfigSyncPort,
} from "../src/domain/configuration/module-config-sync.port.js";
import { MODULE_CONFIG_MANIFESTS } from "../src/application/configuration/manifests/index.js";
import {
  ModuleConfigLoader,
  buildDedicatedSchema,
} from "../src/application/configuration/module-config-loader.js";
import { InMemoryModuleConfigRegistry } from "../src/application/configuration/module-config-registry.js";

class RecordingSync implements ModuleConfigSyncPort {
  entries: ModuleConfigSyncEntry[] = [];
  async sync(entries: ModuleConfigSyncEntry[]) {
    this.entries = entries;
    return { upserted: entries.length };
  }
}

function param(overrides: Partial<ModuleConfigParameterManifest> = {}): ModuleConfigParameterManifest {
  return {
    code: "finance.test.value",
    name: "Test",
    description: "Test parameter",
    parameterType: "integer",
    constraints: { minimum: 1, maximum: 10 },
    defaultValue: 5,
    allowedLevels: ["S", "C"],
    orgOverrideAllowed: false,
    isGuardrail: false,
    ...overrides,
  };
}

const manifest = (parameters: ModuleConfigParameterManifest[], moduleCode = "finance"): ModuleConfigManifest => ({
  moduleCode,
  parameters,
});

// `modules` rows as seeded by migrations (13 business modules + platform).
const KNOWN_MODULE_CODES = [
  "asset",
  "customer_commercial",
  "customer_complaint",
  "finance",
  "hse",
  "platform",
  "procurement_management",
  "project_delivery",
  "reporting_insight",
  "service_operations",
  "supply_chain",
  "survey_assessment",
  "warehouse_management",
  "workforce",
];

describe("module config manifests (shipped catalogue)", () => {
  it("declares exactly the 14 module codes the modules table holds", () => {
    const codes = MODULE_CONFIG_MANIFESTS.map((m) => m.moduleCode).sort();
    expect(codes).toEqual([...KNOWN_MODULE_CODES].sort());
  });

  it("registers without a duplicate module or parameter code", () => {
    const registry = new InMemoryModuleConfigRegistry();
    expect(() => MODULE_CONFIG_MANIFESTS.forEach((m) => registry.register(m))).not.toThrow();
  });

  it("passes every loader validation with the shipped defaults", async () => {
    const sync = new RecordingSync();
    const result = await new ModuleConfigLoader(sync).load(MODULE_CONFIG_MANIFESTS);
    // 5 new parameters; the 4 legacy rows are described, never re-synced.
    expect(result.upserted).toBe(5);
    expect(sync.entries.map((e) => e.parameter.code).sort()).toEqual([
      "customer_complaint.dashboard.default_period_days",
      "finance.accounting.max_posting_attempts",
      "platform.auth.refresh_token_ttl_days",
      "platform.document.max_upload_mb",
      "platform.organization_unit.backdate_limit_days",
    ]);
  });

  it("keeps the security and audit parameters as guardrails with no Organization level", () => {
    const registry = new InMemoryModuleConfigRegistry();
    MODULE_CONFIG_MANIFESTS.forEach((m) => registry.register(m));
    for (const code of [
      "platform.auth.refresh_token_ttl_days",
      "platform.organization_unit.backdate_limit_days",
      "finance.accounting.max_posting_attempts",
    ]) {
      const p = registry.findParameter(code)!;
      expect(p.isGuardrail).toBe(true);
      expect(p.allowedLevels).not.toContain("O");
    }
  });

  it("marks the three never-read document.* parameters as not in use", () => {
    const registry = new InMemoryModuleConfigRegistry();
    MODULE_CONFIG_MANIFESTS.forEach((m) => registry.register(m));
    for (const code of [
      "document.backdate.max_days",
      "document.numbering.pattern_policy",
      "document.attachment.reference_required",
    ]) {
      expect(registry.findParameter(code)).toMatchObject({ inUse: false, legacyRow: true });
    }
  });

  it("never lets the upload parameter exceed the 20 MB infrastructure ceiling", () => {
    const registry = new InMemoryModuleConfigRegistry();
    MODULE_CONFIG_MANIFESTS.forEach((m) => registry.register(m));
    expect(registry.findParameter("platform.document.max_upload_mb")!.constraints).toEqual({
      minimum: 1,
      maximum: 20,
    });
  });
});

describe("ModuleConfigLoader validation", () => {
  const load = (m: ModuleConfigManifest[]) => new ModuleConfigLoader(new RecordingSync()).load(m);

  it("rejects a guardrail that allows an Organization override", async () => {
    await expect(
      load([manifest([param({ isGuardrail: true, orgOverrideAllowed: true, allowedLevels: ["S", "C", "O"] })])]),
    ).rejects.toThrow(/guardrail cannot allow Organization override/);
  });

  it("rejects level O when orgOverrideAllowed is false", async () => {
    await expect(load([manifest([param({ allowedLevels: ["S", "O"] })])])).rejects.toThrow(
      /level 'O' listed but orgOverrideAllowed is false/,
    );
  });

  it("rejects a default that violates its own bounds", async () => {
    await expect(load([manifest([param({ defaultValue: 99 })])])).rejects.toThrow(
      /violates its own constraints/,
    );
  });

  it("rejects a code that does not start with its module code", async () => {
    await expect(load([manifest([param({ code: "hse.test.value" })])])).rejects.toThrow(
      /code must start with 'finance\.'/,
    );
  });

  it("rejects an empty or duplicated allowedLevels", async () => {
    await expect(load([manifest([param({ allowedLevels: [] })])])).rejects.toThrow(/allowedLevels is empty/);
    await expect(load([manifest([param({ allowedLevels: ["S", "S"] })])])).rejects.toThrow(/duplicates/);
  });

  it("rejects bounds that do not fit the parameter type", () => {
    expect(() => buildDedicatedSchema(param({ parameterType: "string", constraints: { minimum: 1 } }))).toThrow(
      /minimum\/maximum apply to integer\/decimal only/,
    );
    expect(() => buildDedicatedSchema(param({ parameterType: "integer", constraints: { maxLength: 3 } }))).toThrow(
      /maxLength applies to string only/,
    );
  });

  it("returns no dedicated schema when a parameter has no constraints", () => {
    expect(buildDedicatedSchema(param({ constraints: undefined }))).toBeNull();
  });

  it("builds a dedicated schema keyed by the parameter code", async () => {
    const sync = new RecordingSync();
    await new ModuleConfigLoader(sync).load([manifest([param()])]);
    expect(sync.entries[0]).toMatchObject({
      schemaKey: "finance.test.value",
      dedicatedSchema: { type: "integer", minimum: 1, maximum: 10 },
    });
  });

  it("falls back to the standard value_<type> schema when unconstrained", async () => {
    const sync = new RecordingSync();
    await new ModuleConfigLoader(sync).load([manifest([param({ constraints: undefined })])]);
    expect(sync.entries[0]).toMatchObject({ schemaKey: "value_integer", dedicatedSchema: null });
  });

  it("does not call the sync port when there is nothing to sync", async () => {
    const sync = new RecordingSync();
    const result = await new ModuleConfigLoader(sync).load([manifest([])]);
    expect(result.upserted).toBe(0);
    expect(sync.entries).toEqual([]);
  });
});

describe("InMemoryModuleConfigRegistry", () => {
  it("refuses a second manifest for the same module", () => {
    const registry = new InMemoryModuleConfigRegistry();
    registry.register(manifest([]));
    expect(() => registry.register(manifest([]))).toThrow(/already registered/);
  });

  it("refuses one parameter code claimed by two modules", () => {
    const registry = new InMemoryModuleConfigRegistry();
    registry.register(manifest([param({ code: "finance.dup" })], "finance"));
    expect(() => registry.register(manifest([param({ code: "finance.dup" })], "hse"))).toThrow(
      /registered by more than one manifest/,
    );
  });
});

describe("encodeLevels", () => {
  it("emits the order the allowed_levels CHECK constraint accepts", () => {
    expect(encodeLevels(["C", "S"])).toBe("S,C");
    expect(encodeLevels(["O", "S", "C"])).toBe("S,C,O");
    expect(encodeLevels(["C"])).toBe("C");
  });
});

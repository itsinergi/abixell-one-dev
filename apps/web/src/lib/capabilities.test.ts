import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MODULE_METADATA,
  ModuleCode,
  NAV_SECTIONS,
  PERMISSIONS,
  canSeeSection,
  visibleNavTree,
  filterNavTree,
  activeNavModuleCodes,
  visibleSectionGroups,
} from "./capabilities.js";

describe("Frontend Module-Activated Navigation Capabilities", () => {
  it("defines metadata for all 13 canonical module codes", () => {
    const expectedModules: ModuleCode[] = [
      "customer_complaint",
      "survey_assessment",
      "service_operations",
      "customer_commercial",
      "workforce",
      "warehouse_management",
      "procurement_management",
      "asset",
      "finance",
      "hse",
      "project_delivery",
      "reporting_insight",
    ];

    for (const code of expectedModules) {
      assert.ok(MODULE_METADATA[code], `Module metadata missing for ${code}`);
      assert.ok(MODULE_METADATA[code].label.length > 0, `Module ${code} label is empty`);
      assert.ok(
        ["operations", "enterprise-core", "governance"].includes(
          MODULE_METADATA[code].group,
        ),
        `Module ${code} has invalid group: ${MODULE_METADATA[code].group}`,
      );
    }
  });

  describe("canSeeSection fail-closed gating", () => {
    const sampleHseSection = NAV_SECTIONS.find((s) => s.key === "hse")!;
    const sampleOverviewSection = NAV_SECTIONS.find((s) => s.key === "overview")!;
    const sampleFinanceSection = NAV_SECTIONS.find((s) => s.key === "finance-transactions")!;

    it("allows access when module is active, permissions match, and scopes match", () => {
      const allowed = canSeeSection(
        sampleHseSection,
        [PERMISSIONS.hseRead],
        ["tenant"],
        ["hse"],
      );
      assert.equal(allowed, true);
    });

    it("fails closed when module is not in activeModuleCodes even if user has permissions", () => {
      const allowed = canSeeSection(
        sampleHseSection,
        [PERMISSIONS.hseRead],
        ["tenant"],
        ["finance", "supply_chain"], // hse not active
      );
      assert.equal(allowed, false);
    });

    it("fails closed when activeModuleCodes is empty or omitted for modular sections", () => {
      assert.equal(
        canSeeSection(sampleHseSection, [PERMISSIONS.hseRead], ["tenant"], []),
        false,
      );
      assert.equal(
        canSeeSection(sampleHseSection, [PERMISSIONS.hseRead], ["tenant"]),
        false,
      );
    });

    it("allows non-modular sections when activeModuleCodes is empty if RBAC/scope pass", () => {
      assert.equal(
        canSeeSection(sampleOverviewSection, [], ["tenant"], []),
        true,
      );
    });

    it("enforces RBAC permissions even when module is active", () => {
      const allowed = canSeeSection(
        sampleFinanceSection,
        ["unrelated.perm"],
        ["tenant"],
        ["finance"],
      );
      assert.equal(allowed, false);
    });

    it("enforces data scope requirements (requiresInternal)", () => {
      // Customer scope should be rejected
      const customerScopeAllowed = canSeeSection(
        sampleFinanceSection,
        [PERMISSIONS.financeRead],
        ["customer"],
        ["finance"],
      );
      assert.equal(customerScopeAllowed, false);

      // Internal scope should be accepted
      const internalScopeAllowed = canSeeSection(
        sampleFinanceSection,
        [PERMISSIONS.financeRead],
        ["tenant"],
        ["finance"],
      );
      assert.equal(internalScopeAllowed, true);
    });
  });

  describe("visibleNavTree structure and filtering", () => {
    it("returns hierarchical tree with active modules and top-level sections", () => {
      const fullPermissions = [
        PERMISSIONS.hseRead,
        PERMISSIONS.financeRead,
        PERMISSIONS.supplyChainRead,
        PERMISSIONS.adminConsoleRead,
        PERMISSIONS.configManage,
      ];
      const activeCodes: ModuleCode[] = ["hse", "finance"];

      const tree = visibleNavTree(fullPermissions, ["tenant"], activeCodes);

      // Operations group should have Overview (top-level section node)
      const opsGroup = tree.find((g) => g.key === "operations");
      assert.ok(opsGroup, "Operations group should be present");
      const overviewNode = opsGroup.nodes.find((n) => n.type === "section" && n.section.key === "overview");
      assert.ok(overviewNode, "Overview should be top-level section node in Operations");

      // Enterprise Core group should have HSE module node and Finance module node, but NOT Supply Chain
      const ecGroup = tree.find((g) => g.key === "enterprise-core");
      assert.ok(ecGroup, "Enterprise Core group should be present");

      const hseNode = ecGroup.nodes.find((n) => n.type === "module" && n.moduleCode === "hse");
      assert.ok(hseNode, "HSE module node should be present in Enterprise Core");
      if (hseNode && hseNode.type === "module") {
        assert.ok(hseNode.sections.some((s) => s.key === "hse"), "HSE section should be in HSE module");
      }

      const financeNode = ecGroup.nodes.find((n) => n.type === "module" && n.moduleCode === "finance");
      assert.ok(financeNode, "Finance module node should be in Enterprise Core");

      const whNode = ecGroup.nodes.find((n) => n.type === "module" && n.moduleCode === "warehouse_management");
      assert.equal(whNode, undefined, "Warehouse Management module should NOT be visible when inactive");
    });

    it("omits empty groups when no modules or top-level sections match", () => {
      // User with only HSE permissions and only HSE active (HSE is in enterprise-core)
      const tree = visibleNavTree([PERMISSIONS.hseRead], ["tenant"], ["hse"]);
      // Overview requires no permissions so Operations will have Overview, but Governance has nothing
      assert.ok(tree.some((g) => g.key === "enterprise-core"));
      assert.equal(tree.some((g) => g.key === "governance"), false);
    });
  });

  describe("filterNavTree search matching and auto-expansion", () => {
    const fullPermissions = [
      PERMISSIONS.hseRead,
      PERMISSIONS.financeRead,
      PERMISSIONS.supplyChainProcurementRead,
      PERMISSIONS.adminConsoleRead,
      PERMISSIONS.configManage,
    ];
    const activeCodes: ModuleCode[] = ["hse", "finance", "warehouse_management", "procurement_management"];
    const fullTree = visibleNavTree(fullPermissions, ["tenant"], activeCodes);

    it("returns unchanged tree for empty or whitespace query", () => {
      const filtered = filterNavTree(fullTree, "   ");
      assert.equal(filtered.length, fullTree.length);
    });

    it("matches section label and preserves parent module", () => {
      const filtered = filterNavTree(fullTree, "Tendering");
      const ecGroup = filtered.find((g) => g.key === "enterprise-core");
      assert.ok(ecGroup, "Enterprise Core should contain matching procurement");
      const procNode = ecGroup.nodes.find((n) => n.type === "module" && n.moduleCode === "procurement_management");
      assert.ok(procNode, "Procurement Management module should be present");
      if (procNode && procNode.type === "module") {
        assert.ok(
          procNode.sections.some((s) => s.label.includes("Tendering")),
          "RFQ & Tendering section should match",
        );
      }
      // Non-matching modules should be excluded
      const finNode = ecGroup.nodes.find((n) => n.type === "module" && n.moduleCode === "finance");
      assert.equal(finNode, undefined, "Finance should not be present when filtering for Tendering");
    });

    it("matches module label and includes all permitted sections of that module", () => {
      const filtered = filterNavTree(fullTree, "Health, Safety & Environment");
      const ecGroup = filtered.find((g) => g.key === "enterprise-core");
      assert.ok(ecGroup);
      const hseNode = ecGroup.nodes.find((n) => n.type === "module" && n.moduleCode === "hse");
      assert.ok(hseNode);
      if (hseNode && hseNode.type === "module") {
        assert.ok(hseNode.sections.length > 0);
      }
    });

    it("returns empty array when query matches nothing", () => {
      const filtered = filterNavTree(fullTree, "nonexistent-xyz-feature");
      assert.equal(filtered.length, 0);
    });
  });

  describe("activeNavModuleCodes route matching", () => {
    const permissions = [PERMISSIONS.hseRead, PERMISSIONS.financeRead];
    const activeCodes: ModuleCode[] = ["hse", "finance"];
    const tree = visibleNavTree(permissions, ["tenant"], activeCodes);

    it("finds module code for exact path match", () => {
      const codes = activeNavModuleCodes(tree, "/hse");
      assert.deepEqual(codes, ["hse"]);
    });

    it("finds module code for sub-path boundary match", () => {
      const codes = activeNavModuleCodes(tree, "/finance/transactions/123");
      assert.deepEqual(codes, ["finance"]);
    });

    it("does not match partial prefix without slash boundary", () => {
      const codes = activeNavModuleCodes(tree, "/hse-other");
      assert.deepEqual(codes, []);
    });

    it("returns empty array when route is not under any module", () => {
      const codes = activeNavModuleCodes(tree, "/");
      assert.deepEqual(codes, []);
    });
  });

  describe("visibleSectionGroups backward compatibility", () => {
    it("filters flat groups by activeModuleCodes", () => {
      const fullPermissions = [
        PERMISSIONS.hseRead,
        PERMISSIONS.financeRead,
        PERMISSIONS.supplyChainRead,
      ];
      // Only HSE is active
      const groups = visibleSectionGroups(fullPermissions, ["tenant"], ["hse"]);
      const allSections = groups.flatMap((g) => g.sections);

      assert.ok(allSections.some((s) => s.key === "hse"), "HSE section should be present");
      assert.equal(
        allSections.some((s) => s.key === "finance-transactions"),
        false,
        "Finance section should be absent when finance module is inactive",
      );
    });
  });
});

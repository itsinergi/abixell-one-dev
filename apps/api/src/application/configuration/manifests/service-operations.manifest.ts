import type { ModuleConfigManifest } from "../../../domain/configuration/module-config-manifest.entity.js";

/** Shape mirrors migration 1794400000000 so the sync leaves the row as seeded. */
export const SERVICE_OPERATIONS_MANIFEST: ModuleConfigManifest = {
  moduleCode: "service_operations",
  parameters: [
    {
      code: "service_operations.invoice.default_markup",
      name: "Default Invoice Markup Rate",
      description:
        "Default markup rate applied when invoicing a cost-finalized Work Order (0 = cost price; 0.15 = 15% markup)",
      parameterType: "decimal",
      defaultValue: "0",
      allowedLevels: ["S", "C"],
      orgOverrideAllowed: false,
      isGuardrail: false,
      legacyRow: true,
    },
  ],
};

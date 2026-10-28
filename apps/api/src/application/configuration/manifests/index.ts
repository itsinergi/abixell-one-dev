import type { ModuleConfigManifest } from "../../../domain/configuration/module-config-manifest.entity.js";
import { CUSTOMER_COMPLAINT_MANIFEST } from "./customer-complaint.manifest.js";
import { FINANCE_MANIFEST } from "./finance.manifest.js";
import { PLATFORM_MANIFEST } from "./platform.manifest.js";
import { SERVICE_OPERATIONS_MANIFEST } from "./service-operations.manifest.js";

/**
 * Every code in the `modules` table (13 business modules + `platform`). A module
 * with nothing to configure still declares an empty manifest: Panel Admin reads
 * this list, so an absent entry would read as "forgotten" rather than "has no
 * settings yet" (§4.15 Putaran 4 #3).
 */
const MANIFESTS_WITH_PARAMETERS: ModuleConfigManifest[] = [
  PLATFORM_MANIFEST,
  CUSTOMER_COMPLAINT_MANIFEST,
  FINANCE_MANIFEST,
  SERVICE_OPERATIONS_MANIFEST,
];

const MODULES_WITHOUT_PARAMETERS = [
  "survey_assessment",
  "customer_commercial",
  "workforce",
  "supply_chain",
  "warehouse_management",
  "procurement_management",
  "asset",
  "hse",
  "project_delivery",
  "reporting_insight",
] as const;

export const MODULE_CONFIG_MANIFESTS: readonly ModuleConfigManifest[] = [
  ...MANIFESTS_WITH_PARAMETERS,
  ...MODULES_WITHOUT_PARAMETERS.map((moduleCode) => ({ moduleCode, parameters: [] })),
];

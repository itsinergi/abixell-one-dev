import type { ModuleConfigManifest } from "../../../domain/configuration/module-config-manifest.entity.js";

export const CUSTOMER_COMPLAINT_MANIFEST: ModuleConfigManifest = {
  moduleCode: "customer_complaint",
  parameters: [
    {
      code: "customer_complaint.dashboard.default_period_days",
      name: "Periode bawaan dasbor keluhan",
      description:
        "Rentang hari yang ditampilkan dasbor manajemen ketika pengguna tidak memilih tanggal sendiri.",
      parameterType: "integer",
      constraints: { minimum: 1, maximum: 365 },
      unit: "hari",
      defaultValue: 30,
      allowedLevels: ["S", "C"],
      orgOverrideAllowed: false,
      isGuardrail: false,
    },
  ],
};

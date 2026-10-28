import type { ModuleConfigManifest } from "../../../domain/configuration/module-config-manifest.entity.js";

export const FINANCE_MANIFEST: ModuleConfigManifest = {
  moduleCode: "finance",
  parameters: [
    {
      code: "finance.accounting.max_posting_attempts",
      name: "Maksimum percobaan posting jurnal",
      description:
        "Berapa kali event akuntansi dicoba diposting sebelum dinyatakan gagal dan menunggu antrean ulang manual.",
      parameterType: "integer",
      constraints: { minimum: 1, maximum: 20 },
      unit: "kali",
      defaultValue: 5,
      allowedLevels: ["S", "C"],
      orgOverrideAllowed: false,
      isGuardrail: true,
    },
  ],
};

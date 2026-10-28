import type { ModuleConfigManifest } from "../../../domain/configuration/module-config-manifest.entity.js";

/**
 * `platform` owns the settings that cut across every module: file upload,
 * session lifetime, organization structure policy. Each parameter names the
 * constant it replaced; an unconfigured tenant resolves to that same number.
 */
export const PLATFORM_MANIFEST: ModuleConfigManifest = {
  moduleCode: "platform",
  parameters: [
    {
      code: "platform.document.max_upload_mb",
      name: "Batas ukuran unggahan dokumen",
      description:
        "Ukuran maksimum satu berkas yang boleh diunggah. Tidak dapat melampaui plafon infrastruktur 20 MB.",
      parameterType: "integer",
      constraints: { minimum: 1, maximum: 20 },
      unit: "MB",
      defaultValue: 20,
      allowedLevels: ["S", "C"],
      orgOverrideAllowed: false,
      isGuardrail: false,
    },
    {
      code: "platform.organization_unit.backdate_limit_days",
      name: "Batas mundur tanggal perubahan hierarki unit",
      description:
        "Berapa hari ke belakang sebuah perubahan hierarki organisasi boleh diberlakukan surut. Perubahan surut tetap wajib beralasan dan tercatat.",
      parameterType: "integer",
      constraints: { minimum: 0, maximum: 365 },
      unit: "hari",
      defaultValue: 90,
      allowedLevels: ["S", "C"],
      orgOverrideAllowed: false,
      isGuardrail: true,
    },
    {
      code: "platform.auth.refresh_token_ttl_days",
      name: "Masa berlaku sesi masuk",
      description:
        "Berapa hari pengguna tetap masuk tanpa login ulang. Berlaku untuk sesi baru; sesi yang sudah berjalan tidak berubah.",
      parameterType: "integer",
      constraints: { minimum: 1, maximum: 30 },
      unit: "hari",
      defaultValue: 7,
      allowedLevels: ["S", "C"],
      orgOverrideAllowed: false,
      isGuardrail: true,
    },
    // Seeded by Epic 2 Wave 3 as bridge examples. Nothing in the API reads them
    // yet (surveyed 2026-10-28), so the UI marks them "belum dipakai" instead of
    // offering a setting that changes nothing. Shapes mirror migration
    // 1791000000000 exactly so the sync leaves the rows as they were.
    {
      code: "document.backdate.max_days",
      name: "Document Backdate Max Days",
      description: "Maximum days in the past a document can be backdated",
      parameterType: "integer",
      unit: "hari",
      defaultValue: 30,
      allowedLevels: ["S", "C", "O"],
      orgOverrideAllowed: true,
      isGuardrail: false,
      inUse: false,
      legacyRow: true,
    },
    {
      code: "document.numbering.pattern_policy",
      name: "Document Numbering Pattern Policy",
      description: "Naming convention for auto-generated document numbers",
      parameterType: "string",
      defaultValue: "DOC-{YY}{MM}{SEQ:4}",
      allowedLevels: ["S", "C"],
      orgOverrideAllowed: false,
      isGuardrail: false,
      inUse: false,
      legacyRow: true,
    },
    {
      code: "document.attachment.reference_required",
      name: "Document Attachment Reference Required",
      description: "Whether attachments must reference an entity (guardrail)",
      parameterType: "boolean",
      defaultValue: true,
      allowedLevels: ["S", "C"],
      orgOverrideAllowed: false,
      isGuardrail: true,
      inUse: false,
      legacyRow: true,
    },
  ],
};

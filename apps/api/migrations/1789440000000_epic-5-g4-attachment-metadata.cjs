/**
 * Epic 5 Gelombang 4 (§4.5 step 18) — Legal Entity attachment metadata slot.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration M4.
 *
 * Exposes reference metadata for Legal Entity legal documents (e.g., AKTA, NIB,
 * NPWP, DOMISILI) WITHOUT file/object storage, file upload endpoints, virus
 * scanning, or physical file handling (explicitly deferred to the document/file
 * epic, per §4.5 lines 1842-1844).
 *
 * Composite foreign key `(tenant_id, legal_entity_id) → legal_entities(tenant_id, id)`
 * enforces same-Tenant ownership at the database level (§4.5 principle 2).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("legal_entity_attachment_references", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true },
    legal_entity_id: { type: "uuid", notNull: true },
    document_category: { type: "text", notNull: true },
    attachment_reference: { type: "text", notNull: true },
    expiry_date: { type: "date" },
    status: { type: "text", notNull: true, default: "active" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint(
    "legal_entity_attachment_references",
    "le_attach_ref_document_category_check",
    { check: "length(btrim(document_category)) > 0" },
  );

  pgm.addConstraint(
    "legal_entity_attachment_references",
    "le_attach_ref_attachment_reference_check",
    { check: "length(btrim(attachment_reference)) > 0" },
  );

  pgm.addConstraint(
    "legal_entity_attachment_references",
    "le_attach_ref_status_check",
    { check: "status IN ('active', 'expired', 'superseded')" },
  );

  pgm.addConstraint(
    "legal_entity_attachment_references",
    "le_attach_ref_legal_entity_fkey",
    {
      foreignKeys: {
        columns: ["tenant_id", "legal_entity_id"],
        references: "legal_entities(tenant_id, id)",
        onDelete: "CASCADE",
      },
    },
  );

  pgm.createIndex(
    "legal_entity_attachment_references",
    ["tenant_id", "legal_entity_id"],
    { name: "le_attach_ref_tenant_legal_entity_idx" },
  );
};

exports.down = (pgm) => {
  pgm.dropTable("legal_entity_attachment_references");
};

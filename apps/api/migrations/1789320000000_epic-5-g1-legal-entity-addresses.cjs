/**
 * Epic 5 Gelombang 1 (§4.5 step 6) — Typed Legal Entity addresses.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration M3.
 *
 * §4.5 Putaran 3: "Alamat Legal Entity — Multi-address bertipe: registered,
 * operating, billing, tax, serta type lain bila diperlukan." One Legal Entity
 * may therefore hold several addresses, each carrying exactly one type, which
 * is why this is a table and not a set of columns on `legal_entities`.
 * Additional types beyond the four are a later additive change to the CHECK
 * list; §4.5 says they come "hanya melalui daftar metadata yang sah", which is
 * the Application Dictionary work of Gelombang 4, not something Gelombang 1
 * invents here.
 *
 * ── Ownership is a database fact, not a service convention ────────────────
 *
 * §4.5 principle 2: "Satu Legal Entity tidak dapat lintas Tenant. Semua
 * foreign key, query, import, dan mutation memverifikasi kesamaan Tenant
 * secara eksplisit." A single-column FK to `legal_entities(id)` would allow an
 * address row whose `tenant_id` names a different Tenant than the Legal
 * Entity it points at — the exact leak the principle forbids. The composite
 * FK `(tenant_id, legal_entity_id) → legal_entities(tenant_id, id)` makes
 * that row unrepresentable. It relies on
 * `legal_entities_tenant_id_id_unique`, added by 1789310000000, and follows
 * the pattern already used for Organization Units in 1779000000000.
 *
 * ── ON DELETE CASCADE — approved G0 deviation, on a Wave 2 carry-forward ───
 *
 * G0 contract M3 (line 187) specifies `legal_entity_id FK legal_entities ON
 * DELETE RESTRICT`. This migration ships CASCADE instead, under the Founder's
 * explicit sign-off (2026-09-29, item [3.1], recorded as a temporary accepted
 * risk): RESTRICT makes `DELETE FROM tenants` fail whenever the Tenant's Legal
 * Entity still owns an address row, so a Tenant that owns a single address
 * could never be removed — the referential delete would be left half-done and
 * every integration suite's teardown would abort. The G1 guarantee does not
 * depend on the delete action: same-Tenant ownership is carried by the
 * composite key `(tenant_id, legal_entity_id)`, which makes a cross-Tenant
 * address row unrepresentable either way.
 *
 * BINDING ON WAVE 2 (carry-forward, deliberately not resolved here):
 * reference-preserving delete is the tombstone + reference-check registry of
 * §4.5 principle 6 and §4.5 step 13 (G0 §13 Q8). That wave must replace this
 * temporary CASCADE with the contract's RESTRICT **together with** the
 * tombstone flow — RESTRICT on its own, on top of today's delete paths, is
 * exactly the shape measured above to break Tenant teardown. The deviation and
 * its carry-forward are listed in the Epic 5 accepted-risk record.
 *
 * ── One active address per type ───────────────────────────────────────────
 *
 * `legal_entity_addresses_active_type_unique` allows one active address per
 * (Legal Entity, type) while keeping superseded rows readable: a change is a
 * deactivate-then-insert, so the address an old invoice referenced still
 * resolves (§4.5: "tidak boleh menghapus alamat yang sudah direferensikan").
 * The partial index is what makes "at most one current registered address"
 * enforceable instead of aspirational.
 *
 * Additive only: a new table, no change to any existing table.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("legal_entity_addresses", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true },
    legal_entity_id: { type: "uuid", notNull: true },
    address_type: { type: "text", notNull: true },
    line1: { type: "text", notNull: true },
    line2: { type: "text" },
    city: { type: "text" },
    postal_code: { type: "text" },
    country: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
    deactivated_at: { type: "timestamptz" },
    deactivated_by: { type: "uuid" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("legal_entity_addresses", "legal_entity_addresses_address_type_check", {
    check: "address_type IN ('registered','operating','billing','tax')",
  });

  pgm.addConstraint("legal_entity_addresses", "legal_entity_addresses_legal_entity_fkey", {
    foreignKeys: {
      columns: ["tenant_id", "legal_entity_id"],
      references: "legal_entities(tenant_id, id)",
      // G0 M3 says RESTRICT; CASCADE ships with Founder sign-off 2026-09-29
      // [3.1] as a temporary accepted risk. Wave 2 replaces it with RESTRICT
      // plus the tombstone flow — see the header.
      onDelete: "CASCADE",
    },
  });

  pgm.createIndex("legal_entity_addresses", ["tenant_id", "legal_entity_id"], {
    name: "legal_entity_addresses_tenant_legal_entity_idx",
  });

  pgm.createIndex("legal_entity_addresses", ["legal_entity_id", "address_type"], {
    name: "legal_entity_addresses_active_type_unique",
    unique: true,
    where: "is_active = true",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("legal_entity_addresses");
};

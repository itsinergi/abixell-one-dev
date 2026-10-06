/**
 * Epic 5 Gelombang 1 (§4.5 steps 5 and 7) — Department master.
 *
 * G0 contract `docs/plans/epic-5-g0-contract.md` migration M8: "NEW TABLE
 * `departments` (id, tenant_id FK tenants ON DELETE CASCADE,
 * parent_department_id uuid self-FK nullable, name, code, is_active boolean NOT
 * NULL DEFAULT true, created_at, updated_at)". This file carries the contract's
 * own stamp for M8 (`1789370000000`) so the slots reserved below and at
 * `1789380000000` stay free — an earlier draft used `1789386000000`, which
 * would have made a later M9 migration at its contract stamp un-runnable
 * (node-pg-migrate refuses an un-run migration that sorts before an already-run
 * one).
 *
 * ── A Department is NOT an authorization scope ────────────────────────────
 *
 * §4.5 principle 4 and the roadmap risk row "Department dipakai sebagai
 * security scope". The table therefore carries no scope column and no
 * tombstone: a Department organises people, it does not decide who may read or
 * write anything. `is_active` exists so a superseded Department can be retired
 * without a hard delete (§4.5 principle 6 forbids blind hard deletes), and the
 * lifecycle is `active` / `inactive` only — G0 §5: "active / inactive only (no
 * tombstone — not a Data Scope)". A tombstone exists to preserve a *scope*
 * reference for history; a Department has none to preserve.
 *
 * The repository that uses this table never resolves a Data Scope from it: the
 * only filter it applies is `tenant_id`, and every write goes through
 * `inGovernedTransaction` + `requireTransactionActorPermission` where the
 * permission is a CAPABILITY (`department.read` / `.create` / `.update`) and
 * never a scope.
 *
 * ── Constraints ───────────────────────────────────────────────────────────
 *
 * 1. `departments_tenant_fkey` — tenant ownership. CASCADE, so a Tenant removal
 *    takes its master data with it (the same ownership shape the G0 contract
 *    specifies).
 * 2. `departments_parent_fkey` — a COMPOSITE self-FK
 *    `(tenant_id, parent_department_id) → departments(tenant_id, id)`. A
 *    single-column self-FK would let a Department hang under a parent in
 *    another Tenant, which is the cross-tenant leak §4.5 principle 2 forbids
 *    for every reference in the model. It follows the composite-FK pattern
 *    already used for `organization_units` since 1779000000000, and it needs
 *    `departments_tenant_id_id_unique` to reference the tuple.
 *    ON DELETE CASCADE matches `organization_units.parent_id` and keeps a
 *    Tenant removal a single, working cascade instead of an order-dependent
 *    RESTRICT.
 * 3. `departments_tenant_code_unique` — `code` is the business identifier
 *    (§4.5 "identitas bisnis"), so it is unique per Tenant. The repository
 *    translates the 23505 it raises into a 409 rather than a 500.
 * 4. `departments_name_not_blank_check` / `..._code_not_blank_check` — a
 *    whitespace-only name or code is not an identity.
 *
 * Additive only: one new table, no change to any existing table.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("departments", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    // Direct tenant ownership made statically provable: the Phase 11A baseline
    // validator requires this constraint inline so it can parse the column definition.
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    parent_department_id: { type: "uuid" },
    name: { type: "text", notNull: true },
    code: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.addConstraint("departments", "departments_tenant_id_id_unique", {
    unique: ["tenant_id", "id"],
  });

  // Raw SQL, not `pgm.addConstraint`: the composite self-FK needs the tuple
  // `(tenant_id, id)` as its target, which the `foreignKeys` shorthand cannot
  // express. Same shape as the composite FKs already used since 1779000000000.
  pgm.sql(`
    ALTER TABLE departments
      ADD CONSTRAINT departments_parent_fkey
      FOREIGN KEY (tenant_id, parent_department_id)
      REFERENCES departments (tenant_id, id)
      ON DELETE CASCADE;
  `);

  pgm.addConstraint("departments", "departments_name_not_blank_check", {
    check: "length(btrim(name)) > 0",
  });

  pgm.addConstraint("departments", "departments_code_not_blank_check", {
    check: "code IS NULL OR length(btrim(code)) > 0",
  });

  pgm.createIndex("departments", ["tenant_id", "code"], {
    name: "departments_tenant_code_unique",
    unique: true,
  });

  pgm.createIndex("departments", ["tenant_id", "parent_department_id"], {
    name: "departments_tenant_parent_idx",
  });
};

exports.down = (pgm) => {
  pgm.dropTable("departments");
};

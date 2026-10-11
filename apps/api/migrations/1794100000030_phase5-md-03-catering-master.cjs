/**
 * WP-MD-03 — Catering vertical master (DEC-007, K5/K6).
 *
 * K5: structure + simple costing (recipe cost = sum ingredient cost).
 * Nutrition deferred. K6: recipe ingredient UoM uses the WP-MD-02 conversion
 * engine (units_of_measure / unit_conversions must already exist).
 *
 * Tables:
 *   catering_menus              — named collection of recipes
 *   catering_recipes            — output item + yield quantity
 *   catering_recipe_ingredients — recipe → item + qty + UoM
 *   catering_meal_plans         — menu schedule per site/date/meal_type
 *   catering_meal_batches       — production batch (nullable output FIFO layer)
 *
 * Tenant isolation is enforced at the DB level with composite foreign keys
 * (tenant_id, <ref>) → (tenant_id, id), the pattern scm_valuation_layers
 * (1781000000000) established for items. A single-column FK would let a row
 * reference another tenant's item/site/unit by id; a composite FK makes that
 * a constraint violation instead of a silent cross-tenant leak. The two
 * referenced tables that lack (tenant_id, id) unique get it added here.
 */
exports.up = (pgm) => {
  // Referenced tables need (tenant_id, id) unique for composite FKs. items
  // already has items_tenant_id_id_unique (1779000000000); units_of_measure
  // and sites do not.
  pgm.sql(`ALTER TABLE units_of_measure ADD CONSTRAINT units_of_measure_tenant_id_id_unique UNIQUE (tenant_id, id)`);
  pgm.sql(`ALTER TABLE sites ADD CONSTRAINT sites_tenant_id_id_unique UNIQUE (tenant_id, id)`);

  // --- catering_menus -------------------------------------------------------
  pgm.createTable("catering_menus", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    is_active: { type: "boolean", notNull: true, default: true },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("catering_menus", "catering_menus_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.addConstraint("catering_menus", "catering_menus_tenant_id_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("catering_menus", "catering_menus_window_check", {
    check: "effective_to IS NULL OR effective_to >= effective_from",
  });

  // --- catering_recipes -----------------------------------------------------
  pgm.createTable("catering_recipes", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    code: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    description: { type: "text" },
    // Composite FKs declared below (tenant_id, output_item_id) etc.
    output_item_id: { type: "uuid", notNull: true },
    output_quantity: { type: "numeric(18,4)", notNull: true },
    output_unit_id: { type: "uuid", notNull: true },
    is_active: { type: "boolean", notNull: true, default: true },
    effective_from: { type: "date", notNull: true },
    effective_to: { type: "date" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("catering_recipes", "catering_recipes_unique", {
    unique: ["tenant_id", "code"],
  });
  pgm.addConstraint("catering_recipes", "catering_recipes_tenant_id_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("catering_recipes", "catering_recipes_window_check", {
    check: "effective_to IS NULL OR effective_to >= effective_from",
  });
  pgm.addConstraint("catering_recipes", "catering_recipes_output_qty_check", {
    check: "output_quantity > 0",
  });
  pgm.sql(`
    ALTER TABLE catering_recipes
      ADD CONSTRAINT catering_recipes_output_item_fk
        FOREIGN KEY (tenant_id, output_item_id) REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT catering_recipes_output_unit_fk
        FOREIGN KEY (tenant_id, output_unit_id) REFERENCES units_of_measure(tenant_id, id) ON DELETE RESTRICT
  `);

  // --- catering_recipe_ingredients -----------------------------------------
  pgm.createTable("catering_recipe_ingredients", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    recipe_id: { type: "uuid", notNull: true },
    item_id: { type: "uuid", notNull: true },
    quantity: { type: "numeric(18,4)", notNull: true },
    unit_id: { type: "uuid", notNull: true },
    sort_order: { type: "integer", notNull: true, default: 0 },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("catering_recipe_ingredients", "catering_recipe_ingredients_unique", {
    unique: ["tenant_id", "recipe_id", "item_id"],
  });
  pgm.addConstraint("catering_recipe_ingredients", "catering_recipe_ingredients_qty_check", {
    check: "quantity > 0",
  });
  pgm.createIndex("catering_recipe_ingredients", ["tenant_id", "recipe_id"]);
  pgm.sql(`
    ALTER TABLE catering_recipe_ingredients
      ADD CONSTRAINT catering_recipe_ingredients_recipe_fk
        FOREIGN KEY (tenant_id, recipe_id) REFERENCES catering_recipes(tenant_id, id) ON DELETE CASCADE,
      ADD CONSTRAINT catering_recipe_ingredients_item_fk
        FOREIGN KEY (tenant_id, item_id) REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT catering_recipe_ingredients_unit_fk
        FOREIGN KEY (tenant_id, unit_id) REFERENCES units_of_measure(tenant_id, id) ON DELETE RESTRICT
  `);

  // --- catering_meal_plans --------------------------------------------------
  pgm.createTable("catering_meal_plans", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    menu_id: { type: "uuid", notNull: true },
    site_id: { type: "uuid" },
    meal_date: { type: "date", notNull: true },
    meal_type: {
      type: "text",
      notNull: true,
      check: "meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')",
    },
    planned_portions: { type: "integer", notNull: true, default: 1 },
    notes: { type: "text" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("catering_meal_plans", "catering_meal_plans_unique_slot", {
    unique: ["tenant_id", "site_id", "meal_date", "meal_type"],
  });
  pgm.addConstraint("catering_meal_plans", "catering_meal_plans_tenant_id_id_unique", {
    unique: ["tenant_id", "id"],
  });
  pgm.addConstraint("catering_meal_plans", "catering_meal_plans_portions_check", {
    check: "planned_portions > 0",
  });
  pgm.createIndex("catering_meal_plans", ["tenant_id", "meal_date"]);
  pgm.sql(`
    ALTER TABLE catering_meal_plans
      ADD CONSTRAINT catering_meal_plans_menu_fk
        FOREIGN KEY (tenant_id, menu_id) REFERENCES catering_menus(tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT catering_meal_plans_site_fk
        FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id) ON DELETE SET NULL (site_id)
  `);

  // --- catering_meal_batches ------------------------------------------------
  // output_valuation_layer_id is nullable: a batch starts in draft with no
  // FIFO layer; confirmation (deferred — no GL posting in K5) would later
  // stamp the produced output layer. The column is the structural hook for
  // that link (DEC-007 scope line: "output item + FIFO layer").
  pgm.createTable("catering_meal_batches", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    tenant_id: { type: "uuid", notNull: true, references: "tenants", onDelete: "CASCADE" },
    batch_number: { type: "text", notNull: true },
    meal_plan_id: { type: "uuid" },
    recipe_id: { type: "uuid", notNull: true },
    output_item_id: { type: "uuid", notNull: true },
    output_quantity: { type: "numeric(18,4)", notNull: true },
    output_unit_id: { type: "uuid", notNull: true },
    output_valuation_layer_id: { type: "uuid" },
    status: {
      type: "text",
      notNull: true,
      default: "draft",
      check: "status IN ('draft', 'confirmed', 'consumed')",
    },
    produced_at: { type: "timestamptz" },
    created_by: { type: "uuid" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_by: { type: "uuid" },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("catering_meal_batches", "catering_meal_batches_unique", {
    unique: ["tenant_id", "batch_number"],
  });
  pgm.addConstraint("catering_meal_batches", "catering_meal_batches_output_qty_check", {
    check: "output_quantity > 0",
  });
  pgm.createIndex("catering_meal_batches", ["tenant_id", "status"]);
  pgm.sql(`
    ALTER TABLE catering_meal_batches
      ADD CONSTRAINT catering_meal_batches_meal_plan_fk
        FOREIGN KEY (tenant_id, meal_plan_id) REFERENCES catering_meal_plans(tenant_id, id) ON DELETE SET NULL (meal_plan_id),
      ADD CONSTRAINT catering_meal_batches_recipe_fk
        FOREIGN KEY (tenant_id, recipe_id) REFERENCES catering_recipes(tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT catering_meal_batches_output_item_fk
        FOREIGN KEY (tenant_id, output_item_id) REFERENCES items(tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT catering_meal_batches_output_unit_fk
        FOREIGN KEY (tenant_id, output_unit_id) REFERENCES units_of_measure(tenant_id, id) ON DELETE RESTRICT,
      ADD CONSTRAINT catering_meal_batches_output_layer_fk
        FOREIGN KEY (tenant_id, output_valuation_layer_id) REFERENCES scm_valuation_layers(tenant_id, id) ON DELETE SET NULL (output_valuation_layer_id)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("catering_meal_batches", { ifExists: true });
  pgm.dropTable("catering_meal_plans", { ifExists: true });
  pgm.dropTable("catering_recipe_ingredients", { ifExists: true });
  pgm.dropTable("catering_recipes", { ifExists: true });
  pgm.dropTable("catering_menus", { ifExists: true });
  // Drop the (tenant_id, id) unique constraints we added; the base tables
  // themselves are owned by earlier migrations and stay.
  pgm.sql(`ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_tenant_id_id_unique`);
  pgm.sql(`ALTER TABLE units_of_measure DROP CONSTRAINT IF EXISTS units_of_measure_tenant_id_id_unique`);
};

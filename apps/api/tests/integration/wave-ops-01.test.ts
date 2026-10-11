import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, login, provisionFirstAdmin } from "./helpers.js";

/**
 * Wave OPS-01 — Catering pack activation gate (WP-OPS-01).
 *
 * The catering vertical's writes must be rejected when the tenant's catering
 * Service Pack is not active; reads stay open so an admin can inspect state
 * before reactivating. Activating/deactivating uses the real Wave A3 HTTP
 * surface (`/service-operations/packs/catering/activate|deactivate`).
 */
const TENANT_CODE = `wave-ops1-${Date.now()}`;
const ADMIN_EMAIL = "admin@wave-ops1.local";
const ADMIN_PASSWORD = "Admin12345!";
const TODAY = new Date().toISOString().slice(0, 10);

describe.sequential("Wave OPS-01 — Catering pack activation gate (WP-OPS-01)", () => {
  const app = buildApp();

  let token: string;
  let tenantId: string;
  let riceItemId: string;
  let outputItemId: string;
  let siteId: string;

  beforeAll(async () => {
    const primary = await bootstrapTenant(app, TENANT_CODE, "Wave OPS1 Primary");
    tenantId = primary.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = (await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD)).body.accessToken;

    // Units: KG only (mass category).
    const kg = await pool.query(
      `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
       VALUES ($1, 'KG', 'Kilogram', 'KG', 'mass') RETURNING id`,
      [tenantId],
    );
    const kgUnitId = kg.rows[0].id;

    // Items: rice (ingredient, priced) + cooked-rice (recipe output).
    const rice = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure, unit_of_measure_id)
       VALUES ($1, 'RICE-OPS1', 'Rice', 'KG', $2) RETURNING id`,
      [tenantId, kgUnitId],
    );
    riceItemId = rice.rows[0].id;
    const output = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure, unit_of_measure_id)
       VALUES ($1, 'COOKED-OPS1', 'Cooked Rice', 'KG', $2) RETURNING id`,
      [tenantId, kgUnitId],
    );
    outputItemId = output.rows[0].id;

    // Valuation layer for rice: 1 KG @ 12000.
    await pool.query(
      `INSERT INTO scm_valuation_layers
         (tenant_id, item_id, received_date, original_quantity, remaining_quantity,
          unit_cost, effective_unit_cost, total_value)
       VALUES ($1, $2, $3::date, 100, 100, 12000, 12000, 1200000)`,
      [tenantId, riceItemId, TODAY],
    );

    // Site for meal plans.
    const cust = await pool.query(
      `INSERT INTO customers (tenant_id, code, name) VALUES ($1, 'CUST-OPS1', 'OPS1 Customer') RETURNING id`,
      [tenantId],
    );
    const site = await pool.query(
      `INSERT INTO sites (tenant_id, customer_id, code, name) VALUES ($1, $2, 'SITE-OPS1', 'OPS1 Site') RETURNING id`,
      [tenantId, cust.rows[0].id],
    );
    siteId = site.rows[0].id;
  });

  afterAll(async () => {
    // FK-safe teardown (memory: vitest-shares-dev-db — clean up test rows).
    const t = await pool.query(`SELECT id FROM tenants WHERE code = $1`, [TENANT_CODE]);
    if (t.rows[0]) {
      const id = t.rows[0].id;
      await pool.query(`DELETE FROM catering_meal_batches WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM catering_meal_plans WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM catering_recipe_ingredients WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM catering_recipes WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM catering_menus WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM service_pack_activations WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM scm_valuation_layers WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM items WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    }
    await app.close();
  });

  const post = (url: string, payload: Record<string, unknown>, tok: string = token) =>
    app.inject({ method: "POST", url, headers: authHeader(tok), payload });
  const get = (url: string, tok: string = token) =>
    app.inject({ method: "GET", url, headers: authHeader(tok) });
  const put = (url: string, payload: Record<string, unknown>, tok: string = token) =>
    app.inject({ method: "PUT", url, headers: authHeader(tok), payload });

  // =========================================================================
  // Pack inactive → writes blocked, reads open
  // =========================================================================

  it("blocks a catering menu write when pack is inactive (409)", async () => {
    const res = await post("/catering/menus", {
      code: "MENU-OPS1",
      name: "Ops1 Lunch",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/catering pack is not active/i);
  });

  it("keeps catering reads open when pack is inactive (200, empty)", async () => {
    const res = await get("/catering/menus");
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(0);
  });

  // =========================================================================
  // Activate pack → writes allowed across every vertical surface
  // =========================================================================

  it("activates the catering pack", async () => {
    const res = await post("/service-operations/packs/catering/activate", { seedPresets: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().packCode).toBe("catering");
    expect(res.json().isActive).toBe(true);
  });

  it("allows menu write once pack is active", async () => {
    const res = await post("/catering/menus", {
      code: "MENU-OPS1",
      name: "Ops1 Lunch",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe("MENU-OPS1");
  });

  it("allows recipe + ingredient writes once pack is active", async () => {
    const recipe = await post("/catering/recipes", {
      code: "RC-OPS1",
      name: "Ops1 Cooked Rice",
      outputItemId,
      outputQuantity: "2",
      outputUnitCode: "KG",
      effectiveFrom: TODAY,
    });
    expect(recipe.statusCode).toBe(201);

    const ingredients = await put("/catering/recipes/RC-OPS1/ingredients", {
      ingredients: [{ itemId: riceItemId, quantity: "1", unitCode: "KG", sortOrder: 0 }],
    });
    expect(ingredients.statusCode).toBe(200);
    expect(ingredients.json().length).toBe(1);
  });

  it("allows meal plan write once pack is active", async () => {
    const res = await post("/catering/meal-plans", {
      menuCode: "MENU-OPS1",
      siteId,
      mealDate: TODAY,
      mealType: "lunch",
      plannedPortions: 10,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().mealType).toBe("lunch");
  });

  it("allows meal batch write + status advance once pack is active", async () => {
    const batch = await post("/catering/meal-batches", {
      batchNumber: "BATCH-OPS1",
      recipeCode: "RC-OPS1",
    });
    expect(batch.statusCode).toBe(201);
    expect(batch.json().status).toBe("draft");

    const confirmed = await post("/catering/meal-batches/BATCH-OPS1/status", { status: "confirmed" });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("confirmed");
  });

  // =========================================================================
  // Deactivate pack → writes blocked again, reads still open, costing open
  // =========================================================================

  it("deactivates the catering pack", async () => {
    const res = await post("/service-operations/packs/catering/deactivate", {});
    expect(res.statusCode).toBe(200);
    expect(res.json().isActive).toBe(false);
  });

  it("blocks a catering menu write again after deactivation (409)", async () => {
    const res = await post("/catering/menus", {
      code: "MENU-OPS1-AFTER",
      name: "After Deactivate",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/catering pack is not active/i);
  });

  it("keeps reads open after deactivation — previously created menu visible", async () => {
    const res = await get("/catering/menus");
    expect(res.statusCode).toBe(200);
    expect(res.json().some((m: { code: string }) => m.code === "MENU-OPS1")).toBe(true);
  });

  it("keeps recipe costing open after deactivation (read-only report)", async () => {
    const res = await post("/catering/recipes/RC-OPS1/cost", { onDate: TODAY });
    expect(res.statusCode).toBe(200);
    expect(res.json().recipeCode).toBe("RC-OPS1");
  });
});

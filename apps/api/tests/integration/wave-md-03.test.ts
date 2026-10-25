import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, login, provisionExternalCustomerUser, provisionFirstAdmin } from "./helpers.js";

/**
 * Wave MD-03 — Catering vertical master (WP-MD-03, DEC-007 K5/K6).
 *
 * Covers: menu/recipe/ingredient CRUD, meal plan scheduling uniqueness, meal
 * batch lifecycle (draft→confirmed→consumed), recipe costing via UoM
 * conversion + valuation layers, effective-dating window, cross-tenant
 * isolation, FK enforcement (composite tenant+ref keys).
 */
const TENANT_CODE = `wave-md3-main-${Date.now()}`;
const OTHER_TENANT_CODE = `wave-md3-other-${Date.now()}`;
const ADMIN_EMAIL = "admin@wave-md3.local";
const ADMIN_PASSWORD = "Admin12345!";
const TODAY = new Date().toISOString().slice(0, 10);

describe("Wave MD-03 — Catering vertical master (WP-MD-03)", () => {
  const app = buildApp();

  let token: string;
  let otherToken: string;
  let tenantId: string;
  let otherTenantId: string;
  let riceItemId: string;
  let outputItemId: string;
  let kgUnitId: string;
  let gUnitId: string;
  let siteId: string;
  let otherRiceItemId: string;

  beforeAll(async () => {
    const primary = await bootstrapTenant(app, TENANT_CODE, "Wave MD3 Primary");
    tenantId = primary.id;
    await activateAllModules(tenantId);
    await provisionFirstAdmin({ tenantId, email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    token = (await login(app, TENANT_CODE, ADMIN_EMAIL, ADMIN_PASSWORD)).body.accessToken;

    const other = await bootstrapTenant(app, OTHER_TENANT_CODE, "Wave MD3 Other");
    otherTenantId = other.id;
    await activateAllModules(otherTenantId);
    const otherEmail = "other@wave-md3.local";
    await provisionFirstAdmin({ tenantId: otherTenantId, email: otherEmail, password: ADMIN_PASSWORD });
    otherToken = (await login(app, OTHER_TENANT_CODE, otherEmail, ADMIN_PASSWORD)).body.accessToken;

    // WP-OPS-01 — catering writes require the catering Service Pack to be
    // active for the tenant. Both tenants here exercise catering writes, so
    // both activate the pack. Direct-SQL insert mirrors what
    // `/service-operations/packs/catering/activate` does for the activation
    // row (preset seeding is a separate concern tested elsewhere).
    for (const tid of [tenantId, otherTenantId]) {
      await pool.query(
        `INSERT INTO service_pack_activations (tenant_id, pack_code, is_active)
         VALUES ($1, 'catering', true)
         ON CONFLICT (tenant_id, pack_code) DO UPDATE SET is_active = true`,
        [tid],
      );
    }

    // Units: KG and G (mass category, direct conversion KG->G factor 1000).
    const kg = await pool.query(
      `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
       VALUES ($1, 'KG', 'Kilogram', 'KG', 'mass') RETURNING id`,
      [tenantId],
    );
    kgUnitId = kg.rows[0].id;
    const g = await pool.query(
      `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
       VALUES ($1, 'G', 'Gram', 'G', 'mass') RETURNING id`,
      [tenantId],
    );
    gUnitId = g.rows[0].id;
    await pool.query(
      `INSERT INTO unit_conversions (tenant_id, from_unit_id, to_unit_id, factor, effective_from)
       VALUES ($1, $2, $3, '1000', '2020-01-01')`,
      [tenantId, kgUnitId, gUnitId],
    );

    // Items: rice (ingredient, priced via valuation layer) + cooked-rice (output).
    const rice = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure, unit_of_measure_id)
       VALUES ($1, 'RICE-MD3', 'Rice', 'KG', $2) RETURNING id`,
      [tenantId, kgUnitId],
    );
    riceItemId = rice.rows[0].id;
    const output = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure, unit_of_measure_id)
       VALUES ($1, 'COOKED-RICE-MD3', 'Cooked Rice', 'KG', $2) RETURNING id`,
      [tenantId, kgUnitId],
    );
    outputItemId = output.rows[0].id;

    // Valuation layer for rice: 1 KG @ 12000, on TODAY.
    await pool.query(
      `INSERT INTO scm_valuation_layers
         (tenant_id, item_id, received_date, original_quantity, remaining_quantity,
          unit_cost, effective_unit_cost, total_value)
       VALUES ($1, $2, $3::date, 100, 100, 12000, 12000, 1200000)`,
      [tenantId, riceItemId, TODAY],
    );

    // Site for meal plans: needs a customer + optional project.
    const cust = await pool.query(
      `INSERT INTO customers (tenant_id, code, name) VALUES ($1, 'CUST-MD3', 'MD3 Customer') RETURNING id`,
      [tenantId],
    );
    const site = await pool.query(
      `INSERT INTO sites (tenant_id, customer_id, code, name) VALUES ($1, $2, 'SITE-MD3', 'MD3 Site') RETURNING id`,
      [tenantId, cust.rows[0].id],
    );
    siteId = site.rows[0].id;

    // Other-tenant item to prove FK composite isolation.
    const otherRice = await pool.query(
      `INSERT INTO items (tenant_id, code, name, unit_of_measure) VALUES ($1, 'RICE-OTH', 'Rice Other', 'PCS') RETURNING id`,
      [otherTenantId],
    );
    otherRiceItemId = otherRice.rows[0].id;
  });

  afterAll(async () => {
    // Explicit teardown in FK-safe order. A bare `DELETE FROM tenants` fails:
    // items' tenant cascade (1765, oldest) fires before catering_*'s cascade
    // (1794100030), so items deletion hits catering_recipes.output_item_id
    // RESTRICT while catering rows still exist; and scm_valuation_layers holds
    // items RESTRICT too. Drop every RESTRICT holder before the tenant row.
    // (Memory: vitest-shares-dev-db — clean up test rows.)
    for (const code of [TENANT_CODE, OTHER_TENANT_CODE]) {
      const t = await pool.query(`SELECT id FROM tenants WHERE code = $1`, [code]);
      if (!t.rows[0]) continue;
      const id = t.rows[0].id;
      await pool.query(`DELETE FROM catering_meal_batches WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM catering_meal_plans WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM catering_recipe_ingredients WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM catering_recipes WHERE tenant_id = $1`, [id]);
      await pool.query(`DELETE FROM catering_menus WHERE tenant_id = $1`, [id]);
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
  // Menus
  // =========================================================================

  it("creates a catering menu", async () => {
    const res = await post("/catering/menus", {
      code: "MENU-LUNCH",
      name: "Lunch Menu",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe("MENU-LUNCH");
    expect(res.json().isActive).toBe(true);
  });

  it("rejects duplicate menu code with 409", async () => {
    const res = await post("/catering/menus", {
      code: "MENU-LUNCH",
      name: "Dup",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects effectiveTo < effectiveFrom", async () => {
    const res = await post("/catering/menus", {
      code: "MENU-BAD",
      name: "Bad",
      effectiveFrom: "2026-01-10",
      effectiveTo: "2026-01-01",
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists menus, activeOnly filter respected", async () => {
    const all = await get("/catering/menus");
    expect(all.statusCode).toBe(200);
    expect(all.json().some((m: { code: string }) => m.code === "MENU-LUNCH")).toBe(true);
    const active = await get("/catering/menus?activeOnly=true");
    expect(active.statusCode).toBe(200);
    expect(active.json().every((m: { isActive: boolean }) => m.isActive)).toBe(true);
  });

  // =========================================================================
  // Recipes + ingredients
  // =========================================================================

  it("creates a recipe with output item + unit", async () => {
    const res = await post("/catering/recipes", {
      code: "RC-COOKED-RICE",
      name: "Cooked Rice Recipe",
      outputItemId,
      outputQuantity: "2",
      outputUnitCode: "KG",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().code).toBe("RC-COOKED-RICE");
  });

  it("rejects recipe with unknown output item (cross-tenant FK)", async () => {
    const res = await post("/catering/recipes", {
      code: "RC-X",
      name: "X",
      outputItemId: otherRiceItemId,
      outputQuantity: "1",
      outputUnitCode: "KG",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects recipe with unknown unit code", async () => {
    const res = await post("/catering/recipes", {
      code: "RC-BAD-U",
      name: "Bad Unit",
      outputItemId,
      outputQuantity: "1",
      outputUnitCode: "NOPE",
      effectiveFrom: TODAY,
    });
    expect(res.statusCode).toBe(404);
  });

  it("sets recipe ingredients (replace, atomic)", async () => {
    const res = await put("/catering/recipes/RC-COOKED-RICE/ingredients", {
      ingredients: [
        { itemId: riceItemId, quantity: "1", unitCode: "KG", sortOrder: 0 },
      ],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(1);
    expect(res.json()[0].itemId).toBe(riceItemId);
  });

  it("rejects duplicate ingredient item in one recipe", async () => {
    const res = await put("/catering/recipes/RC-COOKED-RICE/ingredients", {
      ingredients: [
        { itemId: riceItemId, quantity: "1", unitCode: "KG" },
        { itemId: riceItemId, quantity: "0.5", unitCode: "KG" },
      ],
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects empty ingredient list", async () => {
    const res = await put("/catering/recipes/RC-COOKED-RICE/ingredients", { ingredients: [] });
    expect(res.statusCode).toBe(400);
  });

  it("lists recipe ingredients", async () => {
    const res = await get("/catering/recipes/RC-COOKED-RICE/ingredients");
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBe(1);
  });

  it("gets a recipe by code", async () => {
    const res = await get("/catering/recipes/RC-COOKED-RICE");
    expect(res.statusCode).toBe(200);
    expect(res.json().code).toBe("RC-COOKED-RICE");
  });

  // =========================================================================
  // Recipe costing (K5)
  // =========================================================================

  it("computes recipe cost from valuation layer + UoM conversion", async () => {
    // Ingredient stored in G, output unit KG: 1000 G = 1 KG.
    // Replace ingredient to 500 G (= 0.5 KG) @ 12000/KG = 6000.
    await put("/catering/recipes/RC-COOKED-RICE/ingredients", {
      ingredients: [{ itemId: riceItemId, quantity: "500", unitCode: "G" }],
    });
    const res = await post("/catering/recipes/RC-COOKED-RICE/cost", { onDate: TODAY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.recipeCode).toBe("RC-COOKED-RICE");
    expect(body.lines.length).toBe(1);
    expect(body.lines[0].lineCost).toBe("6000.000000");
    expect(body.totalCost).toBe("6000.000000");
  });

  it("flags conversionMissing for an ingredient with no conversion path", async () => {
    // Use a unit with no conversion to KG. Create a lone unit "EA" (qty category).
    await pool.query(
      `INSERT INTO units_of_measure (tenant_id, code, name, base_unit_code, category)
       VALUES ($1, 'EA', 'Each', 'EA', 'qty') RETURNING id`,
      [tenantId],
    );
    await put("/catering/recipes/RC-COOKED-RICE/ingredients", {
      ingredients: [{ itemId: riceItemId, quantity: "2", unitCode: "EA" }],
    });
    const res = await post("/catering/recipes/RC-COOKED-RICE/cost", { onDate: TODAY });
    expect(res.statusCode).toBe(200);
    expect(res.json().lines.length).toBe(0); // missing conversion → excluded
    expect(res.json().totalCost).toBe("0.000000"); // sumNumeric empty → numeric(24,6)
    // EA unit + its ingredient row are cleaned by tenant CASCADE in afterAll;
    // deleting the unit here would violate the ingredient's ON DELETE RESTRICT.
  });

  // =========================================================================
  // Meal plans
  // =========================================================================

  it("creates a meal plan for a site/date/meal", async () => {
    const res = await post("/catering/meal-plans", {
      menuCode: "MENU-LUNCH",
      siteId,
      mealDate: TODAY,
      mealType: "lunch",
      plannedPortions: 20,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().mealType).toBe("lunch");
  });

  it("rejects duplicate meal plan slot (same site/date/type)", async () => {
    const res = await post("/catering/meal-plans", {
      menuCode: "MENU-LUNCH",
      siteId,
      mealDate: TODAY,
      mealType: "lunch",
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects meal plan with unknown site (cross-tenant)", async () => {
    const res = await post("/catering/meal-plans", {
      menuCode: "MENU-LUNCH",
      siteId: "00000000-0000-4000-8000-000000000099",
      mealDate: TODAY,
      mealType: "dinner",
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects meal plan with inactive menu", async () => {
    // Make a second menu then deactivate it via SQL (no deactivate route).
    await post("/catering/menus", { code: "MENU-INACTIVE", name: "Inactive", effectiveFrom: TODAY });
    await pool.query(`UPDATE catering_menus SET is_active = false WHERE tenant_id = $1 AND code = 'MENU-INACTIVE'`, [tenantId]);
    const res = await post("/catering/meal-plans", {
      menuCode: "MENU-INACTIVE",
      siteId,
      mealDate: TODAY,
      mealType: "snack",
    });
    expect(res.statusCode).toBe(409);
  });

  it("lists meal plans, optional mealDate filter", async () => {
    const all = await get("/catering/meal-plans");
    expect(all.statusCode).toBe(200);
    expect(all.json().length).toBeGreaterThanOrEqual(1);
    const filtered = await get(`/catering/meal-plans?mealDate=${TODAY}`);
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json().every((p: { mealDate: string }) => p.mealDate === TODAY)).toBe(true);
  });

  // =========================================================================
  // Meal batches
  // =========================================================================

  it("creates a meal batch in draft, defaulting to recipe yield", async () => {
    const res = await post("/catering/meal-batches", {
      batchNumber: "BATCH-001",
      recipeCode: "RC-COOKED-RICE",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("draft");
    expect(res.json().outputQuantity).toBe("2.0000"); // recipe yield, numeric(18,4)
  });

  it("rejects duplicate batch number", async () => {
    const res = await post("/catering/meal-batches", {
      batchNumber: "BATCH-001",
      recipeCode: "RC-COOKED-RICE",
    });
    expect(res.statusCode).toBe(409);
  });

  it("rejects batch with inactive recipe", async () => {
    await post("/catering/recipes", {
      code: "RC-INACTIVE",
      name: "Inactive Recipe",
      outputItemId,
      outputQuantity: "1",
      outputUnitCode: "KG",
      effectiveFrom: TODAY,
    });
    await pool.query(`UPDATE catering_recipes SET is_active = false WHERE tenant_id = $1 AND code = 'RC-INACTIVE'`, [tenantId]);
    const res = await post("/catering/meal-batches", {
      batchNumber: "BATCH-002",
      recipeCode: "RC-INACTIVE",
    });
    expect(res.statusCode).toBe(409);
  });

  it("advances batch draft → confirmed → consumed (forward only)", async () => {
    const confirmed = await post("/catering/meal-batches/BATCH-001/status", { status: "confirmed" });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().status).toBe("confirmed");
    expect(confirmed.json().producedAt).not.toBeNull();

    // Cannot go backwards.
    const back = await post("/catering/meal-batches/BATCH-001/status", { status: "draft" });
    expect(back.statusCode).toBe(409);

    const consumed = await post("/catering/meal-batches/BATCH-001/status", { status: "consumed" });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json().status).toBe("consumed");

    // Already consumed.
    const again = await post("/catering/meal-batches/BATCH-001/status", { status: "consumed" });
    expect(again.statusCode).toBe(409);
  });

  it("lists batches, optional status filter", async () => {
    const all = await get("/catering/meal-batches");
    expect(all.statusCode).toBe(200);
    expect(all.json().some((b: { batchNumber: string }) => b.batchNumber === "BATCH-001")).toBe(true);
    const consumed = await get("/catering/meal-batches?status=consumed");
    expect(consumed.statusCode).toBe(200);
    expect(consumed.json().every((b: { status: string }) => b.status === "consumed")).toBe(true);
  });

  // =========================================================================
  // Customer Data Scope (Epic 4 §4.4 line 3)
  // =========================================================================

  it("hides catering master and other customers' plans from a customer-scoped reader", async () => {
    // A second customer with its own site and meal plan, so a leak would show.
    const otherCust = await pool.query(
      `INSERT INTO customers (tenant_id, code, name) VALUES ($1, 'CUST-MD3-OTHER', 'Other Customer') RETURNING id`,
      [tenantId],
    );
    const otherCustId = otherCust.rows[0].id as string;
    const otherSite = await pool.query(
      `INSERT INTO sites (tenant_id, customer_id, code, name) VALUES ($1, $2, 'SITE-MD3-OTHER', 'Other Site') RETURNING id`,
      [tenantId, otherCustId],
    );
    await post("/catering/meal-plans", {
      menuCode: "MENU-LUNCH",
      siteId: otherSite.rows[0].id,
      mealDate: TODAY,
      mealType: "breakfast",
      plannedPortions: 5,
    });

    const email = `custscope-md3-${Date.now()}@wave-md3.local`;
    const scoped = await provisionExternalCustomerUser({
      tenantId,
      email,
      password: "Passw0rd12345!",
      permissionCodes: ["service_operations.read"],
    });
    const scopedToken = (await login(app, TENANT_CODE, email, "Passw0rd12345!")).body.accessToken;

    // A site of their own, with one plan — so a leak would be visible.
    const ownSite = await pool.query(
      `INSERT INTO sites (tenant_id, customer_id, code, name) VALUES ($1, $2, 'SITE-MD3-SCOPED', 'Scoped Site') RETURNING id`,
      [tenantId, scoped.customerId],
    );
    const ownSiteId = ownSite.rows[0].id as string;
    await post("/catering/meal-plans", {
      menuCode: "MENU-LUNCH",
      siteId: ownSiteId,
      mealDate: TODAY,
      mealType: "snack",
      plannedPortions: 3,
    });

    // Meal plans: only the ones whose site belongs to this customer.
    const plans = await get("/catering/meal-plans", scopedToken);
    expect(plans.statusCode).toBe(200);
    const visible = plans.json() as { siteId: string | null }[];
    expect(visible).toHaveLength(1);
    expect(visible[0].siteId).toBe(ownSiteId);

    // Meal batches: fail closed — a batch with no plan is not theirs.
    const batches = await get("/catering/meal-batches", scopedToken);
    expect(batches.statusCode).toBe(200);
    expect(batches.json()).toEqual([]);

    // Menus / recipes / ingredients / costing are tenant master data: refused.
    expect((await get("/catering/menus", scopedToken)).statusCode).toBe(403);
    expect((await get("/catering/recipes", scopedToken)).statusCode).toBe(403);
    expect((await get("/catering/recipes/RC-COOKED-RICE/ingredients", scopedToken)).statusCode).toBe(403);
    expect((await post("/catering/recipes/RC-COOKED-RICE/cost", {}, scopedToken)).statusCode).toBe(403);
  });

  // =========================================================================
  // Cross-tenant isolation
  // =========================================================================

  it("isolates menus across tenants", async () => {
    const res = await get("/catering/menus", otherToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().some((m: { code: string }) => m.code === "MENU-LUNCH")).toBe(false);
  });

  it("isolates recipes across tenants", async () => {
    const res = await get("/catering/recipes/RC-COOKED-RICE", otherToken);
    expect(res.statusCode).toBe(404);
  });
});

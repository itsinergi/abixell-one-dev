import type { Pool } from "pg";
import type {
  CateringMealBatch,
  CateringMealPlan,
  CateringMenu,
  CateringRecipe,
  CateringRecipeIngredient,
  CateringRepository,
  CreateIngredientInput,
  CreateMealBatchInput,
  CreateMealPlanInput,
  CreateMenuInput,
  CreateRecipeInput,
  MealBatchStatus,
  MealType,
  RecipeCostLine,
} from "../domain/catering.entity.js";

/** PostgreSQL `date` columns arrive as JS Date objects at midnight UTC;
 * format from local date components (see finance-master.repository.pg.ts). */
function toDateString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function toMenu(row: Record<string, unknown>): CateringMenu {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    code: row.code as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    isActive: row.is_active as boolean,
    effectiveFrom: toDateString(row.effective_from),
    effectiveTo: row.effective_to ? toDateString(row.effective_to) : null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toRecipe(row: Record<string, unknown>): CateringRecipe {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    code: row.code as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    outputItemId: row.output_item_id as string,
    outputQuantity: String(row.output_quantity),
    outputUnitId: row.output_unit_id as string,
    isActive: row.is_active as boolean,
    effectiveFrom: toDateString(row.effective_from),
    effectiveTo: row.effective_to ? toDateString(row.effective_to) : null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toIngredient(row: Record<string, unknown>): CateringRecipeIngredient {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    recipeId: row.recipe_id as string,
    itemId: row.item_id as string,
    quantity: String(row.quantity),
    unitId: row.unit_id as string,
    sortOrder: row.sort_order as number,
  };
}

function toMealPlan(row: Record<string, unknown>): CateringMealPlan {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    menuId: row.menu_id as string,
    siteId: (row.site_id as string | null) ?? null,
    mealDate: toDateString(row.meal_date),
    mealType: row.meal_type as MealType,
    plannedPortions: row.planned_portions as number,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toMealBatch(row: Record<string, unknown>): CateringMealBatch {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    batchNumber: row.batch_number as string,
    mealPlanId: (row.meal_plan_id as string | null) ?? null,
    recipeId: row.recipe_id as string,
    outputItemId: row.output_item_id as string,
    outputQuantity: String(row.output_quantity),
    outputUnitId: row.output_unit_id as string,
    outputValuationLayerId: (row.output_valuation_layer_id as string | null) ?? null,
    status: row.status as MealBatchStatus,
    producedAt: (row.produced_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export class PgCateringRepository implements CateringRepository {
  constructor(private readonly pool: Pool) {}

  async itemExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM items WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async siteExists(tenantId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      `SELECT 1 FROM sites WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return (r.rowCount ?? 0) > 0;
  }

  // --- Menus ------------------------------------------------------------

  async createMenu(input: CreateMenuInput): Promise<CateringMenu> {
    const r = await this.pool.query(
      `INSERT INTO catering_menus
         (tenant_id, code, name, description, effective_from, effective_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $7)
       RETURNING *`,
      [input.tenantId, input.code, input.name, input.description, input.effectiveFrom, input.effectiveTo, input.createdBy],
    );
    return toMenu(r.rows[0]);
  }

  async findMenuByCode(tenantId: string, code: string): Promise<CateringMenu | null> {
    const r = await this.pool.query(
      `SELECT * FROM catering_menus WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return r.rows[0] ? toMenu(r.rows[0]) : null;
  }

  async listMenus(tenantId: string, activeOnly: boolean): Promise<CateringMenu[]> {
    const r = await this.pool.query(
      `SELECT * FROM catering_menus WHERE tenant_id = $1 ${activeOnly ? "AND is_active" : ""} ORDER BY code`,
      [tenantId],
    );
    return r.rows.map(toMenu);
  }

  // --- Recipes ----------------------------------------------------------

  async createRecipe(input: CreateRecipeInput): Promise<CateringRecipe> {
    const r = await this.pool.query(
      `INSERT INTO catering_recipes
         (tenant_id, code, name, description, output_item_id, output_quantity,
          output_unit_id, effective_from, effective_to, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $10)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.description,
        input.outputItemId,
        input.outputQuantity,
        input.outputUnitId,
        input.effectiveFrom,
        input.effectiveTo,
        input.createdBy,
      ],
    );
    return toRecipe(r.rows[0]);
  }

  async findRecipeByCode(tenantId: string, code: string): Promise<CateringRecipe | null> {
    const r = await this.pool.query(
      `SELECT * FROM catering_recipes WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    return r.rows[0] ? toRecipe(r.rows[0]) : null;
  }

  async listRecipes(tenantId: string, activeOnly: boolean): Promise<CateringRecipe[]> {
    const r = await this.pool.query(
      `SELECT * FROM catering_recipes WHERE tenant_id = $1 ${activeOnly ? "AND is_active" : ""} ORDER BY code`,
      [tenantId],
    );
    return r.rows.map(toRecipe);
  }

  // --- Ingredients ------------------------------------------------------

  async replaceIngredients(
    recipeId: string,
    ingredients: Omit<CreateIngredientInput, "recipeId">[],
  ): Promise<CateringRecipeIngredient[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM catering_recipe_ingredients WHERE recipe_id = $1`, [recipeId]);
      const out: CateringRecipeIngredient[] = [];
      for (const [i, ing] of ingredients.entries()) {
        const r = await client.query(
          `INSERT INTO catering_recipe_ingredients
             (tenant_id, recipe_id, item_id, quantity, unit_id, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [ing.tenantId, recipeId, ing.itemId, ing.quantity, ing.unitId, ing.sortOrder ?? i],
        );
        out.push(toIngredient(r.rows[0]));
      }
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async listIngredients(tenantId: string, recipeId: string): Promise<CateringRecipeIngredient[]> {
    const r = await this.pool.query(
      `SELECT * FROM catering_recipe_ingredients WHERE tenant_id = $1 AND recipe_id = $2 ORDER BY sort_order, item_id`,
      [tenantId, recipeId],
    );
    return r.rows.map(toIngredient);
  }

  // --- Meal plans ---------------------------------------------------------

  async createMealPlan(input: CreateMealPlanInput): Promise<CateringMealPlan> {
    const r = await this.pool.query(
      `INSERT INTO catering_meal_plans
         (tenant_id, menu_id, site_id, meal_date, meal_type, planned_portions, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $8)
       RETURNING *`,
      [input.tenantId, input.menuId, input.siteId, input.mealDate, input.mealType, input.plannedPortions, input.notes, input.createdBy],
    );
    return toMealPlan(r.rows[0]);
  }

  async findMealPlanSlot(
    tenantId: string,
    siteId: string | null,
    mealDate: string,
    mealType: MealType,
  ): Promise<CateringMealPlan | null> {
    const r = await this.pool.query(
      `SELECT * FROM catering_meal_plans
        WHERE tenant_id = $1 AND meal_date = $2::date AND meal_type = $3
          AND site_id IS NOT DISTINCT FROM $4`,
      [tenantId, mealDate, mealType, siteId],
    );
    return r.rows[0] ? toMealPlan(r.rows[0]) : null;
  }

  async listMealPlans(tenantId: string, mealDate?: string): Promise<CateringMealPlan[]> {
    const r = mealDate
      ? await this.pool.query(
          `SELECT * FROM catering_meal_plans WHERE tenant_id = $1 AND meal_date = $2::date ORDER BY meal_type`,
          [tenantId, mealDate],
        )
      : await this.pool.query(
          `SELECT * FROM catering_meal_plans WHERE tenant_id = $1 ORDER BY meal_date DESC, meal_type`,
          [tenantId],
        );
    return r.rows.map(toMealPlan);
  }

  async findMealPlanById(tenantId: string, id: string): Promise<CateringMealPlan | null> {
    const r = await this.pool.query(
      `SELECT * FROM catering_meal_plans WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return r.rows[0] ? toMealPlan(r.rows[0]) : null;
  }

  // --- Meal batches -------------------------------------------------------

  async createMealBatch(input: CreateMealBatchInput): Promise<CateringMealBatch> {
    const r = await this.pool.query(
      `INSERT INTO catering_meal_batches
         (tenant_id, batch_number, meal_plan_id, recipe_id, output_item_id,
          output_quantity, output_unit_id, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING *`,
      [
        input.tenantId,
        input.batchNumber,
        input.mealPlanId,
        input.recipeId,
        input.outputItemId,
        input.outputQuantity,
        input.outputUnitId,
        input.createdBy,
      ],
    );
    return toMealBatch(r.rows[0]);
  }

  async findMealBatchByNumber(tenantId: string, batchNumber: string): Promise<CateringMealBatch | null> {
    const r = await this.pool.query(
      `SELECT * FROM catering_meal_batches WHERE tenant_id = $1 AND batch_number = $2`,
      [tenantId, batchNumber],
    );
    return r.rows[0] ? toMealBatch(r.rows[0]) : null;
  }

  async findMealBatchById(tenantId: string, id: string): Promise<CateringMealBatch | null> {
    const r = await this.pool.query(
      `SELECT * FROM catering_meal_batches WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return r.rows[0] ? toMealBatch(r.rows[0]) : null;
  }

  async listMealBatches(tenantId: string, status?: MealBatchStatus): Promise<CateringMealBatch[]> {
    const r = status
      ? await this.pool.query(
          `SELECT * FROM catering_meal_batches WHERE tenant_id = $1 AND status = $2 ORDER BY created_at DESC`,
          [tenantId, status],
        )
      : await this.pool.query(
          `SELECT * FROM catering_meal_batches WHERE tenant_id = $1 ORDER BY created_at DESC`,
          [tenantId],
        );
    return r.rows.map(toMealBatch);
  }

  async setMealBatchStatus(id: string, status: MealBatchStatus): Promise<CateringMealBatch | null> {
    const r = await this.pool.query(
      `UPDATE catering_meal_batches
          SET status = $2,
              produced_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE produced_at END,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return r.rows[0] ? toMealBatch(r.rows[0]) : null;
  }

  // --- K5 simple costing ---------------------------------------------------
  // All decimal arithmetic stays in PostgreSQL. Per ingredient: resolve a
  // conversion path from the ingredient unit to the recipe's output unit
  // (direct row, else inverse), multiply, then multiply by the item's latest
  // valuation-layer effective unit cost. No conversion path → conversionMissing.

  async computeRecipeCost(
    tenantId: string,
    recipeId: string,
    onDate: string,
  ): Promise<(RecipeCostLine & { conversionMissing: boolean })[]> {
    // All decimal arithmetic in PostgreSQL. A valuation layer's
    // `effective_unit_cost` is quoted per the ITEM's stock unit
    // (`items.unit_of_measure_id`), so each ingredient quantity is converted
    // into that unit — not the recipe's output unit — before multiplying.
    // Converting to the output unit would be dimensionally wrong whenever an
    // item is stocked in a different unit than the recipe yields. Conversions
    // honour effective_from/effective_to against onDate (WP-MD-02 dating).
    // items is joined through the composite key (tenant_id, id) so a
    // cross-tenant item id cannot leak its name into the result.
    const r = await this.pool.query(
      `WITH ing AS (
         SELECT i.item_id, i.quantity, i.unit_id, it.name AS item_name,
                it.unit_of_measure_id AS item_unit_id
           FROM catering_recipe_ingredients i
           JOIN items it ON it.tenant_id = i.tenant_id AND it.id = i.item_id
          WHERE i.tenant_id = $1 AND i.recipe_id = $2
       ),
       converted AS (
         SELECT ing.item_id, ing.item_name,
                CASE
                  WHEN ing.item_unit_id IS NOT NULL AND ing.unit_id = ing.item_unit_id THEN ing.quantity
                  WHEN c_direct.id IS NOT NULL THEN (ing.quantity * c_direct.factor)::numeric(24,6)
                  WHEN c_inv.id IS NOT NULL THEN (ing.quantity / c_inv.factor)::numeric(24,6)
                END AS qty_out,
                (
                  ing.item_unit_id IS NULL
                  OR (ing.unit_id <> ing.item_unit_id AND c_direct.id IS NULL AND c_inv.id IS NULL)
                ) AS conversion_missing
           FROM ing
           LEFT JOIN unit_conversions c_direct
             ON c_direct.tenant_id = $1
            AND c_direct.from_unit_id = ing.unit_id
            AND c_direct.to_unit_id = ing.item_unit_id
            AND c_direct.effective_from <= $3::date
            AND (c_direct.effective_to IS NULL OR c_direct.effective_to >= $3::date)
           LEFT JOIN unit_conversions c_inv
             ON c_inv.tenant_id = $1
            AND c_inv.from_unit_id = ing.item_unit_id
            AND c_inv.to_unit_id = ing.unit_id
            AND c_inv.effective_from <= $3::date
            AND (c_inv.effective_to IS NULL OR c_inv.effective_to >= $3::date)
       ),
       cost AS (
         SELECT item_id, effective_unit_cost,
                ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY received_date DESC, created_at DESC) AS rn
           FROM scm_valuation_layers
          WHERE tenant_id = $1
       )
       SELECT c.item_id, c.item_name, c.qty_out AS quantity,
              COALESCE(v.effective_unit_cost, 0) AS unit_cost,
              (COALESCE(v.effective_unit_cost, 0) * COALESCE(c.qty_out, 0))::numeric(24,6) AS line_cost,
              c.conversion_missing
         FROM converted c
         LEFT JOIN cost v ON v.item_id = c.item_id AND v.rn = 1
        ORDER BY c.item_name`,
      [tenantId, recipeId, onDate],
    );
    return r.rows.map((row: Record<string, unknown>) => ({
      itemId: row.item_id as string,
      itemName: row.item_name as string,
      quantity: String(row.quantity ?? "0"),
      unitCost: String(row.unit_cost),
      lineCost: String(row.line_cost),
      conversionMissing: row.conversion_missing === true,
    }));
  }

  async sumNumeric(values: string[]): Promise<string> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(value::numeric), 0)::numeric(24,6)::text AS total
         FROM unnest($1::text[]) AS input(value)`,
      [values],
    );
    return String(r.rows[0].total);
  }
}

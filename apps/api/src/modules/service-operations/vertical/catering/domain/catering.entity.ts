/**
 * Catering vertical master (WP-MD-03, DEC-007 K5/K6).
 *
 * Master data for the catering vertical: menus, recipes, ingredients,
 * meal plans and production batches. K5 scope is structure + simple
 * costing — nutrition is deferred. Ingredient quantities are stored in a
 * UoM Central unit (WP-MD-02); costing converts them to the output item's
 * unit through the conversion engine, never a JS float.
 *
 * Service Operations Core stays generic: nothing here changes the
 * work-order spine; meal batches reference recipes, and a Work Order is
 * only linked when a batch is produced for one (nullable column).
 */

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type MealBatchStatus = "draft" | "confirmed" | "consumed";

export interface CateringMenu {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CateringRecipe {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  outputItemId: string;
  outputQuantity: string;
  outputUnitId: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CateringRecipeIngredient {
  id: string;
  tenantId: string;
  recipeId: string;
  itemId: string;
  quantity: string;
  unitId: string;
  sortOrder: number;
}

export interface CateringMealPlan {
  id: string;
  tenantId: string;
  menuId: string;
  siteId: string | null;
  mealDate: string;
  mealType: MealType;
  plannedPortions: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CateringMealBatch {
  id: string;
  tenantId: string;
  batchNumber: string;
  mealPlanId: string | null;
  recipeId: string;
  outputItemId: string;
  outputQuantity: string;
  outputUnitId: string;
  /** Nullable FIFO output layer — stamped when a confirmed batch produces a
   * valuation layer. Null in draft; K5 structure only, no GL posting here. */
  outputValuationLayerId: string | null;
  status: MealBatchStatus;
  producedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One ingredient line of a simple costing result (K5). Quantity is the
 * ingredient quantity converted into the item's own unit; unitCost comes
 * from the latest `scm_valuation_layers` effective_unit_cost. */
export interface RecipeCostLine {
  itemId: string;
  itemName: string;
  quantity: string;
  unitCost: string;
  lineCost: string;
}

export interface RecipeCostResult {
  recipeCode: string;
  outputQuantity: string;
  lines: RecipeCostLine[];
  totalCost: string;
}

// ---------------------------------------------------------------------------
// Consumed port — minimal surface the catering service reads from UoM Central.
// Defined locally so the module boundary stays clean (the composition root wires
// `PgUomRepository`, which structurally satisfies this via TypeScript duck typing).
// ---------------------------------------------------------------------------

/** Minimal read-only UoM port consumed by the catering vertical (K6). */
export interface UomPort {
  findUnitByCode(tenantId: string, code: string): Promise<{ id: string; code: string } | null>;
}

/** Pack activation read consumed by the catering vertical (WP-OPS-01). The
 * composition root wires `PgServiceOperationsAdvancedRepository`, which
 * structurally satisfies this. `packCode` is narrowed to `"catering"`: this
 * vertical may only ever ask about its own pack. */
export interface PackActivationPort {
  getPackActivation(
    tenantId: string,
    packCode: "catering",
  ): Promise<{ isActive: boolean } | null>;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateMenuInput {
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
}

export interface CreateRecipeInput {
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  outputItemId: string;
  outputQuantity: string;
  outputUnitId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string | null;
}

export interface CreateIngredientInput {
  tenantId: string;
  recipeId: string;
  itemId: string;
  quantity: string;
  unitId: string;
  sortOrder: number;
}

export interface CreateMealPlanInput {
  tenantId: string;
  menuId: string;
  siteId: string | null;
  mealDate: string;
  mealType: MealType;
  plannedPortions: number;
  notes: string | null;
  createdBy: string | null;
}

export interface CreateMealBatchInput {
  tenantId: string;
  batchNumber: string;
  mealPlanId: string | null;
  recipeId: string;
  outputItemId: string;
  outputQuantity: string;
  outputUnitId: string;
  createdBy: string | null;
}

// ---------------------------------------------------------------------------
// Repository port
// ---------------------------------------------------------------------------

export interface CateringRepository {
  itemExists(tenantId: string, id: string): Promise<boolean>;
  siteExists(tenantId: string, id: string): Promise<boolean>;

  createMenu(input: CreateMenuInput): Promise<CateringMenu>;
  findMenuByCode(tenantId: string, code: string): Promise<CateringMenu | null>;
  listMenus(tenantId: string, activeOnly: boolean): Promise<CateringMenu[]>;

  createRecipe(input: CreateRecipeInput): Promise<CateringRecipe>;
  findRecipeByCode(tenantId: string, code: string): Promise<CateringRecipe | null>;
  listRecipes(tenantId: string, activeOnly: boolean): Promise<CateringRecipe[]>;

  replaceIngredients(recipeId: string, ingredients: Omit<CreateIngredientInput, "recipeId">[]): Promise<CateringRecipeIngredient[]>;
  listIngredients(tenantId: string, recipeId: string): Promise<CateringRecipeIngredient[]>;

  createMealPlan(input: CreateMealPlanInput): Promise<CateringMealPlan>;
  findMealPlanSlot(
    tenantId: string,
    siteId: string | null,
    mealDate: string,
    mealType: MealType,
  ): Promise<CateringMealPlan | null>;
  listMealPlans(
    tenantId: string,
    mealDate?: string,
    customerIds?: string[],
  ): Promise<CateringMealPlan[]>;
  findMealPlanById(tenantId: string, id: string): Promise<CateringMealPlan | null>;

  createMealBatch(input: CreateMealBatchInput): Promise<CateringMealBatch>;
  findMealBatchByNumber(tenantId: string, batchNumber: string): Promise<CateringMealBatch | null>;
  findMealBatchById(tenantId: string, id: string): Promise<CateringMealBatch | null>;
  listMealBatches(
    tenantId: string,
    status?: MealBatchStatus,
    customerIds?: string[],
  ): Promise<CateringMealBatch[]>;
  setMealBatchStatus(id: string, status: MealBatchStatus): Promise<CateringMealBatch | null>;

  /** K5 simple costing, all arithmetic in PostgreSQL: per ingredient of
   * `recipeId`, convert its quantity into the item's own stock unit
   * (`items.unit_of_measure_id` — the unit a valuation layer's cost is
   * quoted per; direct or inverse `unit_conversions` row on `onDate`) and
   * multiply by the item's latest valuation-layer unit cost. Ingredients
   * whose unit has no conversion path to the item unit are reported with
   * `conversionMissing: true` and excluded from the total. */
  computeRecipeCost(
    tenantId: string,
    recipeId: string,
    onDate: string,
  ): Promise<(RecipeCostLine & { conversionMissing: boolean })[]>;

  /** Exact-decimal sum in PostgreSQL, so a recipe total never passes through
   * a JS float. */
  sumNumeric(values: string[]): Promise<string>;
}

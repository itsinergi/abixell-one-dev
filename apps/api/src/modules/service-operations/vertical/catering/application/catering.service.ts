import type { ActorContext } from "../../../../../domain/shared-kernel/audit-context.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../../application/rbac/rbac.service.js";
import type {
  CateringMealBatch,
  CateringMealPlan,
  CateringMenu,
  CateringRecipe,
  CateringRecipeIngredient,
  CateringRepository,
  MealBatchStatus,
  MealType,
  RecipeCostResult,
  UomPort,
} from "../domain/catering.entity.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,6})?$/;
const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Catering vertical master (WP-MD-03).
 *
 * Menus, recipes, ingredients, meal plans and production batches, plus K5
 * simple recipe costing. Structure only — nutrition is deferred.
 *
 * Boundaries:
 * - **UoM Central owns conversion** (K6). Every ingredient quantity is
 *   validated against a real unit row through `UomService`, and costing
 *   resolves ingredient → output unit via the conversion engine, not a
 *   local factor table.
 * - **Costing reads valuation layers**, never the item master: `items` has
 *   no cost column, so the effective unit cost comes from the latest
 *   `scm_valuation_layers` row. No GL posting happens here.
 * - **Service Operations Core stays generic.** This service references
 *   work orders only by id when a batch is produced for one.
 * - Permission surface reuses the existing Service Operations family
 *   (`service_operations.read/configure/manage`) rather than widening the
 *   permission allowlist for a vertical.
 */
export class CateringService {
  constructor(
    private readonly repo: CateringRepository,
    private readonly uom: UomPort,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // ===================================================================
  // Menus
  // ===================================================================

  async createMenu(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      description?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<CateringMenu> {
    await this.rbac.requirePermission(actor, "service_operations.configure");
    this.validateWindow(input.effectiveFrom, input.effectiveTo);

    if (await this.repo.findMenuByCode(actor.tenantId, input.code)) {
      throw new ConflictError("Menu code already exists: " + input.code);
    }

    const menu = await this.repo.createMenu({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "catering.menu.created",
      entityType: "catering_menu",
      entityId: menu.id,
      metadata: { code: menu.code },
    });
    return menu;
  }

  async listMenus(actor: ActorContext, activeOnly = false): Promise<CateringMenu[]> {
    await this.rbac.requirePermission(actor, "service_operations.read");
    return this.repo.listMenus(actor.tenantId, activeOnly);
  }

  // ===================================================================
  // Recipes + ingredients
  // ===================================================================

  async createRecipe(
    actor: ActorContext,
    input: {
      code: string;
      name: string;
      description?: string | null;
      outputItemId: string;
      outputQuantity: string;
      outputUnitCode: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<CateringRecipe> {
    await this.rbac.requirePermission(actor, "service_operations.configure");
    this.validateWindow(input.effectiveFrom, input.effectiveTo);
    if (!DECIMAL_PATTERN.test(input.outputQuantity) || !(Number(input.outputQuantity) > 0)) {
      throw new ValidationError("outputQuantity must be a positive number with up to 6 decimals");
    }
    if (await this.repo.findRecipeByCode(actor.tenantId, input.code)) {
      throw new ConflictError("Recipe code already exists: " + input.code);
    }
    await this.assertItemExists(actor.tenantId, input.outputItemId);
    // UoM Central is the only source of truth for a unit (K6).
    const outputUnit = await this.resolveUnitOrThrow(actor.tenantId, input.outputUnitCode);

    const recipe = await this.repo.createRecipe({
      tenantId: actor.tenantId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      outputItemId: input.outputItemId,
      outputQuantity: input.outputQuantity,
      outputUnitId: outputUnit.id,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "catering.recipe.created",
      entityType: "catering_recipe",
      entityId: recipe.id,
      metadata: { code: recipe.code, outputUnit: outputUnit.code },
    });
    return recipe;
  }

  async listRecipes(actor: ActorContext, activeOnly = false): Promise<CateringRecipe[]> {
    await this.rbac.requirePermission(actor, "service_operations.read");
    return this.repo.listRecipes(actor.tenantId, activeOnly);
  }

  async getRecipeByCode(actor: ActorContext, code: string): Promise<CateringRecipe> {
    await this.rbac.requirePermission(actor, "service_operations.read");
    return this.getRecipeOrThrow(actor.tenantId, code);
  }

  /** Replaces the whole ingredient list of a recipe (atomic, in the
   * repository). Every unit is resolved through UoM Central, so a typo is a
   * 404 rather than an unregistered unit id stored in the recipe. */
  async setRecipeIngredients(
    actor: ActorContext,
    recipeCode: string,
    ingredients: { itemId: string; quantity: string; unitCode: string; sortOrder?: number }[],
  ): Promise<CateringRecipeIngredient[]> {
    await this.rbac.requirePermission(actor, "service_operations.configure");
    const recipe = await this.getRecipeOrThrow(actor.tenantId, recipeCode);
    if (ingredients.length === 0) {
      throw new ValidationError("A recipe must have at least one ingredient");
    }
    const seen = new Set<string>();
    const resolved: { tenantId: string; itemId: string; quantity: string; unitId: string; sortOrder: number }[] = [];
    for (const [index, line] of ingredients.entries()) {
      if (!DECIMAL_PATTERN.test(line.quantity) || !(Number(line.quantity) > 0)) {
        throw new ValidationError(`quantity must be positive with up to 6 decimals: ${line.quantity}`);
      }
      if (seen.has(line.itemId)) {
        throw new ConflictError("Duplicate ingredient item in the same recipe: " + line.itemId);
      }
      seen.add(line.itemId);
      await this.assertItemExists(actor.tenantId, line.itemId);
      const unit = await this.resolveUnitOrThrow(actor.tenantId, line.unitCode);
      resolved.push({
        tenantId: actor.tenantId,
        itemId: line.itemId,
        quantity: line.quantity,
        unitId: unit.id,
        sortOrder: line.sortOrder ?? index,
      });
    }

    const saved = await this.repo.replaceIngredients(recipe.id, resolved);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "catering.recipe.ingredients_replaced",
      entityType: "catering_recipe",
      entityId: recipe.id,
      metadata: { code: recipe.code, ingredientCount: saved.length },
    });
    return saved;
  }

  async listRecipeIngredients(actor: ActorContext, recipeCode: string): Promise<CateringRecipeIngredient[]> {
    await this.rbac.requirePermission(actor, "service_operations.read");
    const recipe = await this.getRecipeOrThrow(actor.tenantId, recipeCode);
    return this.repo.listIngredients(actor.tenantId, recipe.id);
  }

  /** K5 simple costing: sum of ingredient cost. Each ingredient quantity is
   * converted into the item's own stock unit (`items.unit_of_measure_id`,
   * the unit a valuation layer's cost is quoted per) before multiplying.
   * Ingredients with no conversion path are reported, not silently dropped —
   * the caller sees `conversionMissing`. */
  async computeRecipeCost(
    actor: ActorContext,
    recipeCode: string,
    onDate?: string,
  ): Promise<RecipeCostResult> {
    await this.rbac.requirePermission(actor, "service_operations.read");
    const recipe = await this.getRecipeOrThrow(actor.tenantId, recipeCode);
    if (onDate && !DATE_PATTERN.test(onDate)) {
      throw new ValidationError("onDate must be YYYY-MM-DD");
    }
    const date = onDate ?? this.today();
    const rows = await this.repo.computeRecipeCost(actor.tenantId, recipe.id, date);

    const lines = rows
      .filter((row) => !row.conversionMissing)
      .map(({ itemId, itemName, quantity, unitCost, lineCost }) => ({
        itemId,
        itemName,
        quantity,
        unitCost,
        lineCost,
      }));
    const total = await this.sumDecimal(lines.map((line) => line.lineCost));

    return {
      recipeCode: recipe.code,
      outputQuantity: recipe.outputQuantity,
      lines,
      totalCost: total,
    };
  }

  // ===================================================================
  // Meal plans
  // ===================================================================

  async createMealPlan(
    actor: ActorContext,
    input: {
      menuCode: string;
      siteId?: string | null;
      mealDate: string;
      mealType: MealType;
      plannedPortions?: number;
      notes?: string | null;
    },
  ): Promise<CateringMealPlan> {
    await this.rbac.requirePermission(actor, "service_operations.manage");
    if (!DATE_PATTERN.test(input.mealDate)) {
      throw new ValidationError("mealDate must be YYYY-MM-DD");
    }
    if (!MEAL_TYPES.includes(input.mealType)) {
      throw new ValidationError("Unknown meal type: " + input.mealType);
    }
    const portions = input.plannedPortions ?? 1;
    if (!Number.isInteger(portions) || portions <= 0) {
      throw new ValidationError("plannedPortions must be a positive integer");
    }
    const menu = await this.repo.findMenuByCode(actor.tenantId, input.menuCode);
    if (!menu) throw new NotFoundError("CateringMenu", input.menuCode);
    if (!menu.isActive) throw new ConflictError("Menu is inactive: " + input.menuCode);

    const siteId = input.siteId ?? null;
    if (siteId && !(await this.repo.siteExists(actor.tenantId, siteId))) {
      throw new NotFoundError("Site", siteId);
    }
    if (await this.repo.findMealPlanSlot(actor.tenantId, siteId, input.mealDate, input.mealType)) {
      throw new ConflictError(
        `A meal plan already exists for ${input.mealDate} ${input.mealType} at this site`,
      );
    }

    const plan = await this.repo.createMealPlan({
      tenantId: actor.tenantId,
      menuId: menu.id,
      siteId,
      mealDate: input.mealDate,
      mealType: input.mealType,
      plannedPortions: portions,
      notes: input.notes ?? null,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "catering.meal_plan.created",
      entityType: "catering_meal_plan",
      entityId: plan.id,
      metadata: { menuCode: menu.code, mealDate: plan.mealDate, mealType: plan.mealType },
    });
    return plan;
  }

  async listMealPlans(actor: ActorContext, mealDate?: string): Promise<CateringMealPlan[]> {
    await this.rbac.requirePermission(actor, "service_operations.read");
    return this.repo.listMealPlans(actor.tenantId, mealDate);
  }

  // ===================================================================
  // Meal batches
  // ===================================================================

  /** Production batch. Output quantity/unit default to the recipe's own
   * yield when the caller does not scale the batch. */
  async createMealBatch(
    actor: ActorContext,
    input: {
      batchNumber: string;
      recipeCode: string;
      mealPlanId?: string | null;
      outputQuantity?: string;
    },
  ): Promise<CateringMealBatch> {
    await this.rbac.requirePermission(actor, "service_operations.manage");
    if (await this.repo.findMealBatchByNumber(actor.tenantId, input.batchNumber)) {
      throw new ConflictError("Batch number already exists: " + input.batchNumber);
    }
    const recipe = await this.getRecipeOrThrow(actor.tenantId, input.recipeCode);
    if (!recipe.isActive) throw new ConflictError("Recipe is inactive: " + recipe.code);
    if (input.mealPlanId) {
      const plan = await this.repo.findMealPlanById(actor.tenantId, input.mealPlanId);
      if (!plan) throw new NotFoundError("CateringMealPlan", input.mealPlanId);
    }

    const quantity = input.outputQuantity ?? recipe.outputQuantity;
    if (!DECIMAL_PATTERN.test(quantity) || !(Number(quantity) > 0)) {
      throw new ValidationError("outputQuantity must be a positive number with up to 6 decimals");
    }

    const batch = await this.repo.createMealBatch({
      tenantId: actor.tenantId,
      batchNumber: input.batchNumber,
      mealPlanId: input.mealPlanId ?? null,
      recipeId: recipe.id,
      outputItemId: recipe.outputItemId,
      outputQuantity: quantity,
      outputUnitId: recipe.outputUnitId,
      createdBy: actor.userId,
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "catering.meal_batch.created",
      entityType: "catering_meal_batch",
      entityId: batch.id,
      metadata: { batchNumber: batch.batchNumber, recipeCode: recipe.code },
    });
    return batch;
  }

  async listMealBatches(actor: ActorContext, status?: MealBatchStatus): Promise<CateringMealBatch[]> {
    await this.rbac.requirePermission(actor, "service_operations.read");
    return this.repo.listMealBatches(actor.tenantId, status);
  }

  /** draft → confirmed → consumed, forward only. Confirmation is the
   * production fact (it stamps `produced_at`); consumption is recorded
   * elsewhere and only marks the batch closed here. */
  async setMealBatchStatus(
    actor: ActorContext,
    batchNumber: string,
    status: MealBatchStatus,
  ): Promise<CateringMealBatch> {
    await this.rbac.requirePermission(actor, "service_operations.manage");
    const batch = await this.repo.findMealBatchByNumber(actor.tenantId, batchNumber);
    if (!batch) throw new NotFoundError("CateringMealBatch", batchNumber);
    const order: MealBatchStatus[] = ["draft", "confirmed", "consumed"];
    if (order.indexOf(status) <= order.indexOf(batch.status)) {
      throw new ConflictError(`Batch ${batchNumber} is already ${batch.status}`);
    }
    const updated = await this.repo.setMealBatchStatus(batch.id, status);
    if (!updated) throw new NotFoundError("CateringMealBatch", batchNumber);
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "catering.meal_batch.status_changed",
      entityType: "catering_meal_batch",
      entityId: batch.id,
      metadata: { batchNumber: batch.batchNumber, from: batch.status, to: status },
    });
    return updated;
  }

  // ===================================================================
  // Helpers
  // ===================================================================

  private async getRecipeOrThrow(tenantId: string, code: string): Promise<CateringRecipe> {
    const recipe = await this.repo.findRecipeByCode(tenantId, code);
    if (!recipe) throw new NotFoundError("CateringRecipe", code);
    return recipe;
  }

  /** Resolve a unit code through the UoM repository port directly — not the
   * UomService application surface — so a catering configurator needs only
   * service_operations.configure, not supply_chain.read. The conversion
   * engine itself stays UoM Central; this is a trusted read of the master. */
  private async resolveUnitOrThrow(tenantId: string, code: string) {
    const unit = await this.uom.findUnitByCode(tenantId, code.toUpperCase().trim());
    if (!unit) throw new NotFoundError("UnitOfMeasure", code);
    return unit;
  }

  private async assertItemExists(tenantId: string, itemId: string): Promise<void> {
    if (!(await this.repo.itemExists(tenantId, itemId))) {
      throw new NotFoundError("Item", itemId);
    }
  }

  private validateWindow(from: string, to: string | null | undefined): void {
    if (!DATE_PATTERN.test(from)) {
      throw new ValidationError(`effectiveFrom must be YYYY-MM-DD, got: ${from}`);
    }
    if (to) {
      if (!DATE_PATTERN.test(to)) {
        throw new ValidationError(`effectiveTo must be YYYY-MM-DD, got: ${to}`);
      }
      if (to < from) throw new ValidationError("effectiveTo must be >= effectiveFrom");
    }
  }

  /** Local date components — never `toISOString()`, which shifts a day in
   * negative-offset sessions. */
  private today(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /** Decimal sum delegated to the repository's PostgreSQL arithmetic — a
   * JS float never touches the total. Empty input still passes through so the
   * total keeps the same numeric(24,6) scale (`COALESCE(SUM,0)::numeric`). */
  private async sumDecimal(values: string[]): Promise<string> {
    return this.repo.sumNumeric(values);
  }
}

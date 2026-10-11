import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../../composition-root.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const decimalSchema = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive number, up to 6 decimals");

const menuSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
});

const recipeSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  outputItemId: z.string().uuid(),
  outputQuantity: decimalSchema,
  outputUnitCode: z.string().min(1),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
});

const ingredientsSchema = z.object({
  ingredients: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: decimalSchema,
        unitCode: z.string().min(1),
        sortOrder: z.number().int().optional(),
      }),
    )
    .min(1),
});

const mealPlanSchema = z.object({
  menuCode: z.string().min(1),
  siteId: z.string().uuid().nullable().optional(),
  mealDate: dateSchema,
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  plannedPortions: z.number().int().positive().optional(),
  notes: z.string().nullable().optional(),
});

const mealBatchSchema = z.object({
  batchNumber: z.string().min(1),
  recipeCode: z.string().min(1),
  mealPlanId: z.string().uuid().nullable().optional(),
  outputQuantity: decimalSchema.optional(),
});

const batchStatusSchema = z.object({
  status: z.enum(["draft", "confirmed", "consumed"]),
});

/** WP-MD-03 — Catering vertical master surface. Route namespace is the
 * vertical's own; module attribution maps `/catering` to
 * `service_operations`. */
export function registerCateringRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.catering;

  app.post("/catering/menus", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createMenu(request.actor!, menuSchema.parse(request.body)));
  });

  app.get("/catering/menus", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { activeOnly?: string };
    return reply.send(await svc().listMenus(request.actor!, query.activeOnly === "true"));
  });

  app.post("/catering/recipes", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createRecipe(request.actor!, recipeSchema.parse(request.body)));
  });

  app.get("/catering/recipes", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { activeOnly?: string };
    return reply.send(await svc().listRecipes(request.actor!, query.activeOnly === "true"));
  });

  app.get("/catering/recipes/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().getRecipeByCode(request.actor!, code));
  });

  app.put("/catering/recipes/:code/ingredients", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const body = ingredientsSchema.parse(request.body);
    return reply.send(await svc().setRecipeIngredients(request.actor!, code, body.ingredients));
  });

  app.get("/catering/recipes/:code/ingredients", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().listRecipeIngredients(request.actor!, code));
  });

  // K5 simple costing — structure only, no GL posting.
  app.post("/catering/recipes/:code/cost", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const body = z.object({ onDate: dateSchema.optional() }).parse(request.body ?? {});
    return reply.send(await svc().computeRecipeCost(request.actor!, code, body.onDate));
  });

  app.post("/catering/meal-plans", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createMealPlan(request.actor!, mealPlanSchema.parse(request.body)));
  });

  app.get("/catering/meal-plans", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { mealDate?: string };
    return reply.send(await svc().listMealPlans(request.actor!, query.mealDate));
  });

  app.post("/catering/meal-batches", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createMealBatch(request.actor!, mealBatchSchema.parse(request.body)));
  });

  app.get("/catering/meal-batches", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { status?: "draft" | "confirmed" | "consumed" };
    return reply.send(await svc().listMealBatches(request.actor!, query.status));
  });

  app.post("/catering/meal-batches/:batchNumber/status", { preHandler: app.authenticate }, async (request, reply) => {
    const { batchNumber } = request.params as { batchNumber: string };
    const { status } = batchStatusSchema.parse(request.body);
    return reply.send(await svc().setMealBatchStatus(request.actor!, batchNumber, status));
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * WP-FIN-A6-03 — Budget control HTTP surface (ADR-0020).
 *
 * Money strings at 4 decimals in and out; dates are YYYY-MM-DD. Same
 * conventions as the open-item routes: `app.authenticate` preHandler, zod
 * validation, `request.actor!`, central error mapping.
 */

const moneySchema = z.string().regex(/^\d{1,16}(\.\d{1,4})?$/, "expected a money string with at most 4 decimals");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuidSchema = z.string().uuid();

const scopeSchema = z.object({
  costCenterId: uuidSchema.nullable().optional(),
  projectId: uuidSchema.nullable().optional(),
  siteId: uuidSchema.nullable().optional(),
  accountFrom: z.string().max(40).nullable().optional(),
  accountTo: z.string().max(40).nullable().optional(),
});

const createBudgetSchema = z.object({
  legalEntityId: uuidSchema,
  fiscalYearCode: z.string().min(1).max(20),
  scenario: z.enum(["original", "revision", "forecast"]),
  currency: z.string().length(3),
  name: z.string().min(1).max(120),
  ownerUserId: uuidSchema.nullable().optional(),
  scope: scopeSchema.optional(),
});

const draftVersionSchema = z.object({
  totalAmount: moneySchema,
  weights: z
    .array(z.object({ periodCode: z.string().min(1).max(20), weight: moneySchema }))
    .min(1),
  note: z.string().nullable().optional(),
});

const actSchema = z.object({
  actionCode: z.string().min(1),
  comment: z.string().nullable().optional(),
});

const createPolicySchema = z.object({
  legalEntityId: uuidSchema,
  effect: z.enum(["advisory", "escalation", "hard_stop"]),
  documentType: z.string().max(60).nullable().optional(),
  costCenterId: uuidSchema.nullable().optional(),
  projectId: uuidSchema.nullable().optional(),
  accountFrom: z.string().max(40).nullable().optional(),
  accountTo: z.string().max(40).nullable().optional(),
  amountThreshold: moneySchema.nullable().optional(),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
});

const consumeSchema = z.object({
  budgetId: uuidSchema,
  periodCode: z.string().min(1).max(20),
  amount: moneySchema,
  kind: z.enum(["actual", "commitment", "adjustment", "release"]),
  documentType: z.string().max(60).nullable().optional(),
  costCenterId: uuidSchema.nullable().optional(),
  projectId: uuidSchema.nullable().optional(),
  sourceRefTable: z.string().max(60).nullable().optional(),
  sourceRefId: uuidSchema.nullable().optional(),
  idempotencyKey: z.string().min(1).max(120),
  note: z.string().nullable().optional(),
});

const releaseSchema = z.object({
  idempotencyKey: z.string().min(1).max(120),
  note: z.string().nullable().optional(),
});

export function registerBudgetRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.budget;

  app.post("/accounting/budgets", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createBudget(request.actor!, createBudgetSchema.parse(request.body)));
  });

  app.get("/accounting/budgets", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({
        legalEntityId: uuidSchema.optional(),
        fiscalYearCode: z.string().optional(),
        scenario: z.enum(["original", "revision", "forecast"]).optional(),
      })
      .parse(request.query);
    return reply.send(await svc().listBudgets(request.actor!, query));
  });

  app.get("/accounting/budgets/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().getBudget(request.actor!, id));
  });

  app.get("/accounting/budgets/:id/utilization", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const query = z.object({ versionId: uuidSchema.optional() }).parse(request.query);
    return reply.send(await svc().utilization(request.actor!, id, query.versionId ?? null));
  });

  app.post("/accounting/budgets/:id/versions", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply
      .status(201)
      .send(await svc().createDraftVersion(request.actor!, id, draftVersionSchema.parse(request.body)));
  });

  app.get("/accounting/budgets/:id/versions", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().listVersions(request.actor!, id));
  });

  app.get("/accounting/budget-versions/:id/lines", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().getVersionLines(request.actor!, id));
  });

  app.post("/accounting/budget-versions/:id/actions", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = actSchema.parse(request.body);
    return reply.send(
      await svc().actOnVersion(request.actor!, id, input.actionCode, input.comment ?? null),
    );
  });

  app.post("/accounting/budget-policies", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createPolicy(request.actor!, createPolicySchema.parse(request.body)));
  });

  app.get("/accounting/budget-policies", { preHandler: app.authenticate }, async (request, reply) => {
    const { legalEntityId } = z.object({ legalEntityId: uuidSchema }).parse(request.query);
    return reply.send(await svc().listPolicies(request.actor!, legalEntityId));
  });

  app.post("/accounting/budget-consumptions", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().consume(request.actor!, consumeSchema.parse(request.body)));
  });

  app.post("/accounting/budget-consumptions/:id/release", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.status(201).send(await svc().release(request.actor!, id, releaseSchema.parse(request.body)));
  });
}

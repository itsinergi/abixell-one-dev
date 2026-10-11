import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const costCenterSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["cost", "profit"]),
  parentId: z.string().uuid().nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
});

const costCenterUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(["cost", "profit"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  effectiveTo: dateSchema.nullable().optional(),
});

const paymentTermSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  netDays: z.number().int().min(0),
  discountDays: z.number().int().min(0).nullable().optional(),
  discountPercent: z.string().nullable().optional(),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
});

const paymentTermUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  effectiveTo: dateSchema.nullable().optional(),
});

/** WP-MD-01 — Finance master data surface. */
export function registerFinanceMasterRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.financeMaster;

  app.post("/finance/cost-centers", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createCostCenter(request.actor!, costCenterSchema.parse(request.body)));
  });

  app.get("/finance/cost-centers", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { status?: "active" | "inactive"; type?: "cost" | "profit" };
    return reply.send(await svc().listCostCenters(request.actor!, { status: query.status, type: query.type }));
  });

  app.get("/finance/cost-centers/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().getCostCenter(request.actor!, code));
  });

  app.patch("/finance/cost-centers/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().updateCostCenter(request.actor!, code, costCenterUpdateSchema.parse(request.body)));
  });

  app.post("/finance/payment-terms", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createPaymentTerm(request.actor!, paymentTermSchema.parse(request.body)));
  });

  app.get("/finance/payment-terms", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listPaymentTerms(request.actor!));
  });

  app.get("/finance/payment-terms/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().getPaymentTerm(request.actor!, code));
  });

  app.patch("/finance/payment-terms/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().updatePaymentTerm(request.actor!, code, paymentTermUpdateSchema.parse(request.body)));
  });
}

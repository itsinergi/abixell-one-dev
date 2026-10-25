import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * WP-FIN-A6-06a — Indonesia tax baseline HTTP surface (ADR-0019).
 *
 * Same conventions as the other Wave A6 modules: `app.authenticate` preHandler,
 * zod validation, `request.actor!`, central error mapping. Money is a 2-decimal
 * string, a rate is a 6-decimal fraction, dates are YYYY-MM-DD.
 */

const moneySchema = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "expected a money string with at most 2 decimals");
const rateSchema = z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, "expected a fraction with at most 6 decimals");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuidSchema = z.string().uuid();

const registrationSchema = z.object({
  legalEntityId: uuidSchema,
  taxpayerStatus: z.enum(["pkp", "non_pkp"]),
  effectiveFrom: dateSchema,
  registrationNumber: z.string().max(40).nullable().optional(),
  evidenceDocumentId: uuidSchema.nullable().optional(),
});

const ruleSchema = z.object({
  legalEntityId: uuidSchema,
  ruleCode: z.string().min(1).max(60),
  taxType: z.enum(["ppn", "pph22", "pph23", "pph26"]),
  description: z.string().nullable().optional(),
});

const versionSchema = z.object({
  rate: rateSchema,
  basis: z.enum(["gross", "net", "dpp"]),
  roundingMode: z.enum(["half_up", "half_even", "truncate"]).optional(),
  requiresPkp: z.boolean().optional(),
  accountId: uuidSchema,
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
});

const actionSchema = z.object({
  actionCode: z.string().min(1).max(40),
  comment: z.string().max(1000).nullable().optional(),
});

const calculationSchema = z.object({
  legalEntityId: uuidSchema,
  ruleCode: z.string().min(1).max(60),
  basisAmount: moneySchema,
  calculationDate: dateSchema,
  currency: z.string().length(3).optional(),
  documentRefTable: z.string().max(64).nullable().optional(),
  documentRefId: uuidSchema.nullable().optional(),
  idempotencyKey: z.string().min(1).max(120),
});

export function registerTaxRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.tax;

  // --- registrations -------------------------------------------------------
  app.post("/accounting/tax-registrations", { preHandler: app.authenticate }, async (request, reply) => {
    const input = registrationSchema.parse(request.body);
    return reply.status(201).send(
      await svc().registerTaxpayer(request.actor!, {
        ...input,
        registrationNumber: input.registrationNumber ?? null,
        evidenceDocumentId: input.evidenceDocumentId ?? null,
      }),
    );
  });

  app.get("/accounting/tax-registrations", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ legalEntityId: uuidSchema }).parse(request.query);
    return reply.send(await svc().listRegistrations(request.actor!, query.legalEntityId));
  });

  // --- rules ---------------------------------------------------------------
  app.post("/accounting/tax-rules", { preHandler: app.authenticate }, async (request, reply) => {
    const input = ruleSchema.parse(request.body);
    return reply.status(201).send(
      await svc().createRule(request.actor!, { ...input, description: input.description ?? null }),
    );
  });

  app.get("/accounting/tax-rules", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ legalEntityId: uuidSchema.optional() }).parse(request.query);
    return reply.send(await svc().listRules(request.actor!, query.legalEntityId));
  });

  app.post("/accounting/tax-rules/:id/versions", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    const input = versionSchema.parse(request.body);
    return reply.status(201).send(
      await svc().createVersion(request.actor!, id, {
        ...input,
        effectiveTo: input.effectiveTo ?? null,
      }),
    );
  });

  app.get("/accounting/tax-rules/:id/versions", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = z.object({ id: uuidSchema }).parse(request.params);
    return reply.send(await svc().listVersions(request.actor!, id));
  });

  app.post(
    "/accounting/tax-rule-versions/:id/actions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      const input = actionSchema.parse(request.body);
      return reply.send(
        await svc().actOnVersion(request.actor!, id, input.actionCode, input.comment ?? null),
      );
    },
  );

  // --- calculations --------------------------------------------------------
  app.post("/accounting/tax-calculations", { preHandler: app.authenticate }, async (request, reply) => {
    const input = calculationSchema.parse(request.body);
    return reply.status(201).send(
      await svc().calculate(request.actor!, {
        ...input,
        documentRefTable: input.documentRefTable ?? null,
        documentRefId: input.documentRefId ?? null,
      }),
    );
  });

  app.get("/accounting/tax-calculations", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({
        legalEntityId: uuidSchema.optional(),
        ruleVersionId: uuidSchema.optional(),
        documentRefId: uuidSchema.optional(),
      })
      .parse(request.query);
    return reply.send(await svc().listCalculations(request.actor!, query));
  });
}

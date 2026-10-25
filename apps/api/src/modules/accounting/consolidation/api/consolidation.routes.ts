import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * WP-FIN-A6-06b — Consolidation HTTP surface (ADR-0022).
 *
 * Same conventions as the rest of Wave A6: `app.authenticate` preHandler, zod
 * validation, `request.actor!`, central error mapping. Money is a 2-decimal
 * string, an FX rate is an 8-decimal positive string, dates are YYYY-MM-DD.
 */

const moneySchema = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "expected a money string with at most 2 decimals");
const fxRateSchema = z.string().regex(/^\d{1,10}(\.\d{1,8})?$/, "expected a positive rate with at most 8 decimals");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuidSchema = z.string().uuid();
const currencySchema = z.string().regex(/^[A-Z]{3}$/, "expected a 3-letter uppercase ISO code");
const statementTypeSchema = z.enum(["trial_balance", "balance_sheet", "profit_loss", "cash_flow"]);

const groupSchema = z.object({
  groupCode: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  reportingCurrency: currencySchema,
  translationDifferenceAccountId: uuidSchema.nullable().optional(),
});

const memberSchema = z.object({
  legalEntityId: uuidSchema,
  effectiveFrom: dateSchema,
});

const removeMemberSchema = z.object({ effectiveTo: dateSchema });

const fsvLineSchema = z.object({
  lineCode: z.string().min(1).max(40),
  lineName: z.string().min(1).max(200),
  statementType: statementTypeSchema,
  accountId: uuidSchema.nullable().optional(),
  sign: z.enum(["as_is", "flip"]).optional(),
  sequenceOrder: z.number().int().min(0).optional(),
  parentLineCode: z.string().max(40).nullable().optional(),
});

const fsvVersionSchema = z.object({
  fsvCode: z.string().min(1).max(40),
  description: z.string().nullable().optional(),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
  lines: z.array(fsvLineSchema).min(1),
});

const rateSetSchema = z.object({
  setCode: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.nullable().optional(),
  rates: z.array(
    z.object({
      fromCurrency: currencySchema,
      toCurrency: currencySchema,
      rateType: z.enum(["closing", "average", "historical"]),
      rate: fxRateSchema,
    }),
  ),
});

const translationSchema = z.object({
  groupId: uuidSchema,
  periodId: uuidSchema,
  rateSetId: uuidSchema,
  fsvVersionId: uuidSchema,
  asOf: dateSchema,
  idempotencyKey: z.string().min(1).max(120),
});

const eliminationSchema = z.object({
  groupId: uuidSchema,
  periodId: uuidSchema,
  description: z.string().min(1).max(500),
  amount: moneySchema,
  currency: currencySchema,
  idempotencyKey: z.string().min(1).max(120),
});

const eliminationActionSchema = z.object({
  actionCode: z.string().min(1).max(40),
  comment: z.string().max(1000).nullable().optional(),
  debitAccountId: uuidSchema,
  creditAccountId: uuidSchema,
  legalEntityId: uuidSchema,
  journalDate: dateSchema,
});

const actionSchema = z.object({
  actionCode: z.string().min(1).max(40),
  comment: z.string().max(1000).nullable().optional(),
});

export function registerConsolidationRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.consolidation;

  // --- groups --------------------------------------------------------------
  app.post("/accounting/consolidation-groups", { preHandler: app.authenticate }, async (request, reply) => {
    const input = groupSchema.parse(request.body);
    return reply.status(201).send(
      await svc().createGroup(request.actor!, {
        ...input,
        translationDifferenceAccountId: input.translationDifferenceAccountId ?? null,
      }),
    );
  });

  app.get("/accounting/consolidation-groups", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listGroups(request.actor!));
  });

  app.get(
    "/accounting/consolidation-groups/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      return reply.send(await svc().getGroup(request.actor!, id));
    },
  );

  app.post(
    "/accounting/consolidation-groups/:id/actions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      const input = actionSchema.parse(request.body);
      return reply.send(
        await svc().actOnGroup(request.actor!, id, input.actionCode, input.comment ?? null),
      );
    },
  );

  // --- membership ----------------------------------------------------------
  app.post(
    "/accounting/consolidation-groups/:id/members",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      const input = memberSchema.parse(request.body);
      return reply.status(201).send(await svc().addMember(request.actor!, id, input));
    },
  );

  app.get(
    "/accounting/consolidation-groups/:id/members",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      return reply.send(await svc().listMembers(request.actor!, id));
    },
  );

  app.delete(
    "/accounting/consolidation-groups/:id/members/:legalEntityId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ id: uuidSchema, legalEntityId: uuidSchema })
        .parse(request.params);
      const input = removeMemberSchema.parse(request.query);
      return reply.send(
        await svc().removeMember(request.actor!, params.id, params.legalEntityId, input.effectiveTo),
      );
    },
  );

  // --- FSV ----------------------------------------------------------------
  app.post("/accounting/fsv-versions", { preHandler: app.authenticate }, async (request, reply) => {
    const input = fsvVersionSchema.parse(request.body);
    return reply.status(201).send(
      await svc().createFsvVersion(request.actor!, {
        ...input,
        description: input.description ?? null,
        effectiveTo: input.effectiveTo ?? null,
      }),
    );
  });

  app.get("/accounting/fsv-versions", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ fsvCode: z.string().max(40).optional() }).parse(request.query);
    return reply.send(await svc().listFsvVersions(request.actor!, query.fsvCode));
  });

  app.get(
    "/accounting/fsv-versions/:id/lines",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      return reply.send(await svc().listFsvLines(request.actor!, id));
    },
  );

  app.post(
    "/accounting/fsv-versions/:id/actions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      const input = actionSchema.parse(request.body);
      return reply.send(
        await svc().actOnFsvVersion(request.actor!, id, input.actionCode, input.comment ?? null),
      );
    },
  );

  // --- FX rate sets --------------------------------------------------------
  app.post("/accounting/fx-rate-sets", { preHandler: app.authenticate }, async (request, reply) => {
    const input = rateSetSchema.parse(request.body);
    return reply.status(201).send(
      await svc().createRateSet(request.actor!, {
        ...input,
        effectiveTo: input.effectiveTo ?? null,
      }),
    );
  });

  app.get("/accounting/fx-rate-sets", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listRateSets(request.actor!));
  });

  app.get(
    "/accounting/fx-rate-sets/:id/rates",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      return reply.send(await svc().listRates(request.actor!, id));
    },
  );

  // --- translation ---------------------------------------------------------
  app.post("/accounting/translation-runs", { preHandler: app.authenticate }, async (request, reply) => {
    const input = translationSchema.parse(request.body);
    return reply.status(201).send(await svc().translate(request.actor!, input));
  });

  app.get("/accounting/translation-runs", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({ groupId: uuidSchema.optional(), periodId: uuidSchema.optional() })
      .parse(request.query);
    return reply.send(await svc().listRuns(request.actor!, query));
  });

  app.get(
    "/accounting/translation-runs/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      return reply.send(await svc().getRun(request.actor!, id));
    },
  );

  // --- eliminations --------------------------------------------------------
  app.post("/accounting/eliminations", { preHandler: app.authenticate }, async (request, reply) => {
    const input = eliminationSchema.parse(request.body);
    return reply.status(201).send(await svc().createElimination(request.actor!, input));
  });

  app.get("/accounting/eliminations", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z
      .object({ groupId: uuidSchema.optional(), periodId: uuidSchema.optional() })
      .parse(request.query);
    return reply.send(await svc().listEliminations(request.actor!, query));
  });

  app.post(
    "/accounting/eliminations/:id/actions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = z.object({ id: uuidSchema }).parse(request.params);
      const input = eliminationActionSchema.parse(request.body);
      return reply.send(
        await svc().actOnElimination(request.actor!, id, {
          ...input,
          comment: input.comment ?? null,
        }),
      );
    },
  );
}

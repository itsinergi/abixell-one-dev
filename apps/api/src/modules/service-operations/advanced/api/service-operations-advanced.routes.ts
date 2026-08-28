import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * Service Operations Advanced HTTP routes (Wave A3).
 *
 * Scope:
 * - Vertical Service Packs (PACK-001…004)
 * - Route, Roster, Capacity & Workload Optimization (SO-ADV-002…005)
 */

const targetDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const activatePackSchema = z.object({
  seedPresets: z.boolean().optional(),
});

const generateOptimizationSchema = z.object({
  targetDate: z.string().regex(targetDateRegex, "targetDate must be YYYY-MM-DD"),
  organizationUnitId: z.string().uuid().nullable().optional(),
  parameters: z
    .object({
      maxWorkOrdersPerWorker: z.number().int().positive().optional(),
      maxMinutesPerWorker: z.number().int().positive().optional(),
      prioritizeSla: z.boolean().optional(),
      groupDistanceNear: z.boolean().optional(),
    })
    .optional(),
});

export function registerServiceOperationsAdvancedRoutes(
  app: FastifyInstance,
  container: Container,
) {
  const svc = () => container.serviceOperationsAdvanced;

  // --- Vertical Service Packs (PACK-001…004) -----------------------------

  app.get(
    "/service-operations/packs",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await svc().listPacks(request.actor!));
    },
  );

  app.get(
    "/service-operations/packs/:packCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { packCode } = request.params as { packCode: string };
      return reply.send(await svc().getPack(request.actor!, packCode));
    },
  );

  app.post(
    "/service-operations/packs/:packCode/activate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { packCode } = request.params as { packCode: string };
      const body = activatePackSchema.parse(request.body ?? {});
      return reply.send(await svc().activatePack(request.actor!, packCode, body));
    },
  );

  app.post(
    "/service-operations/packs/:packCode/deactivate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { packCode } = request.params as { packCode: string };
      return reply.send(await svc().deactivatePack(request.actor!, packCode));
    },
  );

  // --- Route, Roster, Capacity & Workload Optimization (SO-ADV-002…005) ---

  app.post(
    "/service-operations/optimization/runs",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = generateOptimizationSchema.parse(request.body);
      return reply
        .status(201)
        .send(await svc().generateOptimizationRun(request.actor!, body));
    },
  );

  app.get(
    "/service-operations/optimization/runs",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = request.query as { limit?: string };
      const limit = query.limit ? Number(query.limit) : undefined;
      return reply.send(await svc().listOptimizationRuns(request.actor!, limit));
    },
  );

  app.get(
    "/service-operations/optimization/runs/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await svc().getOptimizationRun(request.actor!, id));
    },
  );

  app.post(
    "/service-operations/optimization/runs/:id/apply",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await svc().applyOptimizationRun(request.actor!, id));
    },
  );

  app.post(
    "/service-operations/optimization/runs/:id/dismiss",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await svc().dismissOptimizationRun(request.actor!, id));
    },
  );
}

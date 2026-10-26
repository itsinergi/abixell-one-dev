import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * Project Delivery Advanced HTTP routes (Wave A7, PRJ-ADV-001…008).
 *
 * Everything here lives under `/project-delivery/advanced/*` except the plan
 * tree, which hangs off the project it belongs to. The prefix is deliberate:
 * the Core surface (`/project-delivery/projects/:projectId/activities`) keeps
 * its shape untouched, so a tenant that never grants the Advanced permissions
 * sees exactly the API it saw before this wave (ADR-0026 §4).
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const dependencyTypeSchema = z.enum(["FS", "SS", "FF", "SF"]);
const resourceTypeSchema = z.enum(["labor", "equipment", "material", "other"]);
const costEntryTypeSchema = z.enum(["actual", "commitment", "adjustment"]);

/** A decimal string, never a JS number — see ADR-0026 §5. */
const moneySchema = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, "expected a 2-decimal amount");
const unitsSchema = z.string().regex(/^-?\d{1,16}(\.\d{1,4})?$/, "expected a 4-decimal quantity");

export function registerProjectDeliveryAdvancedRoutes(app: FastifyInstance, container: Container) {
  const plan = () => container.projectPlan;
  const cost = () => container.projectCost;

  // --- WBS (PRJ-ADV-001) --------------------------------------------------

  app.get(
    "/project-delivery/projects/:projectId/wbs",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      return reply.send(await plan().listWbsTree(request.actor!, projectId));
    },
  );

  app.post(
    "/project-delivery/projects/:projectId/wbs",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          parentId: z.string().uuid().nullable().optional(),
          code: z.string().min(1),
          name: z.string().min(1),
          description: z.string().nullable().optional(),
          sortOrder: z.number().int().optional(),
        })
        .parse(request.body);
      return reply.status(201).send(await plan().createWbsNode(request.actor!, projectId, body));
    },
  );

  app.patch(
    "/project-delivery/wbs/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          code: z.string().min(1).optional(),
          name: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          sortOrder: z.number().int().optional(),
        })
        .parse(request.body);
      return reply.send(await plan().updateWbsNode(request.actor!, id, body));
    },
  );

  app.put(
    "/project-delivery/activities/:activityId/wbs-node",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { activityId } = request.params as { activityId: string };
      const body = z.object({ wbsNodeId: z.string().uuid().nullable() }).parse(request.body);
      return reply.send(await plan().assignActivityToWbsNode(request.actor!, activityId, body.wbsNodeId));
    },
  );

  // --- Dependencies, schedule, Gantt (PRJ-ADV-002/003) --------------------

  app.get(
    "/project-delivery/projects/:projectId/dependencies",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      return reply.send(await plan().listDependencies(request.actor!, projectId));
    },
  );

  app.post(
    "/project-delivery/projects/:projectId/dependencies",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          predecessorActivityId: z.string().uuid(),
          successorActivityId: z.string().uuid(),
          dependencyType: dependencyTypeSchema.optional(),
          lagDays: z.number().int().optional(),
        })
        .parse(request.body);
      return reply.status(201).send(await plan().createDependency(request.actor!, projectId, body));
    },
  );

  app.delete(
    "/project-delivery/dependencies/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await plan().deleteDependency(request.actor!, id);
      return reply.status(204).send();
    },
  );

  app.get(
    "/project-delivery/projects/:projectId/schedule",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      return reply.send(await plan().getSchedule(request.actor!, projectId));
    },
  );

  app.get(
    "/project-delivery/projects/:projectId/gantt",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      return reply.send(await plan().getGantt(request.actor!, projectId));
    },
  );

  // --- Resources (PRJ-ADV-004) --------------------------------------------

  app.get("/project-delivery/resources", { preHandler: app.authenticate }, async (request, reply) => {
    const { activeOnly } = request.query as { activeOnly?: string };
    return reply.send(await plan().listResources(request.actor!, activeOnly !== "false"));
  });

  app.post("/project-delivery/resources", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        resourceType: resourceTypeSchema.optional(),
        unit: z.string().min(1),
        capacityPerDay: unitsSchema.nullable().optional(),
        costRate: moneySchema.nullable().optional(),
      })
      .parse(request.body);
    return reply.status(201).send(await plan().createResource(request.actor!, body));
  });

  app.post(
    "/project-delivery/projects/:projectId/resource-assignments",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          activityId: z.string().uuid(),
          resourceId: z.string().uuid(),
          plannedUnits: unitsSchema,
          startDate: dateSchema,
          endDate: dateSchema,
        })
        .parse(request.body);
      return reply.status(201).send(await plan().createResourceAssignment(request.actor!, projectId, body));
    },
  );

  app.get(
    "/project-delivery/projects/:projectId/resource-loading",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const { from, to } = request.query as { from: string; to: string };
      return reply.send(await plan().getResourceLoading(request.actor!, projectId, from, to));
    },
  );

  // --- Baseline and variance (PRJ-ADV-005) --------------------------------

  app.get(
    "/project-delivery/projects/:projectId/baselines",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      return reply.send(await plan().listBaselines(request.actor!, projectId));
    },
  );

  app.post(
    "/project-delivery/projects/:projectId/baselines",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({ name: z.string().min(1), notes: z.string().nullable().optional() })
        .parse(request.body);
      return reply.status(201).send(await plan().createBaseline(request.actor!, projectId, body));
    },
  );

  app.post(
    "/project-delivery/baselines/:id/approve",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await plan().approveBaseline(request.actor!, id));
    },
  );

  app.get(
    "/project-delivery/projects/:projectId/baseline-variance",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const { asOfDate } = request.query as { asOfDate: string };
      return reply.send(await plan().getBaselineVariance(request.actor!, projectId, asOfDate));
    },
  );

  // --- Cost ledger and earned value (PRJ-ADV-006/007) --------------------

  app.get(
    "/project-delivery/projects/:projectId/cost-entries",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const { asOfDate } = request.query as { asOfDate?: string };
      return reply.send(await cost().listCostEntries(request.actor!, projectId, asOfDate ?? null));
    },
  );

  app.post(
    "/project-delivery/projects/:projectId/cost-entries",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({
          activityId: z.string().uuid().nullable().optional(),
          entryType: costEntryTypeSchema,
          amount: moneySchema,
          currency: z.string().length(3),
          entryDate: dateSchema,
          sourceDocumentType: z.string().nullable().optional(),
          sourceDocumentId: z.string().uuid().nullable().optional(),
          idempotencyKey: z.string().min(1),
          note: z.string().nullable().optional(),
        })
        .parse(request.body);
      return reply.status(201).send(await cost().recordCostEntry(request.actor!, projectId, body));
    },
  );

  app.post(
    "/project-delivery/cost-entries/:id/reverse",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({ note: z.string().nullable().optional() }).parse(request.body ?? {});
      return reply.status(201).send(await cost().reverseCostEntry(request.actor!, id, body.note ?? null));
    },
  );

  app.get(
    "/project-delivery/projects/:projectId/cost-position",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const { asOfDate } = request.query as { asOfDate: string };
      return reply.send(await cost().getCostPosition(request.actor!, projectId, asOfDate));
    },
  );

  app.get(
    "/project-delivery/projects/:projectId/earned-value",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const { asOfDate } = request.query as { asOfDate: string };
      return reply.send(await cost().computeEarnedValue(request.actor!, projectId, asOfDate));
    },
  );

  app.get(
    "/project-delivery/projects/:projectId/earned-value-snapshots",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      return reply.send(await cost().listEarnedValueSnapshots(request.actor!, projectId));
    },
  );

  app.post(
    "/project-delivery/projects/:projectId/earned-value-snapshots",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const body = z
        .object({ asOfDate: dateSchema, notes: z.string().nullable().optional() })
        .parse(request.body);
      return reply
        .status(201)
        .send(await cost().snapshotEarnedValue(request.actor!, projectId, body.asOfDate, body.notes ?? null));
    },
  );

  // --- Project accounting (PRJ-ADV-008) ----------------------------------

  app.post(
    "/project-delivery/cost-entries/:id/post",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await cost().postCostEntry(request.actor!, id));
    },
  );
}
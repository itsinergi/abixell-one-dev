import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * Service Operations HTTP surface (Phase 2). Follows the existing API
 * conventions exactly: `app.authenticate` preHandler, zod body validation,
 * `request.actor!` for tenant/user context, and errors mapped centrally.
 */

const serviceDefinitionSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
});

const checklistTemplateSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  isRequired: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const activeSchema = z.object({ isActive: z.boolean() });

const workRequestSchema = z.object({
  customerId: z.string().uuid(),
  contractId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  serviceDefinitionCode: z.string().min(1),
  description: z.string().min(1),
  priority: z.string().nullable().optional(),
});

const cancelSchema = z.object({ reason: z.string().nullable().optional() });

const scheduleSchema = z.object({
  plannedStartAt: z.string().nullable().optional(),
  plannedEndAt: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
});

const convertSchema = scheduleSchema.extend({ title: z.string().min(1).optional() });

const workOrderSchema = scheduleSchema.extend({
  customerId: z.string().uuid(),
  contractId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  serviceDefinitionCode: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
});

const assignSchema = z.object({ assigneeUserId: z.string().uuid() });
const notesSchema = z.object({ notes: z.string().nullable().optional() });
const commentSchema = z.object({ comment: z.string().nullable().optional() });
const checklistResultSchema = z.object({
  isCompleted: z.boolean(),
  note: z.string().nullable().optional(),
});

export function registerServiceOperationsRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.serviceOperations;

  // --- Service Definitions (SO-CORE-001 / SO-CORE-007) -----------------

  app.post("/service-definitions", { preHandler: app.authenticate }, async (request, reply) => {
    const body = serviceDefinitionSchema.parse(request.body);
    return reply.status(201).send(await svc().createServiceDefinition(request.actor!, body));
  });

  app.get("/service-definitions", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listServiceDefinitions(request.actor!));
  });

  app.get("/service-definitions/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    return reply.send(await svc().getServiceDefinition(request.actor!, code));
  });

  app.post(
    "/service-definitions/:code/checklist-items",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const body = checklistTemplateSchema.parse(request.body);
      return reply.status(201).send(await svc().addChecklistTemplateItem(request.actor!, code, body));
    },
  );

  app.patch("/service-definitions/:code/active", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const { isActive } = activeSchema.parse(request.body);
    return reply.send(await svc().setServiceDefinitionActive(request.actor!, code, isActive));
  });

  // --- Work Requests (SO-CORE-002) -------------------------------------

  app.post("/work-requests", { preHandler: app.authenticate }, async (request, reply) => {
    const body = workRequestSchema.parse(request.body);
    return reply.status(201).send(await svc().createWorkRequest(request.actor!, body));
  });

  app.get("/work-requests", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listWorkRequests(request.actor!));
  });

  app.get("/work-requests/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getWorkRequest(request.actor!, id));
  });

  app.post("/work-requests/:id/cancel", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { reason } = cancelSchema.parse(request.body ?? {});
    return reply.send(await svc().cancelWorkRequest(request.actor!, id, reason ?? null));
  });

  /** Intake -> executable work (SO-CORE-003). */
  app.post("/work-requests/:id/convert", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = convertSchema.parse(request.body ?? {});
    return reply.status(201).send(await svc().convertRequestToWorkOrder(request.actor!, id, body));
  });

  // --- Work Orders (SO-CORE-003 … SO-CORE-014) -------------------------

  app.post("/work-orders", { preHandler: app.authenticate }, async (request, reply) => {
    const body = workOrderSchema.parse(request.body);
    return reply.status(201).send(await svc().createWorkOrder(request.actor!, body));
  });

  /** Coordinator/supervisor queue (SO-CORE-013). */
  app.get("/work-orders", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { siteId?: string };
    return reply.send(await svc().listWorkOrders(request.actor!, { siteId: query.siteId }));
  });

  /** Field surface (SO-CORE-014) — declared before `/:id` so "my" is not
   * captured as an id parameter. */
  app.get("/work-orders/my", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listMyWork(request.actor!));
  });

  app.get("/work-orders/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getWorkOrderDetail(request.actor!, id));
  });

  app.post("/work-orders/:id/assign", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { assigneeUserId } = assignSchema.parse(request.body);
    return reply.send(await svc().assignWorkOrder(request.actor!, id, assigneeUserId));
  });

  app.post("/work-orders/:id/schedule", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = scheduleSchema.parse(request.body ?? {});
    return reply.send(await svc().scheduleWorkOrder(request.actor!, id, body));
  });

  /** Generic lifecycle dispatch — the Workflow Engine validates the
   * transition; this module never encodes the Step graph (SO-CORE-004). */
  app.post("/work-orders/:id/actions/:actionCode", { preHandler: app.authenticate }, async (request, reply) => {
    const { id, actionCode } = request.params as { id: string; actionCode: string };
    const { comment } = commentSchema.parse(request.body ?? {});
    return reply.send(await svc().act(request.actor!, id, actionCode, comment ?? null));
  });

  app.post("/work-orders/:id/start", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().startWork(request.actor!, id));
  });

  app.post(
    "/work-orders/:id/checklist/:itemId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, itemId } = request.params as { id: string; itemId: string };
      const body = checklistResultSchema.parse(request.body);
      return reply.send(await svc().setChecklistItem(request.actor!, id, itemId, body));
    },
  );

  app.post("/work-orders/:id/complete", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { notes } = notesSchema.parse(request.body ?? {});
    return reply.send(await svc().completeWork(request.actor!, id, notes ?? null));
  });

  app.post("/work-orders/:id/verify", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { notes } = notesSchema.parse(request.body ?? {});
    return reply.send(await svc().verifyWork(request.actor!, id, notes ?? null));
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createSchema = z.object({
  customerId: z.string().uuid(),
  customerContactId: z.string().uuid().nullable().optional(),
  contractId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  category: z.string().min(1),
  subcategory: z.string().nullable().optional(),
  description: z.string().min(1),
  priority: z.string().min(1),
  severity: z.string().min(1),
  source: z.string().nullable().optional(),
  channel: z.string().nullable().optional(),
});

const commentSchema = z.object({ comment: z.string().nullable().optional() });
const investigationSchema = z.object({
  rootCause: z.string().nullable().optional(),
  correctiveAction: z.string().nullable().optional(),
  preventiveAction: z.string().nullable().optional(),
  correctiveActionOwnerUserId: z.string().uuid().nullable().optional(),
  correctiveActionTargetDate: z.string().nullable().optional(),
});
const noteSchema = z.object({ note: z.string().nullable().optional() });
const reopenSchema = z.object({
  toStepCode: z.string().min(1),
  comment: z.string().nullable().optional(),
});

export function registerComplaintRoutes(app: FastifyInstance, container: Container) {
  app.post("/complaints", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const complaint = await container.complaint.create(request.actor!, body);
    return reply.status(201).send(complaint);
  });

  app.get("/complaints", { preHandler: app.authenticate }, async (request, reply) => {
    const query = z.object({ customerId: z.string().uuid() }).parse(request.query);
    const list = await container.complaint.listByCustomer(request.actor!, query.customerId);
    return reply.send(list);
  });

  app.get("/complaints/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await container.complaint.get(request.actor!, id);
    return reply.send(result);
  });

  app.post("/complaints/:id/submit", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = commentSchema.parse(request.body ?? {});
    const result = await container.complaint.submit(request.actor!, id, body.comment ?? null);
    return reply.send(result);
  });

  // Generic action dispatch — actionCode comes straight from the
  // Tenant-configured Workflow Transitions (see ComplaintService.act's
  // doc comment); this route never hardcodes which actionCodes exist.
  app.post(
    "/complaints/:id/actions/:actionCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, actionCode } = request.params as { id: string; actionCode: string };
      const body = commentSchema.parse(request.body ?? {});
      const result = await container.complaint.act(request.actor!, id, actionCode, body.comment ?? null);
      return reply.send(result);
    },
  );

  app.post(
    "/complaints/:id/investigation",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = investigationSchema.parse(request.body);
      const updated = await container.complaint.updateInvestigation(request.actor!, id, body);
      return reply.send(updated);
    },
  );

  app.post("/complaints/:id/verification", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = noteSchema.parse(request.body ?? {});
    const updated = await container.complaint.verify(request.actor!, id, body.note ?? null);
    return reply.send(updated);
  });

  app.post(
    "/complaints/:id/customer-confirmation",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = noteSchema.parse(request.body ?? {});
      const updated = await container.complaint.confirmByCustomer(request.actor!, id, body.note ?? null);
      return reply.send(updated);
    },
  );

  app.post("/complaints/:id/reopen", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = reopenSchema.parse(request.body);
    const result = await container.complaint.reopen(request.actor!, id, body.toStepCode, body.comment ?? null);
    return reply.send(result);
  });
}

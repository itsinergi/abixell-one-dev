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
    // `view=summary` (Checkpoint 1C.2) enriches each row with live Workflow
    // status + SLA for the customer list experience. Default is unchanged
    // (plain Complaint[]) — backward-compatible with existing consumers.
    const query = z
      .object({ customerId: z.string().uuid(), view: z.enum(["summary"]).optional() })
      .parse(request.query);
    if (query.view === "summary") {
      const list = await container.complaint.listByCustomerSummary(request.actor!, query.customerId);
      return reply.send(list);
    }
    const list = await container.complaint.listByCustomer(request.actor!, query.customerId);
    return reply.send(list);
  });

  // Checkpoint 1C.2 — Tenant-configured category/severity/priority catalogs
  // for the create form, gated on complaint.manage (so Customer Users can
  // load it without config.read). Static path — declared before `/:id`.
  app.get("/complaints/reference-data", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await container.complaint.getCreateOptions(request.actor!);
    return reply.send(result);
  });

  // Checkpoint 1C.3 — operational queue (internal actors only; enforced in
  // the service). Complaint-centric, scope-filtered, enriched with live
  // status/SLA/assignment. Static path — declared before `/:id`.
  const queueQuerySchema = z.object({
    assignedToMe: z.enum(["true", "false"]).optional(),
    severity: z.string().min(1).optional(),
    stepCode: z.string().min(1).optional(),
    overdue: z.enum(["true", "false"]).optional(),
    customerId: z.string().uuid().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });
  app.get("/complaints/queue", { preHandler: app.authenticate }, async (request, reply) => {
    const q = queueQuerySchema.parse(request.query);
    const result = await container.complaint.listOperationalQueue(
      request.actor!,
      {
        assignedToMe: q.assignedToMe === "true",
        severity: q.severity,
        stepCode: q.stepCode,
        overdue: q.overdue === "true",
        customerId: q.customerId,
      },
      { limit: q.limit, offset: q.offset },
    );
    return reply.send(result);
  });

  // Checkpoint 1C.5 — Management Dashboard (internal, permission-gated in the
  // service on complaint.dashboard.read + Data Scope). Static path — before `/:id`.
  const dashboardQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    customerId: z.string().uuid().optional(),
    siteId: z.string().uuid().optional(),
    serviceId: z.string().uuid().optional(),
    category: z.string().min(1).optional(),
    severity: z.string().min(1).optional(),
  });
  app.get("/complaints/dashboard", { preHandler: app.authenticate }, async (request, reply) => {
    const q = dashboardQuerySchema.parse(request.query);
    const result = await container.complaintDashboard.getDashboard(request.actor!, q);
    return reply.send(result);
  });

  // Wave 1 dynamic dashboard — complaint drill-down list. Gated on
  // complaint.dashboard.read in the service; Data-Scope-aware.
  const dashboardListQuerySchema = z.object({
    status: z.enum(["open", "closed"]).optional(),
    severity: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    customerId: z.string().uuid().optional(),
    limit: z.coerce.number().int().positive().max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });
  app.get("/complaints/dashboard-list", { preHandler: app.authenticate }, async (request, reply) => {
    const q = dashboardListQuerySchema.parse(request.query);
    const result = await container.complaint.listForDashboard(request.actor!, q);
    return reply.send(result);
  });

  // Checkpoint 1C.6 — Complaint Administration & Configuration (internal;
  // gated on complaint.configure in the service). Static paths — before `/:id`.
  const createRefItemSchema = z.object({
    code: z.string().min(1),
    label: z.string().min(1),
    sortOrder: z.number().int().optional(),
  });
  const setRefItemActiveSchema = z.object({ isActive: z.boolean() });

  app.get("/complaints/config", { preHandler: app.authenticate }, async (request, reply) => {
    const result = await container.complaintConfiguration.getConfiguration(request.actor!);
    return reply.send(result);
  });

  app.post(
    "/complaints/config/reference-data/:typeCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { typeCode } = request.params as { typeCode: string };
      const body = createRefItemSchema.parse(request.body);
      const created = await container.complaintConfiguration.createReferenceItem(request.actor!, typeCode, body);
      return reply.status(201).send(created);
    },
  );

  app.patch(
    "/complaints/config/reference-data/:typeCode/:itemId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { typeCode, itemId } = request.params as { typeCode: string; itemId: string };
      const body = setRefItemActiveSchema.parse(request.body);
      const updated = await container.complaintConfiguration.setReferenceItemActive(
        request.actor!,
        typeCode,
        itemId,
        body.isActive,
      );
      return reply.send(updated);
    },
  );

  app.get("/complaints/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await container.complaint.get(request.actor!, id);
    return reply.send(result);
  });

  // Checkpoint 1C.2 — customer-safe composite detail (complaint + status +
  // SLA + safe timeline + available actions + reopen eligibility) in one
  // authorized read, composed live from existing tables (FD-1C-01).
  app.get("/complaints/:id/detail", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await container.complaint.getDetail(request.actor!, id);
    return reply.send(result);
  });

  // Checkpoint 1C.3 — operational (internal) detail: richer, role-appropriate
  // timeline (retains actor + comments). Restricted to internal actors in the
  // service, so a Customer User cannot reach internal data through it.
  app.get("/complaints/:id/operational-detail", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await container.complaint.getOperationalDetail(request.actor!, id);
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

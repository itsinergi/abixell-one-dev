import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * HSE Core HTTP surface (Phase 7, HSE-CORE-001…010).
 *
 * Endpoints:
 *   POST   /hse/records                           — Report a new HSE record
 *   GET    /hse/records                           — Register (list) with filters
 *   GET    /hse/records/:id                       — Detail (record + persons + follow-ups + status)
 *   PATCH  /hse/records/:id                       — Update classification / location
 *   POST   /hse/records/:id/lifecycle             — Start the lifecycle (Workflow)
 *   POST   /hse/records/:id/actions/:actionCode   — Act on the Workflow step
 *   POST   /hse/records/:id/persons               — Add person involved
 *   POST   /hse/records/:id/follow-ups            — Create follow-up action
 *   POST   /hse/records/:id/follow-ups/:fid/complete — Complete a follow-up
 *
 * There is no DELETE endpoint — HSE records are never hard-deleted (prompt §30).
 *
 * Conventions: same as Finance, Asset — zod validation, app.authenticate
 * preHandler, request.actor!, central error mapping via the global Fastify
 * error handler in app.ts. No custom error handling per route.
 */

const isoTimestampSchema = z.string().min(1, "occurred_at must be an ISO timestamp");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const commentSchema = z.object({ comment: z.string().nullable().optional() });

const reportSchema = z.object({
  recordType: z.enum(["incident", "observation"]),
  categoryCode: z.string().min(1).nullable().optional(),
  severityCode: z.string().min(1).nullable().optional(),
  occurredAt: isoTimestampSchema,
  title: z.string().min(1),
  summary: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  immediateAction: z.string().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  locationDetail: z.string().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  responsibleOrgUnitId: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  categoryCode: z.string().min(1).nullable().optional(),
  severityCode: z.string().min(1).nullable().optional(),
  occurredAt: isoTimestampSchema.optional(),
  title: z.string().min(1).optional(),
  summary: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  immediateAction: z.string().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  locationDetail: z.string().nullable().optional(),
  responsibleUserId: z.string().uuid().nullable().optional(),
  responsibleOrgUnitId: z.string().uuid().nullable().optional(),
});

const personSchema = z.object({
  employeeId: z.string().uuid().nullable().optional(),
  personName: z.string().min(1).nullable().optional(),
  personRole: z.string().nullable().optional(),
});

const followUpSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  assignedToOrgUnitId: z.string().uuid().nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
});

const completeFollowUpSchema = z.object({
  completionNotes: z.string().nullable().optional(),
});

export function registerHseRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.hse;

  // --- Register (HSE-CORE-001/002/009/010) --------------------------------

  app.post("/hse/records", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().reportRecord(request.actor!, reportSchema.parse(request.body)));
  });

  app.get("/hse/records", { preHandler: app.authenticate }, async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    return reply.send(
      await svc().listRecords(request.actor!, {
        recordType: q.recordType as "incident" | "observation" | undefined,
        categoryCode: q.categoryCode,
        severityCode: q.severityCode,
        organizationUnitId: q.organizationUnitId,
        projectId: q.projectId,
        siteId: q.siteId,
        reportedByUserId: q.reportedByUserId,
        responsibleUserId: q.responsibleUserId,
        occurredFrom: q.occurredFrom,
        occurredTo: q.occurredTo,
        search: q.search,
      }),
    );
  });

  app.get("/hse/records/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getRecord(request.actor!, id));
  });

  app.patch("/hse/records/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().updateRecord(request.actor!, id, updateSchema.parse(request.body)));
  });

  // --- Lifecycle (HSE-CORE-006) -------------------------------------------

  app.post(
    "/hse/records/:id/lifecycle",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await svc().startLifecycle(request.actor!, id));
    },
  );

  app.post(
    "/hse/records/:id/actions/:actionCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, actionCode } = request.params as { id: string; actionCode: string };
      const { comment } = commentSchema.parse(request.body ?? {});
      return reply.send(await svc().actOnRecord(request.actor!, id, actionCode, comment ?? null));
    },
  );

  // --- Persons involved (HSE-CORE-004) ------------------------------------

  app.post(
    "/hse/records/:id/persons",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply
        .status(201)
        .send(await svc().addPersonInvolved(request.actor!, id, personSchema.parse(request.body)));
    },
  );

  // --- Follow-ups (HSE-CORE-007) -----------------------------------------

  app.post(
    "/hse/records/:id/follow-ups",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply
        .status(201)
        .send(await svc().createFollowUp(request.actor!, id, followUpSchema.parse(request.body)));
    },
  );

  app.post(
    "/hse/records/:id/follow-ups/:fid/complete",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, fid } = request.params as { id: string; fid: string };
      const { completionNotes } = completeFollowUpSchema.parse(request.body ?? {});
      return reply.send(
        await svc().completeFollowUp(request.actor!, id, fid, completionNotes ?? null),
      );
    },
  );
}

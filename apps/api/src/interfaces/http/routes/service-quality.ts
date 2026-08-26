import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const workweekWindowSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});

const createCalendarSchema = z.object({
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  timeZone: z.string().trim().min(1).max(200),
  isContinuous: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  windows: z.array(workweekWindowSchema).max(28),
});

const holidaySchema = z.object({
  holidayDate: dateOnly,
  name: z.string().trim().min(1).max(200),
});

const createPolicySchema = z.object({
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  calendarId: z.string().uuid(),
});

const createRuleSchema = z.object({
  policyId: z.string().uuid(),
  code: z.string().trim().min(1).max(100),
  customerId: z.string().uuid().nullable().optional(),
  contractId: z.string().uuid().nullable().optional(),
  severityCode: z.string().trim().min(1).max(100).nullable().optional(),
  categoryCode: z.string().trim().min(1).max(100).nullable().optional(),
  responseMinutes: z.number().int().positive().max(525_600).nullable().optional(),
  resolutionMinutes: z.number().int().positive().max(525_600).nullable().optional(),
  priority: z.number().int().min(-1_000_000).max(1_000_000).optional(),
});

export function registerServiceQualityRoutes(app: FastifyInstance, container: Container) {
  app.post(
    "/service-quality/calendars",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createCalendarSchema.parse(request.body);
      const result = await container.serviceQuality.createCalendar(request.actor!, body);
      return reply.status(201).send(result);
    },
  );

  app.get(
    "/service-quality/calendars",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.serviceQuality.listCalendars(request.actor!));
    },
  );

  app.post(
    "/service-quality/calendars/:id/holidays",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = holidaySchema.parse(request.body);
      const holiday = await container.serviceQuality.addHoliday(request.actor!, id, body);
      return reply.status(201).send(holiday);
    },
  );

  app.get(
    "/service-quality/reference-data",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(
        await container.serviceQuality.getConfigurationOptions(request.actor!),
      );
    },
  );

  app.post(
    "/service-quality/sla-policies",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createPolicySchema.parse(request.body);
      const policy = await container.serviceQuality.createSlaPolicy(request.actor!, body);
      return reply.status(201).send(policy);
    },
  );

  app.get(
    "/service-quality/sla-policies",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.serviceQuality.listSlaPolicies(request.actor!));
    },
  );

  app.post(
    "/service-quality/sla-rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createRuleSchema.parse(request.body);
      const rule = await container.serviceQuality.createSlaRule(request.actor!, body);
      return reply.status(201).send(rule);
    },
  );

  // Static analytics route is registered before the parameterized complaint
  // route so Fastify never interprets "analytics" as a Complaint UUID.
  app.get(
    "/service-quality/sla-performance",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.serviceQuality.getSlaPerformance(request.actor!));
    },
  );

  app.get(
    "/service-quality/complaints/:complaintId/sla",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { complaintId } = request.params as { complaintId: string };
      return reply.send(
        await container.serviceQuality.getComplaintSla(request.actor!, complaintId),
      );
    },
  );

  // --- SQ-ADV-002: Structured RCA -------------------------------------------

  app.post(
    "/service-quality/rca/categories",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = z
        .object({
          code: z.string().trim().min(1).max(100),
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(2000).nullable().optional(),
          parentId: z.string().uuid().nullable().optional(),
          sortOrder: z.number().int().optional(),
        })
        .parse(request.body);
      const category = await container.serviceQuality.createRootCauseCategory(
        request.actor!,
        body,
      );
      return reply.status(201).send(category);
    },
  );

  app.get(
    "/service-quality/rca/categories",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.serviceQuality.listRootCauseCategories(request.actor!));
    },
  );

  app.post(
    "/service-quality/complaints/:complaintId/rca/findings",
    { preHandler: app.authenticate },
    async (request, reply) => {
      try {
        const { complaintId } = request.params as { complaintId: string };
        const body = z
          .object({
            rootCauseCategoryId: z.string().uuid(),
            analysisMethodCode: z.string().trim().min(1).max(100).nullable().optional(),
            statement: z.string().trim().min(1).max(4000),
            evidenceSummary: z.string().trim().max(4000).nullable().optional(),
            isPrimary: z.boolean().default(false),
            identifiedBy: z.string().trim().max(200).nullable().optional(),
          })
          .parse(request.body);
        const finding = await container.serviceQuality.recordRcaFinding(request.actor!, {
          ...body,
          complaintId,
          identifiedBy: body.identifiedBy ?? null,
        });
        return reply.status(201).send(finding);
      } catch (err) {
        request.log.error(err, "recordRcaFinding error");
        throw err;
      }
    },
  );

  app.get(
    "/service-quality/complaints/:complaintId/rca/findings",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { complaintId } = request.params as { complaintId: string };
      return reply.send(
        await container.serviceQuality.listRcaFindings(request.actor!, complaintId),
      );
    },
  );

  app.delete(
    "/service-quality/complaints/:complaintId/rca/primary",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { complaintId } = request.params as { complaintId: string };
      await container.serviceQuality.clearPrimaryRcaFinding(request.actor!, complaintId);
      return reply.status(204).send();
    },
  );

  // --- SQ-ADV-002: Advanced CAPA ---------------------------------------------

  app.post(
    "/service-quality/capa/actions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = z
        .object({
          complaintId: z.string().uuid(),
          rcaFindingId: z.string().uuid().nullable().optional(),
          actionType: z.enum(["corrective", "preventive"]),
          title: z.string().trim().min(1).max(200),
          description: z.string().trim().max(4000).nullable().optional(),
          ownerUserId: z.string().uuid().nullable().optional(),
          dueDate: dateOnly.nullable().optional(),
        })
        .parse(request.body);
      const action = await container.serviceQuality.createCapaAction(request.actor!, {
        ...body,
        rcaFindingId: body.rcaFindingId ?? null,
      });
      return reply.status(201).send(action);
    },
  );

  app.get(
    "/service-quality/capa/actions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.serviceQuality.listCapaActions(request.actor!));
    },
  );

  app.get(
    "/service-quality/capa/effectiveness-summary",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(
        await container.serviceQuality.getCapaEffectivenessSummary(request.actor!),
      );
    },
  );

  app.get(
    "/service-quality/complaints/:complaintId/capa/actions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { complaintId } = request.params as { complaintId: string };
      return reply.send(
        await container.serviceQuality.listCapaActionsForComplaint(request.actor!, complaintId),
      );
    },
  );

  app.patch(
    "/service-quality/capa/actions/:id/status",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          status: z.enum([
            "open",
            "in_progress",
            "completed",
            "verified",
            "ineffective",
            "cancelled",
          ]),
          completionNote: z.string().trim().max(4000).optional(),
        })
        .parse(request.body);
      const action = await container.serviceQuality.updateCapaStatus(
        request.actor!,
        id,
        body.status,
        { completionNote: body.completionNote },
      );
      return reply.send(action);
    },
  );

  app.post(
    "/service-quality/capa/actions/:id/verify",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({
          verdict: z.enum(["effective", "ineffective"]),
          note: z.string().trim().max(4000).nullable().optional(),
        })
        .parse(request.body);
      const action = await container.serviceQuality.verifyCapaEffectiveness(
        request.actor!,
        id,
        body,
      );
      return reply.send(action);
    },
  );

  // --- SQ-ADV-003: Recurrence Analytics -------------------------------------

  app.post(
    "/service-quality/recurrence/rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = z
        .object({
          code: z.string().trim().min(1).max(100),
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(2000).nullable().optional(),
          groupBy: z.enum([
            "category",
            "severity",
            "customer",
            "site",
            "service",
            "root_cause",
          ]),
          windowDays: z.number().int().min(1).max(365),
          minimumOccurrences: z.number().int().min(2).max(1000),
          customerId: z.string().uuid().nullable().optional(),
          severityCode: z.string().trim().min(1).max(100).nullable().optional(),
          categoryCode: z.string().trim().min(1).max(100).nullable().optional(),
        })
        .parse(request.body);
      const rule = await container.serviceQuality.createRecurrenceRule(request.actor!, body);
      return reply.status(201).send(rule);
    },
  );

  app.get(
    "/service-quality/recurrence/rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.serviceQuality.listRecurrenceRules(request.actor!));
    },
  );

  app.get(
    "/service-quality/recurrence/rules/:id/detection",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const detection = await container.serviceQuality.detectRecurrenceForRule(request.actor!, id);
      return reply.send(detection);
    },
  );

  // --- SQ-ADV-004: Feedback Automation Proposals ---------------------------

  app.post(
    "/service-quality/automation/rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = z
        .object({
          code: z.string().trim().min(1).max(100),
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(2000).nullable().optional(),
          triggerEvent: z.enum([
            "survey_score_below_threshold",
            "complaint_reopened",
            "sla_resolution_breached",
          ]),
          scoreThreshold: z.number().int().min(1).max(10).nullable().optional(),
          proposedAction: z.enum([
            "reopen_complaint",
            "raise_complaint_severity",
            "create_capa_action",
          ]),
          actionParameters: z.record(z.unknown()).default({}),
        })
        .parse(request.body);
      const rule = await container.serviceQuality.createAutomationRule(request.actor!, body);
      return reply.status(201).send(rule);
    },
  );

  app.get(
    "/service-quality/automation/rules",
    { preHandler: app.authenticate },
    async (request, reply) => {
      return reply.send(await container.serviceQuality.listAutomationRules(request.actor!));
    },
  );

  app.patch(
    "/service-quality/automation/rules/:id/active",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({ isActive: z.boolean() }).parse(request.body);
      const rule = await container.serviceQuality.setAutomationRuleActive(
        request.actor!,
        id,
        body.isActive,
      );
      return reply.send(rule);
    },
  );

  app.get(
    "/service-quality/automation/proposals",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = request.query as { status?: string };
      return reply.send(
        await container.serviceQuality.listProposals(
          request.actor!,
          query.status as import("../../../domain/service-quality/service-quality.entity.js").ProposalStatus | undefined,
        ),
      );
    },
  );

  app.get(
    "/service-quality/automation/proposals/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      return reply.send(await container.serviceQuality.getProposal(request.actor!, id));
    },
  );

  app.post(
    "/service-quality/automation/proposals/:id/approve",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z
        .object({ note: z.string().trim().max(4000).nullable().optional() })
        .parse(request.body ?? {});
      const proposal = await container.serviceQuality.approveProposal(
        request.actor!,
        id,
        body.note ?? null,
      );
      return reply.send(proposal);
    },
  );

  app.post(
    "/service-quality/automation/proposals/:id/reject",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({ note: z.string().trim().min(1).max(4000) }).parse(request.body);
      const proposal = await container.serviceQuality.rejectProposal(
        request.actor!,
        id,
        body.note,
      );
      return reply.send(proposal);
    },
  );
}

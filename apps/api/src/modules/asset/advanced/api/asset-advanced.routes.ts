import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * Asset Advanced HTTP routes (Wave A3).
 *
 * Scope:
 * - AST-ADV-001: Preventive Maintenance Scheduling
 * - AST-ADV-002: Maintenance Work Orders (preventive, corrective, emergency)
 * - AST-ADV-003: Monotonic Meter Readings & Usage Tracking
 * - AST-ADV-004: Spare Parts Consumption
 * - AST-ADV-005: Downtime Tracking
 * - AST-ADV-006 / AST-ADV-007: Reliability Analytics (MTBF/MTTR) & Predictive Snapshots
 */

const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

// --- Schemas ---------------------------------------------------------------

const createScheduleSchema = z.object({
  assetId: z.string().uuid(),
  scheduleCode: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  frequencyType: z.enum(["calendar", "meter"]),
  intervalDays: z.number().int().positive().nullable().optional(),
  meterInterval: z.number().positive().nullable().optional(),
  meterType: z.enum(["hours", "km", "cycles"]).nullable().optional(),
  nextDueDate: z.string().regex(dateOnlyRegex).nullable().optional(),
  nextDueMeter: z.number().positive().nullable().optional(),
});

const createWorkOrderSchema = z.object({
  assetId: z.string().uuid(),
  scheduleId: z.string().uuid().nullable().optional(),
  maintenanceType: z.enum(["preventive", "corrective", "emergency"]),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  costEstimate: z.number().nonnegative().nullable().optional(),
});

const assignWorkOrderSchema = z.object({
  assignedToUserId: z.string().uuid(),
});

const completeWorkOrderSchema = z.object({
  completionNotes: z.string().nullable().optional(),
  actualCost: z.number().nonnegative().nullable().optional(),
  downtimeHours: z.number().nonnegative().nullable().optional(),
  currentMeterReading: z.number().nonnegative().nullable().optional(),
});

const verifyWorkOrderSchema = z.object({
  verificationNotes: z.string().nullable().optional(),
});

const actWorkOrderSchema = z.object({
  actionCode: z.string().min(1),
  comment: z.string().nullable().optional(),
});

const recordPartSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().positive(),
  unitCost: z.number().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const recordMeterSchema = z.object({
  readingType: z.enum(["hours", "km", "cycles"]),
  readingValue: z.number().nonnegative(),
  readingDate: z.string().datetime().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const recordDowntimeSchema = z.object({
  maintenanceWorkOrderId: z.string().uuid().nullable().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().nullable().optional(),
  reasonCategory: z.enum(["breakdown", "scheduled_maintenance", "power_failure", "operator_error", "other"]),
  notes: z.string().nullable().optional(),
});

const closeDowntimeSchema = z.object({
  endTime: z.string().datetime().nullable().optional(),
});

export function registerAssetAdvancedRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.assetAdvanced;

  // --- Maintenance Schedules (AST-ADV-001) -------------------------------

  app.post("/assets/schedules", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createScheduleSchema.parse(request.body);
    return reply.status(201).send(await svc().createMaintenanceSchedule(request.actor!, body));
  });

  app.get("/assets/schedules/due", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { asOfDate?: string };
    return reply.send(await svc().listDueSchedules(request.actor!, query.asOfDate));
  });

  app.get("/assets/schedules", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { assetId?: string };
    return reply.send(await svc().listMaintenanceSchedules(request.actor!, query.assetId));
  });

  app.get("/assets/schedules/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getMaintenanceSchedule(request.actor!, id));
  });

  // --- Maintenance Work Orders (AST-ADV-001/002) -------------------------

  app.post("/assets/work-orders", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createWorkOrderSchema.parse(request.body);
    return reply.status(201).send(await svc().createMaintenanceWorkOrder(request.actor!, body));
  });

  app.get("/assets/work-orders", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as {
      assetId?: string;
      maintenanceType?: "preventive" | "corrective" | "emergency";
      assignedToUserId?: string;
    };
    return reply.send(await svc().listMaintenanceWorkOrders(request.actor!, query));
  });

  app.get("/assets/work-orders/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getMaintenanceWorkOrderDetail(request.actor!, id));
  });

  app.post("/assets/work-orders/:id/assign", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = assignWorkOrderSchema.parse(request.body);
    return reply.send(await svc().assignMaintenanceWorkOrder(request.actor!, id, body.assignedToUserId));
  });

  app.post("/assets/work-orders/:id/start", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().startMaintenanceWorkOrder(request.actor!, id));
  });

  app.post("/assets/work-orders/:id/complete", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = completeWorkOrderSchema.parse(request.body ?? {});
    return reply.send(await svc().completeMaintenanceWorkOrder(request.actor!, id, body));
  });

  app.post("/assets/work-orders/:id/verify", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = verifyWorkOrderSchema.parse(request.body ?? {});
    return reply.send(await svc().verifyMaintenanceWorkOrder(request.actor!, id, body.verificationNotes));
  });

  app.post("/assets/work-orders/:id/act", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = actWorkOrderSchema.parse(request.body);
    return reply.send(
      await svc().actOnMaintenanceWorkOrder(request.actor!, id, body.actionCode, body.comment ?? null),
    );
  });

  // --- Spare Parts (AST-ADV-004) -----------------------------------------

  app.post("/assets/work-orders/:id/parts", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = recordPartSchema.parse(request.body);
    return reply.status(201).send(await svc().recordSparePart(request.actor!, id, body));
  });

  app.get("/assets/work-orders/:id/parts", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().listSpareParts(request.actor!, id));
  });

  // --- Meter Readings (AST-ADV-003) --------------------------------------

  app.post("/assets/:id/meter-readings", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = recordMeterSchema.parse(request.body);
    return reply.status(201).send(await svc().recordMeterReading(request.actor!, id, body));
  });

  app.get("/assets/:id/meter-readings", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { readingType?: "hours" | "km" | "cycles" };
    return reply.send(await svc().listMeterReadings(request.actor!, id, query.readingType));
  });

  // --- Downtime Tracking (AST-ADV-005) ------------------------------------

  app.post("/assets/:id/downtime", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = recordDowntimeSchema.parse(request.body);
    return reply.status(201).send(await svc().recordDowntime(request.actor!, id, body));
  });

  app.post("/assets/downtime/:id/close", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = closeDowntimeSchema.parse(request.body ?? {});
    return reply.send(await svc().closeDowntime(request.actor!, id, body.endTime));
  });

  app.get("/assets/:id/downtime", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().listDowntimeRecords(request.actor!, id));
  });

  // --- Reliability Analytics & Predictive (AST-ADV-006/007) ---------------

  app.get("/assets/:id/reliability", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { periodStart: string; periodEnd: string };
    if (!query.periodStart || !query.periodEnd) {
      return reply.status(400).send({ message: "periodStart and periodEnd query params are required" });
    }
    return reply.send(await svc().calculateReliabilityMetrics(request.actor!, id, query.periodStart, query.periodEnd));
  });

  app.post("/assets/:id/predictive-snapshots", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.status(201).send(await svc().generatePredictiveSnapshot(request.actor!, id));
  });

  app.get("/assets/:id/predictive-snapshots", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { limit?: string };
    const limit = query.limit ? Number(query.limit) : undefined;
    return reply.send(await svc().listPredictiveSnapshots(request.actor!, id, limit));
  });

  app.get("/assets/:id/predictive-snapshots/latest", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getLatestPredictiveSnapshot(request.actor!, id));
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const activityStatusSchema = z.enum(["planned", "in_progress", "completed", "on_hold", "cancelled"]);
const milestoneStatusSchema = z.enum(["pending", "achieved", "missed", "cancelled"]);

const createActivitySchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  activityTypeCode: z.string().nullable().optional(),
  picUserId: z.string().uuid().nullable().optional(),
  picEmployeeId: z.string().uuid().nullable().optional(),
  plannedStartDate: dateSchema.nullable().optional(),
  plannedEndDate: dateSchema.nullable().optional(),
  actualStartDate: dateSchema.nullable().optional(),
  actualEndDate: dateSchema.nullable().optional(),
  status: activityStatusSchema.optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
});

const updateActivitySchema = createActivitySchema.partial();

const createMilestoneSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  milestoneTypeCode: z.string().nullable().optional(),
  plannedDate: dateSchema.nullable().optional(),
  status: milestoneStatusSchema.optional(),
});

const updateMilestoneSchema = createMilestoneSchema.partial().extend({
  achievementNote: z.string().nullable().optional(),
});

/** Project Delivery Core HTTP surface (Phase 8, PRJ-CORE-001…010). */
export function registerProjectDeliveryRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.projectDelivery;

  app.get("/project-delivery/projects", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listProjects(request.actor!));
  });

  app.get("/project-delivery/projects/:projectId", { preHandler: app.authenticate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    return reply.send(await svc().getProjectDelivery(request.actor!, projectId));
  });

  app.post("/project-delivery/projects/:projectId/activities", { preHandler: app.authenticate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    return reply.status(201).send(
      await svc().createActivity(request.actor!, projectId, createActivitySchema.parse(request.body)),
    );
  });

  app.patch("/project-delivery/activities/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().updateActivity(request.actor!, id, updateActivitySchema.parse(request.body)));
  });

  app.post("/project-delivery/projects/:projectId/milestones", { preHandler: app.authenticate }, async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    return reply.status(201).send(
      await svc().createMilestone(request.actor!, projectId, createMilestoneSchema.parse(request.body)),
    );
  });

  app.patch("/project-delivery/milestones/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().updateMilestone(request.actor!, id, updateMilestoneSchema.parse(request.body)));
  });
}

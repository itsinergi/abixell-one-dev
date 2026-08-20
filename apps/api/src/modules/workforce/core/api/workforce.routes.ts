import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * Workforce HTTP surface (Phase 3). Follows the existing API conventions:
 * `app.authenticate` preHandler, zod validation, `request.actor!` for
 * tenant/user context, central error mapping.
 *
 * Deliberately narrow: employees, placement, positions, and the employee's
 * own record. No attendance, leave, payroll, or roster endpoints exist.
 */

const positionSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

const activeSchema = z.object({ isActive: z.boolean() });

const employeeSchema = z.object({
  employeeNumber: z.string().min(1).optional(),
  fullName: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
  employmentStatus: z.string().optional(),
  joinedAt: z.string().nullable().optional(),
  legalEntityId: z.string().uuid().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  positionCode: z.string().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
});

const profileSchema = z.object({
  fullName: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  employmentType: z.string().nullable().optional(),
});

const placementSchema = z.object({
  legalEntityId: z.string().uuid().nullable().optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  positionCode: z.string().nullable().optional(),
  employmentStatus: z.string().optional(),
  effectiveFrom: z.string().optional(),
  note: z.string().nullable().optional(),
});

const userLinkSchema = z.object({ userId: z.string().uuid().nullable() });

export function registerWorkforceRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.workforce;

  // --- Positions (HR-CORE-004) ----------------------------------------

  app.post("/positions", { preHandler: app.authenticate }, async (request, reply) => {
    const body = positionSchema.parse(request.body);
    return reply.status(201).send(await svc().createPosition(request.actor!, body));
  });

  app.get("/positions", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listPositions(request.actor!));
  });

  app.patch("/positions/:code/active", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const { isActive } = activeSchema.parse(request.body);
    return reply.send(await svc().setPositionActive(request.actor!, code, isActive));
  });

  // --- Employees (HR-CORE-001…009) ------------------------------------

  app.post("/employees", { preHandler: app.authenticate }, async (request, reply) => {
    const body = employeeSchema.parse(request.body);
    return reply.status(201).send(await svc().createEmployee(request.actor!, body));
  });

  app.get("/employees", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as { legalEntityId?: string; employmentStatus?: string; search?: string };
    return reply.send(await svc().listEmployees(request.actor!, query));
  });

  /** The signed-in user's own employee record (minimum self-service).
   * Declared before `/:id` so "me" is not captured as an id. */
  app.get("/employees/me", { preHandler: app.authenticate }, async (request, reply) => {
    const record = await svc().getMyEmployeeRecord(request.actor!);
    if (!record) return reply.status(404).send({ error: "No employee record is linked to your account" });
    return reply.send(record);
  });

  app.get("/employees/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getEmployee(request.actor!, id));
  });

  app.patch("/employees/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = profileSchema.parse(request.body);
    return reply.send(await svc().updateEmployeeProfile(request.actor!, id, body));
  });

  /** Placement / employment-status change — always recorded as a new
   * history period (HR-CORE-003/007). */
  app.post("/employees/:id/placement", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = placementSchema.parse(request.body ?? {});
    return reply.send(await svc().changePlacement(request.actor!, id, body));
  });

  app.post("/employees/:id/user-link", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = userLinkSchema.parse(request.body);
    return reply.send(await svc().setEmployeeUserLink(request.actor!, id, userId));
  });
}

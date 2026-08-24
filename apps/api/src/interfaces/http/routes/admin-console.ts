import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const roleCodeParamsSchema = z.object({ roleCode: z.string().min(1) }).strict();
const userParamsSchema = z.object({ userId: z.string().uuid() }).strict();
const assignmentParamsSchema = z
  .object({ userId: z.string().uuid(), assignmentId: z.string().uuid() })
  .strict();

const assignRoleSchema = z.discriminatedUnion("scopeType", [
  z.object({ roleCode: z.string().min(1), scopeType: z.literal("tenant") }).strict(),
  z
    .object({
      roleCode: z.string().min(1),
      scopeType: z.literal("organization_unit"),
      scopeOrganizationUnitId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      roleCode: z.string().min(1),
      scopeType: z.literal("customer"),
      scopeCustomerId: z.string().uuid(),
    })
    .strict(),
]);

/** Business Admin Console routes. Phase 11F adds only governed User Role
 * assignment access; all pre-existing Phase 11C reads remain unchanged. */
export function registerAdminConsoleRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.adminConsole;

  app.get("/admin/overview", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().getOverview(request.actor!));
  });

  app.get("/admin/roles", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listRoles(request.actor!));
  });

  app.get("/admin/permissions", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listPermissions(request.actor!));
  });

  app.get("/admin/modules", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listModules(request.actor!));
  });

  app.get("/admin/workflows", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listWorkflows(request.actor!));
  });

  app.get("/admin/audit/recent", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listRecentAudit(request.actor!));
  });

  // Phase 11F governed access surface: exactly two reads and two writes.
  app.get("/admin/users", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await svc().listUserAccess(request.actor!));
  });

  app.get(
    "/admin/roles/:roleCode/permissions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { roleCode } = roleCodeParamsSchema.parse(request.params);
      return reply.send(await svc().getRolePermissions(request.actor!, roleCode));
    },
  );

  app.post(
    "/admin/users/:userId/role-assignments",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { userId } = userParamsSchema.parse(request.params);
      const body = assignRoleSchema.parse(request.body);
      const assignment = await svc().assignUserRole(request.actor!, userId, body);
      return reply.status(201).send(assignment);
    },
  );

  app.delete(
    "/admin/users/:userId/role-assignments/:assignmentId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { userId, assignmentId } = assignmentParamsSchema.parse(request.params);
      await svc().removeUserRole(request.actor!, userId, assignmentId);
      return reply.status(204).send();
    },
  );
}

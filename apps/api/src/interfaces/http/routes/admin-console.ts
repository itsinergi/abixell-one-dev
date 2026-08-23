import type { FastifyInstance } from "fastify";
import type { Container } from "../../../composition-root.js";

/**
 * Phase 11C — Business Admin Console Foundation.
 *
 * Strictly read-only. Every handler is a passthrough: authorization,
 * tenant scoping, and field selection all live in AdminConsoleService, so
 * this file never hand-rolls a permission check (RbacService convention).
 * No POST/PATCH/PUT/DELETE is declared here by design — Phase 11C adds no
 * mutation surface.
 */
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
}

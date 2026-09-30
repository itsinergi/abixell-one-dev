import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * `/business-partners` — Business Partner CRUD and role management (Epic 6 G1).
 *
 * BP is the canonical party model. These routes expose:
 * - CRUD for Business Partners (individual/organization)
 * - Lifecycle management (activate/deactivate)
 * - Role flags management (employee/customer/vendor/etc.)
 */

const idSchema = z.object({ id: z.string().uuid() });
const roleIdSchema = z.object({
  id: z.string().uuid(),
  roleId: z.string().uuid(),
});

const createSchema = z
  .object({
    code: z.string().trim().min(1),
    bpType: z.enum(["individual", "organization"]),
    name: z.string().trim().min(1),
    bpGroupId: z.string().uuid().nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    bpGroupId: z.string().uuid().nullable().optional(),
  })
  .strict();

const listQuerySchema = z
  .object({
    lifecycleStatus: z.enum(["draft", "active", "inactive", "tombstone", "deleted"]).optional(),
    bpType: z.enum(["individual", "organization"]).optional(),
    search: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const addRoleSchema = z
  .object({
    roleType: z.enum([
      "employee",
      "customer",
      "vendor",
      "service_provider",
      "outsourcing_provider",
      "salesperson",
      "prospect",
    ]),
    roleNumber: z.string().nullable().optional(),
  })
  .strict();

const updateRoleSchema = z
  .object({
    status: z.enum(["active", "inactive"]).optional(),
    roleNumber: z.string().nullable().optional(),
  })
  .strict();

export function registerBusinessPartnerRoutes(
  app: FastifyInstance,
  container: Container,
): void {
  // ── List ────────────────────────────────────────────────────────────
  app.get(
    "/business-partners",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);
      const list = await container.businessPartner.list(request.actor!, query);
      return reply.send(list);
    },
  );

  // ── Get by ID ───────────────────────────────────────────────────────
  app.get(
    "/business-partners/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const bp = await container.businessPartner.getById(request.actor!, id);
      return reply.send(bp);
    },
  );

  // ── Create ──────────────────────────────────────────────────────────
  app.post(
    "/business-partners",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const bp = await container.businessPartner.create(request.actor!, body);
      return reply.status(201).send(bp);
    },
  );

  // ── Update ──────────────────────────────────────────────────────────
  app.patch(
    "/business-partners/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = updateSchema.parse(request.body);
      const bp = await container.businessPartner.update(request.actor!, id, body);
      return reply.send(bp);
    },
  );

  // ── Activate ────────────────────────────────────────────────────────
  app.post(
    "/business-partners/:id/activate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const bp = await container.businessPartner.activate(request.actor!, id);
      return reply.send(bp);
    },
  );

  // ── Deactivate ──────────────────────────────────────────────────────
  app.post(
    "/business-partners/:id/deactivate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const bp = await container.businessPartner.deactivate(request.actor!, id);
      return reply.send(bp);
    },
  );

  // ── Delete (soft) ───────────────────────────────────────────────────
  app.delete(
    "/business-partners/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const bp = await container.businessPartner.remove(request.actor!, id);
      return reply.send(bp);
    },
  );

  // ── List roles ──────────────────────────────────────────────────────
  app.get(
    "/business-partners/:id/roles",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const roles = await container.businessPartner.listRoles(request.actor!, id);
      return reply.send(roles);
    },
  );

  // ── Add role ────────────────────────────────────────────────────────
  app.post(
    "/business-partners/:id/roles",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = addRoleSchema.parse(request.body);
      const role = await container.businessPartner.addRole(request.actor!, id, body);
      return reply.status(201).send(role);
    },
  );

  // ── Update role ─────────────────────────────────────────────────────
  app.patch(
    "/business-partners/:id/roles/:roleId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, roleId } = roleIdSchema.parse(request.params);
      const body = updateRoleSchema.parse(request.body);
      const role = await container.businessPartner.updateRole(request.actor!, id, roleId, body);
      return reply.send(role);
    },
  );

  // ── Remove role ─────────────────────────────────────────────────────
  app.delete(
    "/business-partners/:id/roles/:roleId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, roleId } = roleIdSchema.parse(request.params);
      await container.businessPartner.removeRole(request.actor!, id, roleId);
      return reply.status(204).send();
    },
  );
}
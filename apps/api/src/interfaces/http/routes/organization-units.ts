import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * `/organization-units` — the Organization Unit surface (Epic 5 Gelombang 1).
 *
 * `unitType` is the TENANT-FACING wording, not the stored column: the platform
 * core set (`Central`, `Region`, `Internal Site`) is what the CHECK constraint
 * allows and what security reads, while anything else a tenant calls the unit is
 * kept in `unit_type_label`. That split is why this body still accepts free
 * text: "Site" is a label, not an error.
 */

const createSchema = z.object({
  legalEntityId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  unitType: z.string().optional(),
  timezone: z.string().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1),
  unitType: z.string().min(1).optional(),
  timezone: z.string().nullable().optional(),
});

const statusSchema = z
  .object({
    status: z.enum(["draft", "active", "inactive", "tombstone", "deleted"]),
  })
  .strict();

const idSchema = z.object({ id: z.string().uuid() });

export function registerOrganizationUnitRoutes(app: FastifyInstance, container: Container) {
  app.post("/organization-units", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const actor = request.actor!;
    const unit = await container.organizationUnit.create(actor, body);
    return reply.status(201).send(unit);
  });

  app.get("/organization-units", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const list = await container.organizationUnit.listForTenant(actor);
    return reply.send(list);
  });

  app.patch(
    "/organization-units/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = updateSchema.parse(request.body);
      const unit = await container.organizationUnit.update(request.actor!, id, body);
      return reply.send(unit);
    },
  );

  app.post(
    "/organization-units/:id/activate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const unit = await container.organizationUnit.setActive(request.actor!, id, true);
      return reply.send(unit);
    },
  );

  app.post(
    "/organization-units/:id/deactivate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const unit = await container.organizationUnit.setActive(request.actor!, id, false);
      return reply.send(unit);
    },
  );

  // Lifecycle transition surface, the same shape the Legal Entity uses. The
  // root Central is refused here by the service and again by the database
  // trigger (§4.5 Putaran 4).
  app.post(
    "/organization-units/:id/status",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = statusSchema.parse(request.body);
      const unit = await container.organizationUnit.updateStatus(
        request.actor!,
        id,
        body.status,
      );
      return reply.send(unit);
    },
  );
}

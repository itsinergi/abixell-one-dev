import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * `/legal-entities` — the Legal Entity surface (Epic 5 Gelombang 1).
 *
 * The profile fields (§4.5 Putaran 2) and the lifecycle status are part of the
 * body; the atomically created root Central Organization Unit is NOT
 * addressable here — a client never creates or deletes it, it exists because
 * the Legal Entity does (§4.5 Putaran 4).
 *
 * Addresses are sub-resources of the Legal Entity (§4.5 Putaran 3): their
 * bodies are `.strict()` so an unrecognised key is a 400 rather than a silently
 * ignored field, and the address TYPE is a closed enum matching the CHECK
 * constraint on `legal_entity_addresses`.
 */

const lifecycleStatusSchema = z.enum(["draft", "active", "inactive", "tombstone", "deleted"]);

const createSchema = z.object({
  name: z.string().min(2),
  registrationNo: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2),
  registrationNo: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

const statusSchema = z
  .object({
    status: lifecycleStatusSchema,
  })
  .strict();

const idSchema = z.object({ id: z.string().uuid() });

const addressTypeSchema = z.enum(["registered", "operating", "billing", "tax"]);

const createAddressSchema = z
  .object({
    addressType: addressTypeSchema,
    line1: z.string().trim().min(1),
    line2: z.string().trim().min(1).nullable().optional(),
    city: z.string().trim().min(1).nullable().optional(),
    postalCode: z.string().trim().min(1).nullable().optional(),
    country: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

const updateAddressSchema = z
  .object({
    line1: z.string().trim().min(1).optional(),
    line2: z.string().trim().min(1).nullable().optional(),
    city: z.string().trim().min(1).nullable().optional(),
    postalCode: z.string().trim().min(1).nullable().optional(),
    country: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

const addressParamsSchema = z.object({
  id: z.string().uuid(),
  addressId: z.string().uuid(),
});

export function registerLegalEntityRoutes(app: FastifyInstance, container: Container) {
  app.post("/legal-entities", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const actor = request.actor!;
    const legalEntity = await container.legalEntity.create(actor, body);
    return reply.status(201).send(legalEntity);
  });

  app.get("/legal-entities", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const list = await container.legalEntity.listForTenant(actor);
    return reply.send(list);
  });

  app.patch(
    "/legal-entities/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = updateSchema.parse(request.body);
      const legalEntity = await container.legalEntity.update(request.actor!, id, body);
      return reply.send(legalEntity);
    },
  );

  app.post(
    "/legal-entities/:id/activate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const legalEntity = await container.legalEntity.setActive(request.actor!, id, true);
      return reply.send(legalEntity);
    },
  );

  app.post(
    "/legal-entities/:id/deactivate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const legalEntity = await container.legalEntity.setActive(request.actor!, id, false);
      return reply.send(legalEntity);
    },
  );

  // Lifecycle transition surface (§4.5 Putaran 6). `deactivate` above is the
  // `active → inactive` shorthand; this route is how the other legal moves
  // (`draft → active`, `inactive → tombstone`) are asked for by name.
  app.post(
    "/legal-entities/:id/status",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = statusSchema.parse(request.body);
      const legalEntity = await container.legalEntity.updateStatus(request.actor!, id, body.status);
      return reply.send(legalEntity);
    },
  );

  app.get(
    "/legal-entities/:id/addresses",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const addresses = await container.legalEntity.listAddresses(request.actor!, id);
      return reply.send(addresses);
    },
  );

  app.post(
    "/legal-entities/:id/addresses",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = createAddressSchema.parse(request.body);
      const address = await container.legalEntity.createAddress(request.actor!, id, body);
      return reply.status(201).send(address);
    },
  );

  app.patch(
    "/legal-entities/:id/addresses/:addressId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, addressId } = addressParamsSchema.parse(request.params);
      const body = updateAddressSchema.parse(request.body);
      const address = await container.legalEntity.updateAddress(
        request.actor!,
        id,
        addressId,
        body,
      );
      return reply.send(address);
    },
  );

  app.post(
    "/legal-entities/:id/addresses/:addressId/deactivate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, addressId } = addressParamsSchema.parse(request.params);
      const address = await container.legalEntity.deactivateAddress(
        request.actor!,
        id,
        addressId,
      );
      return reply.send(address);
    },
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createTenantSchema = z.object({
  code: z.string().min(2).max(32),
  name: z.string().min(2),
});

/**
 * `PATCH /tenants/me` — the Tenant's own profile (Epic 5 Gelombang 1
 * §4.5 Putaran 6).
 *
 * `name` stays REQUIRED (the route has always renamed the workspace, and the
 * existing contract keeps that), while the profile fields are all optional: an
 * omitted field is left untouched. `.strict()` is unchanged for the same
 * reason it was there before — a client must not be able to smuggle `code`,
 * `status` or another tenant's id (including the profile columns, which are
 * `_`-prefixed in any other spelling).
 *
 * The defaults a Legal Entity or Organization Unit inherits are validated for
 * SHAPE only: the platform does not own a timezone, locale or ISO 4217
 * catalogue in this wave, and §4.5 keeps currency conversion with Finance — so
 * three uppercase letters is a currency code without pretending to be a
 * validated one (the database CHECK says the same).
 */
const updateTenantProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    defaultTimezone: z.string().trim().min(1).max(64).nullable().optional(),
    defaultLocale: z.string().trim().min(1).max(32).nullable().optional(),
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    contactAdminName: z.string().trim().min(1).max(160).nullable().optional(),
    contactAdminEmail: z.string().trim().email().nullable().optional(),
    contactAdminPhone: z.string().trim().min(1).max(40).nullable().optional(),
  })
  .strict();

export function registerTenantRoutes(app: FastifyInstance, container: Container) {
  // Platform-bootstrap only — see ADR-0004. Not an RBAC-guarded endpoint.
  app.post("/tenants", { preHandler: app.requireBootstrapKey }, async (request, reply) => {
    const body = createTenantSchema.parse(request.body);
    const tenant = await container.tenant.create(body);
    return reply.status(201).send(tenant);
  });

  // Authenticated read of the caller's own Tenant (dedicated-per-client
  // deployment: a user only ever belongs to one Tenant). The profile metadata
  // added by Gelombang 1 is part of this representation.
  app.get("/tenants/me", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    await container.rbac.requirePermission(actor, "tenant.read");
    const tenant = await container.tenant.getById(actor.tenantId);
    return reply.send(tenant);
  });

  app.patch("/tenants/me", { preHandler: app.authenticate }, async (request, reply) => {
    const body = updateTenantProfileSchema.parse(request.body);
    const tenant = await container.tenant.updateName(request.actor!, body);
    return reply.send(tenant);
  });
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * Epic 5 Gelombang 2 (§4.5 steps 10–13) — the structure-change surface.
 *
 * Two resources, split by who acts on them rather than by data shape:
 *
 *   `/organization-units/:id/...`      what an Admin Tenant can do about one
 *                                      unit: propose a change, read its
 *                                      effective-dated history, and (for the
 *                                      Super Admin who holds the permission)
 *                                      tombstone it.
 *   `/organization-unit-change-requests`  the review queue: list proposals and
 *                                      publish or reject them.
 *
 * The permission is what separates the two actors — §4.5 principle 12 ("Proposal
 * bukan publish") — and it is enforced in the service and again inside the
 * publishing transaction. A tenant administrator who can create a request cannot
 * publish it, because `organization_unit.change_request.review` is not part of
 * the create permission.
 */

const changeRequestSchema = z
  .object({
    requestedAction: z.enum(["move", "tombstone"]),
    proposedParentOrganizationUnitId: z.string().uuid().nullable().optional(),
    requestedReplacementOrganizationUnitId: z.string().uuid().nullable().optional(),
    // ISO-8601 with an offset or Z. A bare date is NOT accepted: §4.5 G's
    // reports compare business dates, and a missing zone would silently mean
    // "midnight UTC" for a tenant operating in Asia/Jakarta.
    requestedEffectiveFrom: z.string().datetime({ offset: true }),
    reason: z.string().min(1),
    submitForReview: z.boolean().optional(),
  })
  .strict();

const rejectSchema = z.object({ reviewReason: z.string().min(1) }).strict();

const tombstoneSchema = z
  .object({
    replacementOrganizationUnitId: z.string().uuid().nullable().optional(),
    reason: z.string().min(1),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const idSchema = z.object({ id: z.string().uuid() });

const listQuerySchema = z.object({
  organizationUnitId: z.string().uuid().optional(),
  status: z.enum(["draft", "pending_review", "published", "rejected", "cancelled"]).optional(),
});

const historyQuerySchema = z.object({ at: z.string().datetime({ offset: true }).optional() });

export function registerOrganizationUnitHierarchyRoutes(
  app: FastifyInstance,
  container: Container,
) {
  const hierarchy = container.organizationUnitHierarchy;

  app.post(
    "/organization-units/:id/change-requests",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = changeRequestSchema.parse(request.body);
      const created = await hierarchy.createChangeRequest(request.actor!, {
        organizationUnitId: id,
        requestedAction: body.requestedAction,
        proposedParentOrganizationUnitId: body.proposedParentOrganizationUnitId ?? null,
        requestedReplacementOrganizationUnitId:
          body.requestedReplacementOrganizationUnitId ?? null,
        requestedEffectiveFrom: new Date(body.requestedEffectiveFrom),
        reason: body.reason,
        submitForReview: body.submitForReview,
      });
      return reply.status(201).send(created);
    },
  );

  app.get(
    "/organization-units/:id/change-requests",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const list = await hierarchy.listChangeRequests(request.actor!, {
        organizationUnitId: id,
      });
      return reply.send(list);
    },
  );

  app.get(
    "/organization-units/:id/hierarchy",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const query = historyQuerySchema.parse(request.query);
      const history = await hierarchy.history(
        request.actor!,
        id,
        query.at ? new Date(query.at) : undefined,
      );
      return reply.send(history);
    },
  );

  app.post(
    "/organization-units/:id/tombstone",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = tombstoneSchema.parse(request.body);
      const result = await hierarchy.tombstone(request.actor!, id, {
        replacementOrganizationUnitId: body.replacementOrganizationUnitId ?? null,
        reason: body.reason,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
      });
      return reply.send(result);
    },
  );

  app.get(
    "/organization-unit-change-requests",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);
      const list = await hierarchy.listChangeRequests(request.actor!, query);
      return reply.send(list);
    },
  );

  app.post(
    "/organization-unit-change-requests/:id/publish",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const result = await hierarchy.publishChangeRequest(request.actor!, id);
      return reply.send(result);
    },
  );

  app.post(
    "/organization-unit-change-requests/:id/reject",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = rejectSchema.parse(request.body);
      const rejected = await hierarchy.rejectChangeRequest(request.actor!, id, body.reviewReason);
      return reply.send(rejected);
    },
  );

  app.post(
    "/organization-unit-change-requests/:id/cancel",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const cancelled = await hierarchy.cancelChangeRequest(request.actor!, id);
      return reply.send(cancelled);
    },
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../../composition-root.js";

/**
 * Asset HTTP surface (Phase 5). Follows the existing API conventions:
 * `app.authenticate` preHandler, zod validation, `request.actor!`, central
 * error mapping.
 *
 * Deliberately narrow: register, movement, status, retirement. There is no
 * maintenance, meter, downtime, depreciation, or telemetry endpoint — and
 * no delete endpoint at all, because an asset with history is never
 * destroyed.
 */

const statusValues = ["in_use", "idle", "retired", "disposed"] as const;

const createSchema = z.object({
  name: z.string().min(1),
  assetTag: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  status: z.enum(statusValues).optional(),
  organizationUnitId: z.string().uuid().nullable().optional(),
  custodianEmployeeId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  locationDetail: z.string().nullable().optional(),
  acquisitionReference: z.string().nullable().optional(),
  acquiredAt: z.string().nullable().optional(),
});

/** Descriptive fields only — placement and status move through the ledger. */
const updateSchema = z.object({
  assetTag: z.string().nullable().optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  acquisitionReference: z.string().nullable().optional(),
  acquiredAt: z.string().nullable().optional(),
});

const movementSchema = z.object({
  organizationUnitId: z.string().uuid().nullable().optional(),
  custodianEmployeeId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  locationDetail: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(statusValues),
  reason: z.string().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
});

const retirementSchema = z.object({
  status: z.enum(["retired", "disposed"]).optional(),
  reason: z.string().nullable().optional(),
  effectiveDate: z.string().nullable().optional(),
});

const commentSchema = z.object({ comment: z.string().nullable().optional() });

export function registerAssetRoutes(app: FastifyInstance, container: Container) {
  const svc = () => container.asset;

  // --- Asset register (AST-CORE-001…005, AST-CORE-010) ------------------

  app.post("/assets", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.status(201).send(await svc().createAsset(request.actor!, createSchema.parse(request.body)));
  });

  app.get("/assets", { preHandler: app.authenticate }, async (request, reply) => {
    const query = request.query as {
      search?: string;
      category?: string;
      status?: string;
      organizationUnitId?: string;
      siteId?: string;
      custodianEmployeeId?: string;
      includeTerminal?: string;
    };
    return reply.send(
      await svc().listAssets(request.actor!, {
        search: query.search,
        category: query.category,
        status: query.status,
        organizationUnitId: query.organizationUnitId,
        siteId: query.siteId,
        custodianEmployeeId: query.custodianEmployeeId,
        includeTerminal: query.includeTerminal === "true",
      }),
    );
  });

  app.get("/assets/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().getAsset(request.actor!, id));
  });

  app.patch("/assets/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().updateAsset(request.actor!, id, updateSchema.parse(request.body)));
  });

  // --- Movement, status, retirement (AST-CORE-006/007) ------------------

  app.post("/assets/:id/movements", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.status(201).send(await svc().moveAsset(request.actor!, id, movementSchema.parse(request.body)));
  });

  app.post("/assets/:id/status", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().changeAssetStatus(request.actor!, id, statusSchema.parse(request.body)));
  });

  app.post("/assets/:id/retirement", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await svc().retireAsset(request.actor!, id, retirementSchema.parse(request.body ?? {})));
  });

  // Lifecycle dispatch for a movement awaiting the configured approval.
  app.post(
    "/asset-movements/:movementId/actions/:actionCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { movementId, actionCode } = request.params as { movementId: string; actionCode: string };
      const { comment } = commentSchema.parse(request.body ?? {});
      return reply.send(await svc().actOnMovement(request.actor!, movementId, actionCode, comment ?? null));
    },
  );
}

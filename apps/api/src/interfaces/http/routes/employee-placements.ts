import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const isoDateTime = z.string().datetime({ offset: true });

const idSchema = z.object({ id: z.string().uuid() });
const employeeParamsSchema = z.object({ profileId: z.string().uuid() });

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const activeAtQuerySchema = z
  .object({
    employeeProfileId: z.string().uuid(),
    dateAt: isoDateTime,
  })
  .strict();

const createSchema = z
  .object({
    employeeProfileId: z.string().uuid(),
    placementType: z.enum(["primary", "secondary"]),
    legalEntityId: z.string().uuid(),
    organizationUnitId: z.string().uuid(),
    departmentId: z.string().uuid().nullable().optional(),
    effectiveFrom: isoDateTime,
    effectiveTo: isoDateTime.nullable().optional(),
    reason: z.string().trim().min(1),
  })
  .strict();

const closeSchema = z
  .object({
    effectiveTo: isoDateTime,
  })
  .strict();

export function registerEmployeePlacementRoutes(
  app: FastifyInstance,
  container: Container,
): void {
  app.get(
    "/employees/:profileId/placements",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { profileId } = employeeParamsSchema.parse(request.params);
      const query = listQuerySchema.parse(request.query);

      const placements = await container.employeePlacement.listByEmployee(
        request.actor!,
        profileId,
        { limit: query.limit, offset: query.offset },
      );
      return reply.send(placements);
    },
  );

  app.get(
    "/placements/active-at",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const query = activeAtQuerySchema.parse(request.query);

      const active = await container.employeePlacement.getActiveAtDate(
        request.actor!,
        query.employeeProfileId,
        new Date(query.dateAt),
      );
      return reply.send(active);
    },
  );

  app.get(
    "/placements/:id",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const placement = await container.employeePlacement.getById(request.actor!, id);
      return reply.send(placement);
    },
  );

  app.post(
    "/placements",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const placement = await container.employeePlacement.createPlacement(request.actor!, {
        employeeProfileId: body.employeeProfileId,
        placementType: body.placementType,
        legalEntityId: body.legalEntityId,
        organizationUnitId: body.organizationUnitId,
        departmentId: body.departmentId ?? null,
        effectiveFrom: new Date(body.effectiveFrom),
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
        reason: body.reason,
      });
      return reply.status(201).send(placement);
    },
  );

  app.post(
    "/placements/:id/close",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = closeSchema.parse(request.body);
      const placement = await container.employeePlacement.closePlacement(
        request.actor!,
        id,
        new Date(body.effectiveTo),
      );
      return reply.send(placement);
    },
  );
}

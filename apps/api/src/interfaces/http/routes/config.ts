import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const setModuleActivationSchema = z.object({ isActive: z.boolean() });

const setFeatureFlagSchema = z.object({
  isEnabled: z.boolean(),
  scopeType: z.enum(["tenant", "organization_unit"]).default("tenant"),
  scopeOrganizationUnitId: z.string().uuid().optional(),
});

const setTerminologySchema = z.object({ value: z.string() });

const createReferenceDataItemSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

const createNumberingSequenceSchema = z.object({ pattern: z.string().min(1) });

export function registerConfigurationRoutes(app: FastifyInstance, container: Container) {
  // --- Module Activation ---------------------------------------------------
  app.get("/config/modules", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.configuration.listModuleActivations(request.actor!);
    return reply.send(list);
  });

  app.put(
    "/config/modules/:code",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const body = setModuleActivationSchema.parse(request.body);
      const result = await container.configuration.setModuleActivation(
        request.actor!,
        code,
        body.isActive,
      );
      return reply.send(result);
    },
  );

  // --- Feature Flags -----------------------------------------------------------
  app.get("/config/feature-flags", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.configuration.listFeatureFlags(request.actor!);
    return reply.send(list);
  });

  app.get(
    "/config/feature-flags/effective",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { organizationUnitId } = request.query as { organizationUnitId?: string };
      if (!organizationUnitId) {
        return reply.status(400).send({ error: "organizationUnitId query param is required" });
      }
      const list = await container.configuration.resolveEffectiveFeatureFlags(
        request.actor!,
        organizationUnitId,
      );
      return reply.send(list);
    },
  );

  app.put(
    "/config/feature-flags/:code",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const body = setFeatureFlagSchema.parse(request.body);
      const scope =
        body.scopeType === "organization_unit"
          ? ({
              type: "organization_unit" as const,
              organizationUnitId: body.scopeOrganizationUnitId!,
            })
          : ({ type: "tenant" as const });
      if (body.scopeType === "organization_unit" && !body.scopeOrganizationUnitId) {
        return reply
          .status(400)
          .send({ error: "scopeOrganizationUnitId is required when scopeType is organization_unit" });
      }
      const result = await container.configuration.setFeatureFlag(
        request.actor!,
        code,
        body.isEnabled,
        scope,
      );
      return reply.send(result);
    },
  );

  // --- Terminology ---------------------------------------------------------------
  app.get("/config/terminology", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.configuration.listTerminology(request.actor!);
    return reply.send(list);
  });

  app.put(
    "/config/terminology/:code",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const body = setTerminologySchema.parse(request.body);
      await container.configuration.setTerminologyOverride(request.actor!, code, body.value);
      return reply.status(204).send();
    },
  );

  // --- Reference Data -----------------------------------------------------------
  app.get(
    "/config/reference-data-types",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const list = await container.configuration.listReferenceDataTypes(request.actor!);
      return reply.send(list);
    },
  );

  app.get(
    "/config/reference-data/:typeCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { typeCode } = request.params as { typeCode: string };
      const list = await container.configuration.listReferenceDataItems(
        request.actor!,
        typeCode,
      );
      return reply.send(list);
    },
  );

  app.post(
    "/config/reference-data/:typeCode",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { typeCode } = request.params as { typeCode: string };
      const body = createReferenceDataItemSchema.parse(request.body);
      const created = await container.configuration.createReferenceDataItem(
        request.actor!,
        typeCode,
        body,
      );
      return reply.status(201).send(created);
    },
  );

  // --- Numbering -------------------------------------------------------------
  app.get(
    "/config/numbering/:code",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const seq = await container.configuration.getOrCreateSequenceInfo(request.actor!, code);
      return reply.send(seq);
    },
  );

  app.post(
    "/config/numbering/:code",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const body = createNumberingSequenceSchema.parse(request.body);
      const created = await container.configuration.createNumberingSequence(
        request.actor!,
        code,
        body.pattern,
      );
      return reply.status(201).send(created);
    },
  );

  app.post(
    "/config/numbering/:code/generate",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const result = await container.configuration.generateNumber(request.actor!, code);
      return reply.send(result);
    },
  );
}

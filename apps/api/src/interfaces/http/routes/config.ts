import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";
import { bootstrapKeyMatches } from "../plugins/bootstrap-auth-plugin.js";

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

const setReferenceDataItemActiveSchema = z.object({ isActive: z.boolean() });
const referenceDataItemParamsSchema = z.object({
  typeCode: z.string().min(1),
  itemId: z.string().uuid(),
});

const createNumberingSequenceSchema = z.object({ pattern: z.string().min(1) });

const setParameterValueSchema = z.object({
  level: z.enum(["S", "C", "O"]),
  value: z.unknown(),
  organizationUnitId: z.string().uuid().optional(),
});

export function registerConfigurationRoutes(app: FastifyInstance, container: Container) {
  // --- Module Activation ---------------------------------------------------
  app.get("/config/modules", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.configuration.listModuleActivations(request.actor!);
    return reply.send(list);
  });

  // Epic 3 Wave 3 (§4.3 step 10): only the platform authority — Super Admin,
  // "otoritas platform" (§4.4) — may turn a module on or off. ADR-0004's
  // platform-operator credential is the codebase's representation of that
  // authority; it is layered ON TOP of RBAC here, never instead of it, so the
  // ADR's "no precedent for bypassing RBAC" line still holds. A Tenant Admin
  // holding `config.manage` but not the key gets 401; the key alone without a
  // valid actor gets 401 from `authenticate`.
  app.put(
    "/config/modules/:code",
    { preHandler: [app.authenticate, app.requireBootstrapKey] },
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

  app.patch(
    "/config/reference-data/:typeCode/:itemId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { typeCode, itemId } = referenceDataItemParamsSchema.parse(request.params);
      const { isActive } = setReferenceDataItemActiveSchema.parse(request.body);
      return reply.send(await container.configuration.setReferenceDataItemActive(
        request.actor!, typeCode, itemId, isActive,
      ));
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

  // --- Parameters (Epic 2 Wave 3 bridge) ---------------------------------------
  app.get("/config/parameters", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.configuration.listAppParameters(request.actor!);
    return reply.send(list);
  });

  app.get(
    "/config/parameters/:code/effective",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const { organizationUnitId } = request.query as { organizationUnitId?: string };
      const result = await container.configuration.resolveEffectiveParameter(
        request.actor!,
        code,
        organizationUnitId,
      );
      return reply.send(result);
    },
  );

  // System-level writes need platform authority (same posture as
  // PUT /config/modules/:code), but Client/Organization writes are ordinary
  // authenticated config.manage calls — so the bootstrap-key check is applied
  // here conditionally, only after the body's requested level is known,
  // instead of as a blanket preHandler.
  app.put(
    "/config/parameters/:code/values",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const body = setParameterValueSchema.parse(request.body);
      if (body.value === undefined) {
        return reply.status(400).send({ error: "value is required" });
      }

      let hasPlatformAuthority = false;
      if (body.level === "S") {
        if (!bootstrapKeyMatches(request.headers["x-bootstrap-key"], process.env.PLATFORM_BOOTSTRAP_KEY)) {
          return reply.status(401).send({ error: "Invalid or missing bootstrap key" });
        }
        hasPlatformAuthority = true;
      }

      const result = await container.configuration.setParameterValue(
        request.actor!,
        code,
        { level: body.level, value: body.value, organizationUnitId: body.organizationUnitId },
        hasPlatformAuthority,
      );
      return reply.send(result);
    },
  );
}

/**
 * Application Dictionary routes (kamus aplikasi) — Epic 2 Wave 1.
 *
 * Read endpoints require config.app_dictionary.read; draft/publish
 * endpoints require config.app_dictionary.manage (enforced inside
 * AppMetadataService, not here — this file stays a thin HTTP adapter).
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createWindowSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  moduleCode: z.string().min(1),
  isActive: z.boolean().default(true),
});

const updateWindowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  moduleCode: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

const createTabSchema = z.object({
  windowId: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  sequenceNo: z.number().int().default(10),
  tabType: z.enum(["fields", "cards", "wizard"]),
  isActive: z.boolean().default(true),
});

const ruleConditionSchema = z
  .object({
    field: z.string().min(1),
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "isNull"]),
    value: z.unknown().refine((v) => v !== undefined, "value is required"),
  })
  // Operator-specific value shapes: membership operators take an array,
  // isNull takes a boolean. Every other operator accepts any defined value.
  .superRefine((condition, ctx) => {
    if (condition.operator === "in" || condition.operator === "notIn") {
      if (!Array.isArray(condition.value)) {
        ctx.addIssue({ code: "custom", message: `${condition.operator} requires an array value` });
      }
    }
    if (condition.operator === "isNull" && typeof condition.value !== "boolean") {
      ctx.addIssue({ code: "custom", message: "isNull requires a boolean value" });
    }
  });

const rulesDefinitionSchema = z.object({
  rules: z.array(
    z.object({
      field: z.string().min(1),
      ruleType: z.enum(["mandatory", "readonly", "visible"]),
      conditions: z.object({
        rules: z.array(ruleConditionSchema),
        combinator: z.enum(["AND", "OR"]),
      }),
    }),
  ),
});

export function registerAppMetadataRoutes(app: FastifyInstance, container: Container) {
  // --- Windows (Pages/Routes) ---------------------------------------------
  app.get("/app-metadata/windows", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await container.appMetadata.listWindows(request.actor!));
  });

  app.get(
    "/app-metadata/windows/:windowId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { windowId } = request.params as { windowId: string };
      return reply.send(await container.appMetadata.getWindow(request.actor!, windowId));
    },
  );

  app.post("/app-metadata/windows", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createWindowSchema.parse(request.body);
    // isExternalAllowed is code-only (locked decision); never accepted from the wire.
    const created = await container.appMetadata.createWindow(request.actor!, {
      ...body,
      isExternalAllowed: false,
    });
    return reply.status(201).send(created);
  });

  app.patch(
    "/app-metadata/windows/:windowId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { windowId } = request.params as { windowId: string };
      // LOCKED DECISION: catch isExternalAllowed at wire boundary, before schema parse
      // (zod strip:unknown would remove it silently; explicit check guards intent).
      if ("isExternalAllowed" in (request.body as Record<string, unknown>)) {
        return reply.status(400).send({ error: "Window isExternalAllowed is set in code only; UI edits forbidden" });
      }
      const body = updateWindowSchema.parse(request.body);
      return reply.send(await container.appMetadata.updateWindow(request.actor!, windowId, body));
    },
  );

  // --- Tabs (Sections within a Window) ------------------------------------
  app.get(
    "/app-metadata/windows/:windowId/tabs",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { windowId } = request.params as { windowId: string };
      return reply.send(await container.appMetadata.listTabsByWindow(request.actor!, windowId));
    },
  );

  app.post("/app-metadata/tabs", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createTabSchema.parse(request.body);
    const created = await container.appMetadata.createTab(request.actor!, body);
    return reply.status(201).send(created);
  });

  // --- Tables (Data Entities) & Fields (Columns) --------------------------
  app.get("/app-metadata/tables", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await container.appMetadata.listTables(request.actor!));
  });

  app.get(
    "/app-metadata/tables/:tableId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { tableId } = request.params as { tableId: string };
      return reply.send(await container.appMetadata.getTable(request.actor!, tableId));
    },
  );

  app.get(
    "/app-metadata/tables/:tableId/fields",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { tableId } = request.params as { tableId: string };
      return reply.send(await container.appMetadata.listFieldsByTable(request.actor!, tableId));
    },
  );

  // --- API Resources (HTTP Endpoints) -------------------------------------
  app.get("/app-metadata/api-resources", { preHandler: app.authenticate }, async (request, reply) => {
    return reply.send(await container.appMetadata.listApiResources(request.actor!));
  });

  // --- Field Rules (Versioned Structured Rules) ---------------------------
  app.get(
    "/app-metadata/tables/:tableId/rule-versions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { tableId } = request.params as { tableId: string };
      return reply.send(await container.appMetadata.listRuleVersionsByTable(request.actor!, tableId));
    },
  );

  app.get(
    "/app-metadata/tables/:tableId/rule-versions/current",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { tableId } = request.params as { tableId: string };
      return reply.send(await container.appMetadata.getCurrentRuleVersion(request.actor!, tableId));
    },
  );

  app.post(
    "/app-metadata/tables/:tableId/rule-versions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { tableId } = request.params as { tableId: string };
      const body = rulesDefinitionSchema.parse(request.body);
      const created = await container.appMetadata.createRuleVersion(request.actor!, tableId, body);
      return reply.status(201).send(created);
    },
  );

  app.post(
    "/app-metadata/rule-versions/:versionId/publish",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { versionId } = request.params as { versionId: string };
      return reply.send(await container.appMetadata.publishRuleVersion(request.actor!, versionId));
    },
  );
}

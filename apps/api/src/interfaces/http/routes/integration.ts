import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

const createEndpointSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  direction: z.enum(["outbound", "inbound"]),
  baseUrl: z.string().url().nullable().optional(),
  webhookSecret: z.string().min(8).nullable().optional(),
});

const setActiveSchema = z.object({ isActive: z.boolean() });

export function registerIntegrationRoutes(app: FastifyInstance, container: Container) {
  app.post("/integration/endpoints", { preHandler: app.authenticate }, async (request, reply) => {
    const body = createEndpointSchema.parse(request.body);
    const endpoint = await container.integration.createEndpoint(request.actor!, {
      code: body.code,
      name: body.name,
      direction: body.direction,
      baseUrl: body.baseUrl ?? null,
      webhookSecret: body.webhookSecret ?? null,
    });
    return reply.status(201).send(endpoint);
  });

  app.get("/integration/endpoints", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.integration.listEndpoints(request.actor!);
    return reply.send(list);
  });

  app.post(
    "/integration/endpoints/:code/active",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { code } = request.params as { code: string };
      const body = setActiveSchema.parse(request.body);
      const endpoint = await container.integration.setEndpointActive(request.actor!, code, body.isActive);
      return reply.send(endpoint);
    },
  );

  app.get("/integration/log", { preHandler: app.authenticate }, async (request, reply) => {
    const list = await container.integration.listLog(request.actor!);
    return reply.send(list);
  });

  // --- Inbound webhook receiver -------------------------------------------
  // Encapsulated in its own plugin context so the raw request body (needed
  // to verify the HMAC signature byte-for-byte) can override the JSON
  // content-type parser WITHOUT affecting any other route in the app —
  // Fastify plugin encapsulation makes `addContentTypeParser` here local
  // to this scope only. No `app.authenticate` here on purpose: a webhook
  // caller is an external system with no Abixell One user session: the
  // HMAC signature (not a JWT) IS the authentication for this endpoint.
  app.register(async (scoped) => {
    scoped.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
      done(null, body);
    });

    scoped.post("/integration/webhook/:tenantCode/:endpointCode", async (request, reply) => {
      const { tenantCode, endpointCode } = request.params as { tenantCode: string; endpointCode: string };
      const rawBody = typeof request.body === "string" ? request.body : "";
      const signature = request.headers["x-webhook-signature"];
      const entry = await container.integration.receiveWebhook(
        tenantCode,
        endpointCode,
        rawBody,
        typeof signature === "string" ? signature : undefined,
      );
      return reply.status(202).send({ received: true, logId: entry.id });
    });
  });
}

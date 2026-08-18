import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import { healthRoutes } from "./interfaces/http/routes/health.js";
import { registerAuthDecorators } from "./interfaces/http/plugins/auth-plugin.js";
import { registerBootstrapAuthDecorators } from "./interfaces/http/plugins/bootstrap-auth-plugin.js";
import { registerErrorMapping } from "./interfaces/http/error-mapping.js";
import { registerAuthRoutes } from "./interfaces/http/routes/auth.js";
import { registerTenantRoutes } from "./interfaces/http/routes/tenants.js";
import { registerLegalEntityRoutes } from "./interfaces/http/routes/legal-entities.js";
import { registerOrganizationUnitRoutes } from "./interfaces/http/routes/organization-units.js";
import { registerUserRoutes } from "./interfaces/http/routes/users.js";
import { registerAuditRoutes } from "./interfaces/http/routes/audit.js";
import { registerConfigurationRoutes } from "./interfaces/http/routes/config.js";
import { registerWorkflowRoutes } from "./interfaces/http/routes/workflow.js";
import { registerNotificationRoutes } from "./interfaces/http/routes/notifications.js";
import { registerDocumentRoutes } from "./interfaces/http/routes/documents.js";
import { registerSchedulerRoutes } from "./interfaces/http/routes/scheduler.js";
import { registerIntegrationRoutes } from "./interfaces/http/routes/integration.js";
import { registerObservabilityRoutes } from "./interfaces/http/routes/observability.js";
import { buildContainer } from "./composition-root.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "development" ? "debug" : "info",
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
    },
    // Observability Foundation (Checkpoint 0E): every log line Fastify's
    // built-in pino logger emits is tagged with a per-request `reqId`,
    // so a single request's full log trail (including any error) can be
    // correlated. Reuse an inbound `x-request-id` if the caller already
    // has one (e.g. propagated from an API Gateway/Integration Boundary
    // caller) instead of always minting a fresh one.
    genReqId: (request) => {
      const header = request.headers["x-request-id"];
      return typeof header === "string" && header.length > 0 ? header : randomUUID();
    },
  });

  app.register(cors, { origin: true });
  app.register(sensible);
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  registerAuthDecorators(app);
  registerBootstrapAuthDecorators(app);
  registerErrorMapping(app);

  app.register(healthRoutes);

  const container = buildContainer();
  registerAuthRoutes(app, container);
  registerTenantRoutes(app, container);
  registerLegalEntityRoutes(app, container);
  registerOrganizationUnitRoutes(app, container);
  registerUserRoutes(app, container);
  registerAuditRoutes(app, container);
  registerConfigurationRoutes(app, container);
  registerWorkflowRoutes(app, container);
  registerNotificationRoutes(app, container);
  registerDocumentRoutes(app, container);
  registerSchedulerRoutes(app, container);
  registerIntegrationRoutes(app, container);
  registerObservabilityRoutes(app, container);

  // Scheduler / Background Jobs (Checkpoint 0E): start the in-process
  // interval runner so the registered jobs (e.g. the Workflow Escalation
  // Sweep) actually run automatically while this process is up, not only
  // when manually triggered. Fire-and-forget (its own errors are caught
  // internally and logged, see composition-root.ts) — `buildApp()` stays
  // synchronous so nothing about the existing bootstrap/test setup needs
  // to change to `await` it.
  if (process.env.SCHEDULER_DISABLED !== "true") {
    container.scheduler.start().catch((err) => app.log.error(err, "Scheduler failed to start"));
  }

  return app;
}

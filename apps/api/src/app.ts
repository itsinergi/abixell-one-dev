import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
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
  });

  app.register(cors, { origin: true });
  app.register(sensible);

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

  return app;
}

import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
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
import { registerCustomerRoutes } from "./interfaces/http/routes/customers.js";
import { registerContractRoutes } from "./interfaces/http/routes/contracts.js";
import { registerProjectRoutes } from "./interfaces/http/routes/projects.js";
import { registerSiteRoutes } from "./interfaces/http/routes/sites.js";
import { registerServiceRoutes } from "./interfaces/http/routes/services.js";
import { registerComplaintRoutes } from "./interfaces/http/routes/complaints.js";
import { registerSurveyRoutes } from "./interfaces/http/routes/surveys.js";
import { registerServiceOperationsRoutes } from "./modules/service-operations/core/api/service-operations.routes.js";
import { registerWorkforceRoutes } from "./modules/workforce/core/api/workforce.routes.js";
import { registerSupplyChainRoutes } from "./modules/supply-chain/core/api/supply-chain.routes.js";
import { buildContainer } from "./composition-root.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      // Observability (Checkpoint 0F): `LOG_LEVEL` can override the
      // default per-environment level (e.g. temporarily set `debug` in
      // a staging/pilot deployment to investigate an issue, without a
      // code change or redeploy) — falls back to the pre-0F default
      // (`debug` in development, `info` otherwise) when unset.
      level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "development" ? "debug" : "info"),
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

  // Security hardening (Checkpoint 0F Phase 0 Stabilization): standard
  // HTTP security response headers (X-Content-Type-Options, X-Frame-
  // Options, etc.) via @fastify/helmet. `contentSecurityPolicy: false`
  // because this is a pure JSON API — the frontend is a separately
  // served SPA, not server-rendered HTML from this process, so a CSP
  // header here would be meaningless/misleading rather than protective.
  app.register(helmet, { contentSecurityPolicy: false });

  // CORS stays permissive (`origin: true`, reflects any Origin) for
  // Phase 0: this is a Dedicated Deployment per client (ADR-0003), the
  // API never uses cookies for auth (Bearer tokens only, no CSRF
  // surface), and the pilot client's exact frontend origin is not yet
  // known. Tracked as a Must-Fix-before-pilot item in the Technical
  // Debt Register: replace with an explicit allowlist (`CORS_ORIGIN` env
  // var) once the pilot deployment's real frontend domain is fixed.
  app.register(cors, { origin: true });
  app.register(sensible);
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  // Reliability/Security (Checkpoint 0F): global rate limit as a floor
  // against accidental abuse/retries storms; `/auth/login` gets a much
  // tighter per-route limit below (brute-force credential guessing is
  // the specific risk there — see the route registration). Default
  // raised to 1200/min per IP (~20 req/s sustained) after the
  // Checkpoint 0F performance baseline benchmark (autocannon) was
  // itself throttled by an initial, too-conservative 300/min — that
  // number was picked with no real traffic data behind it. 1200/min is
  // still a floor against runaway clients, not a considered production
  // capacity limit; `RATE_LIMIT_MAX` lets it be tuned per deployment
  // once real pilot usage patterns exist, tracked as a Must-Fix-before-
  // pilot item in the Technical Debt Register (see performance-
  // baseline.md).
  app.register(rateLimit, {
    global: true,
    max: process.env.RATE_LIMIT_MAX ? Number(process.env.RATE_LIMIT_MAX) : 1200,
    timeWindow: "1 minute",
  });

  registerAuthDecorators(app);
  registerBootstrapAuthDecorators(app);
  registerErrorMapping(app);

  const container = buildContainer();

  // Checkpoint 0F fix: every route below is wrapped in a nested
  // `app.register(async ...)` instead of being declared directly on
  // `app` (as it was through Checkpoint 0E). Reason: `fastify.get/post/
  // etc.` add a route IMMEDIATELY/synchronously, bypassing Fastify's
  // avvio boot queue, while `fastify.register(plugin)` calls (helmet,
  // cors, rate-limit above) are queued and only actually execute during
  // `.ready()`. Since @fastify/rate-limit's per-route `config.rateLimit`
  // override works by attaching an `onRoute` hook, that hook must exist
  // BEFORE a route is declared — with unwrapped direct route
  // registration, `/auth/login` was being declared before rate-limit's
  // plugin body had actually run, so its stricter per-route limit was
  // silently never applied (caught by the new phase0-stabilization.test.ts
  // rate-limit test, see decision-log.md). Wrapping every route
  // registration in `app.register(async (scoped) => ...)` puts them in
  // the SAME avvio queue as the plugins above, guaranteeing correct
  // order regardless of whether those plugin `register()` calls above
  // are awaited.
  app.register(async (scoped) => {
    scoped.register(healthRoutes);
    registerAuthRoutes(scoped, container);
    registerTenantRoutes(scoped, container);
    registerLegalEntityRoutes(scoped, container);
    registerOrganizationUnitRoutes(scoped, container);
    registerUserRoutes(scoped, container);
    registerAuditRoutes(scoped, container);
    registerConfigurationRoutes(scoped, container);
    registerWorkflowRoutes(scoped, container);
    registerNotificationRoutes(scoped, container);
    registerDocumentRoutes(scoped, container);
    registerSchedulerRoutes(scoped, container);
    registerIntegrationRoutes(scoped, container);
    registerObservabilityRoutes(scoped, container);
    registerCustomerRoutes(scoped, container);
    registerContractRoutes(scoped, container);
    registerProjectRoutes(scoped, container);
    registerSiteRoutes(scoped, container);
    registerServiceRoutes(scoped, container);
    registerComplaintRoutes(scoped, container);
    registerSurveyRoutes(scoped, container);
    registerServiceOperationsRoutes(scoped, container);
    registerWorkforceRoutes(scoped, container);
    registerSupplyChainRoutes(scoped, container);
  });

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

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
import { registerSurveyAdvancedRoutes } from "./interfaces/http/routes/surveys-advanced.js";
import { registerPublicSurveyRoutes } from "./interfaces/http/routes/public-surveys.js";
import { registerAdminConsoleRoutes } from "./interfaces/http/routes/admin-console.js";
import { registerSalesRoutes } from "./interfaces/http/routes/sales.js";
import { registerServiceQualityRoutes } from "./interfaces/http/routes/service-quality.js";
import { registerServiceOperationsRoutes } from "./modules/service-operations/core/api/service-operations.routes.js";
import { registerWorkforceRoutes } from "./modules/workforce/core/api/workforce.routes.js";
import { registerSupplyChainRoutes } from "./modules/supply-chain/core/api/supply-chain.routes.js";
import { registerAssetRoutes } from "./modules/asset/core/api/asset.routes.js";
import { registerFinanceRoutes } from "./modules/finance/core/api/finance.routes.js";
import { registerHseRoutes } from "./modules/hse/core/api/hse.routes.js";
import { registerProjectDeliveryRoutes } from "./modules/project-delivery/core/api/project-delivery.routes.js";
import { registerReportingInsightRoutes } from "./modules/reporting-insight/core/api/reporting-insight.routes.js";
import { registerReportingAdvancedRoutes } from "./interfaces/http/routes/reporting-advanced.js";
import { buildContainer } from "./composition-root.js";
import { getAllowedCorsOrigins, getGlobalRateLimitConfig, isCorsOriginAllowed } from "./infrastructure/security/http-hardening.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    // Production requests pass through the approved TLS ingress and then the
    // deployment-local Web proxy. The hop count is explicit so per-IP controls
    // use the client address without accepting an unbounded forwarded chain.
    trustProxy:
      process.env.NODE_ENV === "production"
        ? productionProxyHops()
        : false,
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

  // Security hardening (Phase H / PH-2): keep the API-oriented Helmet
  // posture from 0F (standard response headers, no misleading CSP on a JSON
  // API), and add explicit origin restriction for pilot readiness.
  app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  const allowedCorsOrigins = getAllowedCorsOrigins();
  app.register(cors, {
    origin: (origin, cb) => cb(null, isCorsOriginAllowed(origin, allowedCorsOrigins)),
  });
  app.register(sensible);
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  // Reliability/Security (Phase H / PH-2): global rate limit remains a
  // deployment-tunable floor against accidental abuse/retry storms. The
  // legacy RATE_LIMIT_MAX env var is still accepted, while
  // RATE_LIMIT_GLOBAL_MAX / RATE_LIMIT_WINDOW make the pilot posture explicit.
  app.register(rateLimit, {
    global: true,
    ...getGlobalRateLimitConfig(),
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
    registerSurveyAdvancedRoutes(scoped, container);
    registerPublicSurveyRoutes(scoped, container);
    registerServiceOperationsRoutes(scoped, container);
    registerWorkforceRoutes(scoped, container);
    registerSupplyChainRoutes(scoped, container);
    registerAssetRoutes(scoped, container);
    registerFinanceRoutes(scoped, container);
    // Phase 7 — HSE Core
    registerHseRoutes(scoped, container);
    // Phase 8 — Project Delivery Core
    registerProjectDeliveryRoutes(scoped, container);
    // Phase 9 — Reporting & Operational Insight Core
    registerReportingInsightRoutes(scoped, container);
    // Wave A2 / RPT-ADV-001…002 — governed BI and predictive analytics
    registerReportingAdvancedRoutes(scoped, container);
    // Phase 11F — Business Admin Console with governed User Role assignments
    registerAdminConsoleRoutes(scoped, container);
    // Wave A1 / CUS-ADV-001 — sales pipeline, quotation, and pricing
    registerSalesRoutes(scoped, container);
    // Wave A1 / SQ-ADV-001…004 — governed Service Quality Advanced
    registerServiceQualityRoutes(scoped, container);
  });

  // Scheduler ownership is enforced by SchedulerService itself so a disabled
  // replica cannot start timers later through the enable API. Starting here is
  // therefore safe on every process; a disabled owner records no intervals.
  container.scheduler.start().catch((err) =>
    app.log.error(err, "Scheduler failed to start"),
  );

  return app;
}

function productionProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS ?? "2";
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1 || hops > 2) {
    throw new Error("TRUST_PROXY_HOPS must be 1 or 2");
  }
  return hops;
}

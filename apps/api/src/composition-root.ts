import { pool } from "./infrastructure/persistence/db.js";
import { PgTenantRepository } from "./infrastructure/persistence/repositories/tenant.repository.pg.js";
import { PgLegalEntityRepository } from "./infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import { PgOrganizationUnitRepository } from "./infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgUserRepository } from "./infrastructure/persistence/repositories/user.repository.pg.js";
import { PgRbacRepository } from "./infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "./infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { PgConfigurationRepository } from "./infrastructure/persistence/repositories/configuration.repository.pg.js";
import { PgWorkflowRepository } from "./infrastructure/persistence/repositories/workflow.repository.pg.js";
import { PgDomainEventRepository } from "./infrastructure/persistence/repositories/domain-event.repository.pg.js";
import { PgNotificationRepository } from "./infrastructure/persistence/repositories/notification.repository.pg.js";
import { PgDocumentRepository } from "./infrastructure/persistence/repositories/document.repository.pg.js";
import { PgSchedulerRepository } from "./infrastructure/persistence/repositories/scheduler.repository.pg.js";
import { PgIntegrationRepository } from "./infrastructure/persistence/repositories/integration.repository.pg.js";
import {
  PgCustomerContactRepository,
  PgCustomerRepository,
} from "./infrastructure/persistence/repositories/customer.repository.pg.js";
import { PgContractRepository } from "./infrastructure/persistence/repositories/contract.repository.pg.js";
import { PgProjectRepository } from "./infrastructure/persistence/repositories/project.repository.pg.js";
import { PgSiteRepository } from "./infrastructure/persistence/repositories/site.repository.pg.js";
import {
  PgCustomerServiceLinkRepository,
  PgServiceRepository,
} from "./infrastructure/persistence/repositories/service.repository.pg.js";
import { PgComplaintRepository } from "./infrastructure/persistence/repositories/complaint.repository.pg.js";
import { LocalFileStorage } from "./infrastructure/storage/local-file-storage.js";

import { AuditService } from "./application/audit/audit.service.js";
import { RbacService } from "./application/rbac/rbac.service.js";
import { TenantService } from "./application/tenant/tenant.service.js";
import { LegalEntityService } from "./application/legal-entity/legal-entity.service.js";
import { OrganizationUnitService } from "./application/organization-unit/organization-unit.service.js";
import { UserService } from "./application/identity/user.service.js";
import { AuthService } from "./application/identity/auth.service.js";
import { ConfigurationService } from "./application/configuration/configuration.service.js";
import { WorkflowService } from "./application/workflow/workflow.service.js";
import { EventBus } from "./application/event/event-bus.js";
import { NotificationService } from "./application/notification/notification.service.js";
import { DocumentService } from "./application/document/document.service.js";
import { SchedulerService } from "./application/scheduler/scheduler.service.js";
import { registerJobHandlers } from "./application/scheduler/job-handlers.js";
import { IntegrationService } from "./application/integration/integration.service.js";
import { CustomerService } from "./application/customer/customer.service.js";
import { ContractService } from "./application/customer/contract.service.js";
import { ProjectService } from "./application/customer/project.service.js";
import { SiteService } from "./application/customer/site.service.js";
import { ServiceCatalogService } from "./application/customer/service-catalog.service.js";
import { ComplaintService } from "./application/complaint/complaint.service.js";
import { ComplaintDashboardService } from "./application/complaint/complaint-dashboard.service.js";
import { PgComplaintDashboardRepository } from "./infrastructure/persistence/repositories/complaint-dashboard.repository.pg.js";
import { ComplaintConfigurationService } from "./application/complaint/complaint-configuration.service.js";
import { PgSurveyRepository } from "./infrastructure/persistence/repositories/survey.repository.pg.js";
import { SurveyService } from "./application/survey/survey.service.js";
import { SurveyResponseService } from "./application/survey/survey-response.service.js";
import { PgSurveyIntegrationRepository } from "./infrastructure/persistence/repositories/survey-integration.repository.pg.js";
import { SurveyIntegrationService } from "./application/survey-integration/survey-integration.service.js";
import { PgServiceOperationsRepository } from "./modules/service-operations/core/infrastructure/service-operations.repository.pg.js";
import { ServiceOperationsService } from "./modules/service-operations/core/application/service-operations.service.js";
import { PgWorkforceRepository } from "./modules/workforce/core/infrastructure/workforce.repository.pg.js";
import { WorkforceService } from "./modules/workforce/core/application/workforce.service.js";
import type { EntityAuthorizationResolverRegistry } from "./application/document/entity-authorization-resolver.js";

/**
 * Simple manual composition root (no DI framework — deliberate, per
 * anti-overengineering guidance for Phase 0). Every HTTP route resolves
 * its dependencies from here so the interfaces/http layer never talks to
 * `pool` or a `*.pg.ts` repository directly.
 *
 * Checkpoint 0E wiring order matters a little: `EventBus` is built before
 * `WorkflowService` (which publishes into it) and before
 * `NotificationService`/`IntegrationService` (which subscribe to it) —
 * everything downstream of the Event Foundation depends on it, nothing
 * upstream of it depends on any Shared Service.
 */
export function buildContainer() {
  const tenantRepo = new PgTenantRepository(pool);
  const legalEntityRepo = new PgLegalEntityRepository(pool);
  const organizationUnitRepo = new PgOrganizationUnitRepository(pool);
  const userRepo = new PgUserRepository(pool);
  const rbacRepo = new PgRbacRepository(pool);
  const auditRepo = new PgAuditLogRepository(pool);
  const configurationRepo = new PgConfigurationRepository(pool);
  const workflowRepo = new PgWorkflowRepository(pool);
  const domainEventRepo = new PgDomainEventRepository(pool);
  const notificationRepo = new PgNotificationRepository(pool);
  const documentRepo = new PgDocumentRepository(pool);
  const schedulerRepo = new PgSchedulerRepository(pool);
  const integrationRepo = new PgIntegrationRepository(pool);
  const customerRepo = new PgCustomerRepository(pool);
  const customerContactRepo = new PgCustomerContactRepository(pool);
  const contractRepo = new PgContractRepository(pool);
  const projectRepo = new PgProjectRepository(pool);
  const siteRepo = new PgSiteRepository(pool);
  const serviceRepo = new PgServiceRepository(pool);
  const customerServiceLinkRepo = new PgCustomerServiceLinkRepository(pool);
  const complaintRepo = new PgComplaintRepository(pool);

  const audit = new AuditService(auditRepo);
  const rbac = new RbacService(rbacRepo, organizationUnitRepo);
  const configuration = new ConfigurationService(configurationRepo, audit, rbac);

  const eventBus = new EventBus(domainEventRepo, (eventType, error) => {
    console.error(`[EventBus] subscriber for '${eventType}' failed:`, error);
  });

  const workflow = new WorkflowService(workflowRepo, audit, rbac, eventBus);
  const notification = new NotificationService(notificationRepo, rbacRepo, audit, rbac);
  const integration = new IntegrationService(integrationRepo, tenantRepo, eventBus, audit, rbac);

  // Customer Foundation (Checkpoint 1A) — built before DocumentService so
  // its `customer` Entity Authorization Resolver (ADR-0012) can close
  // over `customerService.canAccessForDocument` below.
  const customer = new CustomerService(customerRepo, customerContactRepo, audit, rbac);
  const contract = new ContractService(contractRepo, customer, audit, rbac);
  const project = new ProjectService(projectRepo, customer, audit, rbac);
  const site = new SiteService(siteRepo, customer, audit, rbac);
  const serviceCatalog = new ServiceCatalogService(
    serviceRepo,
    customerServiceLinkRepo,
    customer,
    audit,
    rbac,
  );

  // Generic Customer Complaint Engine (Checkpoint 1B) — built on top of
  // Customer Foundation (1A) + the generic Workflow Engine (0D/0E) +
  // Configuration/Numbering (0C). Built before DocumentService so its
  // own `complaint` Entity Authorization Resolver (ADR-0012 pattern) can
  // close over `complaint.canAccessForDocument` below, same as `customer`.
  const complaint = new ComplaintService(
    complaintRepo,
    customer,
    workflow,
    configuration,
    audit,
    rbac,
    eventBus,
  );

  // Checkpoint 1C.5 — Management Dashboard read-model (aggregate-only,
  // permission-gated + Data-Scope-aware; no new persistence, FD-1C-01).
  const complaintDashboard = new ComplaintDashboardService(
    new PgComplaintDashboardRepository(pool),
    customer,
    rbac,
  );

  // Checkpoint 1C.6 — Complaint Administration surface (gated on
  // complaint.configure; reuses Configuration/Notification/Workflow via
  // trusted-caller reads + audited writes, no new config storage).
  const complaintConfiguration = new ComplaintConfigurationService(
    rbac,
    configuration,
    notification,
    workflow,
  );

  // Phase 2 — Service Operations & Work Management Core. First module built
  // under the frozen target repository architecture
  // (`modules/service-operations/core/...`, blueprint §11A). Constructed
  // before DocumentService so its `work_order` Entity Authorization Resolver
  // can close over `serviceOperations.canAccessForDocument`, exactly as
  // `customer` and `complaint` do (ADR-0012).
  const serviceOperations = new ServiceOperationsService(
    new PgServiceOperationsRepository(pool),
    customer,
    workflow,
    configuration,
    audit,
    rbac,
    eventBus,
  );

  // Phase 3 — Workforce / HR Core. Built before DocumentService so its
  // `employee` Entity Authorization Resolver can close over
  // `workforce.canAccessForDocument` (ADR-0012). Employee documents are
  // gated by a dedicated capability, not by plain workforce.read.
  const workforce = new WorkforceService(
    new PgWorkforceRepository(pool),
    configuration,
    audit,
    rbac,
    eventBus,
  );

  const documentEntityResolvers: EntityAuthorizationResolverRegistry = new Map([
    [
      "customer",
      { canAccess: (actor, entityId) => customer.canAccessForDocument(actor, entityId) },
    ],
    [
      "complaint",
      { canAccess: (actor, entityId) => complaint.canAccessForDocument(actor, entityId) },
    ],
    [
      "work_order",
      { canAccess: (actor, entityId) => serviceOperations.canAccessForDocument(actor, entityId) },
    ],
    [
      "employee",
      { canAccess: (actor, entityId) => workforce.canAccessForDocument(actor, entityId) },
    ],
  ]);
  const document = new DocumentService(
    documentRepo,
    new LocalFileStorage(),
    audit,
    rbac,
    eventBus,
    documentEntityResolvers,
  );

  // Generic Survey & Assessment Engine (Checkpoint 1D.1). Reuses the shared
  // EntityAuthorizationResolver registry so an Assignment's optional context
  // entity (e.g. a Complaint) is authorized without Survey Core knowing that
  // module (ADR-0012). No Complaint/1E integration wired here.
  const surveyRepo = new PgSurveyRepository(pool);
  const survey = new SurveyService(surveyRepo, audit, rbac, eventBus, documentEntityResolvers);
  const surveyResponse = new SurveyResponseService(surveyRepo, audit, rbac, eventBus);

  // Survey Integration orchestrator (Checkpoint 1E.1) — turns a Complaint
  // customer-confirmation into a Survey Assignment WITHOUT coupling the two
  // Cores. It depends on Complaint (read) + Survey (application port) only;
  // neither Core depends on it or on each other (FD-1E §2/§39). Wired as a
  // subscriber below.
  const surveyIntegrationRepo = new PgSurveyIntegrationRepository(pool);
  const surveyIntegration = new SurveyIntegrationService(
    surveyIntegrationRepo,
    survey,
    complaintRepo,
    userRepo,
    rbac,
    audit,
    rbacRepo,
    eventBus,
    (policyCode, error) => console.error(`[SurveyIntegration] policy '${policyCode}' failed:`, error),
  );

  // Any Domain Event, regardless of publisher, reaches both — this is
  // the "modul lain di masa depan tanpa perlu mengubah modul yang
  // mempublikasikan event" guarantee from doc 07, proven with the two
  // concrete subscribers this checkpoint ships.
  eventBus.subscribe("*", (event) => notification.handleDomainEvent(event));
  eventBus.subscribe("*", (event) => integration.handleDomainEvent(event));

  // Checkpoint 1B: re-publish the generic Workflow Engine's
  // `workflow.escalated` event under the Complaint Event Catalog name
  // (`complaint.escalated`, doc section 33) WHEN it belongs to a
  // Complaint — zero changes to the generic engine, zero Complaint-
  // specific code inside it; this is purely a translation subscriber,
  // the same "modul lain tanpa mengubah publisher" pattern as every
  // other subscriber here.
  eventBus.subscribe("workflow.escalated", async (event) => {
    if (event.entityType !== "complaint") return;
    await eventBus.publish({
      tenantId: event.tenantId,
      eventType: "complaint.escalated",
      entityType: "complaint",
      entityId: event.entityId,
      payload: event.payload,
      createdBy: event.createdBy,
    });
  });

  // Checkpoint 1E.1: Complaint customer-confirmation triggers Survey
  // Assignment via the Integration orchestrator. The subscriber only
  // consumes the event; all business logic (policy/respondent/version
  // resolution, idempotency) lives in SurveyIntegrationService, which never
  // throws (a failed integration must not roll back the confirmation).
  eventBus.subscribe("complaint.customer_confirmed", (event) =>
    surveyIntegration.handleTriggerEvent(event),
  );

  // Checkpoint 1E.2: a submitted Survey is evaluated against the policy
  // snapshot taken when it was assigned; a matching outcome raises
  // management attention (notification + execution + audit). NO automatic
  // Complaint reopen and no Workflow mutation — Survey Core stays unaware
  // of Complaint semantics and Complaint Core is never called from here.
  eventBus.subscribe("survey.submitted", (event) => surveyIntegration.handleSurveySubmitted(event));

  const scheduler = new SchedulerService(schedulerRepo, rbac, (jobCode, error) => {
    console.error(`[Scheduler] job '${jobCode}' failed:`, error);
  });
  registerJobHandlers(scheduler, { tenantRepo, workflow });

  return {
    pool,
    audit,
    rbac,
    eventBus,
    scheduler,
    tenant: new TenantService(tenantRepo, audit),
    legalEntity: new LegalEntityService(legalEntityRepo, audit, rbac),
    organizationUnit: new OrganizationUnitService(organizationUnitRepo, audit, rbac, rbacRepo),
    user: new UserService(userRepo, rbacRepo, audit, rbac, customerRepo),
    auth: new AuthService(pool, tenantRepo, userRepo, audit),
    configuration,
    workflow,
    notification,
    document,
    integration,
    customer,
    contract,
    project,
    site,
    serviceCatalog,
    complaint,
    complaintDashboard,
    complaintConfiguration,
    survey,
    surveyResponse,
    surveyIntegration,
    serviceOperations,
    workforce,
  };
}

export type Container = ReturnType<typeof buildContainer>;

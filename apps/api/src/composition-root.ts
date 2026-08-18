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

  const audit = new AuditService(auditRepo);
  const rbac = new RbacService(rbacRepo);

  const eventBus = new EventBus(domainEventRepo, (eventType, error) => {
    console.error(`[EventBus] subscriber for '${eventType}' failed:`, error);
  });

  const workflow = new WorkflowService(workflowRepo, audit, rbac, eventBus);
  const notification = new NotificationService(notificationRepo, rbacRepo, audit, rbac);
  const document = new DocumentService(documentRepo, new LocalFileStorage(), audit, rbac, eventBus);
  const integration = new IntegrationService(integrationRepo, tenantRepo, eventBus, audit, rbac);

  // Any Domain Event, regardless of publisher, reaches both — this is
  // the "modul lain di masa depan tanpa perlu mengubah modul yang
  // mempublikasikan event" guarantee from doc 07, proven with the two
  // concrete subscribers this checkpoint ships.
  eventBus.subscribe("*", (event) => notification.handleDomainEvent(event));
  eventBus.subscribe("*", (event) => integration.handleDomainEvent(event));

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
    user: new UserService(userRepo, rbacRepo, audit, rbac),
    auth: new AuthService(pool, tenantRepo, userRepo, audit),
    configuration: new ConfigurationService(configurationRepo, audit, rbac),
    workflow,
    notification,
    document,
    integration,
  };
}

export type Container = ReturnType<typeof buildContainer>;

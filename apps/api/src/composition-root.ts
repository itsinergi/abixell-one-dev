import { pool } from "./infrastructure/persistence/db.js";
import { PgTenantRepository } from "./infrastructure/persistence/repositories/tenant.repository.pg.js";
import { PgLegalEntityRepository } from "./infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import { PgOrganizationUnitRepository } from "./infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgUserRepository } from "./infrastructure/persistence/repositories/user.repository.pg.js";
import { PgRbacRepository } from "./infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "./infrastructure/persistence/repositories/audit-log.repository.pg.js";

import { AuditService } from "./application/audit/audit.service.js";
import { RbacService } from "./application/rbac/rbac.service.js";
import { TenantService } from "./application/tenant/tenant.service.js";
import { LegalEntityService } from "./application/legal-entity/legal-entity.service.js";
import { OrganizationUnitService } from "./application/organization-unit/organization-unit.service.js";
import { UserService } from "./application/identity/user.service.js";
import { AuthService } from "./application/identity/auth.service.js";

/**
 * Simple manual composition root (no DI framework — deliberate, per
 * anti-overengineering guidance for Phase 0). Every HTTP route resolves
 * its dependencies from here so the interfaces/http layer never talks to
 * `pool` or a `*.pg.ts` repository directly.
 */
export function buildContainer() {
  const tenantRepo = new PgTenantRepository(pool);
  const legalEntityRepo = new PgLegalEntityRepository(pool);
  const organizationUnitRepo = new PgOrganizationUnitRepository(pool);
  const userRepo = new PgUserRepository(pool);
  const rbacRepo = new PgRbacRepository(pool);
  const auditRepo = new PgAuditLogRepository(pool);

  const audit = new AuditService(auditRepo);
  const rbac = new RbacService(rbacRepo);

  return {
    pool,
    audit,
    rbac,
    tenant: new TenantService(tenantRepo, audit),
    legalEntity: new LegalEntityService(legalEntityRepo, audit, rbac),
    organizationUnit: new OrganizationUnitService(organizationUnitRepo, audit, rbac, rbacRepo),
    user: new UserService(userRepo, rbacRepo, audit, rbac),
    auth: new AuthService(pool, tenantRepo, userRepo, audit),
  };
}

export type Container = ReturnType<typeof buildContainer>;

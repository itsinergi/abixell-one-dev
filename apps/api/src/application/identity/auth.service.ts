import type { Pool } from "pg";
import type { TenantRepository } from "../../domain/tenant/tenant.entity.js";
import type { UserRepository } from "../../domain/identity/user.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import { UnauthorizedError } from "../../domain/shared-kernel/errors.js";
import { verifyPassword } from "../../infrastructure/security/password.js";
import { signAccessToken, verifyAccessToken } from "../../infrastructure/security/jwt.js";
import { consumeRefreshToken, issueRefreshToken } from "../../infrastructure/security/refresh-token.js";

export interface LoginInput {
  tenantCode: string;
  email: string;
  password: string;
  ip?: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly tenants: TenantRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const tenant = await this.tenants.findByCode(input.tenantCode);
    if (!tenant) {
      // Every login attempt is recorded, success or failure, per the
      // Audit-First Design (02-Identity-Security-RBAC-Foundation.md).
      await this.audit.record({
        tenantId: null,
        actorUserId: null,
        action: "auth.login.failed",
        entityType: "auth",
        entityId: null,
        metadata: { reason: "unknown_tenant", tenantCode: input.tenantCode, ip: input.ip },
      });
      throw new UnauthorizedError("Invalid tenant, email, or password");
    }

    const user = await this.users.findByEmailInTenant(tenant.id, input.email);
    const passwordOk = user ? await verifyPassword(input.password, user.passwordHash) : false;

    if (!user || !passwordOk) {
      await this.audit.record({
        tenantId: tenant.id,
        actorUserId: user?.id ?? null,
        action: "auth.login.failed",
        entityType: "auth",
        entityId: user?.id ?? null,
        metadata: { reason: "invalid_credentials", email: input.email, ip: input.ip },
      });
      throw new UnauthorizedError("Invalid tenant, email, or password");
    }

    const accessToken = signAccessToken({ sub: user.id, tenantId: tenant.id });
    const refreshToken = await issueRefreshToken(this.pool, user.id);

    await this.audit.record({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "auth.login.success",
      entityType: "auth",
      entityId: user.id,
      metadata: { ip: input.ip },
    });

    return { accessToken, refreshToken, userId: user.id, tenantId: tenant.id };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const consumed = await consumeRefreshToken(this.pool, refreshToken);
    if (!consumed) throw new UnauthorizedError("Invalid or expired refresh token");

    const user = await this.users.findById(consumed.userId);
    if (!user) throw new UnauthorizedError("Invalid or expired refresh token");

    const accessToken = signAccessToken({ sub: user.id, tenantId: user.tenantId });
    const newRefreshToken = await issueRefreshToken(this.pool, user.id);
    return { accessToken, refreshToken: newRefreshToken };
  }

  verifyAccessToken(token: string) {
    return verifyAccessToken(token);
  }
}

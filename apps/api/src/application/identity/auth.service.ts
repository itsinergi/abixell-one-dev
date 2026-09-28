import type { Pool } from "pg";
import type { TenantRepository } from "../../domain/tenant/tenant.entity.js";
import type { UserRepository, UserWithPasswordHash } from "../../domain/identity/user.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import { UnauthorizedError } from "../../domain/shared-kernel/errors.js";
import { verifyPassword } from "../../infrastructure/security/password.js";
import { signAccessToken, verifyAccessToken } from "../../infrastructure/security/jwt.js";
import {
  consumeRefreshToken,
  issueRefreshToken,
  revokeAllRefreshTokensForUser,
  revokeRefreshToken,
} from "../../infrastructure/security/refresh-token.js";
import {
  createSession,
  revokeSession,
  sessionForRefresh,
  switchSessionRole,
  touchSession,
} from "./session.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

/** Email is unique per-tenant only (`users_tenant_email_unique`), never
 * globally, so an email-only login can legitimately match the same address
 * in several tenants. `tenantCode` is therefore still accepted for backward
 * compatibility and explicit targeting; `tenantId` is what the tenant-picker
 * step echoes back once the password has already verified. */
export interface LoginInput {
  tenantCode?: string;
  tenantId?: string;
  email: string;
  password: string;
  ip?: string;
}

export interface LoginSuccess {
  status: "authenticated";
  accessToken: string;
  refreshToken: string;
  userId: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  /** Epic 1 (§4.1 B): the server-side session the access token resolves
   * against. The client echoes it back nowhere — it travels inside the token
   * — but the shell keeps it so "switch role" can name its own session. */
  sessionId: string;
}

/** Returned instead of tokens when the verified email exists in more than
 * one tenant. No credential is issued at this point — the client re-submits
 * the same email+password with the chosen `tenantId`. */
export interface TenantSelectionRequired {
  status: "tenant_selection_required";
  tenants: { tenantId: string; tenantCode: string; tenantName: string }[];
}

export type LoginResult = LoginSuccess | TenantSelectionRequired;

const GENERIC_DENIAL = "Invalid tenant, email, or password";

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly tenants: TenantRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    // Explicit targeting: `tenantCode` (legacy / integration tests) or the
    // `tenantId` echoed back by the tenant-picker step.
    if (input.tenantCode) {
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
        throw new UnauthorizedError(GENERIC_DENIAL);
      }
      return this.loginInTenant(tenant, input);
    }

    if (input.tenantId) {
      const tenant = await this.tenants.findById(input.tenantId);
      // An unverified/foreign tenantId is reported exactly like a bad
      // password — the tenant list was only ever shown to a caller who had
      // already proven the password, so nothing new is leaked either way.
      if (!tenant) throw new UnauthorizedError(GENERIC_DENIAL);
      return this.loginInTenant(tenant, input);
    }

    return this.loginByEmailAcrossTenants(input);
  }

  /** Password-verified login constrained to one tenant. */
  private async loginInTenant(
    tenant: { id: string; code: string; name: string },
    input: LoginInput,
  ): Promise<LoginSuccess> {
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
      throw new UnauthorizedError(GENERIC_DENIAL);
    }

    return this.issueForActiveUser(user, tenant, input.ip);
  }

  /**
   * Tenant-agnostic login: resolve every tenant where this email exists,
   * verify the password against each, and only then reveal — with one
   * faithful result — which of them the caller actually owns. Verifying
   * first is what keeps this from becoming a tenant-enumeration oracle for
   * an attacker who does not know the password.
   */
  private async loginByEmailAcrossTenants(input: LoginInput): Promise<LoginResult> {
    const candidates = await this.users.findCandidatesByEmailAcrossTenants(input.email);

    const verified: typeof candidates = [];
    for (const candidate of candidates) {
      if (await verifyPassword(input.password, candidate.user.passwordHash)) {
        verified.push(candidate);
      }
    }

    if (verified.length === 0) {
      await this.audit.record({
        tenantId: null,
        actorUserId: null,
        action: "auth.login.failed",
        entityType: "auth",
        entityId: null,
        metadata: { reason: "invalid_credentials", email: input.email, ip: input.ip },
      });
      throw new UnauthorizedError(GENERIC_DENIAL);
    }

    if (verified.length > 1) {
      await this.audit.record({
        tenantId: null,
        actorUserId: null,
        action: "auth.login.tenant_selection_required",
        entityType: "auth",
        entityId: null,
        metadata: { email: input.email, candidateCount: verified.length, ip: input.ip },
      });
      return {
        status: "tenant_selection_required",
        tenants: verified.map((c) => ({
          tenantId: c.tenant.id,
          tenantCode: c.tenant.code,
          tenantName: c.tenant.name,
        })),
      };
    }

    return this.issueForActiveUser(verified[0].user, verified[0].tenant, input.ip);
  }

  /** Mints the token pair for a password-verified user, or denies.
   *
   * Inactive-user lifecycle hardening (Phase 11F): an inactive account must
   * never mint a new access/refresh token pair, even with the correct
   * password. Reported identically to a bad password so a caller cannot
   * distinguish "wrong password" from "account deactivated" — only the
   * privacy-safe audit trail records the real reason.
   */
  private async issueForActiveUser(
    user: UserWithPasswordHash,
    tenant: { id: string; code: string; name: string },
    ip?: string,
  ): Promise<LoginSuccess> {
    if (user.status !== "active") {
      await this.audit.record({
        tenantId: tenant.id,
        actorUserId: null,
        action: "auth.login.failed",
        entityType: "auth",
        entityId: null,
        metadata: { reason: "inactive_user", ip },
      });
      throw new UnauthorizedError(GENERIC_DENIAL);
    }

    // Epic 1 (§4.1 B): the session row is created here, and the access token
    // carries only its id. The default active assignment is pinned inside
    // createSession (first row of the picker order), so a user with exactly
    // one Role logs straight into it.
    const sessionId = await createSession(this.pool, {
      userId: user.id,
      tenantId: tenant.id,
      remoteAddr: ip,
    });
    const accessToken = signAccessToken({ sub: user.id, tenantId: tenant.id, sessionId });
    const refreshToken = await issueRefreshToken(this.pool, user.id, sessionId);

    await this.audit.record({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "auth.login.success",
      entityType: "auth",
      entityId: user.id,
      metadata: { ip, sessionId },
    });

    return {
      status: "authenticated",
      accessToken,
      refreshToken,
      userId: user.id,
      tenantId: tenant.id,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      sessionId,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const consumed = await consumeRefreshToken(this.pool, refreshToken);
    if (!consumed) throw new UnauthorizedError("Invalid or expired refresh token");

    const user = await this.users.findById(consumed.userId);

    // Inactive-user lifecycle hardening (Phase 11F): a refresh token minted
    // before deactivation or soft deletion must not survive it. Revoke every
    // other still-active refresh token for this User the moment unavailability
    // is observed, so restoring a soft-deleted account cannot revive a sibling
    // pre-deletion token. The same generic denial covers missing and inactive
    // users without exposing which lifecycle state was encountered.
    if (!user || user.status !== "active") {
      await revokeAllRefreshTokensForUser(this.pool, consumed.userId);
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    // Epic 1 (§4.1 B): the session must still be alive for the token pair to
    // re-mint. A logged-out or admin-revoked session ends the refresh chain
    // even with a valid refresh token, so "sign out" actually signs out on
    // every device that shares the session. A missing `sessionId` means the
    // refresh token predates Epic 1 — hard cutover, same denial.
    const sessionId = consumed.sessionId
      ? await sessionForRefresh(this.pool, {
          sessionId: consumed.sessionId,
          userId: user.id,
        })
      : null;
    if (!sessionId) {
      await revokeAllRefreshTokensForUser(this.pool, consumed.userId);
      throw new UnauthorizedError("Invalid or expired refresh token");
    }
    await touchSession(this.pool, sessionId);

    const accessToken = signAccessToken({ sub: user.id, tenantId: user.tenantId, sessionId });
    const newRefreshToken = await issueRefreshToken(this.pool, user.id, sessionId);
    return { accessToken, refreshToken: newRefreshToken };
  }

  verifyAccessToken(token: string) {
    return verifyAccessToken(token);
  }

  /** Epic 1 (§4.1 E) — switch the session's active Role in place.
   *
   * No re-login and no new token pair: the session row IS the context, so
   * changing it changes what the next request is authorized as. The caller's
   * existing access token stays valid because it carries only `sessionId`.
   *
   * `switchSessionRole` answers "is this assignment mine and currently
   * effective" and writes in one statement, so a revocation racing the switch
   * cannot slip between the check and the update.
   */
  async switchRole(
    actor: ActorContext,
    assignmentId: string,
  ): Promise<ActorContext> {
    return switchSessionRole(this.pool, {
      sessionId: actor.sessionId,
      userId: actor.userId,
      tenantId: actor.tenantId,
      assignmentId,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const sessionInfo = await revokeRefreshToken(this.pool, refreshToken);
    if (sessionInfo?.sessionId) {
      await revokeSession(this.pool, sessionInfo.sessionId);
    }
  }
}

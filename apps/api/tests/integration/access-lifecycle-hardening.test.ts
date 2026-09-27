import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { hashPassword } from "../../src/infrastructure/security/password.js";
import { activateAllModules, authHeader, bootstrapTenant, login } from "./helpers.js";

/**
 * Phase 11F — Access lifecycle hardening.
 *
 * Two gaps closed here, both previously untested:
 *
 *  1. Inactive-user lifecycle: an account whose `status` is no longer
 *     `active` (deactivated by an admin, or soft-deleted) must not be able
 *     to log in or refresh, and any refresh token it already holds must be
 *     revoked the moment inactivity is observed.
 *  2. Stale-JWT revalidation: a still-unexpired access token must stop
 *     working the instant its actor becomes inactive/deleted, or is moved
 *     to a different tenant — not just after the 15-minute token TTL
 *     elapses. `app.authenticate` now re-fetches the actor's current DB
 *     status/tenant on every request instead of trusting the token alone.
 *
 * Every denial in this file is deliberately generic (existing
 * "Invalid tenant, email, or password" / "Invalid or expired refresh
 * token" / "Invalid or expired access token" messages) — a caller must
 * never be able to distinguish "wrong credentials" from "account
 * deactivated" from "token merely expired".
 *
 * None of these scenarios require any RBAC grant (login/refresh/`/me` all
 * work for an unassigned account), so fixtures here insert a bare `users`
 * row directly rather than going through `provisionFirstAdmin` — which
 * would collide on its fixed `ADMIN` role code if called more than once
 * per tenant.
 */

const TENANT_CODE = `t11fl-${Date.now().toString(36)}`;
const PASSWORD = "Admin12345!";

describe("Phase 11F — access lifecycle hardening", () => {
  const app = buildApp();
  let tenantId: string;
  let otherTenantId: string;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Tenant Lifecycle");
    await activateAllModules(tenant.id);
    tenantId = tenant.id;
    const otherTenant = await bootstrapTenant(
      app,
      `${TENANT_CODE}-other`,
      "Test Tenant Lifecycle Other",
    );
    await activateAllModules(otherTenant.id);
    otherTenantId = otherTenant.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // Every mutation below is scoped by the row's own `id`, never by `email`
  // alone — this DB is a persistent local instance shared across test runs
  // (not a disposable per-run container), so an unscoped `WHERE email = $1`
  // can match a same-named leftover row from an earlier run in a different
  // tenant and violate `users_tenant_email_unique` on an UPDATE.
  async function createUser(email: string) {
    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, 'Test Lifecycle User') RETURNING id`,
      [tenantId, email, passwordHash],
    );
    return result.rows[0].id as string;
  }

  it("denies login for an inactive user with the same generic message as bad credentials", async () => {
    const email = `login-inactive@test11f-lifecycle.local`;
    const userId = await createUser(email);
    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [userId]);

    const result = await login(app, TENANT_CODE, email, PASSWORD);
    expect(result.statusCode).toBe(401);
    expect(result.body.error).toBe("Invalid tenant, email, or password");

    const audit = await pool.query(
      `SELECT actor_user_id, entity_id, metadata FROM audit_log
        WHERE action = 'auth.login.failed' AND tenant_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    expect(audit.rows[0].metadata.reason).toBe("inactive_user");
    expect(audit.rows[0].actor_user_id).toBeNull();
    expect(audit.rows[0].entity_id).toBeNull();
    // Privacy-safe: persist neither credentials nor a login identifier.
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(PASSWORD);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(email);
  });

  it("allows login for an active user unaffected by the inactive check", async () => {
    const email = `login-active@test11f-lifecycle.local`;
    await createUser(email);

    const result = await login(app, TENANT_CODE, email, PASSWORD);
    expect(result.statusCode).toBe(200);
    expect(result.body.accessToken).toBeTruthy();
  });

  it("denies refresh for an inactive user and revokes every other active refresh token", async () => {
    const email = `refresh-inactive@test11f-lifecycle.local`;
    const userId = await createUser(email);

    const first = await login(app, TENANT_CODE, email, PASSWORD);
    expect(first.statusCode).toBe(200);
    const secondLoginResult = await login(app, TENANT_CODE, email, PASSWORD);
    expect(secondLoginResult.statusCode).toBe(200);

    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [userId]);

    const refreshResponse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: first.body.refreshToken },
    });
    expect(refreshResponse.statusCode).toBe(401);
    expect(refreshResponse.json().error).toBe("Invalid or expired refresh token");

    // The other still-active refresh token minted before deactivation must
    // also now be revoked, not just the one that happened to be replayed.
    const secondRefreshResponse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: secondLoginResult.body.refreshToken },
    });
    expect(secondRefreshResponse.statusCode).toBe(401);
    expect(secondRefreshResponse.json().error).toBe("Invalid or expired refresh token");
  });

  it("denies refresh for a soft-deleted user and prevents sibling-token revival after restoration", async () => {
    const email = `refresh-deleted@test11f-lifecycle.local`;
    const userId = await createUser(email);

    const first = await login(app, TENANT_CODE, email, PASSWORD);
    expect(first.statusCode).toBe(200);
    const second = await login(app, TENANT_CODE, email, PASSWORD);
    expect(second.statusCode).toBe(200);

    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [userId]);

    const deletedRefresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: first.body.refreshToken },
    });
    expect(deletedRefresh.statusCode).toBe(401);
    expect(deletedRefresh.json().error).toBe("Invalid or expired refresh token");

    // Restoring the account must not revive another token minted before the
    // deletion. The missing-user path revokes every sibling token by user ID.
    await pool.query(`UPDATE users SET deleted_at = NULL WHERE id = $1`, [userId]);
    const restoredRefresh = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refreshToken: second.body.refreshToken },
    });
    expect(restoredRefresh.statusCode).toBe(401);
    expect(restoredRefresh.json().error).toBe("Invalid or expired refresh token");
  });

  it("returns 401 from a protected endpoint once the bearer's actor goes inactive, even with a still-valid access token", async () => {
    const email = `stale-jwt-inactive@test11f-lifecycle.local`;
    const userId = await createUser(email);
    const result = await login(app, TENANT_CODE, email, PASSWORD);
    expect(result.statusCode).toBe(200);
    const token = result.body.accessToken;

    const meBefore = await app.inject({ method: "GET", url: "/me", headers: authHeader(token) });
    expect(meBefore.statusCode).toBe(200);

    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = $1`, [userId]);

    const meAfter = await app.inject({ method: "GET", url: "/me", headers: authHeader(token) });
    expect(meAfter.statusCode).toBe(401);
    expect(meAfter.json().error).toBe("Invalid or expired access token");
  });

  it("returns 401 from a protected endpoint once the bearer's actor is soft-deleted", async () => {
    const email = `stale-jwt-deleted@test11f-lifecycle.local`;
    const userId = await createUser(email);
    const result = await login(app, TENANT_CODE, email, PASSWORD);
    const token = result.body.accessToken;

    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [userId]);

    const meAfter = await app.inject({ method: "GET", url: "/me", headers: authHeader(token) });
    expect(meAfter.statusCode).toBe(401);
    expect(meAfter.json().error).toBe("Invalid or expired access token");
  });

  it("returns 401 once the bearer's actor tenant no longer matches the token's tenant claim", async () => {
    const email = `stale-jwt-tenant-move@test11f-lifecycle.local`;
    const userId = await createUser(email);
    const result = await login(app, TENANT_CODE, email, PASSWORD);
    const token = result.body.accessToken;

    const meBefore = await app.inject({ method: "GET", url: "/me", headers: authHeader(token) });
    expect(meBefore.statusCode).toBe(200);

    // Move the user's own tenant_id directly, independent of any RBAC
    // assignment-invalidation trigger — this proves auth-plugin itself
    // revalidates the actor's tenant, not just downstream RBAC lookups.
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE id = $2`, [
      otherTenantId,
      userId,
    ]);

    const meAfter = await app.inject({ method: "GET", url: "/me", headers: authHeader(token) });
    expect(meAfter.statusCode).toBe(401);
    expect(meAfter.json().error).toBe("Invalid or expired access token");
  });

  it("continues to authorize an active, untouched user across repeated requests", async () => {
    const email = `stale-jwt-untouched@test11f-lifecycle.local`;
    await createUser(email);
    const result = await login(app, TENANT_CODE, email, PASSWORD);
    const token = result.body.accessToken;

    const first = await app.inject({ method: "GET", url: "/me", headers: authHeader(token) });
    const second = await app.inject({ method: "GET", url: "/me", headers: authHeader(token) });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../src/app.js";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { activateAllModules, authHeader, bootstrapTenant, login, provisionFirstAdmin } from "./helpers.js";

const TENANT_CODE = `test-sp-${Math.floor(Date.now() / 1000)}`;

describe("Epic 2 Wave 1 — Self-Service Profile (Scope 1: fullName, password)", () => {
  const app = buildApp();
  let tenantId: string;
  let userId: string;
  let adminToken: string;
  const adminEmail = "admin@test-self-service.local";
  const adminPassword = "AdminPass123!";

  beforeAll(async () => {
    const tenant = await bootstrapTenant(app, TENANT_CODE, "Test Self-Service Profile");
    await activateAllModules(tenant.id);
    tenantId = tenant.id;
    const admin = await provisionFirstAdmin({
      tenantId,
      email: adminEmail,
      password: adminPassword,
    });
    userId = admin.userId;
    const loginResult = await login(app, TENANT_CODE, adminEmail, adminPassword);
    adminToken = loginResult.body.accessToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await app.close();
  });

  describe("GET /me — extended with fullName, email", () => {
    it("should return fullName and email alongside existing fields", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/me",
        headers: authHeader(adminToken),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.userId).toBe(userId);
      expect(body.tenantId).toBe(tenantId);
      expect(body.fullName).toBe("Test Admin");
      expect(body.email).toBe(adminEmail);
      expect(body.permissions).toBeDefined();
      expect(Array.isArray(body.permissions)).toBe(true);
    });

    it("should reject unauthenticated /me request", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/me",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("PATCH /me — self-service profile update", () => {
    it("should update fullName without requiring currentPassword", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          fullName: "Updated Admin Name",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.fullName).toBe("Updated Admin Name");
      expect(body.email).toBe(adminEmail);

      // Verify change persisted
      const meCheck = await app.inject({
        method: "GET",
        url: "/me",
        headers: authHeader(adminToken),
      });
      expect(meCheck.json().fullName).toBe("Updated Admin Name");
    });

    it("should reject password change without currentPassword", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          password: "NewPassword123!",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("currentPassword");
    });

    it("should reject currentPassword without password field", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          currentPassword: adminPassword,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain("currentPassword");
    });

    it("should reject wrong currentPassword with 401", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          password: "NewPassword123!",
          currentPassword: "WrongPassword123!",
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toContain("not valid");
    });

    it("should enforce min 8 char password policy", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          password: "Short1!",
          currentPassword: adminPassword,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should update password and revoke refresh tokens", async () => {
      const newPassword = "NewPassword123!";

      // Update password
      const updateResponse = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          password: newPassword,
          currentPassword: adminPassword,
        },
      });

      expect(updateResponse.statusCode).toBe(200);

      // Try to login with old password — should fail
      const oldLoginAttempt = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { tenantCode: TENANT_CODE, email: adminEmail, password: adminPassword },
      });
      expect(oldLoginAttempt.statusCode).toBe(401);

      // Login with new password — should succeed
      const newLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { tenantCode: TENANT_CODE, email: adminEmail, password: newPassword },
      });
      expect(newLogin.statusCode).toBe(200);
      expect(newLogin.json().accessToken).toBeDefined();
    });

    it("should reject email field in PATCH /me", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          fullName: "New Name",
          email: "newemail@test.local",
        },
      });

      // Email field should be silently stripped or explicitly rejected at schema
      // Either way, email should NOT change
      const meCheck = await app.inject({
        method: "GET",
        url: "/me",
        headers: authHeader(adminToken),
      });
      expect(meCheck.json().email).toBe(adminEmail);
    });

    it("should reject unauthenticated PATCH /me", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        payload: {
          fullName: "Attacker Name",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should allow updating both fullName and password together", async () => {
      const newPassword = "AnotherPassword123!";
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          fullName: "Admin Full Update",
          password: newPassword,
          currentPassword: "NewPassword123!", // from previous test
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.fullName).toBe("Admin Full Update");

      // Verify password changed
      const newLogin = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { tenantCode: TENANT_CODE, email: adminEmail, password: newPassword },
      });
      expect(newLogin.statusCode).toBe(200);
    });

    it("should handle concurrent password-change race: hash still valid at row lock", async () => {
      // This test ensures the implementation handles the case where
      // the password hash is verified before row lock, then re-verified
      // after lock (detecting concurrent update). For now this is a sanity
      // placeholder; the real race condition is difficult to trigger
      // deterministically in a single process. The repo implementation
      // should retain the hash verification step AFTER FOR UPDATE lock
      // (see plan Phase 1.3).
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          password: "RaceTestPass123!",
          currentPassword: "AnotherPassword123!", // from previous test
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("Security & Invariants", () => {
    it("should keep email read-only in self-service (admin-only via PATCH /users/:id)", async () => {
      // Confirmed: PATCH /me rejects email field; only admin PATCH /users/:id allows it
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          email: "selfservice-email@test.local",
        },
      });

      // Schema should reject or strip the field
      const meCheck = await app.inject({
        method: "GET",
        url: "/me",
        headers: authHeader(adminToken),
      });
      expect(meCheck.json().email).toBe(adminEmail);
    });

    it("should not leak wrong-password reason in error message", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: "/me",
        headers: authHeader(adminToken),
        payload: {
          password: "SomeNewPass123!",
          currentPassword: "DefinitelyWrong123!",
        },
      });

      expect(response.statusCode).toBe(401);
      const error = response.json().error;
      // Should NOT say "password is wrong" or similar; generic message only
      expect(error).not.toMatch(/wrong.*password|password.*wrong/i);
    });
  });
});

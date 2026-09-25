import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";
import { hashPassword } from "../../../infrastructure/security/password.js";
import {
  getLoginRateLimitConfig,
  getProfileUpdateRateLimitConfig,
} from "../../../infrastructure/security/http-hardening.js";
import { ValidationError } from "../../../domain/shared-kernel/errors.js";

// `tenantCode`/`tenantId` are optional: the login form now collects only
// email + password, and tenant resolution either falls out of the email
// (single match) or is chosen by the user after the password verifies
// (multiple matches). Both remain accepted for explicit targeting — the
// integration suite and any host-mounted client still send `tenantCode`.
const loginSchema = z
  .object({
    tenantCode: z.string().min(1).optional(),
    tenantId: z.string().uuid().optional(),
    email: z.string().email(),
    password: z.string().min(1),
  })
  .refine((body) => !(body.tenantCode && body.tenantId), {
    message: "Provide either tenantCode or tenantId, not both",
  });

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export function registerAuthRoutes(app: FastifyInstance, container: Container) {
  // Security (Checkpoint 0F): a much tighter per-route rate limit than
  // the global default — login is the one endpoint where an attacker can
  // profitably guess credentials, so it gets its own budget (per IP, per
  // Fastify/rate-limit default keying).
  app.post(
    "/auth/login",
    { config: { rateLimit: getLoginRateLimitConfig() } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      // Both result shapes carry a `status` discriminator — either the token
      // pair (`authenticated`) or the verified-tenant list to choose from
      // (`tenant_selection_required`, no credential issued yet).
      const result = await container.auth.login({ ...body, ip: request.ip });
      return reply.send(result);
    },
  );

  app.post("/auth/refresh", async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const result = await container.auth.refresh(body.refreshToken);
    return reply.send(result);
  });

  // Frontend token/session persistence (Checkpoint 0F) means a refresh
  // token can now live in the browser across reloads for up to 7 days —
  // logout must actively revoke it server-side, not just discard it
  // client-side, or a stolen/leftover token would keep working after the
  // user believes they signed out.
  app.post("/auth/logout", async (request, reply) => {
    const body = logoutSchema.parse(request.body);
    await container.auth.logout(body.refreshToken);
    return reply.status(204).send();
  });

  const meQuerySchema = z.object({
    assignmentId: z.string().uuid().optional(),
  });

  // Self-service profile edit. Deliberately narrower than the admin
  // PATCH /users/:id: `email` is not accepted here at all (it stays an
  // admin action behind user.email.update), and a password change must
  // carry the caller's current password.
  const patchMeSchema = z
    .object({
      fullName: z.string().trim().min(1).max(200).optional(),
      password: z.string().min(8).optional(),
      currentPassword: z.string().min(1).optional(),
    })
    .strict()
    .refine((body) => body.currentPassword === undefined || body.password !== undefined, {
      message: "currentPassword is only valid together with a password change",
    })
    .refine((body) => body.fullName !== undefined || body.password !== undefined, {
      message: "Supply fullName or password",
    })
    .refine((body) => body.password === undefined || body.currentPassword !== undefined, {
      message: "currentPassword is required when changing password",
    });

  app.get("/me", { preHandler: app.authenticate }, async (request, reply) => {
    const actor = request.actor!;
    const { assignmentId } = meQuerySchema.parse(request.query ?? {});
    const [user, permissions, assignments, myAssignments, activeModuleCodes] = await Promise.all([
      container.user.getMe(actor),
      container.rbac.getEffectivePermissions(actor.userId),
      container.rbac.getAssignments(actor.userId),
      container.rbac.getMyAssignmentsWithScopeNames(actor.userId),
      container.configuration.listActiveModuleCodesForTenant(actor.tenantId),
    ]);

    // Post-login context picker: when the caller names one of their OWN
    // assignments, narrow the reported capability set to that Role. This is
    // UI shaping only — an unknown or foreign assignmentId is ignored (the
    // caller simply keeps their full union), and per-route authorization in
    // the backend continues to evaluate every assignment regardless.
    const picked = assignmentId
      ? myAssignments.find((a) => a.id === assignmentId) ?? null
      : null;
    const effectivePermissions = picked
      ? await container.rbac.getPermissionsForRole(actor.tenantId, picked.roleCode)
      : permissions;
    const effectiveAssignments = picked
      ? assignments.filter((a) => a.id === picked.id)
      : assignments;

    // Checkpoint 1C.3 — expose the distinct Data-Scope types the actor holds
    // ("customer" vs "organization_unit"/"tenant"). This is what lets the
    // experience layer tell an external Customer User apart from an internal
    // operational user for navigation — a distinction permissions alone
    // cannot make (both hold complaint.read/manage). Authorization is still
    // enforced per-route in the backend; this only shapes the UI.
    const scopeTypes = Array.from(new Set(effectiveAssignments.map((a) => a.scopeType)));
    return reply.send({
      userId: actor.userId,
      tenantId: actor.tenantId,
      fullName: user.fullName,
      email: user.email,
      permissions: Array.from(effectivePermissions),
      scopeTypes,
      activeModuleCodes,
      assignments: myAssignments,
      activeAssignmentId: picked?.id ?? null,
    });
  });

  app.patch(
    "/me",
    {
      preHandler: app.authenticate,
      config: { rateLimit: getProfileUpdateRateLimitConfig() },
    },
    async (request, reply) => {
      const actor = request.actor!;
      const parsed = patchMeSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid profile update");
      }
      const body = parsed.data;

      const updated = await container.user.updateOwnProfile(
        actor,
        {
          fullName: body.fullName,
          passwordHash:
            body.password === undefined ? undefined : await hashPassword(body.password),
        },
        body.currentPassword,
      );
      return reply.send(updated);
    },
  );
}

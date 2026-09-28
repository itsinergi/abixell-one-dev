import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "../../../infrastructure/security/jwt.js";
import { pool } from "../../../infrastructure/persistence/db.js";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import {
  resolveActor,
  touchSession,
} from "../../../application/identity/session.service.js";

declare module "fastify" {
  interface FastifyRequest {
    actor?: ActorContext;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const INVALID_TOKEN_RESPONSE = { error: "Invalid or expired access token" } as const;

/**
 * Verifies the JWT access token and attaches `request.actor`. This is the
 * ONLY place a token is trusted; every route that needs an authenticated
 * user calls `app.authenticate` as a preHandler — there is no route that
 * infers identity from anything the client sends unverified.
 *
 * Registered directly on the top-level Fastify instance (not via
 * `app.register`) so the `authenticate` decorator is visible to every
 * sibling route module without fighting Fastify's plugin encapsulation.
 */
export function registerAuthDecorators(app: FastifyInstance): void {
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing bearer token" });
    }
    const token = header.slice("Bearer ".length);
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return reply.status(401).send(INVALID_TOKEN_RESPONSE);
    }

    // Epic 1 (§4.1 F) hard cutover: a token minted before sessions existed
    // carries no `sessionId`, and there is no transition window for it. Every
    // user re-logs in once; after that the active Role is always resolvable.
    if (!payload.sessionId) {
      return reply.status(401).send(INVALID_TOKEN_RESPONSE);
    }

    // Stale-JWT lifecycle hardening (Phase 11F), now extended to the session:
    // a valid signature is necessary but not sufficient. Re-resolve the actor
    // on every request so a deactivated/deleted/tenant-moved account — and a
    // revoked session or a revoked active assignment — loses access
    // immediately rather than surviving until the 15-minute token expires
    // (same precedent as jwt.ts: permissions are intentionally never trusted
    // from the token itself, only re-checked against the current DB state).
    // A single generic 401 covers every failure mode — deleted, inactive,
    // tenant mismatch, revoked session — so a caller cannot distinguish them.
    //
    // An assignment that is merely no longer effective is NOT a 401: the actor
    // still authenticates with `assignmentId: null`, and permissioned routes
    // answer 403. That keeps "your Role was revoked" actionable, where an
    // "invalid token" would send the user to re-login for nothing.
    const actor = await resolveActor(pool, {
      sessionId: payload.sessionId,
      userId: payload.sub,
      tenantId: payload.tenantId,
    });
    if (!actor) {
      return reply.status(401).send(INVALID_TOKEN_RESPONSE);
    }

    request.actor = actor;

    // Fire-and-forget: a lost `last_seen_at` update is not worth failing an
    // authenticated request over, and awaiting it would add a write to every
    // read.
    void touchSession(pool, actor.sessionId).catch(() => {});
  });
}

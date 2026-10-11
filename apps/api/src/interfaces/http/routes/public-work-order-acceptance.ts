import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/** WP-OPS-01 Phase 6 — Public Authless Work Order Acceptance Link Surface.
 * Customer receives a token link (raw token delivered once), can accept/reject
 * at their own pace, no login needed. Token is 256-bit entropy, SHA256 hashed
 * at rest, single-use. Mirrors public-surveys.ts (survey-public.service.ts). */

const acceptCommentSchema = z.object({
  comment: z.string().max(2000).nullable().optional(),
});

const rejectReasonSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export function registerPublicWorkOrderAcceptanceRoutes(
  app: FastifyInstance,
  container: Container,
) {
  // Minimal summary: what the link holder needs to see.
  app.get("/public/work-orders/acceptance/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const summary = await container.serviceOperations.getAcceptanceSummary(token);
    return reply.send(summary);
  });

  app.post("/public/work-orders/acceptance/:token/accept", async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = acceptCommentSchema.parse(request.body ?? {});
    const result = await container.serviceOperations.acceptViaToken(token, body.comment ?? null);
    return reply.status(200).send(result);
  });

  app.post("/public/work-orders/acceptance/:token/reject", async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = rejectReasonSchema.parse(request.body ?? {});
    const result = await container.serviceOperations.rejectViaToken(token, body.reason);
    return reply.status(200).send(result);
  });
}

import type { FastifyInstance } from "fastify";
import { checkDatabaseConnection } from "../../../infrastructure/persistence/db.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    service: "abixell-one-api",
    release: process.env.APPLICATION_RELEASE ?? null,
    checkpoint: "0F",
    // Observability (Checkpoint 0F): process uptime, so a monitoring
    // probe or a Founder checking a deployment can tell "just started"
    // (possible crash-loop) apart from "been running fine for days"
    // without needing log access.
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get("/health/db", async (_req, reply) => {
    const ok = await checkDatabaseConnection();
    if (!ok) {
      return reply.status(503).send({ status: "error", database: "unreachable" });
    }
    return { status: "ok", database: "connected" };
  });
}

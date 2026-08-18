import type { FastifyInstance } from "fastify";
import { checkDatabaseConnection } from "../../../infrastructure/persistence/db.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({
    status: "ok",
    service: "abixell-one-api",
    checkpoint: "0A",
  }));

  app.get("/health/db", async (_req, reply) => {
    const ok = await checkDatabaseConnection();
    if (!ok) {
      return reply.status(503).send({ status: "error", database: "unreachable" });
    }
    return { status: "ok", database: "connected" };
  });
}

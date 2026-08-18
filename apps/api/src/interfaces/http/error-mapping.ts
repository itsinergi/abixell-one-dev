import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../domain/shared-kernel/errors.js";

/**
 * Single place that maps domain errors to HTTP status codes, so every
 * application-layer error (ForbiddenError above all — this is where real
 * authorization enforcement becomes an actual HTTP 403, not a hidden
 * frontend button) is handled consistently across all routes.
 */
export function registerErrorMapping(app: FastifyInstance): void {
  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof NotFoundError) {
      return reply.status(404).send({ error: error.message });
    }
    if (error instanceof ConflictError) {
      return reply.status(409).send({ error: error.message });
    }
    if (error instanceof ForbiddenError) {
      return reply.status(403).send({ error: error.message });
    }
    if (error instanceof UnauthorizedError) {
      return reply.status(401).send({ error: error.message });
    }
    if (error instanceof ValidationError) {
      return reply.status(400).send({ error: error.message, details: error.details });
    }
    if ("validation" in error && error.validation) {
      return reply.status(400).send({ error: error.message });
    }
    if (error instanceof z.ZodError) {
      return reply.status(400).send({ error: "Validation failed", details: error.issues });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  });
}

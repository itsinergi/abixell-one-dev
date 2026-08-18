import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";
import { ValidationError } from "../../../domain/shared-kernel/errors.js";

const listQuerySchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
});

/**
 * Document/File Service routes. Upload uses `@fastify/multipart`
 * (registered in app.ts) so the file bytes, `entityType`, and `entityId`
 * arrive in one multipart/form-data request — the polymorphic reference
 * a Document attaches to is caller-supplied, same as Workflow Instance's
 * `entityId` in 0D.
 */
export function registerDocumentRoutes(app: FastifyInstance, container: Container) {
  app.post("/documents", { preHandler: app.authenticate }, async (request, reply) => {
    const data = await request.file();
    if (!data) throw new ValidationError("No file uploaded (expected multipart/form-data with a 'file' part)");

    const entityType = firstFieldValue(data.fields.entityType);
    const entityId = firstFieldValue(data.fields.entityId);
    if (!entityType || !entityId) {
      throw new ValidationError("Multipart fields 'entityType' and 'entityId' are required alongside the file");
    }

    const buffer = await data.toBuffer();
    const doc = await container.document.upload(request.actor!, {
      entityType,
      entityId,
      fileName: data.filename,
      mimeType: data.mimetype,
      buffer,
    });
    return reply.status(201).send(doc);
  });

  app.get("/documents", { preHandler: app.authenticate }, async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const list = await container.document.listByEntity(request.actor!, query.entityType, query.entityId);
    return reply.send(list);
  });

  app.get("/documents/:id/download", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { doc, buffer } = await container.document.download(request.actor!, id);
    reply.header("Content-Type", doc.mimeType);
    reply.header("Content-Disposition", `attachment; filename="${doc.fileName}"`);
    return reply.send(buffer);
  });

  app.delete("/documents/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const doc = await container.document.delete(request.actor!, id);
    return reply.send(doc);
  });
}

function firstFieldValue(field: unknown): string | null {
  if (!field) return null;
  const candidate = Array.isArray(field) ? field[0] : field;
  if (candidate && typeof candidate === "object" && "value" in candidate) {
    return String((candidate as { value: unknown }).value);
  }
  return null;
}

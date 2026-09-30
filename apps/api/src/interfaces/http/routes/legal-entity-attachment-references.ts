import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../../composition-root.js";

/**
 * `/legal-entities/:id/attachment-references` — metadata-only attachment
 * reference slot for Legal Entity legal documents (Epic 5 G4, §4.5 step 18).
 *
 * No file bytes, no upload, no download. This surface records the existence
 * and classification of a legal document reference: its category (AKTA, NIB,
 * NPWP, DOMISILI…), a free-form reference pointer, an optional expiry date,
 * and a lifecycle status (`active` / `expired` / `superseded`).
 *
 * Superseding a reference is a status update, never a hard delete — the
 * reference an old document cited keeps resolving (§4.5 principle 6).
 */

const idSchema = z.object({ id: z.string().uuid() });
const referenceIdSchema = z.object({
  id: z.string().uuid(),
  referenceId: z.string().uuid(),
});

const createSchema = z
  .object({
    documentCategory: z.string().trim().min(1),
    attachmentReference: z.string().trim().min(1),
    expiryDate: z.string().nullable().optional(),
  })
  .strict();

const updateSchema = z
  .object({
    status: z.enum(["active", "expired", "superseded"]).optional(),
    expiryDate: z.string().nullable().optional(),
  })
  .strict();

export function registerLegalEntityAttachmentReferenceRoutes(
  app: FastifyInstance,
  container: Container,
) {
  app.get(
    "/legal-entities/:id/attachment-references",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const list = await container.legalEntityAttachmentReference.listForLegalEntity(
        request.actor!,
        id,
      );
      return reply.send(list);
    },
  );

  app.post(
    "/legal-entities/:id/attachment-references",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = idSchema.parse(request.params);
      const body = createSchema.parse(request.body);
      const ref = await container.legalEntityAttachmentReference.create(
        request.actor!,
        id,
        {
          ...body,
          expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        },
      );
      return reply.status(201).send(ref);
    },
  );

  app.patch(
    "/legal-entities/:id/attachment-references/:referenceId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id, referenceId } = referenceIdSchema.parse(request.params);
      const body = updateSchema.parse(request.body);
      const ref = await container.legalEntityAttachmentReference.update(
        request.actor!,
        id,
        referenceId,
        {
          ...body,
          expiryDate: body.expiryDate !== undefined
            ? body.expiryDate ? new Date(body.expiryDate) : null
            : undefined,
        },
      );
      return reply.send(ref);
    },
  );
}
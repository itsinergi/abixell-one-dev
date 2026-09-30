import type { ActorContext } from "../shared-kernel/audit-context.js";

/**
 * Epic 5 Gelombang 4 (§4.5 step 18) — Legal Entity attachment reference metadata.
 *
 * Metadata-only slot for legal document references (AKTA, NIB, NPWP, DOMISILI,
 * etc.) owned by a Legal Entity. No file bytes, no object storage, no upload
 * endpoints — the document/file epic owns those. This entity records what
 * document exists, its category, a human-readable reference pointer, an optional
 * expiry date, and a lifecycle status.
 *
 * The reference string (`attachmentReference`) is deliberately free-form: it may
 * be an external URL, a document code, or a future storage key. Validation of
 * the reference format is deferred to the document/file epic.
 *
 * Ownership follows §4.5 principle 2: the composite FK
 * `(tenant_id, legal_entity_id) → legal_entities(tenant_id, id)` makes a
 * cross-tenant row unrepresentable. The repository states the same rule one
 * layer up so the failure is a `NotFoundError` rather than a constraint
 * violation.
 */

export type AttachmentReferenceStatus = "active" | "expired" | "superseded";

export const ATTACHMENT_REFERENCE_STATUSES: readonly AttachmentReferenceStatus[] = [
  "active",
  "expired",
  "superseded",
];

export interface LegalEntityAttachmentReference {
  id: string;
  tenantId: string;
  legalEntityId: string;
  documentCategory: string;
  attachmentReference: string;
  expiryDate: Date | null;
  status: AttachmentReferenceStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface CreateAttachmentReferenceInput {
  documentCategory: string;
  attachmentReference: string;
  expiryDate?: Date | null;
}

export interface UpdateAttachmentReferenceInput {
  status?: AttachmentReferenceStatus;
  expiryDate?: Date | null;
}

export interface LegalEntityAttachmentReferenceRepository {
  listByLegalEntity(
    tenantId: string,
    legalEntityId: string,
  ): Promise<LegalEntityAttachmentReference[]>;

  findById(
    tenantId: string,
    legalEntityId: string,
    id: string,
  ): Promise<LegalEntityAttachmentReference | null>;

  create(
    tenantId: string,
    legalEntityId: string,
    input: CreateAttachmentReferenceInput,
    actor: ActorContext,
  ): Promise<LegalEntityAttachmentReference>;

  update(
    tenantId: string,
    legalEntityId: string,
    id: string,
    input: UpdateAttachmentReferenceInput,
    actor: ActorContext,
  ): Promise<LegalEntityAttachmentReference>;
}
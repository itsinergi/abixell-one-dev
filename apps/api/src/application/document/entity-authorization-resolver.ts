/**
 * Entity Authorization Resolver (Checkpoint 1A / ADR-0012).
 *
 * Binding decision: "Document/Attachment mengikuti authorization dan Data
 * Scope dari parent entity ... Attachment tidak memiliki independent
 * business authorization yang terpisah dari parent business entity."
 *
 * The Document Service (Checkpoint 0E) is deliberately entity-agnostic —
 * it only knows a Document points at (entityType, entityId). It cannot
 * itself know how to check "does this actor have access to Complaint
 * #123" without depending on a Complaint module, which would break that
 * agnosticism. This interface is the seam: a business module registers a
 * resolver for its entityType, and DocumentService looks it up at
 * request time instead of hard-coding a permission check. Nothing about
 * `DocumentRepository`'s polymorphic shape changes.
 *
 * When no resolver is registered for a given entityType, DocumentService
 * falls back to the Checkpoint 0E behavior (Tenant-wide `document.read`/
 * `document.manage` permission) — this keeps `demo_transaction` (the only
 * entityType Phase 0's regression suite exercises) working unchanged,
 * and lets a future business module (Complaint, Survey) opt in the same
 * way Customer did here, one `resolvers.set(entityType, resolver)` call
 * in the composition root.
 */
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

export interface EntityAuthorizationResolver {
  /** Returns true iff `actor` may read/manage the Document's parent
   * entity — Data Scope only, no separate permission axis (per the
   * binding decision above). Should not throw for an ordinary "not
   * authorized" outcome; return false instead (DocumentService maps a
   * false into a ForbiddenError with a document-appropriate message).
   *
   * Epic 1 (§4.1 C): the full session-resolved ActorContext, so module
   * resolvers read the ACTIVE assignment like every other scope check. */
  canAccess(actor: ActorContext, entityId: string): Promise<boolean>;
}

export type EntityAuthorizationResolverRegistry = Map<string, EntityAuthorizationResolver>;

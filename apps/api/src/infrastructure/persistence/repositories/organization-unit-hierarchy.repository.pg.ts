import type { Pool, PoolClient } from "pg";
import type { ActorContext } from "../../../domain/shared-kernel/audit-context.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../../domain/shared-kernel/errors.js";
import type {
  ChangeRequestStatus,
  CreateChangeRequestInput,
  HierarchyHistoryEntry,
  OrganizationUnitChangeRequest,
  OrganizationUnitHierarchyRepository,
  PublishResult,
  ReferenceHit,
  TombstoneInput,
  TombstoneResult,
} from "../../../domain/organization-unit/organization-unit-hierarchy.entity.js";
import {
  CHANGE_REQUEST_ACTIONS,
  CHANGE_REQUEST_STATUSES,
  ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS,
  PUBLISHABLE_CHANGE_REQUEST_STATUSES,
} from "../../../domain/organization-unit/organization-unit-hierarchy.entity.js";
import type { LifecycleStatus } from "../../../domain/legal-entity/legal-entity.entity.js";
import {
  inGovernedTransaction,
  recordGovernedAudit,
  requireTransactionActorPermission,
} from "./governed-transaction.js";

/**
 * Epic 5 Gelombang 2 — effective-dated hierarchy history, change requests,
 * publish/reject and the tombstone flow.
 *
 * The rules this file enforces are §4.5's structure limits, stated where they
 * can lock a row and be audited:
 *
 *   - "Satu Legal Entity selalu memiliki tepat satu root Central." → a move may
 *     never produce a second root: the parent proposed for a non-root unit is
 *     required, and the root Central itself may not be moved at all.
 *   - "Root Central tidak dapat dihapus atau dipindah lintas Legal Entity."
 *   - "Anak dan parent harus berada pada Tenant dan Legal Entity yang sama."
 *   - "Tidak boleh ada cycle" → the proposed parent is rejected when it is the
 *     unit itself or any of its descendants.
 *   - "overlap rentang parent efektif" → an effective date that is not strictly
 *     after the range currently in force is refused here, and the EXCLUDE
 *     constraint (`organization_unit_hierarchy_no_overlap`) refuses it again in
 *     the database.
 *   - "future-date, dan limited backdate" (§4.5 Putaran 5, G) → a business date
 *     in the future is allowed; a date in the past is allowed only inside the
 *     policy window and is recorded as a backdate, with both dates kept.
 *
 * The service layer pre-checks the cheap parts so a caller gets a named refusal
 * before a transaction opens; every rule is re-evaluated here, inside the
 * transaction, against locked rows — the pre-check is a courtesy, not the
 * guarantee.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** PostgreSQL `exclusion_violation`. The EXCLUDE constraint is the last line of
 * defence behind the checks in `sealRangeAndOpen`; if it ever fires it is a
 * refusal, not a server fault, and it must reach the caller under the same name
 * the checks use rather than as an unhandled `23P01` → HTTP 500. */
const PG_EXCLUSION_VIOLATION = "23P01";

function isExclusionViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === PG_EXCLUSION_VIOLATION;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapHistoryRow(row: any): HierarchyHistoryEntry {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationUnitId: row.organization_unit_id,
    parentOrganizationUnitId: row.parent_organization_unit_id ?? null,
    effectiveFrom: new Date(row.effective_from),
    effectiveTo: row.effective_to ? new Date(row.effective_to) : null,
    publishedAt: new Date(row.published_at),
    publishedBy: row.published_by ?? null,
    reason: row.reason,
    changeRequestId: row.change_request_id ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRequestRow(row: any): OrganizationUnitChangeRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationUnitId: row.organization_unit_id,
    requestedAction: row.requested_action,
    proposedParentOrganizationUnitId: row.proposed_parent_organization_unit_id ?? null,
    requestedReplacementOrganizationUnitId: row.requested_replacement_organization_unit_id ?? null,
    requestedEffectiveFrom: new Date(row.requested_effective_from),
    reason: row.reason,
    status: row.status as ChangeRequestStatus,
    beforeState: (row.before_state ?? {}) as Record<string, unknown>,
    afterState: (row.after_state ?? {}) as Record<string, unknown>,
    proposedByUserId: row.proposed_by_user_id,
    reviewedByUserId: row.reviewed_by_user_id ?? null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    reviewReason: row.review_reason ?? null,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    historyId: row.history_id ?? null,
    createdAt: new Date(row.created_at),
  };
}

interface UnitRow {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  parent_id: string | null;
  name: string;
  unit_type: string;
  status: LifecycleStatus;
  is_active: boolean;
  replacement_organization_unit_id: string | null;
  /** The instant the unit itself came into being. A hierarchy version cannot
   * precede it: there was no unit for the structure to describe. */
  created_at: Date;
}

export class PgOrganizationUnitHierarchyRepository implements OrganizationUnitHierarchyRepository {
  constructor(private readonly pool: Pool) {}

  async createChangeRequest(
    input: CreateChangeRequestInput,
    actor: ActorContext,
  ): Promise<OrganizationUnitChangeRequest> {
    if (!(CHANGE_REQUEST_ACTIONS as readonly string[]).includes(input.requestedAction)) {
      throw new ConflictError(`Unknown change request action '${input.requestedAction}'`);
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ConflictError("A change request needs a reason");
    }

    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor,
        "organization_unit.change_request.create",
        input.organizationUnitId,
      );

      const unit = await this.lockUnit(client, input.organizationUnitId, actor.tenantId);
      this.assertMutableUnit(unit);

      if (input.requestedAction === "move") {
        if (!input.proposedParentOrganizationUnitId) {
          throw new ConflictError("A move request needs the parent Organization Unit it proposes");
        }
        if (input.proposedParentOrganizationUnitId === unit.id) {
          throw new ConflictError("An Organization Unit cannot be its own parent");
        }
        const parent = await this.lockUnit(
          client,
          input.proposedParentOrganizationUnitId,
          actor.tenantId,
        );
        this.assertSameLegalEntity(unit, parent);
      } else {
        // Putaran 4 fixes the order: "Setelah inactive, Delete oleh Super
        // Admin mengubah Organization Unit menjadi tombstone." A live unit is
        // therefore not a tombstone candidate — it is deactivated first, so the
        // gap between "we stopped using it" and "it is gone" stays visible.
        if (unit.status !== "inactive") {
          throw new ConflictError(
            `A tombstone request needs an inactive Organization Unit; this one is '${unit.status}'`,
          );
        }
        if (input.requestedReplacementOrganizationUnitId) {
          const replacement = await this.lockUnit(
            client,
            input.requestedReplacementOrganizationUnitId,
            actor.tenantId,
          );
          this.assertReplacementCandidate(unit, replacement);
        }
      }

      const status: ChangeRequestStatus = input.submitForReview ? "pending_review" : "draft";
      const beforeState = this.stateOf(unit);
      const afterState =
        input.requestedAction === "move"
          ? { parentId: input.proposedParentOrganizationUnitId, effectiveFrom: input.requestedEffectiveFrom }
          : {
              status: "tombstone",
              replacementOrganizationUnitId: input.requestedReplacementOrganizationUnitId ?? null,
              effectiveFrom: input.requestedEffectiveFrom,
            };

      const created = await client.query(
        `INSERT INTO organization_unit_change_requests
           (tenant_id, organization_unit_id, requested_action,
            proposed_parent_organization_unit_id, requested_replacement_organization_unit_id,
            requested_effective_from, reason, status, before_state, after_state,
            proposed_by_user_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$11,$11)
         RETURNING *`,
        [
          actor.tenantId,
          unit.id,
          input.requestedAction,
          input.proposedParentOrganizationUnitId ?? null,
          input.requestedReplacementOrganizationUnitId ?? null,
          input.requestedEffectiveFrom,
          input.reason,
          status,
          JSON.stringify(beforeState),
          JSON.stringify(afterState),
          actor.userId,
        ],
      );

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action:
          status === "pending_review"
            ? "organization_unit.change_request.submitted"
            : "organization_unit.change_request.created",
        entityType: "organization_unit_change_request",
        entityId: created.rows[0].id as string,
        metadata: {
          organizationUnitId: unit.id,
          requestedAction: input.requestedAction,
          proposedParentOrganizationUnitId: input.proposedParentOrganizationUnitId ?? null,
          requestedReplacementOrganizationUnitId:
            input.requestedReplacementOrganizationUnitId ?? null,
          requestedEffectiveFrom: input.requestedEffectiveFrom,
          reason: input.reason,
          status,
        },
      });

      return mapRequestRow(created.rows[0]);
    });
  }

  async listChangeRequests(
    tenantId: string,
    filter: { organizationUnitId?: string; status?: ChangeRequestStatus } = {},
  ): Promise<OrganizationUnitChangeRequest[]> {
    const result = await this.pool.query(
      `SELECT * FROM organization_unit_change_requests
        WHERE tenant_id = $1
          AND ($2::uuid IS NULL OR organization_unit_id = $2)
          AND ($3::text IS NULL OR status = $3)
        ORDER BY created_at DESC`,
      [tenantId, filter.organizationUnitId ?? null, filter.status ?? null],
    );
    return result.rows.map(mapRequestRow);
  }

  async findChangeRequest(id: string): Promise<OrganizationUnitChangeRequest | null> {
    const result = await this.pool.query(
      `SELECT * FROM organization_unit_change_requests WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? mapRequestRow(result.rows[0]) : null;
  }

  async publishChangeRequest(id: string, actor: ActorContext): Promise<PublishResult> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      const requestRow = await client.query(
        `SELECT * FROM organization_unit_change_requests
          WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!requestRow.rows[0]) throw new NotFoundError("OrganizationUnitChangeRequest", id);
      const request = mapRequestRow(requestRow.rows[0]);

      // §4.5 principle 12 — publishing is the Super Admin's act. The permission
      // is checked with the target unit in hand so the same assignment must also
      // carry the scope: a reviewer who can see the unit but not publish it is
      // refused here, and one who can publish but not see it is refused earlier.
      await requireTransactionActorPermission(
        client,
        actor,
        "organization_unit.change_request.review",
        request.organizationUnitId,
      );

      // Which states a publish may act on is stated once, in the domain:
      // `PUBLISHABLE_CHANGE_REQUEST_STATUSES`. `draft` is publishable too, and
      // that is deliberate rather than an oversight: this wave ships no separate
      // "submit" route, so `submitForReview` at creation time is the submit step
      // and a reviewer may also publish a proposal the proposer left in draft.
      // The Q7 status split (1789397000000) still holds where it matters — a draft
      // stays editable and cancellable by its proposer, and only
      // `published`/`rejected` are terminal review outcomes. `fromStatus` on the
      // audit row below is what keeps a publish that skipped the proposer's signal
      // visible instead of silent.
      if (!(PUBLISHABLE_CHANGE_REQUEST_STATUSES as readonly string[]).includes(request.status)) {
        throw new ConflictError(
          `Change request is '${request.status}' and can no longer be published`,
        );
      }

      const unit = await this.lockUnit(client, request.organizationUnitId, actor.tenantId);
      // The unit may have moved on while the request waited: a proposal created
      // while it was live can outlive its tombstone. Publishing therefore
      // re-evaluates mutability against the LOCKED row — the check
      // `createChangeRequest` performs is a proposal-time courtesy, not the
      // guarantee (see `assertMutableUnit`).
      this.assertMutableUnit(unit);
      const effectiveFrom = request.requestedEffectiveFrom;
      const publishedAt = new Date();
      const backdated = effectiveFrom.getTime() < publishedAt.getTime();

      if (backdated) {
        // §4.5 principle 8 — a backdate is allowed, bounded and recorded. The
        // bound is a policy slot (§4.5 G item 1, Epic 8); until the policy
        // module exists this is the platform default.
        const ageDays = (publishedAt.getTime() - effectiveFrom.getTime()) / DAY_MS;
        if (ageDays > ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS) {
          throw new ConflictError(
            `Backdated hierarchy changes are limited to ${ORGANIZATION_UNIT_BACKDATE_LIMIT_DAYS} days; ` +
              `${effectiveFrom.toISOString()} is ${Math.floor(ageDays)} days before the publish date`,
          );
        }
        if (!request.reason || request.reason.trim().length === 0) {
          throw new ConflictError("A backdated hierarchy change needs a reason");
        }
      }

      let update: {
        parentId: string | null;
        status: string;
        replacementOrganizationUnitId: string | null;
        historyId?: string | null;
        appliedToCurrentProjection?: boolean;
      };
      let references: ReferenceHit[] | undefined;

      if (request.requestedAction === "move") {
        update = await this.applyMove(client, actor, unit, request, effectiveFrom);
      } else {
        const applied = await this.applyTombstone(client, actor, unit, {
          replacementOrganizationUnitId: request.requestedReplacementOrganizationUnitId,
          reason: request.reason,
          effectiveFrom,
        });
        update = {
          parentId: unit.parent_id,
          status: "tombstone",
          replacementOrganizationUnitId: applied.replacementOrganizationUnitId,
        };
        references = applied.references;
      }

      const published = await client.query(
        `UPDATE organization_unit_change_requests
            SET status = 'published',
                reviewed_by_user_id = $1,
                reviewed_at = now(),
                published_at = now(),
                history_id = $2,
                updated_by = $1,
                updated_at = now()
          WHERE id = $3 AND tenant_id = $4
        RETURNING *`,
        [actor.userId, update.historyId ?? null, id, actor.tenantId],
      );

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "organization_unit.change_request.published",
        entityType: "organization_unit_change_request",
        entityId: id,
        metadata: {
          organizationUnitId: unit.id,
          requestedAction: request.requestedAction,
          // The state the proposal was in when the reviewer acted on it. A
          // `draft` published here is a publish the proposer never claimed was
          // ready (see PUBLISHABLE_CHANGE_REQUEST_STATUSES); the record says so
          // rather than leaving it to be inferred from the queue.
          fromStatus: request.status,
          before: request.beforeState,
          after: request.afterState,
          // The pair §4.5 principle 8 requires: the business date the change
          // takes effect AND when it was actually recorded, plus the flag that
          // says the two disagree.
          effectiveFrom: effectiveFrom.toISOString(),
          publishedAt: publishedAt.toISOString(),
          backdated,
          reason: request.reason,
          replacementOrganizationUnitId: update.replacementOrganizationUnitId,
          // §4.5 G: whether this publish moved the CURRENT structure or only
          // corrected a period in the past is part of the record, not an
          // inference a reader has to re-derive from the dates.
          appliedToCurrentProjection: update.appliedToCurrentProjection ?? request.requestedAction === "tombstone",
          ...(references ? { references } : {}),
        },
      });

      return {
        request: mapRequestRow(published.rows[0]),
        organizationUnit: {
          id: unit.id,
          parentId: update.parentId,
          status: update.status,
          replacementOrganizationUnitId: update.replacementOrganizationUnitId,
        },
        backdated,
        effectiveFrom,
        publishedAt,
      };
    });
  }

  async rejectChangeRequest(
    id: string,
    reviewReason: string,
    actor: ActorContext,
  ): Promise<OrganizationUnitChangeRequest> {
    if (!reviewReason || reviewReason.trim().length === 0) {
      throw new ConflictError("A rejection needs a reason");
    }
    return this.reviewTransition(id, "rejected", reviewReason, actor);
  }

  async cancelChangeRequest(id: string, actor: ActorContext): Promise<OrganizationUnitChangeRequest> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      const row = await client.query(
        `SELECT * FROM organization_unit_change_requests
          WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!row.rows[0]) throw new NotFoundError("OrganizationUnitChangeRequest", id);
      const request = mapRequestRow(row.rows[0]);
      if (request.status !== "draft" && request.status !== "pending_review") {
        throw new ConflictError(`Change request is '${request.status}' and cannot be cancelled`);
      }
      // Withdrawing is the proposer's act on their own proposal, so the check is
      // ownership + the create permission they already needed.
      if (request.proposedByUserId !== actor.userId) {
        throw new ForbiddenError("Only the proposer can cancel this change request");
      }
      await requireTransactionActorPermission(
        client,
        actor,
        "organization_unit.change_request.create",
        request.organizationUnitId,
      );

      const cancelled = await client.query(
        `UPDATE organization_unit_change_requests
            SET status = 'cancelled', updated_by = $1, updated_at = now()
          WHERE id = $2 AND tenant_id = $3
        RETURNING *`,
        [actor.userId, id, actor.tenantId],
      );

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "organization_unit.change_request.cancelled",
        entityType: "organization_unit_change_request",
        entityId: id,
        metadata: { organizationUnitId: request.organizationUnitId },
      });

      return mapRequestRow(cancelled.rows[0]);
    });
  }

  async listHistory(organizationUnitId: string, at?: Date): Promise<HierarchyHistoryEntry[]> {
    const result = at
      ? await this.pool.query(
          `SELECT * FROM organization_unit_hierarchy_history
            WHERE organization_unit_id = $1
              AND effective_from <= $2
              AND (effective_to IS NULL OR effective_to > $2)
            ORDER BY effective_from DESC`,
          [organizationUnitId, at],
        )
      : await this.pool.query(
          `SELECT * FROM organization_unit_hierarchy_history
            WHERE organization_unit_id = $1
            ORDER BY effective_from ASC`,
          [organizationUnitId],
        );
    return result.rows.map(mapHistoryRow);
  }

  async parentAt(organizationUnitId: string, at: Date): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT organization_unit_parent_at($1, $2) AS parent_id`,
      [organizationUnitId, at],
    );
    return (result.rows[0]?.parent_id as string | null) ?? null;
  }

  async tombstoneUnit(
    organizationUnitId: string,
    input: TombstoneInput,
    actor: ActorContext,
  ): Promise<TombstoneResult> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      await requireTransactionActorPermission(
        client,
        actor,
        "organization_unit.tombstone",
        organizationUnitId,
      );
      const unit = await this.lockUnit(client, organizationUnitId, actor.tenantId);
      const effectiveFrom = input.effectiveFrom ?? new Date();
      // The "inactive first" rule is enforced in `applyTombstone`, which the
      // published-request path goes through as well — one rule, one place.

      const applied = await this.applyTombstone(client, actor, unit, {
        replacementOrganizationUnitId: input.replacementOrganizationUnitId ?? null,
        reason: input.reason,
        effectiveFrom,
      });

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "organization_unit.tombstoned",
        entityType: "organization_unit",
        entityId: unit.id,
        metadata: {
          previousStatus: unit.status,
          status: "tombstone",
          effectiveFrom: effectiveFrom.toISOString(),
          reason: input.reason,
          replacementOrganizationUnitId: applied.replacementOrganizationUnitId,
          references: applied.references,
          eligibleForPhysicalDelete: applied.references.length === 0,
        },
      });

      return {
        organizationUnitId: unit.id,
        status: "tombstone",
        tombstonedAt: new Date(),
        replacementOrganizationUnitId: applied.replacementOrganizationUnitId,
        references: applied.references,
        eligibleForPhysicalDelete: applied.references.length === 0,
      };
    });
  }

  async referenceCensus(
    entityType: "organization_unit" | "legal_entity",
    entityId: string,
  ): Promise<ReferenceHit[]> {
    return this.censusWith(this.pool, entityType, entityId);
  }

  // ── internals ───────────────────────────────────────────────────────────

  private async reviewTransition(
    id: string,
    status: "rejected",
    reviewReason: string,
    actor: ActorContext,
  ): Promise<OrganizationUnitChangeRequest> {
    return inGovernedTransaction(this.pool, actor.tenantId, async (client) => {
      const row = await client.query(
        `SELECT * FROM organization_unit_change_requests
          WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, actor.tenantId],
      );
      if (!row.rows[0]) throw new NotFoundError("OrganizationUnitChangeRequest", id);
      const request = mapRequestRow(row.rows[0]);
      if (request.status !== "draft" && request.status !== "pending_review") {
        throw new ConflictError(`Change request is '${request.status}' and cannot be rejected`);
      }
      await requireTransactionActorPermission(
        client,
        actor,
        "organization_unit.change_request.review",
        request.organizationUnitId,
      );

      const rejected = await client.query(
        `UPDATE organization_unit_change_requests
            SET status = $1,
                review_reason = $2,
                reviewed_by_user_id = $3,
                reviewed_at = now(),
                updated_by = $3,
                updated_at = now()
          WHERE id = $4 AND tenant_id = $5
        RETURNING *`,
        [status, reviewReason, actor.userId, id, actor.tenantId],
      );

      await recordGovernedAudit(client, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "organization_unit.change_request.rejected",
        entityType: "organization_unit_change_request",
        entityId: id,
        metadata: {
          organizationUnitId: request.organizationUnitId,
          requestedAction: request.requestedAction,
          reviewReason,
        },
      });

      return mapRequestRow(rejected.rows[0]);
    });
  }

  private async applyMove(
    client: PoolClient,
    actor: ActorContext,
    unit: UnitRow,
    request: OrganizationUnitChangeRequest,
    effectiveFrom: Date,
  ): Promise<{ parentId: string | null; status: string; replacementOrganizationUnitId: string | null; historyId?: string | null; appliedToCurrentProjection: boolean }> {
    if (this.isRootCentral(unit)) {
      throw new ConflictError("Root Central Organization Unit cannot be moved");
    }
    if (!request.proposedParentOrganizationUnitId) {
      throw new ConflictError("A move request needs the parent Organization Unit it proposes");
    }

    const parent = await this.lockUnit(client, request.proposedParentOrganizationUnitId, actor.tenantId);
    this.assertSameLegalEntity(unit, parent);
    if (parent.status !== "active") {
      throw new ConflictError(
        `Parent Organization Unit is '${parent.status}'; a unit may only be moved under an active parent`,
      );
    }
    if (await this.isDescendantOf(client, parent.id, unit.id)) {
      throw new ConflictError(
        "The proposed parent is a descendant of this Organization Unit; that would create a cycle",
      );
    }

    const sealed = await this.sealRangeAndOpen(client, actor, unit, parent.id, effectiveFrom, request);

    if (!sealed.appliesToCurrentProjection) {
      // §4.5 G — a backdated correction names a period in the past. The present
      // structure is not rewritten, so `parent_id` stays where it is and the
      // published version is the one that answers for [effectiveFrom, current).
      return {
        parentId: unit.parent_id,
        status: unit.status,
        replacementOrganizationUnitId: unit.replacement_organization_unit_id,
        historyId: sealed.historyId,
        appliedToCurrentProjection: false,
      };
    }

    const updated = await client.query(
      `UPDATE organization_units
          SET parent_id = $1, updated_by = $2, updated_at = now()
        WHERE id = $3 AND tenant_id = $4 AND deleted_at IS NULL
      RETURNING id, parent_id, status, replacement_organization_unit_id`,
      [parent.id, actor.userId, unit.id, actor.tenantId],
    );
    if (!updated.rows[0]) throw new NotFoundError("OrganizationUnit", unit.id);

    return {
      parentId: updated.rows[0].parent_id as string,
      status: updated.rows[0].status as string,
      replacementOrganizationUnitId:
        (updated.rows[0].replacement_organization_unit_id as string | null) ?? null,
      historyId: sealed.historyId,
      appliedToCurrentProjection: true,
    };
  }

  private async applyTombstone(
    client: PoolClient,
    actor: ActorContext,
    unit: UnitRow,
    input: { replacementOrganizationUnitId: string | null; reason: string; effectiveFrom: Date },
  ): Promise<{ replacementOrganizationUnitId: string | null; references: ReferenceHit[]; historyId: string | null }> {
    if (this.isRootCentral(unit)) {
      throw new ConflictError(
        "Root Central Organization Unit cannot be deleted; it lives as long as its Legal Entity",
      );
    }
    // Putaran 4 fixes the order: "Setelah inactive, Delete oleh Super Admin
    // mengubah Organization Unit menjadi tombstone." Re-checked here, inside the
    // transaction, because a published request may be older than the state it
    // assumed: a unit that went back to `active` after the request was raised
    // must not be tombstoned by it.
    if (unit.status !== "inactive") {
      throw new ConflictError(
        `An Organization Unit is tombstoned from 'inactive'; this one is '${unit.status}'`,
      );
    }
    if (!input.reason || input.reason.trim().length === 0) {
      throw new ConflictError("Deleting an Organization Unit needs a reason");
    }

    // Deactivation never cascades, so a unit may not be tombstoned while active
    // children still hang under it: they would be left pointing at a unit that
    // is gone. Same guard, same wording, as the deactivate path.
    const activeChildren = await client.query(
      `SELECT 1 FROM organization_units
        WHERE parent_id = $1 AND tenant_id = $2 AND is_active = true AND deleted_at IS NULL
        FOR UPDATE`,
      [unit.id, actor.tenantId],
    );
    if (activeChildren.rows.length > 0) {
      throw new ConflictError(
        "Organization Unit still has active child units. Deactivate them first.",
      );
    }

    let replacementId: string | null = null;
    if (input.replacementOrganizationUnitId) {
      const replacement = await this.lockUnit(client, input.replacementOrganizationUnitId, actor.tenantId);
      this.assertReplacementCandidate(unit, replacement);
      replacementId = replacement.id;
    }

    // §4.5 step 13 — the reference check happens BEFORE the delete is recorded,
    // and its result is stored with the tombstone rather than recomputed later.
    const references = await this.censusWith(client, "organization_unit", unit.id);

    const sealed = await this.sealRangeAndOpen(
      client,
      actor,
      unit,
      unit.parent_id,
      input.effectiveFrom,
      null,
      // The unit leaves the structure: its range ends, no new version opens.
      false,
    );

    const updated = await client.query(
      `UPDATE organization_units
          SET status = 'tombstone',
              is_active = false,
              deactivated_at = COALESCE(deactivated_at, now()),
              deactivated_by = COALESCE(deactivated_by, $1::uuid),
              tombstoned_at = now(),
              tombstoned_by = $1,
              tombstone_reason = $2,
              replacement_organization_unit_id = $3,
              updated_by = $1,
              updated_at = now()
        WHERE id = $4 AND tenant_id = $5 AND deleted_at IS NULL
      RETURNING id`,
      [actor.userId, input.reason, replacementId, unit.id, actor.tenantId],
    );
    if (!updated.rows[0]) throw new NotFoundError("OrganizationUnit", unit.id);

    return { replacementOrganizationUnitId: replacementId, references, historyId: sealed.historyId };
  }

  /**
   * Record a new version of the unit's parent link at `effectiveFrom`.
   *
   * Two shapes, and the difference is the whole point of §4.5 G:
   *
   *   - FORWARD — `effectiveFrom` is after the range in force. That range is
   *     closed at `effectiveFrom` and the new version opens there and stays open:
   *     it is the structure from that date on, so the current projection
   *     (`organization_units.parent_id`) moves with it.
   *   - BACKDATED — `effectiveFrom` precedes the range in force. The correction is
   *     inserted as a CLOSED range ending exactly where the range in force begins,
   *     and the projection does NOT move: the structure from the range-in-force
   *     date on is unchanged, and what the correction rewrites is the history for
   *     the period it names. §4.5 G is explicit that the two must stay
   *     distinguishable — "Laporan periode yang sudah ditutup tidak boleh berubah
   *     diam-diam" — and a correction that silently re-parents live data would be
   *     exactly that.
   *
   * A date already covered by a range (open or sealed) is refused: two versions
   * of the structure cannot be in force at the same instant. The EXCLUDE
   * constraint (`organization_unit_hierarchy_no_overlap`) refuses it again in the
   * database, and the two agree because the backdated range ends where the
   * following one begins (`'[)'` makes a shared boundary legal).
   *
   * `openNew = false` is the tombstone case: §4.5 Putaran 4 removes the unit from
   * the structure, so the range simply ends at the business date. A reader asking
   * "who was the parent on 2026-03-01" still gets an answer; a reader asking about
   * today gets none, which is the truth.
   */
  private async sealRangeAndOpen(
    client: PoolClient,
    actor: ActorContext,
    unit: UnitRow,
    newParentId: string | null,
    effectiveFrom: Date,
    request: OrganizationUnitChangeRequest | null,
    openNew = true,
  ): Promise<{ historyId: string | null; appliesToCurrentProjection: boolean }> {
    const unitCreatedAt = new Date(unit.created_at);

    // A hierarchy version cannot describe a period before the unit existed: the
    // range would claim a structure was in force while there was nothing for it
    // to hold. §4.5 G bounds a backdate in days; the entity's own lifetime is
    // the other end of the same rule, and it is refused BY NAME rather than left
    // to the EXCLUDE constraint. Legacy units are unaffected: the parity
    // snapshot starts their history long after their `created_at`, so the whole
    // window between the two stays recordable.
    if (effectiveFrom.getTime() < unitCreatedAt.getTime()) {
      throw new ConflictError(
        `The effective date ${effectiveFrom.toISOString()} precedes the Organization Unit's own ` +
          `creation (${unitCreatedAt.toISOString()}); no structure can be recorded for a period ` +
          `before the unit existed`,
      );
    }

    // A SEALED range that already contains this instant is a real overlap: two
    // versions would be in force for the same date. The OPEN range is different —
    // it has no upper bound yet, so a later date simply becomes its end.
    const covered = await client.query(
      `SELECT effective_from, effective_to
         FROM organization_unit_hierarchy_history
        WHERE organization_unit_id = $1
          AND effective_to IS NOT NULL
          AND effective_from <= $2
          AND effective_to > $2
        FOR UPDATE`,
      [unit.id, effectiveFrom],
    );
    if (covered.rows.length > 0) {
      throw new ConflictError(
        `A range (${new Date(covered.rows[0].effective_from).toISOString()} → ` +
          `${new Date(covered.rows[0].effective_to).toISOString()}) is already in force at ` +
          `${effectiveFrom.toISOString()}; it overlaps this change`,
      );
    }

    const open = await client.query(
      `SELECT id, effective_from FROM organization_unit_hierarchy_history
        WHERE organization_unit_id = $1 AND effective_to IS NULL
        FOR UPDATE`,
      [unit.id],
    );
    const current = open.rows[0] as { id: string; effective_from: Date } | undefined;
    const currentFrom = current ? new Date(current.effective_from) : null;

    if (currentFrom && effectiveFrom.getTime() === currentFrom.getTime()) {
      throw new ConflictError(
        `The effective date equals the version already in force ` +
          `(${currentFrom.toISOString()}); nothing new can be recorded at that instant`,
      );
    }

    const backdated = currentFrom !== null && effectiveFrom.getTime() < currentFrom.getTime();

    if (openNew === false && current && backdated) {
      // Tombstone with a business date that precedes the version in force. The
      // unit is leaving the structure, so that version has to END at the
      // effective date — but it did not start yet, and no range may end before it
      // begins. The alternative (closing nothing) would leave a tombstoned unit
      // "in force" for every reader of `organization_unit_parent_at` and of the
      // current projection view, which is the opposite of what Putaran 4 records.
      // Refused BY NAME, like the pre-creation date above, instead of recording
      // half of the operation.
      throw new ConflictError(
        `The range in force began at ${currentFrom.toISOString()}, later than the effective date ` +
          `${effectiveFrom.toISOString()}; an Organization Unit cannot leave the structure before ` +
          `the version that put it there`,
      );
    }

    if (current && !backdated) {
      // Forward: the range in force ends where the new version begins.
      await client.query(
        `UPDATE organization_unit_hierarchy_history
            SET effective_to = $1, updated_by = $2, updated_at = now()
          WHERE id = $3`,
        [effectiveFrom, actor.userId, current.id],
      );
    }

    if (!openNew) return { historyId: null, appliesToCurrentProjection: false };

    // A backdated correction is a closed range: it ends where the version that
    // is still in force begins, so nothing about the present is rewritten.
    //
    // The bound is the start of the NEXT range after `effectiveFrom` — whichever
    // range that is, sealed or open. Bounding it by the OPEN range's start
    // instead is only the same value when the open range happens to be the next
    // one: as soon as a sealed range starts after `effectiveFrom` (any unit that
    // has had a forward publish), such a range would overlap it and the
    // `organization_unit_hierarchy_no_overlap` EXCLUDE constraint would refuse a
    // legitimate correction with a raw 23P01 — a 500, not a named refusal.
    let effectiveTo: Date | null = null;
    if (backdated) {
      const next = await client.query(
        `SELECT min(effective_from) AS next_from
           FROM organization_unit_hierarchy_history
          WHERE organization_unit_id = $1
            AND effective_from > $2`,
        [unit.id, effectiveFrom],
      );
      const nextFrom = next.rows[0]?.next_from as Date | null | undefined;
      effectiveTo = nextFrom ? new Date(nextFrom) : null;
      if (!effectiveTo) {
        // Unreachable: `backdated` means a range starts after `effectiveFrom`.
        throw new ConflictError(
          `No version follows ${effectiveFrom.toISOString()} on this Organization Unit; ` +
            `the correction cannot be bounded`,
        );
      }
    }

    let opened;
    try {
      opened = await client.query(
        `INSERT INTO organization_unit_hierarchy_history
           (tenant_id, organization_unit_id, parent_organization_unit_id,
            effective_from, effective_to, published_at, published_by, recorded_at,
            reason, change_request_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,now(),$6,now(),$7,$8,$6,$6)
         RETURNING id`,
        [
          actor.tenantId,
          unit.id,
          newParentId,
          effectiveFrom,
          effectiveTo,
          actor.userId,
          request?.reason ?? "Organization Unit structure changed",
          request?.id ?? null,
        ],
      );
    } catch (error) {
      // `organization_unit_hierarchy_no_overlap` is the database's own copy of
      // the coverage rule above, and it is the last line of defence rather than
      // the first. A race between two publishes for the same unit can still reach
      // it, and a race is a refusal like any other: it is translated into the same
      // named conflict instead of escaping as a raw 23P01 → HTTP 500.
      if (isExclusionViolation(error)) {
        throw new ConflictError(
          `Another version of this Organization Unit's structure came into force at ` +
            `${effectiveFrom.toISOString()} while this change was being recorded; it overlaps this change`,
        );
      }
      throw error;
    }
    return { historyId: opened.rows[0].id as string, appliesToCurrentProjection: !backdated };
  }

  private async lockUnit(client: PoolClient, id: string, tenantId: string): Promise<UnitRow> {
    const result = await client.query(
      `SELECT id, tenant_id, legal_entity_id, parent_id, name, unit_type, status, is_active,
              replacement_organization_unit_id, created_at
         FROM organization_units
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [id, tenantId],
    );
    if (!result.rows[0]) throw new NotFoundError("OrganizationUnit", id);
    return result.rows[0] as UnitRow;
  }

  /** A unit that is already tombstoned (or hard-deleted) is not a change
   * target: §4.5 principle 10 keeps history readable, it does not reopen it. */
  private assertMutableUnit(unit: UnitRow): void {
    if (unit.status === "tombstone" || unit.status === "deleted") {
      throw new ConflictError(
        `Organization Unit is '${unit.status}'; structure changes are no longer accepted.`,
      );
    }
  }

  private assertSameLegalEntity(unit: UnitRow, other: UnitRow): void {
    if (other.tenant_id !== unit.tenant_id) {
      throw new ForbiddenError("Organization Unit belongs to a different Tenant");
    }
    if (other.legal_entity_id !== unit.legal_entity_id) {
      throw new ForbiddenError("Organization Unit belongs to a different Legal Entity");
    }
  }

  private assertReplacementCandidate(unit: UnitRow, replacement: UnitRow): void {
    this.assertSameLegalEntity(unit, replacement);
    if (replacement.id === unit.id) {
      throw new ConflictError("An Organization Unit cannot replace itself");
    }
    if (replacement.status !== "active") {
      throw new ConflictError(
        `Replacement Organization Unit is '${replacement.status}'; it must be active`,
      );
    }
  }

  private isRootCentral(unit: UnitRow): boolean {
    return unit.unit_type === "Central" && unit.parent_id === null;
  }

  /** True when `candidate` sits anywhere under `ancestorId` in the CURRENT
   * projection — the question a cycle check has to ask. */
  private async isDescendantOf(
    client: PoolClient,
    candidateId: string,
    ancestorId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `WITH RECURSIVE tree AS (
         SELECT id FROM organization_units WHERE parent_id = $1 AND deleted_at IS NULL
         UNION ALL
         SELECT ou.id
           FROM organization_units ou
           JOIN tree t ON ou.parent_id = t.id
          WHERE ou.deleted_at IS NULL
       )
       SELECT EXISTS (SELECT 1 FROM tree WHERE id = $2) AS found`,
      [ancestorId, candidateId],
    );
    return result.rows[0]?.found === true;
  }

  private stateOf(unit: UnitRow): Record<string, unknown> {
    return {
      parentId: unit.parent_id,
      status: unit.status,
      replacementOrganizationUnitId: unit.replacement_organization_unit_id,
    };
  }

  /** The registry measurement from 1789397000000: which rows point at this
   * entity. See `entity_reference_census` for why owner-side tables and audit
   * are not part of it. */
  private async censusWith(
    client: Pool | PoolClient,
    entityType: "organization_unit" | "legal_entity",
    entityId: string,
  ): Promise<ReferenceHit[]> {
    const result = await client.query(
      `SELECT entity_reference_census($1, $2) AS census`,
      [entityType, entityId],
    );
    const raw = result.rows[0]?.census;
    if (!Array.isArray(raw)) return [];
    return raw as ReferenceHit[];
  }
}

/** Exported for the parity test: the status set the database CHECK allows must
 * equal the set the TypeScript union allows. */
export const CHANGE_REQUEST_STATUS_VALUES = CHANGE_REQUEST_STATUSES;

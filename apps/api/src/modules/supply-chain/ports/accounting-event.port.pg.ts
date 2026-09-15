import crypto from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  ScmAccountingReadyEvent,
  ScmAccountingReadyEventType,
  ScmAccountAssignmentType,
  ScmAccountAssignmentDimensions,
  ScmAccountingReadyPayload,
  CreateScmAccountingReadyEventInput,
  ScmAccountingReadyEventFilter,
  ScmAccountingReadyEventStateTransition,
  ScmAccountingOutboxState,
  ScmAccountingReconciliationState,
  ScmAccountingEventStateKind,
  UpdateScmAccountingReadyEventStateInput,
} from "../advanced/domain/supply-chain-advanced.entity.js";
import type { AccountingEventWritePort } from "./accounting-event-write-port.js";

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

function toAccountingReadyEvent(r: QueryResultRow): ScmAccountingReadyEvent {
  const dims: ScmAccountAssignmentDimensions =
    typeof r.account_assignment_dimensions === "object" && r.account_assignment_dimensions !== null
      ? (r.account_assignment_dimensions as ScmAccountAssignmentDimensions)
      : typeof r.account_assignment_dimensions === "string"
        ? (JSON.parse(r.account_assignment_dimensions) as ScmAccountAssignmentDimensions)
        : {};
  const payload: ScmAccountingReadyPayload =
    typeof r.payload === "object" && r.payload !== null
      ? (r.payload as ScmAccountingReadyPayload)
      : typeof r.payload === "string"
        ? (JSON.parse(r.payload) as ScmAccountingReadyPayload)
        : {};
  return {
    id: r.id,
    tenantId: r.tenant_id,
    eventType: r.event_type as ScmAccountingReadyEventType,
    sourceDocumentType: r.source_document_type,
    sourceDocumentId: r.source_document_id,
    sourceDocumentLineId: r.source_document_line_id,
    sourceMovementId: r.source_movement_id,
    sourceDocumentRevision: num(r.source_document_revision) || 1,
    effectiveAt: r.effective_at,
    currency: r.currency,
    amount: num(r.amount),
    quantity: numOrNull(r.quantity),
    unitCost: numOrNull(r.unit_cost),
    accountAssignmentType: r.account_assignment_type as ScmAccountAssignmentType | null,
    accountAssignmentDimensions: dims,
    idempotencyKey: r.idempotency_key,
    reversalOfEventId: r.reversal_of_event_id,
    outboxState: r.outbox_state as ScmAccountingOutboxState,
    reconciliationState: r.reconciliation_state as ScmAccountingReconciliationState,
    payload,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

function toAccountingReadyEventStateTransition(r: QueryResultRow): ScmAccountingReadyEventStateTransition {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    accountingEventId: r.accounting_event_id,
    stateKind: r.state_kind as ScmAccountingEventStateKind,
    fromState: r.from_state,
    toState: r.to_state,
    reason: r.reason,
    occurredAt: r.occurred_at,
    occurredBy: r.occurred_by,
  };
}

export class PgAccountingEventWritePort implements AccountingEventWritePort {
  constructor(private readonly pool: Pool) {}

  async createEvent(
    tenantId: string,
    input: CreateScmAccountingReadyEventInput,
    client?: PoolClient,
  ): Promise<ScmAccountingReadyEvent> {
    if (client) {
      return this.createEventTx(client, tenantId, input);
    }
    const own = await this.pool.connect();
    try {
      await own.query("BEGIN");
      const ev = await this.createEventTx(own, tenantId, input);
      await own.query("COMMIT");
      return ev;
    } catch (err) {
      await own.query("ROLLBACK");
      throw err;
    } finally {
      own.release();
    }
  }

  private async createEventTx(
    client: PoolClient,
    tenantId: string,
    input: CreateScmAccountingReadyEventInput,
    preallocatedId?: string,
  ): Promise<ScmAccountingReadyEvent> {
    const id = preallocatedId ?? crypto.randomUUID();
    const r = await client.query(
      `INSERT INTO scm_accounting_ready_events (
         id, tenant_id, event_type, source_document_type, source_document_id,
         source_document_line_id, source_movement_id, source_document_revision,
         effective_at, currency, amount, quantity, unit_cost,
         account_assignment_type, account_assignment_dimensions, idempotency_key,
         reversal_of_event_id, outbox_state, reconciliation_state, payload, created_by
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         COALESCE($9, now()), $10, $11, $12, $13,
         $14, $15::jsonb, $16,
         $17, 'pending', 'unmatched', $18::jsonb, $19
       )
       RETURNING *`,
      [
        id,
        tenantId,
        input.eventType,
        input.sourceDocumentType,
        input.sourceDocumentId,
        input.sourceDocumentLineId ?? null,
        input.sourceMovementId ?? null,
        input.sourceDocumentRevision ?? 1,
        input.effectiveAt ?? null,
        input.currency ?? "IDR",
        input.amount ?? 0,
        input.quantity ?? null,
        input.unitCost ?? null,
        input.accountAssignmentType ?? null,
        JSON.stringify(input.accountAssignmentDimensions ?? {}),
        input.idempotencyKey,
        input.reversalOfEventId ?? null,
        JSON.stringify(input.payload ?? {}),
        input.createdBy ?? null,
      ],
    );
    return toAccountingReadyEvent(r.rows[0]!);
  }

  async getEventByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    client?: PoolClient,
  ): Promise<ScmAccountingReadyEvent | null> {
    const q = `SELECT * FROM scm_accounting_ready_events WHERE tenant_id = $1 AND idempotency_key = $2`;
    const r = client
      ? await client.query(q, [tenantId, idempotencyKey])
      : await this.pool.query(q, [tenantId, idempotencyKey]);
    return r.rows[0] ? toAccountingReadyEvent(r.rows[0]) : null;
  }

  async getEventById(
    tenantId: string,
    eventId: string,
    client?: PoolClient,
  ): Promise<ScmAccountingReadyEvent | null> {
    const q = `SELECT * FROM scm_accounting_ready_events WHERE tenant_id = $1 AND id = $2`;
    const r = client
      ? await client.query(q, [tenantId, eventId])
      : await this.pool.query(q, [tenantId, eventId]);
    return r.rows[0] ? toAccountingReadyEvent(r.rows[0]) : null;
  }

  async listEvents(
    tenantId: string,
    filter: ScmAccountingReadyEventFilter = {},
  ): Promise<ScmAccountingReadyEvent[]> {
    const conditions = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];

    if (filter.eventType) {
      params.push(filter.eventType);
      conditions.push(`event_type = $${params.length}`);
    }
    if (filter.sourceDocumentType) {
      params.push(filter.sourceDocumentType);
      conditions.push(`source_document_type = $${params.length}`);
    }
    if (filter.sourceDocumentId) {
      params.push(filter.sourceDocumentId);
      conditions.push(`source_document_id = $${params.length}`);
    }
    if (filter.outboxState) {
      params.push(filter.outboxState);
      conditions.push(`outbox_state = $${params.length}`);
    }
    if (filter.reconciliationState) {
      params.push(filter.reconciliationState);
      conditions.push(`reconciliation_state = $${params.length}`);
    }
    if (filter.createdFrom) {
      params.push(filter.createdFrom);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (filter.createdTo) {
      params.push(filter.createdTo);
      conditions.push(`created_at <= $${params.length}`);
    }

    const limit = filter.limit && filter.limit > 0 ? filter.limit : 100;
    params.push(limit);

    const r = await this.pool.query(
      `SELECT * FROM scm_accounting_ready_events
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(toAccountingReadyEvent);
  }

  async updateEventState(
    tenantId: string,
    input: UpdateScmAccountingReadyEventStateInput,
    client?: PoolClient,
  ): Promise<{
    event: ScmAccountingReadyEvent;
    transition: ScmAccountingReadyEventStateTransition;
  }> {
    const run = async (c: PoolClient) => {
      const lockRes = await c.query(
        `SELECT * FROM scm_accounting_ready_events WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, input.accountingEventId],
      );
      if (!lockRes.rows[0]) {
        throw new Error(`Accounting ready event not found: ${input.accountingEventId}`);
      }
      const current = lockRes.rows[0]!;
      const fromState =
        input.stateKind === "outbox"
          ? (current.outbox_state as string)
          : (current.reconciliation_state as string);

      const upSql =
        input.stateKind === "outbox"
          ? `UPDATE scm_accounting_ready_events SET outbox_state = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`
          : `UPDATE scm_accounting_ready_events SET reconciliation_state = $3 WHERE tenant_id = $1 AND id = $2 RETURNING *`;

      const upRes = await c.query(upSql, [
        tenantId,
        input.accountingEventId,
        input.toState,
      ]);
      const event = toAccountingReadyEvent(upRes.rows[0]!);

      const trRes = await c.query(
        `INSERT INTO scm_accounting_ready_event_state_transitions (
           tenant_id, accounting_event_id, state_kind, from_state, to_state, reason, occurred_at, occurred_by
         ) VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8)
         RETURNING *`,
        [
          tenantId,
          input.accountingEventId,
          input.stateKind,
          fromState,
          input.toState,
          input.reason ?? null,
          input.occurredAt ?? null,
          input.occurredBy ?? null,
        ],
      );
      const transition = toAccountingReadyEventStateTransition(trRes.rows[0]!);
      return { event, transition };
    };

    if (client) return run(client);
    const own = await this.pool.connect();
    try {
      await own.query("BEGIN");
      const res = await run(own);
      await own.query("COMMIT");
      return res;
    } catch (err) {
      await own.query("ROLLBACK");
      throw err;
    } finally {
      own.release();
    }
  }
}

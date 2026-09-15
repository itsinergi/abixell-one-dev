/**
 * AccountingEventWritePort — ADR-0023 Outbox Port.
 *
 * Provides an anti-corruption write boundary allowing domain services in
 * Warehouse Management (WMS) and Procurement Management (Service Acceptance /
 * SES) to emit immutable, accounting-ready events into the
 * `scm_accounting_ready_events` outbox table without directly depending on
 * General Ledger / Finance domain packages.
 *
 * Under ADR-0023, SCM owns physical custody and operational valuation.
 * SCM NEVER writes direct GL journal entries. Instead, it emits 10 discrete
 * accounting-ready event types:
 *   - inventory.goods_received
 *   - inventory.goods_issued
 *   - inventory.transferred
 *   - inventory.adjusted
 *   - inventory.returned_to_vendor
 *   - inventory.receipt_reversed
 *   - inventory.landed_cost_applied
 *   - inventory.consignment_consumed
 *   - inventory.disposed
 *   - service.accepted  (Procurement SES)
 */
import type { PoolClient } from "pg";
import type {
  ScmAccountingReadyEvent,
  CreateScmAccountingReadyEventInput,
  ScmAccountingReadyEventFilter,
  ScmAccountingReadyEventStateTransition,
  UpdateScmAccountingReadyEventStateInput,
} from "../advanced/domain/supply-chain-advanced.entity.js";

export interface AccountingEventWritePort {
  /**
   * Insert an immutable accounting-ready event into the outbox.
   * If a `client` is provided, executes within that client's transaction.
   */
  createEvent(
    tenantId: string,
    input: CreateScmAccountingReadyEventInput,
    client?: PoolClient,
  ): Promise<ScmAccountingReadyEvent>;

  /**
   * Find an existing accounting-ready event by idempotency key.
   */
  getEventByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
    client?: PoolClient,
  ): Promise<ScmAccountingReadyEvent | null>;

  /**
   * Get an accounting-ready event by its ID.
   */
  getEventById(
    tenantId: string,
    eventId: string,
    client?: PoolClient,
  ): Promise<ScmAccountingReadyEvent | null>;

  /**
   * List accounting-ready events with optional filters.
   */
  listEvents(
    tenantId: string,
    filter?: ScmAccountingReadyEventFilter,
  ): Promise<ScmAccountingReadyEvent[]>;

  /**
   * Transition an event's outbox or reconciliation lifecycle state with an audit trail.
   */
  updateEventState(
    tenantId: string,
    input: UpdateScmAccountingReadyEventStateInput,
    client?: PoolClient,
  ): Promise<{
    event: ScmAccountingReadyEvent;
    transition: ScmAccountingReadyEventStateTransition;
  }>;
}

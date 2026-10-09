import type { TenantRepository } from "../../domain/tenant/tenant.entity.js";
import type { IntegrationService } from "../integration/integration.service.js";
import type { ServiceQualityService } from "../service-quality/service-quality.service.js";
import type { WorkflowService } from "../workflow/workflow.service.js";
import type { SchedulerService } from "./scheduler.service.js";

interface AccountingEventConsumerJob {
  processTenant(tenantId: string): Promise<{
    events: number;
    posted: number;
    failed: number;
    errors: string[];
  }>;
}

/**
 * Registers every known Scheduled Job handler by `handlerKey`. This is
 * the one place the Scheduler foundation is connected to a concrete
 * piece of work — everything in `scheduler.service.ts` stays generic.
 *
 * `workflow-escalation-sweep` fulfils the Founder's explicit request for
 * this checkpoint: "gunakan Scheduler untuk membuktikan escalation sweep
 * workflow secara otomatis". It iterates every Tenant (multi-tenant-ready
 * per doc 07, even though today's implementation environment only has
 * one) and runs `WorkflowService.escalateOverdueAssignmentsForTenant` —
 * the exact same sweep logic 0D's manual `/workflow/escalation-sweep`
 * endpoint calls, just invoked on a timer instead of by a Founder Review
 * click.
 */
export function registerJobHandlers(
  scheduler: SchedulerService,
  deps: {
    tenantRepo: TenantRepository;
    workflow: WorkflowService;
    integration: IntegrationService;
    serviceQuality: ServiceQualityService;
    accountingEventConsumer: AccountingEventConsumerJob;
  },
): void {
  scheduler.registerHandler("workflow-escalation-sweep", async ({ actor }) => {
    const tenants = actor
      ? [await deps.tenantRepo.findById(actor.tenantId)].filter((tenant) => tenant !== null)
      : await deps.tenantRepo.list();
    let totalEscalated = 0;
    const perTenant: Record<string, number> = {};
    for (const tenant of tenants) {
      const escalated = await deps.workflow.escalateOverdueAssignmentsForTenant(tenant.id);
      if (!actor) perTenant[tenant.code] = escalated.length;
      totalEscalated += escalated.length;
    }
    return {
      tenantsSwept: tenants.length,
      totalEscalated,
      ...(actor ? {} : { perTenant }),
    };
  });

  // Phase H2 / PH-8: the reconciliation pass uses durable Domain Events to
  // backfill any enqueue missed during an interrupted EventBus subscriber,
  // then safely claims and processes each Tenant's due deliveries.
  scheduler.registerHandler("integration-outbox-reconciliation", async ({ actor }) => {
    const tenants = actor
      ? [await deps.tenantRepo.findById(actor.tenantId)].filter((tenant) => tenant !== null)
      : await deps.tenantRepo.list();
    const totals = {
      reconciled: 0,
      claimed: 0,
      succeeded: 0,
      retried: 0,
      terminalFailed: 0,
    };
    const perTenant: Record<string, Record<string, number>> = {};
    for (const tenant of tenants) {
      const result = await deps.integration.reconcileAndProcessTenant(tenant.id);
      if (!actor) {
        perTenant[tenant.code] = {
          reconciled: result.reconciled,
          claimed: result.claimed,
          succeeded: result.succeeded,
          retried: result.retried,
          terminalFailed: result.terminalFailed,
        };
      }
      totals.reconciled += result.reconciled;
      totals.claimed += result.claimed;
      totals.succeeded += result.succeeded;
      totals.retried += result.retried;
      totals.terminalFailed += result.terminalFailed;
    }
    return {
      tenantsSwept: tenants.length,
      ...totals,
      ...(actor ? {} : { perTenant }),
    };
  });

  scheduler.registerHandler("service-quality-sla-reconciliation", async ({ actor }) => {
    const tenants = actor
      ? [await deps.tenantRepo.findById(actor.tenantId)].filter((tenant) => tenant !== null)
      : await deps.tenantRepo.list();
    const totals = { scanned: 0, processed: 0, failed: 0 };
    const perTenant: Record<string, Record<string, number>> = {};
    for (const tenant of tenants) {
      const result = await deps.serviceQuality.reconcileComplaintLifecycleEvents(tenant.id);
      if (!actor) {
        perTenant[tenant.code] = {
          scanned: result.scanned,
          processed: result.processed,
          failed: result.failed,
        };
      }
      totals.scanned += result.scanned;
      totals.processed += result.processed;
      totals.failed += result.failed;
    }
    if (totals.failed > 0) {
      throw new Error(
        `Service Quality reconciliation failed for ${totals.failed} of ${totals.scanned} event(s)`,
      );
    }
    return {
      tenantsSwept: tenants.length,
      ...totals,
      ...(actor ? {} : { perTenant }),
    };
  });

  // Phase 2 WP-INT-01..03 — Accounting Event Poster. Sweeps each Tenant's
  // SCM accounting-ready outbox, generates + posts GL journals via the
  // system-principal internal methods, and records posting idempotency.
  // Multi-replica safety is inherited from the Scheduler's persisted
  // execution lease (claimExecution + heartbeat), so the handler itself
  // needs no extra fencing beyond the FOR UPDATE SKIP LOCKED claim.
  scheduler.registerHandler("accounting-event-poster", async ({ actor }) => {
    const tenants = actor
      ? [await deps.tenantRepo.findById(actor.tenantId)].filter((tenant) => tenant !== null)
      : await deps.tenantRepo.list();
    const totals = { events: 0, posted: 0, failed: 0 };
    const perTenant: Record<string, Record<string, number>> = {};
    for (const tenant of tenants) {
      const result = await deps.accountingEventConsumer.processTenant(tenant.id);
      if (!actor) {
        perTenant[tenant.code] = {
          events: result.events,
          posted: result.posted,
          failed: result.failed,
        };
      }
      totals.events += result.events;
      totals.posted += result.posted;
      totals.failed += result.failed;
    }
    return {
      tenantsSwept: tenants.length,
      ...totals,
      ...(actor ? {} : { perTenant }),
    };
  });
}

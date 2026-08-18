import type { TenantRepository } from "../../domain/tenant/tenant.entity.js";
import type { WorkflowService } from "../workflow/workflow.service.js";
import type { SchedulerService } from "./scheduler.service.js";

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
  deps: { tenantRepo: TenantRepository; workflow: WorkflowService },
): void {
  scheduler.registerHandler("workflow-escalation-sweep", async () => {
    const tenants = await deps.tenantRepo.list();
    let totalEscalated = 0;
    const perTenant: Record<string, number> = {};
    for (const tenant of tenants) {
      const escalated = await deps.workflow.escalateOverdueAssignmentsForTenant(tenant.id);
      perTenant[tenant.code] = escalated.length;
      totalEscalated += escalated.length;
    }
    return { tenantsSwept: tenants.length, totalEscalated, perTenant };
  });
}

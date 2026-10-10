import type {
  CreateSodRuleInput,
  SodForbiddenRule,
  SodRepository,
  SodViolation,
} from "../../domain/rbac/sod.entity.js";
import { violatesPair } from "../../domain/rbac/sod.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import type { RbacService } from "./rbac.service.js";

/**
 * WP-APR-03 — Segregation of Duties application service.
 *
 * The hard block is the DB trigger on `user_role_assignments`; this service
 * owns the governed rule surface and the tenant-wide survey that surfaces
 * pairs already held (rules added after the fact, or assignments created
 * before the rule existed).
 */
export class SodService {
  constructor(
    private readonly repo: SodRepository,
    private readonly rbac: RbacService,
  ) {}

  async listRules(actor: ActorContext): Promise<SodForbiddenRule[]> {
    await this.rbac.requirePermission(actor, "config.read");
    return this.repo.listRules(actor.tenantId);
  }

  async createRule(actor: ActorContext, input: CreateSodRuleInput): Promise<SodForbiddenRule> {
    await this.rbac.requirePermission(actor, "config.manage");
    return this.repo.createRule(actor.tenantId, input, actor);
  }

  async deleteRule(actor: ActorContext, ruleId: string): Promise<void> {
    await this.rbac.requirePermission(actor, "config.manage");
    return this.repo.deleteRule(actor.tenantId, ruleId, actor);
  }

  /** Survey: live role pairs actually held by the same user that violate a rule. */
  async listViolations(actor: ActorContext): Promise<SodViolation[]> {
    await this.rbac.requirePermission(actor, "config.read");
    const [rules, held] = await Promise.all([
      this.repo.listRules(actor.tenantId),
      this.repo.listHeldPairs(actor.tenantId),
    ]);

    const violations: SodViolation[] = [];
    for (const pair of held) {
      if (!violatesPair(rules, pair.codeA, pair.codeB)) continue;
      const rule = rules.find((r) => {
        const [ra, rb] = r.roleCodeA < r.roleCodeB
          ? [r.roleCodeA, r.roleCodeB]
          : [r.roleCodeB, r.roleCodeA];
        return ra === pair.codeA && rb === pair.codeB;
      });
      if (!rule) continue;
      violations.push({
        userId: pair.userId,
        roleCodeA: pair.codeA,
        roleCodeB: pair.codeB,
        ruleId: rule.id,
        reason: rule.reason,
      });
    }
    return violations;
  }
}

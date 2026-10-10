import type {
  RegisterRuleInput,
  RuleRegistryEntry,
  RuleRegistryRepository,
} from "../../domain/rules/rule-registry.entity.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import type { RbacService } from "../rbac/rbac.service.js";

/**
 * WP-APR-02 — Central Rule Registry application service (DEC-008/BR-013).
 * Governed by config.manage (rule content is tenant-level control data).
 */
export class RuleRegistryService {
  constructor(
    private readonly repo: RuleRegistryRepository,
    private readonly rbac: RbacService,
  ) {}

  async register(actor: ActorContext, input: RegisterRuleInput): Promise<RuleRegistryEntry> {
    await this.rbac.requirePermission(actor, "config.manage");
    return this.repo.createEntry(actor.tenantId, input, actor);
  }

  async list(actor: ActorContext, ruleKey: string): Promise<RuleRegistryEntry[]> {
    await this.rbac.requirePermission(actor, "config.read");
    return this.repo.listByKey(actor.tenantId, ruleKey);
  }

  async getActive(actor: ActorContext, ruleKey: string): Promise<RuleRegistryEntry | null> {
    await this.rbac.requirePermission(actor, "config.read");
    return this.repo.findActive(actor.tenantId, ruleKey);
  }

  async setStatus(
    actor: ActorContext,
    id: string,
    status: "draft" | "active" | "retired",
  ): Promise<RuleRegistryEntry> {
    await this.rbac.requirePermission(actor, "config.manage");
    return this.repo.setStatus(actor.tenantId, id, status, actor);
  }
}

import type { Contract, ContractRepository } from "../../domain/customer/contract.entity.js";
import type { AuditService } from "../audit/audit.service.js";
import type { RbacService } from "../rbac/rbac.service.js";
import type { CustomerService } from "./customer.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";

export interface CreateContractInput {
  customerId: string;
  code: string;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
  status?: string;
}

/** Contract resolves its Data Scope through its parent Customer — see
 * migration header for why Contract does not carry its own scope field. */
export class ContractService {
  constructor(
    private readonly repo: ContractRepository,
    private readonly customers: CustomerService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  async create(actor: ActorContext, input: CreateContractInput): Promise<Contract> {
    await this.rbac.requirePermission(actor.userId, "contract.manage");
    await this.customers.getAuthorized(actor, input.customerId);

    const contract = await this.repo.create({ ...input, tenantId: actor.tenantId }, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "contract.created",
      entityType: "contract",
      entityId: contract.id,
      metadata: { customerId: input.customerId, code: contract.code },
    });

    return contract;
  }

  async listByCustomer(actor: ActorContext, customerId: string): Promise<Contract[]> {
    await this.rbac.requirePermission(actor.userId, "contract.read");
    await this.customers.getAuthorized(actor, customerId);
    return this.repo.listByCustomer(customerId);
  }
}

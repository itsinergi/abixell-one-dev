/**
 * WP-APR-02 — Central Rule Registry domain (DEC-008/BR-013).
 *
 * One versioned store for governed business rules. Supersede-not-update:
 * versions are immutable; activating a version supersedes the previous
 * active one. The DB trigger enforces the single-active invariant; this
 * layer is the typed contract.
 */

export type RuleRegistryStatus = "draft" | "active" | "superseded" | "retired";

export const RULE_REGISTRY_STATUSES: readonly RuleRegistryStatus[] = [
  "draft",
  "active",
  "superseded",
  "retired",
];

export interface RuleRegistryEntry {
  id: string;
  tenantId: string;
  ruleKey: string;
  version: number;
  payload: Record<string, unknown>;
  status: RuleRegistryStatus;
  validFrom: Date;
  validTo: Date | null;
  moduleCode: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface RegisterRuleInput {
  ruleKey: string;
  payload: Record<string, unknown>;
  /** Publish immediately as active (superseding the current active version). */
  activate?: boolean;
}

export interface RuleRegistryRepository {
  createEntry(
    tenantId: string,
    input: RegisterRuleInput,
    actor: ActorLike,
  ): Promise<RuleRegistryEntry>;
  /** Next version number for (tenant, key) — max(version)+1. */
  nextVersion(tenantId: string, ruleKey: string): Promise<number>;
  findById(tenantId: string, id: string): Promise<RuleRegistryEntry | null>;
  /** The active version of a key, as of now. */
  findActive(tenantId: string, ruleKey: string): Promise<RuleRegistryEntry | null>;
  listByKey(tenantId: string, ruleKey: string): Promise<RuleRegistryEntry[]>;
  setStatus(
    tenantId: string,
    id: string,
    status: "draft" | "active" | "retired",
    actor: ActorLike,
  ): Promise<RuleRegistryEntry>;
}

export interface ActorLike {
  tenantId: string;
  userId: string;
}

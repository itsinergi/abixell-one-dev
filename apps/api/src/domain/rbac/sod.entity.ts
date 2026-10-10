import type { ActorContext } from "../shared-kernel/audit-context.js";

/**
 * WP-APR-03 — Segregation of Duties domain (DEC-008/BR-013).
 *
 * A rule forbids one ROLE CODE PAIR per tenant. Storage canonicalizes the
 * pair (LEAST/GREATEST) so a rule covers both orderings. Enforcement is
 * DB-hard (trigger on `user_role_assignments`); this layer provides the
 * governed CRUD surface for the rules and the tenant-wide violation survey.
 */

export interface SodForbiddenRule {
  id: string;
  tenantId: string;
  roleCodeA: string;
  roleCodeB: string;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface CreateSodRuleInput {
  roleCodeA: string;
  roleCodeB: string;
  reason: string;
}

export interface SodViolation {
  userId: string;
  roleCodeA: string;
  roleCodeB: string;
  ruleId: string;
  reason: string;
}

export interface SodRepository {
  createRule(
    tenantId: string,
    input: CreateSodRuleInput,
    actor: ActorContext,
  ): Promise<SodForbiddenRule>;
  listRules(tenantId: string): Promise<SodForbiddenRule[]>;
  deleteRule(tenantId: string, ruleId: string, actor: ActorContext): Promise<void>;
  /** Pure survey: role-code pairs actually held live by the same user. */
  listHeldPairs(tenantId: string): Promise<Array<{ userId: string; codeA: string; codeB: string }>>;
}

/** Canonical ordering so a rule covers both (a,b) and (b,a). */
export function canonicalPair(
  a: string,
  b: string,
): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function violatesPair(
  rules: ReadonlyArray<Pick<SodForbiddenRule, "roleCodeA" | "roleCodeB">>,
  codeA: string,
  codeB: string,
): boolean {
  const [x, y] = canonicalPair(codeA, codeB);
  return rules.some((r) => {
    const [ra, rb] = canonicalPair(r.roleCodeA, r.roleCodeB);
    return ra === x && rb === y;
  });
}

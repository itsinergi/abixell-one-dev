import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/infrastructure/persistence/db.js";
import { PgAccountingKernelRepository } from "../../src/modules/accounting/kernel/infrastructure/accounting-kernel.repository.pg.js";
import { AccountingKernelService } from "../../src/modules/accounting/kernel/application/accounting-kernel.service.js";
import { PgRbacRepository } from "../../src/infrastructure/persistence/repositories/rbac.repository.pg.js";
import { PgAuditLogRepository } from "../../src/infrastructure/persistence/repositories/audit-log.repository.pg.js";
import { PgOrganizationUnitRepository } from "../../src/infrastructure/persistence/repositories/organization-unit.repository.pg.js";
import { PgLegalEntityRepository } from "../../src/infrastructure/persistence/repositories/legal-entity.repository.pg.js";
import { RbacService } from "../../src/application/rbac/rbac.service.js";
import { AuditService } from "../../src/application/audit/audit.service.js";
import { EventBus } from "../../src/application/event/event-bus.js";
import { PgDomainEventRepository } from "../../src/infrastructure/persistence/repositories/domain-event.repository.pg.js";
import type { ActorContext } from "../../src/domain/shared-kernel/audit-context.js";

/**
 * WP-FIN-05 — Posting Rule Engine (Phase 1G).
 *
 * Epic 14 §4.14 keputusan #9: account mapping is tenant-admin DATA, not
 * code; enforcement in DB/services not UI; money never touches JS binary
 * floats (Money = string, PostgreSQL numeric). The expression evaluator is
 * whitelist-only and deterministic — no JS eval, AMOUNT substituted as a
 * bound parameter, arithmetic performed by PostgreSQL numeric.
 *
 * Scope: rule config + rule resolution → journal draft generation only.
 * Consumer outbox/event worker/idempotent retry is WP-INT-01 (Phase 2),
 * out of scope here — generateJournalFromRule never auto-posts.
 */

const TS = `ak-posting-rules-${Date.now()}`;

describe("WP-FIN-05 — Accounting Kernel Posting Rules", () => {
  let tenantId: string;
  let legalEntityId: string;
  let userId: string;
  let coaId: string;
  let debitAccountId: string;
  let creditAccountId: string;
  let creditAccountId2: string;
  let service: AccountingKernelService;
  let repo: PgAccountingKernelRepository;

  let testNum = 0;

  async function createOpenPeriod(): Promise<string> {
    const periodResult = await pool.query(
      `INSERT INTO accounting_periods (tenant_id, legal_entity_id, fiscal_year_code, period_code, period_name, period_type, date_from, date_to, status, created_by)
       VALUES ($1, $2, 'FY2026', $3, $4, 'monthly', '2026-01-01', '2026-01-31', 'open', $5) RETURNING id`,
      [tenantId, legalEntityId, `P-${++testNum}`, `Test Period ${testNum}`, userId],
    );
    return periodResult.rows[0].id;
  }

  async function actorWith(permissions: string[]): Promise<ActorContext> {
    const roleRes = await pool.query(
      `INSERT INTO roles (tenant_id, code, name) VALUES ($1, 'ROLE-' || random()::text, 'Test Role') RETURNING id`,
      [tenantId],
    );
    const roleId = roleRes.rows[0].id;
    if (permissions.length > 0) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p WHERE p.code = ANY($2)`,
        [roleId, permissions],
      );
    }
    const assignRes = await pool.query(
      `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
       VALUES ($1, $2, 'tenant') RETURNING id`,
      [userId, roleId],
    );
    return {
      userId,
      tenantId,
      sessionId: "00000000-0000-4000-8000-000000000001",
      assignmentId: assignRes.rows[0].id,
      roleId,
      roleCode: "ROLE-TEST",
      scopeType: "tenant",
      scopeLegalEntityId: null,
      scopeOrganizationUnitId: null,
      scopeCustomerId: null,
    };
  }

  beforeAll(async () => {
    const tenantResult = await pool.query(
      `INSERT INTO tenants (code, name) VALUES ($1, 'Posting Rules Test Tenant') RETURNING id`,
      [TS],
    );
    tenantId = tenantResult.rows[0].id;

    const leResult = await pool.query(
      `INSERT INTO legal_entities (tenant_id, name) VALUES ($1, 'LE Test') RETURNING id`,
      [tenantId],
    );
    legalEntityId = leResult.rows[0].id;

    const userResult = await pool.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name)
       VALUES ($1, $2, 'x', $2) RETURNING id`,
      [tenantId, `${TS}-user@test.local`],
    );
    userId = userResult.rows[0].id;

    repo = new PgAccountingKernelRepository(pool);
    service = new AccountingKernelService(
      repo,
      // ConfigurationService is unused by every posting-rule code path under
      // test (same convention as accounting-kernel-gl-reconciliation.test.ts
      // and accounting-kernel-period-reopen.test.ts).
      {} as never,
      new AuditService(new PgAuditLogRepository(pool)),
      new RbacService(
        new PgRbacRepository(pool),
        new PgOrganizationUnitRepository(pool),
        new PgLegalEntityRepository(pool),
      ),
      new EventBus(new PgDomainEventRepository(pool), () => {}),
    );

    const coaResult = await pool.query(
      `INSERT INTO chart_of_accounts (tenant_id, legal_entity_id, coa_version_code, coa_version_date, is_active, created_by)
       VALUES ($1, $2, 'FY2026', '2026-01-01', true, $3) RETURNING id`,
      [tenantId, legalEntityId, userId],
    );
    coaId = coaResult.rows[0].id;

    const debitResult = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '1000', 'Cash', 'ASSET', 'debit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    debitAccountId = debitResult.rows[0].id;

    const creditResult = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '4000', 'Revenue', 'INCOME', 'credit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    creditAccountId = creditResult.rows[0].id;

    const credit2Result = await pool.query(
      `INSERT INTO accounting_accounts (tenant_id, legal_entity_id, coa_id, account_code, account_name, account_class, normal_balance, is_active, created_by)
       VALUES ($1, $2, $3, '4100', 'Tax Payable', 'LIABILITY', 'credit', true, $4) RETURNING id`,
      [tenantId, legalEntityId, coaId, userId],
    );
    creditAccountId2 = credit2Result.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await pool.end();
  });

  // =========================================================================
  // CRUD
  // =========================================================================

  describe("createPostingRule", () => {
    it("creates a balanced two-leg rule", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      const rule = await service.createPostingRule(actor, {
        ruleCode: "RULE_CREATE_OK",
        ruleName: "Simple pass-through",
        ruleVersion: "v1",
        triggerEventType: "TEST_CREATE_OK",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      expect(rule.ruleCode).toBe("RULE_CREATE_OK");
      expect(rule.ruleVersion).toBe("v1");
      expect(rule.isActive).toBe(true);
      expect(rule.accountingFormula).toHaveLength(2);
    });

    it("rejects a duplicate rule code + version with ConflictError", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      const input = {
        ruleCode: "RULE_DUP",
        ruleName: "Dup rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_DUP",
        accountingFormula: [
          { accountCode: "1000", side: "debit" as const, amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit" as const, amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      };
      await service.createPostingRule(actor, input);
      await expect(service.createPostingRule(actor, input)).rejects.toMatchObject({
        name: "ConflictError",
      });
    });

    it("rejects an imbalanced formula with ValidationError", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      await expect(
        service.createPostingRule(actor, {
          ruleCode: "RULE_IMBALANCE",
          ruleName: "Imbalanced rule",
          ruleVersion: "v1",
          triggerEventType: "TEST_IMBALANCE",
          accountingFormula: [
            { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
            { accountCode: "4000", side: "credit", amountExpression: "AMOUNT * 2" },
          ],
          requiresApproval: false,
          materialityThreshold: null,
          effectiveDate: "2026-01-01",
        }),
      ).rejects.toMatchObject({ name: "ValidationError" });
    });

    it("rejects an expression with a forbidden identifier", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      await expect(
        service.createPostingRule(actor, {
          ruleCode: "RULE_FORBIDDEN_ID",
          ruleName: "Forbidden identifier",
          ruleVersion: "v1",
          triggerEventType: "TEST_FORBIDDEN_ID",
          accountingFormula: [
            { accountCode: "1000", side: "debit", amountExpression: "eval(AMOUNT)" },
            { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
          ],
          requiresApproval: false,
          materialityThreshold: null,
          effectiveDate: "2026-01-01",
        }),
      ).rejects.toMatchObject({ name: "ValidationError" });
    });

    it("rejects an expression containing SQL comment syntax", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      await expect(
        service.createPostingRule(actor, {
          ruleCode: "RULE_FORBIDDEN_COMMENT",
          ruleName: "Forbidden comment",
          ruleVersion: "v1",
          triggerEventType: "TEST_FORBIDDEN_COMMENT",
          accountingFormula: [
            { accountCode: "1000", side: "debit", amountExpression: "AMOUNT -- drop" },
            { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
          ],
          requiresApproval: false,
          materialityThreshold: null,
          effectiveDate: "2026-01-01",
        }),
      ).rejects.toMatchObject({ name: "ValidationError" });
    });

    it("requires finance.accounting.configure", async () => {
      const actor = await actorWith([]);
      await expect(
        service.createPostingRule(actor, {
          ruleCode: "RULE_NOPERM",
          ruleName: "No permission",
          ruleVersion: "v1",
          triggerEventType: "TEST_NOPERM",
          accountingFormula: [
            { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
            { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
          ],
          requiresApproval: false,
          materialityThreshold: null,
          effectiveDate: "2026-01-01",
        }),
      ).rejects.toMatchObject({ name: "ForbiddenError" });
    });
  });

  describe("listPostingRules", () => {
    it("filters by triggerEventType", async () => {
      const actor = await actorWith(["finance.accounting.configure", "finance.accounting.read"]);
      await service.createPostingRule(actor, {
        ruleCode: "RULE_LIST",
        ruleName: "List filter rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_LIST",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      const rules = await service.listPostingRules(actor, { triggerEventType: "TEST_LIST" });
      expect(rules).toHaveLength(1);
      expect(rules[0].ruleCode).toBe("RULE_LIST");
    });
  });

  describe("deprecatePostingRule and resolution precedence", () => {
    it("latest version wins; deprecating it falls back to the prior version", async () => {
      const actor = await actorWith(["finance.accounting.configure", "finance.accounting.read"]);

      await service.createPostingRule(actor, {
        ruleCode: "RULE_LATEST",
        ruleName: "Version 1",
        ruleVersion: "v1",
        triggerEventType: "TEST_LATEST",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      const v2 = await service.createPostingRule(actor, {
        ruleCode: "RULE_LATEST",
        ruleName: "Version 2",
        ruleVersion: "v2",
        triggerEventType: "TEST_LATEST",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });

      const resolvedLatest = await service.resolvePostingRule(actor, "TEST_LATEST", "2026-06-01", "50.00");
      expect(resolvedLatest.rule.ruleVersion).toBe("v2");

      await service.deprecatePostingRule(actor, v2.id);

      const resolvedAfterDeprecate = await service.resolvePostingRule(actor, "TEST_LATEST", "2026-06-01", "50.00");
      expect(resolvedAfterDeprecate.rule.ruleVersion).toBe("v1");
    });

    it("rejects deprecating an already-deprecated rule with ConflictError", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      const rule = await service.createPostingRule(actor, {
        ruleCode: "RULE_DOUBLE_DEPRECATE",
        ruleName: "Double deprecate",
        ruleVersion: "v1",
        triggerEventType: "TEST_DOUBLE_DEPRECATE",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      await service.deprecatePostingRule(actor, rule.id);
      await expect(service.deprecatePostingRule(actor, rule.id)).rejects.toMatchObject({
        name: "ConflictError",
      });
    });

    it("rejects deprecating a rule from another tenant with NotFoundError", async () => {
      const actor = await actorWith(["finance.accounting.configure"]);
      const rule = await service.createPostingRule(actor, {
        ruleCode: "RULE_CROSS_TENANT",
        ruleName: "Cross tenant",
        ruleVersion: "v1",
        triggerEventType: "TEST_CROSS_TENANT",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });

      const otherTenantResult = await pool.query(
        `INSERT INTO tenants (code, name) VALUES ($1, 'Other Tenant') RETURNING id`,
        [`${TS}-other`],
      );
      const otherTenantId = otherTenantResult.rows[0].id;

      // Build a fully valid actor in the other tenant: its own user, role,
      // and assignment so RBAC requirePermission passes. The cross-tenant
      // guard in deprecatePostingRule must then surface as NotFoundError
      // (never leak existence of tenant A's rule).
      const otherUserRes = await pool.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name)
         VALUES ($1, $2, 'x', $2) RETURNING id`,
        [otherTenantId, `${TS}-other-user@test.local`],
      );
      const otherRoleRes = await pool.query(
        `INSERT INTO roles (tenant_id, code, name)
         VALUES ($1, 'ROLE-OTHER-' || random()::text, 'Other Tenant Role') RETURNING id`,
        [otherTenantId],
      );
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM permissions p WHERE p.code = ANY($2)`,
        [otherRoleRes.rows[0].id, ["finance.accounting.configure"]],
      );
      const otherAssignRes = await pool.query(
        `INSERT INTO user_role_assignments (user_id, role_id, scope_type)
         VALUES ($1, $2, 'tenant') RETURNING id`,
        [otherUserRes.rows[0].id, otherRoleRes.rows[0].id],
      );
      const otherActor: ActorContext = {
        userId: otherUserRes.rows[0].id,
        tenantId: otherTenantId,
        sessionId: "00000000-0000-4000-8000-000000000002",
        assignmentId: otherAssignRes.rows[0].id,
        roleId: otherRoleRes.rows[0].id,
        roleCode: "ROLE-OTHER",
        scopeType: "tenant",
        scopeLegalEntityId: null,
        scopeOrganizationUnitId: null,
        scopeCustomerId: null,
      };

      await expect(service.deprecatePostingRule(otherActor, rule.id)).rejects.toMatchObject({
        name: "NotFoundError",
      });

      await pool.query(`DELETE FROM tenants WHERE id = $1`, [otherTenantId]);
    });
  });

  // =========================================================================
  // Resolution
  // =========================================================================

  describe("resolvePostingRule", () => {
    it("excludes a rule whose effective_date is in the future", async () => {
      const actor = await actorWith(["finance.accounting.configure", "finance.accounting.read"]);
      await service.createPostingRule(actor, {
        ruleCode: "RULE_FUTURE",
        ruleName: "Future rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_FUTURE",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2099-01-01",
      });

      await expect(
        service.resolvePostingRule(actor, "TEST_FUTURE", "2026-01-01", "10.00"),
      ).rejects.toMatchObject({ name: "NotFoundError" });
    });

    it("evaluates AMOUNT * 0.1 on 110.00 to exactly 11.00 — no binary float error", async () => {
      const actor = await actorWith(["finance.accounting.configure", "finance.accounting.read"]);
      await service.createPostingRule(actor, {
        ruleCode: "RULE_MATH",
        ruleName: "Math precision rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_MATH",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT * 0.1" },
          { accountCode: "4100", side: "credit", amountExpression: "AMOUNT * 0.9" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });

      const resolved = await service.resolvePostingRule(actor, "TEST_MATH", "2026-06-01", "110.00");
      const byCode = Object.fromEntries(resolved.resolvedLegs.map((l) => [l.accountCode, l.amount]));
      expect(byCode["1000"]).toBe("110.00");
      expect(byCode["4000"]).toBe("11.00");
      expect(byCode["4100"]).toBe("99.00");
    });
  });

  // =========================================================================
  // Generation (draft journal, no auto-post)
  // =========================================================================

  describe("generateJournalFromRule", () => {
    it("creates a balanced pending journal with posting_rule_version_id set, not auto-posted", async () => {
      const actor = await actorWith([
        "finance.accounting.configure",
        "finance.accounting.manage",
        "finance.accounting.read",
      ]);
      const rule = await service.createPostingRule(actor, {
        ruleCode: "RULE_GENERATE",
        ruleName: "Generate rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_GENERATE",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      const periodId = await createOpenPeriod();

      const journal = await service.generateJournalFromRule(actor, {
        legalEntityId,
        triggerEventType: "TEST_GENERATE",
        journalNumber: "GEN-JNL-001",
        journalDate: "2026-01-15",
        accountingDate: "2026-01-15",
        periodId,
        amount: "100.00",
        idempotencyKey: `${TS}-gen-key-1`,
        description: null,
        currency: "USD",
      });

      expect(journal.status).toBe("pending");
      expect(journal.postingRuleVersionId).toBe(rule.id);

      const lines = await repo.listJournalLines(journal.id);
      expect(lines).toHaveLength(2);
      // Assert balance with exact string arithmetic, never via JavaScript
      // Number() — floats would mask the precision bug this module exists to
      // prevent. Money stays a string everywhere.
      const debitLegs = lines.filter((l) => l.debit !== "0.00");
      const creditLegs = lines.filter((l) => l.credit !== "0.00");
      const debitTotal = debitLegs.map((l) => l.debit).sort();
      const creditTotal = creditLegs.map((l) => l.credit).sort();
      expect(debitTotal).toEqual(creditTotal);
      expect(debitTotal.length + creditTotal.length).toBe(lines.length);
    });

    it("rejects a duplicate idempotency key with ConflictError", async () => {
      const actor = await actorWith([
        "finance.accounting.configure",
        "finance.accounting.manage",
        "finance.accounting.read",
      ]);
      await service.createPostingRule(actor, {
        ruleCode: "RULE_GENERATE_DUP",
        ruleName: "Generate dup rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_GENERATE_DUP",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      const periodId = await createOpenPeriod();
      const idempotencyKey = `${TS}-gen-key-dup`;

      await service.generateJournalFromRule(actor, {
        legalEntityId,
        triggerEventType: "TEST_GENERATE_DUP",
        journalNumber: "GEN-JNL-DUP-1",
        journalDate: "2026-01-15",
        accountingDate: "2026-01-15",
        periodId,
        amount: "100.00",
        idempotencyKey,
        description: null,
        currency: "USD",
      });

      await expect(
        service.generateJournalFromRule(actor, {
          legalEntityId,
          triggerEventType: "TEST_GENERATE_DUP",
          journalNumber: "GEN-JNL-DUP-2",
          journalDate: "2026-01-15",
          accountingDate: "2026-01-15",
          periodId,
          amount: "100.00",
          idempotencyKey,
          description: null,
          currency: "USD",
        }),
      ).rejects.toMatchObject({ name: "ConflictError" });
    });

    it("rejects when the accounting period is not open", async () => {
      const actor = await actorWith([
        "finance.accounting.configure",
        "finance.accounting.manage",
        "finance.accounting.read",
      ]);
      await service.createPostingRule(actor, {
        ruleCode: "RULE_GENERATE_CLOSED",
        ruleName: "Generate closed-period rule",
        ruleVersion: "v1",
        triggerEventType: "TEST_GENERATE_CLOSED",
        accountingFormula: [
          { accountCode: "1000", side: "debit", amountExpression: "AMOUNT" },
          { accountCode: "4000", side: "credit", amountExpression: "AMOUNT" },
        ],
        requiresApproval: false,
        materialityThreshold: null,
        effectiveDate: "2026-01-01",
      });
      const periodId = await createOpenPeriod();
      await pool.query(`UPDATE accounting_periods SET status = 'closed' WHERE id = $1`, [periodId]);

      await expect(
        service.generateJournalFromRule(actor, {
          legalEntityId,
          triggerEventType: "TEST_GENERATE_CLOSED",
          journalNumber: "GEN-JNL-CLOSED",
          journalDate: "2026-01-15",
          accountingDate: "2026-01-15",
          periodId,
          amount: "100.00",
          idempotencyKey: `${TS}-gen-key-closed`,
          description: null,
          currency: "USD",
        }),
      ).rejects.toMatchObject({ name: "ConflictError" });
    });
  });
});

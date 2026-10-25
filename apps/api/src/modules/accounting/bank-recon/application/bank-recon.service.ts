import type { ActorContext } from "../../../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../../domain/shared-kernel/errors.js";
import type { AuditService } from "../../../../application/audit/audit.service.js";
import type { RbacService } from "../../../../application/rbac/rbac.service.js";
import {
  type BankAccount,
  type BankMatch,
  type BankReconciliation,
  type BankStatementImport,
  type BankStatementLine,
  type MatchCandidate,
  type MatchKind,
  type PeriodMovement,
  type ReconciliationPolicy,
  CsvFormatError,
  MATCH_KINDS,
  RECONCILIATION_POLICIES,
  SUPPORTED_FORMAT_PROFILES,
  parseStatementCsv,
  toCents,
} from "../domain/bank-recon.entity.js";
import { PgBankReconRepository, ReconciliationError } from "../infrastructure/bank-recon.repository.pg.js";

/**
 * WP-FIN-A6-04 — Bank reconciliation (ADR-0018).
 *
 * The statement side is imported fact and the book side is Accounting Kernel
 * fact; this service reads both and writes neither over the other. Matching is
 * the only write path, and it always runs under the reconciliation row lock.
 */
export class BankReconService {
  constructor(
    private readonly repo: PgBankReconRepository,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  private unwrap<T>(fn: () => Promise<T>): Promise<T> {
    // A closed invariant maps to the API's conflict shape, not a 500.
    return fn().catch((err: unknown) => {
      if (err instanceof ReconciliationError) throw new ConflictError(err.message);
      throw err;
    });
  }

  // ------------------------------------------------------------------
  // Bank accounts
  // ------------------------------------------------------------------

  async createBankAccount(
    actor: ActorContext,
    input: {
      legalEntityId: string;
      bankName: string;
      houseBankCode: string;
      bankAccountId: string;
      accountNumberMasked: string;
      name: string;
      currency: string;
      ledgerAccountId: string;
      reconciliationPolicy: ReconciliationPolicy;
      effectiveFrom: string;
      effectiveTo?: string | null;
    },
  ): Promise<BankAccount> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");
    if (!RECONCILIATION_POLICIES.includes(input.reconciliationPolicy)) {
      throw new ValidationError(
        `reconciliationPolicy must be one of ${RECONCILIATION_POLICIES.join(", ")}`,
      );
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new ValidationError("currency must be a 3-letter ISO code");
    }
    if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
      throw new ValidationError("effectiveTo must not be before effectiveFrom");
    }
    // Only the masked identity is ever stored (ADR-0018 §1) — reject a value
    // that looks like a full account number instead of persisting it.
    if (/^\d{9,}$/.test(input.accountNumberMasked)) {
      throw new ValidationError(
        "accountNumberMasked must be masked (e.g. ****1234); full account numbers are never stored",
      );
    }

    const account = await this.unwrap(() =>
      this.repo.createBankAccount({
        ...input,
        effectiveTo: input.effectiveTo ?? null,
        tenantId: actor.tenantId,
        createdBy: actor.userId,
      }),
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.bank_account.created",
      entityType: "finance_bank_account",
      entityId: account.id,
      metadata: {
        legalEntityId: account.legalEntityId,
        houseBankCode: account.houseBankCode,
        ledgerAccountId: account.ledgerAccountId,
      },
    });
    return account;
  }

  async listBankAccounts(
    actor: ActorContext,
    filter: { legalEntityId?: string; isActive?: boolean },
  ): Promise<BankAccount[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listBankAccounts(actor.tenantId, filter);
  }

  async getBankAccount(actor: ActorContext, id: string): Promise<BankAccount> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const account = await this.repo.findBankAccountById(actor.tenantId, id);
    if (!account) throw new NotFoundError("BankAccount", id);
    return account;
  }

  // ------------------------------------------------------------------
  // Import (ADR-0018 §2)
  // ------------------------------------------------------------------

  /**
   * Import a statement file. The format profile is explicit — there is no
   * guessing at the shape of a file whose columns drive a reconciliation.
   *
   * Re-importing the same file fails closed at the unique import hash; a line
   * whose external id was already imported is kept but held in the review
   * queue rather than dropped or double-counted.
   */
  async importStatement(
    actor: ActorContext,
    input: { bankAccountId: string; formatProfile: string; sourceFileName: string; content: string },
  ): Promise<BankStatementImport & { lines: BankStatementLine[] }> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");
    if (!(SUPPORTED_FORMAT_PROFILES as readonly string[]).includes(input.formatProfile)) {
      throw new ValidationError(
        `formatProfile must be one of ${SUPPORTED_FORMAT_PROFILES.join(", ")}; other formats enter through the BankTransactionImporter port after separate review`,
      );
    }
    const account = await this.repo.findBankAccountById(actor.tenantId, input.bankAccountId);
    if (!account) throw new NotFoundError("BankAccount", input.bankAccountId);
    if (!account.isActive) throw new ValidationError("Bank account is not active");

    let parsed;
    try {
      parsed = parseStatementCsv(input.content);
    } catch (err) {
      if (err instanceof CsvFormatError) {
        throw new ValidationError(err.rowNumber === null ? err.message : `row ${err.rowNumber}: ${err.message}`);
      }
      throw err;
    }
    if (parsed.errors.length > 0) {
      const first = parsed.errors[0];
      throw new ValidationError(
        `statement has ${parsed.errors.length} malformed row(s); first at row ${first.rowNumber}: ${first.message}`,
      );
    }
    if (parsed.rows.length === 0) throw new ValidationError("statement contains no data rows");

    const { statementImport, lines } = await this.unwrap(() =>
      this.repo.importStatement({
        tenantId: actor.tenantId,
        bankAccountId: input.bankAccountId,
        formatProfile: input.formatProfile,
        sourceFileName: input.sourceFileName,
        rows: parsed.rows,
        importedBy: actor.userId,
      }),
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.bank_statement.imported",
      entityType: "finance_bank_statement_import",
      entityId: statementImport.id,
      metadata: {
        bankAccountId: input.bankAccountId,
        sourceFileName: statementImport.sourceFileName,
        lineCount: statementImport.lineCount,
        duplicateLineCount: statementImport.duplicateLineCount,
      },
    });
    return { ...statementImport, lines };
  }

  async listStatementLines(
    actor: ActorContext,
    filter: { bankAccountId?: string; importId?: string; includeDuplicates?: boolean },
  ): Promise<BankStatementLine[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listStatementLines(actor.tenantId, filter);
  }

  // ------------------------------------------------------------------
  // Reconciliations + matching (ADR-0018 §3)
  // ------------------------------------------------------------------

  async openReconciliation(
    actor: ActorContext,
    input: { bankAccountId: string; periodId: string },
  ): Promise<BankReconciliation> {
    await this.rbac.requirePermission(actor, "finance.accounting.configure");
    const account = await this.repo.findBankAccountById(actor.tenantId, input.bankAccountId);
    if (!account) throw new NotFoundError("BankAccount", input.bankAccountId);
    const recon = await this.unwrap(() =>
      this.repo.openReconciliation({
        tenantId: actor.tenantId,
        bankAccountId: input.bankAccountId,
        periodId: input.periodId,
        createdBy: actor.userId,
      }),
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.bank_reconciliation.opened",
      entityType: "finance_bank_reconciliation",
      entityId: recon.id,
      metadata: { bankAccountId: input.bankAccountId, periodId: input.periodId },
    });
    return recon;
  }

  async listReconciliations(
    actor: ActorContext,
    filter: { bankAccountId?: string },
  ): Promise<BankReconciliation[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listReconciliations(actor.tenantId, filter);
  }

  async getReconciliation(actor: ActorContext, id: string): Promise<BankReconciliation> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const recon = await this.repo.findReconciliationById(actor.tenantId, id);
    if (!recon) throw new NotFoundError("BankReconciliation", id);
    return recon;
  }

  /** Deterministic candidates — advisory, nothing written (ADR-0018 §3). */
  async suggestMatches(
    actor: ActorContext,
    statementLineId: string,
    options: { dateToleranceDays?: number } = {},
  ): Promise<MatchCandidate[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const line = await this.repo.findStatementLineById(actor.tenantId, statementLineId);
    if (!line) throw new NotFoundError("BankStatementLine", statementLineId);
    const account = await this.repo.findBankAccountById(actor.tenantId, line.bankAccountId);
    // A 'manual' policy means the tenant asked for no suggestions at all.
    if (!account || account.reconciliationPolicy === "manual") return [];
    const tolerance = options.dateToleranceDays ?? 3;
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 31) {
      throw new ValidationError("dateToleranceDays must be an integer between 0 and 31");
    }
    return this.repo.suggestCandidates(actor.tenantId, statementLineId, {
      dateToleranceDays: tolerance,
    });
  }

  async createMatch(
    actor: ActorContext,
    input: {
      reconciliationId: string;
      statementLineId: string;
      glEntryId: string;
      amount: string;
      matchKind: MatchKind;
      matchReason?: string | null;
      idempotencyKey: string;
      note?: string | null;
    },
  ): Promise<BankMatch> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");
    if (!MATCH_KINDS.includes(input.matchKind)) {
      throw new ValidationError(`matchKind must be one of ${MATCH_KINDS.join(", ")}`);
    }
    const cents = toCents(input.amount);
    if (cents === null || cents <= 0n) {
      throw new ValidationError("amount must be a positive 2-decimal money value");
    }

    const match = await this.unwrap(() =>
      this.repo.createMatch({
        ...input,
        matchReason: input.matchReason ?? null,
        note: input.note ?? null,
        tenantId: actor.tenantId,
        createdBy: actor.userId,
      }),
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.bank_match.created",
      entityType: "finance_bank_match",
      entityId: match.id,
      metadata: {
        reconciliationId: match.reconciliationId,
        statementLineId: match.statementLineId,
        glEntryId: match.glEntryId,
        amount: match.amount,
        matchKind: match.matchKind,
      },
    });
    return match;
  }

  /** Compensating unmatch — the original row stays (ADR-0018 §3). */
  async reverseMatch(
    actor: ActorContext,
    matchId: string,
    input: { idempotencyKey: string; note?: string | null },
  ): Promise<BankMatch> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");
    const match = await this.unwrap(() =>
      this.repo.reverseMatch({
        tenantId: actor.tenantId,
        matchId,
        idempotencyKey: input.idempotencyKey,
        note: input.note ?? null,
        createdBy: actor.userId,
      }),
    );
    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.bank_match.reversed",
      entityType: "finance_bank_match",
      entityId: match.id,
      metadata: { reversesId: match.reversesId },
    });
    return match;
  }

  async listMatches(actor: ActorContext, reconciliationId: string): Promise<BankMatch[]> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    return this.repo.listMatches(actor.tenantId, reconciliationId);
  }

  // ------------------------------------------------------------------
  // Balances + close
  // ------------------------------------------------------------------

  /**
   * Book movement vs statement movement for one period. Both are reported with
   * their source; neither is presented as the bank's own balance.
   */
  async periodMovement(
    actor: ActorContext,
    input: { bankAccountId: string; periodId: string },
  ): Promise<PeriodMovement> {
    await this.rbac.requirePermission(actor, "finance.accounting.read");
    const movement = await this.repo.periodMovement({
      tenantId: actor.tenantId,
      bankAccountId: input.bankAccountId,
      periodId: input.periodId,
    });
    if (!movement) throw new NotFoundError("BankAccount or AccountingPeriod", input.periodId);
    return movement;
  }

  /**
   * Close the reconciliation. Closing freezes the match set; a later correction
   * is a governed reopen or a compensating match, never an edit.
   */
  async closeReconciliation(
    actor: ActorContext,
    id: string,
    input: { statementBalance?: string | null },
  ): Promise<BankReconciliation> {
    await this.rbac.requirePermission(actor, "finance.accounting.approve");
    const recon = await this.repo.findReconciliationById(actor.tenantId, id);
    if (!recon) throw new NotFoundError("BankReconciliation", id);
    if (input.statementBalance !== undefined && input.statementBalance !== null) {
      if (toCents(input.statementBalance) === null) {
        throw new ValidationError("statementBalance must be a 2-decimal money value");
      }
    }

    // The book figure is read from the ledger at close time and frozen with the
    // statement figure, so what was certified stays reproducible.
    const movement = await this.repo.periodMovement({
      tenantId: actor.tenantId,
      bankAccountId: recon.bankAccountId,
      periodId: recon.periodId,
    });
    if (!movement) throw new ConflictError("Cannot close: the period or bank account no longer resolves");

    const closed = await this.unwrap(() =>
      this.repo.closeReconciliation({
        tenantId: actor.tenantId,
        reconciliationId: id,
        statementBalance: input.statementBalance ?? null,
        bookBalance: movement.bookMovement,
        closedBy: actor.userId,
      }),
    );

    await this.audit.record({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "accounting.bank_reconciliation.closed",
      entityType: "finance_bank_reconciliation",
      entityId: closed.id,
      metadata: {
        closedBookBalance: closed.closedBookBalance,
        closedStatementBalance: closed.closedStatementBalance,
        difference: movement.difference,
      },
    });
    return closed;
  }
}

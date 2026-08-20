import type { Pool, PoolClient, QueryResultRow } from "pg";
import type {
  CashflowCategoryLine,
  CashflowView,
  CreateAccountInput,
  CreateTransactionInput,
  FinanceAccount,
  FinanceAccountType,
  FinanceRepository,
  FinanceTransaction,
  Money,
  TransactionDirection,
  TransactionListFilter,
  UpdateAccountInput,
} from "../domain/finance.entity.js";

/**
 * Finance Core persistence (Phase 6).
 *
 * Two invariants shape this file:
 *
 * 1. **Money never becomes a JavaScript number.** node-postgres returns
 *    `numeric` as a string and it stays a string. Every addition,
 *    subtraction, and SUM below is written in SQL and evaluated by
 *    PostgreSQL in exact decimal arithmetic. There is no `Number()`,
 *    `parseFloat`, or `+` applied to a money value anywhere in this module's
 *    mutation path.
 *
 * 2. **A transaction and its balance effect are one atomic act.** Applying a
 *    transaction locks the account row, checks sufficiency inside the same
 *    UPDATE that moves the balance, and stamps `applied_at` under a
 *    `WHERE applied_at IS NULL` guard. Concurrent applies therefore queue up
 *    and each one moves the balance exactly once.
 */
export class PgFinanceRepository implements FinanceRepository {
  constructor(private readonly pool: Pool) {}

  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Cash / bank account master ---------------------------------------

  async createAccount(input: CreateAccountInput): Promise<FinanceAccount> {
    const r = await this.pool.query(
      `INSERT INTO finance_accounts
         (tenant_id, code, name, account_type, currency, description,
          legal_entity_id, organization_unit_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING *`,
      [
        input.tenantId,
        input.code,
        input.name,
        input.accountType,
        input.currency,
        input.description,
        input.legalEntityId,
        input.organizationUnitId,
        input.createdBy,
      ],
    );
    return toAccount(r.rows[0]);
  }

  async findAccountById(id: string): Promise<FinanceAccount | null> {
    const r = await this.pool.query(`SELECT * FROM finance_accounts WHERE id = $1`, [id]);
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async findAccountByCode(tenantId: string, code: string): Promise<FinanceAccount | null> {
    const r = await this.pool.query(`SELECT * FROM finance_accounts WHERE tenant_id = $1 AND code = $2`, [
      tenantId,
      code,
    ]);
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  async listAccounts(tenantId: string, filter: { activeOnly?: boolean }): Promise<FinanceAccount[]> {
    const conditions = [`tenant_id = $1`];
    if (filter.activeOnly) conditions.push(`is_active = true`);
    const r = await this.pool.query(
      `SELECT * FROM finance_accounts WHERE ${conditions.join(" AND ")} ORDER BY code`,
      [tenantId],
    );
    return r.rows.map(toAccount);
  }

  /** Balance is deliberately absent from this statement. */
  async updateAccount(
    id: string,
    input: UpdateAccountInput,
    updatedBy: string | null,
  ): Promise<FinanceAccount | null> {
    const r = await this.pool.query(
      `UPDATE finance_accounts
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              is_active = COALESCE($5, is_active),
              updated_by = $6, updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [id, input.name ?? null, input.description !== undefined, input.description ?? null, input.isActive ?? null, updatedBy],
    );
    return r.rows[0] ? toAccount(r.rows[0]) : null;
  }

  // --- Transactions ------------------------------------------------------

  async createTransaction(input: CreateTransactionInput): Promise<FinanceTransaction> {
    const r = await this.pool.query(
      `INSERT INTO finance_transactions
         (tenant_id, transaction_number, direction, amount, currency, transaction_date,
          account_id, category_code, description, reference,
          legal_entity_id, organization_unit_id, project_id, site_id, customer_id,
          recorded_by_user_id, reverses_transaction_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4::numeric,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
       RETURNING *`,
      [
        input.tenantId,
        input.transactionNumber,
        input.direction,
        // Bound as a STRING and cast in SQL — never through a JS number.
        input.amount,
        input.currency,
        input.transactionDate,
        input.accountId,
        input.categoryCode,
        input.description,
        input.reference,
        input.legalEntityId,
        input.organizationUnitId,
        input.projectId,
        input.siteId,
        input.customerId,
        input.recordedByUserId,
        input.reversesTransactionId,
        input.createdBy,
      ],
    );
    return toTransaction(r.rows[0]);
  }

  async findTransactionById(id: string): Promise<FinanceTransaction | null> {
    const r = await this.pool.query(`SELECT * FROM finance_transactions WHERE id = $1`, [id]);
    return r.rows[0] ? toTransaction(r.rows[0]) : null;
  }

  async listTransactions(tenantId: string, filter: TransactionListFilter): Promise<FinanceTransaction[]> {
    const conditions = [`tenant_id = $1`];
    const params: unknown[] = [tenantId];
    const add = (sql: (i: number) => string, value: unknown) => {
      params.push(value);
      conditions.push(sql(params.length));
    };
    if (filter.direction) add((i) => `direction = $${i}`, filter.direction);
    if (filter.accountId) add((i) => `account_id = $${i}`, filter.accountId);
    if (filter.categoryCode) add((i) => `category_code = $${i}`, filter.categoryCode);
    if (filter.customerId) add((i) => `customer_id = $${i}`, filter.customerId);
    if (filter.projectId) add((i) => `project_id = $${i}`, filter.projectId);
    if (filter.organizationUnitId) add((i) => `organization_unit_id = $${i}`, filter.organizationUnitId);
    if (filter.dateFrom) add((i) => `transaction_date >= $${i}::date`, filter.dateFrom);
    if (filter.dateTo) add((i) => `transaction_date <= $${i}::date`, filter.dateTo);
    if (filter.appliedOnly) conditions.push(`applied_at IS NOT NULL`);
    if (filter.pendingOnly) conditions.push(`applied_at IS NULL`);
    if (filter.search) {
      add(
        (i) => `(transaction_number ILIKE $${i} OR description ILIKE $${i} OR reference ILIKE $${i})`,
        `%${filter.search}%`,
      );
    }
    const r = await this.pool.query(
      `SELECT * FROM finance_transactions
        WHERE ${conditions.join(" AND ")}
        ORDER BY transaction_date DESC, created_at DESC`,
      params,
    );
    return r.rows.map(toTransaction);
  }

  async setTransactionWorkflowInstance(id: string, workflowInstanceId: string): Promise<void> {
    await this.pool.query(`UPDATE finance_transactions SET workflow_instance_id = $2 WHERE id = $1`, [
      id,
      workflowInstanceId,
    ]);
  }

  async applyTransaction(
    transactionId: string,
    appliedBy: string | null,
  ): Promise<{ transaction: FinanceTransaction; account: FinanceAccount } | { insufficient: true } | null> {
    return this.inTransaction(async (client) => {
      const found = await client.query(
        `SELECT * FROM finance_transactions WHERE id = $1 FOR UPDATE`,
        [transactionId],
      );
      if (!found.rows[0]) return null;
      const pending = toTransaction(found.rows[0]);
      if (pending.appliedAt) return null;

      // Serialises concurrent applies against the same account: the second
      // transaction waits here, then reads the balance the first committed.
      const locked = await client.query(`SELECT id FROM finance_accounts WHERE id = $1 FOR UPDATE`, [
        pending.accountId,
      ]);
      if (!locked.rows[0]) return null;

      // The sufficiency check lives INSIDE the statement that moves the
      // balance, so a stale read can never authorise an overdraw. All
      // arithmetic is PostgreSQL exact decimal.
      const moved = await client.query(
        `UPDATE finance_accounts
            SET balance = CASE WHEN $2 = 'income' THEN balance + $3::numeric ELSE balance - $3::numeric END,
                updated_at = now()
          WHERE id = $1
            AND ($2 = 'income' OR balance >= $3::numeric)
          RETURNING *`,
        [pending.accountId, pending.direction, pending.amount],
      );
      if (!moved.rows[0]) return { insufficient: true as const };

      const stamped = await client.query(
        `UPDATE finance_transactions
            SET applied_at = now(), applied_by_user_id = $2, updated_by = $2, updated_at = now()
          WHERE id = $1 AND applied_at IS NULL
          RETURNING *`,
        [transactionId, appliedBy],
      );
      // Somebody applied it between the lock and here: roll the balance back
      // rather than move money twice for one transaction.
      if (!stamped.rows[0]) return null;

      return { transaction: toTransaction(stamped.rows[0]), account: toAccount(moved.rows[0]) };
    });
  }

  async markTransactionReversed(
    id: string,
    reversalTransactionId: string,
    updatedBy: string | null,
  ): Promise<FinanceTransaction | null> {
    const r = await this.pool.query(
      `UPDATE finance_transactions
          SET reversed_by_transaction_id = $2, updated_by = $3, updated_at = now()
        WHERE id = $1 AND reversed_by_transaction_id IS NULL
        RETURNING *`,
      [id, reversalTransactionId, updatedBy],
    );
    return r.rows[0] ? toTransaction(r.rows[0]) : null;
  }

  // --- Cashflow ----------------------------------------------------------

  async cashflow(
    tenantId: string,
    filter: { from: string; to: string; accountId?: string; organizationUnitIds?: string[] },
  ): Promise<CashflowView> {
    const scope: string[] = [`t.tenant_id = $1`, `t.applied_at IS NOT NULL`];
    const params: unknown[] = [tenantId, filter.from, filter.to];
    if (filter.accountId) {
      params.push(filter.accountId);
      scope.push(`t.account_id = $${params.length}`);
    }
    if (filter.organizationUnitIds) {
      params.push(filter.organizationUnitIds);
      // A transaction with no unit is tenant-level and stays visible.
      scope.push(`(t.organization_unit_id IS NULL OR t.organization_unit_id = ANY($${params.length}::uuid[]))`);
    }
    const where = scope.join(" AND ");

    // Every figure is summed by PostgreSQL in exact decimal arithmetic and
    // returned as a string. Nothing here is added up in JavaScript.
    const totals = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN t.direction = 'income'  AND t.transaction_date <  $2::date THEN t.amount
                           WHEN t.direction = 'expense' AND t.transaction_date <  $2::date THEN -t.amount
                           ELSE 0 END), 0)::text AS opening,
         COALESCE(SUM(CASE WHEN t.direction = 'income'
                            AND t.transaction_date BETWEEN $2::date AND $3::date THEN t.amount
                           ELSE 0 END), 0)::text AS income,
         COALESCE(SUM(CASE WHEN t.direction = 'expense'
                            AND t.transaction_date BETWEEN $2::date AND $3::date THEN t.amount
                           ELSE 0 END), 0)::text AS expense
       FROM finance_transactions t
       WHERE ${where}`,
      params,
    );

    const byCategory = await this.pool.query(
      `SELECT t.category_code, t.direction, SUM(t.amount)::text AS amount
         FROM finance_transactions t
        WHERE ${where} AND t.transaction_date BETWEEN $2::date AND $3::date
        GROUP BY t.category_code, t.direction
        ORDER BY t.category_code, t.direction`,
      params,
    );

    // net and closing are computed in SQL too, from the same figures.
    const derived = await this.pool.query(
      `SELECT ($1::numeric - $2::numeric)::text AS net, ($3::numeric + $1::numeric - $2::numeric)::text AS closing`,
      [totals.rows[0].income, totals.rows[0].expense, totals.rows[0].opening],
    );

    return {
      from: filter.from,
      to: filter.to,
      opening: totals.rows[0].opening as Money,
      totals: {
        income: totals.rows[0].income as Money,
        expense: totals.rows[0].expense as Money,
        net: derived.rows[0].net as Money,
      },
      closing: derived.rows[0].closing as Money,
      byCategory: byCategory.rows.map(
        (row): CashflowCategoryLine => ({
          categoryCode: row.category_code,
          direction: row.direction as TransactionDirection,
          amount: row.amount as Money,
        }),
      ),
    };
  }

  async ledgerBalanceForAccount(accountId: string): Promise<Money> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'income' THEN amount ELSE -amount END), 0)::text AS total
         FROM finance_transactions
        WHERE account_id = $1 AND applied_at IS NOT NULL`,
      [accountId],
    );
    return r.rows[0].total as Money;
  }

  // --- Cross-domain reads kept behind this port -------------------------

  async legalEntityExists(tenantId: string, legalEntityId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM legal_entities WHERE id = $1 AND tenant_id = $2`, [
      legalEntityId,
      tenantId,
    ]);
    return r.rowCount! > 0;
  }

  async organizationUnitExists(tenantId: string, organizationUnitId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM organization_units WHERE id = $1 AND tenant_id = $2`, [
      organizationUnitId,
      tenantId,
    ]);
    return r.rowCount! > 0;
  }

  async projectExists(tenantId: string, projectId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM projects WHERE id = $1 AND tenant_id = $2`, [
      projectId,
      tenantId,
    ]);
    return r.rowCount! > 0;
  }

  async siteExists(tenantId: string, siteId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM sites WHERE id = $1 AND tenant_id = $2`, [siteId, tenantId]);
    return r.rowCount! > 0;
  }

  async customerExists(tenantId: string, customerId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM customers WHERE id = $1 AND tenant_id = $2`, [
      customerId,
      tenantId,
    ]);
    return r.rowCount! > 0;
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** pg returns a `date` column as a Date at LOCAL midnight; converting via
 * toISOString() would shift it a day for negative UTC offsets. Read the
 * local components instead (the Phase 3 calendar-date lesson). */
function toDateString(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/** `numeric` already arrives as a string — pass it through untouched. */
function toMoney(value: unknown): Money {
  return String(value);
}

function toAccount(row: QueryResultRow): FinanceAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    accountType: row.account_type as FinanceAccountType,
    currency: row.currency,
    description: row.description,
    legalEntityId: row.legal_entity_id,
    organizationUnitId: row.organization_unit_id,
    balance: toMoney(row.balance),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTransaction(row: QueryResultRow): FinanceTransaction {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    transactionNumber: row.transaction_number,
    direction: row.direction as TransactionDirection,
    amount: toMoney(row.amount),
    currency: row.currency,
    transactionDate: toDateString(row.transaction_date),
    accountId: row.account_id,
    categoryCode: row.category_code,
    description: row.description,
    reference: row.reference,
    legalEntityId: row.legal_entity_id,
    organizationUnitId: row.organization_unit_id,
    projectId: row.project_id,
    siteId: row.site_id,
    customerId: row.customer_id,
    workflowInstanceId: row.workflow_instance_id,
    recordedByUserId: row.recorded_by_user_id,
    appliedAt: row.applied_at,
    appliedByUserId: row.applied_by_user_id,
    reversesTransactionId: row.reverses_transaction_id,
    reversedByTransactionId: row.reversed_by_transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

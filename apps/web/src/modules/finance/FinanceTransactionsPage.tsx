/**
 * Phase 6 — Income and expense (FIN-CORE-001/002/006, FIN-CORE-011).
 *
 * One compact record form and one filterable list. Deliberately not a
 * general-ledger data-entry screen: there is no debit/credit, no journal
 * line, and no account code beyond the cash or bank account the money
 * actually moved through.
 *
 * The amount is typed and sent as TEXT. It is never parsed into a
 * JavaScript number anywhere in this module, so what the user types is
 * exactly what the database stores.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type Customer,
  type FinanceAccount,
  type FinanceTransactionRecord,
  type TransactionDirection,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  Textarea,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort } from "../../shared/format";
import { formatSigned, isValidAmountInput, monthRange } from "./money";

export function FinanceTransactionsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [transactions, setTransactions] = useState<FinanceTransactionRecord[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<{ code: string; label: string }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [filterDirection, setFilterDirection] = useState("");
  const [filterAccount, setFilterAccount] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [search, setSearch] = useState("");

  const [direction, setDirection] = useState<TransactionDirection>("income");
  const [amount, setAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState(monthRange().from);
  const [accountCode, setAccountCode] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTransactions(
        await api.financeTransactions(token, {
          direction: filterDirection || undefined,
          accountCode: filterAccount || undefined,
          categoryCode: filterCategory || undefined,
          state: filterState || undefined,
          dateFrom: filterFrom || undefined,
          dateTo: filterTo || undefined,
          search: search || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load transactions.");
    } finally {
      setLoading(false);
    }
  }, [token, filterDirection, filterAccount, filterCategory, filterState, filterFrom, filterTo, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const [accountList, categoryList, customerList] = await Promise.all([
        api.financeAccounts(token).catch(() => [] as FinanceAccount[]),
        api.financeCategories(token).catch(() => [] as { code: string; label: string }[]),
        api.customers(token).catch(() => [] as Customer[]),
      ]);
      setAccounts(accountList);
      setCategories(categoryList);
      setCustomers(customerList);
      const firstActive = accountList.find((a) => a.isActive);
      if (firstActive) setAccountCode((current) => current || firstActive.code);
      if (categoryList[0]) setCategoryCode((current) => current || categoryList[0].code);
    })();
  }, [token]);

  const accountOf = (id: string) => accounts.find((a) => a.id === id);
  const categoryLabel = (code: string) => categories.find((c) => c.code === code)?.label ?? code;
  const amountValid = isValidAmountInput(amount);

  async function record() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.recordFinanceTransaction(token, {
        direction,
        // Sent verbatim as text — no Number(), no parseFloat, no rounding.
        amount: amount.trim(),
        transactionDate,
        accountCode,
        categoryCode,
        customerId: customerId || null,
        reference: reference || null,
        description: description || null,
      });
      setNotice(
        `${created.transaction.transactionNumber} recorded and sent for approval. The balance moves once it is approved.`,
      );
      setAmount("");
      setReference("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the transaction.");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<FinanceTransactionRecord>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{row.transactionNumber}</span> },
    { header: "Date", cell: (row) => formatDateShort(row.transactionDate) },
    { header: "Category", cell: (row) => categoryLabel(row.categoryCode) },
    { header: "Account", cell: (row) => accountOf(row.accountId)?.code ?? "—" },
    {
      header: "Amount",
      className: "text-right tabular-nums whitespace-nowrap",
      cell: (row) => (
        <span className={row.direction === "income" ? "font-medium text-emerald-700" : "font-medium text-slate-800"}>
          {formatSigned(row.amount, row.direction, row.currency)}
        </span>
      ),
    },
    {
      header: "State",
      cell: (row) =>
        row.appliedAt ? (
          <StatusPill tone="success">Took effect</StatusPill>
        ) : (
          <StatusPill tone="warning">Awaiting approval</StatusPill>
        ),
    },
    {
      header: "Correction",
      cell: (row) =>
        row.reversesTransactionId ? (
          <Badge>Correction</Badge>
        ) : row.reversedByTransactionId ? (
          <Badge>Reversed</Badge>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Transactions" subtitle="What came in, what went out, and what it was for." />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Record money in or out</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Direction" required>
            <Select value={direction} onChange={(e) => setDirection(e.target.value as TransactionDirection)}>
              <option value="income">Money in</option>
              <option value="expense">Money out</option>
            </Select>
          </Field>
          <Field
            label="Amount"
            required
            hint={amount && !amountValid ? "Use digits with at most two decimals, e.g. 1250.75" : undefined}
          >
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1250.75"
              aria-invalid={amount !== "" && !amountValid}
            />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
          </Field>
          <Field label="Account" required>
            <Select value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
              <option value="">Select…</option>
              {accounts
                .filter((a) => a.isActive)
                .map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.name} ({a.currency})
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Category" required>
            <Select value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)}>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Customer">
            <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">None</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reference">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Receipt or transfer reference"
            />
          </Field>
          <div className="flex items-end">
            <Button disabled={busy || !amountValid || !accountCode || !categoryCode} onClick={() => void record()}>
              Record
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <Field label="Description">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this for?"
            />
          </Field>
        </div>
      </Card>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Number, reference, note" />
          </Field>
          <Field label="Direction">
            <Select value={filterDirection} onChange={(e) => setFilterDirection(e.target.value)}>
              <option value="">Any</option>
              <option value="income">Money in</option>
              <option value="expense">Money out</option>
            </Select>
          </Field>
          <Field label="Account">
            <Select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.code}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="State">
            <Select value={filterState} onChange={(e) => setFilterState(e.target.value)}>
              <option value="">Any</option>
              <option value="applied">Took effect</option>
              <option value="pending">Awaiting approval</option>
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </Field>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={transactions}
          keyOf={(row) => row.id}
          onRowClick={(row) => navigate(`/finance/transactions/${row.id}`)}
          empty={
            <EmptyState
              title="No transactions yet"
              description="Record the first receipt or payment above to start tracking cash."
            />
          }
        />
      )}
    </div>
  );
}

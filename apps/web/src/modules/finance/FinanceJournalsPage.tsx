/**
 * Wave A6.2 — General ledger journals (FIN-ADV-001).
 *
 * Write surface for the Accounting Kernel's journal lifecycle: draft, validate,
 * post, reverse. The kernel is the only writer of the general ledger, so this
 * page never computes a balance of its own — it shows what the kernel says and
 * asks the kernel to move the journal to its next state.
 *
 * Every amount is typed and sent as text. No Number(), no parseFloat: the
 * kernel decides what is balanced, and a value that passed through a float
 * would not be the value the operator entered.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingAccountRecord,
  type AccountingJournalInput,
  type AccountingJournalRecord,
  type AccountingPeriodRecord,
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
import { formatDateShort, formatMoney } from "../../shared/format";
import { useLegalEntities } from "./useLegalEntities";

const JOURNAL_TONES: Record<AccountingJournalRecord["status"], "neutral" | "success" | "warning" | "danger"> = {
  pending: "warning",
  posted: "success",
  failed: "danger",
  reversed: "neutral",
};

type DraftLine = { accountId: string; debit: string; credit: string; lineDescription: string };

const EMPTY_LINE: DraftLine = { accountId: "", debit: "", credit: "", lineDescription: "" };

export function FinanceJournalsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { entities, legalEntityId, setLegalEntityId } = useLegalEntities(token);

  const [periods, setPeriods] = useState<AccountingPeriodRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccountRecord[]>([]);
  const [journals, setJournals] = useState<AccountingJournalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [journalNumber, setJournalNumber] = useState("");
  const [journalDate, setJournalDate] = useState("");
  const [accountingDate, setAccountingDate] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);

  const [selected, setSelected] = useState<AccountingJournalRecord | null>(null);
  const [reversalReason, setReversalReason] = useState("");

  const load = useCallback(async () => {
    if (!legalEntityId) {
      setPeriods([]);
      setAccounts([]);
      setJournals([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [periodList, accountList] = await Promise.all([
        api.accountingPeriods(token, { legalEntityId }),
        api.accountingAccounts(token, { legalEntityId, activeOnly: true }),
      ]);
      setPeriods(periodList);
      setAccounts(accountList);
      // Journals are listed per period: the route takes `periodId`, not an
      // entity, so the open periods are the filter the page can offer.
      const openPeriods = periodList.filter((p) => p.status === "open" || p.status === "draft");
      const perPeriod = await Promise.all(
        openPeriods.map((p) => api.accountingJournals(token, { periodId: p.id }).catch(() => [])),
      );
      setJournals(perPeriod.flat());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load journals.");
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const periodLabel = (id: string) => {
    const period = periods.find((p) => p.id === id);
    return period ? `${period.periodCode} ${period.fiscalYearCode}` : id;
  };

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function createJournal() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: AccountingJournalInput = {
        legalEntityId,
        journalNumber: journalNumber.trim(),
        journalDate,
        accountingDate: accountingDate || journalDate,
        periodId,
        description: description || null,
        currency,
        lines: lines
          .filter((line) => line.accountId)
          .map((line, index) => ({
            accountId: line.accountId,
            lineNumber: index + 1,
            // Verbatim text, exactly as typed.
            debit: line.debit.trim() || "0",
            credit: line.credit.trim() || "0",
            lineDescription: line.lineDescription || null,
            projectId: null,
            siteId: null,
          })),
      };
      const created = await api.accountingCreateJournal(token, body);
      setNotice(`${created.journalNumber} created as a draft. Validate it, then post.`);
      setJournalNumber("");
      setDescription("");
      setLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the journal.");
    } finally {
      setBusy(false);
    }
  }

  async function validate(row: AccountingJournalRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.accountingValidateJournal(token, row.id);
      setNotice(
        result.balanced
          ? `${row.journalNumber} balances: debit ${formatMoney(result.debitTotal)} = credit ${formatMoney(result.creditTotal)}.`
          : `${row.journalNumber} does not balance: debit ${formatMoney(result.debitTotal)} against credit ${formatMoney(result.creditTotal)}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not validate the journal.");
    } finally {
      setBusy(false);
    }
  }

  async function post(row: AccountingJournalRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.accountingPostJournal(token, row.id);
      setNotice(`${row.journalNumber} posted to the ledger.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post the journal.");
    } finally {
      setBusy(false);
    }
  }

  async function reverse(row: AccountingJournalRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const reversal = await api.accountingReverseJournal(token, row.id, {
        type: "reverse_correct",
        reason: reversalReason.trim(),
      });
      setNotice(`Reversal ${reversal.journalNumber} created. ${row.journalNumber} is now reversed.`);
      setReversalReason("");
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reverse the journal.");
    } finally {
      setBusy(false);
    }
  }

  const openPeriods = periods.filter((p) => p.status === "open" || p.status === "draft");
  const canCreate =
    legalEntityId !== "" &&
    journalNumber.trim() !== "" &&
    journalDate !== "" &&
    periodId !== "" &&
    lines.some((line) => line.accountId);

  const columns: Column<AccountingJournalRecord>[] = [
    { header: "Number", mobileRole: "title", cell: (row) => <span className="font-mono text-xs font-medium text-ink">{row.journalNumber}</span> },
    { header: "Date", className: "tabular-nums", cell: (row) => formatDateShort(row.journalDate) },
    { header: "Period", cell: (row) => periodLabel(row.periodId) },
    { header: "Currency", cell: (row) => row.currency },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => <StatusPill tone={JOURNAL_TONES[row.status]}>{row.status}</StatusPill>,
    },
    {
      header: "Balanced",
      mobileRole: "detail",
      cell: (row) => (row.isBalanced ? <Badge>Balanced</Badge> : <Badge>Out of balance</Badge>),
    },
    {
      header: "Actions",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.status === "pending" ? (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void validate(row)}>
                Validate
              </Button>
              <Button disabled={busy} onClick={() => void post(row)}>
                Post
              </Button>
            </>
          ) : null}
          {row.status === "posted" ? (
            <Button variant="secondary" disabled={busy} onClick={() => setSelected(row)}>
              Reverse
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Journals"
        subtitle="Draft a journal, check that it balances, and post it to the ledger."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <Field label="Legal entity" required>
          <Select value={legalEntityId} onChange={(e) => setLegalEntityId(e.target.value)}>
            <option value="">Choose a legal entity</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {!legalEntityId ? (
        <EmptyState
          title="Choose a legal entity"
          description="Journals belong to one legal entity and one of its periods."
        />
      ) : (
        <>
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">New journal</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Journal number" required>
                <Input value={journalNumber} onChange={(e) => setJournalNumber(e.target.value)} placeholder="JV-2026-0001" />
              </Field>
              <Field label="Journal date" required>
                <Input type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} />
              </Field>
              <Field label="Accounting date" hint="Defaults to the journal date.">
                <Input type="date" value={accountingDate} onChange={(e) => setAccountingDate(e.target.value)} />
              </Field>
              <Field label="Period" required>
                <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                  <option value="">Select…</option>
                  {openPeriods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.periodName} ({period.periodCode} {period.fiscalYearCode})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Currency" required>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Description">
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>

            <h3 className="mb-2 mt-4 text-sm font-semibold text-ink">Lines</h3>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <Select
                      aria-label={`Account for line ${index + 1}`}
                      value={line.accountId}
                      onChange={(e) => updateLine(index, { accountId: e.target.value })}
                    >
                      <option value="">Account…</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.accountCode} — {account.accountName}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      aria-label={`Debit for line ${index + 1}`}
                      inputMode="decimal"
                      placeholder="Debit"
                      value={line.debit}
                      onChange={(e) => updateLine(index, { debit: e.target.value, credit: "" })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Input
                      aria-label={`Credit for line ${index + 1}`}
                      inputMode="decimal"
                      placeholder="Credit"
                      value={line.credit}
                      onChange={(e) => updateLine(index, { credit: e.target.value, debit: "" })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Input
                      aria-label={`Description for line ${index + 1}`}
                      placeholder="Line note"
                      value={line.lineDescription}
                      onChange={(e) => updateLine(index, { lineDescription: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-2 text-xs text-ink-faint">
              Each line takes a debit or a credit, never both. The kernel decides whether the journal balances when you
              validate it; this page never adds the figures up itself.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>
                Add line
              </Button>
              <Button disabled={busy || !canCreate} onClick={() => void createJournal()}>
                Create draft
              </Button>
            </div>
          </Card>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Journals in open periods</h2>
            {loading ? (
              <Spinner />
            ) : (
              <DataTable
                columns={columns}
                rows={journals}
                keyOf={(row) => row.id}
                empty={
                  <EmptyState
                    title="No journals yet"
                    description="Draft one above. It stays pending until it is validated and posted."
                  />
                }
              />
            )}
          </div>

          {selected ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink">Reverse {selected.journalNumber}</h2>
              <p className="mb-3 text-sm text-ink-dim">
                A reversal is a new journal that mirrors this one. The original keeps its history and is marked
                reversed; nothing is edited in place.
              </p>
              <Field label="Reason" required>
                <Input value={reversalReason} onChange={(e) => setReversalReason(e.target.value)} />
              </Field>
              <div className="mt-3 flex gap-2">
                <Button disabled={busy || reversalReason.trim() === ""} onClick={() => void reverse(selected)}>
                  Create reversal
                </Button>
                <Button variant="ghost" onClick={() => setSelected(null)}>
                  Cancel
                </Button>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

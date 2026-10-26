/**
 * Wave A6.5 — Fixed assets and depreciation (FIN-ADV-005).
 *
 * An asset book is one asset's value under one book code — the same asset can
 * sit in a tax book and a management book with different lives. A book starts
 * as a draft and only depreciates once it is active; activating it is a
 * deliberate step because from then on the monthly run picks it up.
 *
 * Depreciation is a run, not a per-asset action: one call for a legal entity,
 * a book code, and a period, and the service posts a single journal covering
 * every active book in it. That is why the page asks for a period rather than
 * an asset. Reversing a run is its own operation with a reason — the original
 * run keeps its history.
 *
 * Amounts are 2 decimals (ledger precision), sent as text.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingAccountRecord,
  type AccountingAssetBookRecord,
  type AccountingDepreciationRunRecord,
  type AccountingLedgerRecord,
  type AccountingPeriodRecord,
  type AssetRecord,
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
  type Column,
} from "../../shell/components/ui";
import { formatDateShort, formatMoney } from "../../shared/format";
import { isValidAmountInput } from "./money";
import { newIdempotencyKey, useLegalEntities } from "./useLegalEntities";

const BOOK_TONES: Record<AccountingAssetBookRecord["status"], "neutral" | "success" | "warning"> = {
  draft: "warning",
  active: "success",
  disposed: "neutral",
};

export function FinanceAssetsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { entities, legalEntityId, setLegalEntityId } = useLegalEntities(token);

  const [books, setBooks] = useState<AccountingAssetBookRecord[]>([]);
  const [runs, setRuns] = useState<AccountingDepreciationRunRecord[]>([]);
  const [ledgers, setLedgers] = useState<AccountingLedgerRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccountRecord[]>([]);
  const [periods, setPeriods] = useState<AccountingPeriodRecord[]>([]);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Book form
  const [ledgerId, setLedgerId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [bookCode, setBookCode] = useState("TAX");
  const [assetClass, setAssetClass] = useState("");
  const [capitalizationDate, setCapitalizationDate] = useState("");
  const [inServiceDate, setInServiceDate] = useState("");
  const [acquisitionCost, setAcquisitionCost] = useState("");
  const [residualValue, setResidualValue] = useState("0.00");
  const [usefulLifeMonths, setUsefulLifeMonths] = useState("60");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [accumulatedAccountId, setAccumulatedAccountId] = useState("");

  // Run form
  const [runBookCode, setRunBookCode] = useState("TAX");
  const [runPeriodId, setRunPeriodId] = useState("");

  const [disposeTarget, setDisposeTarget] = useState<AccountingAssetBookRecord | null>(null);
  const [disposeDate, setDisposeDate] = useState("");
  const [disposeEvidence, setDisposeEvidence] = useState("");
  const [disposeProceeds, setDisposeProceeds] = useState("");

  const [reverseTarget, setReverseTarget] = useState<AccountingDepreciationRunRecord | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const load = useCallback(async () => {
    if (!legalEntityId) {
      setBooks([]);
      setRuns([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [bookList, runList, ledgerList, accountList, periodList, assetList] = await Promise.all([
        api.accountingAssetBooks(token, { legalEntityId }),
        api.accountingDepreciationRuns(token, { legalEntityId }),
        api.accountingLedgers(token, legalEntityId).catch(() => []),
        api.accountingAccounts(token, { legalEntityId, activeOnly: true }),
        api.accountingPeriods(token, { legalEntityId }),
        api
          .assets(token)
          .then((result) => result.assets)
          .catch(() => [] as AssetRecord[]),
      ]);
      setBooks(bookList);
      setRuns(runList);
      setLedgers(ledgerList);
      setAccounts(accountList);
      setPeriods(periodList);
      setAssets(assetList);
      setLedgerId((current) => (ledgerList.some((l) => l.id === current) ? current : ledgerList[0]?.id ?? ""));
      setRunPeriodId((current) => (periodList.some((p) => p.id === current) ? current : periodList[0]?.id ?? ""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load asset books.");
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createBook() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingCreateAssetBook(token, {
        legalEntityId,
        ledgerId,
        assetId,
        bookCode: bookCode.trim().toUpperCase(),
        assetClass: assetClass.trim(),
        capitalizationDate,
        inServiceDate,
        // Verbatim text at 2 decimals.
        acquisitionCost: acquisitionCost.trim(),
        residualValue: residualValue.trim() || "0.00",
        usefulLifeMonths: Number(usefulLifeMonths),
        depreciationExpenseAccountId: expenseAccountId,
        accumulatedDepreciationAccountId: accumulatedAccountId,
      });
      setNotice(`${created.bookCode} book created as a draft. Activate it to start depreciating.`);
      setAssetClass("");
      setAcquisitionCost("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the asset book.");
    } finally {
      setBusy(false);
    }
  }

  async function activate(book: AccountingAssetBookRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.accountingActivateAssetBook(token, book.id);
      setNotice(`${book.bookCode} book activated. The next run will include it.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not activate the book.");
    } finally {
      setBusy(false);
    }
  }

  async function runDepreciation() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingRunDepreciation(token, {
        legalEntityId,
        bookCode: runBookCode.trim().toUpperCase(),
        periodId: runPeriodId,
        idempotencyKey: newIdempotencyKey(),
        description: null,
      });
      setNotice(
        `Depreciation posted for ${created.bookCode}: ${formatMoney(created.totalAmount)} ${created.currency}.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run depreciation.");
    } finally {
      setBusy(false);
    }
  }

  async function dispose() {
    if (!disposeTarget) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.accountingDisposeAssetBook(token, disposeTarget.id, {
        disposalDate: disposeDate,
        evidenceDocumentId: disposeEvidence.trim(),
        proceeds: disposeProceeds.trim() || null,
        note: null,
        idempotencyKey: newIdempotencyKey(),
      });
      setNotice(`${disposeTarget.bookCode} book disposed.`);
      setDisposeTarget(null);
      setDisposeDate("");
      setDisposeEvidence("");
      setDisposeProceeds("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not dispose the book.");
    } finally {
      setBusy(false);
    }
  }

  async function reverseRun() {
    if (!reverseTarget) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.accountingReverseDepreciationRun(token, reverseTarget.id, {
        idempotencyKey: newIdempotencyKey(),
        reason: reverseReason.trim(),
      });
      setNotice("Depreciation run reversed.");
      setReverseTarget(null);
      setReverseReason("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reverse the run.");
    } finally {
      setBusy(false);
    }
  }

  const assetLabel = (id: string) => {
    const asset = assets.find((a) => a.id === id);
    return asset ? `${asset.assetNumber} — ${asset.name}` : id;
  };
  const periodLabel = (id: string) => {
    const period = periods.find((p) => p.id === id);
    return period ? `${period.periodCode} ${period.fiscalYearCode}` : id;
  };

  const bookColumns: Column<AccountingAssetBookRecord>[] = [
    {
      header: "Asset",
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">{assetLabel(row.assetId)}</span>,
    },
    { header: "Book", cell: (row) => <Badge>{row.bookCode}</Badge> },
    { header: "Class", cell: (row) => row.assetClass },
    { header: "In service", className: "tabular-nums", cell: (row) => formatDateShort(row.inServiceDate) },
    {
      header: "Cost",
      className: "text-right tabular-nums whitespace-nowrap",
      mobileRole: "detail",
      cell: (row) => formatMoney(row.acquisitionCost),
    },
    {
      header: "Accumulated",
      className: "text-right tabular-nums whitespace-nowrap",
      cell: (row) => formatMoney(row.accumulatedDepreciation),
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => <StatusPill tone={BOOK_TONES[row.status]}>{row.status}</StatusPill>,
    },
    {
      header: "Actions",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.status === "draft" ? (
            <Button disabled={busy} onClick={() => void activate(row)}>
              Activate
            </Button>
          ) : null}
          {row.status === "active" ? (
            <Button variant="secondary" disabled={busy} onClick={() => setDisposeTarget(row)}>
              Dispose
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const runColumns: Column<AccountingDepreciationRunRecord>[] = [
    { header: "Book", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{row.bookCode}</span> },
    { header: "Period", cell: (row) => periodLabel(row.periodId) },
    {
      header: "Amount",
      className: "text-right tabular-nums whitespace-nowrap",
      mobileRole: "detail",
      cell: (row) => `${formatMoney(row.totalAmount)} ${row.currency}`,
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => (
        <StatusPill tone={row.status === "posted" ? "success" : "neutral"}>{row.status}</StatusPill>
      ),
    },
    {
      header: "Actions",
      cell: (row) =>
        row.status === "posted" ? (
          <Button variant="secondary" disabled={busy} onClick={() => setReverseTarget(row)}>
            Reverse
          </Button>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fixed assets"
        subtitle="Asset books, their depreciation runs, and what has been written off so far."
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
        <EmptyState title="Choose a legal entity" description="Asset books belong to one legal entity." />
      ) : loading ? (
        <Spinner />
      ) : (
        <>
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">New asset book</h2>
            <p className="mb-3 text-sm text-ink-dim">
              One asset can carry several books — a tax book and a management book usually have different lives. The
              two accounts below decide where the monthly expense and the accumulated total land.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Asset" required>
                <Select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                  <option value="">Select…</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.assetNumber} — {asset.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Ledger" required>
                <Select value={ledgerId} onChange={(e) => setLedgerId(e.target.value)}>
                  <option value="">Select…</option>
                  {ledgers.map((ledger) => (
                    <option key={ledger.id} value={ledger.id}>
                      {ledger.ledgerCode} — {ledger.ledgerName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Book code" required hint="e.g. TAX or MGT — whatever your books are called.">
                <Input value={bookCode} onChange={(e) => setBookCode(e.target.value)} />
              </Field>
              <Field label="Asset class" required>
                <Input value={assetClass} onChange={(e) => setAssetClass(e.target.value)} placeholder="Vehicle" />
              </Field>
              <Field label="Capitalized on" required>
                <Input type="date" value={capitalizationDate} onChange={(e) => setCapitalizationDate(e.target.value)} />
              </Field>
              <Field label="In service on" required>
                <Input type="date" value={inServiceDate} onChange={(e) => setInServiceDate(e.target.value)} />
              </Field>
              <Field
                label="Acquisition cost"
                required
                hint={acquisitionCost && !isValidAmountInput(acquisitionCost) ? "Digits with at most two decimals" : undefined}
              >
                <Input
                  inputMode="decimal"
                  value={acquisitionCost}
                  onChange={(e) => setAcquisitionCost(e.target.value)}
                  placeholder="250000000.00"
                  aria-invalid={acquisitionCost !== "" && !isValidAmountInput(acquisitionCost)}
                />
              </Field>
              <Field label="Residual value" hint="What it is expected to be worth at the end of its life.">
                <Input inputMode="decimal" value={residualValue} onChange={(e) => setResidualValue(e.target.value)} />
              </Field>
              <Field label="Useful life (months)" required>
                <Input
                  inputMode="numeric"
                  value={usefulLifeMonths}
                  onChange={(e) => setUsefulLifeMonths(e.target.value)}
                />
              </Field>
              <Field label="Expense account" required>
                <Select value={expenseAccountId} onChange={(e) => setExpenseAccountId(e.target.value)}>
                  <option value="">Select…</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountCode} — {account.accountName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Accumulated account" required>
                <Select value={accumulatedAccountId} onChange={(e) => setAccumulatedAccountId(e.target.value)}>
                  <option value="">Select…</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountCode} — {account.accountName}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Button
                disabled={
                  busy ||
                  !assetId ||
                  !ledgerId ||
                  !bookCode.trim() ||
                  !assetClass.trim() ||
                  !capitalizationDate ||
                  !inServiceDate ||
                  !isValidAmountInput(acquisitionCost) ||
                  !expenseAccountId ||
                  !accumulatedAccountId
                }
                onClick={() => void createBook()}
              >
                Create book
              </Button>
            </div>
          </Card>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Asset books</h2>
            <DataTable
              columns={bookColumns}
              rows={books}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No asset books" description="Create one above." />}
            />
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">Run depreciation</h2>
            <p className="mb-3 text-sm text-ink-dim">
              One run covers every active book with this book code in this period, and posts a single journal. Running
              the same period twice with the same key posts once.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Book code" required>
                <Input value={runBookCode} onChange={(e) => setRunBookCode(e.target.value)} />
              </Field>
              <Field label="Period" required>
                <Select value={runPeriodId} onChange={(e) => setRunPeriodId(e.target.value)}>
                  <option value="">Select…</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {period.periodName} ({period.periodCode} {period.fiscalYearCode})
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button
                  disabled={busy || !runBookCode.trim() || !runPeriodId || !books.some((b) => b.status === "active")}
                  onClick={() => void runDepreciation()}
                >
                  Run
                </Button>
              </div>
            </div>
            {!books.some((b) => b.status === "active") ? (
              <p className="mt-2 text-xs text-ink-faint">
                Nothing is active yet, so a run would post nothing. Activate a book first.
              </p>
            ) : null}
          </Card>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Depreciation runs</h2>
            <DataTable
              columns={runColumns}
              rows={runs}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No runs" description="Depreciation has not been run yet." />}
            />
          </div>

          {disposeTarget ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink">Dispose {disposeTarget.bookCode} book</h2>
              <p className="mb-3 text-sm text-ink-dim">
                A disposal needs the document that evidences it. Proceeds are optional — leave them out when the asset
                was scrapped rather than sold.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Disposal date" required>
                  <Input type="date" value={disposeDate} onChange={(e) => setDisposeDate(e.target.value)} />
                </Field>
                <Field label="Evidence document id" required>
                  <Input
                    value={disposeEvidence}
                    onChange={(e) => setDisposeEvidence(e.target.value)}
                    placeholder="UUID"
                  />
                </Field>
                <Field label="Proceeds">
                  <Input
                    inputMode="decimal"
                    value={disposeProceeds}
                    onChange={(e) => setDisposeProceeds(e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
              </div>
              <div className="mt-3 flex gap-2">
                <Button disabled={busy || !disposeDate || !disposeEvidence.trim()} onClick={() => void dispose()}>
                  Dispose
                </Button>
                <Button variant="ghost" onClick={() => setDisposeTarget(null)}>
                  Cancel
                </Button>
              </div>
            </Card>
          ) : null}

          {reverseTarget ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink">
                Reverse {reverseTarget.bookCode} run for {periodLabel(reverseTarget.periodId)}
              </h2>
              <p className="mb-3 text-sm text-ink-dim">
                The reversal is a second run that mirrors the first. The original stays in the history.
              </p>
              <Field label="Reason" required>
                <Input value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} />
              </Field>
              <div className="mt-3 flex gap-2">
                <Button disabled={busy || reverseReason.trim() === ""} onClick={() => void reverseRun()}>
                  Reverse run
                </Button>
                <Button variant="ghost" onClick={() => setReverseTarget(null)}>
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

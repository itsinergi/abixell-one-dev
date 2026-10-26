/**
 * Wave A8 — Period management and closing (FIN-ADV-007).
 *
 * Write surface for the Accounting Kernel's period lifecycle: lock, request reopen,
 * close month-end, close year-end. Also: create ledgers, approve charts, and
 * reverse bank matches. The kernel owns the closing decision; this page asks it
 * to move periods through their lifecycle states.
 *
 * The legal entity is required: all operations are per-entity. Every amount is
 * typed and sent as text. No Number(), no parseFloat.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingBankAccountRecord,
  type AccountingBankMatchRecord,
  type AccountingBankReconciliationRecord,
  type AccountingChartRecord,
  type AccountingCloseAttestation,
  type AccountingLedgerRecord,
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
import { formatDate, formatMoney } from "../../shared/format";
import { useLegalEntities, newIdempotencyKey } from "./useLegalEntities";

const PERIOD_TONES: Record<AccountingPeriodRecord["status"], "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  open: "info",
  closed: "success",
  reopenable: "warning",
  tombstone: "danger",
};

const PERIOD_LABELS: Record<AccountingPeriodRecord["status"], string> = {
  draft: "Draft",
  open: "Open",
  closed: "Closed",
  reopenable: "Reopenable",
  tombstone: "Tombstone",
};

const ATTESTATIONS: { key: keyof AccountingCloseAttestation; label: string }[] = [
  { key: "bankReconConfirmed", label: "Bank reconciliation confirmed" },
  { key: "apArConfirmed", label: "AP and AR confirmed" },
  { key: "depreciationConfirmed", label: "Depreciation runs completed" },
  { key: "accrualsConfirmed", label: "Accruals and deferred items confirmed" },
];

function AttestationChecks({
  value,
  onChange,
}: {
  value: AccountingCloseAttestation;
  onChange: (attest: AccountingCloseAttestation) => void;
}) {
  return (
    <div className="space-y-2">
      {ATTESTATIONS.map((item) => (
        <label key={item.key} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value[item.key]}
            onChange={(e) => onChange({ ...value, [item.key]: e.target.checked })}
            className="cursor-pointer rounded border border-border bg-surface"
          />
          <span className="text-sm text-ink">{item.label}</span>
        </label>
      ))}
    </div>
  );
}

type ModalState =
  | { kind: "none" }
  | { kind: "lock"; period: AccountingPeriodRecord }
  | { kind: "reopen"; period: AccountingPeriodRecord }
  | { kind: "close-month"; period: AccountingPeriodRecord }
  | { kind: "close-year"; period: AccountingPeriodRecord }
  | { kind: "create-ledger" }
  | { kind: "approve-chart" }
  | { kind: "reverse-bank-match" };

export function FinancePeriodsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { entities, legalEntityId, setLegalEntityId } = useLegalEntities(token);

  const [periods, setPeriods] = useState<AccountingPeriodRecord[]>([]);
  const [charts, setCharts] = useState<AccountingChartRecord[]>([]);
  const [ledgers, setLedgers] = useState<AccountingLedgerRecord[]>([]);
  const [bankAccounts, setBankAccounts] = useState<AccountingBankAccountRecord[]>([]);
  const [bankReconciliations, setBankReconciliations] = useState<AccountingBankReconciliationRecord[]>([]);
  const [bankMatches, setBankMatches] = useState<AccountingBankMatchRecord[]>([]);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>({ kind: "none" });

  // Lock modal state
  const [lockReason, setLockReason] = useState("");

  // Reopen modal state
  const [reopenReason, setReopenReason] = useState("");
  const [reopenImpactEvidence, setReopenImpactEvidence] = useState("");

  // Close month-end/year-end modal state
  const [closeAttestation, setCloseAttestation] = useState<AccountingCloseAttestation>({
    bankReconConfirmed: false,
    apArConfirmed: false,
    depreciationConfirmed: false,
    accrualsConfirmed: false,
  });

  // Create ledger modal state
  const [ledgerCode, setLedgerCode] = useState("");
  const [ledgerName, setLedgerName] = useState("");
  const [ledgerCurrency, setLedgerCurrency] = useState("IDR");

  // Approve chart modal state
  const [selectedChartId, setSelectedChartId] = useState("");

  // Reverse bank match modal state
  const [selectedBankAccountId, setSelectedBankAccountId] = useState("");
  const [selectedReconciliationId, setSelectedReconciliationId] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [matchNote, setMatchNote] = useState("");

  const load = useCallback(async () => {
    if (!legalEntityId) {
      setPeriods([]);
      setCharts([]);
      setLedgers([]);
      setBankAccounts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [periodList, chartList, ledgerList, accountList] = await Promise.all([
        api.accountingPeriods(token, { legalEntityId }),
        api.accountingCharts(token, { legalEntityId }),
        api.accountingLedgers(token, legalEntityId),
        api.accountingBankAccounts(token, { legalEntityId }),
      ]);
      setPeriods(periodList);
      setCharts(chartList);
      setLedgers(ledgerList);
      setBankAccounts(accountList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load accounting records.");
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load reconciliations when a bank account is selected
  useEffect(() => {
    if (modal.kind === "reverse-bank-match" && selectedBankAccountId) {
      void (async () => {
        try {
          const recs = await api.accountingBankReconciliations(token, { bankAccountId: selectedBankAccountId });
          setBankReconciliations(recs);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not load reconciliations.");
        }
      })();
    }
  }, [modal.kind, selectedBankAccountId, token]);

  // Load matches when a reconciliation is selected
  useEffect(() => {
    if (modal.kind === "reverse-bank-match" && selectedReconciliationId) {
      void (async () => {
        try {
          const matches = await api.accountingBankMatches(token, selectedReconciliationId);
          setBankMatches(matches);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not load matches.");
        }
      })();
    }
  }, [modal.kind, selectedReconciliationId, token]);

  async function lockPeriod(period: AccountingPeriodRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.accountingLockPeriod(token, period.id, { reason: lockReason.trim() });
      setNotice(`${period.periodName} locked.`);
      setLockReason("");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not lock the period.");
    } finally {
      setBusy(false);
    }
  }

  async function requestReopen(period: AccountingPeriodRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.accountingRequestReopen(token, period.id, {
        reason: reopenReason.trim(),
        impactEvidence: reopenImpactEvidence.trim(),
      });
      setNotice(`Reopen request submitted for ${period.periodName}.`);
      setReopenReason("");
      setReopenImpactEvidence("");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not request reopen.");
    } finally {
      setBusy(false);
    }
  }

  async function closeMonthEnd(period: AccountingPeriodRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const closing = await api.accountingCloseMonthEnd(token, period.id, closeAttestation);
      setNotice(`${period.periodName} month-end closed at ${formatDate(closing.closedAt)}.`);
      setCloseAttestation({
        bankReconConfirmed: false,
        apArConfirmed: false,
        depreciationConfirmed: false,
        accrualsConfirmed: false,
      });
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not close the month.");
    } finally {
      setBusy(false);
    }
  }

  async function closeYearEnd(period: AccountingPeriodRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const closing = await api.accountingCloseYearEnd(token, period.id, closeAttestation);
      setNotice(`${period.periodName} year-end closed at ${formatDate(closing.closedAt)}.`);
      setCloseAttestation({
        bankReconConfirmed: false,
        apArConfirmed: false,
        depreciationConfirmed: false,
        accrualsConfirmed: false,
      });
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not close the year.");
    } finally {
      setBusy(false);
    }
  }

  async function createLedger() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const ledger = await api.accountingCreateLedger(token, {
        legalEntityId,
        ledgerCode: ledgerCode.trim(),
        ledgerName: ledgerName.trim(),
        currency: ledgerCurrency.toUpperCase(),
      });
      setNotice(`Ledger ${ledger.ledgerCode} created.`);
      setLedgerCode("");
      setLedgerName("");
      setLedgerCurrency("IDR");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the ledger.");
    } finally {
      setBusy(false);
    }
  }

  async function approveChart() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const chart = await api.accountingApproveChart(token, selectedChartId);
      setNotice(`Chart ${chart.coaVersionCode} approved.`);
      setSelectedChartId("");
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve the chart.");
    } finally {
      setBusy(false);
    }
  }

  async function reverseBankMatch() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const match = await api.accountingReverseBankMatch(token, selectedMatchId, {
        idempotencyKey: newIdempotencyKey(),
        note: matchNote.trim() || null,
      });
      setNotice(`Bank match ${match.id} reversed.`);
      setMatchNote("");
      setSelectedBankAccountId("");
      setSelectedReconciliationId("");
      setSelectedMatchId("");
      setBankMatches([]);
      setBankReconciliations([]);
      setModal({ kind: "none" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reverse the match.");
    } finally {
      setBusy(false);
    }
  }

  const periodColumns: Column<AccountingPeriodRecord>[] = [
    {
      header: "Period",
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">{row.periodName}</span>,
    },
    { header: "Year", cell: (row) => row.fiscalYearCode },
    { header: "Type", cell: (row) => <Badge>{row.periodType}</Badge> },
    { header: "From", className: "tabular-nums", cell: (row) => formatDate(row.dateFrom) },
    { header: "To", className: "tabular-nums", cell: (row) => formatDate(row.dateTo) },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => <StatusPill tone={PERIOD_TONES[row.status]}>{PERIOD_LABELS[row.status]}</StatusPill>,
    },
    {
      header: "Actions",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.status === "open" ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setModal({ kind: "lock", period: row });
                setLockReason("");
              }}
            >
              Lock
            </Button>
          ) : null}
          {row.status === "reopenable" ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setModal({ kind: "reopen", period: row });
                setReopenReason("");
                setReopenImpactEvidence("");
              }}
            >
              Request reopen
            </Button>
          ) : null}
          {row.status === "open" ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setModal({ kind: "close-month", period: row });
                  setCloseAttestation({
                    bankReconConfirmed: false,
                    apArConfirmed: false,
                    depreciationConfirmed: false,
                    accrualsConfirmed: false,
                  });
                }}
              >
                Close month-end
              </Button>
              {row.periodType === "annual" ? (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setModal({ kind: "close-year", period: row });
                    setCloseAttestation({
                      bankReconConfirmed: false,
                      apArConfirmed: false,
                      depreciationConfirmed: false,
                      accrualsConfirmed: false,
                    });
                  }}
                >
                  Close year-end
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ),
    },
  ];

  const chartColumns: Column<AccountingChartRecord>[] = [
    { header: "Version", mobileRole: "title", cell: (row) => <span className="font-mono text-xs text-ink">{row.coaVersionCode}</span> },
    { header: "Date", className: "tabular-nums", cell: (row) => formatDate(row.coaVersionDate) },
    { header: "Template", cell: (row) => (row.templateType ? <Badge>{row.templateType}</Badge> : "Custom") },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) =>
        row.coaStatus === "approved" ? (
          <StatusPill tone="success">Approved</StatusPill>
        ) : (
          <StatusPill tone="warning">Draft</StatusPill>
        ),
    },
  ];

  const draftCharts = charts.filter((c) => c.coaStatus === "draft");
  const canLock = modal.kind === "lock" ? lockReason.trim() !== "" : false;
  const canReopen =
    modal.kind === "reopen" ? reopenReason.trim() !== "" && reopenImpactEvidence.trim() !== "" : false;
  const canCloseMonth =
    modal.kind === "close-month"
      ? closeAttestation.bankReconConfirmed &&
        closeAttestation.apArConfirmed &&
        closeAttestation.depreciationConfirmed &&
        closeAttestation.accrualsConfirmed
      : false;
  const canCloseYear =
    modal.kind === "close-year"
      ? closeAttestation.bankReconConfirmed &&
        closeAttestation.apArConfirmed &&
        closeAttestation.depreciationConfirmed &&
        closeAttestation.accrualsConfirmed
      : false;
  const canCreateLedger = modal.kind === "create-ledger" ? ledgerCode.trim() !== "" && ledgerName.trim() !== "" : false;
  const canApproveChart = modal.kind === "approve-chart" ? selectedChartId !== "" : false;
  const canReverseMatch =
    modal.kind === "reverse-bank-match"
      ? selectedBankAccountId !== "" && selectedReconciliationId !== "" && selectedMatchId !== ""
      : false;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Periods and Closing"
        subtitle="Lock periods, close month-ends and year-ends. Also create ledgers, approve charts, and reverse bank matches."
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
          description="Periods, ledgers, and charts belong to one legal entity."
        />
      ) : loading ? (
        <Spinner />
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Periods</h2>
            <DataTable
              columns={periodColumns}
              rows={periods}
              keyOf={(row) => row.id}
              empty={
                <EmptyState
                  title="No periods yet"
                  description="A legal entity needs at least one accounting period."
                />
              }
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Ledgers</h2>
            <div className="mb-3 flex gap-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setModal({ kind: "create-ledger" });
                  setLedgerCode("");
                  setLedgerName("");
                  setLedgerCurrency("IDR");
                }}
              >
                Create ledger
              </Button>
            </div>
            {ledgers.length === 0 ? (
              <EmptyState
                title="No ledgers yet"
                description="Create one to back a chart of accounts."
              />
            ) : (
              <Card>
                <div className="space-y-2">
                  {ledgers.map((ledger) => (
                    <div key={ledger.id} className="flex items-center justify-between border-b border-border pb-2 last:border-b-0">
                      <div>
                        <p className="font-medium text-ink">{ledger.ledgerName}</p>
                        <p className="text-xs text-ink-faint">
                          {ledger.ledgerCode} in {ledger.currency}
                          {ledger.isPrimary && " (Primary)"}
                        </p>
                      </div>
                      {ledger.isActive ? <StatusPill tone="success">Active</StatusPill> : <StatusPill>Inactive</StatusPill>}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Charts of Accounts</h2>
            <div className="mb-3 flex gap-2">
              <Button
                variant="secondary"
                disabled={busy || draftCharts.length === 0}
                onClick={() => {
                  setModal({ kind: "approve-chart" });
                  setSelectedChartId("");
                }}
              >
                Approve chart
              </Button>
            </div>
            {charts.length === 0 ? (
              <EmptyState
                title="No charts yet"
                description="A chart of accounts defines the account structure for this entity."
              />
            ) : (
              <DataTable
                columns={chartColumns}
                rows={charts}
                keyOf={(row) => row.id}
                empty={<EmptyState title="No charts" description="None found." />}
              />
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Bank Reconciliation</h2>
            <div className="mb-3 flex gap-2">
              <Button
                variant="secondary"
                disabled={busy || bankAccounts.length === 0}
                onClick={() => {
                  setModal({ kind: "reverse-bank-match" });
                  setSelectedBankAccountId("");
                  setSelectedReconciliationId("");
                  setSelectedMatchId("");
                  setMatchNote("");
                  setBankReconciliations([]);
                  setBankMatches([]);
                }}
              >
                Reverse bank match
              </Button>
            </div>
            {bankAccounts.length === 0 ? (
              <EmptyState
                title="No bank accounts"
                description="Set up bank accounts to begin reconciliation."
              />
            ) : (
              <Card>
                <div className="space-y-2">
                  {bankAccounts.map((account) => (
                    <div key={account.id} className="border-b border-border pb-2 last:border-b-0">
                      <p className="font-medium text-ink">{account.name}</p>
                      <p className="text-xs text-ink-faint">
                        {account.bankName} (Account {account.accountNumberMasked}) in {account.currency}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}

      {modal.kind === "lock" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Lock {modal.period.periodName}</h2>
          <p className="mb-3 text-sm text-ink-dim">A locked period cannot be written to. It can only be reopened by request.</p>
          <Field label="Reason" required>
            <Input
              value={lockReason}
              onChange={(e) => setLockReason(e.target.value)}
              placeholder="Audited and verified"
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !canLock} onClick={() => lockPeriod(modal.period)}>
              Lock period
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "reopen" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Request reopen of {modal.period.periodName}</h2>
          <p className="mb-3 text-sm text-ink-dim">A reopen request goes to an approver. The period stays locked until approval.</p>
          <Field label="Reason" required>
            <Input
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              placeholder="Error found in audit"
            />
          </Field>
          <Field label="Impact evidence" required>
            <Textarea
              rows={3}
              value={reopenImpactEvidence}
              onChange={(e) => setReopenImpactEvidence(e.target.value)}
              placeholder="What accounts or balances will be affected"
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !canReopen} onClick={() => requestReopen(modal.period)}>
              Submit request
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "close-month" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Close month-end for {modal.period.periodName}</h2>
          <p className="mb-3 text-sm text-ink-dim">Confirm all reconciliations and accruals are complete and reviewed.</p>
          <AttestationChecks value={closeAttestation} onChange={setCloseAttestation} />
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !canCloseMonth} onClick={() => closeMonthEnd(modal.period)}>
              Confirm close
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "close-year" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Close year-end for {modal.period.periodName}</h2>
          <p className="mb-3 text-sm text-ink-dim">Confirm all reconciliations, accruals, and month-ends are complete for the year.</p>
          <AttestationChecks value={closeAttestation} onChange={setCloseAttestation} />
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !canCloseYear} onClick={() => closeYearEnd(modal.period)}>
              Confirm close
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "create-ledger" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Create ledger</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Ledger code" required>
              <Input
                value={ledgerCode}
                onChange={(e) => setLedgerCode(e.target.value)}
                placeholder="GL-PRIMARY"
              />
            </Field>
            <Field label="Ledger name" required>
              <Input
                value={ledgerName}
                onChange={(e) => setLedgerName(e.target.value)}
                placeholder="Primary General Ledger"
              />
            </Field>
            <Field label="Currency" required>
              <Input
                value={ledgerCurrency}
                onChange={(e) => setLedgerCurrency(e.target.value.toUpperCase())}
                maxLength={3}
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !canCreateLedger} onClick={() => createLedger()}>
              Create ledger
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "approve-chart" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Approve chart of accounts</h2>
          <Field label="Chart" required>
            <Select value={selectedChartId} onChange={(e) => setSelectedChartId(e.target.value)}>
              <option value="">Select a draft chart</option>
              {draftCharts.map((chart) => (
                <option key={chart.id} value={chart.id}>
                  {chart.coaVersionCode} (created {formatDate(chart.coaVersionDate)})
                </option>
              ))}
            </Select>
          </Field>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !canApproveChart} onClick={() => approveChart()}>
              Approve chart
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      {modal.kind === "reverse-bank-match" ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Reverse bank match</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Bank account" required>
              <Select
                value={selectedBankAccountId}
                onChange={(e) => {
                  setSelectedBankAccountId(e.target.value);
                  setSelectedReconciliationId("");
                  setSelectedMatchId("");
                  setBankMatches([]);
                }}
              >
                <option value="">Select a bank account</option>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reconciliation" required>
              <Select
                value={selectedReconciliationId}
                onChange={(e) => {
                  setSelectedReconciliationId(e.target.value);
                  setSelectedMatchId("");
                  setBankMatches([]);
                }}
              >
                <option value="">Select a reconciliation</option>
                {bankReconciliations.map((recon) => (
                  <option key={recon.id} value={recon.id}>
                    {recon.status} (closed at {recon.closedAt ? formatDate(recon.closedAt) : "open"})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Match" required>
              <Select
                value={selectedMatchId}
                onChange={(e) => setSelectedMatchId(e.target.value)}
              >
                <option value="">Select a match</option>
                {bankMatches.map((match) => (
                  <option key={match.id} value={match.id}>
                    {formatMoney(match.amount)} ({match.matchKind})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Note (optional)">
            <Textarea
              rows={2}
              value={matchNote}
              onChange={(e) => setMatchNote(e.target.value)}
              placeholder="Reason for reversal"
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button disabled={busy || !canReverseMatch} onClick={() => reverseBankMatch()}>
              Reverse match
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

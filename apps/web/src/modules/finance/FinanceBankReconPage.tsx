/**
 * Wave A6.4 — Bank reconciliation (FIN-ADV-004).
 *
 * The statement says what the bank thinks happened; the ledger says what the
 * books think happened. Reconciliation is the act of pairing them, line by
 * line, until only the genuinely unexplained differences are left.
 *
 * This page does not decide which pairing is right. `suggestMatches` proposes
 * candidates with a score and its reasons; the operator picks one, or matches a
 * ledger entry by hand. Closing a reconciliation is the service's call too — it
 * compares the two balances and refuses while unexplained differences remain.
 *
 * Statement import is CSV-first (ADR-0018 §2): the file is read as text in the
 * browser and sent as text. Nothing is parsed here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingAccountRecord,
  type AccountingBankAccountRecord,
  type AccountingBankMatchRecord,
  type AccountingBankPeriodMovement,
  type AccountingBankReconciliationRecord,
  type AccountingBankStatementLineRecord,
  type AccountingMatchCandidate,
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
  type Column,
} from "../../shell/components/ui";
import { formatDateShort, formatMoney } from "../../shared/format";
import { isValidAmountInput } from "./money";
import { newIdempotencyKey, useLegalEntities } from "./useLegalEntities";

export function FinanceBankReconPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { entities, legalEntityId, setLegalEntityId } = useLegalEntities(token);

  const [accounts, setAccounts] = useState<AccountingBankAccountRecord[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<AccountingAccountRecord[]>([]);
  const [periods, setPeriods] = useState<AccountingPeriodRecord[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Registration form
  const [bankName, setBankName] = useState("");
  const [houseBankCode, setHouseBankCode] = useState("");
  const [externalAccountId, setExternalAccountId] = useState("");
  const [masked, setMasked] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("IDR");
  const [ledgerAccountId, setLedgerAccountId] = useState("");
  const [policy, setPolicy] = useState<"manual" | "suggested">("manual");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  // Statement import
  const fileInput = useRef<HTMLInputElement>(null);
  const [importName, setImportName] = useState("");

  const [lines, setLines] = useState<AccountingBankStatementLineRecord[]>([]);
  const [reconciliations, setReconciliations] = useState<AccountingBankReconciliationRecord[]>([]);
  const [reconId, setReconId] = useState("");
  const [matches, setMatches] = useState<AccountingBankMatchRecord[]>([]);
  const [movement, setMovement] = useState<AccountingBankPeriodMovement | null>(null);
  const [closeBalance, setCloseBalance] = useState("");

  // Matching
  const [lineId, setLineId] = useState("");
  const [candidates, setCandidates] = useState<AccountingMatchCandidate[]>([]);
  const [glEntryId, setGlEntryId] = useState("");
  const [matchAmount, setMatchAmount] = useState("");

  const loadEntities = useCallback(async () => {
    if (!legalEntityId) {
      setAccounts([]);
      setLedgerAccounts([]);
      setPeriods([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [accountList, ledgerList, periodList] = await Promise.all([
        api.accountingBankAccounts(token, { legalEntityId }),
        api.accountingAccounts(token, { legalEntityId, activeOnly: true }),
        api.accountingPeriods(token, { legalEntityId }),
      ]);
      setAccounts(accountList);
      setLedgerAccounts(ledgerList);
      setPeriods(periodList);
      setBankAccountId((current) => (accountList.some((a) => a.id === current) ? current : accountList[0]?.id ?? ""));
      setPeriodId((current) => (periodList.some((p) => p.id === current) ? current : periodList[0]?.id ?? ""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load bank accounts.");
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId]);

  useEffect(() => {
    void loadEntities();
  }, [loadEntities]);

  const loadRecon = useCallback(async () => {
    if (!bankAccountId) {
      setLines([]);
      setReconciliations([]);
      return;
    }
    try {
      const [lineList, reconList] = await Promise.all([
        api.accountingStatementLines(token, { bankAccountId }).catch(() => []),
        api.accountingBankReconciliations(token, { bankAccountId }).catch(() => []),
      ]);
      setLines(lineList);
      setReconciliations(reconList);
      setReconId((current) => (reconList.some((r) => r.id === current) ? current : reconList[0]?.id ?? ""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load statement lines.");
    }
  }, [token, bankAccountId]);

  useEffect(() => {
    void loadRecon();
  }, [loadRecon]);

  const loadMatches = useCallback(async () => {
    if (!reconId) {
      setMatches([]);
      return;
    }
    try {
      setMatches(await api.accountingBankMatches(token, reconId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load matches.");
    }
  }, [token, reconId]);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  const loadMovement = useCallback(async () => {
    if (!bankAccountId || !periodId) {
      setMovement(null);
      return;
    }
    try {
      setMovement(await api.accountingBankPeriodMovement(token, { bankAccountId, periodId }));
    } catch {
      setMovement(null);
    }
  }, [token, bankAccountId, periodId]);

  useEffect(() => {
    void loadMovement();
  }, [loadMovement]);

  async function registerAccount() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingCreateBankAccount(token, {
        legalEntityId,
        bankName: bankName.trim(),
        houseBankCode: houseBankCode.trim(),
        bankAccountId: externalAccountId.trim(),
        accountNumberMasked: masked.trim(),
        name: accountName.trim(),
        currency: accountCurrency,
        ledgerAccountId,
        reconciliationPolicy: policy,
        effectiveFrom,
      });
      setNotice(`${created.name} registered. Import a statement to start reconciling.`);
      setBankName("");
      setHouseBankCode("");
      setExternalAccountId("");
      setMasked("");
      setAccountName("");
      await loadEntities();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register the bank account.");
    } finally {
      setBusy(false);
    }
  }

  async function importStatement(file: File) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // The file is read as text and forwarded as text. No CSV parsing here:
      // the service owns the format profile.
      const content = await file.text();
      const result = await api.accountingImportStatement(token, {
        bankAccountId,
        formatProfile: "csv_v1",
        sourceFileName: file.name,
        content,
      });
      setNotice(
        `${result.lineCount} line${result.lineCount === 1 ? "" : "s"} imported from ${result.sourceFileName}` +
          (result.duplicateLineCount > 0 ? `; ${result.duplicateLineCount} flagged as possible duplicates.` : "."),
      );
      setImportName(file.name);
      await loadRecon();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not import the statement.");
    } finally {
      setBusy(false);
    }
  }

  async function openReconciliation() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingOpenReconciliation(token, { bankAccountId, periodId });
      setNotice("Reconciliation opened for this account and period.");
      setReconId(created.id);
      await loadRecon();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the reconciliation.");
    } finally {
      setBusy(false);
    }
  }

  async function suggest(line: AccountingBankStatementLineRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const list = await api.accountingStatementLineCandidates(token, line.id, { dateToleranceDays: 3 });
      setLineId(line.id);
      setCandidates(list);
      setGlEntryId(list[0]?.glEntryId ?? "");
      setMatchAmount(line.amount);
      setNotice(
        list.length === 0
          ? "No ledger entry looks like this line. It may be a bank charge or an item not yet recorded."
          : `${list.length} candidate${list.length === 1 ? "" : "s"} proposed for ${formatMoney(line.amount)}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not look for candidates.");
    } finally {
      setBusy(false);
    }
  }

  async function createMatch() {
    if (!reconId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.accountingCreateBankMatch(token, {
        reconciliationId: reconId,
        statementLineId: lineId,
        glEntryId,
        // Verbatim text at 2 decimals — ledger precision.
        amount: matchAmount.trim(),
        matchKind: "manual",
        matchReason: null,
        idempotencyKey: newIdempotencyKey(),
        note: null,
      });
      setNotice("Match recorded.");
      setLineId("");
      setCandidates([]);
      setGlEntryId("");
      await Promise.all([loadMatches(), loadMovement()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the match.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!reconId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const closed = await api.accountingCloseReconciliation(token, reconId, {
        statementBalance: closeBalance.trim() || null,
      });
      setNotice(
        `Reconciliation closed. Book ${formatMoney(closed.closedBookBalance)}, statement ${formatMoney(
          closed.closedStatementBalance,
        )}.`,
      );
      setCloseBalance("");
      await loadRecon();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not close the reconciliation.");
    } finally {
      setBusy(false);
    }
  }

  const activeRecon = reconciliations.find((r) => r.id === reconId) ?? null;
  const openRecon = activeRecon?.status === "open" ? activeRecon : null;

  const lineColumns: Column<AccountingBankStatementLineRecord>[] = [
    { header: "Value date", mobileRole: "title", className: "tabular-nums", cell: (row) => formatDateShort(row.valueDate) },
    { header: "Reference", cell: (row) => row.reference ?? "—" },
    { header: "Counterparty", cell: (row) => row.counterparty ?? "—" },
    { header: "Direction", cell: (row) => <Badge>{row.direction}</Badge> },
    {
      header: "Amount",
      className: "text-right tabular-nums whitespace-nowrap",
      mobileRole: "detail",
      cell: (row) => `${formatMoney(row.amount)} ${row.currency}`,
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) =>
        row.duplicateStatus === "review_queue" ? (
          <StatusPill tone="warning">Review</StatusPill>
        ) : (
          <StatusPill tone="neutral">Accepted</StatusPill>
        ),
    },
    {
      header: "Actions",
      cell: (row) => (
        <Button variant="secondary" disabled={busy || !openRecon} onClick={() => void suggest(row)}>
          Find match
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bank reconciliation"
        subtitle="Pair what the bank reported against what the books recorded, then close the period."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <Field label="Bank account" required>
            <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
              <option value="">Select…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} — {account.accountNumberMasked}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period" required>
            <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              <option value="">Select…</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.periodName} ({period.periodCode} {period.fiscalYearCode})
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {movement ? (
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <span className="text-xs uppercase tracking-wide text-ink-faint">Book movement</span>
              <div className="tabular-nums text-ink">{formatMoney(movement.bookMovement)}</div>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-ink-faint">Statement movement</span>
              <div className="tabular-nums text-ink">{formatMoney(movement.statementMovement)}</div>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wide text-ink-faint">Difference</span>
              <div className="tabular-nums text-ink">{formatMoney(movement.difference)}</div>
            </div>
          </div>
        ) : null}
      </Card>

      {!legalEntityId ? null : loading ? (
        <Spinner />
      ) : accounts.length === 0 ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-ink">Register a bank account</h2>
          <p className="mb-3 text-sm text-ink-dim">
            A bank account links one real account to the ledger account that mirrors it. Nothing can be reconciled
            until that link exists.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Bank name" required>
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank Central Asia" />
            </Field>
            <Field label="House bank code" required hint="The company's own code for this bank.">
              <Input value={houseBankCode} onChange={(e) => setHouseBankCode(e.target.value)} placeholder="BCA-01" />
            </Field>
            <Field label="Account name" required>
              <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Operating account" />
            </Field>
            <Field label="Account number" required hint="Masked form is fine — never the full number.">
              <Input value={masked} onChange={(e) => setMasked(e.target.value)} placeholder="****1234" />
            </Field>
            <Field label="Ledger account" required>
              <Select value={ledgerAccountId} onChange={(e) => setLedgerAccountId(e.target.value)}>
                <option value="">Select…</option>
                {ledgerAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.accountCode} — {account.accountName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" required>
              <Input value={accountCurrency} onChange={(e) => setAccountCurrency(e.target.value.toUpperCase())} maxLength={3} />
            </Field>
            <Field label="Effective from" required>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </Field>
            <Field label="Policy" hint="Suggested asks the service to propose candidates; manual leaves it to you.">
              <Select value={policy} onChange={(e) => setPolicy(e.target.value as "manual" | "suggested")}>
                <option value="manual">Manual</option>
                <option value="suggested">Suggested</option>
              </Select>
            </Field>
            <Field label="Bank's own id" required hint="The identifier the statement file uses.">
              <Input value={externalAccountId} onChange={(e) => setExternalAccountId(e.target.value)} />
            </Field>
          </div>
          <div className="mt-3">
            <Button
              disabled={
                busy ||
                !bankName.trim() ||
                !houseBankCode.trim() ||
                !accountName.trim() ||
                !masked.trim() ||
                !ledgerAccountId ||
                !effectiveFrom ||
                !externalAccountId.trim()
              }
              onClick={() => void registerAccount()}
            >
              Register
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">Statement import</h2>
            <p className="mb-3 text-sm text-ink-dim">
              CSV only. The file is read in the browser and forwarded as text; the service decides whether the columns
              match the profile. A line that looks like one already imported is flagged rather than dropped.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importStatement(file);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={busy || !bankAccountId} onClick={() => fileInput.current?.click()}>
                Choose CSV
              </Button>
              <Button disabled={busy || !bankAccountId || !periodId} onClick={() => void openReconciliation()}>
                Open reconciliation
              </Button>
              {importName ? <span className="text-xs text-ink-faint">Last file: {importName}</span> : null}
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">Match a statement line</h2>
            {lineId === "" ? (
              <p className="text-sm text-ink-dim">Pick a line below and ask for candidates.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Ledger entry" required>
                    <Select value={glEntryId} onChange={(e) => setGlEntryId(e.target.value)}>
                      <option value="">Select…</option>
                      {candidates.map((candidate) => (
                        <option key={candidate.glEntryId} value={candidate.glEntryId}>
                          {candidate.postingDate} — {formatMoney(candidate.amount)} ({candidate.score})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Amount"
                    required
                    hint={matchAmount && !isValidAmountInput(matchAmount) ? "Digits with at most two decimals" : undefined}
                  >
                    <Input
                      inputMode="decimal"
                      value={matchAmount}
                      onChange={(e) => setMatchAmount(e.target.value)}
                      aria-invalid={matchAmount !== "" && !isValidAmountInput(matchAmount)}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      disabled={busy || !glEntryId || !isValidAmountInput(matchAmount) || !openRecon}
                      onClick={() => void createMatch()}
                    >
                      Record match
                    </Button>
                  </div>
                </div>
                {candidates.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs text-ink-faint">
                    {candidates.slice(0, 3).map((candidate) => (
                      <li key={candidate.glEntryId}>
                        {candidate.ledgerReference} — score {candidate.score}
                        {candidate.reasons.length > 0 ? `: ${candidate.reasons.join(", ")}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </Card>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Statement lines</h2>
            <DataTable
              columns={lineColumns}
              rows={lines}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No statement lines" description="Import a CSV above." />}
            />
          </div>

          {activeRecon ? (
            <Card>
              <h2 className="mb-3 text-sm font-semibold text-ink">
                Reconciliation — {activeRecon.status}
              </h2>
              <p className="mb-3 text-sm text-ink-dim">
                {matches.length} match{matches.length === 1 ? "" : "es"} recorded. Closing compares the book balance
                with the statement balance and refuses while a difference is unexplained.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Statement balance" hint="Optional — the service uses the imported lines when omitted.">
                  <Input
                    inputMode="decimal"
                    value={closeBalance}
                    onChange={(e) => setCloseBalance(e.target.value)}
                    placeholder="0.00"
                  />
                </Field>
                <div className="flex items-end">
                  <Button disabled={busy || activeRecon.status !== "open"} onClick={() => void close()}>
                    Close reconciliation
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

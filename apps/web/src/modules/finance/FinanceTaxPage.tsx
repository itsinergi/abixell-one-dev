/**
 * Wave A6.6 — Indonesia tax baseline (FIN-ADV-006).
 *
 * Three things in sequence:
 *
 *   1. the legal entity is registered as PKP or non-PKP, from a date;
 *   2. a tax rule is created per tax type (PPN, PPh 22, 23, 26), and a rate
 *      version is attached to it with the account the tax posts to;
 *   3. a calculation asks the service what tax applies to a basis amount on a
 *      date, and it answers using the version effective that day.
 *
 * Rates are fractions, not percentages: 0.11 is 11%. They are 6-decimal
 * strings and stay strings. The page never multiplies anything — the service
 * owns the arithmetic and the rounding mode.
 *
 * PPh Badan and PPh 21 are out of scope here (ADR-0019): they are annual or
 * payroll obligations, not per-transaction taxes.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingAccountRecord,
  type AccountingTaxCalculationRecord,
  type AccountingTaxRegistrationRecord,
  type AccountingTaxRuleRecord,
  type AccountingTaxRuleVersionRecord,
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

const VERSION_TONES: Record<AccountingTaxRuleVersionRecord["status"], "neutral" | "success" | "warning"> = {
  draft: "warning",
  approved: "success",
  superseded: "neutral",
};

const TAX_TYPE_LABELS: Record<AccountingTaxRuleRecord["taxType"], string> = {
  ppn: "PPN — value added tax",
  pph22: "PPh 22 — import / procurement",
  pph23: "PPh 23 — services and royalties",
  pph26: "PPh 26 — non-resident",
};

/** A rate is a fraction with at most six decimals. 0.11 is eleven percent. */
function isValidRateInput(value: string): boolean {
  return /^\d{1,3}(\.\d{1,6})?$/.test(value.trim());
}

export function FinanceTaxPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { entities, legalEntityId, setLegalEntityId } = useLegalEntities(token);

  const [registrations, setRegistrations] = useState<AccountingTaxRegistrationRecord[]>([]);
  const [rules, setRules] = useState<AccountingTaxRuleRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountingAccountRecord[]>([]);
  const [calculations, setCalculations] = useState<AccountingTaxCalculationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Registration
  const [taxpayerStatus, setTaxpayerStatus] = useState<"pkp" | "non_pkp">("pkp");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [registrationFrom, setRegistrationFrom] = useState("");

  // Rule
  const [ruleCode, setRuleCode] = useState("");
  const [taxType, setTaxType] = useState<AccountingTaxRuleRecord["taxType"]>("ppn");
  const [ruleDescription, setRuleDescription] = useState("");

  // Rule version
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [versions, setVersions] = useState<AccountingTaxRuleVersionRecord[]>([]);
  const [rate, setRate] = useState("");
  const [basis, setBasis] = useState<"gross" | "net" | "dpp">("gross");
  const [roundingMode, setRoundingMode] = useState<"half_up" | "half_even" | "truncate">("half_up");
  const [requiresPkp, setRequiresPkp] = useState(false);
  const [taxAccountId, setTaxAccountId] = useState("");
  const [versionFrom, setVersionFrom] = useState("");

  // Calculation
  const [calcRuleCode, setCalcRuleCode] = useState("");
  const [calcBasis, setCalcBasis] = useState("");
  const [calcDate, setCalcDate] = useState("");
  const [calcCurrency, setCalcCurrency] = useState("IDR");

  const load = useCallback(async () => {
    if (!legalEntityId) {
      setRegistrations([]);
      setRules([]);
      setCalculations([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [registrationList, ruleList, accountList, calculationList] = await Promise.all([
        api.accountingTaxRegistrations(token, legalEntityId).catch(() => []),
        api.accountingTaxRules(token, { legalEntityId }).catch(() => []),
        api.accountingAccounts(token, { legalEntityId, activeOnly: true }),
        api.accountingTaxCalculations(token, { legalEntityId }).catch(() => []),
      ]);
      setRegistrations(registrationList);
      setRules(ruleList);
      setAccounts(accountList);
      setCalculations(calculationList);
      setSelectedRuleId((current) => (ruleList.some((r) => r.id === current) ? current : ruleList[0]?.id ?? ""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load tax data.");
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadVersions = useCallback(async () => {
    if (!selectedRuleId) {
      setVersions([]);
      return;
    }
    try {
      setVersions(await api.accountingTaxRuleVersions(token, selectedRuleId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load rule versions.");
    }
  }, [token, selectedRuleId]);

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const activeRegistration = registrations.find((r) => r.status === "active") ?? null;
  const selectedRule = rules.find((r) => r.id === selectedRuleId) ?? null;

  async function registerTaxpayer() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingRegisterTaxpayer(token, {
        legalEntityId,
        taxpayerStatus,
        effectiveFrom: registrationFrom,
        registrationNumber: registrationNumber.trim() || null,
      });
      setNotice(
        created.taxpayerStatus === "pkp"
          ? "Registered as PKP from this date. PPN rules can now require it."
          : "Registered as non-PKP from this date.",
      );
      setRegistrationNumber("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the registration.");
    } finally {
      setBusy(false);
    }
  }

  async function createRule() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingCreateTaxRule(token, {
        legalEntityId,
        ruleCode: ruleCode.trim().toUpperCase(),
        taxType,
        description: ruleDescription.trim() || null,
      });
      setNotice(`Rule ${created.ruleCode} created. Attach a rate version before it can calculate.`);
      setRuleCode("");
      setRuleDescription("");
      await load();
      setSelectedRuleId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the rule.");
    } finally {
      setBusy(false);
    }
  }

  async function createVersion() {
    if (!selectedRule) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingCreateTaxRuleVersion(token, selectedRule.id, {
        // Verbatim text: a rate is a fraction with at most six decimals.
        rate: rate.trim(),
        basis,
        roundingMode,
        requiresPkp,
        accountId: taxAccountId,
        effectiveFrom: versionFrom,
        effectiveTo: null,
      });
      setNotice(`Version ${created.versionNumber} drafted at ${created.rate}. Approve it to make it effective.`);
      setRate("");
      await loadVersions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not draft the version.");
    } finally {
      setBusy(false);
    }
  }

  async function act(version: AccountingTaxRuleVersionRecord, actionCode: "approve" | "reject") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.accountingTaxRuleVersionAction(token, version.id, { actionCode, comment: null });
      setNotice(
        actionCode === "approve"
          ? `Version ${updated.versionNumber} approved. Calculations from its start date use it.`
          : `Version ${updated.versionNumber} rejected.`,
      );
      await loadVersions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  }

  async function calculate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.accountingCalculateTax(token, {
        legalEntityId,
        ruleCode: calcRuleCode.trim().toUpperCase(),
        // Verbatim text at 2 decimals.
        basisAmount: calcBasis.trim(),
        calculationDate: calcDate,
        currency: calcCurrency,
        idempotencyKey: newIdempotencyKey(),
      });
      setNotice(
        `${formatMoney(result.taxAmount)} ${result.currency} of tax on ${formatMoney(result.basisAmount)} ` +
          `at ${result.rate}, as ${result.taxpayerStatus}.`,
      );
      setCalcBasis("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not calculate the tax.");
    } finally {
      setBusy(false);
    }
  }

  const versionColumns: Column<AccountingTaxRuleVersionRecord>[] = [
    {
      header: "Version",
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">v{row.versionNumber}</span>,
    },
    { header: "Rate", className: "tabular-nums", cell: (row) => row.rate },
    { header: "Basis", cell: (row) => row.basis },
    { header: "Rounding", cell: (row) => row.roundingMode },
    { header: "From", className: "tabular-nums", cell: (row) => formatDateShort(row.effectiveFrom) },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => <StatusPill tone={VERSION_TONES[row.status]}>{row.status}</StatusPill>,
    },
    {
      header: "Actions",
      cell: (row) =>
        row.status === "draft" ? (
          <div className="flex flex-wrap gap-1">
            <Button disabled={busy} onClick={() => void act(row, "approve")}>
              Approve
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void act(row, "reject")}>
              Reject
            </Button>
          </div>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
  ];

  const calculationColumns: Column<AccountingTaxCalculationRecord>[] = [
    {
      header: "Date",
      mobileRole: "title",
      className: "tabular-nums",
      cell: (row) => formatDateShort(row.calculationDate),
    },
    { header: "Basis", className: "text-right tabular-nums", cell: (row) => formatMoney(row.basisAmount) },
    { header: "Rate", className: "tabular-nums", cell: (row) => row.rate },
    {
      header: "Tax",
      className: "text-right tabular-nums whitespace-nowrap",
      mobileRole: "detail",
      cell: (row) => `${formatMoney(row.taxAmount)} ${row.currency}`,
    },
    { header: "As", mobileRole: "status", cell: (row) => <Badge>{row.taxpayerStatus}</Badge> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tax"
        subtitle="Register the taxpayer, define the rules and their rates, then calculate what applies to a document."
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
        <EmptyState title="Choose a legal entity" description="Tax registrations and rules are per legal entity." />
      ) : loading ? (
        <Spinner />
      ) : (
        <>
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">Taxpayer status</h2>
            <p className="mb-3 text-sm text-ink-dim">
              {activeRegistration
                ? `Currently ${activeRegistration.taxpayerStatus.toUpperCase()}` +
                  (activeRegistration.registrationNumber ? `, NPWP ${activeRegistration.registrationNumber}` : "") +
                  `, from ${formatDateShort(activeRegistration.effectiveFrom)}. Recording a new status supersedes this one from its own start date.`
                : "Not registered yet. Nothing that depends on PKP status can be calculated until this is set."}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Status" required>
                <Select value={taxpayerStatus} onChange={(e) => setTaxpayerStatus(e.target.value as "pkp" | "non_pkp")}>
                  <option value="pkp">PKP — VAT-registered</option>
                  <option value="non_pkp">Non-PKP</option>
                </Select>
              </Field>
              <Field label="Registration number" hint="NPWP. Optional, but a PKP registration normally carries one.">
                <Input value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} />
              </Field>
              <Field label="Effective from" required>
                <Input type="date" value={registrationFrom} onChange={(e) => setRegistrationFrom(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3">
              <Button disabled={busy || !registrationFrom} onClick={() => void registerTaxpayer()}>
                Record status
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">Tax rule</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Rule code" required>
                <Input value={ruleCode} onChange={(e) => setRuleCode(e.target.value)} placeholder="PPN-OUT-11" />
              </Field>
              <Field label="Tax type" required>
                <Select value={taxType} onChange={(e) => setTaxType(e.target.value as AccountingTaxRuleRecord["taxType"])}>
                  {(Object.keys(TAX_TYPE_LABELS) as AccountingTaxRuleRecord["taxType"][]).map((type) => (
                    <option key={type} value={type}>
                      {TAX_TYPE_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Description">
                <Input value={ruleDescription} onChange={(e) => setRuleDescription(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3">
              <Button disabled={busy || !ruleCode.trim()} onClick={() => void createRule()}>
                Create rule
              </Button>
            </div>
          </Card>

          {rules.length === 0 ? null : (
            <>
              <Card>
                <h2 className="mb-3 text-sm font-semibold text-ink">Rate version</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Rule" required>
                    <Select value={selectedRuleId} onChange={(e) => setSelectedRuleId(e.target.value)}>
                      {rules.map((rule) => (
                        <option key={rule.id} value={rule.id}>
                          {rule.ruleCode} — {rule.taxType}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Rate"
                    required
                    hint={
                      rate && !isValidRateInput(rate)
                        ? "A fraction with at most six decimals — 0.11 is 11%"
                        : "A fraction, not a percentage. 0.11 is 11%."
                    }
                  >
                    <Input
                      inputMode="decimal"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="0.110000"
                      aria-invalid={rate !== "" && !isValidRateInput(rate)}
                    />
                  </Field>
                  <Field label="Basis" required hint="What the rate is applied to.">
                    <Select value={basis} onChange={(e) => setBasis(e.target.value as typeof basis)}>
                      <option value="gross">Gross</option>
                      <option value="net">Net</option>
                      <option value="dpp">DPP — tax base</option>
                    </Select>
                  </Field>
                  <Field label="Rounding" required>
                    <Select value={roundingMode} onChange={(e) => setRoundingMode(e.target.value as typeof roundingMode)}>
                      <option value="half_up">Half up</option>
                      <option value="half_even">Half even</option>
                      <option value="truncate">Truncate</option>
                    </Select>
                  </Field>
                  <Field label="Tax account" required>
                    <Select value={taxAccountId} onChange={(e) => setTaxAccountId(e.target.value)}>
                      <option value="">Select…</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.accountCode} — {account.accountName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Effective from" required>
                    <Input type="date" value={versionFrom} onChange={(e) => setVersionFrom(e.target.value)} />
                  </Field>
                  <Field label="PKP only" hint="A calculation for a non-PKP entity skips a rule that requires PKP.">
                    <Select value={requiresPkp ? "yes" : "no"} onChange={(e) => setRequiresPkp(e.target.value === "yes")}>
                      <option value="no">Applies to everyone</option>
                      <option value="yes">Requires PKP</option>
                    </Select>
                  </Field>
                </div>
                <div className="mt-3">
                  <Button
                    disabled={busy || !selectedRule || !isValidRateInput(rate) || !taxAccountId || !versionFrom}
                    onClick={() => void createVersion()}
                  >
                    Draft version
                  </Button>
                </div>
              </Card>

              <div>
                <h2 className="mb-2 text-sm font-semibold text-ink">
                  Versions{selectedRule ? ` — ${selectedRule.ruleCode}` : ""}
                </h2>
                <DataTable
                  columns={versionColumns}
                  rows={versions}
                  keyOf={(row) => row.id}
                  empty={<EmptyState title="No versions" description="Draft one above." />}
                />
              </div>
            </>
          )}

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">Calculate</h2>
            <p className="mb-3 text-sm text-ink-dim">
              The service picks the version effective on the calculation date and applies it to the basis. It returns
              the tax amount and the rate it used; this page does not multiply.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Rule code" required>
                <Select value={calcRuleCode} onChange={(e) => setCalcRuleCode(e.target.value)}>
                  <option value="">Select…</option>
                  {rules.map((rule) => (
                    <option key={rule.id} value={rule.ruleCode}>
                      {rule.ruleCode} — {rule.taxType}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Basis amount"
                required
                hint={calcBasis && !isValidAmountInput(calcBasis) ? "Digits with at most two decimals" : undefined}
              >
                <Input
                  inputMode="decimal"
                  value={calcBasis}
                  onChange={(e) => setCalcBasis(e.target.value)}
                  placeholder="1000000.00"
                  aria-invalid={calcBasis !== "" && !isValidAmountInput(calcBasis)}
                />
              </Field>
              <Field label="Calculation date" required>
                <Input type="date" value={calcDate} onChange={(e) => setCalcDate(e.target.value)} />
              </Field>
              <Field label="Currency" required>
                <Input value={calcCurrency} onChange={(e) => setCalcCurrency(e.target.value.toUpperCase())} maxLength={3} />
              </Field>
            </div>
            <div className="mt-3">
              <Button
                disabled={busy || !calcRuleCode || !isValidAmountInput(calcBasis) || !calcDate}
                onClick={() => void calculate()}
              >
                Calculate
              </Button>
            </div>
          </Card>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Calculations</h2>
            <DataTable
              columns={calculationColumns}
              rows={calculations}
              keyOf={(row) => row.id}
              empty={<EmptyState title="Nothing calculated yet" description="Calculate one above." />}
            />
          </div>
        </>
      )}
    </div>
  );
}

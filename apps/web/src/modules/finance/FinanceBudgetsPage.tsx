/**
 * Wave A6.3 — Budgeting and budget control (FIN-ADV-003).
 *
 * A budget is a baseline you measure against, not a spending limit the system
 * enforces on its own. Three things happen here:
 *
 *   1. a budget is created for one legal entity and fiscal year;
 *   2. a draft version is filled in — one total, spread across periods by
 *      weight, which the service turns into period lines;
 *   3. the version goes through its approval, and once approved it becomes the
 *      active baseline. Consumptions are then recorded against it.
 *
 * The page never decides whether a spend is allowed. `accountingConsumeBudget`
 * returns the kernel's decision; the utilization table shows what the kernel
 * reports. Weights and amounts are 4 decimals, sent as text.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingBudgetRecord,
  type AccountingBudgetUtilization,
  type AccountingBudgetVersionRecord,
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
import { formatMoney } from "../../shared/format";
import { isValidAmount4Input } from "./money";
import { newIdempotencyKey, useLegalEntities } from "./useLegalEntities";

const VERSION_TONES: Record<string, "neutral" | "success" | "warning" | "danger"> = {
  draft: "warning",
  active: "success",
  superseded: "neutral",
  rejected: "danger",
};

type DraftWeight = { periodCode: string; weight: string };

const EMPTY_WEIGHT: DraftWeight = { periodCode: "", weight: "" };

export function FinanceBudgetsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { entities, legalEntityId, setLegalEntityId } = useLegalEntities(token);

  const [budgets, setBudgets] = useState<AccountingBudgetRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [versions, setVersions] = useState<AccountingBudgetVersionRecord[]>([]);
  const [utilization, setUtilization] = useState<AccountingBudgetUtilization | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [fiscalYearCode, setFiscalYearCode] = useState(String(new Date().getFullYear()));
  const [scenario, setScenario] = useState<"original" | "revision" | "forecast">("original");
  const [currency, setCurrency] = useState("IDR");
  const [name, setName] = useState("");

  const [totalAmount, setTotalAmount] = useState("");
  const [weights, setWeights] = useState<DraftWeight[]>([{ ...EMPTY_WEIGHT }]);
  const [note, setNote] = useState("");

  const [consumePeriod, setConsumePeriod] = useState("");
  const [consumeAmount, setConsumeAmount] = useState("");
  const [consumeKind, setConsumeKind] = useState<"actual" | "commitment" | "adjustment" | "release">("actual");
  const [consumeNote, setConsumeNote] = useState("");

  const load = useCallback(async () => {
    if (!legalEntityId) {
      setBudgets([]);
      setSelectedId("");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.accountingBudgets(token, { legalEntityId });
      setBudgets(list);
      setSelectedId((current) => (list.some((b) => b.id === current) ? current : list[0]?.id ?? ""));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load budgets.");
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setVersions([]);
      setUtilization(null);
      return;
    }
    try {
      const [versionList, util] = await Promise.all([
        api.accountingBudgetVersions(token, selectedId).catch(() => []),
        api.accountingBudgetUtilization(token, selectedId).catch(() => null),
      ]);
      setVersions(versionList);
      setUtilization(util);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this budget.");
    }
  }, [token, selectedId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const selectedBudget = budgets.find((b) => b.id === selectedId) ?? null;

  async function createBudget() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingCreateBudget(token, {
        legalEntityId,
        fiscalYearCode: fiscalYearCode.trim(),
        scenario,
        currency,
        name: name.trim(),
      });
      setNotice(`${created.name} created for ${created.fiscalYearCode}. Add a draft version next.`);
      setName("");
      await load();
      setSelectedId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the budget.");
    } finally {
      setBusy(false);
    }
  }

  async function createVersion() {
    if (!selectedBudget) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingCreateBudgetVersion(token, selectedBudget.id, {
        // Verbatim text at 4 decimals, both the total and every weight.
        totalAmount: totalAmount.trim(),
        weights: weights
          .filter((w) => w.periodCode.trim() && isValidAmount4Input(w.weight))
          .map((w) => ({ periodCode: w.periodCode.trim(), weight: w.weight.trim() })),
        note: note.trim() || null,
      });
      setNotice(`Version ${created.versionNumber} drafted. It becomes the baseline once approved.`);
      setTotalAmount("");
      setNote("");
      setWeights([{ ...EMPTY_WEIGHT }]);
      await loadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not draft the version.");
    } finally {
      setBusy(false);
    }
  }

  async function act(version: AccountingBudgetVersionRecord, actionCode: "approve" | "reject") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await api.accountingBudgetAction(token, version.id, {
        actionCode,
        comment: null,
      });
      setNotice(
        actionCode === "approve"
          ? `Version ${updated.versionNumber} approved and now active.`
          : `Version ${updated.versionNumber} rejected.`,
      );
      await loadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the decision.");
    } finally {
      setBusy(false);
    }
  }

  async function consume() {
    if (!selectedBudget) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.accountingConsumeBudget(token, {
        budgetId: selectedBudget.id,
        periodCode: consumePeriod.trim(),
        amount: consumeAmount.trim(),
        kind: consumeKind,
        idempotencyKey: newIdempotencyKey(),
        note: consumeNote.trim() || null,
      });
      setNotice(
        `Recorded ${result.kind} of ${formatMoney(result.amount)} against ${result.periodCode}.`,
      );
      setConsumeAmount("");
      setConsumeNote("");
      await loadDetail();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the consumption.");
    } finally {
      setBusy(false);
    }
  }

  const draftVersions = versions.filter((v) => v.status === "draft");
  const activeVersion = versions.find((v) => v.status === "active") ?? null;

  const versionColumns: Column<AccountingBudgetVersionRecord>[] = [
    {
      header: "Version",
      mobileRole: "title",
      cell: (row) => <span className="font-medium text-ink">v{row.versionNumber}</span>,
    },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => <StatusPill tone={VERSION_TONES[row.status] ?? "neutral"}>{row.status}</StatusPill>,
    },
    { header: "Note", mobileRole: "detail", cell: (row) => row.note ?? "—" },
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Budgets"
        subtitle="Set a baseline per legal entity and fiscal year, then measure spending against it."
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
          <Field label="Fiscal year" required>
            <Input value={fiscalYearCode} onChange={(e) => setFiscalYearCode(e.target.value)} placeholder="2026" />
          </Field>
          <Field label="Scenario" required>
            <Select value={scenario} onChange={(e) => setScenario(e.target.value as typeof scenario)}>
              <option value="original">Original</option>
              <option value="revision">Revision</option>
              <option value="forecast">Forecast</option>
            </Select>
          </Field>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Operating budget 2026" />
          </Field>
          <Field label="Currency" required>
            <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
          </Field>
        </div>
        <div className="mt-3">
          <Button
            disabled={busy || !legalEntityId || !name.trim() || fiscalYearCode.trim() === ""}
            onClick={() => void createBudget()}
          >
            Create budget
          </Button>
        </div>
      </Card>

      {!legalEntityId ? null : loading ? (
        <Spinner />
      ) : budgets.length === 0 ? (
        <EmptyState title="No budgets yet" description="Create one above; versions and spending hang off it." />
      ) : (
        <>
          <Card>
            <Field label="Budget" required>
              <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {budgets.map((budget) => (
                  <option key={budget.id} value={budget.id}>
                    {budget.name} — {budget.fiscalYearCode} ({budget.scenario})
                  </option>
                ))}
              </Select>
            </Field>
            <p className="mt-2 text-sm text-ink-dim">
              {selectedBudget
                ? activeVersion
                  ? `Active baseline: version ${activeVersion.versionNumber}.`
                  : "No version is active yet — nothing can be consumed against this budget."
                : null}
            </p>
          </Card>

          {selectedBudget ? (
            <>
              <Card>
                <h2 className="mb-3 text-sm font-semibold text-ink">Draft a version</h2>
                <p className="mb-3 text-sm text-ink-dim">
                  One total for the year, then a weight per period. The service spreads the total by those weights,
                  so the weights only have to be in proportion — they are not amounts.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="Total amount"
                    required
                    hint={
                      totalAmount && !isValidAmount4Input(totalAmount)
                        ? "Digits with at most four decimals"
                        : undefined
                    }
                  >
                    <Input
                      inputMode="decimal"
                      value={totalAmount}
                      onChange={(e) => setTotalAmount(e.target.value)}
                      placeholder="1200000000.0000"
                      aria-invalid={totalAmount !== "" && !isValidAmount4Input(totalAmount)}
                    />
                  </Field>
                  <Field label="Note">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this revision" />
                  </Field>
                </div>

                <h3 className="mb-2 mt-4 text-sm font-semibold text-ink">Period weights</h3>
                <div className="space-y-2">
                  {weights.map((weight, index) => (
                    <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <Input
                          aria-label={`Period code for weight ${index + 1}`}
                          placeholder="2026-01"
                          value={weight.periodCode}
                          onChange={(e) =>
                            setWeights((current) =>
                              current.map((w, i) => (i === index ? { ...w, periodCode: e.target.value } : w)),
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <Input
                          aria-label={`Weight for period ${index + 1}`}
                          inputMode="decimal"
                          placeholder="1.0000"
                          value={weight.weight}
                          onChange={(e) =>
                            setWeights((current) =>
                              current.map((w, i) => (i === index ? { ...w, weight: e.target.value } : w)),
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setWeights((current) => [...current, { ...EMPTY_WEIGHT }])}>
                    Add period
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      !isValidAmount4Input(totalAmount) ||
                      !weights.some((w) => w.periodCode.trim() && isValidAmount4Input(w.weight))
                    }
                    onClick={() => void createVersion()}
                  >
                    Draft version
                  </Button>
                </div>
              </Card>

              <div>
                <h2 className="mb-2 text-sm font-semibold text-ink">Versions</h2>
                <DataTable
                  columns={versionColumns}
                  rows={versions}
                  keyOf={(row) => row.id}
                  empty={<EmptyState title="No versions" description="Draft one above." />}
                />
                {draftVersions.length > 0 ? (
                  <p className="mt-2 text-xs text-ink-faint">
                    Approving needs an approval assignment to exist on the version, and the permission to act on it.
                    If the button fails, the version has not entered its approval yet.
                  </p>
                ) : null}
              </div>

              {utilization ? (
                <Card>
                  <h2 className="mb-3 text-sm font-semibold text-ink">Utilization</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-faint">
                          <th className="py-2 pr-3">Period</th>
                          <th className="py-2 pr-3 text-right">Baseline</th>
                          <th className="py-2 pr-3 text-right">Actual</th>
                          <th className="py-2 pr-3 text-right">Committed</th>
                          <th className="py-2 pr-3 text-right">Available</th>
                          <th className="py-2 text-right">Variance</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {utilization.periods.map((period) => (
                          <tr key={period.periodCode} className="border-b border-line/60">
                            <td className="py-2 pr-3">{period.periodCode}</td>
                            <td className="py-2 pr-3 text-right">{formatMoney(period.baseline)}</td>
                            <td className="py-2 pr-3 text-right">{formatMoney(period.actual)}</td>
                            <td className="py-2 pr-3 text-right">{formatMoney(period.committed)}</td>
                            <td className="py-2 pr-3 text-right">{formatMoney(period.available)}</td>
                            <td className="py-2 text-right">{formatMoney(period.variance)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="font-medium">
                          <td className="py-2 pr-3">Total</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(utilization.total.baseline)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(utilization.total.actual)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(utilization.total.committed)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(utilization.total.available)}</td>
                          <td className="py-2 text-right tabular-nums">{formatMoney(utilization.total.variance)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              ) : null}

              <Card>
                <h2 className="mb-3 text-sm font-semibold text-ink">Record spending</h2>
                <p className="mb-3 text-sm text-ink-dim">
                  A consumption is what the budget is measured against. It does not post to the ledger by itself —
                  the journal does that. Recording one twice with the same key records it once.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Period" required>
                    <Input
                      value={consumePeriod}
                      onChange={(e) => setConsumePeriod(e.target.value)}
                      placeholder="2026-01"
                    />
                  </Field>
                  <Field label="Kind" required>
                    <Select value={consumeKind} onChange={(e) => setConsumeKind(e.target.value as typeof consumeKind)}>
                      <option value="actual">Actual — already spent</option>
                      <option value="commitment">Commitment — reserved</option>
                      <option value="adjustment">Adjustment</option>
                      <option value="release">Release</option>
                    </Select>
                  </Field>
                  <Field
                    label="Amount"
                    required
                    hint={consumeAmount && !isValidAmount4Input(consumeAmount) ? "Digits with at most four decimals" : undefined}
                  >
                    <Input
                      inputMode="decimal"
                      value={consumeAmount}
                      onChange={(e) => setConsumeAmount(e.target.value)}
                      placeholder="2500000.0000"
                      aria-invalid={consumeAmount !== "" && !isValidAmount4Input(consumeAmount)}
                    />
                  </Field>
                  <Field label="Note">
                    <Input value={consumeNote} onChange={(e) => setConsumeNote(e.target.value)} />
                  </Field>
                </div>
                <div className="mt-3">
                  <Button
                    disabled={busy || !activeVersion || consumePeriod.trim() === "" || !isValidAmount4Input(consumeAmount)}
                    onClick={() => void consume()}
                  >
                    Record
                  </Button>
                </div>
                {!activeVersion ? (
                  <p className="mt-2 text-xs text-ink-faint">
                    A version has to be approved before anything can be recorded against it.
                  </p>
                ) : null}
              </Card>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Wave A6.1 — Financial statements.
 *
 * Read-only. Four things the kernel already holds, side by side: the aging
 * of what is still owed in each direction, the journals and their GL
 * postings, the consolidation groups with their translation runs and
 * eliminations, and the statement line versions those groups report through.
 *
 * Aging is the only view that needs a currency up front, because the kernel
 * buckets by currency rather than converting. The default is the reporting
 * currency of the first consolidation group, falling back to IDR.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingAgingResult,
  type AccountingConsolidationGroupRecord,
  type AccountingEliminationRecord,
  type AccountingFsvVersionRecord,
  type AccountingGlEntryRecord,
  type AccountingJournalRecord,
  type AccountingTranslationRunRecord,
} from "../../lib/api";
import {
  Alert,
  Badge,
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
import { formatDate, formatMoney } from "../../shared/format";
import { monthRange } from "./money";

const JOURNAL_TONES: Record<AccountingJournalRecord["status"], "neutral" | "success" | "warning" | "danger"> = {
  pending: "warning",
  posted: "success",
  failed: "danger",
  reversed: "neutral",
};

export function FinancialStatementsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [side, setSide] = useState<"AR" | "AP">("AR");
  const [asOfDate, setAsOfDate] = useState(() => monthRange().to);
  const [currency, setCurrency] = useState("IDR");

  const [aging, setAging] = useState<AccountingAgingResult | null>(null);
  const [journals, setJournals] = useState<AccountingJournalRecord[]>([]);
  const [glEntries, setGlEntries] = useState<AccountingGlEntryRecord[]>([]);
  const [groups, setGroups] = useState<AccountingConsolidationGroupRecord[]>([]);
  const [runs, setRuns] = useState<AccountingTranslationRunRecord[]>([]);
  const [eliminations, setEliminations] = useState<AccountingEliminationRecord[]>([]);
  const [fsvVersions, setFsvVersions] = useState<AccountingFsvVersionRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agingResult, journalList, glList, groupList, runList, eliminationList, fsvList] = await Promise.all([
        api.accountingAging(token, { side, asOfDate, currency }),
        api.accountingJournals(token),
        api.accountingGlEntries(token),
        api.accountingConsolidationGroups(token),
        api.accountingTranslationRuns(token),
        api.accountingEliminations(token),
        api.accountingFsvVersions(token),
      ]);
      setAging(agingResult);
      setJournals(journalList);
      setGlEntries(glList);
      setGroups(groupList);
      setRuns(runList);
      setEliminations(eliminationList);
      setFsvVersions(fsvList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the financial statements.");
    } finally {
      setLoading(false);
    }
  }, [token, side, asOfDate, currency]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupName = (groupId: string) => groups.find((g) => g.id === groupId)?.name ?? groupId;

  const agingColumns: Column<AccountingAgingResult["buckets"][number]>[] = [
    { header: "Bucket", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{row.label}</span> },
    {
      header: "Days",
      className: "tabular-nums",
      cell: (row) => (row.toDays === null ? `${row.fromDays}+` : `${row.fromDays} to ${row.toDays}`),
    },
    { header: "Items", className: "text-right tabular-nums", cell: (row) => row.itemCount },
    {
      header: "Amount",
      className: "text-right tabular-nums",
      mobileRole: "status",
      cell: (row) => <span className="font-medium">{formatMoney(row.amount)}</span>,
    },
  ];

  const journalColumns: Column<AccountingJournalRecord>[] = [
    {
      header: "Journal",
      mobileRole: "title",
      cell: (row) => <span className="font-mono text-xs text-ink">{row.journalNumber}</span>,
    },
    { header: "Date", className: "tabular-nums", cell: (row) => formatDate(row.accountingDate) },
    { header: "Currency", cell: (row) => row.currency },
    {
      header: "Status",
      mobileRole: "status",
      cell: (row) => <StatusPill tone={JOURNAL_TONES[row.status]}>{row.status}</StatusPill>,
    },
    {
      header: "Balanced",
      mobileRole: "detail",
      cell: (row) =>
        row.isBalanced ? <StatusPill tone="success">Yes</StatusPill> : <StatusPill tone="danger">No</StatusPill>,
    },
  ];

  const glColumns: Column<AccountingGlEntryRecord>[] = [
    { header: "Posted", mobileRole: "title", className: "tabular-nums", cell: (row) => formatDate(row.postingDate) },
    {
      header: "Debit",
      className: "text-right tabular-nums",
      cell: (row) => (Number(row.debit) === 0 ? "—" : formatMoney(row.debit)),
    },
    {
      header: "Credit",
      className: "text-right tabular-nums",
      mobileRole: "status",
      cell: (row) => (Number(row.credit) === 0 ? "—" : formatMoney(row.credit)),
    },
    { header: "Document", className: "font-mono text-xs", mobileRole: "detail", cell: (row) => row.documentType ?? "—" },
  ];

  const runColumns: Column<AccountingTranslationRunRecord>[] = [
    { header: "Group", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{groupName(row.groupId)}</span> },
    { header: "Currency", cell: (row) => row.reportingCurrency },
    {
      header: "Translated",
      className: "text-right tabular-nums",
      cell: (row) => formatMoney(row.translatedTotal),
    },
    {
      header: "Residual",
      className: "text-right tabular-nums",
      mobileRole: "status",
      cell: (row) => formatMoney(row.residualAmount),
    },
  ];

  const eliminationColumns: Column<AccountingEliminationRecord>[] = [
    { header: "Description", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{row.description}</span> },
    { header: "Group", cell: (row) => groupName(row.groupId) },
    {
      header: "Amount",
      className: "text-right tabular-nums",
      mobileRole: "status",
      cell: (row) => formatMoney(row.amount),
    },
    { header: "Status", cell: (row) => <Badge>{row.status}</Badge> },
  ];

  const groupColumns: Column<AccountingConsolidationGroupRecord>[] = [
    { header: "Group", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{row.name}</span> },
    { header: "Code", className: "font-mono text-xs", cell: (row) => row.groupCode },
    { header: "Currency", cell: (row) => row.reportingCurrency },
    { header: "Status", mobileRole: "status", cell: (row) => <Badge>{row.status}</Badge> },
  ];

  const fsvColumns: Column<AccountingFsvVersionRecord>[] = [
    {
      header: "Statement",
      mobileRole: "title",
      cell: (row) => <span className="font-mono text-xs text-ink">{row.fsvCode}</span>,
    },
    { header: "Version", className: "tabular-nums", cell: (row) => row.versionNumber },
    { header: "From", className: "tabular-nums", cell: (row) => formatDate(row.effectiveFrom) },
    { header: "Status", mobileRole: "status", cell: (row) => <Badge>{row.status}</Badge> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Financial Statements"
        subtitle="What is still owed, what has been posted, and how the group reports."
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Side" required>
            <Select value={side} onChange={(e) => setSide(e.target.value as "AR" | "AP")}>
              <option value="AR">Receivable (AR)</option>
              <option value="AP">Payable (AP)</option>
            </Select>
          </Field>
          <Field label="As of" required>
            <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
          </Field>
          <Field label="Currency" required>
            <Input
              value={currency}
              maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <>
          {aging ? (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">
                Aging {aging.side === "AR" ? "receivable" : "payable"} as of {formatDate(aging.asOfDate)}
              </h2>
              <Card className="mb-3">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Still open</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
                  {formatMoney(aging.totalOpen)} <span className="text-sm font-normal text-ink-dim">{aging.currency}</span>
                </p>
              </Card>
              <DataTable
                columns={agingColumns}
                rows={aging.buckets}
                keyOf={(row) => row.label}
                empty={<EmptyState title="Nothing open" description="No open items fall in this side and currency." />}
              />
            </div>
          ) : null}

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Journals</h2>
            <DataTable
              columns={journalColumns}
              rows={journals}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No journals" description="Nothing has been recorded in the general ledger yet." />}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Posted entries</h2>
            <DataTable
              columns={glColumns}
              rows={glEntries}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No postings" description="Post a journal to see its general ledger entries here." />}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Consolidation groups</h2>
            <DataTable
              columns={groupColumns}
              rows={groups}
              keyOf={(row) => row.id}
              empty={<EmptyState title="No groups" description="No consolidation group is defined for this tenant." />}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">Translation runs</h2>
              <DataTable
                columns={runColumns}
                rows={runs}
                keyOf={(row) => row.id}
                empty={<EmptyState title="No runs" description="No translation run has been executed." />}
              />
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink">Eliminations</h2>
              <DataTable
                columns={eliminationColumns}
                rows={eliminations}
                keyOf={(row) => row.id}
                empty={<EmptyState title="No eliminations" description="No intercompany elimination has been recorded." />}
              />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Statement line versions</h2>
            <DataTable
              columns={fsvColumns}
              rows={fsvVersions}
              keyOf={(row) => row.id}
              empty={
                <EmptyState
                  title="No statement versions"
                  description="A financial statement version defines the lines the group reports through."
                />
              }
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Phase 6 — Cash and bank accounts (FIN-CORE-004, FIN-CORE-011).
 *
 * These are operational money containers, not a chart of accounts. The
 * balance shown is the backend's, always: this page never computes or edits
 * one. There is no reconciliation, statement import, or GL mapping here.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type FinanceAccount } from "../../lib/api";
import {
  Alert,
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
import { accountTypeLabel, formatMoney } from "./money";

type OrganizationUnitOption = { id: string; name: string };
type LegalEntityOption = { id: string; name: string };

export function FinanceAccountsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [units, setUnits] = useState<OrganizationUnitOption[]>([]);
  const [legalEntities, setLegalEntities] = useState<LegalEntityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<"cash" | "bank" | "petty_cash">("cash");
  const [currency, setCurrency] = useState("IDR");
  const [unitId, setUnitId] = useState("");
  const [legalEntityId, setLegalEntityId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await api.financeAccounts(token));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load accounts.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const [unitList, entityList] = await Promise.all([
        api.organizationUnits(token).catch(() => [] as OrganizationUnitOption[]),
        api.legalEntities(token).catch(() => [] as LegalEntityOption[]),
      ]);
      setUnits(unitList);
      setLegalEntities(entityList);
    })();
  }, [token]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<FinanceAccount>[] = [
    { header: "Code", cell: (row) => <span className="font-medium">{row.code}</span> },
    { header: "Name", cell: (row) => row.name },
    { header: "Type", cell: (row) => accountTypeLabel(row.accountType) },
    { header: "Currency", cell: (row) => row.currency },
    {
      header: "Balance",
      className: "text-right tabular-nums",
      cell: (row) => <span className="font-medium">{formatMoney(row.balance)}</span>,
    },
    {
      header: "State",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Cash & Bank" subtitle="Where the money actually sits." />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Add an account</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CASH-MAIN" />
          </Field>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Main cash" />
          </Field>
          <Field label="Type" required>
            <Select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value as "cash" | "bank" | "petty_cash")}
            >
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="petty_cash">Petty cash</option>
            </Select>
          </Field>
          <Field label="Currency" required hint="Three-letter code">
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              placeholder="IDR"
            />
          </Field>
          <Field label="Legal entity">
            <Select value={legalEntityId} onChange={(e) => setLegalEntityId(e.target.value)}>
              <option value="">None</option>
              {legalEntities.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Responsible unit">
            <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Tenant-wide</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              disabled={busy || !code || !name || currency.length !== 3}
              onClick={async () => {
                await run(
                  () =>
                    api.createFinanceAccount(token, {
                      code,
                      name,
                      accountType,
                      currency,
                      legalEntityId: legalEntityId || null,
                      organizationUnitId: unitId || null,
                    }),
                  `Account ${code} created.`,
                );
                setCode("");
                setName("");
              }}
            >
              Create
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          A new account starts at zero. Record an opening position as an ordinary income transaction — balances are
          never typed in directly.
        </p>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={accounts}
          keyOf={(row) => row.id}
          empty={
            <EmptyState
              title="No accounts yet"
              description="Add the cash box or bank account your team actually uses."
            />
          }
        />
      )}
    </div>
  );
}

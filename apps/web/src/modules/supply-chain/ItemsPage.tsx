/**
 * Phase 4 — Item master and stock surface (SCM-CORE-013).
 *
 * Items with their current balance, plus goods in / goods out. Every
 * quantity shown comes from the backend's authoritative balance; this page
 * never computes stock itself.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type ScmItem,
  type StockBalanceRecord,
  type StockMovementRecord,
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
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatDate } from "../../shared/format";

export function ItemsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [items, setItems] = useState<ScmItem[]>([]);
  const [balances, setBalances] = useState<StockBalanceRecord[]>([]);
  const [selected, setSelected] = useState<ScmItem | null>(null);
  const [movements, setMovements] = useState<StockMovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [uom, setUom] = useState("EA");
  const [quantity, setQuantity] = useState("");
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemList, balanceList] = await Promise.all([
        api.scmItems(token, { search: search || undefined }),
        api.stockBalances(token),
      ]);
      setItems(itemList);
      setBalances(balanceList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load items.");
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const openItem = useCallback(
    async (item: ScmItem) => {
      setSelected(item);
      setError(null);
      try {
        setMovements(await api.stockMovements(token, { itemCode: item.code }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load movements.");
      }
    },
    [token],
  );

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
      if (selected) await openItem(selected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  /** Total across every stock location for this item. */
  function totalFor(item: ScmItem): number {
    return balances.filter((b) => b.itemId === item.id).reduce((sum, b) => sum + b.quantity, 0);
  }

  const columns: Column<ScmItem>[] = [
    { header: "Code", cell: (row) => <span className="font-medium">{row.code}</span> },
    { header: "Name", cell: (row) => row.name },
    { header: "Unit", cell: (row) => row.unitOfMeasure },
    { header: "On hand", cell: (row) => <Badge>{totalFor(row)}</Badge> },
    {
      header: "State",
      cell: (row) => (
        <StatusPill tone={row.isActive ? "success" : "neutral"}>{row.isActive ? "Active" : "Inactive"}</StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Items & Stock" subtitle="What exists, how much of it, and what moved." />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Add an item</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. bolt-m8" />
          </Field>
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
          </Field>
          <Field label="Unit of measure" required>
            <Input value={uom} onChange={(e) => setUom(e.target.value)} placeholder="EA / KG / L / BOX" />
          </Field>
          <div className="flex items-end">
            <Button
              disabled={busy || !code || !name || !uom}
              onClick={async () => {
                await run(
                  () => api.createScmItem(token, { code, name, unitOfMeasure: uom }),
                  "Item created.",
                );
                setCode("");
                setName("");
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <Field label="Search">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or code" />
        </Field>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          keyOf={(row) => row.id}
          onRowClick={(row) => void openItem(row)}
          empty={<EmptyState title="No items yet" description="Create one above to start tracking stock." />}
        />
      )}

      {selected ? (
        <>
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">
              Move stock — <Badge>{selected.code}</Badge>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Quantity" required>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </Field>
              <Field label="Reference">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
              </Field>
              <div className="flex items-end gap-2">
                <Button
                  disabled={busy || !quantity}
                  onClick={async () => {
                    await run(
                      () =>
                        api.recordGoodsIn(token, {
                          itemCode: selected.code,
                          quantity: Number(quantity),
                          reference: reference || null,
                        }),
                      "Goods received.",
                    );
                    setQuantity("");
                  }}
                >
                  Receive
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !quantity}
                  onClick={async () => {
                    await run(
                      () =>
                        api.recordGoodsOut(token, {
                          itemCode: selected.code,
                          quantity: Number(quantity),
                          reference: reference || null,
                        }),
                      "Goods issued.",
                    );
                    setQuantity("");
                  }}
                >
                  Issue
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Movement history</h2>
            {movements.length === 0 ? (
              <p className="text-sm text-slate-500">No movements recorded.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {movements.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 p-3">
                    <StatusPill tone={m.movementType === "in" ? "success" : "warning"}>
                      {m.movementType === "in" ? "In" : "Out"}
                    </StatusPill>
                    <span className="font-medium text-slate-900">{m.quantity}</span>
                    <span className="text-slate-500">{formatDate(m.occurredAt)}</span>
                    {m.reference ? <span className="text-slate-500">{m.reference}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

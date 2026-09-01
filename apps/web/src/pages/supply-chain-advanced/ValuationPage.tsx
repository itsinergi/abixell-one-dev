/**
 * Wave A5 — Valuation & Landed Cost: FIFO Layers, Landed Cost Vouchers & Capitalization (SCM-ADV-005).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type ScmItem,
  type ScmLandedCost,
  type ScmLandedCostDetail,
  type ScmLandedCostAllocationMethod,
  type PurchaseOrderRecord,
  type ScmValuationLayer,
  type ScmWarehouse,
} from "../../lib/api";
import { PERMISSIONS } from "../../lib/capabilities";
import { useShell } from "../../shell/layout/AppShell";
import {
  Alert,
  Button,
  Card,
  DataTable,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort, formatMoney } from "../../shared/format";

function label(v: string) {
  return v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function ValuationPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();

  const canManage = permissions.includes(PERMISSIONS.supplyChainValuationManage);

  const [tab, setTab] = useState<"layers" | "landed_costs">("layers");
  const [items, setItems] = useState<ScmItem[]>([]);
  const [warehouses, setWarehouses] = useState<ScmWarehouse[]>([]);
  const [pos, setPos] = useState<PurchaseOrderRecord[]>([]);
  const [layers, setLayers] = useState<ScmValuationLayer[]>([]);
  const [landedCosts, setLandedCosts] = useState<ScmLandedCost[]>([]);

  const [selectedLandedCost, setSelectedLandedCost] = useState<ScmLandedCostDetail | null>(null);

  const [filterItemId, setFilterItemId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form states - Landed Cost
  const [lcPoId, setLcPoId] = useState("");
  const [lcMethod, setLcMethod] = useState<ScmLandedCostAllocationMethod>("by_value");
  const [lcFreight, setLcFreight] = useState("500000");
  const [lcCostType, setLcCostType] = useState("Freight & Logistics");
  const [lcNotes, setLcNotes] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itList, whList, poList, layList, lcList] = await Promise.all([
        api.scmItems(token),
        api.scmWarehouses(token),
        api.purchaseOrders(token),
        api.scmValuationLayers(token, filterItemId ? { itemId: filterItemId } : undefined),
        api.scmLandedCosts(token),
      ]);
      setItems(itList);
      setWarehouses(whList);
      setPos(poList);
      setLayers(layList);
      setLandedCosts(lcList);

      if (poList.length > 0 && !lcPoId) setLcPoId(poList[0].id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load valuation data");
    } finally {
      setLoading(false);
    }
  }, [token, filterItemId, lcPoId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const poMap = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);

  async function handleCreateLandedCost(e: React.FormEvent) {
    e.preventDefault();
    if (!lcPoId || items.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const targetItem = items[0];
      const allocAmount = Number(lcFreight) || 0;
      await api.createScmLandedCost(token, {
        purchaseOrderId: lcPoId,
        costType: lcCostType,
        amount: allocAmount,
        allocationMethod: lcMethod,
        notes: lcNotes.trim() || null,
        allocations: [
          {
            itemId: targetItem.id,
            allocatedAmount: allocAmount,
            costPerUnitAdded: 1000,
          },
        ],
      });
      setNotice("Landed cost voucher created.");
      setLcNotes("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create landed cost voucher");
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyLandedCost(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.applyScmLandedCost(token, id);
      setNotice("Landed cost allocated and applied to inventory valuation layers.");
      await loadData();
      if (selectedLandedCost && selectedLandedCost.landedCost.id === id) {
        const updated = await api.scmLandedCost(token, id);
        setSelectedLandedCost(updated);
      }
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to apply landed cost");
    } finally {
      setBusy(false);
    }
  }

  async function openLandedCostDetail(id: string) {
    setBusy(true);
    setError(null);
    try {
      const dt = await api.scmLandedCost(token, id);
      setSelectedLandedCost(dt);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load landed cost detail");
    } finally {
      setBusy(false);
    }
  }

  const layerColumns: Column<ScmValuationLayer>[] = [
    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId, mobileRole: "title" },
    { header: "Warehouse", cell: (r) => r.warehouseId ? (whMap.get(r.warehouseId)?.name || r.warehouseId) : "Global" },
    { header: "Original Qty", cell: (r) => <span className="font-mono">{r.originalQuantity}</span> },
    { header: "Remaining Qty", cell: (r) => <span className="font-mono font-bold text-blue-600">{r.remainingQuantity}</span> },
    { header: "Unit Cost (IDR)", cell: (r) => <span className="font-mono">{formatMoney(String(r.effectiveUnitCost))}</span> },
    { header: "Total Remaining Value", cell: (r) => <span className="font-mono font-semibold text-emerald-600">{formatMoney(String(r.totalValue))}</span>, mobileRole: "status" },
    { header: "Received Date", cell: (r) => formatDateShort(r.receivedDate) },
  ];

  const landedCostColumns: Column<ScmLandedCost>[] = [
    { header: "Voucher #", cell: (r) => <span className="font-mono font-semibold">{r.voucherNumber}</span>, mobileRole: "title" },
    { header: "Purchase Order", cell: (r) => poMap.get(r.purchaseOrderId)?.orderNumber || r.purchaseOrderId },
    { header: "Cost Type", cell: (r) => r.costType },
    { header: "Method", cell: (r) => label(r.allocationMethod) },
    { header: "Amount", cell: (r) => <span className="font-mono font-bold text-slate-800">{formatMoney(String(r.amount))}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={r.status === "applied" ? "success" : "warning"}>{label(r.status)}</StatusPill>, mobileRole: "status" },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => openLandedCostDetail(r.id)}>Detail</Button>
          {r.status === "draft" && (
            <Button variant="primary" onClick={() => handleApplyLandedCost(r.id)} disabled={!canManage || busy}>Apply</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Valuation & Landed Cost"
        subtitle="Immutable FIFO valuation layers, total capitalized inventory value, and landed cost allocation vouchers."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <Button variant={tab === "layers" ? "primary" : "secondary"} onClick={() => { setTab("layers"); setSelectedLandedCost(null); }}>FIFO Valuation Layers</Button>
        <Button variant={tab === "landed_costs" ? "primary" : "secondary"} onClick={() => setTab("landed_costs")}>Landed Cost Allocations</Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : tab === "layers" ? (
        <div className="space-y-4">
          <div className="flex gap-4 items-center">
            <Field label="Filter by Item">
              <Select value={filterItemId} onChange={(e) => setFilterItemId(e.target.value)}>
                <option value="">All Inventory Items</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
              </Select>
            </Field>
          </div>
          <Card>
            <h3 className="text-base font-semibold text-slate-900 mb-3">Active FIFO Inventory Layers</h3>
            <DataTable columns={layerColumns} rows={layers} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No active inventory valuation layers found.</p>} />
          </Card>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <h3 className="text-base font-semibold text-slate-900 mb-3">Landed Cost Vouchers</h3>
                <DataTable columns={landedCostColumns} rows={landedCosts} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No landed cost vouchers created.</p>} />
              </Card>
            </div>
            <div>
              <Card>
                <h3 className="text-base font-semibold text-slate-900 mb-3">Create Landed Cost Voucher</h3>
                <form onSubmit={handleCreateLandedCost} className="space-y-4">
                  <Field label="Target Purchase Order" required>
                    <Select value={lcPoId} onChange={(e) => setLcPoId(e.target.value)} disabled={!canManage || busy}>
                      {pos.map((p) => <option key={p.id} value={p.id}>{p.orderNumber}</option>)}
                    </Select>
                  </Field>
                  <Field label="Cost Type" required>
                    <Input value={lcCostType} onChange={(e) => setLcCostType(e.target.value)} disabled={!canManage || busy} />
                  </Field>
                  <Field label="Allocation Basis" required>
                    <Select value={lcMethod} onChange={(e) => setLcMethod(e.target.value as ScmLandedCostAllocationMethod)} disabled={!canManage || busy}>
                      <option value="by_value">By Line Item Value (Default)</option>
                      <option value="by_quantity">By Line Quantity</option>
                      <option value="by_weight">By Line Weight</option>
                      <option value="equal">Equal Allocation</option>
                    </Select>
                  </Field>
                  <Field label="Amount (IDR)" required>
                    <Input type="number" value={lcFreight} onChange={(e) => setLcFreight(e.target.value)} disabled={!canManage || busy} />
                  </Field>
                  <Field label="Voucher Notes">
                    <Input value={lcNotes} onChange={(e) => setLcNotes(e.target.value)} placeholder="Customs bill / B/L reference" disabled={!canManage || busy} />
                  </Field>
                  <Button type="submit" variant="primary" disabled={!canManage || busy}>Generate Voucher</Button>
                </form>
              </Card>
            </div>
          </div>

          {selectedLandedCost && (
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">{`Landed Cost Breakdown: ${selectedLandedCost.landedCost.voucherNumber}`}</h3>
              <div className="space-y-4">
                <div className="flex gap-4 text-sm">
                  <div><strong>Status:</strong> <StatusPill tone={selectedLandedCost.landedCost.status === "applied" ? "success" : "warning"}>{label(selectedLandedCost.landedCost.status)}</StatusPill></div>
                  <div><strong>Total Cost:</strong> <span className="font-mono font-bold">{formatMoney(String(selectedLandedCost.landedCost.amount))}</span></div>
                  <div><strong>Method:</strong> {label(selectedLandedCost.landedCost.allocationMethod)}</div>
                </div>
                <DataTable
                  columns={[
                    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId, mobileRole: "title" },
                    { header: "Allocated Amount", cell: (r) => <span className="font-mono font-bold text-amber-600">+{formatMoney(String(r.allocatedAmount))}</span> },
                    { header: "Cost Per Unit Added", cell: (r) => <span className="font-mono font-bold text-emerald-600">+{formatMoney(String(r.costPerUnitAdded))}</span>, mobileRole: "status" },
                  ]}
                  rows={selectedLandedCost.allocations}
                  keyOf={(r) => r.id}
                />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

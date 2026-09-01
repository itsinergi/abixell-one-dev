/**
 * Wave A5 — Stock Operations: Reorder Policies, Reservations, Transfers & Opname (SCM-ADV-004).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type ScmItem,
  type ScmReorderAlert,
  type ScmReorderPolicy,
  type ScmStockOpname,
  type ScmStockOpnameDetail,
  type ScmStockReservation,
  type ScmStockTransfer,
  type ScmStockTransferDetail,
  type ScmWarehouse,
} from "../../lib/api";
import { PERMISSIONS } from "../../lib/capabilities";
import { useShell } from "../../shell/layout/AppShell";
import {
  Alert,
  Badge,
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
import { formatDateShort } from "../../shared/format";

function label(v: string) {
  return v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function StockOperationsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();

  const canManage = permissions.includes(PERMISSIONS.supplyChainInventoryManage);
  const canApprove = permissions.includes(PERMISSIONS.supplyChainInventoryApprove);

  const [tab, setTab] = useState<"alerts" | "policies" | "reservations" | "transfers" | "opnames">("alerts");
  const [items, setItems] = useState<ScmItem[]>([]);
  const [warehouses, setWarehouses] = useState<ScmWarehouse[]>([]);
  const [alerts, setAlerts] = useState<ScmReorderAlert[]>([]);
  const [policies, setPolicies] = useState<ScmReorderPolicy[]>([]);
  const [reservations, setReservations] = useState<ScmStockReservation[]>([]);
  const [transfers, setTransfers] = useState<ScmStockTransfer[]>([]);
  const [opnames, setOpnames] = useState<ScmStockOpname[]>([]);

  const [selectedTransfer, setSelectedTransfer] = useState<ScmStockTransferDetail | null>(null);
  const [selectedOpname, setSelectedOpname] = useState<ScmStockOpnameDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form states - Reorder Policy
  const [polItemId, setPolItemId] = useState("");
  const [polWhId, setPolWhId] = useState("");
  const [polMinQty, setPolMinQty] = useState("10");
  const [polReorderPoint, setPolReorderPoint] = useState("20");
  const [polReorderQty, setPolReorderQty] = useState("50");
  const [polSafetyStock, setPolSafetyStock] = useState("5");
  const [polLeadDays, setPolLeadDays] = useState("7");

  // Form states - Reservation
  const [resNumber, setResNumber] = useState("");
  const [resItemId, setResItemId] = useState("");
  const [resWhId, setResWhId] = useState("");
  const [resQty, setResQty] = useState("5");
  const [resForType, setResForType] = useState("work_order");
  const [resForNumber, setResForNumber] = useState("");
  const [resNotes, setResNotes] = useState("");

  // Form states - Transfer
  const [trFromWhId, setTrFromWhId] = useState("");
  const [trToWhId, setTrToWhId] = useState("");
  const [trItemId, setTrItemId] = useState("");
  const [trQty, setTrQty] = useState("10");
  const [trNotes, setTrNotes] = useState("");

  // Form states - Opname
  const [opWhId, setOpWhId] = useState("");
  const [opDate, setOpDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [opNotes, setOpNotes] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itList, whList, alertList, polList, resList, trList, opList] = await Promise.all([
        api.scmItems(token),
        api.scmWarehouses(token),
        api.scmReorderAlerts(token),
        api.scmReorderPolicies(token),
        api.scmStockReservations(token),
        api.scmStockTransfers(token),
        api.scmStockOpnames(token),
      ]);
      setItems(itList);
      setWarehouses(whList);
      setAlerts(alertList);
      setPolicies(polList);
      setReservations(resList);
      setTransfers(trList);
      setOpnames(opList);

      if (itList.length > 0 && !polItemId) setPolItemId(itList[0].id);
      if (itList.length > 0 && !resItemId) setResItemId(itList[0].id);
      if (itList.length > 0 && !trItemId) setTrItemId(itList[0].id);
      if (whList.length > 0 && !resWhId) setResWhId(whList[0].id);
      if (whList.length > 0 && !trFromWhId) setTrFromWhId(whList[0].id);
      if (whList.length > 1 && !trToWhId) setTrToWhId(whList[1].id);
      if (whList.length > 0 && !opWhId) setOpWhId(whList[0].id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load stock operations");
    } finally {
      setLoading(false);
    }
  }, [token, polItemId, resItemId, trItemId, resWhId, trFromWhId, trToWhId, opWhId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  async function handleUpsertPolicy(e: React.FormEvent) {
    e.preventDefault();
    if (!polItemId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.upsertScmReorderPolicy(token, {
        itemId: polItemId,
        warehouseId: polWhId || null,
        minQuantity: Number(polMinQty),
        reorderPoint: Number(polReorderPoint),
        reorderQuantity: Number(polReorderQty),
        safetyStock: Number(polSafetyStock),
        leadTimeDays: Number(polLeadDays),
      });
      setNotice("Reorder policy saved.");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to save reorder policy");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateReservation(e: React.FormEvent) {
    e.preventDefault();
    if (!resNumber.trim() || !resItemId || !resWhId || Number(resQty) <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmStockReservation(token, {
        reservationNumber: resNumber.trim(),
        itemId: resItemId,
        warehouseId: resWhId,
        quantity: Number(resQty),
        reservedForType: resForType,
        reservedForNumber: resForNumber.trim() || null,
        notes: resNotes.trim() || null,
      });
      setNotice(`Reservation ${resNumber} created.`);
      setResNumber("");
      setResForNumber("");
      setResNotes("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create reservation");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!trFromWhId || !trToWhId || trFromWhId === trToWhId || !trItemId || Number(trQty) <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmStockTransfer(token, {
        fromWarehouseId: trFromWhId,
        toWarehouseId: trToWhId,
        notes: trNotes.trim() || null,
        lines: [{ itemId: trItemId, quantityRequested: Number(trQty) }],
      });
      setNotice("Transfer request initiated.");
      setTrNotes("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to initiate transfer");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateOpname(e: React.FormEvent) {
    e.preventDefault();
    if (!opWhId || !opDate || items.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmStockOpname(token, {
        warehouseId: opWhId,
        opnameDate: opDate,
        notes: opNotes.trim() || null,
        lines: items.slice(0, 10).map((i) => ({ itemId: i.id, systemQuantity: 10 })),
      });
      setNotice("Stock Opname cycle started.");
      setOpNotes("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to start stock opname");
    } finally {
      setBusy(false);
    }
  }

  async function handleFulfillReservation(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.fulfillScmStockReservation(token, id);
      setNotice("Reservation fulfilled.");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to fulfill reservation");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelReservation(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.cancelScmStockReservation(token, id);
      setNotice("Reservation cancelled.");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel reservation");
    } finally {
      setBusy(false);
    }
  }

  async function openTransferDetail(id: string) {
    setBusy(true);
    setError(null);
    try {
      const dt = await api.scmStockTransfer(token, id);
      setSelectedTransfer(dt);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load transfer detail");
    } finally {
      setBusy(false);
    }
  }

  async function openOpnameDetail(id: string) {
    setBusy(true);
    setError(null);
    try {
      const dt = await api.scmStockOpname(token, id);
      setSelectedOpname(dt);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load opname detail");
    } finally {
      setBusy(false);
    }
  }

  const alertColumns: Column<ScmReorderAlert>[] = [
    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId, mobileRole: "title" },
    { header: "Warehouse", cell: (r) => r.warehouseId ? (whMap.get(r.warehouseId)?.name || r.warehouseId) : "All Warehouses" },
    { header: "Current Balance", cell: (r) => <span className="font-mono font-bold text-red-600">{r.currentBalance}</span>, mobileRole: "status" },
    { header: "Reorder Point", cell: (r) => <span className="font-mono">{r.reorderPoint}</span> },
    { header: "Suggested Reorder Qty", cell: (r) => <span className="font-mono font-bold text-emerald-600">{r.suggestedReorderQuantity}</span> },
  ];

  const policyColumns: Column<ScmReorderPolicy>[] = [
    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId, mobileRole: "title" },
    { header: "Warehouse", cell: (r) => r.warehouseId ? (whMap.get(r.warehouseId)?.name || r.warehouseId) : "Global / All" },
    { header: "Min Qty", cell: (r) => r.minQuantity },
    { header: "ROP", cell: (r) => r.reorderPoint },
    { header: "ROQ", cell: (r) => r.reorderQuantity },
    { header: "Safety Stock", cell: (r) => r.safetyStock },
    { header: "Lead Time (Days)", cell: (r) => `${r.leadTimeDays}d`, mobileRole: "status" },
  ];

  const reservationColumns: Column<ScmStockReservation>[] = [
    { header: "Reservation #", cell: (r) => <span className="font-mono font-semibold">{r.reservationNumber}</span>, mobileRole: "title" },
    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId },
    { header: "Warehouse", cell: (r) => whMap.get(r.warehouseId)?.name || r.warehouseId },
    { header: "Qty", cell: (r) => <span className="font-mono font-bold">{r.quantity}</span> },
    { header: "Reserved For", cell: (r) => `${label(r.reservedForType)} ${r.reservedForNumber || ""}` },
    { header: "Status", cell: (r) => <StatusPill tone={r.status === "active" ? "warning" : r.status === "fulfilled" ? "success" : "neutral"}>{label(r.status)}</StatusPill>, mobileRole: "status" },
    {
      header: "Actions",
      cell: (r) =>
        r.status === "active" ? (
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => handleFulfillReservation(r.id)} disabled={!canManage || busy}>Fulfill</Button>
            <Button variant="secondary" onClick={() => handleCancelReservation(r.id)} disabled={!canManage || busy}>Cancel</Button>
          </div>
        ) : null,
    },
  ];

  const transferColumns: Column<ScmStockTransfer>[] = [
    { header: "Transfer #", cell: (r) => <span className="font-mono font-semibold">{r.transferNumber}</span>, mobileRole: "title" },
    { header: "Origin", cell: (r) => whMap.get(r.fromWarehouseId)?.name || r.fromWarehouseId },
    { header: "Destination", cell: (r) => whMap.get(r.toWarehouseId)?.name || r.toWarehouseId },
    { header: "Status", cell: (r) => <StatusPill tone={r.status === "received" ? "success" : r.status === "in_transit" ? "warning" : "info"}>{label(r.status)}</StatusPill>, mobileRole: "status" },
    { header: "Requested Date", cell: (r) => formatDateShort(r.createdAt) },
    {
      header: "Inspect",
      cell: (r) => <Button variant="secondary" onClick={() => openTransferDetail(r.id)}>Detail</Button>,
    },
  ];

  const opnameColumns: Column<ScmStockOpname>[] = [
    { header: "Opname #", cell: (r) => <span className="font-mono font-semibold">{r.opnameNumber}</span>, mobileRole: "title" },
    { header: "Warehouse", cell: (r) => whMap.get(r.warehouseId)?.name || r.warehouseId },
    { header: "Audit Date", cell: (r) => formatDateShort(r.opnameDate) },
    { header: "Status", cell: (r) => <StatusPill tone={r.status === "adjusted" || r.status === "approved" ? "success" : "warning"}>{label(r.status)}</StatusPill>, mobileRole: "status" },
    {
      header: "Inspect",
      cell: (r) => <Button variant="secondary" onClick={() => openOpnameDetail(r.id)}>Detail</Button>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Operations"
        subtitle="Dynamic reorder alerts, stock reservations, warehouse transfer logistics, and stock opname reconciliation."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <Button variant={tab === "alerts" ? "primary" : "secondary"} onClick={() => { setTab("alerts"); setSelectedTransfer(null); setSelectedOpname(null); }}>Reorder Alerts ({alerts.length})</Button>
        <Button variant={tab === "policies" ? "primary" : "secondary"} onClick={() => { setTab("policies"); setSelectedTransfer(null); setSelectedOpname(null); }}>Reorder Policies</Button>
        <Button variant={tab === "reservations" ? "primary" : "secondary"} onClick={() => { setTab("reservations"); setSelectedTransfer(null); setSelectedOpname(null); }}>Stock Reservations</Button>
        <Button variant={tab === "transfers" ? "primary" : "secondary"} onClick={() => { setTab("transfers"); setSelectedOpname(null); }}>Stock Transfers</Button>
        <Button variant={tab === "opnames" ? "primary" : "secondary"} onClick={() => { setTab("opnames"); setSelectedTransfer(null); }}>Stock Opname</Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : tab === "alerts" ? (
        <Card>
          <h3 className="text-base font-semibold text-slate-900 mb-3">Critical Reorder Alerts</h3>
          <DataTable columns={alertColumns} rows={alerts} keyOf={(r) => r.itemId} empty={<p className="text-slate-500 py-4 text-center text-sm">All inventory levels are above reorder thresholds.</p>} />
        </Card>
      ) : tab === "policies" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Configured Reorder Policies</h3>
              <DataTable columns={policyColumns} rows={policies} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No reorder policies configured yet.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Set Reorder Policy</h3>
              <form onSubmit={handleUpsertPolicy} className="space-y-4">
                <Field label="Item" required>
                  <Select value={polItemId} onChange={(e) => setPolItemId(e.target.value)} disabled={!canManage || busy}>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
                  </Select>
                </Field>
                <Field label="Warehouse Scope">
                  <Select value={polWhId} onChange={(e) => setPolWhId(e.target.value)} disabled={!canManage || busy}>
                    <option value="">Global / All Warehouses</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Min Qty" required><Input type="number" value={polMinQty} onChange={(e) => setPolMinQty(e.target.value)} disabled={!canManage || busy} /></Field>
                  <Field label="Reorder Point" required><Input type="number" value={polReorderPoint} onChange={(e) => setPolReorderPoint(e.target.value)} disabled={!canManage || busy} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Reorder Qty" required><Input type="number" value={polReorderQty} onChange={(e) => setPolReorderQty(e.target.value)} disabled={!canManage || busy} /></Field>
                  <Field label="Safety Stock"><Input type="number" value={polSafetyStock} onChange={(e) => setPolSafetyStock(e.target.value)} disabled={!canManage || busy} /></Field>
                  <Field label="Lead Days"><Input type="number" value={polLeadDays} onChange={(e) => setPolLeadDays(e.target.value)} disabled={!canManage || busy} /></Field>
                </div>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Save Policy</Button>
              </form>
            </Card>
          </div>
        </div>
      ) : tab === "reservations" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Stock Reservations</h3>
              <DataTable columns={reservationColumns} rows={reservations} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No active reservations.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Create Stock Reservation</h3>
              <form onSubmit={handleCreateReservation} className="space-y-4">
                <Field label="Reservation #" required>
                  <Input value={resNumber} onChange={(e) => setResNumber(e.target.value)} placeholder="e.g. RES-2026-001" disabled={!canManage || busy} />
                </Field>
                <Field label="Item" required>
                  <Select value={resItemId} onChange={(e) => setResItemId(e.target.value)} disabled={!canManage || busy}>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
                  </Select>
                </Field>
                <Field label="Warehouse" required>
                  <Select value={resWhId} onChange={(e) => setResWhId(e.target.value)} disabled={!canManage || busy}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
                <Field label="Quantity" required>
                  <Input type="number" min="0.01" step="any" value={resQty} onChange={(e) => setResQty(e.target.value)} disabled={!canManage || busy} />
                </Field>
                <Field label="Reserved For Type" required>
                  <Select value={resForType} onChange={(e) => setResForType(e.target.value)} disabled={!canManage || busy}>
                    <option value="work_order">Work Order</option>
                    <option value="project">Project</option>
                    <option value="sales_order">Sales Order</option>
                  </Select>
                </Field>
                <Field label="Reference Number">
                  <Input value={resForNumber} onChange={(e) => setResForNumber(e.target.value)} placeholder="WO-2026-012" disabled={!canManage || busy} />
                </Field>
                <Field label="Notes">
                  <Input value={resNotes} onChange={(e) => setResNotes(e.target.value)} placeholder="Reservation reason..." disabled={!canManage || busy} />
                </Field>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Place Reservation</Button>
              </form>
            </Card>
          </div>
        </div>
      ) : tab === "transfers" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <h3 className="text-base font-semibold text-slate-900 mb-3">Warehouse Stock Transfers</h3>
                <DataTable columns={transferColumns} rows={transfers} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No transfers registered.</p>} />
              </Card>
            </div>
            <div>
              <Card>
                <h3 className="text-base font-semibold text-slate-900 mb-3">Initiate Stock Transfer</h3>
                <form onSubmit={handleCreateTransfer} className="space-y-4">
                  <Field label="Origin Warehouse" required>
                    <Select value={trFromWhId} onChange={(e) => setTrFromWhId(e.target.value)} disabled={!canManage || busy}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Destination Warehouse" required>
                    <Select value={trToWhId} onChange={(e) => setTrToWhId(e.target.value)} disabled={!canManage || busy}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Item to Transfer" required>
                    <Select value={trItemId} onChange={(e) => setTrItemId(e.target.value)} disabled={!canManage || busy}>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
                    </Select>
                  </Field>
                  <Field label="Quantity" required>
                    <Input type="number" min="0.01" step="any" value={trQty} onChange={(e) => setTrQty(e.target.value)} disabled={!canManage || busy} />
                  </Field>
                  <Field label="Notes">
                    <Input value={trNotes} onChange={(e) => setTrNotes(e.target.value)} placeholder="Logistics notes / transfer rationale" disabled={!canManage || busy} />
                  </Field>
                  <Button type="submit" variant="primary" disabled={!canManage || busy}>Request Transfer</Button>
                </form>
              </Card>
            </div>
          </div>
          {selectedTransfer && (
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">{`Transfer ${selectedTransfer.transfer.transferNumber}`}</h3>
              <div className="space-y-4">
                <div className="flex gap-4 text-sm">
                  <div><strong>Status:</strong> <StatusPill tone="info">{label(selectedTransfer.transfer.status)}</StatusPill></div>
                  <div><strong>From:</strong> {whMap.get(selectedTransfer.transfer.fromWarehouseId)?.name}</div>
                  <div><strong>To:</strong> {whMap.get(selectedTransfer.transfer.toWarehouseId)?.name}</div>
                </div>
                <DataTable
                  columns={[
                    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId, mobileRole: "title" },
                    { header: "Requested Qty", cell: (r) => r.quantityRequested },
                    { header: "Shipped Qty", cell: (r) => r.quantityShipped },
                    { header: "Received Qty", cell: (r) => r.quantityReceived, mobileRole: "status" },
                  ]}
                  rows={selectedTransfer.lines}
                  keyOf={(r) => r.id}
                />
              </div>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <h3 className="text-base font-semibold text-slate-900 mb-3">Stock Opname Audits</h3>
                <DataTable columns={opnameColumns} rows={opnames} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No opname audits found.</p>} />
              </Card>
            </div>
            <div>
              <Card>
                <h3 className="text-base font-semibold text-slate-900 mb-3">Initiate Opname Audit</h3>
                <form onSubmit={handleCreateOpname} className="space-y-4">
                  <Field label="Warehouse to Audit" required>
                    <Select value={opWhId} onChange={(e) => setOpWhId(e.target.value)} disabled={!canManage || busy}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Audit Date" required>
                    <Input type="date" value={opDate} onChange={(e) => setOpDate(e.target.value)} disabled={!canManage || busy} />
                  </Field>
                  <Field label="Audit Notes">
                    <Input value={opNotes} onChange={(e) => setOpNotes(e.target.value)} placeholder="Quarterly full count cycle..." disabled={!canManage || busy} />
                  </Field>
                  <Button type="submit" variant="primary" disabled={!canManage || busy}>Start Opname</Button>
                </form>
              </Card>
            </div>
          </div>
          {selectedOpname && (
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">{`Opname ${selectedOpname.opname.opnameNumber}`}</h3>
              <div className="space-y-4">
                <div className="flex gap-4 text-sm">
                  <div><strong>Status:</strong> <StatusPill tone="info">{label(selectedOpname.opname.status)}</StatusPill></div>
                  <div><strong>Warehouse:</strong> {whMap.get(selectedOpname.opname.warehouseId)?.name}</div>
                  <div><strong>Date:</strong> {formatDateShort(selectedOpname.opname.opnameDate)}</div>
                </div>
                <DataTable
                  columns={[
                    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId, mobileRole: "title" },
                    { header: "System Qty", cell: (r) => r.systemQuantity },
                    { header: "Physical Count", cell: (r) => r.physicalQuantity ?? "—" },
                    { header: "Variance", cell: (r) => r.varianceQuantity ?? "—", mobileRole: "status" },
                  ]}
                  rows={selectedOpname.lines}
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

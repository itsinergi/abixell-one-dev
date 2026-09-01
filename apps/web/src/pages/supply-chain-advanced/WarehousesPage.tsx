/**
 * Wave A5 — Warehouses, Bin/Locations, Batches & Serials (SCM-ADV-001..003).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type ScmItem,
  type ScmItemBatch,
  type ScmItemSerial,
  type ScmSerialStatus,
  type ScmWarehouse,
  type ScmWarehouseLocation,
  type ScmAdvancedStockBalance,
  type ScmAdvancedStockMovement,
  type ScmAdvancedStockMovementType,
  type SiteRecord,
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

const MOVEMENT_TYPES: ScmAdvancedStockMovementType[] = [
  "in",
  "out",
  "transfer_in",
  "transfer_out",
  "adjustment_in",
  "adjustment_out",
  "opname_in",
  "opname_out",
];

function label(v: string): string {
  return v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function WarehousesPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();

  const canManage = permissions.includes(PERMISSIONS.supplyChainWarehouseManage);

  const [tab, setTab] = useState<"warehouses" | "locations" | "batches" | "serials" | "balances" | "movements">("warehouses");
  const [warehouses, setWarehouses] = useState<ScmWarehouse[]>([]);
  const [locations, setLocations] = useState<ScmWarehouseLocation[]>([]);
  const [batches, setBatches] = useState<ScmItemBatch[]>([]);
  const [serials, setSerials] = useState<ScmItemSerial[]>([]);
  const [balances, setBalances] = useState<ScmAdvancedStockBalance[]>([]);
  const [movements, setMovements] = useState<ScmAdvancedStockMovement[]>([]);
  const [items, setItems] = useState<ScmItem[]>([]);
  const [sites, setSites] = useState<SiteRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form states - Warehouse
  const [whCode, setWhCode] = useState("");
  const [whName, setWhName] = useState("");
  const [whSiteId, setWhSiteId] = useState("");
  const [whAddress, setWhAddress] = useState("");

  // Form states - Location
  const [locWhId, setLocWhId] = useState("");
  const [locCode, setLocCode] = useState("");
  const [locZone, setLocZone] = useState("");
  const [locAisle, setLocAisle] = useState("");
  const [locRack, setLocRack] = useState("");
  const [locShelf, setLocShelf] = useState("");
  const [locBin, setLocBin] = useState("");

  // Form states - Batch
  const [batchItemId, setBatchItemId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [batchMfgDate, setBatchMfgDate] = useState("");
  const [batchExpDate, setBatchExpDate] = useState("");
  const [batchNotes, setBatchNotes] = useState("");

  // Form states - Serial
  const [serialItemId, setSerialItemId] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [serialWhId, setSerialWhId] = useState("");
  const [serialLocId, setSerialLocId] = useState("");
  const [serialBatchId, setSerialBatchId] = useState("");
  const [serialWarranty, setSerialWarranty] = useState("");

  // Form states - Movement
  const [movItemId, setMovItemId] = useState("");
  const [movWhId, setMovWhId] = useState("");
  const [movLocId, setMovLocId] = useState("");
  const [movBatchId, setMovBatchId] = useState("");
  const [movType, setMovType] = useState<ScmAdvancedStockMovementType>("in");
  const [movQty, setMovQty] = useState("10");
  const [movUnitCost, setMovUnitCost] = useState("0");
  const [movNotes, setMovNotes] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [whList, itList, locList, bList, sList, balList, movList] = await Promise.all([
        api.scmWarehouses(token),
        api.scmItems(token),
        api.scmWarehouseLocations(token),
        api.scmBatches(token, { includeExpired: true }),
        api.scmSerials(token),
        api.scmAdvancedStockBalances(token),
        api.scmAdvancedStockMovements(token, { limit: 100 }),
      ]);
      setWarehouses(whList);
      setItems(itList);
      setLocations(locList);
      setBatches(bList);
      setSerials(sList);
      setBalances(balList);
      setMovements(movList);
      if (whList.length > 0 && !locWhId) setLocWhId(whList[0].id);
      if (whList.length > 0 && !movWhId) setMovWhId(whList[0].id);
      if (whList.length > 0 && !serialWhId) setSerialWhId(whList[0].id);
      if (itList.length > 0 && !batchItemId) setBatchItemId(itList[0].id);
      if (itList.length > 0 && !serialItemId) setSerialItemId(itList[0].id);
      if (itList.length > 0 && !movItemId) setMovItemId(itList[0].id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load warehouse data");
    } finally {
      setLoading(false);
    }
  }, [token, locWhId, movWhId, serialWhId, batchItemId, serialItemId, movItemId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const whMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const locMap = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const batchMap = useMemo(() => new Map(batches.map((b) => [b.id, b])), [batches]);

  async function handleCreateWarehouse(e: React.FormEvent) {
    e.preventDefault();
    if (!whCode.trim() || !whName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmWarehouse(token, {
        code: whCode.trim(),
        name: whName.trim(),
        siteId: whSiteId || null,
        address: whAddress.trim() || null,
      });
      setNotice(`Warehouse ${whCode} created.`);
      setWhCode("");
      setWhName("");
      setWhAddress("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create warehouse");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateLocation(e: React.FormEvent) {
    e.preventDefault();
    if (!locWhId || !locCode.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmWarehouseLocation(token, {
        warehouseId: locWhId,
        code: locCode.trim(),
        zone: locZone.trim() || null,
        aisle: locAisle.trim() || null,
        rack: locRack.trim() || null,
        shelf: locShelf.trim() || null,
        bin: locBin.trim() || null,
      });
      setNotice(`Location ${locCode} created.`);
      setLocCode("");
      setLocZone("");
      setLocAisle("");
      setLocRack("");
      setLocShelf("");
      setLocBin("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create location");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateBatch(e: React.FormEvent) {
    e.preventDefault();
    if (!batchItemId || !batchNumber.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmBatch(token, {
        itemId: batchItemId,
        batchNumber: batchNumber.trim(),
        manufacturedDate: batchMfgDate || null,
        expiryDate: batchExpDate || null,
        notes: batchNotes.trim() || null,
      });
      setNotice(`Batch ${batchNumber} created.`);
      setBatchNumber("");
      setBatchMfgDate("");
      setBatchExpDate("");
      setBatchNotes("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create batch");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateSerial(e: React.FormEvent) {
    e.preventDefault();
    if (!serialItemId || !serialNumber.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmSerial(token, {
        itemId: serialItemId,
        serialNumber: serialNumber.trim(),
        warehouseId: serialWhId || null,
        locationId: serialLocId || null,
        batchId: serialBatchId || null,
        warrantyExpiryDate: serialWarranty || null,
      });
      setNotice(`Serial ${serialNumber} registered.`);
      setSerialNumber("");
      setSerialWarranty("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create serial");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!movItemId || !movWhId || Number(movQty) <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.recordScmAdvancedStockMovement(token, {
        itemId: movItemId,
        warehouseId: movWhId,
        locationId: movLocId || null,
        batchId: movBatchId || null,
        movementType: movType,
        quantity: Number(movQty),
        unitCost: Number(movUnitCost) || 0,
        notes: movNotes.trim() || null,
      });
      setNotice("Movement recorded successfully.");
      setMovNotes("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to record movement");
    } finally {
      setBusy(false);
    }
  }

  const warehouseColumns: Column<ScmWarehouse>[] = [
    {
      header: "Code",
      cell: (r) => <span className="font-mono font-semibold">{r.code}</span>,
      mobileRole: "title",
    },
    { header: "Name", cell: (r) => r.name },
    { header: "Address", cell: (r) => r.address || "—" },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</StatusPill>,
      mobileRole: "status",
    },
    { header: "Created", cell: (r) => formatDateShort(r.createdAt) },
  ];

  const locationColumns: Column<ScmWarehouseLocation>[] = [
    { header: "Warehouse", cell: (r) => whMap.get(r.warehouseId)?.name || r.warehouseId },
    {
      header: "Location Code",
      cell: (r) => <span className="font-mono font-semibold">{r.code}</span>,
      mobileRole: "title",
    },
    { header: "Zone / Aisle", cell: (r) => `${r.zone || "—"} / ${r.aisle || "—"}` },
    { header: "Rack / Shelf / Bin", cell: (r) => `${r.rack || "—"} / ${r.shelf || "—"} / ${r.bin || "—"}` },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "Active" : "Inactive"}</StatusPill>,
      mobileRole: "status",
    },
  ];

  const batchColumns: Column<ScmItemBatch>[] = [
    {
      header: "Batch #",
      cell: (r) => <span className="font-mono font-semibold">{r.batchNumber}</span>,
      mobileRole: "title",
    },
    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId },
    { header: "Mfg Date", cell: (r) => r.manufacturedDate ? formatDateShort(r.manufacturedDate) : "—" },
    { header: "Expiry Date", cell: (r) => r.expiryDate ? formatDateShort(r.expiryDate) : "—" },
    { header: "Notes", cell: (r) => r.notes || "—" },
  ];

  const serialColumns: Column<ScmItemSerial>[] = [
    {
      header: "Serial #",
      cell: (r) => <span className="font-mono font-semibold">{r.serialNumber}</span>,
      mobileRole: "title",
    },
    { header: "Item", cell: (r) => itemMap.get(r.itemId)?.name || r.itemId },
    { header: "Warehouse", cell: (r) => r.warehouseId ? (whMap.get(r.warehouseId)?.name || r.warehouseId) : "—" },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={r.status === "in_stock" ? "success" : r.status === "reserved" ? "warning" : "neutral"}>{label(r.status)}</StatusPill>,
      mobileRole: "status",
    },
    { header: "Warranty Expiry", cell: (r) => r.warrantyExpiryDate ? formatDateShort(r.warrantyExpiryDate) : "—" },
  ];

  const balanceColumns: Column<ScmAdvancedStockBalance>[] = [
    {
      header: "Item",
      cell: (r) => itemMap.get(r.itemId)?.name || r.itemId,
      mobileRole: "title",
    },
    { header: "Warehouse", cell: (r) => whMap.get(r.warehouseId)?.name || r.warehouseId },
    { header: "Location", cell: (r) => r.locationId ? (locMap.get(r.locationId)?.code || r.locationId) : "—" },
    { header: "Batch", cell: (r) => r.batchId ? (batchMap.get(r.batchId)?.batchNumber || r.batchId) : "—" },
    { header: "On Hand", cell: (r) => <span className="font-mono font-bold">{r.quantity}</span> },
    { header: "Reserved", cell: (r) => <span className="font-mono text-amber-600">{r.reservedQty}</span> },
    {
      header: "Available",
      cell: (r) => <span className="font-mono font-bold text-emerald-600">{r.availableQuantity}</span>,
      mobileRole: "status",
    },
  ];

  const movementColumns: Column<ScmAdvancedStockMovement>[] = [
    { header: "Date", cell: (r) => formatDateShort(r.occurredAt) },
    {
      header: "Type",
      cell: (r) => <Badge className={r.movementType.includes("in") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}>{label(r.movementType)}</Badge>,
      mobileRole: "status",
    },
    {
      header: "Item",
      cell: (r) => itemMap.get(r.itemId)?.name || r.itemId,
      mobileRole: "title",
    },
    { header: "Warehouse", cell: (r) => whMap.get(r.warehouseId)?.name || r.warehouseId },
    { header: "Quantity", cell: (r) => <span className="font-mono font-bold">{r.quantity}</span> },
    { header: "Total Cost", cell: (r) => r.totalCost != null ? `$${r.totalCost.toFixed(2)}` : "—" },
    { header: "Notes", cell: (r) => r.notes || "—" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouses & Tracking"
        subtitle="Multi-warehouse topology, bin storage locations, batch/lot management, and serial item tracking."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <Button variant={tab === "warehouses" ? "primary" : "secondary"} onClick={() => setTab("warehouses")}>Warehouses</Button>
        <Button variant={tab === "locations" ? "primary" : "secondary"} onClick={() => setTab("locations")}>Locations / Bins</Button>
        <Button variant={tab === "batches" ? "primary" : "secondary"} onClick={() => setTab("batches")}>Batches & Lots</Button>
        <Button variant={tab === "serials" ? "primary" : "secondary"} onClick={() => setTab("serials")}>Serials</Button>
        <Button variant={tab === "balances" ? "primary" : "secondary"} onClick={() => setTab("balances")}>Stock Balances</Button>
        <Button variant={tab === "movements" ? "primary" : "secondary"} onClick={() => setTab("movements")}>Ledger Movements</Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : tab === "warehouses" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Warehouse Directory</h3>
              <DataTable columns={warehouseColumns} rows={warehouses} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No warehouses defined yet.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Register Warehouse</h3>
              <form onSubmit={handleCreateWarehouse} className="space-y-4">
                <Field label="Warehouse Code" required>
                  <Input value={whCode} onChange={(e) => setWhCode(e.target.value)} placeholder="e.g. WH-MAIN" disabled={!canManage || busy} />
                </Field>
                <Field label="Warehouse Name" required>
                  <Input value={whName} onChange={(e) => setWhName(e.target.value)} placeholder="e.g. Central Distribution Hub" disabled={!canManage || busy} />
                </Field>
                <Field label="Address">
                  <Input value={whAddress} onChange={(e) => setWhAddress(e.target.value)} placeholder="e.g. Building 4, Logistics Park" disabled={!canManage || busy} />
                </Field>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Create Warehouse</Button>
              </form>
            </Card>
          </div>
        </div>
      ) : tab === "locations" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Storage Bins & Locations</h3>
              <DataTable columns={locationColumns} rows={locations} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No locations defined yet.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Define Storage Location</h3>
              <form onSubmit={handleCreateLocation} className="space-y-4">
                <Field label="Warehouse" required>
                  <Select value={locWhId} onChange={(e) => setLocWhId(e.target.value)} disabled={!canManage || busy}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                  </Select>
                </Field>
                <Field label="Location / Bin Code" required>
                  <Input value={locCode} onChange={(e) => setLocCode(e.target.value)} placeholder="e.g. A-01-02-B" disabled={!canManage || busy} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Zone"><Input value={locZone} onChange={(e) => setLocZone(e.target.value)} placeholder="Zone A" disabled={!canManage || busy} /></Field>
                  <Field label="Aisle"><Input value={locAisle} onChange={(e) => setLocAisle(e.target.value)} placeholder="Aisle 1" disabled={!canManage || busy} /></Field>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Rack"><Input value={locRack} onChange={(e) => setLocRack(e.target.value)} placeholder="R1" disabled={!canManage || busy} /></Field>
                  <Field label="Shelf"><Input value={locShelf} onChange={(e) => setLocShelf(e.target.value)} placeholder="S2" disabled={!canManage || busy} /></Field>
                  <Field label="Bin"><Input value={locBin} onChange={(e) => setLocBin(e.target.value)} placeholder="B1" disabled={!canManage || busy} /></Field>
                </div>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Add Location</Button>
              </form>
            </Card>
          </div>
        </div>
      ) : tab === "batches" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Batch / Lot Registry</h3>
              <DataTable columns={batchColumns} rows={batches} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No batches registered yet.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Create Item Batch</h3>
              <form onSubmit={handleCreateBatch} className="space-y-4">
                <Field label="Item" required>
                  <Select value={batchItemId} onChange={(e) => setBatchItemId(e.target.value)} disabled={!canManage || busy}>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
                  </Select>
                </Field>
                <Field label="Batch Number" required>
                  <Input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="e.g. LOT-2026-001" disabled={!canManage || busy} />
                </Field>
                <Field label="Manufactured Date">
                  <Input type="date" value={batchMfgDate} onChange={(e) => setBatchMfgDate(e.target.value)} disabled={!canManage || busy} />
                </Field>
                <Field label="Expiry Date">
                  <Input type="date" value={batchExpDate} onChange={(e) => setBatchExpDate(e.target.value)} disabled={!canManage || busy} />
                </Field>
                <Field label="Notes">
                  <Input value={batchNotes} onChange={(e) => setBatchNotes(e.target.value)} placeholder="Supplier certificates, storage notes..." disabled={!canManage || busy} />
                </Field>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Register Batch</Button>
              </form>
            </Card>
          </div>
        </div>
      ) : tab === "serials" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Serial Number Tracking</h3>
              <DataTable columns={serialColumns} rows={serials} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No serial items registered yet.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Register Serial Number</h3>
              <form onSubmit={handleCreateSerial} className="space-y-4">
                <Field label="Item" required>
                  <Select value={serialItemId} onChange={(e) => setSerialItemId(e.target.value)} disabled={!canManage || busy}>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
                  </Select>
                </Field>
                <Field label="Serial Number" required>
                  <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} placeholder="e.g. SN-88492019" disabled={!canManage || busy} />
                </Field>
                <Field label="Warehouse">
                  <Select value={serialWhId} onChange={(e) => setSerialWhId(e.target.value)} disabled={!canManage || busy}>
                    <option value="">None / Unassigned</option>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
                <Field label="Warranty Expiry Date">
                  <Input type="date" value={serialWarranty} onChange={(e) => setSerialWarranty(e.target.value)} disabled={!canManage || busy} />
                </Field>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Register Serial</Button>
              </form>
            </Card>
          </div>
        </div>
      ) : tab === "balances" ? (
        <Card>
          <h3 className="text-base font-semibold text-slate-900 mb-3">Authoritative Multi-Warehouse Balances</h3>
          <DataTable columns={balanceColumns} rows={balances} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No stock balances found.</p>} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Immutable Stock Movement Ledger</h3>
              <DataTable columns={movementColumns} rows={movements} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No ledger movements recorded yet.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Record Ledger Movement</h3>
              <form onSubmit={handleRecordMovement} className="space-y-4">
                <Field label="Item" required>
                  <Select value={movItemId} onChange={(e) => setMovItemId(e.target.value)} disabled={!canManage || busy}>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
                  </Select>
                </Field>
                <Field label="Warehouse" required>
                  <Select value={movWhId} onChange={(e) => setMovWhId(e.target.value)} disabled={!canManage || busy}>
                    {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </Select>
                </Field>
                <Field label="Movement Type" required>
                  <Select value={movType} onChange={(e) => setMovType(e.target.value as ScmAdvancedStockMovementType)} disabled={!canManage || busy}>
                    {MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Quantity" required>
                    <Input type="number" min="0.01" step="any" value={movQty} onChange={(e) => setMovQty(e.target.value)} disabled={!canManage || busy} />
                  </Field>
                  <Field label="Unit Cost">
                    <Input type="number" min="0" step="any" value={movUnitCost} onChange={(e) => setMovUnitCost(e.target.value)} disabled={!canManage || busy} />
                  </Field>
                </div>
                <Field label="Notes / Reference">
                  <Input value={movNotes} onChange={(e) => setMovNotes(e.target.value)} placeholder="Reason or PO/Job reference" disabled={!canManage || busy} />
                </Field>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Post Ledger Movement</Button>
              </form>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

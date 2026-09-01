/**
 * Wave A5 — RFQ, Tender & Bid Comparison (SCM-ADV-006).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type ScmItem,
  type ScmRfq,
  type ScmRfqDetail,
  type SupplierRecord,
  type ScmSupplierBid,
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
import { formatDateShort, formatMoney } from "../../shared/format";

function label(v: string) {
  return v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function ProcurementPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();

  const canManage = permissions.includes(PERMISSIONS.supplyChainProcurementManage);
  const canAward = permissions.includes(PERMISSIONS.supplyChainProcurementAward);

  const [rfqs, setRfqs] = useState<ScmRfq[]>([]);
  const [items, setItems] = useState<ScmItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);

  const [selectedRfqDetail, setSelectedRfqDetail] = useState<ScmRfqDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form states - Create RFQ
  const [rfqTitle, setRfqTitle] = useState("");
  const [rfqDeadline, setRfqDeadline] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [rfqItemId, setRfqItemId] = useState("");
  const [rfqQty, setRfqQty] = useState("100");
  const [rfqSpec, setRfqSpec] = useState("");

  // Form states - Submit Bid
  const [bidSupplierId, setBidSupplierId] = useState("");
  const [bidPrice, setBidPrice] = useState("50000");
  const [bidLeadDays, setBidLeadDays] = useState("7");
  const [bidNotes, setBidNotes] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rfqList, itemList, suppList] = await Promise.all([
        api.scmRfqs(token),
        api.scmItems(token),
        api.suppliers(token),
      ]);
      setRfqs(rfqList);
      setItems(itemList);
      setSuppliers(suppList);

      if (itemList.length > 0 && !rfqItemId) setRfqItemId(itemList[0].id);
      if (suppList.length > 0 && !bidSupplierId) setBidSupplierId(suppList[0].id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load procurement data");
    } finally {
      setLoading(false);
    }
  }, [token, rfqItemId, bidSupplierId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const itemMap = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const suppMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);

  async function handleCreateRfq(e: React.FormEvent) {
    e.preventDefault();
    if (!rfqTitle.trim() || !rfqItemId || Number(rfqQty) <= 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmRfq(token, {
        title: rfqTitle.trim(),
        procurementType: "rfq",
        submissionDeadline: rfqDeadline,
        notes: rfqSpec.trim() || null,
        items: [
          {
            itemId: rfqItemId,
            targetQuantity: Number(rfqQty),
            specifications: rfqSpec.trim() || null,
          },
        ],
      });
      setNotice("RFQ published successfully.");
      setRfqTitle("");
      setRfqSpec("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to create RFQ");
    } finally {
      setBusy(false);
    }
  }

  async function openRfqDetail(id: string) {
    setBusy(true);
    setError(null);
    try {
      const dt = await api.scmRfq(token, id);
      setSelectedRfqDetail(dt);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load RFQ detail");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitBid(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRfqDetail || !bidSupplierId || selectedRfqDetail.items.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const item0 = selectedRfqDetail.items[0];
      const qty = item0.targetQuantity;
      const unit = Number(bidPrice);
      await api.submitScmSupplierBid(token, {
        rfqId: selectedRfqDetail.rfq.id,
        supplierId: bidSupplierId,
        leadTimeDays: Number(bidLeadDays),
        validUntil: selectedRfqDetail.rfq.submissionDeadline,
        notes: bidNotes.trim() || null,
        lines: [
          {
            rfqItemId: item0.id,
            offeredQuantity: qty,
            offeredUnitPrice: unit,
            offeredTotalPrice: qty * unit,
            remarks: "Standard quote",
          },
        ],
      });
      setNotice("Supplier bid recorded.");
      setBidNotes("");
      const updated = await api.scmRfq(token, selectedRfqDetail.rfq.id);
      setSelectedRfqDetail(updated);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to submit supplier bid");
    } finally {
      setBusy(false);
    }
  }

  async function handleAwardBid(bidId: string) {
    if (!selectedRfqDetail) return;
    setBusy(true);
    setError(null);
    try {
      await api.awardScmSupplierBid(token, { bidId });
      setNotice("Bid awarded successfully.");
      await loadData();
      const updated = await api.scmRfq(token, selectedRfqDetail.rfq.id);
      setSelectedRfqDetail(updated);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to award bid");
    } finally {
      setBusy(false);
    }
  }

  const rfqColumns: Column<ScmRfq>[] = [
    { header: "RFQ #", cell: (r) => <span className="font-mono font-semibold">{r.rfqNumber}</span>, mobileRole: "title" },
    { header: "Title", cell: (r) => r.title },
    { header: "Deadline", cell: (r) => formatDateShort(r.submissionDeadline) },
    { header: "Status", cell: (r) => <StatusPill tone={r.status === "awarded" ? "success" : r.status === "in_evaluation" ? "info" : "warning"}>{label(r.status)}</StatusPill>, mobileRole: "status" },
    {
      header: "Action",
      cell: (r) => <Button variant="secondary" onClick={() => openRfqDetail(r.id)}>Inspect & Compare</Button>,
    },
  ];

  const bidColumns: Column<ScmSupplierBid>[] = [
    { header: "Supplier", cell: (b) => suppMap.get(b.supplierId)?.name || b.supplierId, mobileRole: "title" },
    { header: "Quoted Total", cell: (b) => <span className="font-mono font-bold text-slate-800">{formatMoney(String(b.totalAmount))}</span> },
    { header: "Lead Time", cell: (b) => `${b.leadTimeDays ?? "—"} days` },
    { header: "Final Score", cell: (b) => b.finalScore != null ? <Badge>{b.finalScore} / 100</Badge> : "—" },
    { header: "Status", cell: (b) => <StatusPill tone={b.status === "awarded" ? "success" : b.status === "rejected" ? "danger" : "neutral"}>{label(b.status)}</StatusPill>, mobileRole: "status" },
    {
      header: "Award Decision",
      cell: (b) =>
        selectedRfqDetail?.rfq.status !== "awarded" && b.status !== "awarded" ? (
          <Button variant="primary" onClick={() => handleAwardBid(b.id)} disabled={!canAward || busy}>Award to PO</Button>
        ) : b.status === "awarded" ? (
          <span className="text-xs font-semibold text-emerald-600">✓ Awarded</span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFQ & Tender Management"
        subtitle="Multi-line RFQ publication, supplier quotation collection, comparative evaluation scoring, and automated PO award."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <h3 className="text-base font-semibold text-slate-900 mb-3">Active RFQs & Tenders</h3>
            <DataTable columns={rfqColumns} rows={rfqs} keyOf={(r) => r.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No RFQs created.</p>} />
          </Card>
        </div>
        <div>
          <Card>
            <h3 className="text-base font-semibold text-slate-900 mb-3">Publish New RFQ</h3>
            <form onSubmit={handleCreateRfq} className="space-y-4">
              <Field label="RFQ Title" required>
                <Input value={rfqTitle} onChange={(e) => setRfqTitle(e.target.value)} placeholder="Procurement of Server Racks" disabled={!canManage || busy} />
              </Field>
              <Field label="Submission Deadline" required>
                <Input type="date" value={rfqDeadline} onChange={(e) => setRfqDeadline(e.target.value)} disabled={!canManage || busy} />
              </Field>
              <Field label="Target Item" required>
                <Select value={rfqItemId} onChange={(e) => setRfqItemId(e.target.value)} disabled={!canManage || busy}>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
                </Select>
              </Field>
              <Field label="Quantity Required" required>
                <Input type="number" min="1" value={rfqQty} onChange={(e) => setRfqQty(e.target.value)} disabled={!canManage || busy} />
              </Field>
              <Field label="Technical Specification">
                <Input value={rfqSpec} onChange={(e) => setRfqSpec(e.target.value)} placeholder="Minimum 42U, dual PDU..." disabled={!canManage || busy} />
              </Field>
              <Button type="submit" variant="primary" disabled={!canManage || busy}>Publish RFQ</Button>
            </form>
          </Card>
        </div>
      </div>

      {selectedRfqDetail && (
        <Card>
          <h3 className="text-base font-semibold text-slate-900 mb-3">{`RFQ Comparative Bids: ${selectedRfqDetail.rfq.rfqNumber} — ${selectedRfqDetail.rfq.title}`}</h3>
          <div className="space-y-6">
            <div className="flex flex-wrap gap-6 text-sm">
              <div><strong>Status:</strong> <StatusPill tone={selectedRfqDetail.rfq.status === "awarded" ? "success" : "info"}>{label(selectedRfqDetail.rfq.status)}</StatusPill></div>
              <div><strong>Deadline:</strong> {formatDateShort(selectedRfqDetail.rfq.submissionDeadline)}</div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-800 mb-2">Required Items</h4>
              <DataTable
                columns={[
                  { header: "Item", cell: (l) => itemMap.get(l.itemId)?.name || l.itemId, mobileRole: "title" },
                  { header: "Target Qty", cell: (l) => l.targetQuantity },
                  { header: "Specification", cell: (l) => l.specifications || "—", mobileRole: "status" },
                ]}
                rows={selectedRfqDetail.items}
                keyOf={(l) => l.id}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <h4 className="text-sm font-bold text-slate-800 mb-2">Supplier Bids Received</h4>
                <DataTable columns={bidColumns} rows={selectedRfqDetail.bids} keyOf={(b) => b.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No supplier bids submitted for this RFQ yet.</p>} />
              </div>
              <div>
                <Card>
                  <h4 className="text-sm font-bold text-slate-800 mb-3">Record Supplier Bid</h4>
                  <form onSubmit={handleSubmitBid} className="space-y-4">
                    <Field label="Supplier" required>
                      <Select value={bidSupplierId} onChange={(e) => setBidSupplierId(e.target.value)} disabled={!canManage || busy}>
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    </Field>
                    <Field label="Unit Price Quoted (IDR)" required>
                      <Input type="number" value={bidPrice} onChange={(e) => setBidPrice(e.target.value)} disabled={!canManage || busy} />
                    </Field>
                    <Field label="Lead Time (Days)" required>
                      <Input type="number" value={bidLeadDays} onChange={(e) => setBidLeadDays(e.target.value)} disabled={!canManage || busy} />
                    </Field>
                    <Field label="Bid Notes">
                      <Input value={bidNotes} onChange={(e) => setBidNotes(e.target.value)} placeholder="Includes FOB shipping..." disabled={!canManage || busy} />
                    </Field>
                    <Button type="submit" variant="primary" disabled={!canManage || busy || selectedRfqDetail.rfq.status === "awarded"}>Submit Bid</Button>
                  </form>
                </Card>
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

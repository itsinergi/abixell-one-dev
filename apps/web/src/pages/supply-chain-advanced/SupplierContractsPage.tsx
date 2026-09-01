/**
 * Wave A5 — Supplier Evaluation & Contract Purchasing (SCM-ADV-007).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type SupplierRecord,
  type ScmSupplierContract,
  type ScmSupplierEvaluation,
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

export function SupplierContractsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { permissions } = useShell();

  const canManage = permissions.includes(PERMISSIONS.supplyChainContractManage);
  const canApprove = permissions.includes(PERMISSIONS.supplyChainContractApprove);

  const [tab, setTab] = useState<"evaluations" | "contracts">("evaluations");
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [evaluations, setEvaluations] = useState<ScmSupplierEvaluation[]>([]);
  const [contracts, setContracts] = useState<ScmSupplierContract[]>([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form states - Evaluation
  const [evalSuppId, setEvalSuppId] = useState("");
  const [evalPeriod, setEvalPeriod] = useState("2026-Q3");
  const [evalQuality, setEvalQuality] = useState("90");
  const [evalDelivery, setEvalDelivery] = useState("85");
  const [evalPricing, setEvalPricing] = useState("80");
  const [evalService, setEvalService] = useState("95");
  const [evalNotes, setEvalNotes] = useState("");

  // Form states - Contract
  const [ctrSuppId, setCtrSuppId] = useState("");
  const [ctrTitle, setCtrTitle] = useState("");
  const [ctrStart, setCtrStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [ctrEnd, setCtrEnd] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [ctrCommitment, setCtrCommitment] = useState("500000000");
  const [ctrTerms, setCtrTerms] = useState("Annual master service & goods agreement");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [suppList, evalList, ctrList] = await Promise.all([
        api.suppliers(token),
        api.scmSupplierEvaluations(token),
        api.scmSupplierContracts(token),
      ]);
      setSuppliers(suppList);
      setEvaluations(evalList);
      setContracts(ctrList);

      if (suppList.length > 0 && !evalSuppId) setEvalSuppId(suppList[0].id);
      if (suppList.length > 0 && !ctrSuppId) setCtrSuppId(suppList[0].id);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to load supplier contracts/evaluations");
    } finally {
      setLoading(false);
    }
  }, [token, evalSuppId, ctrSuppId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const suppMap = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);

  async function handleCreateEvaluation(e: React.FormEvent) {
    e.preventDefault();
    if (!evalSuppId || !evalPeriod.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmSupplierEvaluation(token, {
        supplierId: evalSuppId,
        evaluationPeriod: evalPeriod.trim(),
        periodStartDate: "2026-07-01",
        periodEndDate: "2026-09-30",
        qualityScore: Number(evalQuality),
        deliveryScore: Number(evalDelivery),
        pricingScore: Number(evalPricing),
        serviceScore: Number(evalService),
        notes: evalNotes.trim() || null,
      });
      setNotice("Supplier scorecard evaluated.");
      setEvalNotes("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to record supplier evaluation");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateContract(e: React.FormEvent) {
    e.preventDefault();
    if (!ctrSuppId || !ctrTitle.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createScmSupplierContract(token, {
        supplierId: ctrSuppId,
        title: ctrTitle.trim(),
        contractType: "blanket_po",
        startDate: ctrStart,
        endDate: ctrEnd,
        committedAmount: Number(ctrCommitment) || 0,
        termsAndConditions: ctrTerms.trim() || null,
        items: [],
      });
      setNotice("Purchasing contract registered.");
      setCtrTitle("");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to register supplier contract");
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveContract(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.actOnScmSupplierContract(token, id, "approve", "Approved by authorized procurement officer");
      setNotice("Supplier contract approved.");
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Failed to approve supplier contract");
    } finally {
      setBusy(false);
    }
  }

  const evalColumns: Column<ScmSupplierEvaluation>[] = [
    { header: "Supplier", cell: (e) => suppMap.get(e.supplierId)?.name || e.supplierId, mobileRole: "title" },
    { header: "Period", cell: (e) => <span className="font-mono font-semibold">{e.evaluationPeriod}</span> },
    { header: "Quality (35%)", cell: (e) => `${e.qualityScore}` },
    { header: "Delivery (30%)", cell: (e) => `${e.deliveryScore}` },
    { header: "Pricing (20%)", cell: (e) => `${e.pricingScore}` },
    { header: "Service (15%)", cell: (e) => `${e.serviceScore}` },
    { header: "Overall Score", cell: (e) => <span className="font-mono font-bold">{e.overallScore.toFixed(1)}</span> },
    {
      header: "Rating Grade",
      cell: (e) => <Badge className="bg-blue-50 text-blue-700">Grade {e.ratingGrade}</Badge>,
      mobileRole: "status",
    },
  ];

  const contractColumns: Column<ScmSupplierContract>[] = [
    { header: "Contract #", cell: (c) => <span className="font-mono font-semibold">{c.contractNumber}</span>, mobileRole: "title" },
    { header: "Supplier", cell: (c) => suppMap.get(c.supplierId)?.name || c.supplierId },
    { header: "Contract Title", cell: (c) => c.title },
    { header: "Validity Period", cell: (c) => `${formatDateShort(c.startDate)} – ${formatDateShort(c.endDate)}` },
    { header: "Committed Amount", cell: (c) => <span className="font-mono font-bold text-slate-800">{formatMoney(String(c.committedAmount))}</span> },
    { header: "Consumed Spend", cell: (c) => <span className="font-mono text-emerald-600">{formatMoney(String(c.spentAmount))}</span> },
    { header: "Status", cell: (c) => <StatusPill tone={c.status === "active" ? "success" : c.status === "draft" ? "warning" : "neutral"}>{label(c.status)}</StatusPill>, mobileRole: "status" },
    {
      header: "Actions",
      cell: (c) =>
        c.status === "draft" ? (
          <Button variant="primary" onClick={() => handleApproveContract(c.id)} disabled={!canApprove || busy}>Approve</Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier Contracts & Evaluations"
        subtitle="Supplier performance scorecard evaluations (KPI weighted rating) and long-term purchasing master contracts."
      />

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="flex gap-2 border-b border-slate-200 pb-2">
        <Button variant={tab === "evaluations" ? "primary" : "secondary"} onClick={() => setTab("evaluations")}>Supplier Scorecards</Button>
        <Button variant={tab === "contracts" ? "primary" : "secondary"} onClick={() => setTab("contracts")}>Purchasing Contracts</Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Spinner /></div>
      ) : tab === "evaluations" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Supplier Evaluation Scorecards</h3>
              <DataTable columns={evalColumns} rows={evaluations} keyOf={(e) => e.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No supplier evaluations recorded.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Conduct Supplier Evaluation</h3>
              <form onSubmit={handleCreateEvaluation} className="space-y-4">
                <Field label="Supplier" required>
                  <Select value={evalSuppId} onChange={(e) => setEvalSuppId(e.target.value)} disabled={!canManage || busy}>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field label="Evaluation Period" required>
                  <Input value={evalPeriod} onChange={(e) => setEvalPeriod(e.target.value)} placeholder="e.g. 2026-Q3" disabled={!canManage || busy} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Quality Score (0-100)" required><Input type="number" min="0" max="100" value={evalQuality} onChange={(e) => setEvalQuality(e.target.value)} disabled={!canManage || busy} /></Field>
                  <Field label="Delivery Score (0-100)" required><Input type="number" min="0" max="100" value={evalDelivery} onChange={(e) => setEvalDelivery(e.target.value)} disabled={!canManage || busy} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Pricing Score (0-100)" required><Input type="number" min="0" max="100" value={evalPricing} onChange={(e) => setEvalPricing(e.target.value)} disabled={!canManage || busy} /></Field>
                  <Field label="Service Score (0-100)" required><Input type="number" min="0" max="100" value={evalService} onChange={(e) => setEvalService(e.target.value)} disabled={!canManage || busy} /></Field>
                </div>
                <Field label="Evaluation Remarks">
                  <Input value={evalNotes} onChange={(e) => setEvalNotes(e.target.value)} placeholder="On-time delivery performance notes..." disabled={!canManage || busy} />
                </Field>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Submit Scorecard</Button>
              </form>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Master Purchasing Contracts</h3>
              <DataTable columns={contractColumns} rows={contracts} keyOf={(c) => c.id} empty={<p className="text-slate-500 py-4 text-center text-sm">No purchasing contracts registered.</p>} />
            </Card>
          </div>
          <div>
            <Card>
              <h3 className="text-base font-semibold text-slate-900 mb-3">Register Purchasing Contract</h3>
              <form onSubmit={handleCreateContract} className="space-y-4">
                <Field label="Supplier" required>
                  <Select value={ctrSuppId} onChange={(e) => setCtrSuppId(e.target.value)} disabled={!canManage || busy}>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field label="Contract Title" required>
                  <Input value={ctrTitle} onChange={(e) => setCtrTitle(e.target.value)} placeholder="Annual Raw Material Supply" disabled={!canManage || busy} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Start Date" required><Input type="date" value={ctrStart} onChange={(e) => setCtrStart(e.target.value)} disabled={!canManage || busy} /></Field>
                  <Field label="End Date" required><Input type="date" value={ctrEnd} onChange={(e) => setCtrEnd(e.target.value)} disabled={!canManage || busy} /></Field>
                </div>
                <Field label="Committed Budget (IDR)">
                  <Input type="number" value={ctrCommitment} onChange={(e) => setCtrCommitment(e.target.value)} disabled={!canManage || busy} />
                </Field>
                <Field label="Contract Terms">
                  <Input value={ctrTerms} onChange={(e) => setCtrTerms(e.target.value)} disabled={!canManage || busy} />
                </Field>
                <Button type="submit" variant="primary" disabled={!canManage || busy}>Register Contract</Button>
              </form>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

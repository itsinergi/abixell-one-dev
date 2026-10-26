/**
 * Wave A6.2 — AP/AR open items and settlement (FIN-ADV-002).
 *
 * An open item is a debt or a claim that has not been settled yet. Two things
 * this page will not do:
 *
 *   - it does not decide which item settles which. An allocation is between a
 *     credit-direction instrument (the source) and a debit-direction one (the
 *     target), and the kernel refuses any pair that does not fit that shape.
 *   - it does not compute the remaining amount. The item list already carries
 *     `originalAmount`; what is still open comes from the kernel.
 *
 * Amounts are 4 decimals here because source documents are numeric(18,4).
 * Two decimals would silently round an invoice.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type AccountingOpenItemRecord,
  type Customer,
  type SupplierRecord,
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
import { isValidAmount4Input } from "./money";
import { newIdempotencyKey, useLegalEntities } from "./useLegalEntities";

export function FinanceOpenItemsPage() {
  const { session } = useAuth();
  const token = session!.accessToken;
  const { entities, legalEntityId, setLegalEntityId } = useLegalEntities(token);

  const [items, setItems] = useState<AccountingOpenItemRecord[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [side, setSide] = useState<"AR" | "AP">("AR");
  const [direction, setDirection] = useState<"debit" | "credit">("debit");
  const [sourceKind, setSourceKind] = useState<
    "invoice" | "payment" | "credit_note" | "debit_note" | "down_payment" | "withholding" | "unapplied"
  >("invoice");
  const [sourceRefTable, setSourceRefTable] = useState("customer_invoices");
  const [sourceRefId, setSourceRefId] = useState("");
  const [partyId, setPartyId] = useState("");
  const [documentNo, setDocumentNo] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [currency, setCurrency] = useState("IDR");
  const [originalAmount, setOriginalAmount] = useState("");

  const [sourceItemId, setSourceItemId] = useState("");
  const [targetItemId, setTargetItemId] = useState("");
  const [allocationAmount, setAllocationAmount] = useState("");
  const [allocationDate, setAllocationDate] = useState("");

  useEffect(() => {
    void (async () => {
      const [customerList, supplierList] = await Promise.all([
        api.customers(token).catch(() => [] as Customer[]),
        api.suppliers(token).catch(() => [] as SupplierRecord[]),
      ]);
      setCustomers(customerList);
      setSuppliers(supplierList);
    })();
  }, [token]);

  const load = useCallback(async () => {
    if (!legalEntityId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItems(await api.accountingOpenItems(token, { legalEntityId }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load open items.");
    } finally {
      setLoading(false);
    }
  }, [token, legalEntityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const parties = side === "AR" ? customers : suppliers;
  const partyLabel = (row: AccountingOpenItemRecord) => {
    const list = row.partyType === "customer" ? customers : suppliers;
    return list.find((p) => p.id === row.partyId)?.name ?? row.partyId;
  };
  // The kernel's allocation contract: the source is the credit instrument, the
  // target is the debit one. Filtering here means the operator cannot pick a
  // pair the service would reject.
  const creditItems = items.filter((item) => item.direction === "credit");
  const debitItems = items.filter((item) => item.direction === "debit");
  const amountValid = isValidAmount4Input(allocationAmount) && /[1-9]/.test(allocationAmount);
  const canAllocate = legalEntityId !== "" && sourceItemId !== "" && targetItemId !== "" && amountValid && allocationDate !== "";

  async function createItem() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api.accountingCreateOpenItem(token, {
        legalEntityId,
        side,
        direction,
        sourceKind,
        sourceRefTable: sourceRefTable.trim(),
        sourceRefId: sourceRefId.trim(),
        partyType: side === "AR" ? "customer" : "supplier",
        partyId,
        documentNo: documentNo.trim(),
        documentDate,
        dueDate: dueDate || null,
        currency,
        // Verbatim text at 4 decimals — never parsed to a number.
        originalAmount: originalAmount.trim(),
      });
      setNotice(`Open item ${created.documentNo} recorded for ${formatMoney(created.originalAmount)} ${created.currency}.`);
      setDocumentNo("");
      setSourceRefId("");
      setOriginalAmount("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the open item.");
    } finally {
      setBusy(false);
    }
  }

  async function allocate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.accountingAllocate(token, {
        legalEntityId,
        sourceOpenItemId: sourceItemId,
        targetOpenItemId: targetItemId,
        amount: allocationAmount.trim(),
        allocationDate,
        idempotencyKey: newIdempotencyKey(),
      });
      setNotice("Allocation recorded. Both items now show the reduced open amount.");
      setAllocationAmount("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the allocation.");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<AccountingOpenItemRecord>[] = [
    { header: "Document", mobileRole: "title", cell: (row) => <span className="font-medium text-ink">{row.documentNo}</span> },
    { header: "Side", cell: (row) => <Badge>{row.side}</Badge> },
    { header: "Direction", cell: (row) => row.direction },
    { header: "Party", cell: (row) => partyLabel(row) },
    { header: "Document date", className: "tabular-nums", cell: (row) => formatDateShort(row.documentDate) },
    { header: "Due", className: "tabular-nums", cell: (row) => formatDateShort(row.dueDate) },
    {
      header: "Original",
      className: "text-right tabular-nums whitespace-nowrap",
      mobileRole: "detail",
      cell: (row) => `${formatMoney(row.originalAmount)} ${row.currency}`,
    },
    { header: "Source", mobileRole: "status", cell: (row) => <StatusPill>{row.sourceKind}</StatusPill> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Open items"
        subtitle="What is still owed and what is still owed to you, and how much of each has been settled."
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
        <EmptyState title="Choose a legal entity" description="Open items are held per legal entity." />
      ) : (
        <>
          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">Record an open item</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Side" required>
                <Select
                  value={side}
                  onChange={(e) => {
                    const next = e.target.value as "AR" | "AP";
                    setSide(next);
                    setPartyId("");
                    setSourceRefTable(next === "AR" ? "customer_invoices" : "scm_vendor_invoices");
                  }}
                >
                  <option value="AR">Receivable — owed to you</option>
                  <option value="AP">Payable — owed by you</option>
                </Select>
              </Field>
              <Field label="Direction" required hint="Debit instruments are settled; credit instruments settle them.">
                <Select value={direction} onChange={(e) => setDirection(e.target.value as "debit" | "credit")}>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </Select>
              </Field>
              <Field label="Kind" required>
                <Select value={sourceKind} onChange={(e) => setSourceKind(e.target.value as typeof sourceKind)}>
                  <option value="invoice">Invoice</option>
                  <option value="payment">Payment</option>
                  <option value="credit_note">Credit note</option>
                  <option value="debit_note">Debit note</option>
                  <option value="down_payment">Down payment</option>
                  <option value="withholding">Withholding</option>
                  <option value="unapplied">Unapplied</option>
                </Select>
              </Field>
              <Field label={side === "AR" ? "Customer" : "Supplier"} required>
                <Select value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                  <option value="">Select…</option>
                  {parties.map((party) => (
                    <option key={party.id} value={party.id}>
                      {party.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Document number" required>
                <Input value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} placeholder="INV-2026-0001" />
              </Field>
              <Field label="Document date" required>
                <Input type="date" value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} />
              </Field>
              <Field label="Due date">
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field
                label="Amount"
                required
                hint={
                  originalAmount && !isValidAmount4Input(originalAmount)
                    ? "Digits with at most four decimals, e.g. 1250.7500"
                    : undefined
                }
              >
                <Input
                  inputMode="decimal"
                  value={originalAmount}
                  onChange={(e) => setOriginalAmount(e.target.value)}
                  placeholder="1250.7500"
                  aria-invalid={originalAmount !== "" && !isValidAmount4Input(originalAmount)}
                />
              </Field>
              <Field label="Currency" required>
                <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
              </Field>
              <Field label="Source table" required hint="The table the source document lives in.">
                <Input value={sourceRefTable} onChange={(e) => setSourceRefTable(e.target.value)} />
              </Field>
              <Field label="Source id" required hint="The source document's own identifier.">
                <Input value={sourceRefId} onChange={(e) => setSourceRefId(e.target.value)} placeholder="UUID" />
              </Field>
            </div>
            <div className="mt-3">
              <Button
                disabled={
                  busy ||
                  !partyId ||
                  !documentNo.trim() ||
                  !documentDate ||
                  !sourceRefId.trim() ||
                  !isValidAmount4Input(originalAmount)
                }
                onClick={() => void createItem()}
              >
                Record open item
              </Button>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink">Settle one item against another</h2>
            <p className="mb-3 text-sm text-ink-dim">
              Pick the credit instrument first, then the debit one it settles. The kernel refuses a pair whose
              directions do not fit, and refuses an amount larger than what is still open.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Settles (credit)" required>
                <Select value={sourceItemId} onChange={(e) => setSourceItemId(e.target.value)}>
                  <option value="">Select…</option>
                  {creditItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.documentNo} — {formatMoney(item.originalAmount)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Settled (debit)" required>
                <Select value={targetItemId} onChange={(e) => setTargetItemId(e.target.value)}>
                  <option value="">Select…</option>
                  {debitItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.documentNo} — {formatMoney(item.originalAmount)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Amount"
                required
                hint={
                  allocationAmount && !amountValid
                    ? "Digits with at most four decimals, greater than zero"
                    : undefined
                }
              >
                <Input
                  inputMode="decimal"
                  value={allocationAmount}
                  onChange={(e) => setAllocationAmount(e.target.value)}
                  placeholder="500.0000"
                  aria-invalid={allocationAmount !== "" && !amountValid}
                />
              </Field>
              <Field label="Allocation date" required>
                <Input type="date" value={allocationDate} onChange={(e) => setAllocationDate(e.target.value)} />
              </Field>
            </div>
            <div className="mt-3">
              <Button disabled={busy || !canAllocate} onClick={() => void allocate()}>
                Allocate
              </Button>
            </div>
            {creditItems.length === 0 || debitItems.length === 0 ? (
              <p className="mt-2 text-xs text-ink-faint">
                Both a credit instrument and a debit instrument have to exist before anything can be settled.
              </p>
            ) : null}
          </Card>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink">Open items</h2>
            {loading ? (
              <Spinner />
            ) : (
              <DataTable
                columns={columns}
                rows={items}
                keyOf={(row) => row.id}
                empty={
                  <EmptyState
                    title="Nothing open"
                    description="An open item appears here once an invoice, payment, or note is recorded against it."
                  />
                }
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

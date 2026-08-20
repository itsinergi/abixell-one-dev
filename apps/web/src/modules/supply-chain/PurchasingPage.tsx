/**
 * Phase 4 — Purchasing surface (SCM-CORE-007…010, SCM-CORE-013).
 *
 * One coherent screen for the purchasing loop: raise a request, move it
 * through its configured approval lifecycle, turn an approved request into
 * an order, issue it, and receive against its lines.
 *
 * Lifecycle buttons are rendered from the backend's `availableActions` —
 * never from a hardcoded status rule.
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type PurchaseOrderDetail,
  type PurchaseOrderRecord,
  type PurchaseRequestDetail,
  type PurchaseRequestRecord,
  type ScmItem,
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
  Textarea,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort, statusTone } from "../../shared/format";

export function PurchasingPage() {
  const { session } = useAuth();
  const token = session!.accessToken;

  const [requests, setRequests] = useState<PurchaseRequestRecord[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderRecord[]>([]);
  const [items, setItems] = useState<ScmItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [requestDetail, setRequestDetail] = useState<PurchaseRequestDetail | null>(null);
  const [orderDetail, setOrderDetail] = useState<PurchaseOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [justification, setJustification] = useState("");
  const [prItem, setPrItem] = useState("");
  const [prQuantity, setPrQuantity] = useState("");
  const [supplierCode, setSupplierCode] = useState("");
  const [receiptQuantity, setReceiptQuantity] = useState("");
  const [receiptLineId, setReceiptLineId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [requestList, orderList, itemList, supplierList] = await Promise.all([
        api.purchaseRequests(token),
        api.purchaseOrders(token).catch(() => [] as PurchaseOrderRecord[]),
        api.scmItems(token).catch(() => [] as ScmItem[]),
        api.suppliers(token).catch(() => [] as SupplierRecord[]),
      ]);
      setRequests(requestList);
      setOrders(orderList);
      setItems(itemList.filter((i) => i.isActive));
      setSuppliers(supplierList.filter((s) => s.isActive));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load purchasing data.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const openRequest = useCallback(
    async (id: string) => {
      setError(null);
      try {
        setRequestDetail(await api.purchaseRequest(token, id));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the request.");
      }
    },
    [token],
  );

  const openOrder = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const detail = await api.purchaseOrder(token, id);
        setOrderDetail(detail);
        setReceiptLineId(detail.lines[0]?.id ?? "");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load the order.");
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
      if (requestDetail) await openRequest(requestDetail.request.id);
      if (orderDetail) await openOrder(orderDetail.order.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  const itemName = (itemId: string) => items.find((i) => i.id === itemId)?.name ?? itemId.slice(0, 8);

  const requestColumns: Column<PurchaseRequestRecord>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{row.requestNumber}</span> },
    { header: "Justification", cell: (row) => row.justification },
    { header: "Required", cell: (row) => formatDateShort(row.requiredDate) },
    {
      header: "Order",
      cell: (row) => (row.convertedPurchaseOrderId ? <Badge>Ordered</Badge> : "—"),
    },
  ];

  const orderColumns: Column<PurchaseOrderRecord>[] = [
    { header: "Number", cell: (row) => <span className="font-medium">{row.orderNumber}</span> },
    {
      header: "State",
      cell: (row) => (
        <StatusPill tone={row.cancelledAt ? "neutral" : row.issuedAt ? "success" : "warning"}>
          {row.cancelledAt ? "Cancelled" : row.issuedAt ? "Issued" : "Draft"}
        </StatusPill>
      ),
    },
    { header: "Expected", cell: (row) => formatDateShort(row.expectedDate) },
    { header: "Currency", cell: (row) => row.currency ?? "—" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Purchasing" subtitle="Request, order, and receive what your teams need." />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Raise a purchase request</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Item" required>
            <Select value={prItem} onChange={(e) => setPrItem(e.target.value)}>
              <option value="">Select…</option>
              {items.map((i) => (
                <option key={i.id} value={i.code}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity" required>
            <Input
              type="number"
              min="0"
              step="any"
              value={prQuantity}
              onChange={(e) => setPrQuantity(e.target.value)}
            />
          </Field>
          <Field label="Justification" required>
            <Textarea rows={1} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              disabled={busy || !prItem || !prQuantity || !justification}
              onClick={async () => {
                await run(
                  () =>
                    api.createPurchaseRequest(token, {
                      justification,
                      lines: [{ itemCode: prItem, quantity: Number(prQuantity) }],
                    }),
                  "Purchase request created.",
                );
                setJustification("");
                setPrQuantity("");
              }}
            >
              Create
            </Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <>
          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Purchase requests</h2>
            <DataTable
              columns={requestColumns}
              rows={requests}
              keyOf={(row) => row.id}
              onRowClick={(row) => void openRequest(row.id)}
              empty={<EmptyState title="No purchase requests" description="Raise one above to get started." />}
            />
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Purchase orders</h2>
            <DataTable
              columns={orderColumns}
              rows={orders}
              keyOf={(row) => row.id}
              onRowClick={(row) => void openOrder(row.id)}
              empty={<EmptyState title="No purchase orders" description="Approve a request, then place an order." />}
            />
          </div>
        </>
      )}

      {requestDetail ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Request <Badge>{requestDetail.request.requestNumber}</Badge>{" "}
            {requestDetail.status ? (
              <StatusPill tone={statusTone(requestDetail.status.instanceStatus)}>
                {requestDetail.status.stepName ?? requestDetail.status.instanceStatus}
              </StatusPill>
            ) : null}
          </h2>
          <ul className="mb-3 space-y-1 text-sm text-slate-800">
            {requestDetail.lines.map((line) => (
              <li key={line.id}>
                {itemName(line.itemId)} — {line.quantity}
              </li>
            ))}
          </ul>

          {requestDetail.availableActions.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {requestDetail.availableActions.map((action) => (
                <Button
                  key={action.actionCode}
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api.actOnPurchaseRequest(token, requestDetail.request.id, action.actionCode),
                      `${action.name} recorded.`,
                    )
                  }
                >
                  {action.name}
                </Button>
              ))}
            </div>
          ) : null}

          {requestDetail.status?.instanceStatus === "approved" && !requestDetail.request.convertedPurchaseOrderId ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Supplier" required>
                <Select value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)}>
                  <option value="">Select…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="flex items-end">
                <Button
                  disabled={busy || !supplierCode}
                  onClick={() =>
                    run(
                      () =>
                        api.createPurchaseOrder(token, {
                          supplierCode,
                          purchaseRequestId: requestDetail.request.id,
                        }),
                      "Purchase order created.",
                    )
                  }
                >
                  Create purchase order
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {orderDetail ? (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-800">
            Order <Badge>{orderDetail.order.orderNumber}</Badge>{" "}
            <StatusPill tone={orderDetail.state === "issued" ? "success" : "warning"}>{orderDetail.state}</StatusPill>
          </h2>
          <p className="mb-3 text-sm text-slate-600">Supplier: {orderDetail.supplier?.name ?? "—"}</p>
          <ul className="mb-3 space-y-1 text-sm text-slate-800">
            {orderDetail.lines.map((line) => (
              <li key={line.id}>
                {itemName(line.itemId)} — ordered {line.quantityOrdered}, received {line.quantityReceived}
              </li>
            ))}
          </ul>

          {orderDetail.state === "draft" ? (
            <Button
              disabled={busy}
              onClick={() => run(() => api.issuePurchaseOrder(token, orderDetail.order.id), "Order issued.")}
            >
              Issue order
            </Button>
          ) : null}

          {orderDetail.state === "issued" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Line" required>
                <Select value={receiptLineId} onChange={(e) => setReceiptLineId(e.target.value)}>
                  {orderDetail.lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {itemName(line.itemId)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity received" required>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={receiptQuantity}
                  onChange={(e) => setReceiptQuantity(e.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  disabled={busy || !receiptLineId || !receiptQuantity}
                  onClick={async () => {
                    await run(
                      () =>
                        api.receiveAgainstOrder(token, orderDetail.order.id, {
                          lineId: receiptLineId,
                          quantity: Number(receiptQuantity),
                        }),
                      "Goods received against the order.",
                    );
                    setReceiptQuantity("");
                  }}
                >
                  Record receipt
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

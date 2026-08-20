/**
 * Phase 6 — Transaction detail (FIN-CORE-005/006/008, FIN-CORE-011).
 *
 * One record with its facts, its evidence, its approval decisions, and — if
 * it has already taken effect — the correction control. There is no edit
 * form: an approved money movement is immutable, and the only way to change
 * the outcome is a compensating transaction that goes through the same
 * approval.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import {
  api,
  ApiError,
  type DocumentRecord,
  type FinanceTransactionDetail,
} from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Spinner,
  StatusPill,
} from "../../shell/components/ui";
import { formatDate, formatDateShort, statusTone } from "../../shared/format";
import { accountTypeLabel, formatSigned } from "./money";

export function FinanceTransactionDetailPage() {
  const { transactionId } = useParams<{ transactionId: string }>();
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [detail, setDetail] = useState<FinanceTransactionDetail | null>(null);
  const [categories, setCategories] = useState<{ code: string; label: string }[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentsBlocked, setDocumentsBlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [reversalReason, setReversalReason] = useState("");
  const [confirmReversal, setConfirmReversal] = useState(false);

  const load = useCallback(async () => {
    if (!transactionId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.financeTransaction(token, transactionId));
      // Financial evidence needs a dedicated capability — a denial here is
      // expected for users who only hold finance.read.
      try {
        setDocuments(await api.documentsForEntity(token, "finance_transaction", transactionId));
        setDocumentsBlocked(false);
      } catch {
        setDocuments([]);
        setDocumentsBlocked(true);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this transaction.");
    } finally {
      setLoading(false);
    }
  }, [token, transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api
      .financeCategories(token)
      .then(setCategories)
      .catch(() => setCategories([]));
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

  if (loading) return <Spinner />;
  if (!detail) return <Alert tone="error">{error ?? "Transaction not found."}</Alert>;

  const { transaction, account, status, availableActions, isApplied } = detail;
  const categoryLabel = categories.find((c) => c.code === transaction.categoryCode)?.label ?? transaction.categoryCode;

  return (
    <div className="space-y-4">
      <PageHeader
        title={transaction.transactionNumber}
        subtitle={categoryLabel}
        actions={
          <StatusPill tone={isApplied ? "success" : "warning"}>
            {isApplied ? "Took effect" : "Awaiting approval"}
          </StatusPill>
        }
      />

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {transaction.reversesTransactionId ? (
        <Alert tone="info">
          This is a correction of an earlier transaction. The original stays in the record exactly as it was.
        </Alert>
      ) : null}
      {transaction.reversedByTransactionId ? (
        <Alert tone="info">
          This transaction has been corrected by a later compensating entry.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => navigate(`/finance/transactions/${transaction.reversedByTransactionId}`)}
          >
            Open the correction
          </button>
        </Alert>
      ) : null}

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Details</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-slate-500">Amount</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">
              {formatSigned(transaction.amount, transaction.direction, transaction.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Date</dt>
            <dd className="text-slate-900">{formatDateShort(transaction.transactionDate)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Account</dt>
            <dd className="text-slate-900">
              {account ? `${account.name} · ${accountTypeLabel(account.accountType)}` : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Category</dt>
            <dd className="text-slate-900">{categoryLabel}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Reference</dt>
            <dd className="text-slate-900">{transaction.reference ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Took effect</dt>
            <dd className="text-slate-900">{transaction.appliedAt ? formatDate(transaction.appliedAt) : "Not yet"}</dd>
          </div>
        </dl>
        {transaction.description ? (
          <p className="mt-3 text-sm text-slate-700">{transaction.description}</p>
        ) : null}
        {account ? (
          <p className="mt-3 text-sm text-slate-500">
            Account balance now: <span className="font-medium tabular-nums text-slate-800">{account.currency} {account.balance}</span>
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">
          Approval{" "}
          {status ? (
            <StatusPill tone={statusTone(status.instanceStatus)}>
              {status.stepName ?? status.instanceStatus}
            </StatusPill>
          ) : null}
        </h2>
        {isApplied ? (
          <p className="text-sm text-slate-600">
            This transaction has taken effect. Its amount, date, account, and category can no longer change — correct
            it with a compensating entry instead.
          </p>
        ) : availableActions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {availableActions.map((action) => (
              <Button
                key={action.actionCode}
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () => api.actOnFinanceTransaction(token, transaction.id, action.actionCode),
                    `${action.name} recorded.`,
                  )
                }
              >
                {action.name}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No decision is waiting for you on this transaction.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Evidence</h2>
        {documentsBlocked ? (
          <Alert tone="info">
            Financial evidence needs a separate permission. Ask an administrator if you need access.
          </Alert>
        ) : (
          <>
            {documents.length === 0 ? (
              <p className="mb-3 text-sm text-slate-500">No evidence attached.</p>
            ) : (
              <ul className="mb-3 space-y-1 text-sm text-slate-800">
                {documents.map((doc) => (
                  <li key={doc.id}>{doc.fileName}</li>
                ))}
              </ul>
            )}
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Attach evidence"
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void run(
                    () => api.uploadDocument(token, "finance_transaction", transaction.id, file),
                    "Evidence attached.",
                  );
                }
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
          </>
        )}
      </Card>

      {isApplied && !transaction.reversedByTransactionId ? (
        <Card>
          <h2 className="mb-1 text-sm font-semibold text-slate-800">Correct this transaction</h2>
          <p className="mb-3 text-sm text-slate-600">
            Nothing is edited or deleted. A compensating entry of{" "}
            <Badge>{transaction.direction === "income" ? "money out" : "money in"}</Badge> for the same amount is
            created and goes through the same approval before the balance moves back.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label="Reason">
                <Input
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  placeholder="e.g. Duplicate entry"
                />
              </Field>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={confirmReversal}
                  onChange={(e) => setConfirmReversal(e.target.checked)}
                />
                I confirm this correction
              </label>
            </div>
          </div>
          <div className="mt-3">
            <Button
              disabled={busy || !confirmReversal}
              onClick={async () => {
                setBusy(true);
                setError(null);
                setNotice(null);
                try {
                  const reversal = await api.reverseFinanceTransaction(token, transaction.id, {
                    reason: reversalReason || null,
                  });
                  navigate(`/finance/transactions/${reversal.transaction.id}`);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Could not create the correction.");
                } finally {
                  setBusy(false);
                  setConfirmReversal(false);
                }
              }}
            >
              Create compensating entry
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

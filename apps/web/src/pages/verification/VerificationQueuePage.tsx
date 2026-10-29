/**
 * Checkpoint 1C.4 — Verification queue (QA / verifier persona). Reuses the
 * existing operational read-model with a `stepCode=VERIFICATION` filter (no
 * new endpoint — section 6). Shows complaints awaiting independent
 * verification; the backend decides visibility and eligibility.
 */
import { useT } from "../../i18n/LocaleProvider";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { api, ApiError, type OperationalQueueItem } from "../../lib/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Spinner,
  StatusPill,
  type Column,
} from "../../shell/components/ui";
import { formatDateShort, severityTone, slaIndicator } from "../complaints/format";

const VERIFICATION_STEP = "VERIFICATION";
const QUEUE_LIMIT = 200;

export function VerificationQueuePage() {
  const t = useT();
  const { session } = useAuth();
  const token = session!.accessToken;
  const navigate = useNavigate();

  const [mineOnly, setMineOnly] = useState(true);
  const [items, setItems] = useState<OperationalQueueItem[]>([]);
  const [mineCount, setMineCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Snapshot of everything at VERIFICATION in scope (for the counter),
      // plus the filtered view for the table.
      const [all, filtered] = await Promise.all([
        api.operationalQueue(token, { stepCode: VERIFICATION_STEP, limit: QUEUE_LIMIT }),
        api.operationalQueue(token, {
          stepCode: VERIFICATION_STEP,
          assignedToMe: mineOnly,
          limit: QUEUE_LIMIT,
        }),
      ]);
      setMineCount(all.items.filter((i) => i.assignment?.isMine).length);
      setItems(filtered.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("ver.queue.msg.failedToLoadTheVerificationQueue"));
    } finally {
      setLoading(false);
    }
  }, [token, mineOnly, t]);

  useEffect(() => {
    load();
  }, [load]);

  const columns: Column<OperationalQueueItem>[] = [
    {
      header: t("ver.queue.h.number"),
      cell: (i) => <span className="font-mono font-medium text-slate-800">{i.complaint.complaintNumber}</span>,
    },
    { header: t("ver.queue.h.customer"), cell: (i) => i.customerName ?? "—" },
    { header: t("ver.queue.h.category"), cell: (i) => <Badge>{i.complaint.category}</Badge> },
    {
      header: t("ver.queue.h.severity"),
      cell: (i) => <StatusPill tone={severityTone(i.complaint.severity)}>{i.complaint.severity}</StatusPill>,
    },
    {
      header: "SLA",
      cell: (i) => {
        const s = slaIndicator(i.sla);
        return s ? <StatusPill tone={s.tone}>{s.label}</StatusPill> : <span className="text-slate-400">—</span>;
      },
    },
    {
      header: t("ver.queue.h.forYou"),
      cell: (i) =>
        i.assignment?.isMine ? (
          <StatusPill tone="info">{t("ver.queue.t.awaitingYourReview")}</StatusPill>
        ) : (
          <span className="text-slate-500">{i.assignment?.roleCode ?? "—"}</span>
        ),
    },
    { header: t("ver.queue.h.updated"), cell: (i) => formatDateShort(i.complaint.updatedAt) },
  ];

  return (
    <div>
      <PageHeader
        title={t("ver.queue.title.verification")}
        subtitle={t("ver.queue.sub.independentlyVerifyCorrectiveActionsAwai")}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="p-3">
          <div className="text-xs text-slate-400">{t("ver.queue.t.awaitingYourVerification")}</div>
          <div className="text-2xl font-semibold text-slate-800">{mineCount}</div>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant={mineOnly ? "primary" : "secondary"} onClick={() => setMineOnly((v) => !v)}>
          {mineOnly ? "Showing: awaiting my review" : "Showing: all in scope"}
        </Button>
      </div>

      {error ? (
        <Alert tone="error">{error}</Alert>
      ) : loading ? (
        <Spinner label={t("ver.queue.f.loadingVerificationQueue")} />
      ) : (
        <DataTable
          columns={columns}
          rows={items}
          keyOf={(i) => i.complaint.id}
          onRowClick={(i) => navigate(`/verification/${i.complaint.id}`)}
          empty={
            <EmptyState
              title={t("ver.queue.title.nothingToVerify")}
              description={t("ver.queue.d.noComplaintsAreCurrentlyAwaitingVerifica")}
            />
          }
        />
      )}
    </div>
  );
}

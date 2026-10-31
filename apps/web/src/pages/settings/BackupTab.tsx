/**
 * Backup — scheduled job status and manual runs. Reads the platform scheduler
 * (GET /scheduler/jobs, runs) and offers a manual trigger for each job.
 * Gated by `config.system.*` (or the legacy `config.manage`).
 */
import { useCallback, useEffect, useState } from "react";
import { api, type ScheduledJob, type ScheduledJobRun } from "../../lib/api";
import { useT } from "../../i18n/LocaleProvider";
import {
  Alert,
  Button,
  Card,
  type Column,
  DataTable,
  EmptyState,
  Spinner,
  StatusPill,
} from "../../shell/components/ui";

type Message = { type: "error" | "success"; text: string };

export function BackupTab({
  token,
  canManage,
  onMessage,
}: {
  token: string;
  canManage: boolean;
  onMessage: (m: Message) => void;
}) {
  const t = useT();
  const [jobs, setJobs] = useState<ScheduledJob[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, ScheduledJobRun[]>>({});
  const [triggering, setTriggering] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.scheduledJobs(token)
      .then((data) => {
        setJobs(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("backup.loadFailed"));
        setLoading(false);
      });
  }, [token, t]);

  useEffect(() => {
    load();
  }, [load]);

  const loadRuns = useCallback((jobCode: string) => {
    api.scheduledJobRuns(token, jobCode)
      .then((data) => setRuns((prev) => ({ ...prev, [jobCode]: data })))
      .catch(() => {});
  }, [token]);

  const trigger = useCallback(async (jobCode: string) => {
    setTriggering(jobCode);
    try {
      await api.triggerScheduledJob(token, jobCode);
      onMessage({ type: "success", text: t("backup.triggered") });
      loadRuns(jobCode);
    } catch (err) {
      onMessage({ type: "error", text: err instanceof Error ? err.message : t("backup.triggerFailed") });
    } finally {
      setTriggering(null);
    }
  }, [token, onMessage, t, loadRuns]);

  if (loading) return <Spinner label={t("backup.loading")} />;
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!jobs || jobs.length === 0) {
    return <EmptyState title={t("backup.emptyTitle")} description={t("backup.emptyDesc")} />;
  }

  const columns: Column<ScheduledJob>[] = [
    {
      header: t("backup.job"),
      mobileRole: "title",
      cell: (job) => (
        <div>
          <div className="font-medium text-ink">{job.name}</div>
          <div className="text-xs text-ink-dim">{job.jobCode}</div>
        </div>
      ),
    },
    {
      header: t("backup.schedule"),
      cell: (job) => t("backup.interval", { seconds: job.intervalSeconds }),
    },
    {
      header: t("backup.status"),
      mobileRole: "status",
      cell: (job) =>
        job.isEnabled ? (
          <StatusPill tone="success">{t("backup.enabled")}</StatusPill>
        ) : (
          <StatusPill tone="neutral">{t("backup.disabled")}</StatusPill>
        ),
    },
    {
      header: t("backup.lastRun"),
      cell: (job) =>
        job.lastRunAt
          ? `${job.lastStatus ?? "—"} · ${new Date(job.lastRunAt).toLocaleString()}`
          : "—",
    },
    {
      header: t("backup.actions"),
      cell: (job) => (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={!canManage || triggering === job.jobCode}
            onClick={() => trigger(job.jobCode)}
          >
            {triggering === job.jobCode ? t("backup.triggering") : t("backup.trigger")}
          </Button>
          <Button variant="ghost" onClick={() => loadRuns(job.jobCode)}>
            {t("backup.history")}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <DataTable
          columns={columns}
          rows={jobs}
          keyOf={(job) => job.jobCode}
          empty={<EmptyState title={t("backup.emptyTitle")} description={t("backup.emptyDesc")} />}
        />
      </Card>

      {Object.entries(runs).map(([jobCode, jobRuns]) =>
        jobRuns.length > 0 ? (
          <Card key={jobCode}>
            <h3 className="mb-3 text-sm font-semibold text-ink">
              {t("backup.runsFor", { job: jobCode })}
            </h3>
            <DataTable
              columns={[
                { header: t("backup.started"), cell: (r: ScheduledJobRun) => new Date(r.startedAt).toLocaleString() },
                { header: t("backup.status"), mobileRole: "status", cell: (r: ScheduledJobRun) => <StatusPill tone={r.status === "success" ? "success" : r.status === "failed" ? "danger" : "info"}>{r.status === "success" ? t("backup.runStatus.success") : r.status === "failed" ? t("backup.runStatus.failed") : t("backup.runStatus.running")}</StatusPill> },
                { header: t("backup.result"), cell: (r: ScheduledJobRun) => r.errorMessage ?? (r.resultSummary ? JSON.stringify(r.resultSummary) : "—") },
              ]}
              rows={jobRuns}
              keyOf={(r) => r.id}
            />
          </Card>
        ) : null,
      )}
    </div>
  );
}

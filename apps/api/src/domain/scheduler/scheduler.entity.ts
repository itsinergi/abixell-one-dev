/**
 * Domain types for the Scheduler / Background Jobs foundation
 * (Checkpoint 0E). A `ScheduledJob` is a generic registry row (job_code
 * -> handler_key + interval); the actual handler function lives in
 * application code (`application/scheduler/job-handlers.ts`) and is
 * looked up by `handlerKey` at run time — the DB never stores executable
 * code, only "which named handler, how often". `ScheduledJobRun` is the
 * run history, doubling as Observability for background work.
 */

export type ScheduledJobRunStatus = "running" | "success" | "failed";
export type ScheduledJobRunTrigger = "scheduler" | "manual";

export interface ScheduledJob {
  id: string;
  jobCode: string;
  name: string;
  description: string;
  intervalSeconds: number;
  handlerKey: string;
  isEnabled: boolean;
  lastRunAt: Date | null;
  lastStatus: ScheduledJobRunStatus | null;
  lastDurationMs: number | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduledJobRun {
  id: string;
  scheduledJobId: string;
  trigger: ScheduledJobRunTrigger;
  triggeredBy: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  status: ScheduledJobRunStatus;
  resultSummary: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface SchedulerRepository {
  listJobs(): Promise<ScheduledJob[]>;
  findJobByCode(jobCode: string): Promise<ScheduledJob | null>;
  setEnabled(jobCode: string, isEnabled: boolean): Promise<ScheduledJob | null>;

  startRun(scheduledJobId: string, trigger: ScheduledJobRunTrigger, triggeredBy: string | null): Promise<ScheduledJobRun>;
  finishRun(
    runId: string,
    input: { status: "success" | "failed"; resultSummary: Record<string, unknown> | null; errorMessage: string | null },
  ): Promise<ScheduledJobRun>;
  updateJobLastRun(
    jobId: string,
    input: { lastRunAt: Date; lastStatus: ScheduledJobRunStatus; lastDurationMs: number; lastError: string | null },
  ): Promise<void>;

  listRuns(scheduledJobId: string, limit: number): Promise<ScheduledJobRun[]>;
}

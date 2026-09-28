import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type {
  ScheduledJob,
  ScheduledJobRun,
  SchedulerRepository,
} from "../../domain/scheduler/scheduler.entity.js";

export interface JobExecutionContext {
  trigger: "scheduler" | "manual";
  actor: ActorContext | null;
}

export type JobHandler = (
  context: JobExecutionContext,
) => Promise<Record<string, unknown>>;

export interface SchedulerOptions {
  timersDisabled?: boolean;
  executionLeaseMs?: number;
}

/**
 * Scheduler / Background Jobs foundation (Checkpoint 0E). A generic job
 * registry (`scheduled_jobs`) + an in-process interval runner — no external
 * queue/cron infra exists in this workspace, so timers belong to exactly one
 * designated API process. Manual runs use the same registered handlers but
 * carry their Actor/Tenant context for tenant-safe execution. A persisted,
 * renewable lease fences every execution across API replicas.
 */
export class SchedulerService {
  private readonly handlers = new Map<
    string,
    JobHandler
  >();
  private readonly timers = new Map<
    string,
    NodeJS.Timeout
  >();
  private started = false;
  private readonly runningJobCodes = new Set<string>();
  private readonly timersDisabled: boolean;
  private readonly executionLeaseMs: number;

  constructor(
    private readonly repo: SchedulerRepository,
    private readonly rbac: RbacService,
    private readonly onJobError: (
      jobCode: string,
      error: unknown,
    ) => void = () => {},
    options: SchedulerOptions = {},
  ) {
    this.timersDisabled =
      options.timersDisabled ?? false;
    this.executionLeaseMs =
      options.executionLeaseMs ?? 5 * 60 * 1000;
  }

  registerHandler(
    handlerKey: string,
    handler: JobHandler,
  ): void {
    this.handlers.set(handlerKey, handler);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (this.timersDisabled) return;

    const jobs = await this.repo.listJobs();
    for (const job of jobs) {
      if (job.isEnabled) this.scheduleTimer(job);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    this.started = false;
  }

  private scheduleTimer(job: ScheduledJob): void {
    if (this.timersDisabled) return;

    const existing = this.timers.get(job.jobCode);
    if (existing) clearInterval(existing);
    const timer = setInterval(() => {
      this.runTimerIfEnabled(job.jobCode).catch(
        (error) =>
          this.onJobError(job.jobCode, error),
      );
    }, job.intervalSeconds * 1000);
    timer.unref?.();
    this.timers.set(job.jobCode, timer);
  }

  private async runTimerIfEnabled(
    jobCode: string,
  ): Promise<void> {
    const current =
      await this.repo.findJobByCode(jobCode);
    if (!current?.isEnabled) return;
    const run = await this.runJob(
      jobCode,
      "scheduler",
      null,
      null,
    );
    if (run.status === "failed") {
      this.onJobError(
        jobCode,
        new Error(
          run.errorMessage ??
            `Scheduled job '${jobCode}' failed`,
        ),
      );
    }
  }

  async listJobs(
    actor: ActorContext,
  ): Promise<ScheduledJob[]> {
    await this.rbac.requirePermission(
      actor,
      "scheduler.manage",
    );
    const jobs = await this.repo.listJobs();
    return Promise.all(
      jobs.map(async (job) => {
        const latestTenantRun = (
          await this.repo.listRuns(
            job.id,
            1,
            actor.tenantId,
          )
        )[0];
        if (!latestTenantRun) {
          return {
            ...job,
            lastRunAt: null,
            lastStatus: null,
            lastDurationMs: null,
            lastError: null,
          };
        }
        return {
          ...job,
          lastRunAt: latestTenantRun.startedAt,
          lastStatus: latestTenantRun.status,
          lastDurationMs:
            latestTenantRun.finishedAt === null
              ? null
              : latestTenantRun.finishedAt.getTime() -
                latestTenantRun.startedAt.getTime(),
          lastError: latestTenantRun.errorMessage,
        };
      }),
    );
  }

  async listRuns(
    actor: ActorContext,
    jobCode: string,
    limit = 20,
  ): Promise<ScheduledJobRun[]> {
    await this.rbac.requirePermission(
      actor,
      "scheduler.manage",
    );
    const job =
      await this.repo.findJobByCode(jobCode);
    if (!job) {
      throw new NotFoundError(
        "ScheduledJob",
        jobCode,
      );
    }
    return this.repo.listRuns(
      job.id,
      limit,
      actor.tenantId,
    );
  }

  async triggerManually(
    actor: ActorContext,
    jobCode: string,
  ): Promise<ScheduledJobRun> {
    await this.rbac.requirePermission(
      actor,
      "scheduler.manage",
    );
    return this.runJob(
      jobCode,
      "manual",
      actor.userId,
      actor,
    );
  }

  private async runJob(
    jobCode: string,
    trigger: "scheduler" | "manual",
    triggeredBy: string | null,
    actor: ActorContext | null,
  ): Promise<ScheduledJobRun> {
    const job =
      await this.repo.findJobByCode(jobCode);
    if (!job) {
      throw new NotFoundError(
        "ScheduledJob",
        jobCode,
      );
    }
    const handler = this.handlers.get(job.handlerKey);
    if (!handler) {
      throw new ConflictError(
        `No handler registered for handlerKey '${job.handlerKey}'`,
      );
    }

    if (this.runningJobCodes.has(jobCode)) {
      throw new ConflictError(
        `Job '${jobCode}' is already running — skipping overlapping ${trigger} run`,
      );
    }
    const lockToken =
      await this.repo.claimExecution(
        job.id,
        new Date(
          Date.now() - this.executionLeaseMs,
        ),
      );
    if (!lockToken) {
      throw new ConflictError(
        `Job '${jobCode}' is already running on another process — skipping overlapping ${trigger} run`,
      );
    }
    this.runningJobCodes.add(jobCode);
    const heartbeat = setInterval(() => {
      this.repo
        .renewExecution(job.id, lockToken)
        .catch((error) =>
          this.onJobError(jobCode, error),
        );
    }, Math.max(1_000, Math.floor(this.executionLeaseMs / 3)));
    heartbeat.unref?.();

    try {
      const run = await this.repo.startRun(
        job.id,
        trigger,
        triggeredBy,
        actor?.tenantId ?? null,
      );
      const startedAt = Date.now();
      try {
        const resultSummary = await handler({
          trigger,
          actor,
        });
        const finished = await this.repo.finishRun(
          run.id,
          {
            status: "success",
            resultSummary,
            errorMessage: null,
          },
        );
        await this.repo.updateJobLastRun(job.id, {
          lastRunAt: new Date(),
          lastStatus: "success",
          lastDurationMs: Date.now() - startedAt,
          lastError: null,
        });
        return finished;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown job error";
        const finished = await this.repo.finishRun(
          run.id,
          {
            status: "failed",
            resultSummary: null,
            errorMessage: message,
          },
        );
        await this.repo.updateJobLastRun(job.id, {
          lastRunAt: new Date(),
          lastStatus: "failed",
          lastDurationMs: Date.now() - startedAt,
          lastError: message,
        });
        return finished;
      }
    } finally {
      clearInterval(heartbeat);
      await this.repo.releaseExecution(
        job.id,
        lockToken,
      );
      this.runningJobCodes.delete(jobCode);
    }
  }
}

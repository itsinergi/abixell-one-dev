import type { RbacService } from "../rbac/rbac.service.js";
import type { ActorContext } from "../../domain/shared-kernel/audit-context.js";
import { ConflictError, NotFoundError } from "../../domain/shared-kernel/errors.js";
import type { ScheduledJob, ScheduledJobRun, SchedulerRepository } from "../../domain/scheduler/scheduler.entity.js";

export type JobHandler = () => Promise<Record<string, unknown>>;

/**
 * Scheduler / Background Jobs foundation (Checkpoint 0E). A generic job
 * registry (`scheduled_jobs`) + an in-process interval runner — no
 * external queue/cron infra exists in this workspace (documented gap,
 * see the migration file header), so "Scheduler" here means "the API
 * process runs `setInterval` timers for as long as it's up".
 *
 * Handlers are registered by `handlerKey` in `job-handlers.ts` at
 * composition-root wiring time — this class never hardcodes what a job
 * *does*, only how it's scheduled/run/recorded, so a future job (e.g. a
 * Notification retry sweep, an Integration outbound retry) is just
 * another registry row + handler function, not a change to this class.
 *
 * `runJob` is used both by the internal timer loop (trigger='scheduler')
 * and by the RBAC-gated manual-trigger HTTP endpoint (trigger='manual')
 * — same code path, same run-history table, so Observability doesn't
 * need to distinguish "why did this run" logic in two places.
 */
export class SchedulerService {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private started = false;
  // Reliability (Checkpoint 0F): in-process overlap guard. If a job's
  // handler ever runs longer than its own interval — or a manual trigger
  // lands while the timer-driven run is still in flight — a second
  // concurrent run of the SAME job could double-process the same overdue
  // Assignments (Escalation Sweep is not naturally idempotent against
  // itself running twice at once). This makes "at most one run per
  // jobCode at a time" a structural guarantee instead of an assumption.
  private readonly runningJobCodes = new Set<string>();

  constructor(
    private readonly repo: SchedulerRepository,
    private readonly rbac: RbacService,
    private readonly onJobError: (jobCode: string, error: unknown) => void = () => {},
  ) {}

  registerHandler(handlerKey: string, handler: JobHandler): void {
    this.handlers.set(handlerKey, handler);
  }

  /** Starts the interval timer for every currently-enabled job. Safe to
   * call once at process startup; a no-op if already started. Not called
   * at all in the Vitest integration test process (see workflow/
   * scheduler tests — they trigger jobs manually instead), so tests
   * never race a real timer. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const jobs = await this.repo.listJobs();
    for (const job of jobs) {
      if (job.isEnabled) this.scheduleTimer(job);
    }
  }

  stop(): void {
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.started = false;
  }

  private scheduleTimer(job: ScheduledJob): void {
    const existing = this.timers.get(job.jobCode);
    if (existing) clearInterval(existing);
    const timer = setInterval(() => {
      this.runJob(job.jobCode, "scheduler", null).catch((error) => this.onJobError(job.jobCode, error));
    }, job.intervalSeconds * 1000);
    // Node keeps the process alive while an interval is pending — unref
    // so the Scheduler never blocks a clean shutdown/test-process exit.
    timer.unref?.();
    this.timers.set(job.jobCode, timer);
  }

  async listJobs(actor: ActorContext): Promise<ScheduledJob[]> {
    await this.rbac.requirePermission(actor.userId, "scheduler.manage");
    return this.repo.listJobs();
  }

  async listRuns(actor: ActorContext, jobCode: string, limit = 20): Promise<ScheduledJobRun[]> {
    await this.rbac.requirePermission(actor.userId, "scheduler.manage");
    const job = await this.repo.findJobByCode(jobCode);
    if (!job) throw new NotFoundError("ScheduledJob", jobCode);
    return this.repo.listRuns(job.id, limit);
  }

  async setEnabled(actor: ActorContext, jobCode: string, isEnabled: boolean): Promise<ScheduledJob> {
    await this.rbac.requirePermission(actor.userId, "scheduler.manage");
    const updated = await this.repo.setEnabled(jobCode, isEnabled);
    if (!updated) throw new NotFoundError("ScheduledJob", jobCode);
    if (isEnabled) {
      this.scheduleTimer(updated);
    } else {
      const timer = this.timers.get(jobCode);
      if (timer) clearInterval(timer);
      this.timers.delete(jobCode);
    }
    return updated;
  }

  /** Manual trigger — RBAC-gated, runs the job immediately regardless of
   * its interval/enabled state (useful for proving a job works without
   * waiting, and for a Founder-facing "run it now" button). */
  async triggerManually(actor: ActorContext, jobCode: string): Promise<ScheduledJobRun> {
    await this.rbac.requirePermission(actor.userId, "scheduler.manage");
    return this.runJob(jobCode, "manual", actor.userId);
  }

  private async runJob(
    jobCode: string,
    trigger: "scheduler" | "manual",
    triggeredBy: string | null,
  ): Promise<ScheduledJobRun> {
    const job = await this.repo.findJobByCode(jobCode);
    if (!job) throw new NotFoundError("ScheduledJob", jobCode);
    const handler = this.handlers.get(job.handlerKey);
    if (!handler) throw new ConflictError(`No handler registered for handlerKey '${job.handlerKey}'`);

    if (this.runningJobCodes.has(jobCode)) {
      throw new ConflictError(`Job '${jobCode}' is already running — skipping overlapping ${trigger} run`);
    }
    this.runningJobCodes.add(jobCode);

    try {
      const run = await this.repo.startRun(job.id, trigger, triggeredBy);
      const startedAt = Date.now();
      try {
        const resultSummary = await handler();
        const finished = await this.repo.finishRun(run.id, {
          status: "success",
          resultSummary,
          errorMessage: null,
        });
        await this.repo.updateJobLastRun(job.id, {
          lastRunAt: new Date(),
          lastStatus: "success",
          lastDurationMs: Date.now() - startedAt,
          lastError: null,
        });
        return finished;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown job error";
        const finished = await this.repo.finishRun(run.id, { status: "failed", resultSummary: null, errorMessage: message });
        await this.repo.updateJobLastRun(job.id, {
          lastRunAt: new Date(),
          lastStatus: "failed",
          lastDurationMs: Date.now() - startedAt,
          lastError: message,
        });
        return finished;
      }
    } finally {
      this.runningJobCodes.delete(jobCode);
    }
  }
}

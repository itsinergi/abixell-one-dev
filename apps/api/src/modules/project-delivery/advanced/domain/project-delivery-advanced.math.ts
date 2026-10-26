/**
 * Project Delivery Advanced — scheduling, levelling, and earned-value math.
 *
 * Pure functions over plain values: no pool, no ORM, no clock of its own. Every
 * function takes what it needs and returns what it computes, so the arithmetic
 * that decides a critical path or a cost forecast is testable without a
 * database and the same input always produces the same output.
 *
 * ADR-0026 §3: earned value and cost control are advisory computations over
 * recorded facts. Nothing here writes; the caller decides what to keep.
 * ADR-0026 §5: money stays scaled-integer exact-decimal end to end. A number
 * becomes a decimal string only at `fromCents`/`fromUnits` on the way out.
 */

import {
  applyRatio,
  fromCents,
  fromUnits,
  toCents,
  toUnits,
  type BaselineVarianceLine,
  type CoreActivityRef,
  type DependencyType,
  type EarnedValueResult,
  type GanttRow,
  type ProjectActivityDependency,
  type ProjectBaselineLine,
  type ProjectCostEntry,
  type ProjectResource,
  type ProjectResourceAssignment,
  type ProjectSchedule,
  type ResourceLoadingResult,
  type ResourceOverallocation,
  type ScheduleActivityResult,
} from "./project-delivery-advanced.entity.js";

// ---------------------------------------------------------------------------
// Calendar. A "day number" is days since 1970-01-01, an integer. Dates are
// exchanged as `YYYY-MM-DD`; nothing here reads a local timezone, because a
// project plan is a set of calendar dates, not instants.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

export function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

export function dateFromDayNumber(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive duration. An activity with equal start and finish lasts one day. */
export function durationDays(start: string, finish: string): number {
  return dayNumber(finish) - dayNumber(start) + 1;
}

// ---------------------------------------------------------------------------
// Critical path (PRJ-ADV-002/003)
// ---------------------------------------------------------------------------

/** Kahn topological order. Returns null when the graph has a cycle. */
function topologicalOrder(
  ids: string[],
  dependencies: ProjectActivityDependency[],
): string[] | null {
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  const successors = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const dep of dependencies) {
    if (!indegree.has(dep.predecessorActivityId) || !indegree.has(dep.successorActivityId)) continue;
    indegree.set(dep.successorActivityId, (indegree.get(dep.successorActivityId) ?? 0) + 1);
    successors.get(dep.predecessorActivityId)?.push(dep.successorActivityId);
  }

  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const next of successors.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return order.length === ids.length ? order : null;
}

/**
 * Constraint the successor date against one edge.
 *
 * FS — successor starts the day after the predecessor finishes, plus lag.
 * SS — successor starts with the predecessor, plus lag.
 * FF — successor finishes with the predecessor, plus lag.
 * SF — successor finishes the day after the predecessor starts, plus lag.
 *
 * `fromSuccessorStart` flips the direction for the backward pass, where the
 * known quantity is the successor and the predecessor's latest date is what is
 * being derived. Each branch is the exact inverse of its forward counterpart —
 * that symmetry is what makes float come out as zero on the critical path
 * rather than one day off.
 */
function forwardConstraint(
  type: DependencyType,
  lag: number,
  predStart: number,
  predFinish: number,
  duration: number,
): number {
  switch (type) {
    case "FS":
      return predFinish + 1 + lag;
    case "SS":
      return predStart + lag;
    case "FF":
      return predFinish + lag - duration + 1;
    case "SF":
      return predStart + 1 + lag - duration + 1;
    default:
      return predFinish + 1 + lag;
  }
}

function backwardConstraint(
  type: DependencyType,
  lag: number,
  succStart: number,
  succFinish: number,
  predDuration: number,
): number {
  switch (type) {
    // Latest predecessor finish = day before the successor's latest start.
    case "FS":
      return succStart - 1 - lag;
    case "SS":
      return succStart - lag + predDuration - 1;
    case "FF":
      return succFinish - lag;
    case "SF":
      return succFinish + lag - 1;
    default:
      return succStart - 1 - lag;
  }
}

/**
 * Compute the schedule for one project's activities.
 *
 * Activities with no planned dates are reported in `unscheduledActivityIds` and
 * excluded: a dependency edge onto a dateless activity would otherwise drag
 * every successor to an invented date. An activity with a planned start but no
 * end (or the reverse) is treated the same way, because duration is undefined.
 *
 * A cycle returns `hasCycle: true` with each activity's own dates and no float.
 * Reporting a wrong critical path as if it were computed would be worse than
 * reporting that none could be.
 */
export function computeSchedule(
  activities: CoreActivityRef[],
  dependencies: ProjectActivityDependency[],
  computedAt: string,
): ProjectSchedule {
  const scheduled = activities.filter(
    (a) => a.plannedStartDate !== null && a.plannedEndDate !== null,
  );
  const unscheduledActivityIds = activities
    .filter((a) => a.plannedStartDate === null || a.plannedEndDate === null)
    .map((a) => a.id);

  const byId = new Map(scheduled.map((a) => [a.id, a]));
  const ids = scheduled.map((a) => a.id);
  const order = topologicalOrder(ids, dependencies);

  if (order === null) {
    return {
      projectId: activities[0]?.projectId ?? "",
      computedAt,
      activities: scheduled.map((a) => ({
        activityId: a.id,
        durationDays: durationDays(a.plannedStartDate as string, a.plannedEndDate as string),
        earliestStart: a.plannedStartDate as string,
        earliestFinish: a.plannedEndDate as string,
        latestStart: a.plannedStartDate as string,
        latestFinish: a.plannedEndDate as string,
        totalFloatDays: 0,
        isCritical: false,
      })),
      projectFinish: null,
      criticalPath: [],
      unscheduledActivityIds,
      hasCycle: true,
    };
  }

  const duration = new Map<string, number>();
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();

  for (const id of ids) {
    const a = byId.get(id) as CoreActivityRef;
    duration.set(id, durationDays(a.plannedStartDate as string, a.plannedEndDate as string));
    es.set(id, dayNumber(a.plannedStartDate as string));
  }

  const incoming = new Map<string, ProjectActivityDependency[]>(ids.map((id) => [id, []]));
  const outgoing = new Map<string, ProjectActivityDependency[]>(ids.map((id) => [id, []]));
  for (const dep of dependencies) {
    if (!byId.has(dep.predecessorActivityId) || !byId.has(dep.successorActivityId)) continue;
    incoming.get(dep.successorActivityId)?.push(dep);
    outgoing.get(dep.predecessorActivityId)?.push(dep);
  }

  // Forward pass: earliest start is the latest constraint any predecessor
  // imposes, never earlier than the activity's own planned start.
  for (const id of order) {
    const own = es.get(id) as number;
    let start = own;
    for (const dep of incoming.get(id) ?? []) {
      const predStart = es.get(dep.predecessorActivityId) as number;
      const predFinish = predStart + (duration.get(dep.predecessorActivityId) as number) - 1;
      start = Math.max(
        start,
        forwardConstraint(
          dep.dependencyType,
          dep.lagDays,
          predStart,
          predFinish,
          duration.get(id) as number,
        ),
      );
    }
    es.set(id, start);
    ef.set(id, start + (duration.get(id) as number) - 1);
  }

  const projectFinish = ids.length === 0 ? null : Math.max(...ids.map((id) => ef.get(id) as number));

  // Backward pass, reverse topological order. Latest finish starts at the
  // project finish for every activity, then tightens against each successor.
  for (const id of [...order].reverse()) {
    const end = ef.get(id) as number;
    let finish = projectFinish === null ? end : Math.max(end, projectFinish);
    for (const dep of outgoing.get(id) ?? []) {
      const succStart = ls.get(dep.successorActivityId);
      const succFinish = lf.get(dep.successorActivityId);
      if (succStart === undefined || succFinish === undefined) continue;
      finish = Math.min(
        finish,
        backwardConstraint(
          dep.dependencyType,
          dep.lagDays,
          succStart,
          succFinish,
          duration.get(id) as number,
        ),
      );
    }
    lf.set(id, finish);
    ls.set(id, finish - (duration.get(id) as number) + 1);
  }

  const results: ScheduleActivityResult[] = order.map((id) => {
    const totalFloatDays = (ls.get(id) as number) - (es.get(id) as number);
    return {
      activityId: id,
      durationDays: duration.get(id) as number,
      earliestStart: dateFromDayNumber(es.get(id) as number),
      earliestFinish: dateFromDayNumber(ef.get(id) as number),
      latestStart: dateFromDayNumber(ls.get(id) as number),
      latestFinish: dateFromDayNumber(lf.get(id) as number),
      totalFloatDays,
      isCritical: totalFloatDays === 0,
    };
  });

  return {
    projectId: activities[0]?.projectId ?? "",
    computedAt,
    activities: results,
    projectFinish: projectFinish === null ? null : dateFromDayNumber(projectFinish),
    // Critical path in start order, so the list reads the way a plan does.
    criticalPath: results
      .filter((r) => r.isCritical)
      .sort((a, b) => a.earliestStart.localeCompare(b.earliestStart))
      .map((r) => r.activityId),
    unscheduledActivityIds,
    hasCycle: false,
  };
}

/** Gantt rows: schedule plus the activity's own record. Stored nowhere. */
export function buildGanttRows(
  activities: CoreActivityRef[],
  schedule: ProjectSchedule,
  wbsNodeIdByActivity: Map<string, string | null>,
  milestoneCountByActivity: Map<string, number>,
): GanttRow[] {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const computed = new Map(schedule.activities.map((r) => [r.activityId, r]));

  return activities
    .map((activity) => {
      const result = computed.get(activity.id);
      const start = result?.earliestStart ?? activity.plannedStartDate;
      const finish = result?.earliestFinish ?? activity.plannedEndDate;
      if (start === null || finish === null) return null;
      return {
        activityId: activity.id,
        title: byId.get(activity.id)?.title ?? "",
        wbsNodeId: wbsNodeIdByActivity.get(activity.id) ?? null,
        start,
        finish,
        isCritical: result?.isCritical ?? false,
        totalFloatDays: result?.totalFloatDays ?? 0,
        progressPercent: activity.progressPercent,
        milestoneCount: milestoneCountByActivity.get(activity.id) ?? 0,
      } satisfies GanttRow;
    })
    .filter((row): row is GanttRow => row !== null)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Resource loading and levelling (PRJ-ADV-004)
// ---------------------------------------------------------------------------

/**
 * Daily demand per resource, expressed as an overallocation per day.
 *
 * An assignment spreads its planned units evenly across its own inclusive
 * range, so a 100-unit assignment over 5 days demands 20 a day. Spreading to
 * the cent-of-a-unit rather than to whole units is deliberate: rounding each
 * day independently would let a 7-unit week hide a real peak.
 *
 * A resource with `capacityPerDay` NULL is unbounded and can never be
 * overallocated — levelling has nothing to say about it, and inventing a
 * capacity would produce a warning nobody can act on.
 */
export function computeResourceLoading(
  projectId: string,
  from: string,
  to: string,
  assignments: ProjectResourceAssignment[],
  resources: ProjectResource[],
): ResourceLoadingResult {
  const resourceById = new Map(resources.map((r) => [r.id, r]));
  // resourceId -> dayNumber -> { units, assignmentIds }
  const demand = new Map<string, Map<number, { units: bigint; ids: string[] }>>();

  const fromDay = dayNumber(from);
  const toDay = dayNumber(to);

  for (const assignment of assignments) {
    if (!resourceById.has(assignment.resourceId)) continue;
    const units = toUnits(assignment.plannedUnits);
    if (units === null) continue;

    const startDay = dayNumber(assignment.startDate);
    const endDay = dayNumber(assignment.endDate);
    const span = endDay - startDay + 1;
    if (span <= 0) continue;

    const perDay = units / BigInt(span);
    const remainder = units - perDay * BigInt(span);

    let daily = demand.get(assignment.resourceId);
    if (!daily) {
      daily = new Map();
      demand.set(assignment.resourceId, daily);
    }

    for (let day = startDay; day <= endDay; day += 1) {
      if (day < fromDay || day > toDay) continue;
      // The remainder lands on the first days of the span, so the sum of the
      // daily demands equals the assignment's planned units exactly.
      const extra = day - startDay < Number(remainder) ? 1n : 0n;
      const entry = daily.get(day) ?? { units: 0n, ids: [] };
      entry.units += perDay + extra;
      if (!entry.ids.includes(assignment.id)) entry.ids.push(assignment.id);
      daily.set(day, entry);
    }
  }

  const overallocations: ResourceOverallocation[] = [];
  let isLevellable = true;

  for (const [resourceId, daily] of demand) {
    const resource = resourceById.get(resourceId) as ProjectResource;
    const capacity = toUnits(resource.capacityPerDay);
    if (capacity === null) {
      isLevellable = false;
      continue;
    }
    for (const [day, entry] of daily) {
      if (entry.units <= capacity) continue;
      overallocations.push({
        resourceId,
        resourceCode: resource.code,
        date: dateFromDayNumber(day),
        demandedUnits: fromUnits(entry.units),
        capacityUnits: fromUnits(capacity),
        overByUnits: fromUnits(entry.units - capacity),
        assignmentIds: entry.ids,
      });
    }
  }

  overallocations.sort(
    (a, b) => a.date.localeCompare(b.date) || a.resourceCode.localeCompare(b.resourceCode),
  );

  return { projectId, from, to, overallocations, isLevellable };
}

// ---------------------------------------------------------------------------
// Baseline variance (PRJ-ADV-005)
// ---------------------------------------------------------------------------

export function computeBaselineVariance(
  projectId: string,
  baselineId: string,
  baselineVersion: number,
  asOfDate: string,
  lines: ProjectBaselineLine[],
  activities: CoreActivityRef[],
  costEntries: ProjectCostEntry[],
): {
  lines: BaselineVarianceLine[];
  totalBaselineCost: string;
  totalActualCost: string;
  totalCostVariance: string;
  slippedActivityCount: number;
} {
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const actualByActivity = new Map<string, bigint>();
  for (const entry of costEntries) {
    if (entry.activityId === null) continue;
    if (entry.entryType !== "actual" && entry.entryType !== "reversal") continue;
    const cents = toCents(entry.amount);
    if (cents === null) continue;
    const sign = entry.entryType === "reversal" ? -cents : cents;
    actualByActivity.set(entry.activityId, (actualByActivity.get(entry.activityId) ?? 0n) + sign);
  }

  let totalBaseline = 0n;
  let totalActual = 0n;
  let slipped = 0;

  const varianceLines: BaselineVarianceLine[] = lines.map((line) => {
    const activity = activityById.get(line.activityId);
    const baselineCost = toCents(line.plannedCost) ?? 0n;
    const actualCost = actualByActivity.get(line.activityId) ?? 0n;
    totalBaseline += baselineCost;
    totalActual += actualCost;

    const currentFinish = activity?.plannedEndDate ?? null;
    const finishVarianceDays =
      line.plannedFinish !== null && currentFinish !== null
        ? dayNumber(currentFinish) - dayNumber(line.plannedFinish)
        : null;
    const currentStart = activity?.plannedStartDate ?? null;
    const startVarianceDays =
      line.plannedStart !== null && currentStart !== null
        ? dayNumber(currentStart) - dayNumber(line.plannedStart)
        : null;

    // Slip is measured on schedule, not on cost: an activity that is late is
    // late whether or not it is also over budget, and conflating the two would
    // make "slipped" mean neither.
    const isSlipped = (finishVarianceDays ?? 0) > 0;
    if (isSlipped) slipped += 1;

    return {
      activityId: line.activityId,
      title: activity?.title ?? "",
      baselineStart: line.plannedStart,
      baselineFinish: line.plannedFinish,
      currentStart,
      currentFinish,
      startVarianceDays,
      finishVarianceDays,
      baselineCost: fromCents(baselineCost),
      actualCost: fromCents(actualCost),
      costVariance: fromCents(actualCost - baselineCost),
      progressPercent: activity?.progressPercent ?? 0,
      isSlipped,
    };
  });

  void asOfDate;
  return {
    lines: varianceLines,
    totalBaselineCost: fromCents(totalBaseline),
    totalActualCost: fromCents(totalActual),
    totalCostVariance: fromCents(totalActual - totalBaseline),
    slippedActivityCount: slipped,
  };
}

// ---------------------------------------------------------------------------
// Earned value (PRJ-ADV-006)
// ---------------------------------------------------------------------------

/** BCWS: what the baseline said we would have spent by now. */
function plannedValueFor(line: ProjectBaselineLine, asOfDay: number): bigint {
  const cost = toCents(line.plannedCost) ?? 0n;
  if (line.plannedStart === null || line.plannedFinish === null) return cost;
  const start = dayNumber(line.plannedStart);
  const finish = dayNumber(line.plannedFinish);
  if (asOfDay >= finish) return cost;
  if (asOfDay < start) return 0n;
  const elapsed = BigInt(asOfDay - start + 1);
  const total = BigInt(finish - start + 1);
  return applyRatio(cost, elapsed, total);
}

/**
 * Earned value over recorded facts.
 *
 * PV is time-phased from the approved baseline. EV is the baseline cost of an
 * activity weighted by its recorded progress: the plan says what 100% is worth,
 * progress says how much of it is truly done. AC is the actual cost ledger.
 *
 * The forecast (EAC here) is `AC + (BAC - EV)`, the cost-performance forecast:
 * it carries forward the observed cost efficiency for the work that is left.
 * When EV is zero there is no efficiency to carry, and the honest answer is
 * BAC — a forecast invented from a division by zero is worse than a plain
 * budget. EAC is therefore only null when there is no baseline at all.
 */
export function computeEarnedValue(
  projectId: string,
  asOfDate: string,
  currency: string,
  lines: ProjectBaselineLine[],
  activities: CoreActivityRef[],
  costEntries: ProjectCostEntry[],
): EarnedValueResult {
  const asOfDay = dayNumber(asOfDate);
  const activityById = new Map(activities.map((a) => [a.id, a]));

  const actualByActivity = new Map<string, bigint>();
  let totalActual = 0n;
  for (const entry of costEntries) {
    const cents = toCents(entry.amount);
    if (cents === null) continue;
    if (entry.entryDate > asOfDate) continue;

    if (entry.entryType === "actual") {
      totalActual += cents;
      if (entry.activityId) {
        actualByActivity.set(entry.activityId, (actualByActivity.get(entry.activityId) ?? 0n) + cents);
      }
    } else if (entry.entryType === "commitment") {
      // A commitment is money promised, not money spent. Counting it as AC
      // would make a project look over budget the moment it placed an order.
      continue;
    } else if (entry.entryType === "adjustment") {
      totalActual += cents;
    } else if (entry.entryType === "reversal") {
      totalActual -= cents;
      if (entry.activityId) {
        actualByActivity.set(entry.activityId, (actualByActivity.get(entry.activityId) ?? 0n) - cents);
      }
    }
  }

  let totalPv = 0n;
  let totalEv = 0n;
  let totalBac = 0n;
  let progressSum = 0;

  const evLines = lines.map((line) => {
    const activity = activityById.get(line.activityId);
    const bac = toCents(line.plannedCost) ?? 0n;
    const pv = plannedValueFor(line, asOfDay);
    const progress = activity?.progressPercent ?? 0;
    const ev = applyRatio(bac, BigInt(progress), 100n);
    const ac = actualByActivity.get(line.activityId) ?? 0n;

    totalPv += pv;
    totalEv += ev;
    totalBac += bac;
    progressSum += progress;

    return {
      activityId: line.activityId,
      title: activity?.title ?? "",
      plannedValue: fromCents(pv),
      earnedValue: fromCents(ev),
      actualCost: fromCents(ac),
      progressPercent: progress,
    };
  });

  const scheduleVariance = totalEv - totalPv;
  const costVariance = totalEv - totalActual;
  const eac = totalBac === 0n && totalEv === 0n ? null : totalActual + (totalBac - totalEv);

  return {
    projectId,
    asOfDate,
    currency,
    plannedValue: fromCents(totalPv),
    earnedValue: fromCents(totalEv),
    actualCost: fromCents(totalActual),
    scheduleVariance: fromCents(scheduleVariance),
    costVariance: fromCents(costVariance),
    // An index over a zero denominator is undefined, not zero. Saying so is
    // the difference between "no schedule to measure" and "infinitely late".
    schedulePerformanceIndex: totalPv === 0n ? null : fromRatio(totalEv, totalPv),
    costPerformanceIndex: totalActual === 0n ? null : fromRatio(totalEv, totalActual),
    budgetAtCompletion: fromCents(totalBac),
    estimateAtCompletion: eac === null ? null : fromCents(eac),
    estimateToComplete: eac === null ? null : fromCents(eac - totalActual),
    varianceAtCompletion: eac === null ? null : fromCents(totalBac - eac),
    percentComplete: lines.length === 0 ? "0.00" : (progressSum / lines.length).toFixed(2),
    lines: evLines,
  };
}

/** Ratio at 4 decimals, guarded against a zero denominator. */
function fromRatio(numerator: bigint, denominator: bigint): string | null {
  if (denominator === 0n) return null;
  const scaled = applyRatio(numerator * 10000n, 1n, denominator);
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  return `${negative ? "-" : ""}${abs / 10000n}.${(abs % 10000n).toString().padStart(4, "0")}`;
}
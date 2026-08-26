/**
 * Wave A1 / SQ-ADV-001 — deterministic business-calendar arithmetic.
 *
 * Pure functions with no I/O and no third-party date library: timezone
 * conversion uses the platform's own ICU data through `Intl.DateTimeFormat`,
 * which is exactly what the runtime already ships. Keeping this module free
 * of persistence is what makes the timezone, DST, and holiday boundary cases
 * testable in isolation.
 *
 * Every calculation is defined in the calendar's OWN timezone. A commitment
 * of "8 business hours on a Jakarta calendar" must mean the same thing
 * regardless of where the server or the reader happens to be.
 */

export interface WorkweekWindow {
  /** ISO-8601 day of week: 1 = Monday … 7 = Sunday. */
  dayOfWeek: number;
  /** Minutes from local midnight, inclusive. */
  startMinute: number;
  /** Minutes from local midnight, exclusive. */
  endMinute: number;
}

export interface BusinessCalendarDefinition {
  timeZone: string;
  /** 24×7 wall-clock: the workweek and holidays are not consulted. */
  isContinuous: boolean;
  windows: WorkweekWindow[];
  /** Non-working dates as `YYYY-MM-DD` in the calendar's own timezone. */
  holidays: Set<string>;
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/**
 * A calendar with no working window can never accrue business time, so a
 * naive walk would loop forever. The walk is bounded instead and the caller
 * is told the target is unreachable rather than being handed a wrong date.
 */
const MAX_DAYS_SCANNED = 400;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Throws a plain Error for an unknown IANA zone, so a bad Tenant
 * configuration fails at validation time rather than producing silently
 * wrong due dates. */
export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(`Unknown IANA time zone '${timeZone}'`);
  }
}

function toWallClock(instant: Date, timeZone: string): WallClock & { second: number } {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // `hour12: false` renders midnight as 24 in some ICU versions; normalise.
  const hour = read("hour") % 24;
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetMsAt(instant: Date, timeZone: string): number {
  const wall = toWallClock(instant, timeZone);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asIfUtc - instant.getTime();
}

/**
 * Converts a local wall-clock reading in `timeZone` to the absolute instant.
 * Two passes settle the DST edge: the first guess uses the offset at the
 * naive instant, the second re-reads the offset at that corrected point.
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, 0);
  let instant = new Date(naive - offsetMsAt(new Date(naive), timeZone));
  instant = new Date(naive - offsetMsAt(instant, timeZone));
  return instant;
}

function dateKey(wall: WallClock): string {
  const mm = String(wall.month).padStart(2, "0");
  const dd = String(wall.day).padStart(2, "0");
  return `${wall.year}-${mm}-${dd}`;
}

/** ISO-8601 weekday (1 = Monday) of a calendar date. Computed from the
 * date alone, so no timezone can shift it. */
function isoDayOfWeek(wall: WallClock): number {
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(wall: WallClock, days: number): WallClock {
  const shifted = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: 0,
    minute: 0,
  };
}

function windowsForDay(calendar: BusinessCalendarDefinition, wall: WallClock): WorkweekWindow[] {
  if (calendar.holidays.has(dateKey(wall))) return [];
  const dow = isoDayOfWeek(wall);
  return calendar.windows
    .filter((w) => w.dayOfWeek === dow)
    .sort((a, b) => a.startMinute - b.startMinute);
}

export interface DueDateResult {
  dueAt: Date;
  /** True when the calendar defines no reachable working time within the
   * scan bound; the caller must surface this rather than store a fake date. */
  unreachable: boolean;
}

/**
 * Adds `minutes` of BUSINESS time to `startedAt` and returns the absolute
 * instant the commitment falls due.
 *
 * If the start lands outside a working window, the clock starts at the next
 * window opening — a ticket raised at 22:00 does not burn its response SLA
 * overnight. A continuous calendar is plain wall-clock addition.
 */
export function addBusinessMinutes(
  startedAt: Date,
  minutes: number,
  calendar: BusinessCalendarDefinition,
): DueDateResult {
  if (minutes <= 0) return { dueAt: new Date(startedAt.getTime()), unreachable: false };
  if (calendar.isContinuous) {
    return { dueAt: new Date(startedAt.getTime() + minutes * 60_000), unreachable: false };
  }

  const start = toWallClock(startedAt, calendar.timeZone);
  let cursor: WallClock = { ...start, hour: 0, minute: 0 };
  let remainingMs = minutes * 60_000;
  // Only the first scanned day is clipped to the exact start instant; later
  // days are consumed from their window openings. Using instants rather than
  // integer minute buckets preserves seconds (09:00:59 + one business minute
  // is 09:01:59, not 09:01:00) and also remains correct across offset changes.
  let floorInstant = startedAt;

  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1) {
    for (const window of windowsForDay(calendar, cursor)) {
      const windowStartWall = {
        ...cursor,
        hour: Math.floor(window.startMinute / 60),
        minute: window.startMinute % 60,
      };
      const windowEndWall =
        window.endMinute >= 1440
          ? { ...addDays(cursor, 1), hour: 0, minute: 0 }
          : {
              ...cursor,
              hour: Math.floor(window.endMinute / 60),
              minute: window.endMinute % 60,
            };
      const windowStart = wallClockToInstant(windowStartWall, calendar.timeZone);
      const windowEnd = wallClockToInstant(windowEndWall, calendar.timeZone);
      const from = new Date(Math.max(windowStart.getTime(), floorInstant.getTime()));
      if (from.getTime() >= windowEnd.getTime()) continue;
      const availableMs = windowEnd.getTime() - from.getTime();

      if (remainingMs <= availableMs) {
        return {
          dueAt: new Date(from.getTime() + remainingMs),
          unreachable: false,
        };
      }
      remainingMs -= availableMs;
    }
    cursor = addDays(cursor, 1);
    floorInstant = wallClockToInstant(cursor, calendar.timeZone);
  }

  return { dueAt: new Date(startedAt.getTime()), unreachable: true };
}

/**
 * Business minutes actually elapsed between two instants. Used for reporting
 * "how long did this really take against the commitment", never to decide a
 * breach — a breach is the far simpler comparison of the actual timestamp
 * against the frozen due instant.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  calendar: BusinessCalendarDefinition,
): number {
  if (to.getTime() <= from.getTime()) return 0;
  if (calendar.isContinuous) {
    return Math.round((to.getTime() - from.getTime()) / 60_000);
  }

  const start = toWallClock(from, calendar.timeZone);
  const end = toWallClock(to, calendar.timeZone);
  const endKey = dateKey(end);

  let cursor: WallClock = { ...start, hour: 0, minute: 0 };
  let totalMs = 0;

  for (let scanned = 0; scanned < MAX_DAYS_SCANNED; scanned += 1) {
    const key = dateKey(cursor);
    for (const window of windowsForDay(calendar, cursor)) {
      const windowStartWall = {
        ...cursor,
        hour: Math.floor(window.startMinute / 60),
        minute: window.startMinute % 60,
      };
      const windowEndWall =
        window.endMinute >= 1440
          ? { ...addDays(cursor, 1), hour: 0, minute: 0 }
          : {
              ...cursor,
              hour: Math.floor(window.endMinute / 60),
              minute: window.endMinute % 60,
            };
      const windowStart = wallClockToInstant(windowStartWall, calendar.timeZone).getTime();
      const windowEnd = wallClockToInstant(windowEndWall, calendar.timeZone).getTime();
      const clippedStart = Math.max(windowStart, from.getTime());
      const clippedEnd = Math.min(windowEnd, to.getTime());
      if (clippedEnd > clippedStart) totalMs += clippedEnd - clippedStart;
    }
    if (key === endKey) return Math.floor(totalMs / 60_000);
    cursor = addDays(cursor, 1);
  }

  return Math.floor(totalMs / 60_000);
}

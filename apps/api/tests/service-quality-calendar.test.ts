import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  assertValidTimeZone,
  businessMinutesBetween,
  wallClockToInstant,
  type BusinessCalendarDefinition,
} from "../src/domain/service-quality/business-calendar.js";
import type { SlaMatchContext, SlaRule } from "../src/domain/service-quality/service-quality.entity.js";
import {
  matchedDimensions,
  selectSlaRule,
} from "../src/domain/service-quality/sla-matching.js";

function weekdayCalendar(
  timeZone: string,
  startMinute = 9 * 60,
  endMinute = 17 * 60,
): BusinessCalendarDefinition {
  return {
    timeZone,
    isContinuous: false,
    windows: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      dayOfWeek,
      startMinute,
      endMinute,
    })),
    holidays: new Set(),
  };
}

function instant(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return wallClockToInstant({ year, month, day, hour, minute }, timeZone);
}

function rule(overrides: Partial<SlaRule>): SlaRule {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    tenantId: "tenant-a",
    policyId: "policy-a",
    code: overrides.code ?? "DEFAULT",
    customerId: null,
    contractId: null,
    severityCode: null,
    categoryCode: null,
    responseMinutes: 60,
    resolutionMinutes: 480,
    priority: 0,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const context: SlaMatchContext = {
  customerId: "customer-a",
  contractId: "contract-a",
  severityCode: "critical",
  categoryCode: "availability",
};

describe("Wave A1 — deterministic SLA rule matching", () => {
  it("prefers specificity, then explicit priority, then code", () => {
    const winner = selectSlaRule(
      [
        rule({ code: "DEFAULT", priority: 999 }),
        rule({ code: "CUSTOMER", customerId: "customer-a", priority: 999 }),
        rule({
          code: "Z-SPECIFIC",
          customerId: "customer-a",
          severityCode: "critical",
          priority: 10,
        }),
        rule({
          code: "B-SPECIFIC",
          customerId: "customer-a",
          severityCode: "critical",
          priority: 20,
        }),
        rule({
          code: "A-SPECIFIC",
          customerId: "customer-a",
          severityCode: "critical",
          priority: 20,
        }),
      ],
      context,
    );

    expect(winner?.code).toBe("A-SPECIFIC");
    expect(matchedDimensions(winner!)).toEqual({
      customerId: "customer-a",
      severityCode: "critical",
    });
  });

  it("ignores inactive and dimension-mismatched rules", () => {
    expect(
      selectSlaRule(
        [
          rule({ code: "INACTIVE", isActive: false }),
          rule({ code: "OTHER", customerId: "customer-b" }),
        ],
        context,
      ),
    ).toBeNull();
  });

  it("does not mutate repository order while selecting", () => {
    const rules = [rule({ code: "Z" }), rule({ code: "A" })];
    expect(selectSlaRule(rules, context)?.code).toBe("A");
    expect(rules.map((item) => item.code)).toEqual(["Z", "A"]);
  });
});

describe("Wave A1 — business-calendar arithmetic", () => {
  it("rejects an unknown IANA timezone", () => {
    expect(() => assertValidTimeZone("Not/A_Real_Zone")).toThrow(/Unknown IANA time zone/);
  });

  it("retains seconds at a working-window boundary", () => {
    const calendar = weekdayCalendar("UTC");
    const startedAt = new Date("2026-08-24T09:00:59.000Z");

    expect(addBusinessMinutes(startedAt, 1, calendar).dueAt.toISOString()).toBe(
      "2026-08-24T09:01:59.000Z",
    );
    expect(
      businessMinutesBetween(startedAt, new Date("2026-08-24T09:01:59.000Z"), calendar),
    ).toBe(1);
  });

  it("starts at the next window and skips weekends and holidays", () => {
    const calendar = weekdayCalendar("Asia/Jakarta");
    calendar.holidays.add("2026-08-24");
    const fridayAfterHours = instant("Asia/Jakarta", 2026, 8, 21, 18, 0);

    const result = addBusinessMinutes(fridayAfterHours, 60, calendar);

    expect(result.unreachable).toBe(false);
    expect(result.dueAt.toISOString()).toBe("2026-08-25T03:00:00.000Z"); // Tue 10:00 WIB
  });

  it("adds across the US spring DST boundary in local business time", () => {
    const calendar = weekdayCalendar("America/New_York");
    const friday = instant("America/New_York", 2026, 3, 6, 16, 0);

    const result = addBusinessMinutes(friday, 120, calendar);

    expect(result.dueAt.toISOString()).toBe("2026-03-09T14:00:00.000Z"); // Mon 10:00 EDT
  });

  it("adds across the US autumn DST boundary in local business time", () => {
    const calendar = weekdayCalendar("America/New_York");
    const friday = instant("America/New_York", 2026, 10, 30, 16, 0);

    const result = addBusinessMinutes(friday, 120, calendar);

    expect(result.dueAt.toISOString()).toBe("2026-11-02T15:00:00.000Z"); // Mon 10:00 EST
  });

  it("treats a continuous calendar as elapsed time through DST", () => {
    const calendar: BusinessCalendarDefinition = {
      timeZone: "America/New_York",
      isContinuous: true,
      windows: [],
      holidays: new Set(),
    };
    const beforeSpringForward = new Date("2026-03-08T06:30:00.000Z");

    expect(addBusinessMinutes(beforeSpringForward, 120, calendar).dueAt.toISOString()).toBe(
      "2026-03-08T08:30:00.000Z",
    );
  });

  it("reports a calendar with no reachable window instead of inventing a due date", () => {
    const calendar: BusinessCalendarDefinition = {
      timeZone: "UTC",
      isContinuous: false,
      windows: [],
      holidays: new Set(),
    };
    const startedAt = new Date("2026-08-24T09:00:00.000Z");

    expect(addBusinessMinutes(startedAt, 60, calendar)).toEqual({
      dueAt: startedAt,
      unreachable: true,
    });
  });
});

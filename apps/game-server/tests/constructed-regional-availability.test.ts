/**
 * Regional Constructed availability helper — focused tests.
 *
 * The `schedule` values here are CONTROLLED FIXTURES with synthetic region/set
 * codes and placeholder release dates. They are explicitly NOT an official
 * source and NOT the real regional release matrix; the helper is a pure DATA
 * function and these tests must not be read as an official availability claim.
 */
import { describe, expect, it } from "vitest";
import {
  REGIONAL_AVAILABILITY_REASON,
  evaluateRegionalSetAvailability,
  isValidCalendarDate,
  type RegionalAvailabilityQuery,
  type RegionalSchedule,
  type RegionalScheduleEntry
} from "../src/constructed-regional-availability.js";

// Controlled fixture cells: same set, two regions, different release dates.
const SET_ECHO = "fix-echo";
const REGION_CN = "FIX-CN";
const REGION_NA = "FIX-NA";
const CN_RELEASE = "2026-03-06";
const NA_RELEASE = "2026-03-20";

const FIXTURE_SCHEDULE: RegionalSchedule = [
  {
    regionCode: REGION_CN,
    setCode: SET_ECHO,
    releaseDate: CN_RELEASE,
    sourceUrl: "https://fixture.invalid/not-an-official-source/cn",
    status: "confirmed"
  },
  {
    regionCode: REGION_NA,
    setCode: SET_ECHO,
    releaseDate: NA_RELEASE,
    sourceUrl: "https://fixture.invalid/not-an-official-source/na",
    status: "confirmed"
  }
];

function query(
  regionCode: string,
  eventDate: string,
  setCode: string = SET_ECHO
): RegionalAvailabilityQuery {
  return { regionCode, setCode, eventDate };
}

describe("isValidCalendarDate", () => {
  it("accepts real calendar dates and leap days", () => {
    expect(isValidCalendarDate("2026-01-01")).toBe(true);
    expect(isValidCalendarDate("2026-12-31")).toBe(true);
    expect(isValidCalendarDate("2024-02-29")).toBe(true);
    expect(isValidCalendarDate("2028-02-29")).toBe(true);
    expect(isValidCalendarDate("2000-02-29")).toBe(true);
  });

  it("rejects impossible dates, wrong shapes, and non-strings", () => {
    expect(isValidCalendarDate("2026-02-30")).toBe(false);
    expect(isValidCalendarDate("2026-02-29")).toBe(false);
    expect(isValidCalendarDate("1900-02-29")).toBe(false);
    expect(isValidCalendarDate("2026-13-01")).toBe(false);
    expect(isValidCalendarDate("2026-00-10")).toBe(false);
    expect(isValidCalendarDate("2026-04-31")).toBe(false);
    expect(isValidCalendarDate("2026-1-01")).toBe(false);
    expect(isValidCalendarDate("2026-01-1")).toBe(false);
    expect(isValidCalendarDate("2026/01/01")).toBe(false);
    expect(isValidCalendarDate("20260101")).toBe(false);
    expect(isValidCalendarDate("")).toBe(false);
    expect(isValidCalendarDate(20260101)).toBe(false);
    expect(isValidCalendarDate(null)).toBe(false);
  });
});

describe("evaluateRegionalSetAvailability", () => {
  it("returns available on / after the region's own release date", () => {
    const onRelease = evaluateRegionalSetAvailability(query(REGION_CN, CN_RELEASE), FIXTURE_SCHEDULE);
    expect(onRelease).toEqual({
      status: "available",
      regionCode: REGION_CN,
      setCode: SET_ECHO,
      eventDate: CN_RELEASE,
      releaseDate: CN_RELEASE,
      sourceUrl: "https://fixture.invalid/not-an-official-source/cn",
      reason: null
    });

    const after = evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), FIXTURE_SCHEDULE);
    expect(after.status).toBe("available");
  });

  it("returns unreleased strictly before the region's release date", () => {
    const before = evaluateRegionalSetAvailability(query(REGION_CN, "2026-03-05"), FIXTURE_SCHEDULE);
    expect(before.status).toBe("unreleased");
    expect(before.releaseDate).toBe(CN_RELEASE);
    expect(before.reason).toBeNull();
  });

  it("applies each region's own release date for the same set", () => {
    const sameDay = "2026-03-10";
    const cn = evaluateRegionalSetAvailability(query(REGION_CN, sameDay), FIXTURE_SCHEDULE);
    const na = evaluateRegionalSetAvailability(query(REGION_NA, sameDay), FIXTURE_SCHEDULE);
    expect(cn.status).toBe("available");
    expect(cn.releaseDate).toBe(CN_RELEASE);
    expect(na.status).toBe("unreleased");
    expect(na.releaseDate).toBe(NA_RELEASE);
  });

  it("keeps a missing region/set cell unknown with no global fallback", () => {
    const missingRegion = evaluateRegionalSetAvailability(query("FIX-EU", "2026-04-01"), FIXTURE_SCHEDULE);
    expect(missingRegion.status).toBe("unknown");
    expect(missingRegion.reason).toBe(REGIONAL_AVAILABILITY_REASON.missingRegionEntry);
    expect(missingRegion.releaseDate).toBeNull();

    const missingSet = evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01", "fix-absent"), FIXTURE_SCHEDULE);
    expect(missingSet.status).toBe("unknown");
    expect(missingSet.reason).toBe(REGIONAL_AVAILABILITY_REASON.missingSetEntry);

    const globalish = evaluateRegionalSetAvailability(query("GLOBAL", "2026-04-01"), FIXTURE_SCHEDULE);
    expect(globalish.status).toBe("unknown");
  });

  it("never infers a region from local time or the current clock", () => {
    const originalTz = process.env.TZ;
    const originalNow = Date.now;
    try {
      // Nudge the machine clock and timezone; a pure date comparison must not move.
      process.env.TZ = "Pacific/Kiritimati";
      Date.now = () => Date.parse("2030-01-01T00:00:00.000Z");
      const cn = evaluateRegionalSetAvailability(query(REGION_CN, CN_RELEASE), FIXTURE_SCHEDULE);
      const na = evaluateRegionalSetAvailability(query(REGION_NA, CN_RELEASE), FIXTURE_SCHEDULE);
      expect(cn.status).toBe("available");
      expect(na.status).toBe("unreleased");
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
      Date.now = originalNow;
    }
  });

  it("rejects an invalid event date and a non-calendar release date", () => {
    const invalidEvent = evaluateRegionalSetAvailability(query(REGION_CN, "2026-02-30"), FIXTURE_SCHEDULE);
    expect(invalidEvent.status).toBe("unknown");
    expect(invalidEvent.reason).toBe(REGIONAL_AVAILABILITY_REASON.invalidEventDate);

    const invalidRelease = evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), [
      {
        regionCode: REGION_CN,
        setCode: SET_ECHO,
        releaseDate: "2026-02-30",
        sourceUrl: "https://fixture.invalid/not-an-official-source/cn",
        status: "confirmed"
      }
    ]);
    expect(invalidRelease.status).toBe("unknown");
    expect(invalidRelease.reason).toBe(REGIONAL_AVAILABILITY_REASON.invalidReleaseDate);
  });

  it("accepts a leap-day release and compares the strict date string", () => {
    const schedule: RegionalSchedule = [
      {
        regionCode: REGION_CN,
        setCode: SET_ECHO,
        releaseDate: "2028-02-29",
        sourceUrl: "https://fixture.invalid/not-an-official-source/leap",
        status: "confirmed"
      }
    ];
    expect(evaluateRegionalSetAvailability(query(REGION_CN, "2028-02-28"), schedule).status).toBe("unreleased");
    expect(evaluateRegionalSetAvailability(query(REGION_CN, "2028-02-29"), schedule).status).toBe("available");
  });

  it("treats unknown status, missing release date, and blank source URL as unknown", () => {
    const unknownStatus: RegionalSchedule = [
      { regionCode: REGION_CN, setCode: SET_ECHO, releaseDate: CN_RELEASE, sourceUrl: "https://fixture.invalid/x", status: "unknown" }
    ];
    expect(evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), unknownStatus).reason)
      .toBe(REGIONAL_AVAILABILITY_REASON.unconfirmedEntry);

    const nullDate: RegionalSchedule = [
      { regionCode: REGION_CN, setCode: SET_ECHO, releaseDate: null, sourceUrl: "https://fixture.invalid/x", status: "confirmed" }
    ];
    expect(evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), nullDate).reason)
      .toBe(REGIONAL_AVAILABILITY_REASON.missingReleaseDate);

    const blankSource: RegionalSchedule = [
      { regionCode: REGION_CN, setCode: SET_ECHO, releaseDate: CN_RELEASE, sourceUrl: "   ", status: "confirmed" }
    ];
    expect(evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), blankSource).reason)
      .toBe(REGIONAL_AVAILABILITY_REASON.missingSourceUrl);

    const nullSource: RegionalSchedule = [
      { regionCode: REGION_CN, setCode: SET_ECHO, releaseDate: CN_RELEASE, sourceUrl: null, status: "confirmed" }
    ];
    expect(evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), nullSource).reason)
      .toBe(REGIONAL_AVAILABILITY_REASON.missingSourceUrl);
  });

  it("refuses duplicate and conflicting cells instead of first-wins", () => {
    const duplicate: RegionalSchedule = [
      ...FIXTURE_SCHEDULE,
      { ...FIXTURE_SCHEDULE[0]! }
    ];
    const dupResult = evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), duplicate);
    expect(dupResult.status).toBe("unknown");
    expect(dupResult.reason).toBe(REGIONAL_AVAILABILITY_REASON.duplicateEntry);

    const conflicting: RegionalSchedule = [
      ...FIXTURE_SCHEDULE,
      { regionCode: REGION_CN, setCode: SET_ECHO, releaseDate: "2026-05-01", sourceUrl: "https://fixture.invalid/other", status: "confirmed" }
    ];
    const conflictResult = evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), conflicting);
    expect(conflictResult.status).toBe("unknown");
    expect(conflictResult.reason).toBe(REGIONAL_AVAILABILITY_REASON.conflictingEntry);
  });

  it("does not invoke accessors on the query or any schedule entry", () => {
    let touched = 0;
    const accessorRow: RegionalScheduleEntry = Object.defineProperty(
      {
        regionCode: REGION_CN,
        setCode: SET_ECHO,
        releaseDate: "1970-01-01",
        sourceUrl: "https://fixture.invalid/x",
        status: "confirmed" as const
      },
      "releaseDate",
      { enumerable: true, get() { touched += 1; return CN_RELEASE; } }
    );

    const result = evaluateRegionalSetAvailability(query(REGION_CN, "2026-04-01"), [accessorRow]);
    expect(touched).toBe(0);
    expect(result.status).toBe("unknown");
    expect(result.reason).toBe(REGIONAL_AVAILABILITY_REASON.invalidScheduleEntry);

    const accessorQuery = Object.defineProperty(
      { setCode: SET_ECHO, eventDate: "2026-04-01" },
      "regionCode",
      { enumerable: true, get() { touched += 1; return REGION_CN; } }
    ) as RegionalAvailabilityQuery;
    const queryResult = evaluateRegionalSetAvailability(accessorQuery, FIXTURE_SCHEDULE);
    expect(touched).toBe(0);
    expect(queryResult.status).toBe("unknown");
    expect(queryResult.reason).toBe(REGIONAL_AVAILABILITY_REASON.invalidQuery);
  });

  it("does not mutate or retain the query or schedule inputs", () => {
    const mutableQuery = query(REGION_CN, CN_RELEASE);
    const mutableSchedule: RegionalScheduleEntry[] = FIXTURE_SCHEDULE.map(row => ({ ...row }));
    const scheduleSnapshot = structuredClone(mutableSchedule);
    const querySnapshot = { ...mutableQuery };

    const result = evaluateRegionalSetAvailability(mutableQuery, mutableSchedule);
    expect(result.status).toBe("available");
    expect(mutableQuery).toEqual(querySnapshot);
    expect(mutableSchedule).toEqual(scheduleSnapshot);
  });
});

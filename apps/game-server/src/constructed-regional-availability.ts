/**
 * Regional (per-region) Constructed product-availability helper.
 *
 * Boundary contract (read before using):
 * - This module is a PURE DATA helper. It is not an official ruling, not a
 *   `SourceAuthority`, and not a substitute for a verified official source. It
 *   neither authenticates, fetches, nor signs the `schedule` it receives; a
 *   caller that needs trusted answers must pin rows taken from an already
 *   verified official source into its own execution profile / room context.
 * - `eventDate` is the explicit calendar date (`YYYY-MM-DD`) at the event's
 *   location. It is never derived from the current clock, from an `asOf`
 *   timestamp, from a UTC instant, or from any system timezone, and a region is
 *   never inferred from local time. There is no "UTC midnight" fallback, and a
 *   Pre-Rift / rules-effective date is never treated as a product release date.
 * - Rows match by exact `regionCode` + `setCode` only. There is no global,
 *   wildcard, or other-language fallback: a missing region or missing set stays
 *   `unknown`.
 * - Only a row with `status: "confirmed"`, a real calendar `releaseDate`, and a
 *   non-empty `sourceUrl` can produce `available` / `unreleased`. Duplicate or
 *   conflicting rows for the queried cell are refused instead of first-wins.
 * - The default server / room / protocol / UI loader paths do not call this
 *   helper. It exists as standalone pure data so the parent can later wrap it
 *   from a verified official source without changing existing replay context.
 */

export type RegionalAvailabilityStatus = "available" | "unreleased" | "unknown";

export interface RegionalAvailabilityQuery {
  readonly regionCode: string;
  readonly setCode: string;
  /** Explicit event-location calendar date in `YYYY-MM-DD` form. */
  readonly eventDate: string;
}

export interface RegionalScheduleEntry {
  readonly regionCode: string;
  readonly setCode: string;
  readonly releaseDate: string | null;
  readonly sourceUrl: string | null;
  readonly status: "confirmed" | "unknown";
}

export type RegionalSchedule = readonly RegionalScheduleEntry[];

export interface RegionalAvailabilityResult {
  readonly status: RegionalAvailabilityStatus;
  readonly regionCode: string;
  readonly setCode: string;
  readonly eventDate: string;
  readonly releaseDate: string | null;
  readonly sourceUrl: string | null;
  readonly reason: string | null;
}

export const REGIONAL_AVAILABILITY_REASON = {
  invalidQuery: "invalid-query",
  invalidEventDate: "invalid-event-date",
  invalidScheduleEntry: "invalid-schedule-entry",
  missingRegionEntry: "missing-region-entry",
  missingSetEntry: "missing-set-entry",
  unconfirmedEntry: "unconfirmed-schedule-entry",
  missingReleaseDate: "missing-release-date",
  invalidReleaseDate: "invalid-release-date",
  missingSourceUrl: "missing-source-url",
  duplicateEntry: "duplicate-schedule-entry",
  conflictingEntry: "conflicting-schedule-entry"
} as const;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ACCESSOR = Symbol("regional-availability-accessor");

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/**
 * Strict `YYYY-MM-DD` real-calendar validation (month length + leap years).
 * No best-effort parsing and no `Date` coercion, so `2042-02-30` and
 * `2043-02-29` are rejected while `2044-02-29` is accepted.
 */
export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  return true;
}

/**
 * Reads an own property without ever invoking an accessor. Accessor properties
 * are reported as {@link ACCESSOR} so callers can refuse rather than trust them.
 */
function readOwnDataProperty(owner: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) return ACCESSOR;
  return descriptor.value;
}

interface TrustedString {
  readonly trusted: boolean;
  readonly value: string;
}

function readTrustedString(owner: object, key: string): TrustedString {
  const raw = readOwnDataProperty(owner, key);
  if (typeof raw !== "string") return { trusted: false, value: "" };
  return { trusted: true, value: raw };
}

interface ParsedScheduleRow {
  readonly regionCode: string;
  readonly setCode: string;
  readonly releaseDate: string | null;
  readonly sourceUrl: string | null;
  readonly status: "confirmed" | "unknown";
}

function parseScheduleRow(entry: unknown): ParsedScheduleRow | null {
  if (entry === null || typeof entry !== "object") return null;
  const regionCode = readOwnDataProperty(entry, "regionCode");
  const setCode = readOwnDataProperty(entry, "setCode");
  const releaseDate = readOwnDataProperty(entry, "releaseDate");
  const sourceUrl = readOwnDataProperty(entry, "sourceUrl");
  const status = readOwnDataProperty(entry, "status");
  if (typeof regionCode !== "string" || regionCode.length === 0) return null;
  if (typeof setCode !== "string" || setCode.length === 0) return null;
  if (status !== "confirmed" && status !== "unknown") return null;
  const release = releaseDate === undefined || releaseDate === null ? null : releaseDate;
  if (release !== null && typeof release !== "string") return null;
  const source = sourceUrl === undefined || sourceUrl === null ? null : sourceUrl;
  if (source !== null && typeof source !== "string") return null;
  return { regionCode, setCode, releaseDate: release, sourceUrl: source, status };
}

function parseSchedule(raw: unknown): readonly ParsedScheduleRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: ParsedScheduleRow[] = [];
  const length = raw.length;
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (descriptor === undefined || !("value" in descriptor)) return null;
    const row = parseScheduleRow(descriptor.value);
    if (row === null) return null;
    rows.push(row);
  }
  return rows;
}

/**
 * Decides regional Constructed set availability from caller-supplied schedule
 * DATA. See the module doc comment for the trust and boundary contract.
 */
export function evaluateRegionalSetAvailability(
  query: RegionalAvailabilityQuery,
  schedule: RegionalSchedule
): RegionalAvailabilityResult {
  if (query === null || typeof query !== "object") {
    return {
      status: "unknown",
      regionCode: "",
      setCode: "",
      eventDate: "",
      releaseDate: null,
      sourceUrl: null,
      reason: REGIONAL_AVAILABILITY_REASON.invalidQuery
    };
  }

  const regionCode = readTrustedString(query, "regionCode");
  const setCode = readTrustedString(query, "setCode");
  const eventDate = readTrustedString(query, "eventDate");
  const echo = {
    regionCode: regionCode.value,
    setCode: setCode.value,
    eventDate: eventDate.value
  };
  const unknown = (reason: string): RegionalAvailabilityResult => ({
    status: "unknown",
    ...echo,
    releaseDate: null,
    sourceUrl: null,
    reason
  });

  if (!regionCode.trusted || !setCode.trusted || !eventDate.trusted) {
    return unknown(REGIONAL_AVAILABILITY_REASON.invalidQuery);
  }
  if (regionCode.value.length === 0 || setCode.value.length === 0) {
    return unknown(REGIONAL_AVAILABILITY_REASON.invalidQuery);
  }
  if (!isValidCalendarDate(eventDate.value)) {
    return unknown(REGIONAL_AVAILABILITY_REASON.invalidEventDate);
  }

  const rows = parseSchedule(schedule);
  if (rows === null) return unknown(REGIONAL_AVAILABILITY_REASON.invalidScheduleEntry);

  const matching = rows.filter(
    row => row.regionCode === regionCode.value && row.setCode === setCode.value
  );
  if (matching.length === 0) {
    const regionPresent = rows.some(row => row.regionCode === regionCode.value);
    return unknown(
      regionPresent
        ? REGIONAL_AVAILABILITY_REASON.missingSetEntry
        : REGIONAL_AVAILABILITY_REASON.missingRegionEntry
    );
  }
  const first = matching[0];
  if (first === undefined) return unknown(REGIONAL_AVAILABILITY_REASON.missingRegionEntry);
  if (matching.length > 1) {
    const identical = matching.every(
      row =>
        row.releaseDate === first.releaseDate &&
        row.sourceUrl === first.sourceUrl &&
        row.status === first.status
    );
    return unknown(
      identical
        ? REGIONAL_AVAILABILITY_REASON.duplicateEntry
        : REGIONAL_AVAILABILITY_REASON.conflictingEntry
    );
  }

  const row = first;
  if (row.status !== "confirmed") return unknown(REGIONAL_AVAILABILITY_REASON.unconfirmedEntry);
  if (row.releaseDate === null) return unknown(REGIONAL_AVAILABILITY_REASON.missingReleaseDate);
  if (!isValidCalendarDate(row.releaseDate)) {
    return unknown(REGIONAL_AVAILABILITY_REASON.invalidReleaseDate);
  }
  if (row.sourceUrl === null || row.sourceUrl.trim().length === 0) {
    return unknown(REGIONAL_AVAILABILITY_REASON.missingSourceUrl);
  }

  const releaseDate = row.releaseDate;
  return {
    status: eventDate.value < releaseDate ? "unreleased" : "available",
    ...echo,
    releaseDate,
    sourceUrl: row.sourceUrl,
    reason: null
  };
}

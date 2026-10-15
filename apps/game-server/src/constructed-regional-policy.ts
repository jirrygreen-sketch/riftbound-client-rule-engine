/**
 * Regional Constructed deck validator — standalone wrapper.
 *
 * Boundary contract (read before using):
 * - This module composes two already-existing pieces and adds NOTHING of its
 *   own authority: it first runs the existing `validateConstructedDeck`
 *   (`./constructed-policy.ts`) unchanged, then, per zone, asks the existing
 *   pure-data `evaluateRegionalSetAvailability`
 *   (`./constructed-regional-availability.ts`) about the deck's REAL printing
 *   set codes. It never invents a release date, never infers a region, and
 *   never fabricates a printing set code.
 * - It is deliberately NOT wired into the production card-catalog / room /
 *   default loader path. The default server / room / replay behavior is
 *   unchanged; the parent task owns any later wiring.
 * - The global "unreleased printing" check inside `validateConstructedDeck`
 *   is preserved: this wrapper only ADDS a second, region-scoped constraint.
 *   The two constraints are intentionally conservative and may both fire.
 * - Real printing set codes must come from the authoritative public catalog
 *   (`catalog.publicCatalog.cards` -> `id`/`setCode`), supplied by the caller
 *   as the trusted `printingSetCodes` map. `DeckCardDefinition` has no
 *   `setCode`; casting a fabricated one is forbidden. A card id with no
 *   trusted mapping is reported as a regional `unknown` issue and fails the
 *   deck closed.
 * - Fail-closed policy: an unknown region / missing cell / duplicate or
 *   conflicting schedule row / missing trusted mapping makes the whole result
 *   `valid === false`. A missing or malformed context (region, event date,
 *   schedule version, schedule, printing map) is REJECTED (throws) rather than
 *   silently treated as available.
 */

import {
  validateConstructedDeck,
  type ConstructedRules,
  type ConstructedValidationResult
} from "./constructed-policy.js";
import {
  evaluateRegionalSetAvailability,
  isValidCalendarDate,
  type RegionalAvailabilityStatus,
  type RegionalSchedule
} from "./constructed-regional-availability.js";
import type {
  DeckCardDefinition,
  DeckSubmission,
  DeckZone
} from "./deck-validation.js";

/** Thrown when the regional context is missing or malformed. */
export class RegionalConstructedContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegionalConstructedContextError";
  }
}

export interface RegionalConstructedContext {
  /** Region whose real release matrix applies (exact match, no fallback). */
  readonly regionCode: string;
  /** Event-location calendar date in `YYYY-MM-DD` form. */
  readonly eventDate: string;
  /** Caller-pinned identifier of the schedule this context was built from. */
  readonly scheduleVersion: string;
  /** Caller-supplied regional schedule DATA (see the availability helper). */
  readonly schedule: RegionalSchedule;
  /**
   * Trusted `cardId -> setCode` map derived from the authoritative public
   * catalog. Never fabricate this from `DeckCardDefinition`.
   */
  readonly printingSetCodes: Readonly<Record<string, string>>;
}

/** Only non-`available` outcomes become regional issues. */
export type RegionalConstructedIssueStatus = Extract<
  RegionalAvailabilityStatus,
  "unreleased" | "unknown"
>;

export interface RegionalConstructedIssue {
  readonly cardId: string;
  readonly zone: DeckZone;
  readonly status: RegionalConstructedIssueStatus;
  readonly releaseDate: string | null;
  readonly sourceUrl: string | null;
  readonly reason: string | null;
}

export interface RegionalConstructedValidationResult
  extends ConstructedValidationResult {
  readonly regionContext: {
    readonly regionCode: string;
    readonly eventDate: string;
    readonly scheduleVersion: string;
  };
  readonly regionalIssues: readonly RegionalConstructedIssue[];
}

export const REGIONAL_CONSTRUCTED_REASON = {
  missingPrintingSetCode: "missing-printing-set-code"
} as const;

const REGIONAL_ZONES: readonly DeckZone[] = [
  "mainDeck",
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
];

interface ResolvedRegionalContext {
  readonly regionCode: string;
  readonly eventDate: string;
  readonly scheduleVersion: string;
  readonly schedule: RegionalSchedule;
  readonly printingSetCodes: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RegionalConstructedContextError(
      `Regional constructed context requires a non-empty ${field}.`
    );
  }
  return value;
}

/**
 * Validates and freezes the caller-pinned context. Rejects (throws) on any
 * missing or malformed field instead of guessing a value.
 */
function resolveRegionalContext(
  context: unknown
): ResolvedRegionalContext {
  if (!isRecord(context)) {
    throw new RegionalConstructedContextError(
      "Regional constructed context is required."
    );
  }
  const regionCode = requireNonEmptyString(context.regionCode, "regionCode");
  const eventDate = requireNonEmptyString(context.eventDate, "eventDate");
  if (!isValidCalendarDate(eventDate)) {
    throw new RegionalConstructedContextError(
      `Regional constructed context.eventDate ${eventDate} is not a real YYYY-MM-DD calendar date.`
    );
  }
  const scheduleVersion = requireNonEmptyString(
    context.scheduleVersion,
    "scheduleVersion"
  );
  if (!Array.isArray(context.schedule)) {
    throw new RegionalConstructedContextError(
      "Regional constructed context.schedule must be an array."
    );
  }
  const printingSetCodes = context.printingSetCodes;
  if (!isRecord(printingSetCodes)) {
    throw new RegionalConstructedContextError(
      "Regional constructed context.printingSetCodes must be a trusted cardId->setCode record."
    );
  }
  return {
    regionCode,
    eventDate,
    scheduleVersion,
    schedule: context.schedule as RegionalSchedule,
    printingSetCodes: printingSetCodes as Readonly<Record<string, string>>
  };
}

function readPrintingSetCode(
  printingSetCodes: Readonly<Record<string, string>>,
  cardId: string
): string | null {
  if (!Object.hasOwn(printingSetCodes, cardId)) return null;
  const setCode = printingSetCodes[cardId];
  if (typeof setCode !== "string" || setCode.length === 0) return null;
  return setCode;
}

function collectRegionalIssues(
  deck: DeckSubmission,
  context: ResolvedRegionalContext
): readonly RegionalConstructedIssue[] {
  const issues: RegionalConstructedIssue[] = [];
  for (const zone of REGIONAL_ZONES) {
    for (const entry of deck[zone] ?? []) {
      const setCode = readPrintingSetCode(context.printingSetCodes, entry.cardId);
      if (setCode === null) {
        issues.push({
          cardId: entry.cardId,
          zone,
          status: "unknown",
          releaseDate: null,
          sourceUrl: null,
          reason: REGIONAL_CONSTRUCTED_REASON.missingPrintingSetCode
        });
        continue;
      }
      const availability = evaluateRegionalSetAvailability(
        {
          regionCode: context.regionCode,
          setCode,
          eventDate: context.eventDate
        },
        context.schedule
      );
      if (availability.status === "available") continue;
      issues.push({
        cardId: entry.cardId,
        zone,
        status: availability.status,
        releaseDate: availability.releaseDate,
        sourceUrl: availability.sourceUrl,
        reason: availability.reason
      });
    }
  }
  return issues;
}

/**
 * Existing Constructed validation PLUS a region-scoped product-availability
 * constraint. See the module doc comment for the full boundary contract.
 *
 * @throws {RegionalConstructedContextError} when the context is missing or
 *   malformed (region, event date, schedule version, schedule, printing map).
 */
export function validateRegionalConstructedDeck(
  deck: DeckSubmission,
  validationCards: readonly DeckCardDefinition[],
  constructed: ConstructedRules,
  context: RegionalConstructedContext
): RegionalConstructedValidationResult {
  const resolved = resolveRegionalContext(context);
  const base = validateConstructedDeck(deck, validationCards, constructed);
  const regionalIssues = collectRegionalIssues(deck, resolved);
  return {
    ...base,
    valid: base.valid && regionalIssues.length === 0,
    regionContext: {
      regionCode: resolved.regionCode,
      eventDate: resolved.eventDate,
      scheduleVersion: resolved.scheduleVersion
    },
    regionalIssues
  };
}

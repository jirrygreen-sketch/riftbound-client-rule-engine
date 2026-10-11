import type {
  DeckCardDefinition,
  DeckValidationRules,
  DeckValidationResult,
  DeckZone
} from "./deck-validation.js";
import { validateDeck, type DeckSubmission } from "./deck-validation.js";

export type ConstructedFormat = "standard";

export type ConstructedCardPolicyStatus =
  | "legal"
  | "banned"
  | "unreleased"
  | "notStandard";

export type ConstructedPrintingPolicyStatus =
  | "available"
  | "banned"
  | "previewNotReleased"
  | "notStandard";

export interface ConstructedCardPolicy {
  readonly status: ConstructedCardPolicyStatus;
  readonly maxCopies: number;
}

export interface ConstructedPolicyCard {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly fullName: string;
  readonly cardType: string;
  readonly setCode: string;
}

export interface ConstructedPrintingPolicy {
  readonly status: ConstructedPrintingPolicyStatus;
  readonly available: boolean;
  readonly setCode: string;
}

export interface ConstructedSourceProvenance {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly lastUpdated?: string;
}

export interface ConstructedBanTarget {
  readonly officialName: string;
  readonly resolvedFullName: string;
  readonly canonicalCardId: string;
  readonly sourceId: string;
  readonly aliases: readonly string[];
}

export interface ConstructedMissingBanTarget {
  readonly officialName: string;
  readonly sourceId: string;
  readonly reason: string;
}

export interface ConstructedZoneRule {
  readonly zone: DeckZone;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly defaultMaxCopiesPerCanonical?: number;
}

export interface ConstructedPolicyLimitation {
  readonly id: string;
  readonly description: string;
}

export interface ConstructedPublicPolicy {
  readonly format: ConstructedFormat;
  readonly checkedAt: "2026-10-11";
  readonly banResolutionComplete: boolean;
  readonly tournamentComplete: false;
  readonly policyScope: string;
  readonly limitations: readonly ConstructedPolicyLimitation[];
  readonly sources: readonly ConstructedSourceProvenance[];
  readonly zoneRules: readonly ConstructedZoneRule[];
  readonly cardPolicies: Readonly<Record<string, ConstructedCardPolicy>>;
  readonly printingPolicies: Readonly<Record<string, ConstructedPrintingPolicy>>;
  readonly bannedTargets: readonly ConstructedBanTarget[];
  readonly missingBannedNames: readonly string[];
  readonly missingBannedTargets: readonly ConstructedMissingBanTarget[];
  readonly standard: {
    readonly legalSetCodes: readonly string[];
    readonly radiance: {
      readonly status: "preview-not-released";
      readonly effectiveDate: "2026-10-16";
      readonly releaseDate: "2026-10-23";
    };
  };
}

export interface ConstructedRules {
  readonly rules: DeckValidationRules;
  readonly policy: ConstructedPublicPolicy;
}

export interface ConstructedPrintingIssue {
  readonly cardId: string;
  readonly canonicalCardId?: string;
  readonly zone: DeckZone;
  readonly status: ConstructedPrintingPolicyStatus;
  readonly message: string;
}

export interface ConstructedValidationResult extends DeckValidationResult {
  readonly printingIssues: readonly ConstructedPrintingIssue[];
}

interface OfficialBanDefinition {
  readonly officialName: string;
  readonly aliases?: readonly string[];
}

const CHECKED_AT = "2026-10-11" as const;
const STANDARD_LEGAL_SET_CODES = ["ogs", "ogn", "sfd", "unl", "ven"] as const;
const RADIANCE_SET_CODE = "rad";
const RUNE_MAX_COPIES = 12;
const BATTLEFIELD_MAX_COPIES = 1;
const DEFAULT_MAX_COPIES = 3;

const POLICY_LIMITATIONS: readonly ConstructedPolicyLimitation[] = [
  {
    id: "domain-identity",
    description:
      "Domain Identity restrictions for Main Deck, Rune Deck, and Battlefields are not implemented."
  },
  {
    id: "champion-legend-signature",
    description:
      "Champion Legend matching, Chosen Champion tag matching, and Signature card restrictions are not implemented."
  },
  {
    id: "regional-product-availability",
    description:
      "Regional product availability and release dates are represented as policy metadata, not independently verified."
  }
];

const RULES_HUB_SOURCE: ConstructedSourceProvenance = {
  id: "rules-hub-constructed-legality",
  name: "Rules Hub: Constructed Format Legality",
  url: "https://playriftbound.com/en-us/rules-hub/",
  lastUpdated: "2026-09-18"
};

const CARD_SNAPSHOT_SOURCE: ConstructedSourceProvenance = {
  id: "card-snapshot-official-english-full-name",
  name: "Official card snapshot, official English fullName",
  url: "https://playriftbound.com/en-us/card-gallery/"
};

const OFFICIAL_CONSTRUCTED_BANS: readonly OfficialBanDefinition[] = [
  { officialName: "Called Shot" },
  { officialName: "Ekko, Recurrent" },
  { officialName: "Draven, Vanquisher" },
  { officialName: "Fight or Flight" },
  { officialName: "Scrapheap" },
  { officialName: "Stealthy Pursuer" },
  { officialName: "Stacked Deck" },
  { officialName: "The Arena’s Greatest", aliases: ["The Arena's Greatest"] },
  { officialName: "Aspirant’s Climb", aliases: ["Aspirant's Climb"] },
  {
    officialName: "Dreaming Tree",
    aliases: ["The Dreaming Tree"]
  },
  { officialName: "Obelisk of Power" },
  { officialName: "Reaver’s Row", aliases: ["Reaver's Row"] }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPolicyCard(value: unknown): value is ConstructedPolicyCard {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id) &&
    isNonEmptyString(value.canonicalCardId) &&
    isNonEmptyString(value.fullName) &&
    isNonEmptyString(value.cardType) &&
    isNonEmptyString(value.setCode);
}

function cardTypeZoneMaxCopies(cardType: string): number {
  const normalized = cardType.trim().toLowerCase();
  if (normalized === "battlefield") return BATTLEFIELD_MAX_COPIES;
  if (normalized === "rune") return RUNE_MAX_COPIES;
  return DEFAULT_MAX_COPIES;
}

function isStandardLegalSet(setCode: string): boolean {
  return (STANDARD_LEGAL_SET_CODES as readonly string[]).includes(
    setCode.trim().toLowerCase()
  );
}

function isRadianceSet(setCode: string): boolean {
  return setCode.trim().toLowerCase() === RADIANCE_SET_CODE;
}

function buildCanonicalIndex(
  cards: readonly ConstructedPolicyCard[]
): Map<string, string> {
  const fullNameToCanonical = new Map<string, string>();
  const canonicalToFullName = new Map<string, string>();
  const ids = new Set<string>();
  const canonicalIds = new Set<string>();

  for (const card of cards) {
    if (!isPolicyCard(card)) {
      throw new Error("Constructed policy cards must be non-empty card records.");
    }
    if (ids.has(card.id)) {
      throw new Error(`Constructed policy contains duplicate card id ${card.id}.`);
    }
    ids.add(card.id);
    canonicalIds.add(card.canonicalCardId);

    const existingCanonical = fullNameToCanonical.get(card.fullName);
    if (existingCanonical !== undefined &&
        existingCanonical !== card.canonicalCardId) {
      throw new Error(
        `Official English fullName ${card.fullName} maps to multiple canonical cards.`
      );
    }
    fullNameToCanonical.set(card.fullName, card.canonicalCardId);

    const existingFullName = canonicalToFullName.get(card.canonicalCardId);
    if (existingFullName !== undefined && existingFullName !== card.fullName) {
      throw new Error(
        `Canonical card ${card.canonicalCardId} maps to multiple official English fullNames.`
      );
    }
    canonicalToFullName.set(card.canonicalCardId, card.fullName);
  }

  if (canonicalIds.size === 0) {
    throw new Error("Constructed policy requires at least one canonical card.");
  }
  return fullNameToCanonical;
}

function resolveOfficialName(
  fullNameToCanonical: ReadonlyMap<string, string>,
  name: string
): string | undefined {
  return fullNameToCanonical.get(name);
}

function resolveBans(
  fullNameToCanonical: ReadonlyMap<string, string>
): {
  readonly bannedTargets: readonly ConstructedBanTarget[];
  readonly missingBannedTargets: readonly ConstructedMissingBanTarget[];
} {
  const bannedTargets: ConstructedBanTarget[] = [];
  const missingBannedTargets: ConstructedMissingBanTarget[] = [];

  for (const definition of OFFICIAL_CONSTRUCTED_BANS) {
    let canonicalCardId = resolveOfficialName(
      fullNameToCanonical,
      definition.officialName
    );
    let resolvedFullName = canonicalCardId === undefined
      ? undefined
      : definition.officialName;

    if (canonicalCardId === undefined) {
      for (const alias of definition.aliases ?? []) {
        const aliasCanonicalCardId = resolveOfficialName(
          fullNameToCanonical,
          alias
        );
        if (aliasCanonicalCardId !== undefined) {
          if (canonicalCardId !== undefined &&
              canonicalCardId !== aliasCanonicalCardId) {
            throw new Error(
              `Official ban aliases for ${definition.officialName} resolve to different canonical cards.`
            );
          }
          canonicalCardId = aliasCanonicalCardId;
          resolvedFullName = alias;
        }
      }
    }

    if (canonicalCardId === undefined || resolvedFullName === undefined) {
      missingBannedTargets.push({
        officialName: definition.officialName,
        sourceId: RULES_HUB_SOURCE.id,
        reason:
          "No card in the snapshot has this exact official English fullName or an explicitly recorded source alias."
      });
      continue;
    }

    bannedTargets.push({
      officialName: definition.officialName,
      resolvedFullName,
      canonicalCardId,
      sourceId: RULES_HUB_SOURCE.id,
      aliases: definition.aliases ?? []
    });
  }

  return { bannedTargets, missingBannedTargets };
}

export function createConstructedRules(
  cards: readonly ConstructedPolicyCard[],
  format: ConstructedFormat = "standard"
): ConstructedRules {
  if (format !== "standard") {
    throw new Error(`Unsupported constructed format ${format}.`);
  }

  const fullNameToCanonical = buildCanonicalIndex(cards);
  const { bannedTargets, missingBannedTargets } = resolveBans(
    fullNameToCanonical
  );
  const bannedCanonicalIds = new Set(
    bannedTargets.map(target => target.canonicalCardId)
  );

  const cardPolicies: Record<string, ConstructedCardPolicy> = {};
  const printingPolicies: Record<string, ConstructedPrintingPolicy> = {};
  const bannedServerPolicies: Record<string, { readonly type: "banned" }> = {};

  const canonicalCards = new Map<string, ConstructedPolicyCard>();
  for (const card of cards) {
    printingPolicies[card.id] = {
      status: bannedCanonicalIds.has(card.canonicalCardId)
        ? "banned"
        : isRadianceSet(card.setCode)
          ? "previewNotReleased"
          : isStandardLegalSet(card.setCode)
            ? "available"
            : "notStandard",
      available: bannedCanonicalIds.has(card.canonicalCardId) === false &&
        isRadianceSet(card.setCode) === false &&
        isStandardLegalSet(card.setCode),
      setCode: card.setCode
    };
    if (!canonicalCards.has(card.canonicalCardId)) {
      canonicalCards.set(card.canonicalCardId, card);
    }
  }

  for (const [canonicalCardId, card] of canonicalCards) {
    if (bannedCanonicalIds.has(canonicalCardId)) {
      cardPolicies[card.canonicalCardId] = {
        status: "banned",
        maxCopies: 0
      };
      bannedServerPolicies[canonicalCardId] = { type: "banned" };
      continue;
    }

    const hasAvailablePrinting = cards.some(candidate =>
      candidate.canonicalCardId === canonicalCardId &&
      isStandardLegalSet(candidate.setCode)
    );
    if (!hasAvailablePrinting && isRadianceSet(card.setCode)) {
      cardPolicies[card.canonicalCardId] = {
        status: "unreleased",
        maxCopies: 0
      };
      bannedServerPolicies[canonicalCardId] = { type: "banned" };
      continue;
    }

    if (!hasAvailablePrinting) {
      cardPolicies[card.canonicalCardId] = {
        status: "notStandard",
        maxCopies: 0
      };
      bannedServerPolicies[canonicalCardId] = { type: "banned" };
      continue;
    }

    cardPolicies[canonicalCardId] = {
      status: "legal",
      maxCopies: cardTypeZoneMaxCopies(card.cardType)
    };
  }

  const rules: DeckValidationRules = {
    defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES,
    uniqueCanonicalZones: ["battlefields"],
    cardPolicies: bannedServerPolicies,
    copyRules: [
      {
        zones: ["mainDeck", "champion", "sideboard"],
        maxCopiesPerCanonical: DEFAULT_MAX_COPIES
      },
      { zones: ["legend"], maxCopiesPerCanonical: DEFAULT_MAX_COPIES },
      { zones: ["runes"], maxCopiesPerCanonical: RUNE_MAX_COPIES },
      {
        zones: ["battlefields"],
        maxCopiesPerCanonical: BATTLEFIELD_MAX_COPIES
      }
    ],
    sizeRules: {
      legend: { minimum: 1, maximum: 1 },
      champion: { minimum: 1, maximum: 1 },
      runes: { minimum: 12, maximum: 12 },
      battlefields: { minimum: 3, maximum: 3 },
      sideboard: { minimum: 0, maximum: 10 }
    },
    sizeGroups: [
      { zones: ["mainDeck", "champion"], rule: { minimum: 40, maximum: 40 } }
    ]
  };

  const policy: ConstructedPublicPolicy = {
    format,
    checkedAt: CHECKED_AT,
    banResolutionComplete: missingBannedTargets.length === 0,
    tournamentComplete: false,
    policyScope: "Bounded official Constructed policy: bans and deck/zone structure only",
    limitations: POLICY_LIMITATIONS,
    sources: [RULES_HUB_SOURCE, CARD_SNAPSHOT_SOURCE],
    zoneRules: [
      {
        zone: "mainDeck",
        defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES
      },
      { zone: "legend", minimum: 1, maximum: 1, defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES },
      { zone: "champion", minimum: 1, maximum: 1, defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES },
      { zone: "runes", minimum: 12, maximum: 12, defaultMaxCopiesPerCanonical: RUNE_MAX_COPIES },
      {
        zone: "battlefields",
        minimum: 3,
        maximum: 3,
        defaultMaxCopiesPerCanonical: BATTLEFIELD_MAX_COPIES
      },
      { zone: "sideboard", minimum: 0, maximum: 10, defaultMaxCopiesPerCanonical: DEFAULT_MAX_COPIES }
    ],
    cardPolicies,
    printingPolicies,
    bannedTargets,
    missingBannedNames: missingBannedTargets.map(target => target.officialName),
    missingBannedTargets,
    standard: {
      legalSetCodes: STANDARD_LEGAL_SET_CODES,
      radiance: {
        status: "preview-not-released",
        effectiveDate: "2026-10-16",
        releaseDate: "2026-10-23"
      }
    }
  };

  return { rules, policy };
}

export function getConstructedCardPolicy(
  policy: ConstructedPublicPolicy,
  canonicalCardId: string
): ConstructedCardPolicy | undefined {
  return policy.cardPolicies[canonicalCardId];
}

export function getConstructedPrintingPolicy(
  policy: ConstructedPublicPolicy,
  printingId: string
): ConstructedPrintingPolicy | undefined {
  return policy.printingPolicies[printingId];
}

export function validateConstructedDeck(
  deck: DeckSubmission,
  validationCards: readonly DeckCardDefinition[],
  constructed: ConstructedRules
): ConstructedValidationResult {
  const result = validateDeck(deck, validationCards, constructed.rules);
  const printingIssues: ConstructedPrintingIssue[] = [];
  const cardById = new Map(validationCards.map(card => [card.id, card]));
  const zones = [
    "mainDeck",
    "runes",
    "legend",
    "champion",
    "battlefields",
    "sideboard"
  ] as const;

  for (const zone of zones) {
    for (const entry of deck[zone] ?? []) {
      const printingPolicy = constructed.policy.printingPolicies[entry.cardId];
      if (printingPolicy === undefined || printingPolicy.available) continue;

      const card = cardById.get(entry.cardId);
      printingIssues.push({
        cardId: entry.cardId,
        canonicalCardId: card?.canonicalCardId,
        zone,
        status: printingPolicy.status,
        message: printingPolicy.status === "previewNotReleased"
          ? `Printing ${entry.cardId} is a Radiance preview printing and is not released as of ${constructed.policy.checkedAt}.`
          : printingPolicy.status === "banned"
            ? `Printing ${entry.cardId} belongs to a banned canonical card.`
            : `Printing ${entry.cardId} is not from a Standard-legal set.`
      });
    }
  }

  return {
    ...result,
    valid: result.valid && printingIssues.length === 0,
    printingIssues
  };
}

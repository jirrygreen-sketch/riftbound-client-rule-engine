/**
 * Partial server-side deck validation. This module is not a complete official
 * deck construction ruleset; all structural and copy policies are supplied by
 * the caller or by PARTIAL_DECK_RULES.
 */

export type DeckZone =
  | "mainDeck"
  | "runes"
  | "legend"
  | "champion"
  | "battlefields"
  | "sideboard";

export interface DeckCardEntry {
  readonly cardId: string;
  readonly quantity: number;
}

export interface DeckSubmission {
  readonly mainDeck?: readonly DeckCardEntry[];
  readonly runes?: readonly DeckCardEntry[];
  readonly legend?: readonly DeckCardEntry[];
  readonly champion?: readonly DeckCardEntry[];
  readonly battlefields?: readonly DeckCardEntry[];
  readonly sideboard?: readonly DeckCardEntry[];
}

export interface DeckCardDefinition {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly name: string;
  readonly allowedZones?: readonly DeckZone[];
}

export type DeckCardPolicy =
  | { readonly type: "banned" }
  | { readonly type: "limited"; readonly maxCopies: number }
  | { readonly type: "restricted" };

export interface DeckSizeRule {
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface DeckSizeGroup {
  readonly zones: readonly DeckZone[];
  readonly rule: DeckSizeRule;
}

export interface DeckCopyRule {
  readonly zones: readonly DeckZone[];
  readonly maxCopiesPerCanonical?: number;
  readonly maxCopiesByCanonical?: Readonly<Record<string, number>>;
}

export interface DeckValidationRules {
  readonly defaultMaxCopiesPerCanonical?: number;
  readonly cardPolicies?: Readonly<Record<string, DeckCardPolicy>>;
  readonly copyRules?: readonly DeckCopyRule[];
  readonly sizeRules?: Readonly<Partial<Record<DeckZone, DeckSizeRule>>>;
  readonly sizeGroups?: readonly DeckSizeGroup[];
  readonly uniqueCanonicalZones?: readonly DeckZone[];
  readonly totalCards?: DeckSizeRule;
}

export type DeckValidationIssueCode =
  | "invalid_deck"
  | "invalid_entry"
  | "invalid_card_catalog"
  | "invalid_rules"
  | "unknown_card"
  | "banned_card"
  | "copy_limit_exceeded"
  | "card_not_allowed_in_zone"
  | "zone_size_out_of_range"
  | "zone_uniqueness_violated"
  | "deck_size_out_of_range"
  | "count_overflow";

export interface DeckValidationIssue {
  readonly code: DeckValidationIssueCode;
  readonly message: string;
  readonly cardId?: string;
  readonly canonicalCardId?: string;
  readonly zone?: DeckZone;
  readonly zones?: readonly DeckZone[];
  readonly entryIndex?: number;
  readonly unknownFields?: readonly string[];
  readonly copyRuleIndex?: number;
}

export interface DeckValidationResult {
  readonly valid: boolean;
  readonly overflow: boolean;
  readonly totalCards: number;
  readonly zoneCounts: Readonly<Record<DeckZone, number>>;
  readonly canonicalCardCounts: Readonly<Record<string, number>>;
  readonly issues: readonly DeckValidationIssue[];
}

const DECK_ZONES = [
  "mainDeck",
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
] as const satisfies readonly DeckZone[];

const DEFAULT_MAX_COPIES_PER_CANONICAL = 3;
const DEFAULT_COPY_LIMIT_ZONES: readonly DeckZone[] = [
  "mainDeck",
  "legend",
  "champion",
  "sideboard"
];

/**
 * Structural rules for the current server boundary. They are intentionally
 * partial and are not official constructed-deck policy. Copy and ban policy
 * must be supplied by the server-owned constructed-policy layer.
 *
 * - runes is 12 cards;
 * - battlefields is 3 cards;
 * - mainDeck plus chosen champion is 40 cards;
 * - sideboard is 10 cards.
 */
export const PARTIAL_DECK_RULES: DeckValidationRules = {
  sizeRules: {
    runes: { minimum: 12, maximum: 12 },
    champion: { minimum: 1, maximum: 1 },
    battlefields: { minimum: 3, maximum: 3 },
    sideboard: { minimum: 10, maximum: 10 }
  },
  uniqueCanonicalZones: ["battlefields"],
  sizeGroups: [
    { zones: ["mainDeck", "champion"], rule: { minimum: 40, maximum: 40 } }
  ]
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDeckZone(value: unknown): value is DeckZone {
  return (DECK_ZONES as readonly unknown[]).includes(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return isNonnegativeSafeInteger(value) && value >= 1;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSizeRule(value: unknown): value is DeckSizeRule {
  if (!isRecord(value)) return false;
  if (!Object.keys(value).every(key => key === "minimum" || key === "maximum")) {
    return false;
  }
  if (value.minimum !== undefined && !isNonnegativeSafeInteger(value.minimum)) {
    return false;
  }
  if (value.maximum !== undefined && !isNonnegativeSafeInteger(value.maximum)) {
    return false;
  }
  return value.minimum === undefined ||
    value.maximum === undefined ||
    value.minimum <= value.maximum;
}

function uniqueZones(value: unknown): value is readonly DeckZone[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every(isDeckZone) &&
    new Set(value).size === value.length;
}

function isCardPolicy(value: unknown): value is DeckCardPolicy {
  if (!isRecord(value)) return false;
  if (value.type === "banned" || value.type === "restricted") {
    return Object.keys(value).length === 1;
  }
  return value.type === "limited" &&
    Object.keys(value).length === 2 &&
    isPositiveSafeInteger(value.maxCopies);
}

function isCopyRule(value: unknown): value is DeckCopyRule {
  if (!isRecord(value)) return false;
  if (!Object.keys(value).every(
    key => key === "zones" ||
      key === "maxCopiesPerCanonical" ||
      key === "maxCopiesByCanonical"
  )) {
    return false;
  }
  if (!uniqueZones(value.zones)) return false;
  if (value.maxCopiesPerCanonical !== undefined &&
      !isPositiveSafeInteger(value.maxCopiesPerCanonical)) {
    return false;
  }
  if (value.maxCopiesByCanonical !== undefined) {
    if (!isRecord(value.maxCopiesByCanonical)) return false;
    for (const [canonicalCardId, limit] of Object.entries(value.maxCopiesByCanonical)) {
      if (!nonEmptyString(canonicalCardId) || !isPositiveSafeInteger(limit)) {
        return false;
      }
    }
  }
  return true;
}

function isSizeGroup(value: unknown): value is DeckSizeGroup {
  return isRecord(value) &&
    Object.keys(value).length === 2 &&
    uniqueZones(value.zones) &&
    isSizeRule(value.rule);
}

function areRulesValid(rules: DeckValidationRules): boolean {
  if (!isRecord(rules)) return false;
  const allowedKeys = new Set([
    "defaultMaxCopiesPerCanonical",
    "cardPolicies",
    "copyRules",
    "sizeRules",
    "sizeGroups",
    "uniqueCanonicalZones",
    "totalCards"
  ]);
  if (!Object.keys(rules).every(key => allowedKeys.has(key))) return false;

  if (rules.defaultMaxCopiesPerCanonical !== undefined &&
      !isPositiveSafeInteger(rules.defaultMaxCopiesPerCanonical)) {
    return false;
  }
  if (rules.totalCards !== undefined && !isSizeRule(rules.totalCards)) {
    return false;
  }

  if (rules.cardPolicies !== undefined) {
    if (!isRecord(rules.cardPolicies)) return false;
    for (const [canonicalCardId, policy] of Object.entries(rules.cardPolicies)) {
      if (!nonEmptyString(canonicalCardId) || !isCardPolicy(policy)) return false;
    }
  }

  if (rules.copyRules !== undefined) {
    if (!Array.isArray(rules.copyRules) || !rules.copyRules.every(isCopyRule)) {
      return false;
    }
    const coveredZones = new Set<DeckZone>();
    for (const copyRule of rules.copyRules) {
      for (const zone of copyRule.zones) {
        if (coveredZones.has(zone)) return false;
        coveredZones.add(zone);
      }
    }
  }

  if (rules.sizeRules !== undefined) {
    if (!isRecord(rules.sizeRules)) return false;
    for (const [zone, sizeRule] of Object.entries(rules.sizeRules)) {
      if (!isDeckZone(zone) || !isSizeRule(sizeRule)) return false;
    }
  }

  if (rules.sizeGroups !== undefined &&
      (!Array.isArray(rules.sizeGroups) ||
        !rules.sizeGroups.every(isSizeGroup))) {
    return false;
  }
  if (rules.uniqueCanonicalZones !== undefined &&
      (!Array.isArray(rules.uniqueCanonicalZones) ||
        !rules.uniqueCanonicalZones.every(isDeckZone) ||
        new Set(rules.uniqueCanonicalZones).size !== rules.uniqueCanonicalZones.length)) {
    return false;
  }
  return true;
}

function isCardDefinition(value: unknown): value is DeckCardDefinition {
  if (!isRecord(value)) return false;
  if (!Object.keys(value).every(
    key => key === "id" ||
      key === "canonicalCardId" ||
      key === "name" ||
      key === "allowedZones"
  )) {
    return false;
  }
  if (!nonEmptyString(value.id) ||
      !nonEmptyString(value.canonicalCardId) ||
      !nonEmptyString(value.name)) {
    return false;
  }
  if (value.allowedZones !== undefined &&
      !(Array.isArray(value.allowedZones) &&
        value.allowedZones.every(isDeckZone) &&
        new Set(value.allowedZones).size === value.allowedZones.length)) {
    return false;
  }
  return true;
}

function issue(
  code: DeckValidationIssueCode,
  message: string,
  details: Omit<DeckValidationIssue, "code" | "message"> = {}
): DeckValidationIssue {
  return { code, message, ...details };
}

function emptyZoneCounts(): Record<DeckZone, number> {
  return {
    mainDeck: 0,
    runes: 0,
    legend: 0,
    champion: 0,
    battlefields: 0,
    sideboard: 0
  };
}

function invalidResult(issues: readonly DeckValidationIssue[]): DeckValidationResult {
  return {
    valid: false,
    overflow: false,
    totalCards: 0,
    zoneCounts: emptyZoneCounts(),
    canonicalCardCounts: {},
    issues
  };
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[]
): string[] {
  return Object.keys(value).filter(key => !allowed.includes(key));
}

function validateEntries(deck: DeckSubmission): readonly DeckValidationIssue[] {
  const issues: DeckValidationIssue[] = [];
  for (const zone of DECK_ZONES) {
    (deck[zone] ?? []).forEach((entry, entryIndex) => {
      if (!isRecord(entry)) {
        issues.push(issue(
          "invalid_entry",
          `Zone ${zone} entry ${entryIndex} must be an object.`,
          { zone, entryIndex }
        ));
        return;
      }

      const fields = unknownKeys(entry, ["cardId", "quantity"]);
      if (fields.length > 0) {
        issues.push(issue(
          "invalid_entry",
          `Zone ${zone} entry ${entryIndex} has unknown fields.`,
          { zone, entryIndex, unknownFields: fields }
        ));
        return;
      }

      if (!nonEmptyString(entry.cardId) || !isPositiveSafeInteger(entry.quantity)) {
        issues.push(issue(
          "invalid_entry",
          `Zone ${zone} entry ${entryIndex} must contain cardId and a positive quantity.`,
          { zone, entryIndex }
        ));
      }
    });
  }
  return issues;
}

function deckIssues(deck: DeckSubmission): readonly DeckValidationIssue[] {
  if (!isRecord(deck)) {
    return [issue("invalid_deck", "The deck must be an object.")];
  }

  const fields = unknownKeys(deck, DECK_ZONES);
  if (fields.length > 0) {
    return [issue(
      "invalid_deck",
      "The deck contains unknown keys.",
      { unknownFields: fields }
    )];
  }

  if (DECK_ZONES.every(zone => !Object.prototype.hasOwnProperty.call(deck, zone))) {
    return [issue("invalid_deck", "The deck must contain at least one zone.")];
  }

  const issues: DeckValidationIssue[] = [];
  for (const zone of DECK_ZONES) {
    const entries = deck[zone];
    if (entries !== undefined && !Array.isArray(entries)) {
      issues.push(issue(
        "invalid_deck",
        `Zone ${zone} must be an array.`,
        { zone }
      ));
    }
  }
  return issues;
}

function addSaturating(
  current: number,
  amount: number
): { value: number; overflow: boolean } {
  if (amount > Number.MAX_SAFE_INTEGER - current) {
    return { value: Number.MAX_SAFE_INTEGER, overflow: true };
  }
  return { value: current + amount, overflow: false };
}

function sizeMessage(count: number, rule: DeckSizeRule): string {
  if (rule.minimum !== undefined && rule.maximum !== undefined) {
    return `expected ${rule.minimum} to ${rule.maximum}`;
  }
  if (rule.minimum !== undefined) {
    return `expected at least ${rule.minimum}`;
  }
  return `expected at most ${rule.maximum}`;
}

function isOutOfRange(count: number, rule: DeckSizeRule): boolean {
  return count < (rule.minimum ?? 0) ||
    count > (rule.maximum ?? Number.POSITIVE_INFINITY);
}

export function validateDeck(
  deck: DeckSubmission,
  cards: readonly DeckCardDefinition[],
  rules: DeckValidationRules = {}
): DeckValidationResult {
  if (!areRulesValid(rules)) {
    return invalidResult([
      issue("invalid_rules", "The deck validation rules are invalid.")
    ]);
  }

  const cardById = new Map<string, DeckCardDefinition>();
  for (const card of cards) {
    if (!isCardDefinition(card) || cardById.has(card.id)) {
      return invalidResult([
        issue("invalid_card_catalog", "The card catalog is invalid.")
      ]);
    }
    cardById.set(card.id, card);
  }

  const structuralIssues = deckIssues(deck);
  if (structuralIssues.length > 0) {
    return invalidResult(structuralIssues);
  }

  const entryIssues = validateEntries(deck);
  if (entryIssues.length > 0) {
    return invalidResult(entryIssues);
  }

  const issues: DeckValidationIssue[] = [];
  const zoneCounts = emptyZoneCounts();
  const canonicalCardCounts: Record<string, number> = {};
  const canonicalNames = new Map<string, string>();
  const unknownCardIds = new Set<string>();
  const invalidZoneCards = new Set<string>();
  const zoneCanonicalIds: Record<DeckZone, Set<string>> = {
    mainDeck: new Set(),
    runes: new Set(),
    legend: new Set(),
    champion: new Set(),
    battlefields: new Set(),
    sideboard: new Set()
  };
  let totalCards = 0;
  let overflow = false;

  for (const zone of DECK_ZONES) {
    for (const entry of deck[zone] ?? []) {
      const totalAddition = addSaturating(totalCards, entry.quantity);
      const zoneAddition = addSaturating(zoneCounts[zone], entry.quantity);
      totalCards = totalAddition.value;
      zoneCounts[zone] = zoneAddition.value;
      overflow ||= totalAddition.overflow || zoneAddition.overflow;

      const card = cardById.get(entry.cardId);
      if (card === undefined) {
        if (!unknownCardIds.has(entry.cardId)) {
          unknownCardIds.add(entry.cardId);
          issues.push(issue(
            "unknown_card",
            `Card ${entry.cardId} is not present in the card catalog.`,
            { cardId: entry.cardId, zone }
          ));
        }
        continue;
      }

      const canonicalAddition = addSaturating(
        canonicalCardCounts[card.canonicalCardId] ?? 0,
        entry.quantity
      );
      canonicalCardCounts[card.canonicalCardId] = canonicalAddition.value;
      overflow ||= canonicalAddition.overflow;
      if (!canonicalNames.has(card.canonicalCardId)) {
        canonicalNames.set(card.canonicalCardId, card.name);
      }
      zoneCanonicalIds[zone].add(card.canonicalCardId);

      const invalidZoneKey = `${zone}:${card.id}`;
      if (card.allowedZones !== undefined &&
          !card.allowedZones.includes(zone) &&
          !invalidZoneCards.has(invalidZoneKey)) {
        invalidZoneCards.add(invalidZoneKey);
        issues.push(issue(
          "card_not_allowed_in_zone",
          `Card ${card.name} is not allowed in zone ${zone}.`,
          { cardId: card.id, canonicalCardId: card.canonicalCardId, zone }
        ));
      }
    }
  }

  if (overflow) {
    issues.push(issue(
      "count_overflow",
      "Deck counts exceed the safe integer limit."
    ));
    return {
      valid: false,
      overflow: true,
      totalCards,
      zoneCounts,
      canonicalCardCounts,
      issues
    };
  }

  const defaultLimit =
    rules.defaultMaxCopiesPerCanonical ?? DEFAULT_MAX_COPIES_PER_CANONICAL;
  const copyRules: readonly DeckCopyRule[] = rules.copyRules ?? [
    { zones: DEFAULT_COPY_LIMIT_ZONES }
  ];

  const bannedCanonicalIds = new Set<string>();
  for (const canonicalCardId of Object.keys(canonicalCardCounts).sort()) {
    const policy = rules.cardPolicies?.[canonicalCardId];
    if (policy?.type !== "banned") continue;

    bannedCanonicalIds.add(canonicalCardId);
    issues.push(issue(
      "banned_card",
      `Card ${canonicalNames.get(canonicalCardId) ?? canonicalCardId} is banned by the deck rules.`,
      { canonicalCardId }
    ));
  }

  for (const [copyRuleIndex, copyRule] of copyRules.entries()) {
    const groupCounts = new Map<string, number>();
    const groupCards = new Map<string, DeckCardDefinition>();

    for (const zone of copyRule.zones) {
      for (const entry of deck[zone] ?? []) {
        const card = cardById.get(entry.cardId);
        if (card === undefined) continue;
        groupCounts.set(
          card.canonicalCardId,
          (groupCounts.get(card.canonicalCardId) ?? 0) + entry.quantity
        );
        if (!groupCards.has(card.canonicalCardId)) {
          groupCards.set(card.canonicalCardId, card);
        }
      }
    }

    for (const canonicalCardId of [...groupCounts.keys()].sort()) {
      const count = groupCounts.get(canonicalCardId) ?? 0;
      const card = groupCards.get(canonicalCardId);
      const displayName = card?.name ?? canonicalCardId;
      const configuredLimit = copyRule.maxCopiesByCanonical?.[canonicalCardId] ??
        copyRule.maxCopiesPerCanonical ??
        defaultLimit;
      if (bannedCanonicalIds.has(canonicalCardId)) continue;

      const policy = rules.cardPolicies?.[canonicalCardId];

      const limit = policy === undefined
        ? configuredLimit
        : policy.type === "restricted"
          ? 1
          : policy.type === "limited"
            ? Math.min(policy.maxCopies, configuredLimit)
            : configuredLimit;

      if (count > limit) {
        issues.push(issue(
          "copy_limit_exceeded",
          `Card ${displayName} appears ${count} times; the limit is ${limit}.`,
          { canonicalCardId, copyRuleIndex }
        ));
      }
    }
  }

  for (const zone of DECK_ZONES) {
    const sizeRule = rules.sizeRules?.[zone];
    if (sizeRule !== undefined && isOutOfRange(zoneCounts[zone], sizeRule)) {
      issues.push(issue(
        "zone_size_out_of_range",
        `Zone ${zone} has ${zoneCounts[zone]} cards; ${sizeMessage(zoneCounts[zone], sizeRule)}.`,
        { zone }
      ));
    }
  }

  for (const zone of rules.uniqueCanonicalZones ?? []) {
    if (zoneCounts[zone] !== zoneCanonicalIds[zone].size) {
      issues.push(issue(
        "zone_uniqueness_violated",
        `Zone ${zone} requires every card to have a distinct server-owned canonical identity.`,
        { zone }
      ));
    }
  }

  for (const group of rules.sizeGroups ?? []) {
    const count = group.zones.reduce((sum, zone) => sum + zoneCounts[zone], 0);
    if (isOutOfRange(count, group.rule)) {
      issues.push(issue(
        "deck_size_out_of_range",
        `Deck group has ${count} cards; ${sizeMessage(count, group.rule)}.`,
        { zones: group.zones }
      ));
    }
  }

  if (rules.totalCards !== undefined && isOutOfRange(totalCards, rules.totalCards)) {
    issues.push(issue(
      "deck_size_out_of_range",
      `Deck has ${totalCards} cards; ${sizeMessage(totalCards, rules.totalCards)}.`
    ));
  }

  return {
    valid: issues.length === 0,
    overflow: false,
    totalCards,
    zoneCounts,
    canonicalCardCounts,
    issues
  };
}

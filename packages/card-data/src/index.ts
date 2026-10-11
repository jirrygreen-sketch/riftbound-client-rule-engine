import { createHash } from "node:crypto";

export type CardDefinitionId = string;
export type CollectionId = string;
export type CardDataVersion = string;
export type CardDataDigest = `sha256:${string}`;
export type CardCode = string;
export type CardImage = string;
export type OfficialCardId = string;
export type SetCode = string;
export type CollectorNumber = string;
export type RulesIdentityKey = string;
export type CanonicalCardId = string;

export type PrintingKind =
  | "normal"
  | "alternate-art"
  | "uncertain";

export type IdentitySource =
  | "rulesIdentityKey"
  | "canonicalCardId"
  | "officialCardId"
  | "explicitMap"
  | "unknown";

export type IdentityScope =
  | "official-id"
  | "official-rule"
  | "explicit-map"
  | "set-collector-number"
  | "candidate-printed-number"
  | "candidate-full-name"
  | "printing-only"
  | "unknown";

export type IdentityConfidence =
  | "explicit"
  | "derived"
  | "uncertain";

export type CardType =
  | "battlefield"
  | "gear"
  | "legend"
  | "rune"
  | "spell"
  | "token"
  | "unit";

export interface CardCost {
  energy: number;
  power: number;
}

export interface CardDefinition {
  id: CardDefinitionId;
  collectionId: CollectionId;
  name: string;
  cardType: CardType;
  cost: CardCost;
  tags: readonly string[];
  cardCode?: CardCode;
  cardImage?: CardImage;
  setCode?: SetCode;
  collectorNumber?: CollectorNumber;
  officialCardId?: OfficialCardId;
  canonicalCardId?: CanonicalCardId;
  rulesIdentityKey?: RulesIdentityKey;
  printingKind?: PrintingKind;
  variantKey?: string;
  identitySource?: IdentitySource;
  identityConfidence?: IdentityConfidence;
  identityScope?: IdentityScope;
}

export interface CardPrinting extends CardDefinition {
  cardCode: CardCode;
  cardImage: CardImage;
}

export interface CardPrintingIdentity {
  canonicalCardId: CanonicalCardId;
  rulesIdentityKey: RulesIdentityKey;
  officialCardId: OfficialCardId | null;
  identitySource: IdentitySource;
  identityConfidence: IdentityConfidence;
  identityScope: IdentityScope;
  printingKind: PrintingKind;
  variantKey: string;
}

export interface CardIdentityGroup {
  canonicalCardId: CanonicalCardId;
  rulesIdentityKey: RulesIdentityKey;
  identitySource: IdentitySource;
  identityConfidence: IdentityConfidence;
  identityScope: IdentityScope;
  ruleFieldsMatch: boolean;
  printings: readonly CardPrinting[];
}

export interface CardPrintingSelection {
  cardCode?: CardCode;
  printingKind?: PrintingKind;
}

export interface CardPrintingGroupResult {
  groups: readonly CardIdentityGroup[];
  issues: readonly string[];
}

export interface CardDataSetContent {
  schemaVersion: 1;
  collectionId: CollectionId;
  dataVersion: CardDataVersion;
  cards: readonly CardDefinition[];
}

export interface CardDataSet extends CardDataSetContent {
  digest: CardDataDigest;
}

export interface CardDataManifest {
  schemaVersion: 1;
  collectionId: CollectionId;
  dataVersion: CardDataVersion;
  cardCount: number;
  digest: CardDataDigest;
}

export interface CardDataBundle {
  dataSet: CardDataSet;
  manifest: CardDataManifest;
}

export interface CardDataRegistry {
  schemaVersion: 1;
  dataSets: readonly CardDataSet[];
}

export interface DeckCardEntry {
  cardId: CardDefinitionId;
  quantity: number;
}

export interface DeckList {
  collectionId: CollectionId;
  dataVersion: CardDataVersion;
  entries: readonly DeckCardEntry[];
}

export interface DeckValidationOptions {
  minimumSize?: number;
  maximumSize?: number;
  maxCopiesPerCard?: number;
  requiredTags?: readonly string[];
  allowedCardTypes?: readonly CardType[];
}

export type DeckValidationIssueCode =
  | "allowed_card_type"
  | "collection_mismatch"
  | "data_version_mismatch"
  | "deck_too_large"
  | "deck_too_small"
  | "invalid_data_set"
  | "invalid_deck"
  | "invalid_options"
  | "missing_required_tag"
  | "too_many_copies"
  | "unknown_card";

export interface DeckValidationIssue {
  code: DeckValidationIssueCode;
  message: string;
  cardId?: CardDefinitionId;
}

export interface DeckValidationResult {
  valid: boolean;
  totalCards: number;
  issues: readonly DeckValidationIssue[];
}

export const CARD_DATA_SCHEMA_VERSION = 1 as const;
export const SYNTHETIC_DEMO_COLLECTION_ID = "collection.synthetic-demo";
export const SYNTHETIC_DEMO_DATA_VERSION =
  "2026-10-11-synthetic-demo.1";

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const DATA_VERSION_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[.-][a-z0-9]+)*$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CARD_TYPES = [
  "battlefield",
  "gear",
  "legend",
  "rune",
  "spell",
  "token",
  "unit"
] as const satisfies readonly CardType[];

type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const allowed = new Set(keys);
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum;
}

function isStableId(value: unknown): value is string {
  return isText(value, 128) && STABLE_ID_PATTERN.test(value);
}

function isCardDataVersion(value: unknown): value is CardDataVersion {
  return isText(value, 128) && DATA_VERSION_PATTERN.test(value);
}

function isCardDataDigest(value: unknown): value is CardDataDigest {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isCardType(value: unknown): value is CardType {
  return typeof value === "string" &&
    (CARD_TYPES as readonly string[]).includes(value);
}

function isPrintingKind(value: unknown): value is PrintingKind {
  return typeof value === "string" &&
    (["normal", "alternate-art", "uncertain"] as readonly string[])
      .includes(value);
}

function isIdentitySource(value: unknown): value is IdentitySource {
  return typeof value === "string" &&
    ([
      "rulesIdentityKey",
      "canonicalCardId",
      "officialCardId",
      "explicitMap",
      "unknown"
    ] as readonly string[]).includes(value);
}

function isIdentityScope(value: unknown): value is IdentityScope {
  return typeof value === "string" &&
    ([
      "official-id",
      "official-rule",
      "explicit-map",
      "set-collector-number",
      "candidate-printed-number",
      "candidate-full-name",
      "printing-only",
      "unknown"
    ] as readonly string[]).includes(value);
}

function isIdentityConfidence(value: unknown): value is IdentityConfidence {
  return typeof value === "string" &&
    (["explicit", "derived", "uncertain"] as readonly string[])
      .includes(value);
}

function isStringArray(
  value: unknown,
  predicate: (item: unknown) => item is string,
  minimumLength = 0
): value is readonly string[] {
  if (!Array.isArray(value) || value.length < minimumLength) return false;

  const seen = new Set<string>();
  for (const item of value) {
    if (!predicate(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function copyCardDefinition(card: CardDefinition): CardDefinition {
  const copy: CardDefinition = {
    id: card.id,
    collectionId: card.collectionId,
    name: card.name,
    cardType: card.cardType,
    cost: {
      energy: card.cost.energy,
      power: card.cost.power
    },
    tags: [...card.tags]
  };

  if (card.cardCode !== undefined) copy.cardCode = card.cardCode;
  if (card.cardImage !== undefined) copy.cardImage = card.cardImage;
  if (card.setCode !== undefined) copy.setCode = card.setCode;
  if (card.collectorNumber !== undefined) {
    copy.collectorNumber = card.collectorNumber;
  }
  if (card.officialCardId !== undefined) {
    copy.officialCardId = card.officialCardId;
  }
  if (card.canonicalCardId !== undefined) {
    copy.canonicalCardId = card.canonicalCardId;
  }
  if (card.rulesIdentityKey !== undefined) {
    copy.rulesIdentityKey = card.rulesIdentityKey;
  }
  if (card.printingKind !== undefined) copy.printingKind = card.printingKind;
  if (card.variantKey !== undefined) copy.variantKey = card.variantKey;
  if (card.identitySource !== undefined) {
    copy.identitySource = card.identitySource;
  }
  if (card.identityConfidence !== undefined) {
    copy.identityConfidence = card.identityConfidence;
  }
  if (card.identityScope !== undefined) {
    copy.identityScope = card.identityScope;
  }
  return copy;
}

function canonicalJson(value: CanonicalValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value as readonly CanonicalValue[];
    return `[${items.map(canonicalJson).join(",")}]`;
  }

  const objectValue = value as { readonly [key: string]: CanonicalValue };
  const entries = Object.keys(objectValue)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key]!)}`);
  return `{${entries.join(",")}}`;
}

function canonicalizeValidatedCardDataSet(
  dataSet: CardDataSetContent
): string {
  const cards = [...dataSet.cards]
    .sort((left, right) => compareStrings(left.id, right.id))
    .map((card) => {
      const normalized: { [key: string]: CanonicalValue } = {
        id: card.id,
        collectionId: card.collectionId,
        name: card.name,
        cardType: card.cardType,
        cost: {
          energy: card.cost.energy,
          power: card.cost.power
        },
        tags: [...card.tags].sort(compareStrings)
      };

      if (card.cardCode !== undefined) normalized.cardCode = card.cardCode;
      if (card.cardImage !== undefined) normalized.cardImage = card.cardImage;
      if (card.setCode !== undefined) normalized.setCode = card.setCode;
      if (card.collectorNumber !== undefined) {
        normalized.collectorNumber = card.collectorNumber;
      }
      if (card.officialCardId !== undefined) {
        normalized.officialCardId = card.officialCardId;
      }
      if (card.canonicalCardId !== undefined) {
        normalized.canonicalCardId = card.canonicalCardId;
      }
      if (card.rulesIdentityKey !== undefined) {
        normalized.rulesIdentityKey = card.rulesIdentityKey;
      }
      if (card.printingKind !== undefined) {
        normalized.printingKind = card.printingKind;
      }
      if (card.variantKey !== undefined) normalized.variantKey = card.variantKey;
      if (card.identitySource !== undefined) {
        normalized.identitySource = card.identitySource;
      }
      if (card.identityConfidence !== undefined) {
        normalized.identityConfidence = card.identityConfidence;
      }
      if (card.identityScope !== undefined) {
        normalized.identityScope = card.identityScope;
      }
      return normalized;
    });

  return canonicalJson({
    schemaVersion: dataSet.schemaVersion,
    collectionId: dataSet.collectionId,
    dataVersion: dataSet.dataVersion,
    cards
  });
}

export class CardDataValidationError extends Error {
  readonly issues: readonly string[];

  constructor(scope: string, issues: readonly string[]) {
    super(`${scope}: ${issues.join("; ")}`);
    this.name = "CardDataValidationError";
    this.issues = [...issues];
  }
}

export function isCardCost(value: unknown): value is CardCost {
  return record(value) &&
    hasExactKeys(value, ["energy", "power"]) &&
    isSafeInteger(value.energy, 0, 999) &&
    isSafeInteger(value.power, 0, 999);
}

export function isCardDefinition(value: unknown): value is CardDefinition {
  return record(value) &&
    hasOnlyKeys(value, [
      "id",
      "collectionId",
      "name",
      "cardType",
      "cost",
      "tags",
      "cardCode",
      "cardImage",
      "setCode",
      "collectorNumber",
      "officialCardId",
      "canonicalCardId",
      "rulesIdentityKey",
      "printingKind",
      "variantKey",
      "identitySource",
      "identityConfidence",
      "identityScope"
    ]) &&
    isStableId(value.id) &&
    isStableId(value.collectionId) &&
    isText(value.name, 160) &&
    isCardType(value.cardType) &&
    isCardCost(value.cost) &&
    isStringArray(value.tags, isStableId, 1) &&
    (value.cardCode === undefined || isText(value.cardCode, 128)) &&
    (value.cardImage === undefined || isText(value.cardImage, 2048)) &&
    (value.setCode === undefined || isText(value.setCode, 32)) &&
    (value.collectorNumber === undefined || isText(value.collectorNumber, 64)) &&
    (value.officialCardId === undefined || isText(value.officialCardId, 128)) &&
    (value.canonicalCardId === undefined || isStableId(value.canonicalCardId)) &&
    (value.rulesIdentityKey === undefined || isStableId(value.rulesIdentityKey)) &&
    (value.printingKind === undefined || isPrintingKind(value.printingKind)) &&
    (value.variantKey === undefined || isText(value.variantKey, 256)) &&
    (value.identitySource === undefined || isIdentitySource(value.identitySource)) &&
    (value.identityConfidence === undefined || isIdentityConfidence(value.identityConfidence)) &&
    (value.identityScope === undefined || isIdentityScope(value.identityScope));
}

export function isCardDataSetContent(
  value: unknown
): value is CardDataSetContent {
  if (!record(value) ||
      !hasOnlyKeys(value, [
        "schemaVersion",
        "collectionId",
        "dataVersion",
        "cards",
        "digest"
      ]) ||
      value.schemaVersion !== CARD_DATA_SCHEMA_VERSION ||
      !isStableId(value.collectionId) ||
      !isCardDataVersion(value.dataVersion) ||
      !Array.isArray(value.cards) ||
      value.cards.length === 0 ||
      (value.digest !== undefined && !isCardDataDigest(value.digest))) {
    return false;
  }

  const cardIds = new Set<string>();
  for (const card of value.cards) {
    if (!isCardDefinition(card) ||
        card.collectionId !== value.collectionId ||
        cardIds.has(card.id)) {
      return false;
    }
    cardIds.add(card.id);
  }
  return true;
}

export function canonicalizeCardDataSet(
  dataSet: CardDataSetContent
): string {
  if (!isCardDataSetContent(dataSet)) {
    throw new CardDataValidationError("card data set", [
      "the data set content is not valid"
    ]);
  }
  return canonicalizeValidatedCardDataSet(dataSet);
}

export function computeCardDataSetDigest(
  dataSet: CardDataSetContent
): CardDataDigest {
  const canonical = canonicalizeCardDataSet(dataSet);
  const hex = createHash("sha256").update(canonical, "utf8").digest("hex");
  return `sha256:${hex}`;
}

export function createCardDataSet(
  content: CardDataSetContent
): CardDataSet {
  if (!isCardDataSetContent(content)) {
    throw new CardDataValidationError("card data set", [
      "the data set content is not valid"
    ]);
  }

  return {
    schemaVersion: CARD_DATA_SCHEMA_VERSION,
    collectionId: content.collectionId,
    dataVersion: content.dataVersion,
    cards: content.cards.map(copyCardDefinition),
    digest: computeCardDataSetDigest(content)
  };
}

export function isCardDataSet(value: unknown): value is CardDataSet {
  if (!record(value) ||
      !hasExactKeys(value, [
        "schemaVersion",
        "collectionId",
        "dataVersion",
        "cards",
        "digest"
      ]) ||
      !isCardDataDigest(value.digest)) {
    return false;
  }

  const content = {
    schemaVersion: value.schemaVersion,
    collectionId: value.collectionId,
    dataVersion: value.dataVersion,
    cards: value.cards
  };
  return isCardDataSetContent(content) &&
    value.digest === computeCardDataSetDigest(content);
}

export function assertCardDataSet(
  value: unknown
): asserts value is CardDataSet {
  if (!isCardDataSet(value)) {
    throw new CardDataValidationError("card data set", [
      "shape, unique card ids, or digest verification failed"
    ]);
  }
}

export function isCardDataManifest(
  value: unknown
): value is CardDataManifest {
  return record(value) &&
    hasExactKeys(value, [
      "schemaVersion",
      "collectionId",
      "dataVersion",
      "cardCount",
      "digest"
    ]) &&
    value.schemaVersion === CARD_DATA_SCHEMA_VERSION &&
    isStableId(value.collectionId) &&
    isCardDataVersion(value.dataVersion) &&
    isSafeInteger(value.cardCount, 1) &&
    isCardDataDigest(value.digest);
}

export function createCardDataManifest(
  dataSet: CardDataSet
): CardDataManifest {
  assertCardDataSet(dataSet);
  return {
    schemaVersion: CARD_DATA_SCHEMA_VERSION,
    collectionId: dataSet.collectionId,
    dataVersion: dataSet.dataVersion,
    cardCount: dataSet.cards.length,
    digest: dataSet.digest
  };
}

export function isCardDataBundle(value: unknown): value is CardDataBundle {
  if (!record(value) ||
      !hasExactKeys(value, ["dataSet", "manifest"]) ||
      !isCardDataSet(value.dataSet) ||
      !isCardDataManifest(value.manifest)) {
    return false;
  }

  return value.manifest.collectionId === value.dataSet.collectionId &&
    value.manifest.dataVersion === value.dataSet.dataVersion &&
    value.manifest.cardCount === value.dataSet.cards.length &&
    value.manifest.digest === value.dataSet.digest;
}

export function createCardDataBundle(
  content: CardDataSetContent
): CardDataBundle {
  const dataSet = createCardDataSet(content);
  return {
    dataSet,
    manifest: createCardDataManifest(dataSet)
  };
}

export function isCardDataRegistry(
  value: unknown
): value is CardDataRegistry {
  if (!record(value) ||
      !hasExactKeys(value, ["schemaVersion", "dataSets"]) ||
      value.schemaVersion !== CARD_DATA_SCHEMA_VERSION ||
      !Array.isArray(value.dataSets)) {
    return false;
  }

  const dataVersions = new Set<string>();
  for (const dataSet of value.dataSets) {
    if (!isCardDataSet(dataSet) || dataVersions.has(dataSet.dataVersion)) {
      return false;
    }
    dataVersions.add(dataSet.dataVersion);
  }
  return true;
}

export function createCardDataRegistry(
  dataSets: readonly CardDataSet[]
): CardDataRegistry {
  const issues: string[] = [];
  const dataVersions = new Set<string>();

  dataSets.forEach((dataSet, index) => {
    if (!isCardDataSet(dataSet)) {
      issues.push(`dataSets[${index}] is not a valid card data set`);
      return;
    }
    if (dataVersions.has(dataSet.dataVersion)) {
      issues.push(`duplicate dataVersion: ${dataSet.dataVersion}`);
      return;
    }
    dataVersions.add(dataSet.dataVersion);
  });

  if (issues.length > 0) {
    throw new CardDataValidationError("card data registry", issues);
  }

  return {
    schemaVersion: CARD_DATA_SCHEMA_VERSION,
    dataSets: [...dataSets]
  };
}

export function getCardDefinition(
  dataSet: CardDataSet,
  cardId: CardDefinitionId
): CardDefinition | undefined {
  return dataSet.cards.find((card) => card.id === cardId);
}

export function isDeckCardEntry(value: unknown): value is DeckCardEntry {
  return record(value) &&
    hasExactKeys(value, ["cardId", "quantity"]) &&
    isStableId(value.cardId) &&
    isSafeInteger(value.quantity, 1, 999);
}

export function isDeckList(value: unknown): value is DeckList {
  if (!record(value) ||
      !hasExactKeys(value, [
        "collectionId",
        "dataVersion",
        "entries"
      ]) ||
      !isStableId(value.collectionId) ||
      !isCardDataVersion(value.dataVersion) ||
      !Array.isArray(value.entries)) {
    return false;
  }

  const cardIds = new Set<string>();
  for (const entry of value.entries) {
    if (!isDeckCardEntry(entry) || cardIds.has(entry.cardId)) {
      return false;
    }
    cardIds.add(entry.cardId);
  }
  return true;
}

function isDeckValidationOptions(
  value: unknown
): value is DeckValidationOptions {
  if (!record(value) || !hasOnlyKeys(value, [
    "minimumSize",
    "maximumSize",
    "maxCopiesPerCard",
    "requiredTags",
    "allowedCardTypes"
  ])) {
    return false;
  }

  if (value.minimumSize !== undefined &&
      !isSafeInteger(value.minimumSize, 0, 999)) {
    return false;
  }
  if (value.maximumSize !== undefined &&
      !isSafeInteger(value.maximumSize, 0, 999)) {
    return false;
  }
  if (value.maxCopiesPerCard !== undefined &&
      !isSafeInteger(value.maxCopiesPerCard, 1, 999)) {
    return false;
  }
  if (value.requiredTags !== undefined &&
      !isStringArray(value.requiredTags, isStableId)) {
    return false;
  }
  if (value.allowedCardTypes !== undefined &&
      !Array.isArray(value.allowedCardTypes)) {
    return false;
  }
  if (value.allowedCardTypes !== undefined) {
    const seen = new Set<string>();
    for (const cardType of value.allowedCardTypes) {
      if (!isCardType(cardType) || seen.has(cardType)) return false;
      seen.add(cardType);
    }
  }
  return true;
}

function issue(
  code: DeckValidationIssueCode,
  message: string,
  cardId?: CardDefinitionId
): DeckValidationIssue {
  return cardId === undefined
    ? { code, message }
    : { code, message, cardId };
}

export function validateDeck(
  dataSet: CardDataSet,
  deck: unknown,
  options: DeckValidationOptions = {}
): DeckValidationResult {
  const issues: DeckValidationIssue[] = [];

  if (!isCardDataSet(dataSet)) {
    return {
      valid: false,
      totalCards: 0,
      issues: [
        issue("invalid_data_set", "The card data set is not valid.")
      ]
    };
  }

  if (!isDeckValidationOptions(options)) {
    return {
      valid: false,
      totalCards: 0,
      issues: [issue("invalid_options", "The deck validation options are invalid.")]
    };
  }

  if (!isDeckList(deck)) {
    return {
      valid: false,
      totalCards: 0,
      issues: [issue("invalid_deck", "The deck list shape is invalid.")]
    };
  }

  if (deck.collectionId !== dataSet.collectionId) {
    issues.push(issue(
      "collection_mismatch",
      `Deck collection ${deck.collectionId} does not match ${dataSet.collectionId}.`
    ));
  }
  if (deck.dataVersion !== dataSet.dataVersion) {
    issues.push(issue(
      "data_version_mismatch",
      `Deck data version ${deck.dataVersion} does not match ${dataSet.dataVersion}.`
    ));
  }

  let totalCards = 0;
  for (const entry of deck.entries) {
    totalCards += entry.quantity;
    const card = getCardDefinition(dataSet, entry.cardId);
    if (card === undefined) {
      issues.push(issue(
        "unknown_card",
        `Card ${entry.cardId} is not present in the selected data set.`,
        entry.cardId
      ));
      continue;
    }

    if (options.maxCopiesPerCard !== undefined &&
        entry.quantity > options.maxCopiesPerCard) {
      issues.push(issue(
        "too_many_copies",
        `Card ${entry.cardId} exceeds the configured copy limit.`,
        entry.cardId
      ));
    }

    if (options.requiredTags !== undefined) {
      for (const tag of options.requiredTags) {
        if (!card.tags.includes(tag)) {
          issues.push(issue(
            "missing_required_tag",
            `Card ${entry.cardId} is missing required tag ${tag}.`,
            entry.cardId
          ));
        }
      }
    }

    if (options.allowedCardTypes !== undefined &&
        !options.allowedCardTypes.includes(card.cardType)) {
      issues.push(issue(
        "allowed_card_type",
        `Card ${entry.cardId} has disallowed type ${card.cardType}.`,
        entry.cardId
      ));
    }
  }

  if (options.minimumSize !== undefined && totalCards < options.minimumSize) {
    issues.push(issue(
      "deck_too_small",
      `Deck has ${totalCards} cards; minimum is ${options.minimumSize}.`
    ));
  }
  if (options.maximumSize !== undefined && totalCards > options.maximumSize) {
    issues.push(issue(
      "deck_too_large",
      `Deck has ${totalCards} cards; maximum is ${options.maximumSize}.`
    ));
  }

  return {
    valid: issues.length === 0,
    totalCards,
    issues
  };
}

export const TRIGGER_CONQUER_CARD: CardDefinition = {
  id: "card.trigger-conquer",
  collectionId: SYNTHETIC_DEMO_COLLECTION_ID,
  name: "Trigger Conquer",
  cardType: "spell",
  cost: {
    energy: 1,
    power: 0
  },
  tags: ["synthetic-demo", "trigger"]
};

export const SYNTHETIC_DEMO_DATA_SET: CardDataSet = createCardDataSet({
  schemaVersion: CARD_DATA_SCHEMA_VERSION,
  collectionId: SYNTHETIC_DEMO_COLLECTION_ID,
  dataVersion: SYNTHETIC_DEMO_DATA_VERSION,
  cards: [TRIGGER_CONQUER_CARD]
});

export const SYNTHETIC_DEMO_MANIFEST: CardDataManifest =
  createCardDataManifest(SYNTHETIC_DEMO_DATA_SET);

export const SYNTHETIC_DEMO_BUNDLE: CardDataBundle = {
  dataSet: SYNTHETIC_DEMO_DATA_SET,
  manifest: SYNTHETIC_DEMO_MANIFEST
};

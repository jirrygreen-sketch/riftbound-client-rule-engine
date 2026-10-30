import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type DeckSubmission,
  type DeckCardDefinition,
  type DeckZone,
  type DeckValidationRules
} from "./deck-validation.js";
import {
  createConstructedRules,
  getConstructedCardPolicy,
  getConstructedPrintingPolicy,
  validateConstructedDeck,
  type ConstructedRules,
  type ConstructedRulesOptions,
  type ConstructedValidationResult
} from "./constructed-policy.js";

export type CardVariant = "standard" | "alternate" | "unknown";

export type LocalizedAbilityLanguage = "zh-CN" | "en-US";

export type LocalizedAbilityStatus =
  | "official-structured"
  | "official-accessibility-supplemented"
  | "official-structured-sibling"
  | "english-fallback"
  | "no-effect"
  | "missing";

export interface LocalizedAbilitySource {
  readonly url: string;
  readonly locale: "zh-CN";
  readonly updatedAt: string;
  readonly syncedAt: string;
}

export interface CatalogCard {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly name: string;
  readonly subtitle?: string;
  readonly fullName: string;
  readonly localizedName?: string;
  readonly localizedSubtitle?: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly setCode: string;
  readonly cardNumber: string;
  readonly variant: CardVariant;
  readonly imageUrl: string | null;
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
  readonly ability: string;
  readonly localizedAbilityRulesText?: string;
  readonly localizedAbilityEffectText?: string;
  readonly localizedAbilityLanguage?: LocalizedAbilityLanguage;
  readonly localizedAbilityStatus?: LocalizedAbilityStatus;
  readonly localizedAbilitySource?: LocalizedAbilitySource;
  /** The same-canonical printing whose official zh-CN fields supplied this projection. */
  readonly localizedFromPrintingId?: string;
}

export interface PublicCatalogCard extends CatalogCard {
  readonly allowedZones: readonly DeckZone[];
  readonly maxCopies: number;
  readonly banned: boolean;
  readonly available: boolean;
  readonly availabilityReason: string;
}

export interface PublicCardCatalog {
  readonly schemaVersion: 1;
  readonly dataVersion: string;
  readonly digest: string;
  readonly cards: readonly PublicCatalogCard[];
  readonly policy: unknown;
  readonly groups?: readonly PublicCardGroup[];
}

export interface PublicCardGroup {
  readonly canonicalCardId: string;
  readonly primaryPrintingId: string;
  readonly printings: readonly string[];
  readonly identityProvenance?: string;
  readonly ruleReferences?: readonly string[];
  readonly fullName?: string;
}

export interface CardCatalogRuntime {
  readonly publicCatalog: PublicCardCatalog;
  readonly publicCatalogJson: string;
  readonly validationCards: readonly DeckCardDefinition[];
  readonly deckRules: DeckValidationRules;
  readonly constructedRules: ConstructedRules;
  readonly imagesDirectory: string;
  readonly imageManifest: ReadonlyMap<string, ImageManifestEntry>;
}

export interface ImageManifestEntry {
  readonly id: string;
  readonly file: string;
  readonly contentType:
    | "image/avif"
    | "image/jpeg"
    | "image/png"
    | "image/webp";
  readonly bytes: number;
  readonly sha256: string;
}

export interface CardCatalogLoadOptions {
  readonly catalogPath?: string;
  readonly imagesDirectory?: string;
  readonly catalog?: unknown;
  readonly deckRules?: DeckValidationRules;
  readonly constructedPolicy?: ConstructedRulesOptions;
}

const DEFAULT_CATALOG_PATH = fileURLToPath(
  new URL("../../../packages/card-data/data/deck-catalog.json", import.meta.url)
);
const DEFAULT_IMAGES_DIRECTORY = fileURLToPath(
  new URL("../../../packages/card-data/data/images", import.meta.url)
);

const SAFE_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const CONTENT_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const IMAGE_EXTENSIONS = new Map([
  ["image/avif", "avif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

const UNIT_MAIN_DECK_ZONES = ["mainDeck", "sideboard"] as const;
const CHAMPION_ZONES = ["mainDeck", "champion", "sideboard"] as const;
const RUNE_ZONES = ["runes"] as const;
const LEGEND_ZONES = ["legend"] as const;
const BATTLEFIELD_ZONES = ["battlefields"] as const;
const NO_ZONES: readonly DeckZone[] = [];

interface CardCatalogRuntimeData {
  readonly publicCatalog: PublicCardCatalog;
  readonly validationCards: readonly DeckCardDefinition[];
  readonly constructedRules: ConstructedRules;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isAbilityText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" &&
    value.length <= maximumLength &&
    !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
}

function isSafeId(value: unknown): value is string {
  return isText(value, 128) && SAFE_ID_PATTERN.test(value);
}

function isNonnegativeInteger(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER
): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum;
}

function isHttpsUrl(value: unknown): value is string {
  if (!isText(value, 2048)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:" &&
    url.username === "" &&
    url.password === "";
}

function isUtcTimestamp(value: unknown): value is string {
  return isText(value, 64) &&
    UTC_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function isLocalizedAbilityLanguage(
  value: unknown
): value is LocalizedAbilityLanguage {
  return value === "zh-CN" || value === "en-US";
}

function isLocalizedAbilityStatus(value: unknown): value is LocalizedAbilityStatus {
  return value === "official-structured" ||
    value === "official-accessibility-supplemented" ||
    value === "official-structured-sibling" ||
    value === "english-fallback" ||
    value === "no-effect" ||
    value === "missing";
}

function isLocalizedAbilitySource(value: unknown): value is LocalizedAbilitySource {
  return isRecord(value) &&
    hasExactKeys(value, ["url", "locale", "updatedAt", "syncedAt"]) &&
    isHttpsUrl(value.url) &&
    value.locale === "zh-CN" &&
    isUtcTimestamp(value.updatedAt) &&
    isUtcTimestamp(value.syncedAt);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => isText(item, 128));
}

function isVariant(value: unknown): value is CardVariant {
  return value === "standard" || value === "alternate" || value === "unknown";
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || isNonnegativeInteger(value, 999);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value === "string") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function optionalText(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  return value[key] === undefined ? undefined : value[key] as string;
}

function isPublicCardGroup(
  value: unknown,
  cardsById: ReadonlyMap<string, CatalogCard>,
): PublicCardGroup | null {
  if (!isRecord(value) ||
      !hasRequiredKeys(value, [
        "canonicalCardId",
        "primaryPrintingId",
        "printings"
      ]) ||
      !hasOnlyKnownKeys(value, [
        "identityProvenance",
        "ruleReferences",
        "fullName"
      ]) ||
      !isSafeId(value.canonicalCardId) ||
      !isSafeId(value.primaryPrintingId) ||
      !Array.isArray(value.printings) ||
      !value.printings.every(item => isSafeId(item)) ||
      (value.identityProvenance !== undefined &&
        !isText(value.identityProvenance, 256)) ||
      (value.ruleReferences !== undefined &&
        !isStringArray(value.ruleReferences)) ||
      (value.fullName !== undefined && !isText(value.fullName, 256))) {
    return null;
  }

  const primaryPrinting = cardsById.get(value.primaryPrintingId);
  const groupFullName = value.fullName ?? primaryPrinting?.fullName;

  const printings = new Set(value.printings);
  if (printings.size !== value.printings.length ||
      !printings.has(value.primaryPrintingId) ||
      primaryPrinting === undefined ||
      groupFullName === undefined) {
    return null;
  }

  for (const printingId of printings) {
    const card = cardsById.get(printingId);
    if (card === undefined ||
        card.canonicalCardId !== value.canonicalCardId ||
        card.fullName !== groupFullName) {
      return null;
    }
  }

  return {
    canonicalCardId: value.canonicalCardId,
    primaryPrintingId: value.primaryPrintingId,
    printings: [...value.printings],
    ...(value.identityProvenance === undefined
      ? {}
      : { identityProvenance: value.identityProvenance }),
    ...(value.ruleReferences === undefined
      ? {}
      : { ruleReferences: [...value.ruleReferences] }),
    ...(value.fullName === undefined ? {} : { fullName: value.fullName })
  };
}

function isCatalogCard(value: unknown): value is CatalogCard {
  if (!isRecord(value)) return false;
  const requiredFields = [
    "id",
    "canonicalCardId",
    "name",
    "fullName",
    "cardType",
    "domains",
    "tags",
    "setCode",
    "cardNumber",
    "variant",
    "imageUrl",
    "energy",
    "power",
    "might",
    "ability"
  ] as const;
  const optionalFields = [
    "subtitle",
    "localizedName",
    "localizedSubtitle",
    "localizedAbilityRulesText",
    "localizedAbilityEffectText",
    "localizedAbilityLanguage",
    "localizedAbilityStatus",
    "localizedAbilitySource",
    "localizedFromPrintingId"
  ] as const;
  const knownFields = new Set<string>([...requiredFields, ...optionalFields]);
  if (!Object.keys(value).every(key => knownFields.has(key))) return false;

  for (const field of optionalFields) {
    if (field === "localizedAbilityRulesText" ||
        field === "localizedAbilityEffectText") {
      if (value[field] !== undefined && !isAbilityText(value[field], 4096)) return false;
    } else if (field === "localizedAbilityLanguage") {
      if (value[field] !== undefined && !isLocalizedAbilityLanguage(value[field])) {
        return false;
      }
    } else if (field === "localizedAbilityStatus") {
      if (value[field] !== undefined && !isLocalizedAbilityStatus(value[field])) {
        return false;
      }
    } else if (field === "localizedAbilitySource") {
      if (value[field] !== undefined && !isLocalizedAbilitySource(value[field])) {
        return false;
      }
    } else if (value[field] !== undefined && !isText(value[field], 512)) {
      return false;
    }
  }

  return isSafeId(value.id) &&
    isSafeId(value.canonicalCardId) &&
    isText(value.name, 256) &&
    isText(value.fullName, 512) &&
    isText(value.cardType, 64) &&
    isStringArray(value.domains) &&
    isStringArray(value.tags) &&
    isSafeId(value.setCode) &&
    isText(value.cardNumber, 64) &&
    isVariant(value.variant) &&
    (value.imageUrl === null || isHttpsUrl(value.imageUrl)) &&
    isNumberOrNull(value.energy) &&
    isNumberOrNull(value.power) &&
    isNumberOrNull(value.might) &&
    isAbilityText(value.ability, 4096);
}

function publicCard(
  card: CatalogCard,
  policy: Pick<
    PublicCatalogCard,
    "allowedZones" | "maxCopies" | "banned" | "available" | "availabilityReason"
  >
): PublicCatalogCard {
  return {
    id: card.id,
    canonicalCardId: card.canonicalCardId,
    name: card.name,
    ...(card.subtitle === undefined ? {} : { subtitle: card.subtitle }),
    fullName: card.fullName,
    ...(card.localizedName === undefined
      ? {}
      : { localizedName: card.localizedName }),
    ...(card.localizedSubtitle === undefined
      ? {}
      : { localizedSubtitle: card.localizedSubtitle }),
    cardType: card.cardType,
    domains: [...card.domains],
    tags: [...card.tags],
    setCode: card.setCode,
    cardNumber: card.cardNumber,
    variant: card.variant,
    imageUrl: card.imageUrl,
    energy: card.energy,
    power: card.power,
    might: card.might,
    ability: card.ability,
    ...(card.localizedAbilityRulesText === undefined
      ? {}
      : { localizedAbilityRulesText: card.localizedAbilityRulesText }),
    ...(card.localizedAbilityEffectText === undefined
      ? {}
      : { localizedAbilityEffectText: card.localizedAbilityEffectText }),
    ...(card.localizedAbilityLanguage === undefined
      ? {}
      : { localizedAbilityLanguage: card.localizedAbilityLanguage }),
    ...(card.localizedAbilityStatus === undefined
      ? {}
      : { localizedAbilityStatus: card.localizedAbilityStatus }),
    ...(card.localizedAbilitySource === undefined
      ? {}
      : {
          localizedAbilitySource: {
            url: card.localizedAbilitySource.url,
            locale: card.localizedAbilitySource.locale,
            updatedAt: card.localizedAbilitySource.updatedAt,
            syncedAt: card.localizedAbilitySource.syncedAt
          }
        }),
    ...(card.localizedFromPrintingId === undefined
      ? {}
      : { localizedFromPrintingId: card.localizedFromPrintingId }),
    ...policy
  };
}

const HAN_TEXT_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

function hasOfficialChineseName(card: CatalogCard): boolean {
  return card.localizedName !== undefined && HAN_TEXT_PATTERN.test(card.localizedName);
}

function hasOfficialChineseSubtitle(card: CatalogCard): boolean {
  return card.subtitle === undefined ||
    (card.localizedSubtitle !== undefined && HAN_TEXT_PATTERN.test(card.localizedSubtitle));
}

function hasOfficialChineseAbility(card: CatalogCard): boolean {
  if (card.ability.trim() === "") return true;
  return hasOfficialChineseAbilitySource(card);
}

function hasOfficialChineseAbilitySource(card: CatalogCard): boolean {
  return card.ability.trim() !== "" &&
    (card.localizedAbilityStatus === "official-structured" ||
      card.localizedAbilityStatus === "official-accessibility-supplemented");
}

function hasAnyOfficialChineseDisplay(card: CatalogCard): boolean {
  return hasOfficialChineseName(card) ||
    (card.subtitle !== undefined && hasOfficialChineseSubtitle(card)) ||
    hasOfficialChineseAbilitySource(card);
}

function isCompleteOfficialChinesePrinting(card: CatalogCard): boolean {
  return hasOfficialChineseName(card) &&
    hasOfficialChineseSubtitle(card) &&
    hasOfficialChineseAbility(card) &&
    // A previous sibling merge is never used as a source for another printing.
    card.localizedFromPrintingId === undefined;
}

/**
 * Fill a printing's missing zh-CN display fields from the same canonical card.
 * Each field is copied only when the source has official Chinese data for it.
 * In particular, an English fallback is never a Chinese source.
 */
function withOfficialSiblingLocalization(cards: readonly CatalogCard[]): CatalogCard[] {
  const byCanonical = new Map<string, CatalogCard[]>();
  for (const card of cards) {
    const siblings = byCanonical.get(card.canonicalCardId);
    if (siblings === undefined) byCanonical.set(card.canonicalCardId, [card]);
    else siblings.push(card);
  }

  return cards.map(card => {
    if (isCompleteOfficialChinesePrinting(card)) return card;
    const candidates = (byCanonical.get(card.canonicalCardId) ?? [])
      .filter(candidate => candidate.id !== card.id)
      .filter(hasAnyOfficialChineseDisplay)
      // Canonical identities can span printings whose English rules changed.
      // Never attach a different edition's wording to this printing.
      .filter(candidate => candidate.fullName === card.fullName &&
        candidate.cardType === card.cardType &&
        candidate.ability === card.ability);
    if (candidates.length === 0) return card;

    const sameSet = candidates.filter(candidate => candidate.setCode === card.setCode);
    const preferredStandard = (sameSet.length === 0 ? candidates : sameSet)
      .filter(candidate => candidate.variant === "standard");
    const source = preferredStandard.find(candidate => candidate.subtitle === card.subtitle)
      ?? candidates.find(candidate => candidate.subtitle === card.subtitle)
      ?? (sameSet.length === 0 ? candidates : sameSet)[0]
      ?? preferredStandard[0]
      ?? candidates[0]!;
    const needsName = !hasOfficialChineseName(card);
    const needsSubtitle = !hasOfficialChineseSubtitle(card);
    const needsAbility = !hasOfficialChineseAbility(card);
    const localizedName = needsName && hasOfficialChineseName(source)
      ? source.localizedName
      : card.localizedName;
    const localizedSubtitle = needsSubtitle
      ? hasOfficialChineseSubtitle(source) ? source.localizedSubtitle : card.localizedSubtitle
      : card.localizedSubtitle;
    const localizedAbilityRulesText = needsAbility
      ? hasOfficialChineseAbilitySource(source) ? source.localizedAbilityRulesText : card.localizedAbilityRulesText
      : card.localizedAbilityRulesText;
    const localizedAbilityEffectText = needsAbility
      ? hasOfficialChineseAbilitySource(source) ? source.localizedAbilityEffectText : card.localizedAbilityEffectText
      : card.localizedAbilityEffectText;
    const replacedAbility = needsAbility && hasOfficialChineseAbilitySource(source);
    const replacedDisplay = (needsName && localizedName !== undefined) ||
      (needsSubtitle && localizedSubtitle !== undefined) ||
      replacedAbility;
    if (!replacedDisplay) return card;
    return {
      ...card,
      ...(localizedName === undefined ? {} : { localizedName }),
      ...(localizedSubtitle === undefined
        ? {}
        : { localizedSubtitle }),
      ...(localizedAbilityRulesText === undefined
        ? {}
        : { localizedAbilityRulesText }),
      ...(localizedAbilityEffectText === undefined
        ? {}
        : { localizedAbilityEffectText }),
      ...(replacedAbility
        ? {
            localizedAbilityLanguage: "zh-CN" as const,
            localizedAbilityStatus: "official-structured-sibling" as const
          }
        : {}),
      ...(!replacedAbility || source.localizedAbilitySource === undefined
        ? {}
        : { localizedAbilitySource: { ...source.localizedAbilitySource } }),
      localizedFromPrintingId: source.id,
    };
  });
}

function allowedZonesFor(
  cardType: string,
  tags: readonly string[]
): readonly DeckZone[] {
  const normalizedType = cardType.trim().toLowerCase();
  const normalizedTags = new Set(tags.map(tag => tag.trim().toLowerCase()));
  if (normalizedType === "token" || normalizedTags.has("token")) return NO_ZONES;
  if (normalizedType === "rune") return RUNE_ZONES;
  if (normalizedType === "legend") return LEGEND_ZONES;
  if (normalizedType === "battlefield") return BATTLEFIELD_ZONES;
  if (normalizedType === "unit" && normalizedTags.has("champion")) {
    return CHAMPION_ZONES;
  }
  if (normalizedType === "unit" || normalizedType === "gear" || normalizedType === "spell") {
    return UNIT_MAIN_DECK_ZONES;
  }
  return NO_ZONES;
}

function normalizeCardCatalogRuntime(
  value: unknown,
  configuredRules?: DeckValidationRules,
  policyOptions: ConstructedRulesOptions = {}
): CardCatalogRuntimeData {
  if (!isRecord(value) ||
      value.schemaVersion !== 1 ||
      !isText(value.dataVersion, 128) ||
      !isText(value.digest, 256) ||
      !Array.isArray(value.cards) ||
      (value.groups !== undefined && !Array.isArray(value.groups))) {
    throw new Error("The card catalog has an invalid top-level shape.");
  }

  const cards: CatalogCard[] = [];
  const ids = new Set<string>();
  for (const [index, item] of value.cards.entries()) {
    if (!isCatalogCard(item)) {
      throw new Error(`Card catalog entry ${index} is invalid.`);
    }
    if (ids.has(item.id)) {
      throw new Error(`Card catalog contains duplicate id ${item.id}.`);
    }
    ids.add(item.id);
    cards.push(item);
  }
  const cardsById = new Map(cards.map(card => [card.id, card]));
  const localizedCards = withOfficialSiblingLocalization(cards);

  // `domains`/`tags` are already present on the catalog cards; forwarding them
  // only feeds the server-private identity lookup. The public catalog schema and
  // the HTTP endpoints are unchanged.
  const constructed: ConstructedRules = createConstructedRules(cards.map(card => ({
    id: card.id,
    canonicalCardId: card.canonicalCardId,
    fullName: card.fullName,
    cardType: card.cardType,
    setCode: card.setCode,
    domains: card.domains,
    tags: card.tags,
    name: card.name
  })), "standard", policyOptions);

  const policyCards = localizedCards.map(card => {
    const policy = getConstructedCardPolicy(
      constructed.policy,
      card.canonicalCardId
    );
    if (policy === undefined) {
      throw new Error(
        `The constructed policy has no entry for canonical card ${card.canonicalCardId}.`
      );
    }
    const printingPolicy = getConstructedPrintingPolicy(
      constructed.policy,
      card.id
    );
    if (printingPolicy === undefined) {
      throw new Error(
        `The constructed policy has no entry for printing ${card.id}.`
      );
    }
    const configuredPolicy =
      configuredRules?.cardPolicies?.[card.canonicalCardId];
    const publicMaxCopies = configuredPolicy?.type === "limited"
      ? configuredPolicy.maxCopies
      : configuredPolicy?.type === "restricted"
        ? 1
        : policy.policyType === "limited"
          ? policy.maxCopies
          : 0;
    return {
      ...publicCard(card, {
        allowedZones: allowedZonesFor(card.cardType, card.tags),
        maxCopies: publicMaxCopies,
        banned: policy.status === "banned",
        available: printingPolicy.available,
        availabilityReason: printingPolicy.status
      }),
    };
  });

  const groups = value.groups === undefined
    ? undefined
    : value.groups.map((group, index) => {
        const publicGroup = isPublicCardGroup(group, cardsById);
        if (publicGroup === null) {
          throw new Error(`Card catalog group ${index} is invalid.`);
        }
        return publicGroup;
      });

  const publicCatalog: PublicCardCatalog = {
    schemaVersion: 1,
    dataVersion: value.dataVersion,
    digest: value.digest,
    policy: constructed.policy,
    cards: policyCards,
    ...(groups === undefined ? {} : { groups })
  };

  return {
    publicCatalog,
    validationCards: policyCards.map(card => ({
      id: card.id,
      canonicalCardId: card.canonicalCardId,
      name: card.name,
      allowedZones: card.allowedZones
    })),
    constructedRules: {
      ...constructed,
      rules: configuredRules ?? constructed.rules
    }
  };
}

export function validateCatalogDeck(
  runtime: CardCatalogRuntime,
  deck: DeckSubmission
): ConstructedValidationResult {
  return validateConstructedDeck(
    deck,
    runtime.validationCards,
    runtime.constructedRules
  );
}

export function normalizeCardCatalog(
  value: unknown,
  policyOptions: ConstructedRulesOptions = {}
): PublicCardCatalog {
  return normalizeCardCatalogRuntime(value, undefined, policyOptions).publicCatalog;
}

function normalizeImageManifestEntry(value: unknown): ImageManifestEntry | null {
  if (!isRecord(value) ||
      !isSafeId(value.id) ||
      typeof value.file !== "string" ||
      path.basename(value.file) !== value.file ||
      typeof value.contentType !== "string" ||
      !CONTENT_TYPES.has(value.contentType) ||
      !isNonnegativeInteger(value.bytes) ||
      typeof value.sha256 !== "string" ||
      !SHA256_PATTERN.test(value.sha256)) {
    return null;
  }

  const extension = IMAGE_EXTENSIONS.get(value.contentType);
  if (extension === undefined || value.file !== `${value.id}.${extension}`) {
    return null;
  }

  return {
    id: value.id,
    file: value.file,
    contentType: value.contentType as ImageManifestEntry["contentType"],
    bytes: value.bytes,
    sha256: value.sha256
  };
}

async function loadImageManifest(
  imagesDirectory: string
): Promise<Map<string, ImageManifestEntry>> {
  const manifestPath = path.join(
    path.dirname(path.resolve(imagesDirectory)),
    "images-manifest.json"
  );
  let contents: string;
  try {
    contents = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`The image manifest is not valid JSON: ${manifestPath}`);
  }
  if (!isRecord(parsed) ||
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.images)) {
    throw new Error(`The image manifest has an invalid shape: ${manifestPath}`);
  }

  const images = new Map<string, ImageManifestEntry>();
  for (const value of parsed.images) {
    const entry = normalizeImageManifestEntry(value);
    if (entry === null || images.has(entry.id)) {
      throw new Error(`The image manifest contains an invalid entry: ${manifestPath}`);
    }
    images.set(entry.id, entry);
  }
  return images;
}

async function readCatalogFile(catalogPath: string): Promise<unknown> {
  let contents: string;
  try {
    contents = await readFile(catalogPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Card catalog file not found: ${catalogPath}`);
    }
    throw error;
  }

  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`Card catalog is not valid JSON: ${catalogPath}`);
  }
}

export function defaultCardCatalogPaths(): {
  catalogPath: string;
  imagesDirectory: string;
} {
  return {
    catalogPath: DEFAULT_CATALOG_PATH,
    imagesDirectory: DEFAULT_IMAGES_DIRECTORY
  };
}

export async function loadCardCatalogRuntime(
  options: CardCatalogLoadOptions = {}
): Promise<CardCatalogRuntime> {
  const defaults = defaultCardCatalogPaths();
  const imagesDirectory = path.resolve(
    options.imagesDirectory ?? defaults.imagesDirectory
  );
  const rawCatalog = options.catalog !== undefined
    ? options.catalog
    : await readCatalogFile(path.resolve(
      options.catalogPath ?? defaults.catalogPath
    ));
  const {
    publicCatalog,
    validationCards,
    constructedRules
  } = normalizeCardCatalogRuntime(rawCatalog, options.deckRules, options.constructedPolicy);
  const deckRules = constructedRules.rules;

  return {
    publicCatalog,
    publicCatalogJson: `${JSON.stringify(publicCatalog)}\n`,
    validationCards,
    deckRules,
    constructedRules,
    imagesDirectory,
    imageManifest: await loadImageManifest(imagesDirectory)
  };
}

export function imageFilePath(
  runtime: CardCatalogRuntime,
  entry: ImageManifestEntry
): string | null {
  const directory = path.resolve(runtime.imagesDirectory);
  const filePath = path.resolve(directory, entry.file);
  const relative = path.relative(directory, filePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return filePath;
}

export function isManifestImageAvailable(
  runtime: CardCatalogRuntime,
  printingId: string
): boolean {
  if (!isSafeId(printingId)) return false;
  return runtime.imageManifest.has(printingId);
}

export const DECK_ZONES = [
  "mainDeck",
  "runes",
  "legend",
  "champion",
  "battlefields",
  "sideboard"
] as const satisfies readonly DeckZone[];

export function normalizeDeckRequest(value: unknown): DeckSubmission | null {
  if (!isRecord(value) || !hasExactKeys(value, ["deck"])) return null;
  const deck = value.deck;
  if (!isRecord(deck)) return null;

  const deckKeys = new Set(Object.keys(deck));
  for (const key of deckKeys) {
    if (!(DECK_ZONES as readonly string[]).includes(key)) return null;
  }

  const result: Partial<Record<DeckZone, {
    readonly cardId: string;
    readonly quantity: number;
  }[]>> = {};
  for (const zone of DECK_ZONES) {
    const entries = deck[zone];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) return null;

    const normalizedEntries: {
      cardId: string;
      quantity: number;
    }[] = [];
    for (const entry of entries) {
      if (!isRecord(entry) ||
          !hasExactKeys(entry, ["cardId", "quantity"]) ||
          !isSafeId(entry.cardId) ||
          !isNonnegativeInteger(entry.quantity) ||
          entry.quantity < 1) {
        return null;
      }
      normalizedEntries.push({
        cardId: entry.cardId,
        quantity: entry.quantity
      });
    }
    result[zone] = normalizedEntries;
  }
  return result;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length &&
    actualKeys.every(key => keys.includes(key));
}

function hasRequiredKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return keys.every(key => key in value);
}

function hasOnlyKnownKeys(
  value: Record<string, unknown>,
  additionalKeys: readonly string[]
): boolean {
  const knownKeys = new Set([
    "canonicalCardId",
    "primaryPrintingId",
    "printings",
    ...additionalKeys
  ]);
  return Object.keys(value).every(key => knownKeys.has(key));
}

export async function readManifestImage(
  runtime: CardCatalogRuntime,
  printingId: string
): Promise<{ entry: ImageManifestEntry; bytes: Buffer } | null> {
  if (!isSafeId(printingId)) return null;
  const entry = runtime.imageManifest.get(printingId);
  if (entry === undefined) return null;

  const filePath = imageFilePath(runtime, entry);
  if (filePath === null) return null;

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return null;
  }
  if (bytes.byteLength !== entry.bytes) return null;

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (`sha256:${digest}` !== entry.sha256) return null;

  return { entry, bytes };
}

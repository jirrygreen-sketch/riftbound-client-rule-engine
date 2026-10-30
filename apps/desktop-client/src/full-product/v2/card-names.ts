import type { CatalogCard } from "../../net/CardCatalogClient";
import type { V2ProjectedObject } from "../../../../../packages/protocol/src/v2/index.js";
import { officialTokenName } from "./token-names";

/** Official display names indexed by stable catalog identities. */
export interface CardNameIndex {
  readonly localizedById: ReadonlyMap<string, string>;
  /** Exact English-name matches are retained only when they are unambiguous. */
  readonly localizedByEnglishName: ReadonlyMap<string, string>;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const HAN_TEXT_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

function setUnique(
  values: Map<string, string>,
  ambiguous: Set<string>,
  rawKey: string | undefined,
  value: string
): void {
  const key = nonEmpty(rawKey);
  if (key === undefined || ambiguous.has(key)) return;
  const existing = values.get(key);
  if (existing === undefined) {
    values.set(key, value);
  } else if (existing !== value) {
    values.delete(key);
    ambiguous.add(key);
  }
}

/** Build only names supplied by the loaded catalog. Missing values never create a translation. */
export function buildCardNameIndex(cards: readonly CatalogCard[]): CardNameIndex {
  const localizedById = new Map<string, string>();
  const localizedByEnglishName = new Map<string, string>();
  const ambiguousIds = new Set<string>();
  const ambiguousEnglishNames = new Set<string>();
  for (const card of cards) {
    const localizedName = nonEmpty(card.localizedName);
    if (localizedName === undefined || !HAN_TEXT_PATTERN.test(localizedName)) continue;
    setUnique(localizedById, ambiguousIds, card.id, localizedName);
    setUnique(localizedById, ambiguousIds, card.canonicalCardId, localizedName);
    setUnique(localizedByEnglishName, ambiguousEnglishNames, card.name, localizedName);
  }
  return { localizedById, localizedByEnglishName };
}

export interface CardNameReference {
  readonly cardId?: string;
  readonly englishName?: string;
  readonly fallback?: string;
}

/** Resolve in card identity, English-label, server-name, card-id, then caller-fallback order. */
export function resolveCardName(index: CardNameIndex, reference: CardNameReference): string | undefined {
  const cardId = nonEmpty(reference.cardId);
  const englishName = nonEmpty(reference.englishName);
  return (cardId === undefined ? undefined : index.localizedById.get(cardId)) ??
    (englishName === undefined ? undefined : index.localizedByEnglishName.get(englishName)) ??
    englishName ?? cardId ?? nonEmpty(reference.fallback);
}

/** Projected names stay authoritative when a catalog identity or official localization is absent. */
export function projectedObjectCardName(
  index: CardNameIndex,
  object: V2ProjectedObject,
  fallback?: string
): string {
  // A resolved catalog identity wins. Effect-created tokens are represented by
  // their English projection label, which can be matched only against names
  // attested in official zh-CN card text.
  const projectedName = resolveCardName(index, {
    cardId: object.cardId,
    englishName: object.name,
    fallback: fallback ?? object.objectId
  })!;
  // Catalog identity and an unambiguous official catalog label take priority.
  // The attestation map is consulted only when both return the projected
  // English label (an effect-created token normally has no catalog identity).
  const englishName = nonEmpty(object.name);
  return object.cardId === undefined && englishName !== undefined && projectedName === englishName
    ? officialTokenName(englishName) ?? projectedName
    : projectedName;
}

/** Translate only a reference known to be a card source; ordinary UI text must bypass this helper. */
export function cardReferenceName(
  index: CardNameIndex,
  objectId: string | undefined,
  englishName: string | undefined,
  fallback?: string
): string | undefined {
  const idName = objectId === undefined ? undefined : index.localizedById.get(objectId);
  const name = englishName === undefined ? undefined : index.localizedByEnglishName.get(englishName);
  const tokenName = name === undefined ? officialTokenName(nonEmpty(englishName)) : undefined;
  return idName ?? name ?? tokenName ?? nonEmpty(englishName) ?? nonEmpty(objectId) ?? nonEmpty(fallback);
}

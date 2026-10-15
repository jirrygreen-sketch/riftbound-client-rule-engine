import type {
  DuelCatalogCardTypeV2,
  DuelMatchMetadata,
  DuelTrustedCardTypeResolverV2,
} from "@riftbound/engine-core/duel";
import type { CardCatalogRuntime } from "../card-catalog.js";

/** A catalog-bound printing-type lookup, NOT a deck-slot or card-text classifier. */
export interface CatalogCardTypeResolverV2 {
  readonly catalogStamp: Readonly<{ readonly dataVersion: string; readonly digest: string }>;
  /** Check the V2 constructor's metadata against the runtime used to build this index. */
  assertMatchMetadata(metadata: Pick<DuelMatchMetadata, "dataVersion" | "catalogDigest">): void;
  /** Return a resolver only for a match with this catalog's exact stamp. */
  forMatch(metadata: Pick<DuelMatchMetadata, "dataVersion" | "catalogDigest">): DuelTrustedCardTypeResolverV2;
  readonly resolve: DuelTrustedCardTypeResolverV2;
}

const INVALID_PRINTING = Symbol("invalid catalog printing type");
type ClassifiedPrinting = DuelCatalogCardTypeV2 | typeof INVALID_PRINTING;

function classify(cardType: unknown, rawTags: unknown): ClassifiedPrinting {
  if (!Array.isArray(rawTags) || rawTags.some((tag) =>
    typeof tag !== "string" || tag.trim() !== tag || tag.length === 0)) return INVALID_PRINTING;
  const tags = rawTags as readonly string[];
  // The official catalog includes token printings that happen to have Unit/Gear/
  // Battlefield cardType. None is a submitted physical deck card.
  if (tags.some((tag) => tag.toLowerCase() === "token" ||
    (tag.toLowerCase() === "champion" && tag !== "Champion"))) return INVALID_PRINTING;
  const champion = tags.includes("Champion");
  switch (cardType) {
    case "Unit": return champion ? "Champion" : "Unit";
    case "Gear": return champion ? INVALID_PRINTING : "Gear";
    case "Rune": return champion ? INVALID_PRINTING : "Rune";
    // Some official Legend printings also have the Champion tag: their printed
    // card type remains Legend, not a playable Unit or chosen Champion.
    case "Legend": return "Legend";
    case "Battlefield": return champion ? INVALID_PRINTING : "Battlefield";
    case "Spell": return champion ? INVALID_PRINTING : "Other";
    default: return INVALID_PRINTING; // Token, invented types and "Champion" are NOT Other.
  }
}

/**
 * Index unique cardIds from the loaded server runtime. The private Map is detached
 * from the public catalog and never returned; only the frozen stamp and a lookup
 * function escape. Invalid entries fail on lookup so official token printings do
 * not prevent construction from the complete official catalog.
 *
 * The catalog stamp is an identity binding, not a cryptographic verification of
 * arbitrary caller-created runtimes. A server must load the catalog from its
 * trusted source and check the match metadata before passing `resolve` to Core.
 */
export function createCatalogCardTypeResolverV2(runtime: CardCatalogRuntime): CatalogCardTypeResolverV2 {
  const catalog = runtime?.publicCatalog;
  if (!catalog || catalog.schemaVersion !== 1 ||
    typeof catalog.dataVersion !== "string" || !catalog.dataVersion.trim() ||
    typeof catalog.digest !== "string" || !catalog.digest.trim() ||
    !Array.isArray(catalog.cards) ||
    runtime.publicCatalogJson !== `${JSON.stringify(catalog)}\n`) {
    throw new TypeError("Duel V2 catalog card types require a loaded, coherent CardCatalogRuntime");
  }
  const catalogStamp = Object.freeze({ dataVersion: catalog.dataVersion, digest: catalog.digest });
  const catalogJson = runtime.publicCatalogJson;
  const cards = catalog.cards;
  // Retain only the private printing identity/type snapshot. The public catalog
  // remains mutable for other server consumers, so a tampered queried record is
  // detected instead of silently reclassifying it or exposing this index.
  const byCardId = new Map<string, { readonly kind: ClassifiedPrinting;
    readonly index: number; readonly cardType: string; readonly tags: readonly string[] }>();
  for (const [index, card] of cards.entries()) {
    const id = card?.id;
    if (typeof id !== "string" || !id.trim() || byCardId.has(id)) {
      throw new TypeError(`Duel V2 catalog card type has an invalid or ambiguous cardId: ${String(id)}`);
    }
    byCardId.set(id, { kind: classify(card.cardType, card.tags), index,
      cardType: card.cardType, tags: [...card.tags] });
  }
  const assertRuntimeBinding = (): void => {
    if (runtime.publicCatalog !== catalog || catalog.cards !== cards ||
      catalog.dataVersion !== catalogStamp.dataVersion || catalog.digest !== catalogStamp.digest ||
      runtime.publicCatalogJson !== catalogJson || cards.length !== byCardId.size) {
      throw new TypeError("Duel V2 catalog card type runtime/stamp changed after indexing");
    }
  };
  const assertMatchMetadata = (metadata: Pick<DuelMatchMetadata, "dataVersion" | "catalogDigest">): void => {
    assertRuntimeBinding();
    if (metadata?.dataVersion !== catalogStamp.dataVersion ||
      metadata.catalogDigest !== catalogStamp.digest) {
      throw new TypeError("Duel V2 catalog card type match/catalog stamp mismatch");
    }
  };
  const resolve: DuelTrustedCardTypeResolverV2 = (cardId) => {
    assertRuntimeBinding();
    if (typeof cardId !== "string" || !byCardId.has(cardId)) {
      throw new TypeError(`Duel V2 catalog card type unknown cardId: ${String(cardId)}`);
    }
    const entry = byCardId.get(cardId)!;
    const current = cards[entry.index];
    if (current?.id !== cardId || current.cardType !== entry.cardType ||
      !Array.isArray(current.tags) || current.tags.length !== entry.tags.length ||
      current.tags.some((tag: string, index: number) => tag !== entry.tags[index])) {
      throw new TypeError(`Duel V2 catalog card type printing changed after indexing: ${cardId}`);
    }
    if (entry.kind === INVALID_PRINTING) {
      throw new TypeError(`Duel V2 catalog card type invalid printing: ${cardId}`);
    }
    return entry.kind;
  };
  return Object.freeze({
    catalogStamp, assertMatchMetadata, resolve,
    forMatch(metadata: Pick<DuelMatchMetadata, "dataVersion" | "catalogDigest">): DuelTrustedCardTypeResolverV2 {
      assertMatchMetadata(metadata);
      // Check the runtime again on each query; an old closure must not silently
      // accept a later replacement or mutation of the runtime it was bound to.
      return resolve;
    },
  });
}

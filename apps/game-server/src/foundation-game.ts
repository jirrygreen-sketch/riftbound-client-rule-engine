import {
  createConfiguredGame,
  type CardInstance,
  type EngineCardDefinition,
  type GameObjectType,
  type PlayerId
} from "@riftbound/engine-core";
import type { RoomDeckSubmission } from "@riftbound/protocol";
import type { PublicCatalogCard } from "./card-catalog.js";

interface FoundationSeat {
  readonly id: PlayerId;
  readonly name: string;
  readonly deck: RoomDeckSubmission;
}

const OPENING_HAND_SIZE = 4;

/**
 * Foundation adapter boundary.
 *
 * This adapter intentionally does not implement a second game core. It maps the
 * catalog and submitted printing ids into `createConfiguredGame`.
 *
 * The adapter implements the verified CR v1.4 1v1 Duel minimum that each
 * player opens with four submitted Main Deck cards. Cards are taken in
 * submitted order to keep this deterministic and to avoid inventing a shuffle
 * procedure. Mulligan, first-player selection, and the rest of the official
 * opening procedure are not represented. The adapter also does not randomly
 * select a battlefield; submitted battlefields remain in the battlefield zone
 * until that official selection step is modeled elsewhere.
 * Submitted runes are loaded into the private rune-deck zone. They are not
 * channeled into the public rune zone by setup.
 *
 * Ability text is deliberately not parsed. A card is modeled as effect-free
 * only when its catalog ability is explicitly empty and its engine object
 * semantics are already modeled. Basic Rune abilities are defined by the core
 * rules even when the catalog text is empty, so runes remain judge-required.
 * Gear and other unmapped card types also retain submitted instances without
 * treating their unimplemented abilities as effect-free.
 */
export function createFoundationGame(
  seats: readonly FoundationSeat[],
  cards: readonly PublicCatalogCard[]
): ReturnType<typeof createConfiguredGame> {
  const catalogCards = new Map(cards.map(card => [card.id, card]));
  const definitions = new Map<string, EngineCardDefinition>();
  const usedInstanceIds = new Set<string>();

  const playerOptions = seats.map(seat => {
    const mainDeck = instancesForZone(
      seat,
      "mainDeck",
      catalogCards,
      definitions,
      usedInstanceIds
    );
    return {
      id: seat.id,
      name: seat.name,
      deck: mainDeck.slice(OPENING_HAND_SIZE),
      startingHand: mainDeck.slice(0, OPENING_HAND_SIZE),
      battlefield: instancesForZone(
        seat,
        "battlefields",
        catalogCards,
        definitions,
        usedInstanceIds
      ),
      champion: instancesForZone(
        seat,
        "champion",
        catalogCards,
        definitions,
        usedInstanceIds
      ),
      legend: instancesForZone(
        seat,
        "legend",
        catalogCards,
        definitions,
        usedInstanceIds
      ),
      runeDeck: instancesForZone(
        seat,
        "runes",
        catalogCards,
        definitions,
        usedInstanceIds
      )
    };
  });

  // Sideboard entries are intentionally omitted: no official sideboarding
  // procedure is implemented in this foundation slice.
  return createConfiguredGame({
    players: playerOptions,
    cards: [...definitions.values()]
  });
}

function instancesForZone(
  seat: FoundationSeat,
  zone: keyof RoomDeckSubmission,
  catalogCards: ReadonlyMap<string, PublicCatalogCard>,
  definitions: Map<string, EngineCardDefinition>,
  usedInstanceIds: Set<string>
): CardInstance[] {
  const entries = seat.deck[zone] ?? [];
  const instances: CardInstance[] = [];

  for (const [entryIndex, entry] of entries.entries()) {
    const card = catalogCards.get(entry.cardId);
    if (!card) {
      throw new Error(`Submitted card ${entry.cardId} is missing from the catalog.`);
    }

    if (!definitions.has(card.id)) {
      definitions.set(card.id, foundationCardDefinition(card));
    }

    for (let copy = 1; copy <= entry.quantity; copy += 1) {
      const instanceId = `${seat.id}:${zone}:${entryIndex}:${copy}`;
      if (usedInstanceIds.has(instanceId)) {
        throw new Error(`Duplicate card instance ${instanceId}.`);
      }
      usedInstanceIds.add(instanceId);
      instances.push({ instanceId, cardId: card.id });
    }
  }

  return instances;
}

function foundationCardDefinition(
  card: PublicCatalogCard
): EngineCardDefinition {
  const types = gameObjectTypes(card);
  if (types.length === 0) {
    throw new Error(`Card ${card.id} has no supported foundation object type.`);
  }
  const requiresJudge = card.ability.trim().length > 0 ||
    types.length !== 1 ||
    types[0] === "rune" ||
    types[0] === "token";

  return {
    id: card.id,
    name: card.name,
    cost: card.energy ?? 0,
    types,
    ...(!requiresJudge
      ? {}
      : {
          effect: {
            kind: "judge-required",
            reason: card.ability.trim().length > 0
              ? "official card text not modeled"
              : types[0] === "rune"
                ? "inherent rune abilities not modeled"
                : "official card type not modeled"
          }
        })
  };
}

function gameObjectTypes(card: PublicCatalogCard): GameObjectType[] {
  const cardType = card.cardType.trim().toLowerCase();
  const tags = card.tags.map(tag => tag.trim().toLowerCase());

  // A Champion-tagged Unit is still a Unit definition. Only the submitted
  // Chosen Champion instance starts in the champion zone through options.champion.
  if (cardType === "unit") {
    return ["unit"];
  }
  switch (cardType) {
    case "spell":
      return ["spell"];
    case "battlefield":
      return ["battlefield"];
    case "champion":
      return ["champion"];
    case "legend":
      return ["legend"];
    case "rune":
      return ["rune"];
    // The foundation engine has no Gear object type. Gear cards remain in the
    // submitted deck as token-like objects, but the adapter never maps them to
    // another engine type.
    case "gear":
      return ["token"];
    default:
      return [];
  }
}

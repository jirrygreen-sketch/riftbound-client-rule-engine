import { describe, expect, it } from "vitest";
import { DUEL_RULESET_ID, type ClientSession } from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { loadM1PresetCatalog } from "../../src/presets/index.js";
import { GameRoom } from "../../src/room.js";

interface RuntimeRegistryInspection {
  readonly match: {
    readonly setup?: {
      readonly battlefields?: readonly { readonly cardId: string | null }[];
    };
  };
  readonly binding: {
    readonly registry: { has(cardId: string | null | undefined): boolean };
  };
}

function runtimeRegistry(room: GameRoom): RuntimeRegistryInspection {
  const runtime = Reflect.get(room, "engineRuntime") as RuntimeRegistryInspection | null;
  if (!runtime || !runtime.match.setup?.battlefields || !runtime.binding) {
    throw new Error("The room did not expose a started engine-v2 runtime");
  }
  return runtime;
}

describe("public room Battlefield programs", () => {
  it("registers both selected M1 Battlefields, survives restoration, and omits unselected candidates", async () => {
    const catalog = await loadCardCatalogRuntime();
    const presets = await loadM1PresetCatalog(catalog);
    const randomCalls: number[] = [];
    const room = new GameRoom("RIFT-973-battlefield-programs", DUEL_RULESET_ID, catalog, bound => {
      randomCalls.push(bound);
      return 0;
    },
      undefined, undefined, undefined, "engine-v2");
    const noMessages = () => {};
    const decks = [presets.presets[0].deck, presets.presets[1].deck] as const;
    const connections = [
      room.join("Alice", noMessages, "alice"),
      room.join("Bob", noMessages, "bob")
    ];
    const sessions = connections.map(connection => ({
      roomId: room.roomId,
      playerId: connection.playerId,
      resumeToken: connection.resumeToken
    }) satisfies ClientSession) as [ClientSession, ClientSession];

    for (const [index, deck] of decks.entries()) {
      room.submitDeck(sessions[index]!, connections[index]!.connectionId,
        room.currentRoomVersion, deck, `deck-${index}`, noMessages);
      room.setReady(sessions[index]!, connections[index]!.connectionId,
        room.currentRoomVersion, true, `ready-${index}`, noMessages);
    }

    expect(randomCalls).toEqual([3, 3]);
    const runtime = runtimeRegistry(room);
    const selected = runtime.match.setup!.battlefields!
      .flatMap(field => field.cardId === null ? [] : [field.cardId]);
    expect(selected).toHaveLength(2);
    for (const cardId of selected) {
      expect(runtime.binding.registry.has(cardId), `${cardId} should be registered`).toBe(true);
    }

    const canonicalByPrinting = new Map(catalog.publicCatalog.cards.map(card =>
      [card.id, card.canonicalCardId] as const));
    const candidates = new Set(decks.flatMap(deck => deck.battlefields!.flatMap(entry => {
      const canonicalCardId = canonicalByPrinting.get(entry.cardId);
      return canonicalCardId === undefined ? [] : [canonicalCardId];
    })));
    const unselected = [...candidates].filter(cardId => !selected.includes(cardId));
    expect(unselected.length).toBeGreaterThan(0);
    for (const cardId of unselected) {
      expect(runtime.binding.registry.has(cardId), `${cardId} should not be registered`).toBe(false);
    }

    const restored = GameRoom.restore(room.exportArchive(), catalog);
    const restoredRuntime = runtimeRegistry(restored);
    expect(restoredRuntime.match.setup!.battlefields!.map(field => field.cardId)).toEqual(selected);
    for (const cardId of selected) {
      expect(restoredRuntime.binding.registry.has(cardId), `${cardId} should survive restore`).toBe(true);
    }
    for (const cardId of unselected) {
      expect(restoredRuntime.binding.registry.has(cardId), `${cardId} should stay absent after restore`).toBe(false);
    }
  }, 120_000);
});

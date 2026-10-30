import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import rumble from "../../../../../packages/card-dsl/dist/cards/sfd/rumble-hotheaded.js";
import type { Domain } from "../../../../../packages/engine-core/dist/effects/contract.js";
import { createEngineRuntime, type EngineRuntimeDeck, type RuntimeSubmitResult } from "../runtime.js";

// Core Rules v1.5, published 2026-10-09 and effective 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 103.3.a.1/.3 and 112 place the selected physical Chosen Champion card in
// its owner's Champion Zone. 108.3.d/e make that zone public and let the card
// be played normally; 420.1.a lists the Champion Zone as a default Play source.
const EVIDENCE = Object.freeze({
  ruleset: "core-1.5",
  published: "2026-10-09",
  effective: "2026-10-16",
  url: "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf",
  rules: ["103.3.a.1", "103.3.a.3", "108.3.d", "108.3.e", "112", "420.1.a"],
});

interface CatalogCard {
  readonly id: string;
  readonly canonicalCardId: string;
  readonly name: string;
  readonly fullName: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
}

const catalog = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../../../packages/card-data/data/deck-catalog.json", import.meta.url,
)), "utf8")) as { readonly cards: readonly CatalogCard[] };
const champion = catalog.cards.find(card => card.id === "sfd-026-221");
if (champion === undefined) throw new Error("Missing trusted Rumble catalog printing");
const furyRune = catalog.cards.find(card => card.id === "ogn-007-298");
const mindRune = catalog.cards.find(card => card.id === "ogn-089-298");
if (furyRune === undefined || mindRune === undefined) throw new Error("Missing trusted Basic Runes");

function deck(seat: "A" | "B"): EngineRuntimeDeck {
  const boon = (id: string) => ({
    id: `${seat}:${id}`,
    cardId: champion!.canonicalCardId,
    name: champion!.fullName,
    types: ["unit"],
    tags: [...champion!.tags],
    keywords: [],
    domains: [...champion!.domains] as Domain[],
    energy: champion!.energy,
    power: champion!.power === null ? null : [],
    might: champion!.might,
  });
  return {
    mainDeck: Array.from({ length: 40 }, (_, index) => boon(`main:${index}`)),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:rune:${index}`,
      cardId: index < 6 ? furyRune!.canonicalCardId : mindRune!.canonicalCardId,
      name: index < 6 ? furyRune!.fullName : mindRune!.fullName,
      types: ["rune"],
      tags: ["Basic"],
      domains: [...(index < 6 ? furyRune!.domains : mindRune!.domains)] as Domain[],
      energy: furyRune!.energy,
      power: null,
      might: furyRune!.might,
    })),
    championLegend: {
      id: `${seat}:legend`, cardId: `legend:${seat}`, name: "Rumble, Hotheaded",
      types: ["legend"], tags: ["Rumble"], domains: ["Fury"], energy: null, power: null, might: null,
    },
    chosenChampion: {
      id: `${seat}:champion`, cardId: champion!.canonicalCardId, name: champion!.fullName,
      types: ["unit"], tags: [...champion!.tags], domains: [...champion!.domains] as Domain[],
      energy: champion!.energy, power: champion!.power === null ? null : [], might: champion!.might,
    },
    battlefields: [0, 1, 2].map(index => ({
      id: `${seat}:field:${index}`, cardId: `field:${seat}:${index}`, name: `Field ${index}`,
      types: ["battlefield"], tags: [], domains: [], energy: null, power: null, might: null,
    })) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function runtime() {
  return createEngineRuntime({
    matchId: "RIFT-1152-champion-zone",
    decks: [deck("A"), deck("B")],
    seed: "RIFT-1152-champion-zone",
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    programs: [rumble],
    printedCatalog: [{
      id: champion!.id,
      canonicalCardId: champion!.canonicalCardId,
      cardType: champion!.cardType,
      domains: champion!.domains,
      energy: champion!.energy,
      power: champion!.power,
    }],
  }).start();
}

function championObjects(projection: ReturnType<ReturnType<typeof runtime>["projectFor"]>, player: string) {
  return projection.zones
    .filter(zone => zone.zone === "champion" && zone.ownerPlayerId === player)
    .flatMap(zone => zone.objects ?? []);
}

function endTurn(game: ReturnType<typeof runtime>, player: "A" | "B", stateVersion: number) {
  const result = game.submit(player, {
    type: "end-turn", commandId: `RIFT-1152-end-${player}-${stateVersion}`, stateVersion,
  });
  expect(result.receipt.status).toBe("accepted");
  return result;
}

function chargeFour(game: ReturnType<typeof runtime>) {
  const initial = game.projectFor("A");
  const available = initial.objects.filter(object => object.ownerPlayerId === "A" && object.zone === "rune-zone");
  if (available.length < 2) {
    throw new Error(`Expected two projected Runes before the first charge; got ${available.length}`);
  }
  let charged: RuntimeSubmitResult = { receipt: {
    commandId: "initial", status: "accepted", stateVersion: initial.stateVersion,
    eventSeq: initial.eventSeq,
  }, projection: initial };
  for (let index = 0; index < 2; index += 1) {
    const sourceRune = charged.projection.objects.find(object =>
      object.ownerPlayerId === "A" && object.zone === "rune-zone" && !object.exhausted)!;
    charged = game.submit("A", {
      type: "rune-energy", commandId: `RIFT-1152-energy-${index + 1}`,
      stateVersion: charged.projection.stateVersion,
      runeObjectId: sourceRune.objectId, zoneEntryId: sourceRune.zoneEntryId!,
    });
    if (charged.receipt.status !== "accepted") {
      throw new Error(`Rune activation rejected: ${charged.receipt.error}; rune=${JSON.stringify(sourceRune)}; phase=${charged.projection.phase}; priority=${JSON.stringify(charged.projection.priority)}`);
    }
    expect(charged.receipt.status).toBe("accepted");
  }
  const afterA = endTurn(game, "A", charged.projection.stateVersion).projection;
  const afterB = endTurn(game, "B", afterA.stateVersion);
  let current = afterB;
  expect(current.projection.activePlayerId).toBe("A");
  const ready = current.projection.objects.filter(object =>
    object.ownerPlayerId === "A" && object.zone === "rune-zone" && !object.exhausted);
  expect(ready).toHaveLength(4);
  for (let index = 0; index < 4; index += 1) {
    const sourceRune = current.projection.objects.find(object =>
      object.ownerPlayerId === "A" && object.zone === "rune-zone" && !object.exhausted)!;
    current = game.submit("A", {
      type: "rune-energy", commandId: `RIFT-1152-energy-next-${index + 1}`,
      stateVersion: current.projection.stateVersion,
      runeObjectId: sourceRune.objectId, zoneEntryId: sourceRune.zoneEntryId!,
    });
    expect(current.receipt.status).toBe("accepted");
  }
  expect(current.projection.players.find(player => player.playerId === "A")?.energy).toBe(4);
  return current.projection;
}

describe("RIFT-1152 Chosen Champion production projection and play", () => {
  it("projects each selected Champion publicly and offers its real Champion Zone play", () => {
    const game = runtime();
    for (const viewer of ["A", "B", null]) {
      const projection = game.projectFor(viewer);
      expect(projection.zones.filter(zone => zone.zone === "champion" && zone.objects?.length === 1))
        .toHaveLength(2);
      for (const player of ["A", "B"]) {
        expect(championObjects(projection, player)).toEqual([expect.objectContaining({
          cardId: champion!.canonicalCardId,
          name: champion!.fullName,
          faceDown: false,
          visibility: viewer === null ? "public" : viewer === player ? "owner-only" : "public",
        })]);
      }
    }
    const a = chargeFour(game);
    const current = championObjects(a, "A")[0];
    expect(current).toBeDefined();
    expect(a.actionOptions.plays).toContainEqual(expect.objectContaining({
      cardObjectId: current!.objectId,
      destination: { kind: "base", playerId: "A" },
      requiresDestination: true,
    }));
    expect(EVIDENCE.rules).toEqual(["103.3.a.1", "103.3.a.3", "108.3.d", "108.3.e", "112", "420.1.a"]);
  });

  it("plays the Champion Zone object through the V2 runtime and enters its selected destination", () => {
    const game = runtime();
    const before = chargeFour(game);
    const source = championObjects(before, "A")[0]!;
    const playable = before.actionOptions.plays.find(option => option.cardObjectId === source.objectId &&
      option.destination?.kind === "base");
    expect(playable).toBeDefined();
    const played = game.submit("A", {
      type: "play", commandId: "RIFT-1152-play", stateVersion: before.stateVersion,
      cardObjectId: source.objectId, destination: playable!.destination,
    });
    expect(played.receipt.status).toBe("accepted");
    expect(championObjects(played.projection, "A")).toEqual([]);
    expect(played.projection.objects).toContainEqual(expect.objectContaining({
      objectId: source.objectId,
      zone: "board",
      location: { kind: "base", playerId: "A" },
    }));
  }, 60_000);
});

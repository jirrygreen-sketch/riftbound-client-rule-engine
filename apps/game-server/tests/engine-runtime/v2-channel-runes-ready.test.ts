import { describe, expect, it } from "vitest";

// RIFT-1048: found in a real two-browser M1 smoke run on macOS. The V2 host
// channeled runes exhausted when the Channel Phase action carries no entry
// stipulation, so the first player could not take Energy on turn 1 and every
// newly channeled rune was unusable for its turn. CR 431.2.a: "By default,
// runes are channeled readied." Core Rules v1.5 (2026-10-09)
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// 315.3.b.1 (Channel Phase channels 2 runes), 431.2 (an effect may stipulate
// the entry state, e.g. "channel 1 rune exhausted").
import { readFileSync } from "node:fs";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
} from "../../src/engine-runtime/index.js";
import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command, V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import {
  buildM1Deck,
  type M1PreconId,
} from "../../../../packages/integration-tests/src/headless/decks.js";

function deck(id: M1PreconId, seat: "A" | "B"): EngineRuntimeDeck {
  const m1 = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
    readonly candidates: readonly {
      readonly id: string;
      readonly chosenChampion: string;
      readonly recommendedCardList: readonly {
        readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
        readonly canonicalCardId: string;
        readonly name: string;
        readonly quantity: number;
        readonly cardType: string;
        readonly domains: readonly string[];
      }[];
    };
  };
  const catalog = JSON.parse(readFileSync(new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url), "utf8")) as {
    readonly cards: readonly {
      readonly id: string;
      readonly canonicalCardId: string;
      readonly name: string;
      readonly cardType: string;
      readonly domains: readonly string[];
      readonly tags: readonly string[];
      readonly energy: number | null;
      readonly power: number | null;
      readonly might: number | null;
    }[];
  };
  const candidate = m1.candidates.find(value => value.id === id)!;
  const printings = new Map(catalog.cards.map(card => [card.canonicalCardId, card] as const));
  const domainSet = new Set(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
  const expand = (zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes") =>
    candidate.recommendedCardList.filter(entry => entry.zone === zone).flatMap(entry =>
      Array.from({ length: entry.quantity }, (_, index) => {
        const printed = printings.get(entry.canonicalCardId);
        if (!printed) throw new Error(`Missing M1 catalog card ${entry.canonicalCardId}`);
        const allowed = printed.domains.filter((domain): domain is "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" =>
          domainSet.has(domain));
        return {
          id: `${seat}:${zone}:${index}:${entry.canonicalCardId}`,
          cardId: entry.canonicalCardId,
          name: entry.name,
          types: [printed.cardType.toLowerCase()],
          tags: [...printed.tags],
          energy: zone === "runes" ? null : printed.energy,
          power: zone === "runes" || printed.power === null ? null : allowed,
          might: printed.might,
          domains: allowed,
        };
      }));
  return {
    mainDeck: expand("mainDeck"),
    runeDeck: expand("runes"),
    championLegend: expand("legend")[0]!,
    chosenChampion: expand("champion")[0]!,
    battlefields: expand("battlefields") as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function programs(decks: readonly EngineRuntimeDeck[]): readonly CardProgram[] {
  const cards = decks.flatMap(value => [
    ...value.mainDeck,
    ...value.runeDeck,
    value.championLegend,
    value.chosenChampion,
    ...value.battlefields,
  ]);
  const entries = cards.flatMap(card => {
    const program = card.cardId === null || card.cardId === undefined
      ? undefined : cardProgramsById.get(card.cardId);
    return program === undefined ? [] : [program as unknown as CardProgram];
  });
  return [...new Map(entries.map(program => [program.canonicalCardId, program])).values()];
}

function setup(matchId: string, seed: string): EngineRuntime {
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  return createEngineRuntime({
    matchId,
    roomId: matchId,
    decks,
    seed,
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    programs: programs(decks),
  }).start();
}

function submit(runtime: EngineRuntime, playerId: string, command: V2Command) {
  return runtime.submit(playerId, command).receipt;
}

function runes(view: V2Projection, playerId: string) {
  return view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

describe("RIFT-1048 V2 Channel Phase runes enter readied (CR 431.2.a)", () => {
  it("lets the first player take Energy from both freshly channeled runes on turn 1", () => {
    const runtime = setup("rift-1048-first", "RIFT-1048-seed-1");
    const view = runtime.projectFor("A");
    expect(view.turnNumber).toBe(1);
    expect(view.activePlayerId).toBe("A");
    const channeled = runes(view, "A");
    expect(channeled.length).toBe(2);
    expect(channeled.every(rune => rune.exhausted === false)).toBe(true);
    for (const [index, rune] of channeled.entries()) {
      const receipt = submit(runtime, "A", {
        type: "rune-energy", commandId: `rift-1048-energy-${index}`,
        stateVersion: runtime.projectFor("A").stateVersion,
        runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
      });
      expect(receipt.status, receipt.error).toBe("accepted");
    }
    expect(runtime.projectFor("A").players.find(player => player.playerId === "A")?.energy).toBe(2);
  });

  it("channels the second player's first-turn runes readied as well", () => {
    const runtime = setup("rift-1048-second", "RIFT-1048-seed-2");
    const ended = submit(runtime, "A", { type: "end-turn", commandId: "rift-1048-end-1",
      stateVersion: runtime.projectFor(null).stateVersion });
    expect(ended.status, ended.error).toBe("accepted");
    const view = runtime.projectFor("B");
    expect(view.activePlayerId).toBe("B");
    const channeled = runes(view, "B");
    expect(channeled.length).toBeGreaterThan(0);
    expect(channeled.every(rune => rune.exhausted === false)).toBe(true);
  });
});

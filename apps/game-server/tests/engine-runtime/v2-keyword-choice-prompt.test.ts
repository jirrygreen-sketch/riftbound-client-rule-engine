import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import forecaster from "../../../../packages/card-dsl/dist/cards/sfd/forecaster.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Command } from "../../../../packages/protocol/dist/v2/index.js";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
} from "../../src/engine-runtime/index.js";

type M1DeckId = "rumble-sfd" | "fiora-sfd";

interface M1Entry {
  readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
  readonly canonicalCardId: string;
  readonly name: string;
  readonly quantity: number;
  readonly cardType: string;
  readonly domains: readonly string[];
}

interface M1Candidate {
  readonly id: M1DeckId;
  readonly chosenChampion: string;
  readonly recommendedCardList: readonly M1Entry[];
}

interface CatalogCard {
  readonly canonicalCardId: string;
  readonly name: string;
  readonly cardType: string;
  readonly domains: readonly string[];
  readonly tags: readonly string[];
  readonly energy: number | null;
  readonly power: number | null;
  readonly might: number | null;
}

const FORECASTER = "card.hash-cdeb1c4bb2202d43d0f4ccb7c3e0ddfa25caf4f81c41dde5c8bdaa6bbeddfe40";
const VISION_PROMPT = "Vision: Look at the top card of your Main Deck. Select it to recycle it; leave it unselected to keep it on top.";
const m1 = JSON.parse(readFileSync(new URL("../../../../docs/plans/m1-decks.json", import.meta.url), "utf8")) as {
  readonly candidates: readonly M1Candidate[];
};
const catalog = JSON.parse(readFileSync(new URL("../../../../packages/card-data/data/deck-catalog.json", import.meta.url), "utf8")) as {
  readonly cards: readonly CatalogCard[];
};
const printings = new Map(catalog.cards.map(card => [card.canonicalCardId, card] as const));
const domainNames = new Set(["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]);
let serial = 0;

function deck(id: M1DeckId, seat: "A" | "B"): EngineRuntimeDeck {
  const candidate = m1.candidates.find(value => value.id === id);
  if (candidate === undefined) throw new Error(`Missing M1 candidate ${id}`);
  const expand = (zone: M1Entry["zone"]) => candidate.recommendedCardList
    .filter(entry => entry.zone === zone)
    .flatMap(entry => Array.from({ length: entry.quantity }, () => {
      const printed = printings.get(entry.canonicalCardId);
      if (printed === undefined) throw new Error(`Missing M1 catalog card ${entry.canonicalCardId}`);
      const domains = printed.domains.filter((domain): domain is "Fury" | "Calm" | "Mind" | "Body" | "Chaos" | "Order" =>
        domainNames.has(domain));
      return {
        id: `${seat}:${zone}:${serial++}:${entry.canonicalCardId}`,
        cardId: entry.canonicalCardId,
        canonicalCardId: entry.canonicalCardId,
        name: printed.name,
        types: [printed.cardType.toLowerCase()],
        tags: [...printed.tags],
        domains: zone === "battlefields" ? [] : domains,
        energy: zone === "runes" ? null : printed.energy,
        power: zone === "runes" || printed.power === null ? null : domains,
        might: printed.might,
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

function setup(): EngineRuntime {
  serial = 0;
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  return createEngineRuntime({
    matchId: "RIFT-1101-keyword-choice-prompts",
    roomId: "RIFT-1101-keyword-choice-prompts",
    decks,
    seed: "RIFT-1101-keyword-choice-prompts",
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    programs: [forecaster satisfies CardProgram],
  }).start();
}

function command(commandId: string, stateVersion: number, fields: Record<string, unknown>): V2Command {
  return { commandId, stateVersion, ...fields } as V2Command;
}

function hand(runtime: EngineRuntime, playerId: "A" | "B") {
  return runtime.projectFor(playerId).zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function fundForecaster(runtime: EngineRuntime): void {
  const view = runtime.projectFor("A");
  const runes = (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "A")?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined)
    .slice(0, 2);
  expect(runes).toHaveLength(2);
  for (const [index, rune] of runes.entries()) {
    const result = runtime.submit("A", command(`forecaster:energy:${index}`, runtime.projectFor("A").stateVersion, {
      type: "rune-energy", runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId,
    }));
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
  }
}

function playForecaster(runtime: EngineRuntime) {
  const view = runtime.projectFor("A");
  const card = hand(runtime, "A").find(object => object.cardId === FORECASTER);
  expect(card, JSON.stringify(view.zones)).toBeDefined();
  return runtime.submit("A", command("play-forecaster", view.stateVersion, {
    type: "play", cardObjectId: card!.objectId, destination: { kind: "base", playerId: "A" },
  }));
}

function passUntilVisionChoice(runtime: EngineRuntime) {
  for (let index = 0; index < 8; index += 1) {
    const view = runtime.projectFor(null);
    if (view.pendingChoice.status === "pending") return;
    const actor = view.chain.priorityPlayerId ?? view.priority.playerId;
    expect(actor, JSON.stringify(view)).not.toBeNull();
    const result = runtime.submit(actor!, command(`vision:pass:${index}`, view.stateVersion, { type: "pass" }));
    expect(["accepted", "pending"], JSON.stringify(result.receipt)).toContain(result.receipt.status);
  }
  throw new Error("The real Forecaster Vision trigger did not reach a choice");
}

describe("RIFT-1101 V2 keyword choice prompts", () => {
  it("explains that selecting Forecaster's Vision pick recycles it and leaving it unselected keeps it on top", () => {
    const runtime = setup();
    fundForecaster(runtime);
    const played = playForecaster(runtime);
    expect(["accepted", "pending"], JSON.stringify(played.receipt)).toContain(played.receipt.status);
    passUntilVisionChoice(runtime);

    const chooser = runtime.projectFor("A");
    expect(chooser.pendingChoice).toMatchObject({
      status: "pending",
      kind: "select-objects",
      ownerPlayerId: "A",
      choiceId: expect.stringMatching(/^vision-look(?:\/[^/]+)?\/effect\.inspect%3Aselect%3AA%3AA%3Adeck$/u),
    });
    if (chooser.pendingChoice.status !== "pending") throw new Error("Forecaster Vision choice is missing");
    expect(chooser.pendingChoice.prompt).toBe(VISION_PROMPT);
    expect(chooser.pendingChoice.options).toHaveLength(1);

    const opponent = runtime.projectFor("B").pendingChoice;
    expect(opponent).toMatchObject({ status: "pending", ownerPlayerId: "A", kind: "select-objects" });
    expect(opponent).not.toHaveProperty("prompt");
    expect(opponent).not.toHaveProperty("options");
    const spectator = runtime.projectFor(null).pendingChoice;
    expect(spectator).toMatchObject({ status: "pending", ownerPlayerId: "A", kind: "select-objects" });
    expect(spectator).not.toHaveProperty("prompt");
    expect(spectator).not.toHaveProperty("options");

    const answered = runtime.submit("A", command("vision:keep", chooser.stateVersion, {
      type: "choose", choiceId: chooser.pendingChoice.choiceId, answer: [],
    }));
    expect(answered.receipt.status, JSON.stringify(answered.receipt)).toBe("accepted");
    expect(answered.projection.pendingChoice).toEqual({ status: "none" });
  }, 180_000);
});

import { describe, expect, it } from "vitest";
import { isV2Projection, type V2ChoiceAnswer, type V2Command, type V2Projection }
  from "../../../../packages/protocol/dist/v2/index.js";
import forecaster from "../../../../packages/card-dsl/dist/cards/sfd/forecaster.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import { readFileSync } from "node:fs";
import { createEngineRuntime, type EngineRuntime, type EngineRuntimeDeck }
  from "../../src/engine-runtime/index.js";

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
  const candidate = m1.candidates.find(value => value.id === id)!;
  const expand = (zone: M1Entry["zone"]) => candidate.recommendedCardList
    .filter(entry => entry.zone === zone)
    .flatMap(entry => Array.from({ length: entry.quantity }, () => {
      const printed = printings.get(entry.canonicalCardId);
      if (printed === undefined) throw new Error(`Missing M1 card ${entry.canonicalCardId}`);
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

const programs: readonly CardProgram[] = [forecaster satisfies CardProgram];

function setup(seed = "RIFT-1079-Vision-73"): EngineRuntime {
  serial = 0;
  const decks = [deck("rumble-sfd", "A"), deck("fiora-sfd", "B")] as const;
  // M1 setup first shuffles each Rune Deck, then each Main Deck. This fixed
  // seed puts the real forecaster precon card in A's opening hand.
  return createEngineRuntime({
    matchId: "RIFT-1079-keyword-trigger-order-labels",
    roomId: "RIFT-1079-keyword-trigger-order-labels",
    decks,
    seed,
    firstPlayer: "A",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    programs,
  }).start();
}

function submit(runtime: EngineRuntime, playerId: "A" | "B", command: V2Command) {
  return runtime.submit(playerId, command);
}

function hand(view: V2Projection, playerId: "A" | "B") {
  return view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === playerId)?.objects ?? [];
}

function readyRunes(view: V2Projection, playerId: "A" | "B") {
  return (view.zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === playerId)?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined);
}

function playForecaster(runtime: EngineRuntime, copy = 0, fund = true, prefix = "first") {
  const opening = runtime.projectFor("A");
  const forecaster = hand(opening, "A").filter(card => card.cardId === FORECASTER)[copy];
  expect(forecaster, JSON.stringify(opening.zones)).toBeDefined();
  for (const [index, rune] of (fund ? readyRunes(opening, "A").slice(0, 2) : []).entries()) {
    const result = submit(runtime, "A", {
      type: "rune-energy", commandId: `${prefix}-energy-${index}`, stateVersion: runtime.projectFor("A").stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    });
    expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
  }
  const view = runtime.projectFor("A");
  const current = hand(view, "A").filter(card => card.cardId === FORECASTER)[copy]!;
  const played = submit(runtime, "A", {
    type: "play", commandId: `play-forecaster-${prefix}`, stateVersion: view.stateVersion,
    cardObjectId: current.objectId, destination: { kind: "base", playerId: "A" },
  });
  expect(["accepted", "pending"], JSON.stringify(played.receipt)).toContain(played.receipt.status);
  return played;
}

function finishTurn(runtime: EngineRuntime, prefix: string): void {
  const view = runtime.projectFor(null);
  const ended = submit(runtime, view.activePlayerId, {
    type: "end-turn", commandId: `${prefix}:end-turn`, stateVersion: view.stateVersion,
  });
  expect(ended.receipt.status, JSON.stringify(ended.receipt)).toBe("accepted");
}

function resolveVision(runtime: EngineRuntime, prefix: string): void {
  for (let index = 0; index < 24; index += 1) {
    const view = runtime.projectFor(null);
    if (view.pendingChoice.status === "pending") {
      const owner = view.pendingChoice.ownerPlayerId;
      const ownerView = runtime.projectFor(owner);
      if (ownerView.pendingChoice.status !== "pending") throw new Error("Pending Vision was not projected to its owner");
      const answered = submit(runtime, ownerView.viewerPlayerId!, {
        type: "choose", commandId: `${prefix}:choice:${index}`, stateVersion: ownerView.stateVersion,
        choiceId: ownerView.pendingChoice.choiceId, answer: [],
      });
      expect(answered.receipt.status, JSON.stringify(answered.receipt)).toBe("accepted");
      continue;
    }
    if (view.chain.items.length === 0) return;
    const actor = view.chain.priorityPlayerId;
    expect(actor, JSON.stringify(view)).not.toBeNull();
    const passed = submit(runtime, actor!, {
      type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: view.stateVersion,
    });
    expect(["accepted", "pending"], JSON.stringify(passed.receipt)).toContain(passed.receipt.status);
  }
  throw new Error(`Vision chain did not settle for ${prefix}`);
}

function triggerOrder(view: V2Projection) {
  expect(view.pendingChoice).toMatchObject({ status: "pending", kind: "mode" });
  if (view.pendingChoice.status !== "pending") throw new Error("Expected trigger-order mode");
  expect(view.pendingChoice.choiceId).toMatch(/^trigger:\d+:A:order:\d+$/u);
  return view.pendingChoice;
}

function answer(runtime: EngineRuntime, view: V2Projection, value: V2ChoiceAnswer) {
  if (view.pendingChoice.status !== "pending") throw new Error("Expected pending choice");
  return submit(runtime, "A", {
    type: "choose", commandId: `answer-${view.pendingChoice.choiceId}`,
    stateVersion: view.stateVersion, choiceId: view.pendingChoice.choiceId, answer: value,
  });
}

describe("RIFT-1079 keyword trigger-order labels", () => {
  it("labels both real Forecaster Vision instances without changing ids, privacy, or answers", () => {
    const runtime = setup();
    // This real M1 seed puts two Forecaster copies in the opening hand. The
    // first is played; the second remains held across the real turn cycle.
    playForecaster(runtime);
    // The first copy enters through the real V2 Play lifecycle. Resolve its
    // Vision, then return to A's next Main with the second copy still held.
    resolveVision(runtime, "first-forecaster");
    finishTurn(runtime, "first-forecaster-b");
    finishTurn(runtime, "second-forecaster-a");
    const remaining = hand(runtime.projectFor("A"), "A").filter(card => card.cardId === FORECASTER);
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    const energy = readyRunes(runtime.projectFor("A"), "A");
    for (const [index, rune] of energy.entries()) {
      const funded = submit(runtime, "A", {
        type: "rune-energy", commandId: `second-forecaster-energy-${index}`,
        stateVersion: runtime.projectFor("A").stateVersion,
        runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
      });
      expect(funded.receipt.status, JSON.stringify(funded.receipt)).toBe("accepted");
    }
    const second = playForecaster(runtime, 0, false, "second");
    expect(second.receipt.status, JSON.stringify(second.receipt)).toBe("pending");
    const ownerChoice = triggerOrder(second.projection);
    expect(ownerChoice.choiceId).toMatch(/:order:0$/u);
    expect(ownerChoice.source).toEqual({
      objectId: expect.stringMatching(/^token:\d+$/u), name: "Forecaster",
    });
    const sourceObjectId = ownerChoice.source!.objectId!;
    const visionLabels = ownerChoice.options?.map(option => option.label)
      .filter(label => label.startsWith("Forecaster · Vision"));
    expect(visionLabels).toEqual([
      "Forecaster · Vision (trigger 1)",
      "Forecaster · Vision (trigger 2)",
    ]);
    const visionOptions = ownerChoice.options!.filter(option => option.label.startsWith("Forecaster · Vision"));
    expect(visionOptions.map(option => option.id).sort()).toEqual([
      expect.stringMatching(/^program-keyword-ability:.+:\d+:vision:printed-0:0$/u),
      expect.stringMatching(/^program-keyword-ability:.+:\d+:vision:printed-1:0$/u),
    ]);
    expect(visionOptions.every(option => option.id === option.value)).toBe(true);
    const publicChoice = runtime.projectFor(null).pendingChoice;
    expect(publicChoice).toMatchObject({ status: "pending", kind: "mode", ownerPlayerId: "A" });
    expect(publicChoice).not.toHaveProperty("source");
    expect(publicChoice).not.toHaveProperty("options");
    expect(publicChoice).not.toHaveProperty("prompt");

    const selected = answer(runtime, second.projection, visionOptions[0]!.value!);
    expect(["accepted", "pending"], JSON.stringify(selected.receipt)).toContain(selected.receipt.status);
    if (selected.receipt.status === "pending" && selected.projection.pendingChoice.kind === "mode") {
      const next = triggerOrder(selected.projection);
      expect(next.source).toEqual({ objectId: sourceObjectId, name: "Forecaster" });
      expect(next.options?.some(option => option.label.startsWith("Forecaster · Vision"))).toBe(true);
      expect(next.options?.some(option => option.id === visionOptions[0]!.id)).toBe(false);
    }
  }, 180_000);
});

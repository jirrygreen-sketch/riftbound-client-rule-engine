import { describe, expect, it } from "vitest";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
} from "../../src/engine-runtime/index.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";
import { projectRuntime } from "../../src/engine-runtime/projection.js";
import type { Match } from "../../../../packages/engine-core/dist/game/lifecycle.js";

const GEAR = "rift-1056:gear";
const UNIT = "rift-1056:unit";

function program(cardId: string): CardProgram {
  return {
    canonicalCardId: cardId,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: "RIFT-1056 destination fixture",
    abilities: [{ kind: "play", cost: { energy: { kind: "constant", value: 0 } }, body: [] }],
  };
}

function card(id: string, cardId: string, name: string, types: readonly string[]) {
  return { id, cardId, canonicalCardId: cardId, name, types, tags: [], energy: 0, power: null, might: null };
}

function deck(seat: "A" | "B"): EngineRuntimeDeck {
  return {
    mainDeck: Array.from({ length: 39 }, (_, index) => index % 2 === 0
      ? card(`${seat}:gear:${index}`, GEAR, "Destination Gear", ["gear"])
      : card(`${seat}:unit:${index}`, UNIT, "Destination Unit", ["unit"])),
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:rune:${index}`, cardId: `${seat}:rune-card:${index}`, name: "Mind Rune",
      types: ["rune"], tags: ["Basic"], energy: null, power: null, domains: ["Mind"],
    })),
    championLegend: { id: `${seat}:legend`, cardId: `${seat}:legend-card`, name: "Legend", types: ["legend"] },
    chosenChampion: { id: `${seat}:champion`, cardId: `${seat}:champion-card`, name: "Champion", types: ["champion"] },
    battlefields: [0, 1, 2].map(index => ({
      id: `${seat}:field:${index}`, cardId: `${seat}:field-card:${index}`, name: `Field ${index}`, types: ["battlefield"],
    })) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function setup(): EngineRuntime {
  return createEngineRuntime({
    matchId: "RIFT-1056-play-destinations", roomId: "RIFT-1056-play-destinations",
    decks: [deck("A"), deck("B")], seed: "RIFT-1056-play-destinations", firstPlayer: "A",
    battlefieldChoice: [0, 0], mulligans: [[], []], programs: [program(GEAR), program(UNIT)],
  }).start();
}

function hand(view: V2Projection, cardId: string) {
  return (view.zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects ?? [])
    .find(object => object.cardId === cardId);
}

function assertRealMainWindow(runtime: EngineRuntime): void {
  // This fixture's printed costs are 0. Read the real Main/Priority window;
  // no resource or state fields are set.
  expect(runtime.projectFor("A").actionOptions.canEndTurn).toBe(true);
}

describe("RIFT-1056 V2 permanent play destinations", () => {
  it("offers a non-Unit Gear only at its controller Base", () => {
    const runtime = setup();
    assertRealMainWindow(runtime);
    const view = runtime.projectFor("A");
    const source = hand(view, GEAR);
    expect(source).toBeDefined();
    expect(view.actionOptions.plays.filter(option => option.cardObjectId === source!.objectId)
      .map(option => option.destination)).toEqual([{ kind: "base", playerId: "A" }]);
    expect(view.actionOptions.plays.filter(option => option.cardObjectId === source!.objectId)
      .every(option => option.destination.kind !== "battlefield")).toBe(true);
  });

  it("offers a Unit no foreign or uncontrolled Battlefield", () => {
    const runtime = setup();
    assertRealMainWindow(runtime);
    const view = runtime.projectFor("A");
    const source = hand(view, UNIT);
    expect(source).toBeDefined();
    expect(view.battlefields.every(field => field.controllerPlayerId !== "A")).toBe(true);
    expect(view.actionOptions.plays.filter(option => option.cardObjectId === source!.objectId)
      .map(option => option.destination)).toEqual([{ kind: "base", playerId: "A" }]);
  });

  it("keeps an active Unit Base alongside an explicit battlefield permission", () => {
    const runtime = setup();
    const match = (runtime as unknown as { readonly match: Match }).match;
    const source = hand(runtime.projectFor("A"), UNIT)!;
    const rawSource = match.flow.chain.pipeline.host.objects().find(object => object.ref.id === source.objectId)!;
    const field = match.flow.battlefields[0]!;
    match.flow.chain.layers.addContinuous({
      id: "rift-1056:explicit-unit-location",
      layer: "ability",
      source: rawSource.ref,
      filter: { objectRefs: [rawSource.ref] },
      effect: {
        kind: "location", permission: "any-battlefield",
        location: { type: "battlefield", id: field.id },
        objectRefs: [rawSource.ref],
      },
    }, { type: "permanent" });
    const view = projectRuntime(match, (runtime as unknown as { readonly host: EngineRuntimeHost }).host,
      "RIFT-1056-play-destinations", "A", runtime.projectFor(null).stateVersion, null);
    expect(view.actionOptions.plays.filter(option => option.cardObjectId === source.objectId)
      .map(option => option.destination)).toEqual([
      { kind: "base", playerId: "A" },
      { kind: "battlefield", battlefieldId: field.id },
    ]);
  });

  it("rejects a foreign Base before the command changes runtime state", () => {
    const runtime = setup();
    assertRealMainWindow(runtime);
    const view = runtime.projectFor("A");
    const source = hand(view, UNIT)!;
    const rejected = runtime.submit("A", {
      type: "play", commandId: "foreign-base", stateVersion: view.stateVersion,
      cardObjectId: source.objectId, destination: { kind: "base", playerId: "B" },
    });
    expect(rejected.receipt).toMatchObject({ status: "rejected" });
    expect(rejected.receipt.error).toMatch(/controller's Base/);
    expect(runtime.projectFor("A").stateVersion).toBe(view.stateVersion);
    expect(runtime.projectFor("A").eventSeq).toBe(view.eventSeq);
  });
});

import { describe, expect, it } from "vitest";

import { cardProgramsById } from "../../../../packages/card-dsl/dist/cards/registry.generated.js";
import type { CardProgram } from "../../../../packages/card-dsl/dist/ir/index.js";
import type { Domain } from "../../../../packages/engine-core/dist/effects/contract.js";
import type { Match } from "../../../../packages/engine-core/dist/game/lifecycle.js";
import type { V2Projection } from "../../../../packages/protocol/dist/v2/index.js";
import {
  createEngineRuntime,
  type EngineRuntime,
  type EngineRuntimeDeck,
} from "../../src/engine-runtime/index.js";
import { EngineRuntimeHost } from "../../src/engine-runtime/host.js";

// Official evidence:
// - Riftbound Core Rules v1.5, published 2026-10-09, effective 2026-10-16:
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - 143.2.a defines current Might as Effective Might; 475-478.4 establish the
//   Layer calculation. 478.1 keeps an applicable continuous effect active and
//   317.2.c expires a "this turn" effect in the Ending cleanup.
// - sfd-089-221 Rumble, Scrapper: "Your Mechs have +1 :rb_might: (including
//   me)." The production CardPrograms below are loaded from the generated
//   registry; this test does not duplicate their rules bodies.
const EVIDENCE = Object.freeze({
  rules: ["143.2.a", "317.2.c", "475", "478", "478.1", "478.2", "478.3", "478.4"],
  rumble: "card.hash-01bd7d3ff52eabd0afc59248a33845b648d9f61db8b544052f51057f967ceb7c",
});
const RUMBLE = EVIDENCE.rumble;
const BUDDY = "card.hash-34880fcae16bd9461e4c318dfb455365ff9e353db357f948b4a15dea7e01b389";
const DISCIPLINE = "card.hash-a1b14db94434084b789c0069291250652a46b455cbb2b5c347c9231af8ac51b5";
const TARGET = "rift-1176:target";

const targetProgram: CardProgram = {
  canonicalCardId: TARGET,
  rulesetVersion: "core-1.5",
  status: "executable",
  sourceText: "Synthetic zero-cost target Unit for the current-Might room regression.",
  abilities: [{ kind: "play", cost: { kind: "explicit", energy: { kind: "constant", value: 0 } }, body: [] }],
};
const programs: readonly CardProgram[] = [RUMBLE, BUDDY, DISCIPLINE].flatMap(cardId => {
  const program = cardProgramsById.get(cardId);
  return program === undefined ? [] : [program as unknown as CardProgram];
}).concat(targetProgram);
const printedCatalog = [
  { id: "sfd-089-221", canonicalCardId: RUMBLE, cardType: "Unit", domains: ["Mind"] as Domain[], energy: 5, power: 1 },
  { id: "sfd-062-221", canonicalCardId: BUDDY, cardType: "Unit", domains: ["Mind"] as Domain[], energy: 3, power: null },
  { id: "ogn-058-298", canonicalCardId: DISCIPLINE, cardType: "Spell", domains: ["Calm"] as Domain[], energy: 2, power: null },
  { id: "rift-1176-target", canonicalCardId: TARGET, cardType: "Unit", domains: ["Mind"] as Domain[], energy: 0, power: null },
] as const;

function runtimeCard(
  seat: "A" | "B", id: string, cardId: string, name: string, types: readonly string[], energy: number, might: number | null,
) {
  return { id: `${seat}:${id}`, cardId, name, types, tags: ["Mech"], energy, power: null, might };
}

function deck(seat: "A" | "B", online: boolean): EngineRuntimeDeck {
  const mainDeck = online ? [
    ...Array.from({ length: 8 }, (_, index) => runtimeCard(seat, `rumble:${index}`, RUMBLE, "Rumble, Scrapper", ["unit"], 5, 4)),
    ...Array.from({ length: 12 }, (_, index) => runtimeCard(seat, `buddy:${index}`, BUDDY, "Bubble Bot", ["unit"], 3, 3)),
    ...Array.from({ length: 10 }, (_, index) => runtimeCard(seat, `discipline:${index}`, DISCIPLINE, "Discipline", ["spell"], 2, null)),
    ...Array.from({ length: 10 }, (_, index) => runtimeCard(seat, `target:${index}`, TARGET, "Target Unit", ["unit"], 0, 3)),
  ] : Array.from({ length: 40 }, (_, index) => runtimeCard(seat, `target:${index}`, TARGET, "Target Unit", ["unit"], 0, 3));
  return {
    mainDeck,
    runeDeck: Array.from({ length: 12 }, (_, index) => ({
      id: `${seat}:rune:${index}`, cardId: `${seat}:rune-card:${index}`, name: "Mind Rune",
      types: ["rune"], tags: ["Basic"], domains: ["Mind"] as Domain[], energy: null, power: null, might: null,
    })),
    championLegend: {
      id: `${seat}:legend`, cardId: `${seat}:legend-card`, name: "Legend", types: ["legend"],
      tags: [], energy: null, power: null, might: null,
    },
    chosenChampion: runtimeCard(seat, "champion", TARGET, "Target Unit", ["unit"], 0, 3),
    battlefields: [0, 1, 2].map(index => ({
      id: `${seat}:field:${index}`, cardId: `${seat}:field-card:${index}`, name: `Field ${index}`,
      types: ["battlefield"], tags: [], energy: null, power: null, might: null,
    })) as unknown as EngineRuntimeDeck["battlefields"],
  };
}

function runtime(seed = "RIFT-1176-runtime"): EngineRuntime {
  return createEngineRuntime({
    matchId: seed, roomId: seed,
    decks: [deck("A", true), deck("B", false)], seed,
    firstPlayer: "A", battlefieldChoice: [0, 0], mulligans: [[], []],
    programs, printedCatalog,
  }).start();
}

function internals(game: EngineRuntime): { readonly match: Match; readonly host: EngineRuntimeHost } {
  return game as unknown as { readonly match: Match; readonly host: EngineRuntimeHost };
}

function submit(game: EngineRuntime, actor: "A" | "B", command: Parameters<EngineRuntime["submit"]>[1]) {
  const result = game.submit(actor, command);
  expect(result.receipt.status, JSON.stringify(result.receipt)).toBe("accepted");
  return result;
}

function settle(game: EngineRuntime, prefix: string): V2Projection {
  for (let index = 0; index < 20; index += 1) {
    const view = game.projectFor(null);
    if (view.chain.items.length === 0) return view;
    const actor = view.chain.priorityPlayerId;
    if (actor === null) throw new Error(`${prefix}: Chain has no Priority holder`);
    submit(game, actor as "A" | "B", {
      type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: view.stateVersion,
    });
  }
  throw new Error(`${prefix}: Chain did not settle`);
}

function hand(game: EngineRuntime, cardId: string) {
  return (game.projectFor("A").zones.find(zone => zone.zone === "hand" && zone.ownerPlayerId === "A")?.objects ?? [])
    .find(object => object.cardId === cardId);
}

function playPermanent(game: EngineRuntime, cardId: string, commandId: string): string {
  const source = hand(game, cardId);
  if (source === undefined) throw new Error(`${commandId}: ${cardId} is not in the initial hand`);
  submit(game, "A", {
    type: "play", commandId, stateVersion: game.projectFor("A").stateVersion,
    cardObjectId: source.objectId, destination: { kind: "base", playerId: "A" },
  });
  settle(game, commandId);
  return source.objectId;
}

function readyRunes(game: EngineRuntime) {
  return (game.projectFor("A").zones.find(zone => zone.zone === "rune-zone" && zone.ownerPlayerId === "A")?.objects ?? [])
    .filter(rune => rune.exhausted === false && rune.zoneEntryId !== undefined);
}

function advanceUntilReadyRunes(game: EngineRuntime, count: number, prefix: string): void {
  for (let index = 0; index < 12; index += 1) {
    const view = game.projectFor("A");
    if (view.activePlayerId === "A" && view.actionOptions.canEndTurn && readyRunes(game).length >= count) return;
    const publicView = game.projectFor(null);
    submit(game, publicView.activePlayerId as "A" | "B", {
      type: "pass", commandId: `${prefix}:${index}`, stateVersion: publicView.stateVersion,
    });
  }
  throw new Error(`${prefix}: A did not reach a Main Phase with ${count} ready Runes`);
}

function fund(game: EngineRuntime, count: number, prefix: string): void {
  for (let index = 0; index < count; index += 1) {
    const rune = readyRunes(game)[0];
    if (rune === undefined) throw new Error(`${prefix}: no ready Rune`);
    submit(game, "A", {
      type: "rune-energy", commandId: `${prefix}:${index}`,
      stateVersion: game.projectFor("A").stateVersion,
      runeObjectId: rune.objectId, zoneEntryId: rune.zoneEntryId!,
    });
  }
}

function finishTurnCycle(game: EngineRuntime, prefix: string): void {
  submit(game, game.projectFor(null).activePlayerId as "A" | "B", {
    type: "end-turn", commandId: prefix, stateVersion: game.projectFor(null).stateVersion,
  });
  for (let index = 0; index < 4 && game.projectFor("A").activePlayerId !== "A"; index += 1) {
    const view = game.projectFor(null);
    submit(game, view.activePlayerId as "A" | "B", {
      type: "pass", commandId: `${prefix}:pass:${index}`, stateVersion: view.stateVersion,
    });
  }
}

function projectedMight(view: V2Projection, objectId: string): number | undefined {
  return view.objects.find(object => object.objectId === objectId)?.might;
}

describe("RIFT-1176 real room current Might", () => {
  it("projects Rumble and another friendly Mech at current Might and restores it after Rumble leaves", () => {
    expect(EVIDENCE.rules).toContain("478.2");
    const game = runtime("RIFT-1176-aura-runtime");
    advanceUntilReadyRunes(game, 8, "RIFT-1176:aura-wait");
    fund(game, 3, "RIFT-1176:buddy-fund");
    const buddyId = playPermanent(game, BUDDY, "RIFT-1176:play-buddy");
    fund(game, 5, "RIFT-1176:aura-fund");
    const rumbleId = playPermanent(game, RUMBLE, "RIFT-1176:play-rumble");
    const own = game.projectFor("A");
    expect(projectedMight(own, rumbleId)).toBe(5);
    expect(projectedMight(own, buddyId)).toBe(4);
    expect(projectedMight(game.projectFor("B"), rumbleId)).toBe(5);
    expect(projectedMight(game.projectFor("B"), buddyId)).toBe(4);

    const { host, match } = internals(game);
    const rumble = host.objects().find(object => object.ref.id === rumbleId)!;
    expect(host.perform({ type: "return-to-hand", object: rumble.ref }).status).toBe("done");
    const after = game.projectFor("A");
    expect(projectedMight(after, buddyId)).toBe(3);
    expect(projectedMight(after, rumbleId)).toBe(4);
    expect(after.objects.find(object => object.cardId === BUDDY)?.might).toBe(3);
    expect(match.rulesetVersion).toBe("core-1.5");
  }, 120_000);

  it("projects a temporary +2 Might spell until the real End of Turn cleanup", () => {
    const game = runtime("RIFT-1176-temporary-runtime");
    const targetId = playPermanent(game, TARGET, "RIFT-1176:play-target");
    advanceUntilReadyRunes(game, 2, "RIFT-1176:temporary-wait");
    fund(game, 2, "RIFT-1176:temporary-fund");
    const own = game.projectFor("A");
    const spell = hand(game, DISCIPLINE);
    if (spell === undefined) throw new Error("Discipline is not in hand");
    const option = own.actionOptions.plays.find(candidate => candidate.cardObjectId === spell.objectId);
    if (option === undefined) throw new Error("Discipline lacks a legal projection option");
    const target = option.targetRequirements?.[0]?.options.find(candidate => candidate.objectRef?.objectId === targetId);
    if (target?.objectRef === undefined) throw new Error("Target Unit is absent from the spell target projection");
    submit(game, "A", {
      type: "play", commandId: "RIFT-1176:play-discipline", stateVersion: own.stateVersion,
      cardObjectId: spell.objectId,
      targets: [{ kind: "object", objectId: target.objectRef.objectId, zoneEntryId: target.objectRef.zoneEntryId }],
    });
    settle(game, "RIFT-1176:play-discipline");
    expect(projectedMight(game.projectFor("A"), targetId)).toBe(5);
    finishTurnCycle(game, "RIFT-1176:temporary-end");
    expect(projectedMight(game.projectFor("A"), targetId)).toBe(3);
  }, 120_000);
});

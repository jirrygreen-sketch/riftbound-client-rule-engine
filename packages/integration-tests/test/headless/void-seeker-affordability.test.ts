import { describe, expect, it } from "vitest";
import voidSeeker from "../../../card-dsl/dist/cards/ogn/void-seeker.js";
import type { CardProgram } from "../../../card-dsl/dist/ir/types.js";
import { createMatch, type Match } from "../../../engine-core/dist/game/lifecycle.js";
import { AwaitChoice } from "../../../engine-core/dist/effects/contract.js";
import { world } from "../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../engine-core/dist/programs/index.js";
import { buildM1Deck } from "../../src/headless/decks.js";
import {
  prioritizedHeadlessCommands,
  type HeadlessCommand,
  type HeadlessCommandTrace,
} from "../../src/headless/duel.js";

const VOID_SEEKER_REF = Object.freeze({ id: "void-seeker", zoneEntryId: 3 });
const VOID_SEEKER_CANONICAL = "card.hash-600e0796e82099284b213e87b112b1c5df42777ef72b70a3b4cd49a84d27dd10";
const VOID_SEEKER_PRINTED = Object.freeze({
  id: "ogn-024-298",
  canonicalCardId: VOID_SEEKER_CANONICAL,
  cardType: "Spell",
  domains: Object.freeze(["Fury"]),
  energy: 3,
  power: 1,
});

function voidSeekerCost(): { readonly energy: number; readonly power: readonly string[] } {
  const card = buildM1Deck("rumble-sfd", "A").mainDeck.find(candidate => candidate.name === "Void Seeker");
  expect(card).toBeDefined();
  expect(card!.energy).toBe(3);
  expect(card!.power).toBe(1);
  const power = card!.power;
  if (typeof power !== "number") throw new Error("Void Seeker catalog Power must be numeric");
  return { energy: card!.energy!, power: Array.from({ length: power }, () => "Fury") };
}

function syntheticDeck(seat: "A" | "B") {
  const card = (id: string, type: string) => ({
    id: `${seat}:${id}`,
    cardId: `synthetic:${seat}:${id}`,
    canonicalCardId: `synthetic:${seat}:${id}`,
    name: id,
    cardType: type,
    types: [type.toLowerCase()],
    energy: null,
    power: null,
    might: null,
  });
  return {
    mainDeck: Array.from({ length: 8 }, (_, index) => card(`main-${index}`, "Spell")),
    runeDeck: Array.from({ length: 8 }, (_, index) => card(`rune-${index}`, "Rune")),
    championLegend: card("legend", "Legend"),
    chosenChampion: card("champion", "Unit"),
    battlefields: [card("field-1", "Battlefield"), card("field-2", "Battlefield"), card("field-3", "Battlefield")] as const,
  };
}

function productionShowdown() {
  const kernel = world().player("A").player("B")
    .base("void-attacker", {
      owner: "A", controller: "A", types: ["unit"], energy: null, power: null, might: 4,
      location: { type: "base", player: "A" },
    })
    .base("void-defender", {
      owner: "B", controller: "B", types: ["unit"], energy: null, power: null, might: 3,
      location: { type: "base", player: "B" },
    })
    .hand("void-seeker", {
      cardId: VOID_SEEKER_CANONICAL,
      name: "Void Seeker",
      types: ["spell"],
      energy: 3,
      power: ["Fury"],
      might: null,
    })
    .build();
  type ChooseRequest = Parameters<NonNullable<ReturnType<typeof createActionPipelineHost>["choose"]>>[0];
  let choose = <T>(request: ChooseRequest): T => {
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      const checkpoint = saved as {
        readonly state: Parameters<typeof kernel.restore>[0];
        readonly links: Parameters<typeof kernel.copyLinkedFrom>[0];
      };
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose: request => choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
  });
  const binding = createProgramBinding({
    cardPrograms: [voidSeeker as unknown as CardProgram],
    printedCatalog: [VOID_SEEKER_PRINTED],
  });
  const match = createMatch({
    host: { ...host, player: id => kernel.player(id) },
    decks: [syntheticDeck("A"), syntheticDeck("B")],
    programs: binding,
    seed: "RIFT-1061-production-showdown",
    battlefieldChoice: [0, 0],
    mulligans: [[], []],
    firstPlayer: 0,
  });
  binding.attachLifecycle(match.flow.chain, error => { throw error; });
  const field = match.flow.battlefields[0]!.id;
  expect(match.flow.chain.commit({
    type: "move-location", object: kernel.ref("void-defender"), to: { type: "battlefield", id: field },
  }).status).toBe("done");
  match.flow.advance();
  expect(match.flow.chain.commit({
    type: "move-location", object: kernel.ref("void-attacker"), to: { type: "battlefield", id: field },
  }).status).toBe("done");
  match.flow.advance();
  expect(match.flow.chain.turnState).toBe("showdown-open");
  match.flow.chain.advance();
  expect(match.flow.chain.turnState).toBe("showdown-open");
  return { kernel, match };
}

function unpayableShowdownTrace(): HeadlessCommandTrace {
  const cost = voidSeekerCost();
  const play: HeadlessCommand = {
    type: "play",
    player: "A",
    object: VOID_SEEKER_REF,
    id: "headless:void-seeker",
  };
  return {
    turn: 9,
    turnPlayer: "A",
    phase: "main",
    priority: "A",
    focus: "A",
    turnState: "showdown-open",
    canActNormal: false,
    candidateCounts: {
      play: 1,
      idle: 0,
      pass: 0,
      advance: 0,
      move: 0,
      "rune-energy": 0,
      "combat-damage": 0,
      concede: 0,
    },
    boardUnits: [],
    basicRunes: [],
    runePool: { A: { energy: 0, power: [] }, B: { energy: 0, power: [] } },
    battlefields: [],
    candidates: [{
      type: "play",
      id: play.id,
      name: "Void Seeker",
      object: VOID_SEEKER_REF,
      energy: cost.energy,
      power: cost.power,
      types: ["spell"],
      destination: null,
    }],
    canEndTurn: false,
    emptyRunePoolBlocked: false,
  };
}

describe("RIFT-1061 Void Seeker affordability", () => {
  it("does not select a timing-legal Void Seeker whose 3 Energy + 1 Fury Power is unpayable in Showdown", () => {
    const play: HeadlessCommand = {
      type: "play",
      player: "A",
      object: VOID_SEEKER_REF,
      id: "headless:void-seeker",
    };
    const combat = { current: { step: "showdown" } } as Match["flow"]["combat"];

    expect(prioritizedHeadlessCommands([play], unpayableShowdownTrace(), combat)).toEqual([]);
    expect(prioritizedHeadlessCommands([{ type: "pass", player: "A" }, play], unpayableShowdownTrace(), combat))
      .toEqual([{ type: "pass", player: "A" }]);
  });

  it("reaches the real Match/Chain Showdown while leaving the engine rejection authoritative", () => {
    const passed = productionShowdown();
    const pass = prioritizedHeadlessCommands([{ type: "pass", player: "A" }], unpayableShowdownTrace(), passed.match.flow.combat);
    expect(pass).toEqual([{ type: "pass", player: "A" }]);
    expect(passed.match.flow.chain.turnState).toBe("showdown-open");
    expect(passed.kernel.getObject("void-seeker")?.zone).toBe("hand");

    // The authoritative engine still rejects an explicit unpayable Play. The
    // bot fix prevents that command from being generated; it does not weaken
    // Finalize or payment checks.
    const rejected = productionShowdown();
    const source = rejected.kernel.getObject("void-seeker");
    if (source === null) throw new Error("Void Seeker source was not registered");
    const draft = rejected.match.programBinding!.describePlay(
      { type: "play", player: "A", object: source.ref },
      source,
    );
    // This synthetic Showdown is a Non-Combat Showdown, so a Unit cannot be
    // designated as the defender yet. The engine therefore rejects the Play
    // at timing before reaching its (correct) cost check; the cost regression
    // above uses the exact Action Spell even if Showdown open trace from the
    // reproduced seed.
    expect(() => rejected.match.flow.execute(draft)).toThrow(/legally timed/i);
  });
});

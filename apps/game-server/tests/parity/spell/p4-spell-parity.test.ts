import { describe, expect, it } from "vitest";
import { cardProgramsById } from "../../../../../packages/card-dsl/src/cards/registry.generated.ts";
import { ChainEngine } from "../../../../../packages/engine-core/src/chain/engine.ts";
import type { ChoiceRequest } from "../../../../../packages/engine-core/src/effects/contract.ts";
import { world } from "../../../../../packages/engine-core/src/effects/testing/test-kernel.ts";
import { bindResolveContext, createActionPipelineHost } from "../../../../../packages/engine-core/src/events/action-adapter.ts";
import { createProgramBinding } from "../../../../../packages/engine-core/src/programs/index.ts";

const PROGRAMS = createProgramBinding({ cardPrograms: cardProgramsById });

const IDS = {
  draw4: "card.hash-6f5f348b612d7d8afb8d38e3f76ed436a62cd1d5d0abcb5a003c48de2e2741fb",
  draw3: "card.hash-281e4f29c74b8ba799276e97df9e961d0366cf7c8b6fd6c90bb383574d9f40c5",
  vengeance: "card.hash-f67321dac096b3ad1e49b55231663e26f3f9d96efafe79d75719a6eb72fc5caa",
  ruination: "card.hash-ba55ed991c377657c67727781733c33b7319e9f6e2abc066c541d2f9e83e7c5e",
  incinerate: "card.hash-cda4589f51b52780272f5a9b1db1a1de9e9e57e13ffaa05ab668af2de34c1de9",
  hextechRay: "card.hash-40b28488632a7824775d37e8c9c7c546f5595145c0f115e8367f9ce7f8a9773d",
  fallingComet: "card.hash-6d7a9531293e32e434c7fe99c6af5db443cfa11aa7c070f842cb759910097458",
  finalSpark: "card.hash-eef2050754d1ea5e66dbbe4a0abc9faf47327acb4551170226ebde3e02eccd83",
} as const;

type Scenario = {
  readonly sourceId: string;
  readonly sourceCardId: string;
  readonly target?: "battlefield" | "base";
  readonly targetMight?: number;
};

function makeScenario(scenario: Scenario) {
  const sourceCost = scenario.sourceCardId === IDS.draw4
    ? { energy: 6, power: ["Mind"] }
    : scenario.sourceCardId === IDS.draw3
      ? { energy: 2, power: ["Mind"] }
      : scenario.sourceCardId === IDS.vengeance
        ? { energy: 4, power: ["Order"] }
        : scenario.sourceCardId === IDS.incinerate
          ? { energy: 2, power: ["Fury"] }
          : scenario.sourceCardId === IDS.hextechRay
            ? { energy: 1, power: ["Fury"] }
            : scenario.sourceCardId === IDS.fallingComet
              ? { energy: 5, power: ["Mind"] }
              : { energy: 8, power: ["Mind", "Order"] };
  const source = world()
    .player("A", { energy: 20, power: [
      "Fury", "Calm", "Mind", "Body", "Chaos", "Order", "Mind", "Mind", "Order", "Order",
    ] })
    .player("B", { energy: 20, power: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] })
    .hand("spell", {
      owner: "A",
      controller: "A",
      cardId: scenario.sourceCardId,
      types: ["spell"],
      energy: sourceCost.energy,
      power: sourceCost.power,
    })
    .deck(["deck-1", "deck-2", "deck-3", "deck-4", "deck-5"], {
      owner: "A",
      cardId: "deck-card",
      types: ["gear"],
    });

  if (scenario.target === "base") {
    source.base("target", {
      owner: "B",
      controller: "B",
      cardId: "target-card",
      types: ["unit"],
      might: scenario.targetMight ?? 20,
      energy: 1,
      power: ["Fury"],
    });
  } else if (scenario.target === "battlefield") {
    source.unit("target", {
      owner: "B",
      controller: "B",
      cardId: "target-card",
      types: ["unit"],
      location: { type: "battlefield", id: "battlefield-1" },
      might: scenario.targetMight ?? 20,
      energy: 1,
      power: ["Fury"],
    });
  }

  const kernel = source.build();
  const choose = (request: ChoiceRequest<unknown>) => {
    if (request.type === "select-objects") return request.options.slice(0, request.min);
    throw new Error(`Unexpected choice in parity fixture: ${request.type}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (object, controller, timingPoint) => bindResolveContext(kernel, {
      source: object,
      controller,
      timingPoint,
      choose,
    }),
    testTrigger: registration => kernel.test(registration.spec.condition),
  });
  const cleanup = (chain: ChainEngine) => {
    let changed = false;
    chain.layers.setObjects(kernel.objects);
    for (const object of chain.layers.evaluateAll()) {
      if (object.zone !== "board" || !object.types.includes("unit") || object.might === null ||
          object.damage <= 0 || object.damage < Math.max(0, object.might)) continue;
      const before = kernel.getObject(object.ref.id);
      chain.commit({ type: "kill", object: object.ref });
      const after = kernel.getObject(object.ref.id);
      changed ||= before?.ref.zoneEntryId !== after?.ref.zoneEntryId || before?.zone !== after?.zone;
    }
    return changed;
  };
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup,
    describePlay: PROGRAMS.describePlay,
  });
  return { kernel, engine };
}

function playAndResolve(sourceCardId: string, target?: "battlefield" | "base") {
  const { kernel, engine } = makeScenario({ sourceId: "spell", sourceCardId, target });
  const source = kernel.getObject("spell");
  if (!source) throw new Error("parity source card missing");
  const draft = PROGRAMS.describePlay({ type: "play", object: source.ref, player: "A" }, source);
  engine.execute(draft);
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 20) throw new Error("parity chain did not resolve");
    const priority = engine.priority;
    if (!priority) throw new Error("parity chain has no priority holder");
    engine.pass(priority);
  }
  return {
    source: kernel.getObject("spell"),
    target: kernel.getObject("target"),
    player: kernel.player("A"),
    events: engine.pipeline.events.map(event => event.timingPoint),
    history: kernel.stateForTest() as { readonly history: readonly { readonly action: { readonly type: string; readonly plan?: unknown } }[] },
  };
}

function semanticEvents(events: readonly string[]): readonly string[] {
  const observed = new Set([
    "object-enters-chain", "became-target", "card-drawn", "damage-dealt",
    "object-killed", "card-played", "object-enters-trash",
  ]);
  return events.filter(event => observed.has(event));
}

describe("RIFT-341 P4 Spell parity against the new program kernel", () => {
  it("covers the legacy Draw Spell handoff with Draw 4", () => {
    const result = playAndResolve(IDS.draw4);
    expect(result.source?.zone).toBe("trash");
    expect(result.player.handCount).toBe(4);
    expect(result.player.deckCount).toBe(1);
    expect(semanticEvents(result.events)).toEqual([
      "object-enters-chain",
      "card-drawn", "card-drawn", "card-drawn", "card-drawn",
      "card-played", "object-enters-trash",
    ]);
    expect(result.history.history.find(entry => entry.action.type === "pay")?.action.plan).toMatchObject({
      finalized: true,
      energy: 6,
      power: ["Mind"],
    });
  });

  it("covers the legacy Reaction Draw branch with Draw 3", () => {
    const result = playAndResolve(IDS.draw3);
    expect(result.source?.zone).toBe("trash");
    expect(result.player.handCount).toBe(3);
    expect(result.player.deckCount).toBe(2);
    expect(semanticEvents(result.events)).toEqual([
      "object-enters-chain",
      "card-drawn", "card-drawn", "card-drawn",
      "card-played", "object-enters-trash",
    ]);
    expect(result.history.history.find(entry => entry.action.type === "pay")?.action.plan).toMatchObject({
      finalized: true,
      energy: 2,
      power: ["Mind", "Mind", "Mind"],
    });
  });

  it("covers the legacy single-target Kill Spell with Vengeance", () => {
    const result = playAndResolve(IDS.vengeance, "battlefield");
    expect(result.target?.zone).toBe("trash");
    expect(result.source?.zone).toBe("trash");
    expect(semanticEvents(result.events)).toEqual([
      "object-enters-chain", "became-target", "object-killed", "object-enters-trash",
      "card-played", "object-enters-trash",
    ]);
    expect(result.history.history.find(entry => entry.action.type === "pay")?.action.plan).toMatchObject({
      finalized: true,
      energy: 4,
      power: ["Order", "Order"],
    });
  });

  it.each([
    ["Incinerate", IDS.incinerate, 2, "battlefield"],
    ["Falling Comet", IDS.fallingComet, 6, "battlefield"],
    ["Final Spark", IDS.finalSpark, 8, "base"],
  ] as const)("covers the legacy Point Spell damage path for %s", (_name, cardId, amount, location) => {
    const result = playAndResolve(cardId, location);
    expect(result.target?.zone).toBe("board");
    expect(result.target?.damage).toBe(amount);
    expect(result.source?.zone).toBe("trash");
    expect(semanticEvents(result.events)).toEqual([
      "object-enters-chain", "became-target", "damage-dealt", "card-played", "object-enters-trash",
    ]);
  });

  it.todo(
    "Hextech Ray / ogn-009-298: the CardProgram records location {type: battlefield} without a concrete id; " +
    "the current target-plan requires a complete LocationRef, so the spell cannot finalize a legal battlefield target"
  );

  it.todo("The Ruination / unl-180-219: untargeted Kill all units remains judge-required until effect.kill supports CR 355.10.d each/all selection");
  it.todo("Each player kills one of their units and compound/damage Spell semantics are outside the legacy P4 service slice; retain explicit admission coverage before deleting the service");
});

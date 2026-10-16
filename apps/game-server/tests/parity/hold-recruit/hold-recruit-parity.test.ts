import { describe, expect, test } from "vitest";
import altarToUnity from "../../../../../packages/card-dsl/src/cards/ogn/altar-to-unity.js";
import { createProgramBinding } from "../../../../../packages/engine-core/src/programs/index.js";
import { createMatch, type MatchDeck } from "../../../../../packages/engine-core/src/game/lifecycle.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../../packages/engine-core/src/events/action-adapter.js";
import { world } from "../../../../../packages/engine-core/src/effects/testing/test-kernel.js";

const ALTAR_TO_UNITY = altarToUnity.canonicalCardId;

function card(id: string, cardId: string, types: readonly string[]) {
  return { id, cardId, name: id, types };
}

function deck(seat: string): MatchDeck {
  return {
    mainDeck: Array.from({ length: 16 }, (_, index) => card(`${seat}-unit-${index}`, `card:${seat}-unit-${index}`, ["unit"])),
    runeDeck: Array.from({ length: 4 }, (_, index) => card(`${seat}-rune-${index}`, `card:${seat}-rune-${index}`, ["rune"])),
    championLegend: card(`${seat}-legend`, `card:${seat}-legend`, ["legend"]),
    chosenChampion: card(`${seat}-champion`, `card:${seat}-champion`, ["champion"]),
    battlefields: [
      card(`${seat}-altar`, ALTAR_TO_UNITY, ["battlefield"]),
      card(`${seat}-field-1`, `card:${seat}-field-1`, ["battlefield"]),
      card(`${seat}-field-2`, `card:${seat}-field-2`, ["battlefield"]),
    ],
  };
}

function newKernelScene() {
  const kernel = world().player("A").player("B").build();
  const pipelineHost = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      const checkpoint = saved as { state: ReturnType<typeof kernel.snapshot>; links: ReturnType<typeof kernel.clone> };
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: () => {
      throw new Error("parity setup does not make choices");
    },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: () => false,
  });
  const host = Object.assign(Object.create(Object.getPrototypeOf(pipelineHost)), pipelineHost, {
    player: (id: "A" | "B") => kernel.player(id),
  });
  const match = createMatch({
    decks: [deck("A"), deck("B")],
    seed: "hold-recruit-parity",
    battlefieldChoice: [0, 0],
    firstPlayer: 0,
    mulligans: [[], []],
    host,
  });
  const programs = createProgramBinding({ cardPrograms: [altarToUnity] });
  const lifecycle = programs.attachLifecycle(match.flow.chain);
  return { kernel, match, programs, lifecycle };
}

describe("server batch E parity: hold -> recruit", () => {
  test("new game/program kernel admits the old Altar setup but keeps the card judge-required", () => {
    const scene = newKernelScene();
    expect(scene.match.rulesetVersion).toBe("core-1.5");
    expect(scene.match.events().some(event => event.timingPoint === "turn-start")).toBe(true);
    expect(scene.programs.inspect({
      ref: { id: "altar-source", zoneEntryId: 1 },
      cardId: ALTAR_TO_UNITY,
      name: "Altar to Unity",
      types: ["battlefield"],
      tags: [],
      keywords: [],
      owner: "A",
      controller: "A",
      zone: "board",
      location: { type: "battlefield", id: scene.match.setup.battlefields[0]!.id },
      might: null,
      energy: null,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false,
    }).program?.status).toBe("judge-required");
    expect(() => scene.programs.registry.get(ALTAR_TO_UNITY)).toThrow(/controller-relative|LocationRef|base/);
    scene.lifecycle.detach();
  });

  test.todo(
    "Altar to Unity / old pending-without-entry-proof scene: replay the Hold command sequence through createMatch + createProgramBinding; blocked by the card's judge-required controller-relative base LocationRef"
  );

  test.todo(
    "Altar to Unity / old typed-entry-proof scene: compare Hold, Recruit birth, base placement, null costs and tokenDecision events; blocked until effect.token can resolve the ability controller's base"
  );

  test.todo(
    "Altar to Unity / old poisoned-adoption retry scene: compare one staged token identity, retry idempotence and later journal settlement; blocked until the Hold trigger and controller-relative token play are executable"
  );
});

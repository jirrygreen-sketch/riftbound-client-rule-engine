// RIFT-657 template-level golden.
//
// The four source programs keep their printed targeting restrictions and stay
// judge-required because Finalize cannot yet consume those restrictions. The
// scenario rows execute the common, already-merged [Reaction] + effect.counter
// slice with a test-only supported-target view. This keeps the execution
// evidence honest about the implemented primitive without approximating any
// card's printed legality in its source IR.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import defy from "../../../dist/cards/ogn/defy.js";
import hush from "../../../dist/cards/rad/hush.js";
import notSoFast from "../../../dist/cards/sfd/not-so-fast.js";
import repulse from "../../../dist/cards/unl/repulse.js";
import premonition from "../../../dist/cards/sfd/premonition.js";

const TARGET_PROGRAM = premonition;

/**
 * Keep only the target fields consumed by the merged scenario target planner.
 * The returned view is test-only and does not change the card program: the
 * omitted fields are the exact unsupported restrictions named by each card's
 * judgeReason.
 */
function executableCounterSlice(program) {
  return {
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities: program.abilities.map(ability => {
      if (ability.kind !== "play") return ability;
      return {
        ...ability,
        body: ability.body.map(instruction => {
          if (instruction.op !== "effect.counter") return instruction;
          const { condition: _unsupportedCondition, ...withoutCondition } = instruction;
          return {
            ...withoutCondition,
            targets: instruction.targets?.map(target => ({
              ...target,
              filter: target.id.includes("friendly-unit")
                ? { type: "unit", zone: "board" }
                : { type: target.filter.type, zone: "chain" }
            }))
          };
        })
      };
    })
  };
}

function scenarioFor(program, sourceId, targetId, sourcePower, extraObjects = [], answers = {}) {
  const source = executableCounterSlice(program);
  return {
    program: source,
    scenario: {
      turnPlayer: "B",
      priority: "B",
      players: {
        A: { energy: 20, power: ["Calm", "Body", "Mind", "Mind"] },
        B: { energy: 10, power: ["Mind", "Mind", "Mind"] }
      },
      objects: [
        {
          id: targetId,
          cardId: TARGET_PROGRAM.canonicalCardId,
          program: TARGET_PROGRAM,
          owner: "B",
          types: ["spell"],
          zone: "hand",
          energy: 2,
          power: ["Mind"]
        },
        {
          id: sourceId,
          cardId: source.canonicalCardId,
          program: source,
          owner: "A",
          types: ["spell"],
          zone: "hand",
          energy: 1,
          power: sourcePower
        },
        { id: "deck-1", owner: "B", types: ["unit"], zone: "deck" },
        { id: "deck-2", owner: "B", types: ["unit"], zone: "deck" },
        { id: "deck-3", owner: "B", types: ["unit"], zone: "deck" },
        ...extraObjects
      ],
      answers,
      operations: [
        { type: "play", object: targetId, player: "B" },
        { type: "pass", player: "B" },
        { type: "play", object: sourceId, player: "A" },
        { type: "pass", player: "A" },
        { type: "pass", player: "B" }
      ],
      expect: {
        objects: {
          [sourceId]: { zone: "trash" },
          [targetId]: { zone: "trash" },
          ...Object.fromEntries(extraObjects.map(object => [object.id, { zone: object.zone ?? "board" }]))
        },
        events: { includes: [{ action: { type: "counter" } }] }
      }
    }
  };
}

const rows = [
  {
    name: "Defy counters a finalized Chain spell",
    canonicalCardId: defy.canonicalCardId,
    ...scenarioFor(defy, "defy", "defy-target", ["Calm"], [], {
      "target:costed-spell": ["defy-target"]
    })
  },
  {
    name: "Hush counters a finalized Chain spell",
    canonicalCardId: hush.canonicalCardId,
    ...scenarioFor(hush, "hush", "hush-target", [], [], {
      "target:hush.spell": ["hush-target"]
    })
  },
  {
    name: "Not So Fast counters a finalized Chain item",
    canonicalCardId: notSoFast.canonicalCardId,
    ...scenarioFor(notSoFast, "not-so-fast", "not-so-fast-target", ["Calm"], [], {
      "target:not-so-fast.enemy-item": ["not-so-fast-target"]
    })
  },
  {
    name: "Repulse chooses a friendly unit and counters a Chain item",
    canonicalCardId: repulse.canonicalCardId,
    ...scenarioFor(
      repulse,
      "repulse",
      "repulse-target",
      ["Body"],
      [{ id: "repulse-ally", owner: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" } }],
      {
        "target:repulse.friendly-unit": ["repulse-ally"],
        "target:repulse.enemy-spell-or-ability": ["repulse-target"]
      }
    )
  }
];

for (const row of defineTemplateSuite("keyword + play || effect.counter", rows)) {
  test(row.name, row.run);
}

test("RIFT-657 boundary: no legal Chain target is rejected by the real target planner", () => {
  const source = executableCounterSlice(defy);
  assert.throws(
    () => runCardScenario(source, {
      players: { A: { energy: 5, power: ["Calm"] }, B: { energy: 5, power: ["Mind"] } },
      objects: [
        { id: "defy-boundary", cardId: source.canonicalCardId, program: source, types: ["spell"], zone: "hand", energy: 1, power: ["Calm"] },
        { id: "board-spell", owner: "B", types: ["spell"], zone: "board" }
      ],
      operations: [{ type: "play", object: "defy-boundary", player: "A" }]
    }),
    error => error?.code === "no-legal-targets"
  );
});

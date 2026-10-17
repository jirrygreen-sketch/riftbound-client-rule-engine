// RIFT-699 template-level golden: `keyword + play || effect.counter` (README 4.1).
//
// The five source programs below are structurally identical — one [Reaction]
// keyword declaration plus one Play ability whose only instruction is
// `effect.counter` — but each prints a different legality restriction: a
// printed-cost ceiling on the target (Defy, Hush), a chosen-target predicate on
// the answered Chain item (Not So Fast, Repulse) or a play-history gate
// (Crumbling Sands).  None of those is expressible on the merged Finalize
// vocabulary, so every card stays `judge-required` and each row runs an
// in-memory executable view that removes exactly the documented unsupported
// restriction while keeping the printed card identity, cost and Counter body
// intact.  The
// declared program is checked separately, so a partial execution probe never
// promotes a card in the registry.  Together with the earlier RIFT-676 partial
// file this is the execution evidence the single-card test files point at; it
// does not rewrite any source program.
import assert from "node:assert/strict";
import test from "node:test";

import { defineTemplateSuite, runCardScenario } from "../../../../engine-core/dist/effects/testing/scenario/index.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import defy from "../../../dist/cards/ogn/defy.js";
import hush from "../../../dist/cards/rad/hush.js";
import notSoFast from "../../../dist/cards/sfd/not-so-fast.js";
import repulse from "../../../dist/cards/unl/repulse.js";
import crumblingSands from "../../../dist/cards/ven/crumbling-sands.js";
import premonition from "../../../dist/cards/sfd/premonition.js";

/** A real, already-executable Reaction spell used as the counter's Chain object. */
const COUNTER_TARGET = premonition;

/** The published program behind a row, looked up by canonical identity. */
function shipped(canonicalCardId) {
  const program = cardProgramsById.get(canonicalCardId);
  assert.ok(program, `generated card program ${canonicalCardId} is present`);
  return program;
}

/** Filter keys the merged planner/translator really consumes. */
const PLANNER_FILTER_KEYS = new Set([
  "objectId", "cardId", "canonicalCardId", "type", "types", "controller", "owner",
  "zone", "location", "locationType", "states", "state", "tags", "tag", "characteristics"
]);

/**
 * Keep every filter field the merged scenario planner consumes, dropping only
 * the descriptive keys that stand for a printed restriction nobody evaluates
 * (energyMax/powerMax, choosesFriendly, chosenFriendlyUnit and
 * noOtherFriendlyUnitChosen).
 * Instruction conditions and named Requirements are omitted from this test-only
 * view because they are the documented Finalize gaps; the source programs keep
 * them and their judgeReason stays authoritative.
 */
function executableCounterView(program) {
  return {
    ...program,
    status: "executable",
    judgeReason: undefined,
    abilities: program.abilities.map(ability => {
      if (ability.kind !== "play") return ability;
      const { requirements: _unsupportedRequirements, ...withoutRequirements } = ability;
      return {
        ...withoutRequirements,
        body: ability.body.map(instruction => {
          if (instruction.op !== "effect.counter") return instruction;
          const { condition: _unsupportedCondition, ...withoutCondition } = instruction;
          return {
            ...withoutCondition,
            targets: instruction.targets?.map(target => ({
              ...target,
              filter: Object.fromEntries(
                Object.entries(target.filter).filter(([key]) => PLANNER_FILTER_KEYS.has(key))
              )
            }))
          };
        })
      };
    })
  };
}

/** The published program with only the scenario status gate lifted. */
function statusLifted(program) {
  const { judgeReason: _judgeReason, ...declaration } = program;
  return { ...declaration, status: "executable" };
}

/**
 * One real Reaction exchange: B plays a spell, A answers with the counter
 * card, both pass, and the countered Chain object is cleared (CR 426.1-426.3).
 */
function counterScenario(program, sourceId, targetId, sourcePower, instructionId, extraObjects = [], answers = {}) {
  const source = executableCounterView(program);
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
          cardId: COUNTER_TARGET.canonicalCardId,
          program: COUNTER_TARGET,
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
        // Card-specific link proof: effect.counter reports exactly one countered
        // object under this card's own instruction id (426.1-426.3).
        links: { [`${instructionId}.countered`]: 1 },
        events: {
          includes: [
            { action: { type: "counter" } },
            { timingPoint: "object-enters-trash", object: { ref: targetId } }
          ]
        }
      }
    }
  };
}

const rows = [
  {
    name: "Defy · 1 Energy + 1 Calm Power counter clears the answered Chain spell",
    canonicalCardId: defy.canonicalCardId,
    ...counterScenario(defy, "defy", "defy-target", ["Calm"], "counter-spell", [], {
      "target:costed-spell": ["defy-target"]
    }),
    // Card-specific numbers: printed 1 Energy + 1 Calm Power, and the
    // descriptive CR 206 ceiling stays on the source filter.
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.deepEqual(program.abilities[1].cost, {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      });
      assert.deepEqual(program.abilities[1].body[0].targets[0].filter, {
        type: "spell",
        zone: "chain",
        energyMax: 4,
        powerMax: 1
      });
      assert.match(program.judgeReason, /206/);
    },
    check: result => {
      // 426.1.b: a countered card is not considered played, so no card-played
      // event for the countered spell survives.
      assert.equal(result.events.filter(event =>
        event.timingPoint === "card-played" && event.object?.ref.id === "defy-target").length, 0);
      assert.equal(result.state.objects.find(object => object.ref.id === "defy-target").zone, "trash");
    }
  },
  {
    name: "Hush · 1 Energy + 2 Power counter clears the answered Chain spell",
    canonicalCardId: hush.canonicalCardId,
    ...counterScenario(hush, "hush", "hush-target", [], "hush.counter-spell", [], {
      "target:hush.spell": ["hush-target"]
    }),
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.deepEqual(program.abilities[1].cost, {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 2 }
      });
      assert.deepEqual(program.abilities[1].body[0].targets[0].filter, { type: "spell", zone: "chain" });
      assert.deepEqual(program.abilities[1].body[0].condition, {
        kind: "compare",
        left: { kind: "object-property", object: { target: "hush.spell" }, property: "powerCost" },
        operator: "gte",
        right: { kind: "constant", value: 2 }
      });
      assert.match(program.judgeReason, /powerCost/);
    },
    check: result => {
      assert.equal(result.state.objects.find(object => object.ref.id === "hush-target").zone, "trash");
    }
  },
  {
    name: "Not So Fast · 2 Energy + 1 Calm Power counter clears an enemy Chain spell",
    canonicalCardId: notSoFast.canonicalCardId,
    ...counterScenario(notSoFast, "not-so-fast", "not-so-fast-target", ["Calm"], "not-so-fast.counter-chosen-item", [], {
      "target:not-so-fast.enemy-item": ["not-so-fast-target"]
    }),
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.deepEqual(program.abilities[1].cost, {
        kind: "cost.printed",
        energy: { kind: "constant", value: 2 },
        power: { kind: "constant", value: 1 }
      });
      assert.deepEqual(program.abilities[1].body[0].targets[0].filter, {
        type: ["spell", "ability"],
        zone: "chain",
        controller: "opponent",
        choosesFriendly: ["unit", "gear"]
      });
      assert.match(program.judgeReason, /choosesFriendly/);
    },
    check: result => {
      // The countered spell was played by B, so its trash entry is owned by B
      // while the counter spell is owned by A.
      const countered = result.state.objects.find(object => object.ref.id === "not-so-fast-target");
      assert.deepEqual({ zone: countered.zone, owner: countered.owner }, { zone: "trash", owner: "B" });
    }
  },
  {
    name: "Repulse · chooses a friendly battlefield unit, then counters the enemy Chain item",
    canonicalCardId: repulse.canonicalCardId,
    ...counterScenario(
      repulse,
      "repulse",
      "repulse-target",
      ["Body"],
      "repulse.counter-enemy-spell",
      [{ id: "repulse-ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 2 }],
      {
        "target:repulse.friendly-unit": ["repulse-ally"],
        "target:repulse.enemy-spell-or-ability": ["repulse-target"]
      }
    ),
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.deepEqual(program.abilities[1].cost, {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      });
      assert.deepEqual(program.abilities[1].body[0].targets.map(target => target.filter), [
        { type: "unit", controller: "controller", zone: "board", location: "battlefield" },
        {
          type: ["spell", "ability"],
          zone: "chain",
          controller: "opponent",
          chosenFriendlyUnit: "repulse.friendly-unit",
          noOtherFriendlyUnitChosen: true
        }
      ]);
      assert.match(program.judgeReason, /355\.9\.b/);
    },
    check: result => {
      // The chosen friendly unit survives the counter and keeps its printed
      // Might (CR 426.1: only the countered Chain item is affected).
      const ally = result.state.objects.find(object => object.ref.id === "repulse-ally");
      assert.deepEqual({ zone: ally.zone, might: ally.might }, { zone: "board", might: 2 });
    }
  },
  {
    name: "Crumbling Sands · 1 Energy + 1 Calm Power counter on a real chain resolution",
    canonicalCardId: crumblingSands.canonicalCardId,
    ...counterScenario(crumblingSands, "crumbling-sands", "crumbling-sands-target", ["Calm"], "crumbling-sands.counter-spell", [], {
      "target:crumbling-sands.spell": ["crumbling-sands-target"]
    }),
    declared: program => {
      assert.equal(program.status, "judge-required");
      assert.deepEqual(program.abilities[1].cost, {
        kind: "cost.printed",
        energy: { kind: "constant", value: 1 },
        power: { kind: "constant", value: 1 }
      });
      assert.deepEqual(program.abilities[1].requirements, [{ kind: "opponent-played-another-spell-this-turn" }]);
      assert.deepEqual(program.abilities[1].body[0].targets[0].filter, { type: "spell", zone: "chain" });
      assert.match(program.judgeReason, /355\.8/);
    },
    check: result => {
      // The played-and-countered spell never reaches its own resolution and the
      // chain empties again (426.1.a).
      assert.equal(result.state.chain.length, 0);
      assert.equal(result.events.filter(event => event.timingPoint === "chain-item-resolve").length, 1);
    }
  }
];

for (const [index, row] of defineTemplateSuite("RIFT-699 keyword+play||effect.counter", rows).entries()) {
  test(row.name, () => {
    const declared = shipped(row.canonicalCardId);
    rows[index].declared(declared);
    const result = row.run();
    rows[index].check(result);
  });
}

// ---------------------------------------------------------------------------
// Per-card boundaries.  RIFT-699 requires at least one no-legal-target,
// negated and unmet-condition case for the template group.
// ---------------------------------------------------------------------------

test("RIFT-699 boundary · Defy: no legal Chain target is rejected before Finalize locks anything", () => {
  const source = executableCounterView(defy);
  assert.throws(
    () => runCardScenario(source, {
      players: { A: { energy: 5, power: ["Calm"] }, B: { energy: 5, power: ["Mind"] } },
      objects: [
        { id: "defy-no-target", cardId: source.canonicalCardId, program: source, types: ["spell"], zone: "hand", energy: 1, power: ["Calm"] },
        // "a spell" is a finalized Chain object (355.9.a.2): a Board spell is
        // never a legal choice, so the real planner finds no candidate.
        { id: "board-spell", owner: "B", types: ["spell"], zone: "board" }
      ],
      operations: [{ type: "play", object: "defy-no-target", player: "A" }]
    }),
    error => error?.code === "no-legal-targets"
  );
});

test("RIFT-699 boundary · Hush: the printed 1 Energy + 2 Power cost is really enforced (negated)", () => {
  const source = executableCounterView(hush);
  // A holds enough Energy but no matching Power, so the real payment plan
  // negates the play instead of letting the counter resolve for free.
  assert.throws(
    () => runCardScenario(source, {
      turnPlayer: "B",
      priority: "B",
      players: { A: { energy: 20, power: [] }, B: { energy: 10, power: ["Mind", "Mind", "Mind"] } },
      objects: [
        { id: "hush-unpayable-target", cardId: COUNTER_TARGET.canonicalCardId, program: COUNTER_TARGET, owner: "B", types: ["spell"], zone: "hand", energy: 2, power: ["Mind"] },
        { id: "hush-unpayable", cardId: source.canonicalCardId, program: source, owner: "A", types: ["spell"], zone: "hand", energy: 1, power: [] },
        { id: "deck-1", owner: "B", types: ["unit"], zone: "deck" }
      ],
      operations: [
        { type: "play", object: "hush-unpayable-target", player: "B" },
        { type: "pass", player: "B" },
        { type: "play", object: "hush-unpayable", player: "A" }
      ]
    }),
    /insufficient matching Power/
  );
});

test("RIFT-699 boundary · Not So Fast: a friendly Chain item is not an enemy target (CR 740.1.b)", () => {
  const source = executableCounterView(notSoFast);
  assert.throws(
    () => runCardScenario(source, {
      turnPlayer: "A",
      priority: "A",
      players: { A: { energy: 20, power: ["Calm", "Mind", "Mind", "Mind"] }, B: { energy: 10, power: ["Mind", "Mind", "Mind"] } },
      objects: [
        // Both the answered spell and the counter belong to A, so the
        // "enemy" filter matches nothing on the Chain.
        { id: "friendly-target", cardId: COUNTER_TARGET.canonicalCardId, program: COUNTER_TARGET, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: ["Mind"] },
        { id: "not-so-fast-friendly", cardId: source.canonicalCardId, program: source, owner: "A", types: ["spell"], zone: "hand", energy: 2, power: ["Calm"] },
        { id: "deck-1", owner: "A", types: ["unit"], zone: "deck" }
      ],
      operations: [
        // A keeps priority after playing its own spell, so it can answer
        // immediately; the "enemy" filter still matches nothing on the Chain.
        { type: "play", object: "friendly-target", player: "A" },
        { type: "play", object: "not-so-fast-friendly", player: "A" }
      ]
    }),
    error => error?.code === "no-legal-targets"
  );
});

test("RIFT-699 boundary · Repulse: without a friendly unit at a battlefield the first target group is empty", () => {
  const source = executableCounterView(repulse);
  assert.throws(
    () => runCardScenario(source, {
      turnPlayer: "B",
      priority: "B",
      players: { A: { energy: 20, power: ["Body", "Mind"] }, B: { energy: 10, power: ["Mind", "Mind", "Mind"] } },
      objects: [
        { id: "repulse-answer", cardId: COUNTER_TARGET.canonicalCardId, program: COUNTER_TARGET, owner: "B", types: ["spell"], zone: "hand", energy: 2, power: ["Mind"] },
        { id: "repulse-no-ally", cardId: source.canonicalCardId, program: source, owner: "A", types: ["spell"], zone: "hand", energy: 1, power: ["Body"] },
        // Friendly unit at base: "at a battlefield" (355.10.b) excludes it.
        { id: "base-ally", owner: "A", controller: "A", types: ["unit"], zone: "board", location: { type: "base", player: "A" }, might: 2 },
        { id: "deck-1", owner: "B", types: ["unit"], zone: "deck" }
      ],
      operations: [
        { type: "play", object: "repulse-answer", player: "B" },
        { type: "pass", player: "B" },
        { type: "play", object: "repulse-no-ally", player: "A" }
      ]
    }),
    error => error?.code === "no-legal-targets"
  );
});

test("RIFT-699 boundary · Crumbling Sands: the history requirement never binds, so the real play path fails closed", () => {
  // The printed gate is a named Requirement with no Finalize history adapter
  // (see judgeReason): even when an opponent really played another spell this
  // turn, describePlay throws instead of treating the requirement as met.
  // Only the scenario status gate is lifted here; the printed requirement and
  // target restriction stay exactly as published.
  const source = statusLifted(crumblingSands);
  assert.throws(
    () => runCardScenario(source, {
      turnPlayer: "B",
      priority: "B",
      players: { A: { energy: 20, power: ["Calm", "Mind"] }, B: { energy: 10, power: ["Mind", "Mind", "Mind"] } },
      objects: [
        { id: "sands-answer", cardId: COUNTER_TARGET.canonicalCardId, program: COUNTER_TARGET, owner: "B", types: ["spell"], zone: "hand", energy: 2, power: ["Mind"] },
        { id: "crumbling-sands-gated", cardId: source.canonicalCardId, program: source, owner: "A", types: ["spell"], zone: "hand", energy: 1, power: ["Calm"] },
        { id: "deck-1", owner: "B", types: ["unit"], zone: "deck" }
      ],
      operations: [
        { type: "play", object: "sands-answer", player: "B" },
        { type: "pass", player: "B" },
        { type: "play", object: "crumbling-sands-gated", player: "A" }
      ]
    }),
    error => error?.name === "ProgramBindingError" && /needs a rules adapter/.test(error.message)
  );
});

test("RIFT-699 evidence · every row keeps its published judge-required program", () => {
  for (const row of rows) {
    const declared = shipped(row.canonicalCardId);
    assert.equal(declared.status, "judge-required", `${row.name} must not auto-promote its published program`);
    assert.ok(declared.judgeReason?.trim(), `${row.name} needs a concrete judgeReason`);
    // The scenario probe is test-local and never replaces the printed identity.
    assert.equal(row.program.canonicalCardId, declared.canonicalCardId);
    assert.equal(row.program.sourceText, declared.sourceText);
    assert.notEqual(row.program, declared);
  }
});

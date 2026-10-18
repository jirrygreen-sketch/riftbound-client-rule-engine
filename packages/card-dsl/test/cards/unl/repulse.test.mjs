// Partial execution evidence for the merged counter primitive is consolidated
// in ../templates/keyword-play-effect-counter-676.test.mjs and extended by
// Repulse's own per-card scenario row in
// ../templates/keyword-play-effect-counter-699.test.mjs; the chosen-target
// restriction remains judge-required until chain target history is queryable.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/repulse.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import counter from "../../../../engine-core/dist/effects/instructions/effect.counter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-37a5883a0f15a4118620e230230c119a9ac1e87495ffa0716a061bf8d9c2422f";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Choose a friendly unit at a battlefield. Counter an enemy spell or ability " +
  "that chooses it and no other friendly unit.";

const [reactionKeyword, play] = program.abilities;
const [counterInstruction] = play.body;
const [friendlySpec, enemySpec] = counterInstruction.targets;

/** A finalized Chain item controlled by an opponent, as the kernel models it. */
const chainSpell = (id, types = ["spell"]) => ({
  zone: "chain",
  owner: "B",
  controller: "B",
  types,
  cardId: id
});

test("unl-106-219 Repulse: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-106-219 Repulse: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: name the missing predicate, the rule entry and the task.
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /RIFT-90/);
  // Second-sweep refresh proof: RIFT-90 target planning is merged; the reason
  // names only the missing locked-target-set predicate.
  assert.match(program.judgeReason, /已合入/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-106-219 Repulse: [Reaction], printed 1 energy + 1 power and the two declared targets", () => {
  assert.deepEqual(reactionKeyword, { kind: "keyword", keyword: "reaction" });
  assert.equal(reactionKeyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 },
    power: { kind: "constant", value: 1 }
  });
  assert.equal(play.body.length, 1);
  assert.equal(counterInstruction.id, "repulse.counter-enemy-spell");
  assert.equal(counterInstruction.op, "effect.counter");
  assert.deepEqual(counterInstruction.args, {
    target: { kind: "constant", value: "repulse.enemy-spell-or-ability" }
  });

  // "Choose a friendly unit at a battlefield": the unit is the target and the
  // location is only a restriction (355.10.b, whose example is "Kill a unit at
  // a battlefield"); the merged location spelling is the type string.
  assert.deepEqual(friendlySpec, {
    id: "repulse.friendly-unit",
    filter: {
      type: "unit",
      controller: "controller",
      zone: "board",
      location: "battlefield"
    },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "an enemy spell or ability" is a finalized Chain object (355.9.a/.a.2);
  // the chosenFriendlyUnit / noOtherFriendlyUnitChosen keys are the
  // descriptive part of the 355.9.b restriction (see judgeReason).
  assert.deepEqual(enemySpec, {
    id: "repulse.enemy-spell-or-ability",
    filter: {
      type: ["spell", "ability"],
      zone: "chain",
      controller: "opponent",
      chosenFriendlyUnit: "repulse.friendly-unit",
      noOtherFriendlyUnitChosen: true
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("unl-106-219 Repulse golden: the counter half clears the chosen enemy spell from the Chain (426.1-426.3)", () => {
  const kernel = world()
    .unit("ally", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf1" } })
    .object("enemy-spell", chainSpell("enemy-spell"))
    .build();
  const spell = kernel.ref("enemy-spell");

  const run = runInstruction(counter, { target: enemySpec.id }, {
    world: kernel,
    targets: { [enemySpec.id]: [spell] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.countered, 1);
  assert.deepEqual(run.linked.counteredObjects, [{ id: "enemy-spell", zoneEntryId: 1 }]);
  // 426.1.a: the countered card does nothing and is cleared from the Chain;
  // 426.1.a.1 routes it to the trash and 426.1.c refunds nothing.
  assert.equal(kernel.getObject("enemy-spell").zone, "trash");
  assert.deepEqual(run.events.map((event) => event.action), ["counter"]);
  // The chosen friendly unit is untouched by the counter.
  assert.equal(kernel.getObject("ally").zone, "board");
});

test("unl-106-219 Repulse golden: an enemy ability on the Chain is a legal target too", () => {
  const kernel = world()
    .unit("ally", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf1" } })
    .object("enemy-ability", { zone: "chain", owner: "B", controller: "B", types: ["ability"] })
    .build();

  const run = runInstruction(counter, { target: enemySpec.id }, {
    world: kernel,
    targets: { [enemySpec.id]: [kernel.ref("enemy-ability")] }
  });

  // 355.9.a allows a finalized ability on the Chain as a target; the filter's
  // merged fields cover it even though the restriction keys do not evaluate.
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-ability").zone, "trash");
});

test("unl-106-219 Repulse golden: a spell that already left the Chain is ignored, not re-countered (359.3.e)", () => {
  const kernel = world()
    .unit("ally", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf1" } })
    .object("gone-spell", chainSpell("gone-spell"))
    .build();
  const stale = kernel.ref("gone-spell");
  kernel.perform({ type: "move-zone", object: stale, to: "trash" });

  const run = runInstruction(counter, { target: enemySpec.id }, {
    world: kernel,
    targets: { [enemySpec.id]: [stale] }
  });

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("gone-spell").zone, "trash");
});

test.todo(
  "Repulse: the restriction \"chooses it and no other friendly unit\" (CR 355.9.b) needs a target predicate over a " +
    "finalized chain item's locked target set; no merged filter key or expression reads it (RIFT-90 target plan / " +
    "chain target locking, engine batch 4). The descriptive keys do not evaluate, so the card stays judge-required."
);

test.todo(
  "Repulse: [Reaction] admission during a Closed State on any player's turn (CR 813.1.b/813.1.c, 159.2.b), the " +
    "Finalize-time locking of both targets and the became-target events (355.8, 754) belong to the chain and the " +
    "target system (RIFT-85 / RIFT-90 / RIFT-120)"
);

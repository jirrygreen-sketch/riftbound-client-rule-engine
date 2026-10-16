import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/heroic-charge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import stun from "../../../../engine-core/dist/effects/instructions/effect.stun.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-7df5a08371438cce0299d5cb0462f93ad1b442be5e5d5f288e5a0ce882fa4230";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Give a friendly unit +1 :rb_might: this turn and [Stun] an enemy unit at its location. " +
  "(A stunned unit doesn't deal combat damage this turn.)";

const [speed, play] = program.abilities;
const [grantMight, stunEnemy] = play.body;
// The interpreter evaluates the card's Expr args before the primitive parses
// them, so the golden runs the original instruction with its TargetSpec
// removed (the one-two-punch / facebreaker convention).
const executableStun = (() => {
  const { targets, ...rest } = stunEnemy;
  return rest;
})();

test("unl-155-219 Heroic Charge: program validates and keeps its identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /143\.2\.a/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-155-219 Heroic Charge: [Action] plus the printed 3 energy cost", () => {
  // 806: the printed [Action] permission is a keyword the registry expands.
  assert.deepEqual(speed, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
});

test("unl-155-219 Heroic Charge: the +1 Might half records the layers shape and the Stun half is a real target", () => {
  // 143.2.a / 317.2.c: a temporary Might modification that expires with the
  // other "this turn" effects; no merged primitive consumes it (judgeReason).
  assert.equal(grantMight.op, "continuous.might");
  assert.deepEqual(grantMight.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(grantMight.targets, [
    {
      id: "heroic-charge.friendly-unit",
      filter: { type: "unit", zone: "board", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(grantMight.linkedTo, undefined);

  // 424.1 / 424.1.a.1: Stun is a real game action on one enemy target; "at its
  // location" is a targeting restriction anchored to the friendly unit
  // (355.10.b), not a second choice.
  assert.equal(stunEnemy.op, "effect.stun");
  assert.deepEqual(stunEnemy.args.target, {
    kind: "constant",
    value: "heroic-charge.enemy-unit"
  });
  assert.deepEqual(stunEnemy.targets, [
    {
      id: "heroic-charge.enemy-unit",
      filter: {
        type: "unit",
        zone: "board",
        controller: "opponent",
        sameLocationAs: { target: "heroic-charge.friendly-unit" }
      },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // "and" joins two actions of one sentence: neither instruction is linked.
  assert.equal(stunEnemy.linkedTo, undefined);
});

test("unl-155-219 Heroic Charge golden: the merged Stun primitive stuns the locked enemy unit", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets("heroic-charge.enemy-unit", [kernel.ref("enemy")]);
  const outcome = runAbilityBody([executableStun], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["heroic-charge.stun-enemy-unit", "executed"]]
  );
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.equal(kernel.getObject("ally").stunned, false);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
});

test("unl-155-219 Heroic Charge golden: without a locked legal target the Stun instruction is ignored (359.3.e.6)", () => {
  // "at its location" (355.10.b) is a targeting restriction, so a unit at
  // another location never becomes a legal Finalize choice. The kernel supplies
  // no locked target for the instruction and it is ignored at resolution.
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("far-enemy", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets("heroic-charge.enemy-unit", []);
  const outcome = runAbilityBody([executableStun], kernel);

  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [["heroic-charge.stun-enemy-unit", "ignored", "mistargeted"]]
  );
  assert.equal(kernel.getObject("far-enemy").stunned, false);
});

test("unl-155-219 Heroic Charge: the 'at its location' anchor restricts the set to the friendly unit's location", () => {
  // The production interpreter evaluates the frozen sameLocationAs anchor
  // itself (effects/interpreter/selectors.ts); the reference kernel's plain
  // matchesFilter compares the controller placeholder verbatim, so the query
  // callback supplies the scalar part and the anchor does the restriction.
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("here", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("elsewhere", { owner: "B", controller: "B", might: 3, location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets("heroic-charge.friendly-unit", [kernel.ref("ally")]);
  const environment = {
    context: kernel,
    linked: () => undefined,
    isIgnored: () => false,
    canLookBack: () => false,
    // The anchor is what this assertion is about; the scalar controller
    // placeholder is resolved by the chain layer at Finalize
    // (chain/engine.ts normalizes controller/owner "self"/"opponent"), so the
    // placeholder is dropped here rather than compared verbatim.
    query: (scalar) => {
      const { controller, ...rest } = scalar;
      return kernel.query(rest);
    }
  };

  const matched = queryObjects(stunEnemy.targets[0].filter, environment)
    .map((object) => object.ref.id)
    .sort();
  // The anchor keeps every object located with the chosen friendly unit and
  // drops the one at the other battlefield.
  assert.deepEqual(matched, ["ally", "here"]);
  assert.equal(matched.includes("elsewhere"), false);
});

test("unl-155-219 Heroic Charge golden: an already Stunned unit is a legal target with no repeat (424.1.a.1)", () => {
  const kernel = world()
    .unit("ally", { owner: "A", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", might: 3, stunned: true, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    stun,
    { target: "heroic-charge.enemy-unit" },
    { world: kernel, targets: { "heroic-charge.enemy-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.stunned.count, 0);
  assert.equal(kernel.events.filter((event) => event.action === "stun").length, 0);
});

test.todo(
  "unl-155-219 Heroic Charge: apply +1 Might for this turn in the arithmetic layer and expire it with the " +
    "other 'this turn' effects in the end-of-turn cleanup (CR 143.2.a, 317.2.c, 433.1.a) — needs the card-facing " +
    "continuous.might instruction consumed by the layers engine (RIFT-91); effect.buff counters are not a substitute (702/703)"
);

test.todo(
  "unl-155-219 Heroic Charge: the Stunned consequences — no combat damage in the combat damage step (CR 424.1.b) " +
    "and removal in step 3d of the end-of-turn cleanup (424.1.a.2) — belong to combat / turn, not to this card"
);


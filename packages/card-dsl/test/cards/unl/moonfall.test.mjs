import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/moonfall.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-e2e26781b4b52ed2eb1cf50ca00160e4ad95f6b59a93ca58abd157a6e8cee977";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Choose a battlefield where you have units. You may move up to one enemy unit to that battlefield. " +
  "Then give enemy units there -2 :rb_might: this turn.";

const [actionKeyword, play] = program.abilities;
const [optionalMove, mightMinusTwo] = play.body;
const [moveEnemyUnit] = optionalMove.args.body.value;
const [mightModify] = mightMinusTwo.args.body.value;

test("unl-198-219 Moonfall: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-198-219 Moonfall: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  // One gap remains: the temporary Might layer cannot consume a location binding.
  assert.match(program.judgeReason, /479\.4/);
  assert.match(program.judgeReason, /355\.10\.d/);
  assert.match(program.judgeReason, /sameLocationAs/);
});

test("unl-198-219 Moonfall: [Action] plus the may-move wrapped in choice.optional with the location choice", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(
    play.body.map((instruction) => instruction.id),
    ["moonfall.optional-move", "moonfall.might-minus-2"]
  );

  // Contract 3.9: "you may" is a choice.optional whose body holds the chosen
  // instruction - never a choice followed by a linkedTo instruction.
  assert.equal(optionalMove.op, "choice.optional");
  assert.equal(optionalMove.linkedTo, undefined);
  assert.deepEqual(optionalMove.args.body.kind, "constant");

  // "Choose a battlefield where you have units" is a public location choice
  // (355.4 / 355.5), constrained to a controller-held battlefield with units.
  assert.equal(optionalMove.targets, undefined);
  assert.deepEqual(optionalMove.locations, [
    {
      id: "moonfall.battlefield",
      type: "battlefield",
      controller: "controller",
      hasUnits: true,
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "move up to one enemy unit": the moved unit is a target (355.10 /
  // 355.9.a.1) with an up-to-one bound (055 / 359.3.e.11).
  assert.equal(moveEnemyUnit.op, "effect.move");
  assert.deepEqual(moveEnemyUnit.args.objects, {
    kind: "constant",
    value: { target: "moonfall.enemy-unit" }
  });
  assert.deepEqual(moveEnemyUnit.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveEnemyUnit.linkedTo, undefined);
  assert.deepEqual(moveEnemyUnit.targets[0], {
    id: "moonfall.enemy-unit",
    filter: { type: "unit", controller: "opponent" },
    min: 0,
    max: 1,
    selection: "up-to"
  });

  // "to that battlefield" is a runtime LocationExpr (355.4/355.4.a).
  assert.deepEqual(moveEnemyUnit.args.to, {
    kind: "location",
    value: { kind: "target-location", target: "moonfall.battlefield" }
  });
});

test("unl-198-219 Moonfall: the Might deduction is a guarded, non-target set clause", () => {
  // "Then give enemy units there -2 :rb_might: this turn": "Then" is a sequence
  // word, and the affected units are programmatically selected (355.10.d), so
  // the instruction declares no TargetSpec.
  assert.equal(mightMinusTwo.op, "sequence");
  assert.equal(mightMinusTwo.linkedTo, undefined);
  assert.equal(mightModify.op, "continuous.might");
  assert.deepEqual(mightModify.args.amount, { kind: "constant", value: -2 });
  assert.deepEqual(mightModify.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(mightModify.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        controller: "opponent",
        zone: "board",
        sameLocationAs: { target: "moonfall.battlefield" }
      }
    }
  });
  assert.equal(mightModify.targets, undefined);
});

test("unl-198-219 Moonfall golden: effect.move really moves the enemy unit when the caller supplies the chosen destination", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const run = runInstruction(
    move,
    {
      objects: moveEnemyUnit.args.objects,
      to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } },
      amount: moveEnemyUnit.args.amount
    },
    { world: kernel, targets: { "moonfall.enemy-unit": [kernel.ref("enemy")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("enemy").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(kernel.getObject("enemy").owner, "B");
  // effect.move links its receipt: the actual moved objects and movements.
  assert.deepEqual(run.linked.moved.count, 1);
  assert.deepEqual(run.linked.moved.objects.map((ref) => ref.id), ["enemy"]);
  assert.deepEqual(run.events.map((event) => event.action), ["move-location"]);
});

function locationWorld() {
  return world()
    .object("bf-1", {
      owner: "A",
      controller: "A",
      types: ["battlefield"],
      zone: "board",
      location: null
    })
    .object("bf-2", {
      owner: "B",
      controller: "B",
      types: ["battlefield"],
      zone: "board",
      location: null
    })
    .unit("ally", { owner: "A", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
}

test("unl-198-219 Moonfall golden: the chosen location expression drives the real move", () => {
  const ctx = locationWorld();
  ctx.setTargets("moonfall.enemy-unit", [ctx.ref("enemy")]);
  ctx.setAnswers({
    "moonfall.move-enemy-unit/location%3Amoonfall.battlefield": {
      type: "battlefield",
      id: "bf-1"
    }
  });

  // The card declares the location choice on the may-action control node. The
  // isolated move execution below supplies the same finalized location scope
  // and locked target at the instruction boundary, exercising the merged
  // LocationExpr consumer.
  const { targets: _omittedTargets, ...moveWithoutTargets } = moveEnemyUnit;
  const executable = [{ ...moveWithoutTargets, locations: optionalMove.locations }];
  const outcome = resolveChainBody(executable, ctx);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(ctx.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["moonfall.move-enemy-unit", "executed"]
  ]);
});

test("unl-198-219 Moonfall golden: the optional clause executes the real move when accepted", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const ctx = kernel.clone();
  ctx.setTargets("moonfall.enemy-unit", [ctx.ref("enemy")]);
  ctx.setAnswers({ "moonfall.optional-move/optional": true });
  // This isolates the optional control node; the location-aware move path has
  // its own golden test above.
  const { targets: _omittedOptionalSpec, locations: _omittedLocationSpec, ...optionalWithoutSpec } = optionalMove;
  const { targets: _omittedMoveSpec, ...moveWithoutSpec } = moveEnemyUnit;
  const executable = [{
    ...optionalWithoutSpec,
    args: {
      ...optionalMove.args,
      body: {
        kind: "constant",
        value: [{
          ...moveWithoutSpec,
          args: { ...moveEnemyUnit.args, to: { kind: "constant", value: { type: "battlefield", id: "bf-2" } } }
        }]
      }
    }
  }];

  const outcome = resolveChainBody(executable, ctx);

  assert.equal(outcome.status, "executed");
  // resolveChainBody mutates the world it is given, which is the Finalize- and
  // answer-equipped clone above.
  assert.deepEqual(ctx.getObject("enemy").location, { type: "battlefield", id: "bf-2" });
  assert.deepEqual(
    outcome.results.map((result) => [result.id, result.result.status]),
    [["moonfall.move-enemy-unit", "executed"], ["moonfall.optional-move", "executed"]]
  );
});

test("unl-198-219 Moonfall golden: declining the may move changes nothing", () => {
  const kernel = world()
    .unit("enemy", { owner: "B", might: 2, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const ctx = kernel.clone();
  ctx.setTargets("moonfall.enemy-unit", [ctx.ref("enemy")]);
  ctx.setAnswers({ "moonfall.optional-move/optional": false });
  const { targets: _omittedSpec, locations: _omittedLocationSpec, ...optionalWithoutSpec } = optionalMove;
  const executable = [optionalWithoutSpec];

  const outcome = resolveChainBody(executable, ctx);

  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["moonfall.optional-move", "negated"]
  ]);
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.deepEqual(ctx.getObject("enemy").location, { type: "battlefield", id: "bf-1" });
  assert.deepEqual(ctx.events, []);
});

test("unl-198-219 Moonfall golden: the Might clause carries the reviewed declarative shape only", () => {
  // The card-facing continuous.might instruction is real; this test pins the
  // declared query shape while the nested referent propagation remains open.
  assert.equal(mightModify.op, "continuous.might");
  assert.equal(mightMinusTwo.op, "sequence");
  assert.deepEqual(mightModify.args.objects.value.filter.sameLocationAs, {
    target: "moonfall.battlefield"
  });
  assert.equal(mightModify.args.objects.value.filter.controller, "opponent");
});

test.todo(
  "unl-198-219 Moonfall: resolve the continuous.might query against the chosen battlefield after the nested optional move and apply the -2 this-turn effect to enemy units there (CR 359.3.f.1/479.4; queryObjects sameLocationAs cannot consume a location binding)"
);

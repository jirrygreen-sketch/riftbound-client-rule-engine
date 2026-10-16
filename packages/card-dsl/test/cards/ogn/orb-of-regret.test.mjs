import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/orb-of-regret.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", ENGINE));
const { buildCostPlan } = await import(new URL("cost/cost-plan.js", ENGINE));
const { payCostPlan } = await import(new URL("cost/payment.js", ENGINE));

const [ability] = program.abilities;

test("orb-of-regret: passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
});

test("orb-of-regret: identity, ruleset and executable status", () => {
  assert.equal(program.canonicalCardId, "card.hash-1ce54e160f6984f8d86e60ea1ad700d535426e0e5294239b98f64ec422574d96");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: Give a unit -1 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
  assert.equal(program.judgeReason, undefined);
});

test("orb-of-regret: one action-speed activated ability costing the exhaust symbol", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, { kind: "activated", payments: [{ kind: "exhaust" }] });
});

test("orb-of-regret: the debuff uses the merged continuous.might instruction", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "give-minus-1-might");
  assert.equal(instruction.op, "continuous.might");
  assert.notEqual(instruction.op, "effect.buff");
  assert.deepEqual(instruction.args.target, { kind: "constant", value: "affected-unit" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(instruction.args.minimum, { kind: "constant", value: 1 });
  assert.equal(instruction.linkedTo, undefined);
  assert.deepEqual(instruction.targets, [
    { id: "affected-unit", filter: { type: "unit", zone: "board" }, min: 1, max: 1, selection: "one" }
  ]);
});

test("orb-of-regret golden: the supported exhaust cost pays and exhausts the gear (CR 415.4/415.5)", () => {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .unit("orb-of-regret", {
      types: ["gear"],
      might: null,
      energy: 1,
      power: null,
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 3 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("orb-of-regret") });

  const receipt = payCostPlan(
    context,
    buildCostPlan(context, { id: "orb-of-regret:activate", cost: ability.cost })
  );
  assert.equal(receipt.paid, true);
  assert.equal(context.getObject("orb-of-regret").exhausted, true);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay", "exhaust"]);
});

test("orb-of-regret golden: the body registers the temporary -1 Might with its printed minimum", () => {
  const kernel = world()
    .unit("orb-of-regret", {
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" }
    })
    .unit("affected-unit", { owner: "B", controller: "B", might: 2, zone: "board" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("orb-of-regret") });
  context.setTargets("affected-unit", [context.ref("affected-unit")]);

  const outcome = runAbilityBody(ability.body, context);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["give-minus-1-might", "executed"]
  ]);
  assert.equal(context.continuousEffects.length, 1);
  const registration = context.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -1);
  assert.equal(registration.effect.effect.minimum, 1);

  const layers = createLayerEngine(
    [context.getObject("affected-unit")],
    context.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  assert.equal(layers.evaluate(context.ref("affected-unit")).might, 1);
  assert.equal(context.getObject("affected-unit").buffs, 0);
});

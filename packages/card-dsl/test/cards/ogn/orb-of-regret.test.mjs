import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/orb-of-regret.js";

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

test("orb-of-regret: identity, ruleset, status and specific judgeReason", () => {
  assert.equal(program.canonicalCardId, "card.hash-1ce54e160f6984f8d86e60ea1ad700d535426e0e5294239b98f64ec422574d96");
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: Give a unit -1 :rb_might: this turn, to a minimum of 1 :rb_might:."
  );
  // The reason must name the missing primitive / semantics concretely.
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /minimum of 1/);
});

test("orb-of-regret: one action-speed activated ability costing the exhaust symbol", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, { kind: "activated", payments: [{ kind: "exhaust" }] });
});

test("orb-of-regret: the debuff is described, not approximated as a Buff counter", () => {
  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "give-minus-1-might");
  // No merged opcode registers a continuous.might effect (RIFT-91); using
  // effect.buff would place a Buff counter instead of -1 Might.
  assert.equal(instruction.op, "continuous.might");
  assert.notEqual(instruction.op, "effect.buff");
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
  // The printed effect did not run: no Might change, no Buff counter.
  assert.equal(context.getObject("enemy-unit").might, 3);
  assert.equal(context.getObject("enemy-unit").buffs, 0);
});

test.todo(
  "orb-of-regret: 'Give a unit -1 [M] this turn, to a minimum of 1 [M]' needs a layers consumer that registers continuous.might from a card program plus the printed minimum clamp (CR 478.x; RIFT-91 layers-continuous)."
);

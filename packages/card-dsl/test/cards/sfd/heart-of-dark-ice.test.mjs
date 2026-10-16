import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/heart-of-dark-ice.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-fb2b68d85d71603dc36df01e06a5cedb3afd2385f4545e34f533a975f5db9ffa";
const SOURCE_TEXT = ":rb_exhaust:: Give a unit +3 :rb_might: this turn.";

const [activated] = program.abilities;
const [mightInstruction] = activated.body;
const targetSpec = mightInstruction.targets[0];

function heartWorld() {
  const base = world()
    .object("heart-of-dark-ice", {
      name: "Heart of Dark Ice",
      cardId: CANONICAL,
      types: ["gear"],
      zone: "board",
      location: { type: "base", player: "A" },
      energy: 3,
      power: 1,
      might: null
    })
    .unit("chosen-unit", { might: 2 })
    .unit("enemy-unit", { owner: "B", might: 2 })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("heart-of-dark-ice") });
}

test("sfd-052-221 Heart of Dark Ice: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-052-221 Heart of Dark Ice: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // judgeReason must name the concrete missing opcode/semantics (contract 3.1).
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /GameAction/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-052-221 Heart of Dark Ice structure: one action-speed activated ability, exhaust-self cost, one-unit +3 Might this turn", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  // Gear activated abilities default to Action timing (CR 151.2); no [Reaction] is printed.
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(activated.restriction, undefined);

  assert.equal(activated.body.length, 1);
  assert.equal(mightInstruction.id, "heart-of-dark-ice.give-plus-3-might");
  // "Give a unit +3 Might this turn" is a temporary Might modification, which belongs to
  // the layers' continuous.might effect — not to effect.buff (Buff counters, CR 702/703).
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 3 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.picks, undefined);
  assert.equal(mightInstruction.linkedTo, undefined);

  // "a unit" — exactly one Board unit, chosen by the controller (355.7/355.10).
  assert.equal(mightInstruction.targets.length, 1);
  assert.deepEqual(targetSpec, {
    id: "heart-of-dark-ice.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-052-221 Heart of Dark Ice golden: the exhaust-self activation cost is paid for real (415.3.a/415.5)", () => {
  const kernel = heartWorld();
  const plan = buildCostPlan(kernel, { id: "cost:heart-of-dark-ice", cost: activated.cost });
  assert.equal(plan.total.energy, 0);
  assert.deepEqual(plan.total.power, []);
  assert.deepEqual(
    plan.total.actions.map((action) => action.action.type),
    ["exhaust"]
  );

  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.deepEqual(
    receipt.actions.map((action) => action.action.type),
    ["pay", "exhaust"]
  );
  assert.equal(kernel.getObject("heart-of-dark-ice").exhausted, true);
  // The printed 3 energy / 1 Calm Power play cost is untouched by the ability cost.
  assert.equal(kernel.getObject("heart-of-dark-ice").energy, 3);
  assert.equal(kernel.getObject("heart-of-dark-ice").power, 1);
});

test("sfd-052-221 Heart of Dark Ice golden: the Might half has no merged primitive and fails loudly (no Buff substitute)", () => {
  // The only merged Might primitive is effect.buff, which places Buff counters (CR 702/703)
  // and must never stand in for a temporary Might change.
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
  assert.equal(instructionDefinitionsById.has("effect.buff"), true);

  const kernel = heartWorld();
  kernel.setTargets(targetSpec.id, [kernel.ref("chosen-unit")]);
  assert.throws(
    () => runAbilityBody(activated.body, kernel),
    /Unregistered instruction opcode: continuous.might/
  );
  // Real evidence that nothing was silently approximated: no Buff counter, no damage,
  // and the chosen unit keeps its printed Might.
  assert.equal(kernel.getObject("chosen-unit").buffs, 0);
  assert.equal(kernel.getObject("chosen-unit").might, 2);
  assert.equal(kernel.getObject("chosen-unit").damage, 0);
});

test("sfd-052-221 Heart of Dark Ice golden: a target that left the Board is ignored before any Might change (CR 359.3.e.6)", () => {
  const kernel = heartWorld();
  const stale = kernel.ref("chosen-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(targetSpec.id, [stale]);

  const outcome = runAbilityBody(activated.body, kernel);
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.events.length, 0);
  assert.equal(kernel.getObject("chosen-unit").might, 2);
});

test.todo("sfd-052-221 Heart of Dark Ice: '+3 Might this turn' needs the continuous.might instruction primitive / layers wiring (CR 143.2, 475, 478) - RIFT-91 follow-up; no card or cost code may approximate it with Buff counters.");
test.todo("sfd-052-221 Heart of Dark Ice: the program -> activated ability -> chain activation wiring (contract 3.5) is not merged (RIFT-120 follow-up); the exhaust cost above is already executed through the real cost pipeline.");

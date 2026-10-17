import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vaults-of-helia.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-0b929c2c78280ff14e852a6d803fa3e55251591cfc73088ec115c83af1360d7e";
const SOURCE_TEXT =
  "When you hold here, your non-token units cost :rb_energy_1: more to play this turn.";

const [ability] = program.abilities;
const [increase] = ability.body;

/** A real merged cost plan for a printed-3 unit with the +1 Energy increase installed. */
function planWithCardIncrease(energy) {
  const base = world().hand("source", { types: ["unit"], energy }).build();
  const ctx = base.clone({ sourceSnapshot: base.object(base.ref("source")) });
  return buildCostPlan(ctx, {
    id: "play",
    cost: { kind: "printed" },
    printed: { id: "unit", cardType: "Unit", domains: ["Colorless"], energy, power: 0 },
    increases: [
      {
        id: "vaults-of-helia",
        cost: { kind: "explicit", energy: { kind: "constant", value: 1 } }
      }
    ]
  });
}

test("unl-219-219 Vaults of Helia: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-219-219 Vaults of Helia: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /356\.3/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /hold/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-219-219 Vaults of Helia: hold trigger for this Battlefield's controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.d / 383.4.d.2.b: a Hold Effect; "here" is this Battlefield (053.3)
  // and "you" its controller (190.6.d). No "may": the trigger is mandatory.
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, {
    event: "hold",
    here: true,
    player: "controller"
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("unl-219-219 Vaults of Helia: one +1 Energy increase for the controller's non-token units", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(increase.id, "vaults-of-helia.increase-unit-cost");
  // 356.3: a play-cost increase, not a resolution-time resource action; the
  // primitive is present, while static installation remains the judged gap.
  assert.equal(increase.op, "cost.modify");
  assert.deepEqual(increase.args.resource, { kind: "constant", value: "energy" });
  assert.deepEqual(increase.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(increase.args.appliesTo, { kind: "constant", value: "play-cost" });
  assert.deepEqual(increase.args.duration, { kind: "constant", value: "this-turn" });
  // 185.1.a / 185.3.a.1: the printed scope is non-token units controlled by the
  // hold's player, which the declared filter records.
  assert.deepEqual(increase.args.filter.value, {
    type: "unit",
    controller: "controller",
    isToken: false
  });
  assert.equal(increase.targets, undefined);
  assert.equal(increase.picks, undefined);
  assert.equal(increase.linkedTo, undefined);
});

test("unl-219-219 Vaults of Helia: the announced increase really raises a merged cost plan", () => {
  // The merged cost plan supports the 356.3 increase stage; installing that
  // increase is the judged part. The golden proves the arithmetic this card
  // announces: a printed-3 unit costs 4, and the printed cost stays intact
  // (206: cost queries use the printed/copied cost).
  const plan = planWithCardIncrease(3);
  assert.equal(plan.total.energy, 4);
  assert.equal(plan.printed.energy, 3);
  const component = plan.components.find(entry => entry.id === "vaults-of-helia");
  assert.equal(component.stage, "increase");
  assert.equal(component.cost.energy, 1);
  assert.equal(component.cost.power.length, 0);
  assert.deepEqual(component.original, { energy: 1, power: [], xp: 0, actions: [] });
});

test.todo(
  "unl-219-219 Vaults of Helia: install the +1 Energy increase on the later plays of the hold " +
    "player's non-token units (356.3) — no merged path feeds a CardProgram static ability into a " +
    "later CostPlanInput.increases; the cost.modify primitive is present but its static installation is missing (RIFT-261)"
);

test.todo(
  "unl-219-219 Vaults of Helia: emit the hold timing point from scoring (315.2.b.2, 471.2, " +
    "473.2.b) into the chain/events pipeline and register this CardProgram's triggered ability, " +
    "including the 053.3 'here' referent — hold is emitted by turn/flow.ts now, but the here filter " +
    "is rejected by programs/filters.ts until the RIFT-31/RIFT-33 here payload exists"
);

test.todo(
  "unl-219-219 Vaults of Helia: expire the increase at end of turn ('this turn') as a duration " +
    "opened by the hold trigger, using the layers end-of-turn duration once the registration path exists"
);

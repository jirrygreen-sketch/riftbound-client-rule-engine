import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/scorn-of-the-moon.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-37e8098b66aae3a20774fb0fe94cc57402e8f238fc4c5f72a1e46172b0cfece9";
const SOURCE_TEXT =
  "[Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. Spend this Energy only during showdowns. " +
  "(Abilities that add resources can't be reacted to.)";

const [reaction, ability] = program.abilities;
const [addEnergy] = ability.body;

test("unl-197-219 Scorn of the Moon: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-197-219 Scorn of the Moon: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /showdowns/);
  assert.match(program.judgeReason, /166\.1/);
  assert.match(program.judgeReason, /gain-energy/);
  assert.match(program.judgeReason, /813\.1/);
});

test("unl-197-219 Scorn of the Moon: [Reaction] keyword plus one reaction-timed activated ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });
  assert.equal(ability.kind, "activated");
  // 813.1 / 813.1.c.2: [Reaction] on the ability grants the Closed-State permission.
  assert.equal(ability.timing, "reaction");
  // 404.1.a / 415.5: the printed :rb_exhaust: is "Exhaust me".
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "exhaust", object: "self" }]
  });
  assert.equal(ability.restriction, undefined);
});

test("unl-197-219 Scorn of the Moon: the body adds exactly 1 Energy and never Power", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(addEnergy.id, "scorn-of-the-moon.add-energy");
  assert.equal(addEnergy.op, "effect.resources");
  // 430.1 / 430.5: [Add] :rb_energy_1: adds 1 Energy. The "Spend this Energy
  // only during showdowns" restriction has no parameter in the merged primitive
  // (see judgeReason) and is deliberately not invented here.
  assert.deepEqual(addEnergy.args, { energy: { kind: "constant", value: 1 } });
  assert.equal(addEnergy.args.power, undefined);
  assert.equal(addEnergy.targets, undefined);
  assert.equal(addEnergy.picks, undefined);
  assert.equal(addEnergy.linkedTo, undefined);
});

test("unl-197-219 Scorn of the Moon golden: the printed cost pays through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 2 })
    .unit("diana", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: false
    })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("diana")) });
  const plan = buildCostPlan(ctx, { id: "scorn-of-the-moon", cost: ability.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  // The finalized plan always settles the resource component first (here 0
  // Energy), then the printed exhaust cost.
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  // The exhaust cost is a status change, not a resource payment.
  assert.equal(ctx.player("A").energy, 2);
  assert.equal(ctx.object(ctx.ref("diana")).exhausted, true);

  // 415.4 / 415.5: an already exhausted source cannot pay the Exhaust cost.
  const exhausted = world()
    .unit("diana", {
      zone: "board",
      types: ["legend"],
      controller: "A",
      exhausted: true
    })
    .build();
  const exhaustedCtx = exhausted.clone({
    sourceSnapshot: exhausted.object(exhausted.ref("diana"))
  });
  assert.throws(
    () =>
      payCostPlan(
        exhaustedCtx,
        buildCostPlan(exhaustedCtx, { id: "scorn-of-the-moon", cost: ability.cost })
      ),
    error => error?.reason === "cannot-pay-cost"
  );
});

test("unl-197-219 Scorn of the Moon golden: the Add half resolves 1 Energy into the controller's Rune Pool", () => {
  const kernel = world().player("A", { energy: 3 }).build();
  const run = runInstruction(resources, addEnergy.args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").energy, 4);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 1, power: [] });
  assert.deepEqual(run.events.map(event => event.action), ["gain-energy"]);
});

test("unl-197-219 Scorn of the Moon golden: a replaced Add reports the actual addition, never the request", () => {
  const kernel = world().player("A", { energy: 3 }).build();
  kernel.addReplacement(action => (action.type === "gain-energy" ? "prevented" : null));
  const run = runInstruction(resources, addEnergy.args, { world: kernel });
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(kernel.player("A").energy, 3);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 0, power: [] });
});

test.todo(
  "unl-197-219 Scorn of the Moon: express 'Spend this Energy only during showdowns' — the merged Rune Pool is a " +
    "single per-player energy count (CR 166.1-166.3 / 167.1) with no per-addition use restriction, the closed " +
    "gain-energy action has no restriction field, and no payment filter can honour one (contract change request)"
);
test.todo(
  "unl-197-219 Scorn of the Moon: the Reaction keyword's own expansion (CR 813 / effects/keywords/Reaction.ts) " +
    "reaching a layers consumer (RIFT-91) — the ability's own reaction timing field is what the chain reads today"
);

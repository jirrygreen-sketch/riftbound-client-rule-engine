import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/dancing-grenade.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { prepareCostPayment } from "../../../../engine-core/dist/cost/payment.js";
import { DUEL_DOMAINS } from "../../../../engine-core/dist/cost/resources.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-4609651295618e769925ca1121b1e4b5f1589eaef0c44d494c4efea35f85899c";
const SOURCE_TEXT =
  "Deal 2 to a unit. Its controller may play this spell again for :rb_rune_rainbow:. " +
  "If they do, this deals 1 additional Bonus Damage for each time this spell has dealt damage this turn.";

const [play] = program.abilities;
const [dealTwo] = play.body;
const UNIT = "dancing-grenade.unit";

test("unl-020-219 Dancing Grenade: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-020-219 Dancing Grenade: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /158\.3/);
  assert.match(program.judgeReason, /420\.3/);
  assert.match(program.judgeReason, /Bonus Damage/);
  assert.match(program.judgeReason, /rainbow/);
});

test("unl-020-219 Dancing Grenade: only the printed Deal 2 instruction is executable, no fabricated replay", () => {
  // The re-play and the Bonus Damage count have no merged producer (see judgeReason), so the
  // body carries the one printed instruction whose primitive is merged; nothing is added that
  // would encode the missing semantics as fact.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map(instruction => [instruction.id, instruction.op]), [
    ["dancing-grenade.deal-2", "effect.damage"]
  ]);
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(dealTwo.args.target, { kind: "constant", value: UNIT });
  assert.equal(Object.hasOwn(dealTwo.args, "bonus"), false);
  assert.deepEqual(dealTwo.targets, [
    {
      id: UNIT,
      filter: { type: "unit", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  assert.equal(dealTwo.linkedTo, undefined);
  assert.equal(dealTwo.picks, undefined);
});

test("unl-020-219 Dancing Grenade golden: Deal 2 marks 2 on the locked unit", () => {
  const kernel = world().unit("target-unit", { might: 5 }).build();
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [kernel.ref("target-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("target-unit").damage, 2);
  assert.equal(run.linked.dealt, 2);
  assert.equal(run.linked.dealtCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("unl-020-219 Dancing Grenade golden: the merged bonus argument applies positive Bonus Damage per target (714/715.2)", () => {
  // The printed count has no producer; this locks the merged Bonus Damage arithmetic the
  // replay clause would feed once the count exists, without asserting any fabricated count.
  const kernel = world().unit("target-unit", { might: 9 }).build();
  const run = runInstruction(
    damage,
    {
      amount: dealTwo.args.amount,
      bonus: { kind: "constant", value: 1 },
      target: UNIT
    },
    { world: kernel, targets: { [UNIT]: [kernel.ref("target-unit")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("target-unit").damage, 3);
  assert.equal(run.linked.dealt, 3);
});

test("unl-020-219 Dancing Grenade golden: a stale target is ignored instead of redirected", () => {
  const kernel = world().unit("target-unit", { might: 5 }).build();
  const stale = kernel.ref("target-unit");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: UNIT },
    { world: kernel, targets: { [UNIT]: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
});

test.todo("unl-020-219 Dancing Grenade: 'Its controller may play this spell again for :rb_rune_rainbow:' still needs a resolving-chain-item replay path with the official source and nested-order ruling (CR 158.3 / 420.3)");
test.todo("unl-020-219 Dancing Grenade: 'for each time this spell has dealt damage this turn' still needs a per-card damage history count, because effect.damage links only one action's dealt/dealtTo/dealtCount");

test("unl-020-219 Dancing Grenade golden: the merged cost plan accepts a domainless 1 Power replay cost", () => {
  // CR 135.2.e.5.a / 163.2.b: domains: [] is the catalog spelling for
  // Universal Power. The cost layer expands it to all six Domains; this proves
  // cost expressivity while the resolving-chain replay lifecycle remains TODO.
  const kernel = world()
    .player("A", { energy: 0, power: ["Order"] })
    .hand("replay-source", { types: ["spell"], energy: 0, power: ["Order"] })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.getObject("replay-source"), controller: "A" });
  const plan = buildCostPlan(ctx, {
    id: "dancing-grenade.replay-cost",
    cost: { kind: "printed" },
    printed: { id: "dancing-grenade", cardType: "Spell", energy: 0, power: 1, domains: [] }
  });
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: DUEL_DOMAINS }]);
  assert.deepEqual(prepareCostPayment(ctx, plan).actions[0].action.plan.power, ["Order"]);
});


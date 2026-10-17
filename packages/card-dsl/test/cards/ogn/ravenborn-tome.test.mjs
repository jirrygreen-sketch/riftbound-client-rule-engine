import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/ravenborn-tome.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";

const CANONICAL = "card.hash-fed7336f370509d9739c01e6813a264dc909243982f13ef7bff71824fb66ee08";

const [activated] = program.abilities;
const [grantBonusDamage] = activated.body;

test("ogn-032-298 Ravenborn Tome: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // The judgeReason must cite the delayed passive ability rule that names this card.
  assert.match(program.judgeReason, /392/);
  assert.match(program.judgeReason, /Bonus Damage/);
  // The chain/event work is merged; the missing piece is the registered op and
  // its next-spell association, so the reason no longer lists RIFT-120 as a gap.
  assert.ok(!/RIFT-120/.test(program.judgeReason));
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /生效的指令注册表里没有/);
  assert.match(program.judgeReason, /链\/事件接线已合入/);
  assert.equal(
    program.sourceText,
    ":rb_exhaust:: The next spell you play this turn deals 1 Bonus Damage. " +
      "(Each instance of damage the spell deals is increased by 1.)"
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Ravenborn Tome structure: exhaust-cost ability granting 1 Bonus Damage to the next spell", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  assert.deepEqual(activated.cost.payments, [{ kind: "exhaust" }]);

  assert.equal(activated.body.length, 1);
  assert.equal(grantBonusDamage.id, "ravenborn-tome.grant-bonus-damage");
  // The op is the unmerged delayed-passive/layer grant, not a static damage bonus.
  assert.equal(grantBonusDamage.op, "continuous.bonus-damage");
  assert.deepEqual(grantBonusDamage.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(grantBonusDamage.args.appliesTo, {
    kind: "constant",
    value: "next-spell-you-play"
  });
  assert.deepEqual(grantBonusDamage.args.duration, {
    kind: "constant",
    value: "end-of-turn"
  });
  // 715: Bonus Damage applies to each instance of damage the spell deals.
  assert.deepEqual(grantBonusDamage.args.scope, {
    kind: "constant",
    value: "each-instance"
  });
  assert.equal(grantBonusDamage.targets, undefined);
  assert.equal(grantBonusDamage.linkedTo, undefined);
  assert.equal(grantBonusDamage.condition, undefined);
});

test("Ravenborn Tome golden: the exhaust cost is charged and exhausts the Gear itself", () => {
  const base = world()
    .unit("ravenborn-tome", { types: ["gear"], zone: "board", location: { type: "base", player: "A" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("ravenborn-tome") });
  const plan = buildCostPlan(kernel, {
    id: "cost:ravenborn-tome",
    cost: { kind: "activated", payments: [{ kind: "exhaust" }] }
  });
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("ravenborn-tome").exhausted, true);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
});

test("Ravenborn Tome golden: effect.damage applies the Bonus Damage it is handed (CR 714/715.2)", () => {
  // The primitive sums the supplied Bonus Damage and applies it per target; the card itself
  // cannot hand it the 1 point without the delayed grant (see judgeReason).
  const kernel = world()
    .unit("enemy-unit", { zone: "board", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const locked = kernel.ref("enemy-unit");
  const run = runInstruction(
    damage,
    {
      amount: { kind: "constant", value: 3 },
      bonus: { kind: "constant", value: grantBonusDamage.args.amount.value },
      target: "spell-target"
    },
    { world: kernel, targets: { "spell-target": [locked] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").damage, 4);
  assert.equal(run.result.linkedValues.dealt, 4);
});

test.todo(
  "Ravenborn Tome: “The next spell you play this turn deals 1 Bonus Damage.” is a Delayed Passive " +
    "Ability named by CR v1.5 392. Registering it needs a delayed-passive registration path " +
    "(ResolveContext.registerDelayedTrigger has no registered instruction primitive: the effective " +
    "registry has no trigger.delayed or continuous.bonus-damage op) plus the consumer that grants " +
    "Bonus Damage (713/714/715) to just that spell."
);

test.todo(
  "Ravenborn Tome: the “this turn” expiry (CR v1.5 392 specified time / 393 delayed abilities) " +
    "depends on the delayed-ability registration and grant pipeline; the layer duration " +
    "registry already models end-of-turn expiry, but nothing registers the grant to expire."
);

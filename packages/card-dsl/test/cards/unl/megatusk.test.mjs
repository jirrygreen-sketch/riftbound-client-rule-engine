import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/megatusk.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-1c5a34df03f1f2101ee472f6d3fd4673e56683b49f28e64e3d9d4291bc6d8448";
const SOURCE_TEXT =
  "Spend 3 XP: Give your units here [Ganking] this turn. (We can move from " +
  "battlefield to battlefield.)";

const [ability] = program.abilities;
const [grant] = ability.body;
const targetSpec = grant.targets[0];

function megatuskWorld({ xp = 5 } = {}) {
  const base = world()
    .player("A", { xp })
    .unit("megatusk", {
      might: 6,
      energy: 6,
      power: null,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("megatusk") });
}

test("unl-126-219 Megatusk: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-126-219 Megatusk: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /continuous\.keyword/);
  assert.match(program.judgeReason, /810/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("unl-126-219 Megatusk: 3 XP base cost, Action timing, no printed Exhaust", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 204.1.b / 377.1: the text before the ":" is the base cost; 730.2 is Spend XP.
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    payments: [{ kind: "xp", amount: { kind: "constant", value: 3 } }]
  });
  assert.equal(ability.restriction, undefined);
});

test("unl-126-219 Megatusk: the grant names Ganking with an end-of-turn duration and 'here' scope", () => {
  assert.equal(grant.id, "megatusk.grant-ganking");
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "ganking" });
  // 801.3.a.2 / 317.2.c: the granted keyword carries the printed "this turn" duration.
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(grant.linkedTo, undefined);
  assert.equal(grant.picks, undefined);

  // "your units here": controller anchor + 359.3.f "here" via sameLocationAs.
  assert.deepEqual(targetSpec, {
    id: "megatusk.units-here",
    filter: {
      type: "unit",
      controller: "controller",
      zone: "board",
      sameLocationAs: "source"
    },
    min: 0,
    selection: "all"
  });
});

test("unl-126-219 Megatusk golden: the printed 3 XP activation cost is payable through the merged cost pipeline", () => {
  const kernel = megatuskWorld({ xp: 5 });
  const plan = buildCostPlan(kernel, { id: "megatusk", cost: ability.cost });
  assert.equal(plan.total.energy, 0);
  assert.equal(plan.total.xp, 3);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  // 730.2: Spend XP reduces the marked XP of the player spending it.
  assert.equal(kernel.player("A").xp, 2);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "spend-xp"]);
});

test("unl-126-219 Megatusk golden: insufficient XP is refused instead of paid partially", () => {
  // 203.3 / 358.5: a cost that cannot be paid in full aborts the Finalize transaction.
  const kernel = megatuskWorld({ xp: 2 });
  const plan = buildCostPlan(kernel, { id: "megatusk", cost: ability.cost });
  assert.throws(() => payCostPlan(kernel, plan), /Insufficient XP/);
  assert.equal(kernel.player("A").xp, 2);
});

test.todo(
  "unl-126-219 Megatusk: give your units here [Ganking] this turn (801.3.a.2 granted keyword + 810 " +
    "expansion) — effects/instructions has no continuous.grant-keyword / continuous.keyword primitive " +
    "and no CardProgram-as-continuous-effect registration path (RIFT-9 / RIFT-81 / RIFT-91 / RIFT-89)"
);

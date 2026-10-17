import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/matriarch-of-war.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";

const CANONICAL_ID =
  "card.hash-bf30c710a85c78a9c386b4d6c5d52a3aa4ff1d9d0eba7b82b1ba9ef0917f2b94";
const SOURCE_TEXT =
  "When you empower something else, empower me. (I become Empowered if I'm not already.)\n" +
  "Disempower me, :rb_rune_rainbow:, :rb_exhaust:: Ready a unit.";

const [triggered, activated] = program.abilities;

test("ven-153-166 Matriarch of War: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /empowered-changed/);
  assert.match(program.judgeReason, /disempower/);
  assert.match(program.judgeReason, /rainbow/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-153-166: the empower-something-else trigger mirrors the Soul's Reflection shape", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "empowered-changed");
  assert.deepEqual(triggered.trigger.filter, {
    event: "empowered-changed",
    filter: { player: "self", other: true, direction: "increase" }
  });
  assert.equal(triggered.optional, false);
  const [empowerSelf] = triggered.body;
  assert.equal(empowerSelf.id, "matriarch-of-war.empower-self");
  assert.equal(empowerSelf.op, "effect.empower");
  assert.deepEqual(empowerSelf.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
});

test("ven-153-166: Disempower + [A] + Exhaust cost and 'Ready a unit'", () => {
  assert.equal(activated.kind, "activated");
  assert.equal(activated.timing, "action");
  // 135.2.e.5.a / 163.2.b: :rb_rune_rainbow: is Power of any Domain ([A]);
  // the six closed domains express the payable union.
  assert.deepEqual(activated.cost.power, { kind: "constant", value: ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"] });
  assert.deepEqual(activated.cost.payments, [
    { kind: "disempower", object: "self" },
    { kind: "exhaust", object: "self" }
  ]);
  assert.equal(activated.body.length, 1);
  const [readyUnit] = activated.body;
  assert.equal(readyUnit.id, "matriarch-of-war.ready-unit");
  assert.equal(readyUnit.op, "effect.ready");
  assert.deepEqual(readyUnit.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "matriarch-of-war.unit" }
  });
  assert.deepEqual(readyUnit.targets[0].filter, { type: "unit", zone: "board" });
  assert.equal(readyUnit.targets[0].selection, "one");
});

test("ven-153-166 golden: 'empower me' empowers the legend source through the interpreter", () => {
  const kernel = world()
    .unit("matriarch-of-war", { types: ["legend"], zone: "board" })
    .build();
  const context = kernel.clone({
    sourceSnapshot: kernel.getObject("matriarch-of-war")
  });

  const outcome = runAbilityBody(triggered.body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.getObject("matriarch-of-war").empowered, 1);
  assert.deepEqual(context.events.map(event => event.action), ["empower"]);
});

test("ven-153-166 golden: 'Ready a unit' readies an exhausted unit through the interpreter", () => {
  const kernel = world()
    .unit("matriarch-of-war", { types: ["legend"], zone: "board" })
    .unit("friendly-unit", { zone: "board", exhausted: true })
    .build();
  kernel.setTargets("matriarch-of-war.unit", [kernel.ref("friendly-unit")]);

  const outcome = runAbilityBody(activated.body, kernel, undefined, {
    host: kernel.ref("matriarch-of-war")
  });
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("friendly-unit").exhausted, false);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
});

test("ven-153-166 golden: the printed [A] Power uses all six payable domains", () => {
  const kernel = world().unit("matriarch-of-war", { types: ["legend"], zone: "board" }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("matriarch-of-war") });
  const sixDomains = activated.cost.power.value;
  const plan = buildCostPlan(context, {
    id: "matriarch-of-war.power",
    cost: {
      payments: [{
        kind: "power",
        amount: { kind: "constant", value: 1 },
        allowedDomains: sixDomains
      }]
    }
  });
  assert.deepEqual(plan.total.power, [{ amount: 1, allowedDomains: sixDomains }]);
});

test.todo(
  "ven-153-166: the empowered-changed trigger still needs increase-direction and " +
    "something-else host exclusion fields in the event contract"
);
test.todo(
  "ven-153-166: the activated cost still needs a Disempower payment kind in the finalized cost plan " +
    "(CR 443.2.a)"
);

test("ven-153-166 binding: the merged program registry exposes the two printed abilities", () => {
  // ProgramRegistry 用 canonicalCardId 解析整张程序；两条能力的 IR
  // 形状（triggered + activated）都能通过校验，缺口只在事件词汇与费用种类。
  const program0 = { ...program, status: "executable", judgeReason: undefined };
  const registry = new ProgramRegistry([program0]);
  const resolved = registry.get(CANONICAL_ID);
  assert.equal(resolved.canonicalCardId, CANONICAL_ID);
  assert.deepEqual(resolved.abilities.map(ability => ability.kind), ["triggered", "activated"]);
});

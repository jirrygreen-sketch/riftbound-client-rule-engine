import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/matriarch-of-war.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { CostPlanError } from "../../../../engine-core/dist/cost/plan-types.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

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
  assert.match(program.judgeReason, /RIFT-261/);
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
  // 135.2.e.5.a / 163.2.b: :rb_rune_rainbow: is Power of any Domain ([A]); the
  // closed six-domain union has no value for it, so "rainbow" stays descriptive.
  assert.deepEqual(activated.cost.power, { kind: "constant", value: ["rainbow"] });
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

test.todo(
  "ven-153-166: trigger only on the increase direction and only for " +
    "\"something else\" — empowered-changed fires for empower and disempower alike (443.1) and the " +
    "payload has no direction/host-exclusion support (contract change request, RIFT-120)"
);

test.todo(
  "ven-153-166: pay 'Disempower me' plus :rb_rune_rainbow: ([A], 163.2.b) — no disempower payment " +
    "kind in cost/plan-values.ts and no Universal Power value in the closed Domain union (RIFT-261)"
);

test("ven-153-166: the descriptive empowered-changed filter is rejected by the strict trigger validator", () => {
  const result = validateTriggerSpec(triggered.trigger);
  assert.equal(result.ok, false);
  const codes = result.issues.map(issue => issue.code);
  assert.ok(codes.includes("invalid-event-type"), JSON.stringify(codes));
  assert.ok(codes.includes("unknown-field"), JSON.stringify(codes));
});

test("ven-153-166: the printed [A] cost is rejected by the closed six-domain set", () => {
  // 443.2.a 的 Disempower 与 163.2.b 的任意域 Power 都没有费用管线消费方；印刷的
  // ["rainbow"] 不属于六域封闭集合，费用域校验拒绝，而不是近似成某个域。
  const kernel = world()
    .unit("matriarch-of-war", { types: ["legend"], zone: "board" })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("matriarch-of-war") });

  assert.throws(
    () => buildCostPlan(context, { id: "cost", cost: activated.cost }),
    error => error instanceof CostPlanError && error.reason === "invalid-cost-plan" &&
      /Expected unique cost domains/.test(error.message)
  );
});

test("ven-153-166 binding: the merged program registry exposes the two printed abilities", () => {
  // RIFT-257 的 ProgramRegistry 用 canonicalCardId 解析整张程序；两条能力的 IR
  // 形状（triggered + activated）都能通过校验，缺口只在事件词汇与费用种类。
  const program0 = { ...program, status: "executable", judgeReason: undefined };
  const registry = new ProgramRegistry([program0]);
  const resolved = registry.get(CANONICAL_ID);
  assert.equal(resolved.canonicalCardId, CANONICAL_ID);
  assert.deepEqual(resolved.abilities.map(ability => ability.kind), ["triggered", "activated"]);
});

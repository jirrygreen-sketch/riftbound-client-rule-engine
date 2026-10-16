import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/renekton-brute.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-84a15f0f4b24ba842c5300ae2aa02facd4e08b04b533d248b5acc6aa5e2f1983";
const SOURCE_TEXT =
  ":rb_energy_1:: Give me +1 :rb_might: this turn.\n" +
  "When my Might becomes 10 or more, empower me. (I become Empowered if I'm not already.)\n" +
  "[Empowered][>] I have [Deflect] and [Ganking]. (Opponents must pay :rb_rune_rainbow: to choose me " +
  "with a spell or ability. I can move from battlefield to battlefield.)";

const [activated, mightTrigger, keywordGrant] = program.abilities;
const [mightModify] = activated.body;
const [empowerSelf] = mightTrigger.body;

const renektonWorld = () => {
  const base = world()
    .player("A", { energy: 3 })
    .unit("renekton", {
      might: 4,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  return base.clone({
    controller: "A",
    sourceSnapshot: base.getObject("renekton")
  });
};

test("ven-092-166 Renekton, Brute: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-092-166 Renekton: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /might-modify|Might 修正/);
  assert.match(program.judgeReason, /might-changed/);
  assert.match(program.judgeReason, /RIFT-87/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-092-166 Renekton: '1 Energy: give me +1 Might this turn' is an action-speed activated ability", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(activated.kind, "activated");
  // 145.2：单位启动能力默认在其控制者的 Main 阶段执行（普通时机）。
  assert.equal(activated.timing, "action");
  // 404.1.a / 415.5：":" 前的 :rb_energy_1: 是 Base Cost。
  assert.deepEqual(activated.cost, { kind: "activated", energy: { kind: "constant", value: 1 } });
  assert.equal(activated.body.length, 1);
  assert.equal(mightModify.id, "renekton.give-plus-1-might");
  // 479.4.e.1 的临时 Might 修正形状；该 op 未注册（见 judgeReason 第 1 条）。
  assert.equal(mightModify.op, "effect.might-modify");
  assert.deepEqual(mightModify.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightModify.args.duration, { kind: "constant", value: "this-turn" });
  // “me” 是能力宿主：用契约 3.6 的符号选择器而不是 TargetSpec（355.10.d/g）。
  assert.deepEqual(mightModify.args.object, {
    kind: "constant",
    value: { kind: "source" }
  });
  assert.equal(mightModify.targets, undefined);
  assert.equal(mightModify.picks, undefined);
});

test("ven-092-166 golden: the printed 1 Energy cost is charged by the merged cost plan", () => {
  const kernel = renektonWorld();
  const plan = buildCostPlan(kernel, { id: "cost:renekton", cost: activated.cost });

  assert.deepEqual(plan.total, { energy: 1, power: [], xp: 0, actions: [] });
  const receipt = payCostPlan(kernel, plan);

  assert.equal(receipt.paid, true);
  assert.equal(kernel.player("A").energy, 2);
  assert.deepEqual(receipt.actions.map((entry) => entry.action.type), ["pay"]);
});

test("ven-092-166: 'When my Might becomes 10 or more' watches the might-changed timing point", () => {
  assert.equal(mightTrigger.kind, "triggered");
  // 143.2 / 708 / 709：Might 变化事件的观察时点，载荷带 previousMight/currentMight。
  assert.equal(mightTrigger.trigger.at, "might-changed");
  assert.deepEqual(mightTrigger.trigger.filter, {
    event: "might-changed",
    filter: { source: "self" }
  });
  assert.equal(mightTrigger.optional, false);
  // 709 的转换语义（previousMight < 10 ≤ currentMight）无法完整表达：EventPattern 的
  // details 只接受标量、NumericMatcher 只作用于 event.amount，因此只保留当前值一侧
  //（见 judgeReason 第 2 条）。
  assert.deepEqual(mightTrigger.trigger.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "might" },
    operator: "gte",
    right: { kind: "constant", value: 10 }
  });
  assert.equal(mightTrigger.trigger.once, undefined);
});

test("ven-092-166 golden: 'empower me' empowers the ability source through the real primitive", () => {
  assert.equal(empowerSelf.id, "renekton.empower-self");
  assert.equal(empowerSelf.op, "effect.empower");
  // 442.1 / 827.1.b.1：“empower me” 以来源自身为对象，不是目标。
  assert.deepEqual(empowerSelf.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(empowerSelf.targets, undefined);

  const kernel = renektonWorld();
  const outcome = runAbilityBody(mightTrigger.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["renekton.empower-self", "executed"]]
  );
  assert.equal(kernel.getObject("renekton").empowered, 1);
  assert.deepEqual(kernel.events.map((event) => event.action), ["empower"]);
  assert.deepEqual(outcome.linkedValues["renekton.empower-self.empowered"], {
    mode: "empower",
    count: 1,
    objects: [kernel.ref("renekton")]
  });
});

test("ven-092-166: [Empowered][>] grants Deflect and Ganking behind the descriptive Empowered gate", () => {
  assert.equal(keywordGrant.kind, "static");
  // 828.1.b.1 的依赖能力：只在宿主 Empowered 时授予两个关键词（809/810）。
  // continuous.grant-keyword 没有已合入的图层消费方（RIFT-91），故按契约写出 shape。
  assert.deepEqual(keywordGrant.effect, {
    kind: "continuous.grant-keyword",
    keywords: [{ id: "Deflect" }, { id: "Ganking" }],
    appliesTo: "self"
  });
  assert.equal(keywordGrant.condition.kind, "compare");
  assert.equal(keywordGrant.condition.operator, "gte");
  assert.deepEqual(keywordGrant.condition.right, { kind: "constant", value: 1 });
});

test.todo(
  "ven-092-166 Renekton: 'give me +1 :rb_might: this turn' needs a registered temporary Might modification " +
    "(479.4.e.1 with the 315.4 / 317.2.c end-of-turn expiry) — the closed GameAction set has no Might-modification " +
    "action and no continuous.might instruction exists (RIFT-91)"
);

test.todo(
  "ven-092-166 Renekton: the 'becomes 10 or more' transition (709 previousMight < 10 <= currentMight) needs the " +
    "might-changed payload exposed to trigger matching — EventPattern.details only accepts scalars and NumericMatcher " +
    "only matches event.amount (RIFT-87/RIFT-120)"
);

test.todo(
  "ven-092-166 Renekton: the [Empowered][>] grant of [Deflect] and [Ganking] needs an Empowered predicate (442.1.a, " +
    "RIFT-87) plus keyword consumers — Deflect's target tax (RIFT-90) and Ganking's continuous.movement permission (RIFT-91)"
);

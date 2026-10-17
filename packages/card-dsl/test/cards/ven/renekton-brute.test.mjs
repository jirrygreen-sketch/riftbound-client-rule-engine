import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
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
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /might-changed/);
  assert.match(program.judgeReason, /createTargetTaxAdapter/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(87|89|90|120)/);
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
  assert.doesNotMatch(program.judgeReason, /没有注册的 Might 修正原语/);
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
  // 479.4.e.1 的临时 Might 修正形状；continuous.might 已合入（RIFT-258）。
  assert.equal(mightModify.op, "continuous.might");
  assert.deepEqual(mightModify.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightModify.args.duration, { kind: "constant", value: "this-turn" });
  // “me” 是能力宿主：355.10.d/g 的按特征自我指代不是目标，由 appliesTo "self" 表达。
  assert.deepEqual(mightModify.args.appliesTo, { kind: "constant", value: "self" });
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

test("ven-092-166: [Empowered][>] grants Deflect and Ganking behind the live Empowered gate", () => {
  assert.equal(keywordGrant.kind, "static");
  // 828.1.b.1 的依赖能力：只在宿主 Empowered 时授予两个关键词（809/810）。
  // continuous.grant-keyword 的指令与 static 绑定已合入；缺的是关键词的下游图层消费方，故按契约写出 shape。
  assert.deepEqual(keywordGrant.effect, {
    kind: "continuous.grant-keyword",
    keywords: [{ id: "Deflect" }, { id: "Ganking" }],
    appliesTo: "self"
  });
  assert.deepEqual(keywordGrant.condition.left, {
    kind: "object-property", object: "self", property: "empowered"
  });
  assert.equal(keywordGrant.condition.kind, "compare");
  assert.equal(keywordGrant.condition.operator, "gte");
  assert.deepEqual(keywordGrant.condition.right, { kind: "constant", value: 1 });
});

test("ven-092-166 golden: 'give me +1 Might this turn' registers an arithmetic-layer boost on the source", () => {
  const kernel = renektonWorld();
  const outcome = runAbilityBody(activated.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["renekton.give-plus-1-might", "executed"]]
  );
  // 479.4.e.1：一条算术层注册，来源为本卡，回合结束到期（315.4 / 317.2.c）。
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 1);
  assert.deepEqual(registration.effect.filter.objectId, "renekton");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
});
test.todo(
  "ven-092-166 Renekton: the 'becomes 10 or more' transition (709 previousMight < 10 <= currentMight) needs the " +
    "might-changed payload exposed to trigger matching — EventPattern.details only accepts scalars, NumericMatcher " +
    "only matches event.amount, and the might-changed producer is not wired into the pipeline"
);

test.todo(
  "ven-092-166 Renekton: the [Empowered][>] grant of [Deflect] and [Ganking] needs the production ObjectSnapshot.empowered contract (442.1.a) " +
    "plus production consumers — the merged Deflect target tax collector must enter Chain Finalize as Power, and " +
    "granted Ganking must enter standard movement (continuous.grant-keyword and rule queries are merged)"
);

test("ven-092-166 Renekton regression: the original keyword grant follows real Empower and Disempower actions", () => {
  const { kernel, engine } = staticFixture([
    { id: "renekton", cardId: CANONICAL, types: ["unit"], zone: "board", might: 9 }
  ]);
  const source = kernel.getObject("renekton");
  createEngineStaticBinder(engine).bindStatic(keywordGrant, source);
  assert.deepEqual(engine.layers.snapshot(source.ref).keywords, []);
  assert.equal(engine.commit({ type: "empower", object: source.ref }).status, "done");
  assert.deepEqual(engine.layers.snapshot(source.ref).keywords.map(keyword => keyword.id), ["Deflect", "Ganking"]);
  assert.equal(engine.commit({ type: "disempower", object: source.ref }).status, "done");
  assert.deepEqual(engine.layers.snapshot(source.ref).keywords, []);
});


function staticFixture(cards) {
  const builder = world().player("A", { energy: 20 }).player("B", { energy: 20 })
    .unit("source", { might: 2, location: { type: "base", player: "A" } })
    .unit("enemy", { owner: "B", might: 5, location: { type: "base", player: "B" } });
  for (const card of cards) builder.object(card.id, { location: { type: "base", player: "A" }, ...card });
  const kernel = builder.build();
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(), restore: state => kernel.restore(state),
    objects: () => kernel.objects, perform: action => kernel.perform(action),
    choose: request => kernel.choose(request),
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ host, turnOrder: ["A", "B"], turnPlayer: "A", cleanup: engine => {
    engine.layers.setObjects(kernel.objects);
    let changed = false;
    for (const object of engine.layers.evaluateAll()) {
      if (object.zone === "board" && object.types.includes("unit") && object.might !== null &&
          (object.might <= 0 || object.damage >= object.might)) {
        changed = engine.commit({ type: "kill", object: object.ref }).status === "done" || changed;
      }
    }
    return changed;
  } });
  return { kernel, engine };
}

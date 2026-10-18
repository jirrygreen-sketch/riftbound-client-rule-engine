// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/stalwart-poro.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-d758a4eb01d27daf80036a95c8930bef4e01df5c77bf18f8f92392c7dd708701";
const SOURCE_TEXT = "[Shield] (+1 :rb_might: while I'm a defender.)";

test("ogn-052-298 Stalwart Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-052-298 Stalwart Poro: identity, status, and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("ogn-052-298 Stalwart Poro: judgeReason names the missing wiring and its tasks", () => {
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /814\.1\.d/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combatRole/);
  // 复核后写入的实测缺口：条件求值抛 MissingInformation，+1 Might 永不生效。
  assert.match(program.judgeReason, /MissingInformation|Unavailable characteristic/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
});

test("ogn-052-298 Stalwart Poro: exactly one unvalued Shield keyword ability", () => {
  // CR 814.1.b.3: the omitted X is presumed to be 1, so the card omits value.
  assert.equal(program.abilities.length, 1);
  const [keyword] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "shield");
  assert.equal(keyword.value, undefined);
});

test("ogn-052-298 Stalwart Poro: the declared keyword id matches the registered KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Shield");
  assert.ok(registered, "effects/keywords/Shield.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.ok(registered.ruleRefs.includes("814.1.c"));
  assert.ok(registered.ruleRefs.includes("814.1.d.1"));
  // 814.2: granted Shield values sum into one value.
  assert.equal(registered.stacking, "sum");
});

test("ogn-052-298 Stalwart Poro: the expansion is gated on the Defender designation, not applied unconditionally", () => {
  const [expansion] = shield.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion.kind, "static");
  assert.equal(expansion.effect.kind, "continuous.might");
  assert.equal(expansion.effect.mode, "add");
  assert.equal(expansion.effect.layer, "arithmetic");
  assert.equal(expansion.effect.appliesTo, "self");
  // CR 814.1.b.3 + 814.1.c: the omitted value is 1 and the bonus only exists
  // while the unit holds the Defender designation (814.1.d/814.1.d.1).
  assert.deepEqual(expansion.effect.amount, { kind: "constant", value: 1 });
  assert.equal(expansion.condition.kind, "compare");
  assert.equal(expansion.condition.left.kind, "object-property");
  assert.equal(expansion.condition.left.object, "self");
  assert.equal(expansion.condition.left.property, "designation");
  assert.equal(expansion.condition.operator, "eq");
  assert.deepEqual(expansion.condition.right, { kind: "constant", value: "defender" });
});

test("Stalwart Poro: Shield's designation condition is not evaluable against the snapshot (current gap)", () => {
  // ObjectSnapshot 暴露 combatRole，Shield 展开读的是 designation；条件求值因此抛
  // MissingInformation，+1 Might 不会生效（这是当前缺口，不是本卡可执行的证明）。
  const [expansion] = shield.expand({ host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expansion.condition.left.property, "designation");

  const kernel = world().unit("poro", { might: 2, combatRole: "defender" }).build();
  assert.equal(Object.hasOwn(kernel.getObject("poro"), "designation"), false);
  assert.equal(kernel.getObject("poro").combatRole, "defender");

  const context = bindResolveContext(kernel, {
    source: kernel.getObject("poro"),
    sourceSnapshot: kernel.getObject("poro")
  });
  assert.throws(
    () => evaluateCondition(expansion.condition, {
      context,
      host: kernel.ref("poro"),
      linked: () => undefined,
      canLookBack: () => false,
      isIgnored: () => false
    }),
    (error) => {
      assert.match(String(error.message), /Unavailable characteristic: designation/);
      return true;
    }
  );
});

test("Stalwart Poro: the production static binder registers the arithmetic effect but the condition stays unevaluable", () => {
  // 生产 static binder 确实注册出 continuous.might 的 arithmetic 层效果；失败点在条件求值，
  // 因此图层不会给出 +1。
  // 以 executable 形态提交本体，才能走到 static binder（judge-required 会在 registry
  // 查找时先抛 judgeReason，够不到图层注册这一步）。
  const forged = { ...program, status: "executable" };
  delete forged.judgeReason;
  assert.equal(validateCardProgram(forged).ok, true);
  const state = fixture({
    cards: [{ id: "poro", cardId: program.canonicalCardId, types: ["unit"], might: 2 }]
  });
  const errors = [];
  const binding = createProgramBinding({ cardPrograms: [forged] });
  binding.attachLifecycle(state.engine, (error) => errors.push(String(error && error.message)));
  state.engine.commit({
    type: "move-zone",
    object: state.kernel.ref("poro"),
    to: "board",
    location: { type: "base", player: "A" }
  });

  assert.deepEqual(errors, []);
  assert.deepEqual(
    state.engine.layers.registry.list().map((entry) => [entry.effect.effect.kind, entry.effect.layer]),
    [["continuous.might", "arithmetic"]]
  );
  state.engine.layers.setObjects(state.kernel.objects);
  const snapshot = state.engine.layers.evaluateAll().find((object) => object.ref.id === "poro");
  assert.equal(snapshot.might, 2);
  assert.equal(snapshot.combatRole, null);
});

test("Stalwart Poro: Shield stacking still sums at the keyword level (814.2), independent of the unevaluable condition", () => {
  // 814.2 的求和由 KeywordDef 声明（stacking: sum），与 designation 条件求值是两个环节；
  // 这里证明求和本身成立、失败点只在条件。
  const registered = keywordDefinitionsById.get("Shield");
  assert.equal(registered.stacking, "sum");
  const [granted] = registered.expand({ value: 4, host: { canonicalCardId: program.canonicalCardId } });
  assert.deepEqual(granted.effect.amount, { kind: "constant", value: 4 });

  // 生产路径把条件包在 try/catch 里（programs/statics.ts: bindStaticToLayers 的
  // condition 求值失败返回 false），所以图层会静默跳过该效果——这正是本卡 +1 不生效的
  // 表现（见上一条测试对生产绑定结果的断言）。下面用恒真条件证明求和路径本身可用。
  // 相同效果在条件恒真时确实把 4 加到 Might 上，证明求和路径本身可用。
  const kernel = world().unit("poro", { might: 2, combatRole: "defender" }).build();
  const ok = createLayerEngine(kernel.objects, [{
    effect: {
      id: "probe-ok",
      layer: "arithmetic",
      source: kernel.ref("poro"),
      filter: { objectId: "poro" },
      effect: {
        kind: "continuous.might",
        mode: "add",
        layer: "arithmetic",
        appliesTo: "self",
        amount: 4,
        condition: () => true
      }
    },
    duration: { type: "permanent" },
    timestamp: 1,
    sequence: 1
  }]);
  assert.equal(ok.evaluate(kernel.ref("poro")).might, 6);
});

test.todo(
  "Stalwart Poro: make Shield's Defender condition evaluable against the live snapshot (CR 814.1.c / " +
    "814.1.d / 814.1.d.1) so +1 Might applies exactly while the unit holds the Defender designation, " +
    "and then assert the 814.2 stacking sum in the layer engine"
);

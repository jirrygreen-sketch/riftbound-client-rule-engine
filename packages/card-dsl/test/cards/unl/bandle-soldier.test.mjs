// Template execution evidence: ../templates/keyword-replacement-effect-ready-700.test.mjs
// (the earlier 678 evidence remains in the package history).
// The 2/3 XP boundary remains blocked; standalone ready is only a subeffect.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/bandle-soldier.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import level from "../../../../engine-core/dist/effects/keywords/Level.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-121fc6b958b52f3a54986facd825169683558bc6c00ae71fbb3323be8b3a1f7c";
const SOURCE_TEXT = "[Level 3][>] I enter ready. (While you have 3+ XP, get the effect.)";

const [levelKeyword, enterReadyAbility] = program.abilities;
const [enterReady] = enterReadyAbility.with;

test("unl-151-219 Bandle Soldier: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-151-219 Bandle Soldier: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /369\.3/);
  assert.match(program.judgeReason, /controller-xp/);
  // Third-sweep refresh: the Level predicate exists and its consumers are still
  // missing; RIFT-359's merged predicates cover event/result facts, not player XP,
  // so the reason no longer claims that task will supply the evaluation.
  assert.match(program.judgeReason, /condition\.predicate/);
  assert.match(program.judgeReason, /condition\.predicate has no layer mapping/);
  assert.match(program.judgeReason, /PlayerSnapshot\.xp/);
  assert.match(program.judgeReason, /golden 用生产 binder 实证/);
  assert.doesNotMatch(program.judgeReason, /依赖：RIFT-359/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-151-219 Bandle Soldier: [Level 3] is a valued Level keyword ability (CR 824.1.a)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(levelKeyword, { kind: "keyword", keyword: "level", value: 3 });
  // effects/keywords/Level.ts 已合入并发布 3 点阈值的 level-active 谓词；卡牌侧引用同一关键词身份。
  const registered = keywordDefinitionsById.get("Level");
  assert.ok(registered, "effects/keywords/Level.ts must be in the generated registry");
  assert.equal(levelKeyword.keyword, registered.keyword.toLowerCase());
  assert.equal(levelKeyword.value, 3);
  const [predicate] = level.expand({ host: { canonicalCardId: CANONICAL_ID }, value: 3 });
  assert.equal(predicate.effect.predicate, "level-active");
  assert.deepEqual(predicate.effect.threshold, { kind: "constant", value: 3 });
  // 谓词 id 按宿主 canonicalCardId 生成（与 Level.test.mjs 的同一形状）。
  assert.equal(predicate.effect.id, "level:" + CANONICAL_ID + ":3:predicate");
});

test("unl-151-219 Bandle Soldier: the dependent ability is an entry replacement, not a later ready", () => {
  // 369.3（以 Master Yi, Honed 的 “I enter ready” 为例）与 143.4 / 359.2.c：
  // 单位默认横置进场，本句替代进场方式；replacement binder 已消费此 effect.ready 形式。
  assert.equal(enterReadyAbility.kind, "replacement");
  assert.deepEqual(enterReadyAbility.replaces, {
    event: "object-enters-board",
    filter: { source: "self", exhausted: true }
  });
  assert.deepEqual(enterReadyAbility.with.map(instruction => [instruction.id, instruction.op]), [
    ["bandle-soldier.enter-ready", "effect.ready"]
  ]);
  assert.deepEqual(enterReady.args, { objects: { kind: "constant", value: { kind: "source" } } });
  assert.equal(enterReady.linkedTo, undefined);
});

test("unl-151-219 Bandle Soldier: the 3-XP gate retains the controller-xp IR shape but remains unbound", () => {
  // 824.1.b.1 / 824.1.c：Dependent Ability 只在控制者有 3+ XP 时生效。
  // XP 不是 ObjectSnapshot 特征，Condition 也没有读取它的形态（见 judgeReason）。
  // The compare/count shape records the printed gate without pretending that
  // the current interpreter can evaluate PlayerSnapshot.xp.
  assert.deepEqual(enterReadyAbility.condition, {
    kind: "compare",
    left: { kind: "count", subject: "controller-xp", filter: { player: "controller" } },
    operator: "gte",
    right: { kind: "constant", value: 3 }
  });
});

test("unl-151-219 Bandle Soldier golden: the replacement body's effect.ready readies an exhausted source", () => {
  // README 第 4 节：尚不可执行的部分保留可运行的子效果测试，用解释器 + 参考内核真实执行。
  const kernel = world()
    .unit("bandle-soldier", { name: "Bandle Soldier", might: 5, exhausted: true })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("bandle-soldier") });

  const outcome = runAbilityBody([enterReady], scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map(entry => [entry.id, entry.result.status]),
    [["bandle-soldier.enter-ready", "executed"]]
  );
  assert.equal(scoped.getObject("bandle-soldier").exhausted, false);
  assert.deepEqual(outcome.events.map(event => event.action), ["ready"]);
});

test("unl-151-219 Bandle Soldier golden: an already-ready source stays untouched (CR 416.1.b / 416.1.c)", () => {
  const kernel = world()
    .unit("bandle-soldier", { name: "Bandle Soldier", might: 5, exhausted: false })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("bandle-soldier") });

  const run = runInstruction(ready, enterReady.args, { world: scoped });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test.todo("bandle-soldier: bind the Level dependent replacement to live controller XP at 2/3 and deactivate below 3 (CR 824.1; needs condition.predicate layer mapping and a controller-xp evaluator)");

test("unl-151-219 Bandle Soldier: the production static binder has no mapping for the Level predicate ability (CR 824.1)", () => {
  // Evidence for the remaining gap: the merged Level expansion publishes
  // condition.predicate, but binding it through the production binder fails
  // before any live-XP evaluation can happen.
  const f = fixture({ cards: [
    { id: "bandle-soldier", cardId: CANONICAL_ID, types: ["unit"], zone: "board", location: { type: "base", player: "A" } }
  ] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("bandle-soldier"), to: "board", location: { type: "base", player: "A" } });
  const [predicate] = level.expand({ host: { canonicalCardId: CANONICAL_ID }, value: 3 });
  assert.throws(() => createEngineStaticBinder(f.engine).bindStatic(predicate, f.kernel.getObject("bandle-soldier")),
    /condition\.predicate has no layer mapping/);
});

test("unl-151-219 Bandle Soldier golden: the production entry replacement readies the source without emitting object-readied (369.3)", () => {
  // README section 4: exercise the declared replacement through the merged
  // production binder rather than a hand-rolled fixture. 143.4/359.2.c make the
  // unit's default entry exhausted; the printed clause replaces that state.
  const f = fixture({ cards: [{ id: "bandle-soldier", cardId: CANONICAL_ID, types: ["unit"], energy: 1, power: [] }] });
  const source = f.kernel.getObject("bandle-soldier");
  const handle = createEngineStaticBinder(f.engine).bindReplacement(enterReadyAbility, source);

  f.engine.execute(f.card("bandle-soldier", { kind: "unit", body: [] }));
  resolveAll(f.engine);

  const entered = f.kernel.getObject("bandle-soldier");
  assert.equal(entered.zone, "board");
  assert.equal(entered.exhausted, false);
  // 369.3: the entry state is rewritten, so no separate "became ready" event.
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "object-readied").length, 0);
  handle.unbind();
});

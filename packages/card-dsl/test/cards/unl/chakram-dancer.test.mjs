import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/chakram-dancer.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";

// Execution evidence for the supported card-played/grant body:
// templates/keyword-triggered-card-played-continuous-704.test.mjs.

const CANONICAL =
  "card.hash-932827b7cff5b4083f49ad39fa73a27896d400178b231d5a1952c9016f9dbaf3";
const SOURCE_TEXT =
  "[Ambush] (You may play me as a [Reaction] to a battlefield where you have units.)\n" +
  "When you play me, give your other units here [Shield] this turn. (+1 :rb_might: while they're defenders.)";

const [ambush, triggered] = program.abilities;
const [instruction] = triggered.body;
const [targetSpec] = instruction.targets;

test("unl-071-219 Chakram Dancer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-071-219 Chakram Dancer: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Ambush/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-071-219 Chakram Dancer: [Ambush] is declared as a valueless keyword (822.1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(ambush, { kind: "keyword", keyword: "ambush" });
  assert.equal(ambush.value, undefined);
});

test("unl-071-219 Chakram Dancer: the play trigger grants Shield for the turn to the other units here", () => {
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { role: "self" } });
  assert.equal(triggered.optional, false);

  assert.equal(instruction.id, "chakram-dancer.grant-shield");
  assert.equal(instruction.op, "continuous.grant-keyword");
  assert.deepEqual(instruction.args.keyword, { kind: "constant", value: "Shield" });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "end-of-turn" });
  assert.equal(instruction.linkedTo, undefined);

  assert.equal(instruction.targets.length, 1);
  assert.equal(targetSpec.id, "chakram-dancer.other-units-here");
  // "your other units here"：controller=friendly、exclude=other、sameLocationAs=here（053.3）。
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "source",
    exclude: "self"
  });
  assert.equal(targetSpec.min, 0);
  assert.equal(targetSpec.selection, "all");
});

test("unl-071-219 Chakram Dancer golden: the declared filter really resolves 'other units here' as a set", () => {
  // interpreter/selectors.ts 的 queryObjects 支持 sameLocationAs 与 exclude 两个锚点，
  // 这里用真实解释器表达式求值验证声明本身的语义（不是手工结算）。
  const kernel = world()
    .unit("chakram-dancer", { location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-here", { location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-elsewhere", { location: { type: "battlefield", id: "bf-2" } })
    .unit("enemy-here", { owner: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject("chakram-dancer") });
  // `controller: "controller"` 是契约层的占位语义，由生产的 Finalize / 目标管线解析为
  // 能力控制者（参考内核按值比较，见 ogn/pit-rookie 的同款说明）。这里显式代入解析后的
  // 控制者值，验证 sameLocationAs + exclude 两个锚点在真实查询里的行为。
  const resolvedFilter = { ...targetSpec.filter, controller: "A" };
  const count = evaluateExpression(
    { kind: "count", subject: "chakram-dancer.other-units-here", filter: resolvedFilter },
    {
      context: source,
      linked: () => undefined,
      canLookBack: () => false,
      isIgnored: () => false,
      query: (filter) => source.query(filter)
    }
  );
  // 只有 ally-here 同时满足 friendly + other + here。
  assert.equal(count, 1);
});

test("unl-071-219 Chakram Dancer: merged Ambush and grant-keyword dependencies are registered", () => {
  const ambushDef = keywordDefinitionsById.get("Ambush");
  assert.ok(ambushDef);
  assert.equal(ambushDef.valued, false);
  const expansion = ambushDef.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(expansion.map(ability => ability.effect.kind), ["play-location-permission", "continuous.timing"]);
  assert.equal(instructionDefinitionsById.has("continuous.grant-keyword"), true);
  assert.equal(targetSpec.filter.controller, "controller");
});

test("unl-071-219 Chakram Dancer golden: the merged grant-keyword op gives Shield to the locked set", () => {
  const base = world()
    .unit("chakram-dancer", { location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-here", { location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  base.setTargets(targetSpec.id, [base.ref("ally-here")]);
  const kernel = bindResolveContext(base, {
    source: base.getObject("chakram-dancer"),
    controller: "A",
    query: filter => base.query({
      ...filter,
      ...(filter.controller === "controller" ? { controller: "A" } : {})
    })
  });
  const outcome = runAbilityBody([instruction], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  const layers = createLayerEngine(kernel.objects, kernel.continuousEffects);
  assert.deepEqual(layers.evaluate(kernel.ref("ally-here")).keywords.map(keyword => keyword.id), ["Shield"]);
  assert.deepEqual(layers.evaluate(kernel.ref("enemy-here")).keywords, []);
});


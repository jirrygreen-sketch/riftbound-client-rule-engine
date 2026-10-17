import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/allay-eager-admirer.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL_ID =
  "card.hash-bd653b8aaef730f2cda1c769f847ec6222a08a3ec41066a74de13321000d898d";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "While I'm at a battlefield, your other units here have [Deflect].";

const [deflect, aura] = program.abilities;

test("unl-041-219 Allay, Eager Admirer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-041-219 Allay, Eager Admirer: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /809\.1\.c\.1/);
  assert.match(program.judgeReason, /809\.1\.b\.3/);
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /任意域|Power/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257|RIFT-90|RIFT-84/);
  assert.doesNotMatch(program.judgeReason, /effects\/instructions\/ 下没有该原语/);
});

test("unl-041-219 Allay, Eager Admirer: [Deflect] is declared without a value (809.1.b.3 presumes 1)", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(deflect, { kind: "keyword", keyword: "deflect" });
  assert.equal(deflect.value, undefined);
  // 809.1.b.3 的默认值由 effects/keywords/Deflect.ts 承担（卡内不写数值）。
  const deflectDef = keywordDefinitionsById.get("Deflect");
  assert.ok(deflectDef, "the merged Deflect KeywordDef is registered (CR 809)");
  assert.equal(deflectDef.valued, true);
  assert.equal(deflectDef.stacking, "sum");
  const [expansion] = deflectDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansion.effect.value, { kind: "constant", value: 1 });
  assert.equal(expansion.effect.kind, "target.tax");
});

test("unl-041-219 Allay, Eager Admirer: the aura grants Deflect to other friendly units at the same location", () => {
  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.grant-keyword");
  assert.equal(aura.effect.keyword, "deflect");
  // 809.1.b.3：被授予的 Deflect 无数值，按 1；多来源按 809.2 求和（由关键词文件负责）。
  assert.deepEqual(aura.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(aura.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    exclude: "self",
    sameLocationAs: "self"
  });
  // “While I'm at a battlefield”：来源在战场上时授予才生效。
  assert.equal(aura.condition.kind, "compare");
  assert.equal(aura.condition.operator, "gte");
  assert.deepEqual(aura.condition.right, { kind: "constant", value: 1 });
  assert.equal(aura.condition.left.kind, "count");
  assert.equal(aura.condition.left.subject, "objects");
  assert.deepEqual(aura.condition.left.filter, { object: "self", location: "battlefield" });
});

test("unl-041-219 Allay, Eager Admirer: the aura filter anchors resolve on the merged selector path", () => {
  // 参考内核对 `controller` 只做字面比较（见 effects/testing/README），不理解 "controller" 占位；
  // 与已合入的 the-ball / show-of-strength 等同做法，测试里只把该占位替换为具体玩家 id，
  // 卡片 IR 本身保持 "controller"（生产链路由 Finalize 解析）。
  const kernel = world()
    .unit("allay", { zone: "board", location: { type: "battlefield", id: "bf-1" }, might: 3 })
    .unit("ally-here", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("ally-elsewhere", { zone: "board", location: { type: "base", player: "A" } })
    .unit("enemy-here", { owner: "B", controller: "B", zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("allay")) });
  // sameLocationAs / exclude 由解释器的锚点解析执行（queryObjects）；controller 占位在测试里具体化。
  const probe = (filter) => runAbilityBody(
    [{
      id: "allay.probe",
      op: "condition.predicate",
      args: { condition: { kind: "constant", value: { kind: "expression", value: { kind: "count", filter } } } }
    }],
    ctx
  ).results[0].result.linkedValues.value;
  // 场上只有 ally-here 同时满足「同位置」「不是你」「敌方不算」三条锚点。
  assert.equal(probe({ ...aura.effect.filter, controller: "A" }), true);
  // sameLocationAs 真的在过滤位置上：把 ally-here 挪到基地后它就不再匹配。
  ctx.perform({ type: "move-location", object: ctx.ref("ally-here"), to: { type: "base", player: "A" } });
  assert.equal(probe({ ...aura.effect.filter, controller: "A" }), false);
  // 809.1.b.1/.b.2 / 809.1.c.1：追加费用本身没有合并的目标税消费方；此处不发明支付路径。
  assert.equal(aura.effect.filter.tag, undefined);
});

test.todo(
  "unl-041-219 Allay, Eager Admirer: wire the permanent's target.tax (CR 809.1.c/809.1.d) into target " +
    "selection so Deflect really taxes opposing spells/abilities (target-plan only appends a tax " +
    "the caller explicitly supplies)"
);
test.todo(
  "unl-041-219 Allay, Eager Admirer: pay the Deflect tax with any-domain Power (CR 809.1.c.1) — the " +
    "merged conversion books the tax as Energy in chain/engine.ts"
);
test("unl-041-219 Allay, Eager Admirer golden: the declared aura really grants Deflect to other friendly units here", () => {
  // RIFT-258 merged the continuous.grant-keyword primitive; the card's static
  // declaration maps onto the merged argument shape (objects: query/filter) and
  // the layer engine then grants the keyword to exactly the same-location
  // friendly units (801.3.a / 809.1.c). No receiver re-expansion exists yet, so
  // the tax half stays judged.
  const base = world()
    .unit("allay", { types: ["unit"], controller: "A", location: { type: "battlefield", id: "bf-1" }, might: 3 })
    .unit("ally-here", { controller: "A", location: { type: "battlefield", id: "bf-1" }, might: 2 })
    .unit("ally-elsewhere", { controller: "A", location: { type: "base", player: "A" }, might: 2 })
    .unit("enemy-here", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" }, might: 2 })
    .build();
  // chain/engine.ts resolves the static controller/owner placeholders before
  // the production matcher runs; same normalization as the merged
  // sfd/switcheroo golden.
  const kernel = bindResolveContext(base, {
    source: base.getObject("allay"),
    sourceSnapshot: base.getObject("allay"),
    controller: "A",
    query: (filter) => base.objects.filter((object) => matchesObjectFilter(
      Object.fromEntries(Object.entries(filter).map(([key, value]) =>
        [key, (key === "controller" || key === "owner") && value === "controller" ? "A" : value])),
      object
    ))
  });
  const declared = aura.effect;
  const body = [{
    id: "allay.grant-deflect",
    op: "continuous.grant-keyword",
    args: {
      keyword: { kind: "constant", value: declared.keyword },
      value: declared.value,
      objects: { kind: "constant", value: { kind: "query", filter: declared.filter } }
    }
  }];

  const outcome = runAbilityBody(body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["allay.grant-deflect.granted.count"], 1);
  assert.deepEqual(outcome.linkedValues["allay.grant-deflect.granted.objects"], [base.ref("ally-here")]);
  assert.equal(base.continuousEffects.length, 1);
  assert.equal(base.continuousEffects[0].effect.layer, "ability");

  // 809.1.b.3/809.2: the granted Deflect is value 1 and the layer engine really
  // puts the keyword on the one same-location friendly unit.
  const layers = createLayerEngine(base.objects, base.continuousEffects.map(entry => ({ ...entry })));
  assert.deepEqual(layers.evaluate(base.ref("ally-here")).keywords, [{ id: "deflect", value: 1 }]);
  assert.deepEqual(layers.evaluate(base.ref("ally-elsewhere")).keywords, []);
  assert.deepEqual(layers.evaluate(base.ref("enemy-here")).keywords, []);
  assert.deepEqual(layers.evaluate(base.ref("allay")).keywords, []);
});

test.todo(
  "unl-041-219 Allay, Eager Admirer: support the source-relative exclude:self filter in the static binder, " +
    "then derive and re-expand Deflect target.tax on every affected receiver (CR 809.1.c/809.1.d)"
);

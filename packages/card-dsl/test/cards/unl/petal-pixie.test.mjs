import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/petal-pixie.js";
import { evaluateExpression } from "../../../../engine-core/dist/effects/interpreter/expr.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-8338862de653402acc57a72f7e3d56c3cc2489ec52c8f53f9b778f26d23c59bd";
const SOURCE_TEXT =
  "I have +1 :rb_might: for each of your units with [Temporary] at my battlefield.";

const [ability] = program.abilities;
const { amount } = ability.effect;
// count 表达式的成员过滤挂在 amount 自身（契约 3.6 的 count.filter）。
const filter = amount.filter;

test("unl-076-219 Petal Pixie: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-076-219 Petal Pixie: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /Temporary/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-076-219 Petal Pixie: a self-scoped arithmetic Might modifier counted per matching unit", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(ability.effect.kind, "continuous.might");
  assert.equal(ability.effect.mode, "add");
  assert.equal(ability.effect.layer, "arithmetic");
  assert.equal(ability.effect.appliesTo, "self");

  // "+1 … for each"：数值是 count 表达式，按求值时的局面计数（契约 3.6）。
  assert.equal(amount.kind, "count");
  assert.equal(amount.subject, "your-units-with-temporary-at-my-battlefield");
  // "your units … at my battlefield"：friendly + here（053.3 的 here = 来源当前位置）。
  assert.deepEqual(filter, {
    zone: "board",
    type: "unit",
    controller: "controller",
    sameLocationAs: "self",
    hasKeyword: "temporary"
  });
});

test("unl-076-219 Petal Pixie golden: the supported part of the count only tallies friendly units at my battlefield", () => {
  const kernel = world()
    .unit("petal-pixie", { location: { type: "battlefield", id: "bf-1" } })
    .unit("fae-here", {
      location: { type: "battlefield", id: "bf-1" },
      keywords: [{ id: "temporary" }]
    })
    .unit("fae-here-2", {
      location: { type: "battlefield", id: "bf-1" },
      keywords: [{ id: "temporary" }]
    })
    .unit("vanilla-here", { location: { type: "battlefield", id: "bf-1" } })
    .unit("fae-elsewhere", {
      location: { type: "battlefield", id: "bf-2" },
      keywords: [{ id: "temporary" }]
    })
    .unit("enemy-fae-here", {
      owner: "B",
      location: { type: "battlefield", id: "bf-1" },
      keywords: [{ id: "temporary" }]
    })
    .build();
  const source = kernel.clone({ sourceSnapshot: kernel.getObject("petal-pixie") });
  // `controller: "controller"` 是契约层的占位语义，由生产的 Finalize / 图层管线解析为
  // 能力控制者（参考内核按值比较）；这里显式代入解析后的值，验证 sameLocationAs 锚点的
  // 真实查询行为。关键词成员判定的缺口见 judgeReason（hasKeyword 不是已合入的过滤位）。
  const { hasKeyword: _unsupportedKeywordAnchor, ...supportedFilter } = {
    ...filter,
    controller: "A"
  };
  const count = evaluateExpression(
    { kind: "count", subject: amount.subject, filter: supportedFilter },
    {
      context: source,
      linked: () => undefined,
      canLookBack: () => false,
      isIgnored: () => false,
      query: (queryFilter) => source.query(queryFilter)
    }
  );
  // 已支持部分（friendly + here）数出 4 个单位（含没有 Temporary 的 vanilla-here）。
  // 缺 hasKeyword 判定，因此这 4 里面有 1 个不应被计入 —— 这正是不能标 executable 的原因。
  assert.equal(count, 4);
  assert.equal(
    ["fae-here", "fae-here-2", "vanilla-here"].filter((id) =>
      kernel.getObject(id).keywords.some((keyword) => keyword.id === "temporary")
    ).length,
    2
  );
});

test("unl-076-219 Petal Pixie golden: the merged continuous.might op registers the supported count", () => {
  const kernel = world()
    .unit("petal-pixie", { might: 2, location: { type: "battlefield", id: "bf-1" } })
    .unit("fae-here", { location: { type: "battlefield", id: "bf-1" } })
    .unit("fae-here-2", { location: { type: "battlefield", id: "bf-1" } })
    .unit("vanilla-here", { location: { type: "battlefield", id: "bf-1" } })
    .unit("fae-elsewhere", { location: { type: "battlefield", id: "bf-2" } })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("petal-pixie") });
  const supportedAmount = structuredClone(amount);
  supportedAmount.filter.controller = "A";
  delete supportedAmount.filter.hasKeyword;
  const outcome = runAbilityBody([{
    id: "petal-pixie.might",
    op: "continuous.might",
    args: {
      amount: supportedAmount,
      mode: { kind: "constant", value: "add" },
      appliesTo: { kind: "constant", value: "self" }
    }
  }], context);
  assert.equal(outcome.status, "executed");
  assert.equal(createLayerEngine(context.objects, context.continuousEffects).evaluate(context.ref("petal-pixie")).might, 6);
});

test.todo(
  "unl-076-219 Petal Pixie: '+1 :rb_might: for each' needs the continuous.might layers primitive with a " +
    "card-program registration path (RIFT-91); the merged op execution is covered above"
);
test.todo(
  "unl-076-219 Petal Pixie: 'units with [Temporary]' needs a keyword/characteristic member filter; the " +
    "merged ObjectFilter only matches type/controller/zone/location/tags, so the count over-counts"
);

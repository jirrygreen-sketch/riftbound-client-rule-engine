import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/spiderling.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-1400b3c0af1e862d41c3291804cf107f4abf2a01f86c47c825fafff617f972a7";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "I have +1 :rb_might: for each other unit you control here with my name.\n" +
  "Your deck can have any number of cards named Spiderling.";

const [hidden, mightAbility] = program.abilities;
const condition = mightAbility.condition;

// The static effect has no merged consumer, but its condition clause is ordinary
// IR and runs through the merged predicate kernel (the reported gap is kept as
// test.todo below, never silently approximated).
const predicate = {
  id: "spiderling.condition-probe",
  op: "condition.predicate",
  args: { condition: { kind: "constant", value: condition } }
};

const spiderKernel = ({ sameField = 0, otherField = 0, enemy = 0 }) => {
  const builder = world().player("controller").player("B");
  builder.unit("spiderling", {
    controller: "controller",
    location: { type: "battlefield", id: "bf-1" }
  });
  for (let index = 0; index < sameField; index++) {
    builder.unit(`same-${index}`, {
      controller: "controller",
      location: { type: "battlefield", id: "bf-1" }
    });
  }
  for (let index = 0; index < otherField; index++) {
    builder.unit(`far-${index}`, {
      controller: "controller",
      location: { type: "battlefield", id: "bf-2" }
    });
  }
  for (let index = 0; index < enemy; index++) {
    builder.unit(`enemy-${index}`, {
      owner: "B",
      controller: "B",
      location: { type: "battlefield", id: "bf-1" }
    });
  }
  const base = builder.build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("spiderling") });
};

test("ven-097-166 Spiderling: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-097-166 Spiderling: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /103\.3\.b/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("ven-097-166 Spiderling: [Hidden] is declared, not re-implemented (contract 3.7)", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
});

test("ven-097-166 Spiderling: +1 Might per other same-named unit here", () => {
  assert.equal(mightAbility.kind, "static");
  assert.equal(mightAbility.effect.kind, "continuous.might");
  assert.equal(mightAbility.effect.mode, "add");
  assert.equal(mightAbility.effect.layer, "arithmetic");
  assert.deepEqual(mightAbility.effect.amount, { kind: "constant", value: 1 });
  assert.equal(mightAbility.effect.appliesTo, "self");

  // “for each other unit you control here with my name”：count + sameLocationAs + exclude
  // 表达 other/here；名称自指见 judgeReason 第 2 点。
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "other-units-here-with-my-name");
  assert.deepEqual(condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    exclude: "self"
  });
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
});

test("ven-097-166 Spiderling: the deckbuilding permission is recorded, not invented", () => {
  // 103.3.b 的默认上限是 3 张同名；本印刷显式覆盖它。构筑强制由未合入的 deck 消费方负责
  // （见 judgeReason 第 4 点），卡内只保留一条可审查的数据记录。
  assert.deepEqual(program.deckbuilding, [{ kind: "unlimited-copies-of-this-name" }]);
});

test("ven-097-166 golden: one other friendly unit here satisfies the printed condition", () => {
  const kernel = spiderKernel({ sameField: 1 });
  const outcome = runAbilityBody([predicate], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["spiderling.condition-probe.value"], true);
});

test("ven-097-166 golden: no other unit here leaves the condition false", () => {
  const kernel = spiderKernel({});
  const outcome = runAbilityBody([predicate], kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["spiderling.condition-probe.value"], false);
});

test("ven-097-166 golden: a friendly unit at another battlefield does not satisfy 'here'", () => {
  const kernel = spiderKernel({ otherField: 1 });
  assert.equal(
    runAbilityBody([predicate], kernel).linkedValues["spiderling.condition-probe.value"],
    false
  );
});

test("ven-097-166 golden: an enemy unit here is not 'a unit you control'", () => {
  const kernel = spiderKernel({ enemy: 1 });
  assert.equal(
    runAbilityBody([predicate], kernel).linkedValues["spiderling.condition-probe.value"],
    false
  );
});

test("ven-097-166 golden: the condition is binary, so two other units give the same +1", () => {
  const one = runAbilityBody([predicate], spiderKernel({ sameField: 1 }));
  const two = runAbilityBody([predicate], spiderKernel({ sameField: 2 }));
  assert.equal(one.linkedValues["spiderling.condition-probe.value"], true);
  assert.equal(two.linkedValues["spiderling.condition-probe.value"], true);
  // “for each …” 的计数语义（N 个同类单位 → +N）需要按集合大小求值 amount；
  // 该求值路径未合入（见下方 test.todo），因此这里只断言条件趋同，不宣称 +N 已实现。
});

test.todo(
  "ven-097-166 Spiderling: [Hidden]'s cost.hidden / facedown play permission has no consumer even though the " +
    "KeywordDef is merged (811.1.d; RIFT-84/RIFT-89/RIFT-91)"
);

test.todo(
  "ven-097-166 Spiderling: the card-side continuous.might registration plus the arithmetic-layer predicates " +
    "(count as amount, 'with my name', sameLocationAs) — layers/engine.ts conditionMatches evaluates only " +
    "always/never/type/has-tag/has-keyword (RIFT-91 follow-up)"
);

test.todo(
  "ven-097-166 Spiderling: 'Your deck can have any number of cards named Spiderling' (103.3.b) needs a deck " +
    "consumer — engine-core/src/deck/index.ts is a placeholder export and the DeckbuildingDecision vocabulary " +
    "has no validator or enforcement"
);

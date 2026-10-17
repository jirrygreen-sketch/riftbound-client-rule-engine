// RIFT-697 execution evidence: ../templates/keyword-static-697.test.mjs runs the card's
// exported abilities through the generic scenario harness and keeps the documented
// clauses judge-required.
// RIFT-672 execution evidence: ../templates/keyword-static-672.test.mjs (supported paths only).
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
// Only the supported other/here subfilter is executed in these local probes.
// The full name expression and count-to-layer consumer remain blocked.
const { characteristics: _name, ...supportedFilter } = mightAbility.effect.amount.filter;
const condition = {
  kind: "compare",
  left: { ...mightAbility.effect.amount, filter: supportedFilter },
  operator: "gte",
  right: { kind: "constant", value: 1 }
};

test("ven-097-166 Spiderling regression: for each is a count amount, not a binary +1 gate", () => {
  assert.deepEqual(mightAbility.effect.amount, {
    kind: "count",
    subject: "other-units-here-with-my-name",
    filter: {
      type: "unit",
      zone: "board",
      controller: "controller",
      sameLocationAs: "self",
      exclude: "self",
      characteristics: { name: { kind: "object-property", object: "self", property: "name" } }
    }
  });
});

// The card-side static registration path is merged (programs/keywords.ts →
// programs/statics.ts), and the condition clause runs through the merged
// predicate kernel; remaining gaps stay in test.todo, never approximated.
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
  assert.match(program.judgeReason, /811\.1\.d/);
  assert.match(program.judgeReason, /N 倍/);
  assert.ok(!/RIFT-91|RIFT-89/.test(program.judgeReason));
});

test("ven-097-166 Spiderling: [Hidden] is declared, not re-implemented (contract 3.7)", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
});

test("ven-097-166 Spiderling: +1 Might per other same-named unit here", () => {
  assert.equal(mightAbility.kind, "static");
  assert.equal(mightAbility.effect.kind, "continuous.might");
  assert.equal(mightAbility.effect.mode, "add");
  assert.equal(mightAbility.effect.layer, "arithmetic");
  assert.equal(mightAbility.effect.amount.kind, "count");
  assert.equal(mightAbility.condition, undefined, "zero matches naturally gives a zero bonus");
  assert.equal(mightAbility.effect.appliesTo, "self");

  // This probe covers other/here only; the full amount and name are pinned above.
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
  // （见 judgeReason 第 3 点），卡内只保留一条可审查的数据记录。
  assert.deepEqual(program.deckbuilding, [{ kind: "unlimited-copies-of-this-name" }]);
});

test("ven-097-166 golden: one other friendly unit here satisfies the supported other/here subfilter", () => {
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

test("ven-097-166 golden: the supported count distinguishes one and two neighbours", () => {
  const countProbe = {
    id: "spiderling.count-probe", op: "condition.value",
    args: { value: condition.left }
  };
  for (const count of [0, 1, 2]) {
    const result = runAbilityBody([countProbe], spiderKernel({ sameField: count }));
    assert.equal(result.status, "executed");
    assert.equal(result.linkedValues["spiderling.count-probe.value"], count);
  }
});

test.todo(
  "ven-097-166 Spiderling: [Hidden]'s cost.hidden / facedown play permission has no consumer even though the " +
    "KeywordDef and the hide/play cost plans (cost/kinds/hidden.ts, 811.1.b) are merged — the play permission, " +
    "facedown zones, Hidden movement and the 811.1.d reaction play stay unwired"
);

test.todo(
  "ven-097-166 Spiderling: 'with my name' self-reference plus N-times amount scaling (count as amount) — " +
    "the card-side continuous.might registration is merged; the name predicate and per-count amount are not"
);

test.todo(
  "ven-097-166 Spiderling: 'Your deck can have any number of cards named Spiderling' (103.3.b) needs a deck " +
    "consumer — engine-core/src/deck/index.ts is a placeholder export and the DeckbuildingDecision vocabulary " +
    "has no validator or enforcement"
);

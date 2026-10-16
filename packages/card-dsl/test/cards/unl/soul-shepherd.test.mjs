import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/soul-shepherd.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CANONICAL =
  "card.hash-bd9ef27aeff0a310c407d20aaac7113859f60260060aac163b4025ea2e70bf4c";
const SOURCE_TEXT = "Your token units have +1 :rb_might:.";

const [ability] = program.abilities;
const { effect } = ability;

const snapshot = (values = {}) => ({
  ref: { id: "unit", zoneEntryId: 1 },
  cardId: "card:unit",
  name: "unit",
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: null,
  might: 1,
  energy: 1,
  power: [],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...values
});

test("unl-077-219 Soul Shepherd: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-077-219 Soul Shepherd: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /isToken/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-077-219 Soul Shepherd: a static arithmetic Might aura over your token units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.mode, "add");
  assert.equal(effect.layer, "arithmetic");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  // "Your token units"：friendly（740.1.a 的 your）+ token 特征判定。
  assert.deepEqual(effect.filter, {
    zone: "board",
    type: "unit",
    controller: "controller",
    isToken: true
  });
});

test("unl-077-219 Soul Shepherd: the merged layers filter ignores the token condition", () => {
  // layers/filter.ts 不认识 isToken 锚点（它不是 matchesObjectFilter 的字段），
  // 因此该条件不会排除任何对象：一个普通单位也会匹配 —— 这正是不能近似实现的原因。
  const nonToken = snapshot({ isToken: false });
  assert.equal(
    matchesObjectFilter({ zone: "board", type: "unit", controller: "controller", isToken: true }, {
      ...nonToken,
      controller: "controller"
    }),
    true
  );
  // 去掉 isToken 后结果相同，说明该键没有参与过滤。
  assert.equal(
    matchesObjectFilter({ zone: "board", type: "unit", controller: "controller" }, {
      ...nonToken,
      controller: "controller"
    }),
    true
  );
});

test("unl-077-219 Soul Shepherd: the continuous.might primitive is not registered", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
});

test.todo(
  "unl-077-219 Soul Shepherd: 'Your token units have +1 :rb_might:.' needs the continuous.might layers " +
    "primitive with a card-program registration path (RIFT-91)"
);
test.todo(
  "unl-077-219 Soul Shepherd: the token membership test needs a real isToken filter; today the layers " +
    "filter ignores the key, so a non-token unit would also receive +1 :rb_might:"
);

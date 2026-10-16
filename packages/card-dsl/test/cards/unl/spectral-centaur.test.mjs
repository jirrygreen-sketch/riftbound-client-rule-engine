import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/spectral-centaur.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { isTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";

const CANONICAL =
  "card.hash-54a2013f8d1b41ecedba3f879be7fae1727fe8209e602a142e8ba6550ed829c9";
const SOURCE_TEXT = "When another friendly unit dies, give me +2 :rb_might: this turn.";

const [ability] = program.abilities;
const [instruction] = ability.body;
const [meSpec] = instruction.targets;

const snapshot = (id, values = {}) => ({
  ref: { id, zoneEntryId: 1 },
  cardId: "card:" + id,
  name: id,
  types: ["unit"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "trash",
  location: null,
  might: 5,
  energy: 6,
  power: ["Mind"],
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false,
  ...values
});

test("unl-068-219 Spectral Centaur: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-068-219 Spectral Centaur: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-068-219 Spectral Centaur: a self object-killed trigger whose filter excludes the host", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", controller: "self", exclude: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-068-219 Spectral Centaur: the body grants +2 Might to this unit for the turn", () => {
  assert.equal(instruction.id, "spectral-centaur.give-plus-2");
  assert.equal(instruction.op, "continuous.might");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(instruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(instruction.linkedTo, undefined);

  assert.equal(instruction.targets.length, 1);
  assert.equal(meSpec.id, "spectral-centaur.me");
  // `"me"` 是自指；用契约 3.6 的对象锚点表达，而不是运行时不存在的 objectId 常量。
  assert.deepEqual(meSpec.filter, { zone: "board", type: "unit", object: "self" });
  assert.equal(meSpec.min, 1);
  assert.equal(meSpec.max, 1);
  assert.equal(meSpec.selection, "one");
});

test("unl-068-219 Spectral Centaur: the merged trigger validator rejects the 'another' exclusion", () => {
  // events/trigger-spec.ts 的 ObjectFilter 白名单不含 exclude 锚点，因此本卡声明
  // 的触发条件目前无法注册；这正是 judgeReason 记录的第 1 处缺口。
  assert.equal(isTriggerSpec(ability.trigger), false);
  // 去掉排除锚点后它是合法的触发形状——说明失败来自 exclude 本身，而不是别的写法错误。
  assert.equal(
    isTriggerSpec({ at: "object-killed", filter: { event: "object-killed", object: { type: "unit", controller: "self" } } }),
    true
  );
});

test("unl-068-219 Spectral Centaur: the trigger matcher would also fire on the host's own death", () => {
  // events/pipeline-match.ts 不解析排除锚点：写成普通 friendly unit 会让本卡自身死亡也触发。
  // 这不是本程序采用的写法，而是记录"近似为什么不成立"的证据。
  const withoutExclusion = { event: "object-killed", object: { type: "unit", controller: "self" } };
  const host = snapshot("spectral-centaur");
  assert.equal(
    matchesTriggerEvent(withoutExclusion, { timingPoint: "object-killed", kind: "object-killed", object: host, eventId: 1 }, "A"),
    true
  );
});

test("unl-068-219 Spectral Centaur: the temporary Might modifier is not a registered primitive", () => {
  assert.equal(instructionDefinitionsById.has("continuous.might"), false);
});

test.todo(
  "unl-068-219 Spectral Centaur: 'another friendly unit' needs an exclusion anchor in the closed " +
    "ObjectFilter / trigger-spec validator (events/trigger-spec.ts) — today isTriggerSpec rejects " +
    "the declared filter"
);
test.todo(
  "unl-068-219 Spectral Centaur: 'give me +2 :rb_might: this turn' needs the continuous.might layers " +
    "effect with an end-of-turn duration (RIFT-91)"
);
test.todo(
  "unl-068-219 Spectral Centaur: registering the card's triggered ability as a TriggerRegistration " +
    "(production chain/event pipeline) is shared wiring tracked by the coordinator (RIFT-120)"
);

import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/reckoners-arena.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-9b2f53a5fb533d020caec1ce47a2615b15c80247a0a913af8105823ff903f909";
const [ability] = program.abilities;
const [activation] = ability.body;

test("ogn-286-298 Reckoner's Arena: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // Both gaps must be named: the missing hold producer and 383.4.g named
  // trigger activation.
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /383\.4\.g/);
  assert.match(program.judgeReason, /RIFT-120/);
  assert.match(program.judgeReason, /RIFT-31/);
  assert.equal(program.sourceText, "When you hold here, activate the conquer effects of units here.");
});

test("ogn-286-298: hold trigger with the named conquer-effect activation shape", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", here: true, player: "controller" });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(activation.id, "reckoners-arena.activate-conquer-effects");
  // 383.4.g.1: the named part is treated as fulfilled, other conditions are
  // still checked, and no real event is emitted (383.4.g.2).
  assert.deepEqual(activation.args.namedTrigger, { kind: "constant", value: "conquer" });
  assert.deepEqual(activation.args.checkOtherConditions, { kind: "constant", value: true });
  assert.deepEqual(activation.args.emitOriginalEvent, { kind: "constant", value: false });
  assert.deepEqual(activation.args.scope, {
    kind: "constant",
    value: { type: "unit", zone: "board", location: "here", controller: "any" }
  });
  assert.equal(activation.linkedTo, undefined);
  assert.equal(activation.targets, undefined);
});

test("ogn-286-298: named-trigger activation has no merged primitive or typo-free registered opcode", () => {
  // Evidence for the judgeReason: the placeholder opcode is not registered, so
  // the instruction cannot execute; the body documents intent only.
  assert.equal(instructionDefinitionsById.has("effect.activate-named-trigger"), false);
  assert.equal(instructionDefinitionsById.has("effect.score"), false);
});

test("ogn-286-298: the trigger filter still carries the unreplaced here placeholder", () => {
  assert.throws(() => assertTriggerSpec(ability.trigger), /EventPattern 不允许此字段/);
});

test.todo(
  "ogn-286-298: hold 由 scoring 发出并进链（RIFT-31/RIFT-33）；命名触发激活入口" +
    "（383.4.g.1：逐条检查 conquer effects 的其余条件、不合成真实征服事件）落地后，" +
    "把符合条件的单位 conquer 效果放进链（依赖 RIFT-120 契约变更请求 3 的内部入口）"
);
test.todo(
  "ogn-286-298: 被激活的 conquer effects 不因 383.4.g.2 之后出现真实征服而重复触发" +
    "（依赖命名触发与真实事件区分，RIFT-33）"
);

import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/the-arenas-greatest.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";

const CANONICAL = "card.hash-23d43dc5325dcaca58f58415a7f9046b3d280f3c40d261f5aa7ddbfa1bf72770";
const [ability] = program.abilities;
const [score] = ability.body;

test("ogn-290-298 The Arena's Greatest: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The three gaps: missing effect.score primitive, missing beginning-start
  // producer, and the per-player-once frequency / event-player recipient.
  assert.match(program.judgeReason, /effect\.score/);
  assert.match(program.judgeReason, /470\.1/);
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /event-player/);
  assert.match(program.judgeReason, /RIFT-33/);
  assert.equal(
    program.sourceText,
    "At the start of each player's first Beginning Phase, that player gains 1 point."
  );
});

test("ogn-290-298: beginning-start trigger that gains 1 point for the event player", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "beginning-start");
  assert.deepEqual(ability.trigger.filter, {
    event: "beginning-start",
    player: "any",
    oncePerPlayer: true
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  assert.equal(score.id, "arenas-greatest.gain-1-point");
  // "gain 1 point" is the Gaining Points process (470.1/470.2), which the
  // closed GameAction set models with the score action; the primitive that
  // submits it is not merged (see judgeReason).
  assert.deepEqual(score.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(score.args.player, { kind: "constant", value: "event-player" });
  assert.equal(score.linkedTo, undefined);
  assert.equal(score.targets, undefined);
  assert.equal(score.picks, undefined);
});

test("ogn-290-298: the score primitive and the timing producer are absent from merged code", () => {
  // Evidence for the judgeReason: neither the instruction primitive nor a
  // timing producer for beginning-start exists in merged code.
  assert.equal(instructionDefinitionsById.has("effect.score"), false);
  assert.equal(instructionDefinitionsById.has("effect.ready"), true);
  assert.equal(instructionDefinitionsById.has("trigger.score"), false);
});

test("ogn-290-298: the per-player-once frequency and event-player recipient are placeholders", () => {
  // Evidence for the judgeReason: the engine rejects the oncePerPlayer key and
  // the body names a recipient the IR cannot resolve.
  assert.throws(() => assertTriggerSpec(ability.trigger), /EventPattern 不允许此字段/);
  assert.deepEqual(ability.body[0].args.player, { kind: "constant", value: "event-player" });
});

test.todo(
  "ogn-290-298: effect.score 原语（470.1 Gaining Points：单独动作、可被替代、与 scoring 区分）落地，" +
    "以事件玩家为收件人得 1 分（依赖 RIFT-9 原语清单中的 effect.score 与 RIFT-33）"
);
test.todo(
  "ogn-290-298: beginning-start 由 turn/ 发出并进链；每位玩家的第一个 Beginning Phase 只触发一次" +
    "（each-player-once 频度 + 事件玩家选择器，契约变更请求）"
);

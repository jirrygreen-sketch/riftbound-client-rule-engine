import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/obelisk-of-power.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { getTimingPoint } from "../../../../engine-core/dist/events/timing-points.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ce086003979fccd72098987c591cf3efadb8febe6151a369b53c43afa7c9d9ea";
const [ability] = program.abilities;

test("ogn-284-298 Obelisk of Power: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The remaining gaps are the per-player-once frequency and event-player
  // recipient selector; beginning-start itself is a registered timing point.
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /per-turn/);
  assert.match(program.judgeReason, /per-game/);
  assert.doesNotMatch(program.judgeReason, /RIFT-\d+/);
  assert.match(program.judgeReason, /event-player/);
  assert.match(program.judgeReason, /逐玩家 once/);
  assert.equal(
    program.sourceText,
    "At the start of each player's first Beginning Phase, that player channels 1 rune."
  );
});

test("ogn-284-298: beginning-start trigger whose recipient is the event player", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "beginning-start");
  // "each player's first Beginning Phase": the any-player event is recorded;
  // the per-player first-occurrence frequency remains outside TriggerSpec.
  assert.deepEqual(ability.trigger.filter, {
    event: "beginning-start",
    player: "any"
  });
  assert.equal(ability.optional, false);

  assert.equal(ability.body.length, 1);
  const [channeled] = ability.body;
  assert.equal(channeled.id, "obelisk.channel-1-rune");
  assert.equal(channeled.op, "effect.channel");
  assert.deepEqual(channeled.args.amount, { kind: "constant", value: 1 });
  // "that player": the IR has no event-player selector, so the value is a
  // documented placeholder rather than the ability controller.
  assert.deepEqual(channeled.args.player, { kind: "constant", value: "event-player" });
  assert.equal(channeled.args.exhausted, undefined);
  assert.equal(channeled.targets, undefined);
});

test("ogn-284-298: the printed channel-1 sub-effect runs on the merged effect.channel primitive (CR 431.1)", () => {
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const ran = runInstruction(
    channel,
    // The recipient placeholder cannot be executed; only the printed amount is
    // driven, with the primitive defaulting to the ability controller (the
    // "that player" wiring is tracked as a TODO below).
    { amount: ability.body[0].args.amount, exhausted: ability.body[0].args.exhausted },
    { world: kernel }
  );
  assert.equal(ran.result.status, "executed");
  assert.equal(ran.linked.channeled, 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("top-rune").zone, "rune-zone");
  assert.equal(kernel.getObject("second-rune").zone, "rune-deck");
});

test("ogn-284-298: the beginning-start timing point and channel primitive are registered", () => {
  assert.equal(instructionDefinitionsById.has("effect.channel"), true);
  assert.equal(getTimingPoint("beginning-start").emittedBy, "turn");
  assert.equal(ability.trigger.at, "beginning-start");
});

test("ogn-284-298: the per-player-once frequency and event-player recipient remain explicit gaps", () => {
  // The printed frequency has no TriggerSpec field, while the body records the
  // unresolved event-player selector without claiming it is executable.
  assert.equal(ability.trigger.once, undefined);
  assert.deepEqual(ability.body[0].args.player, { kind: "constant", value: "event-player" });
});

test.todo(
  "ogn-284-298: beginning-start 由 turn/ 发出并进链，每位玩家的第一个 Beginning Phase " +
    "只触发一次（需要逐玩家 once 频度与事件玩家收件人选择器）"
);
test.todo(
  "ogn-284-298: \"that player\" 收件人选择器（事件玩家）落地后 effect.channel 以该玩家为参数执行" +
    "（依赖 IR 事件玩家选择器）"
);

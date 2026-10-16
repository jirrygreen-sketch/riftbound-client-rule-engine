import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/the-arenas-greatest.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

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
  // Gaining Points executes; first-phase timing and recipient binding still block the card.
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
  // closed GameAction set models with the merged score primitive.
  assert.deepEqual(score.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(score.args.player, { kind: "constant", value: "event-player" });
  assert.equal(score.linkedTo, undefined);
  assert.equal(score.targets, undefined);
  assert.equal(score.picks, undefined);
});

function boundBody(player) {
  // Only the unsupported event-player binding is supplied by the test caller.
  return [{ ...score, args: { ...score.args, player: { kind: "constant", value: player } } }];
}

test("ogn-290-298: the bound event player gains one point through the authored score instruction", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(boundBody("B"), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.player("B").score, 1);
  assert.equal(kernel.player("A").score, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["score"]);
  assert.deepEqual(outcome.linkedValues[`${score.id}.scored`], [{ player: "B", amount: 1 }]);
});

test("ogn-290-298: prevented Gaining Points negates the instruction without awarding a point", () => {
  const kernel = world().build();
  kernel.addReplacement(action => action.type === "score" ? "prevented" : null);
  const outcome = resolveChainBody(boundBody("B"), kernel);
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.player("B").score, 0);
  assert.equal(kernel.player("A").score, 0);
  assert.equal(kernel.history({ action: "score" }), 0);
  assert.deepEqual(outcome.linkedValues[`${score.id}.scored`], []);
});
test.todo(
  "ogn-290-298: beginning-start 由 turn/ 发出并进链；每位玩家的第一个 Beginning Phase 只触发一次" +
    "（each-player-once 频度 + 事件玩家选择器，契约变更请求）"
);

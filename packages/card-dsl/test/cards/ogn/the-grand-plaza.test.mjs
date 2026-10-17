import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/the-grand-plaza.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CANONICAL = "card.hash-627933b535ef66e1e1bb12785313b937e23dc2c7ac48a1ff26c8c49a94e0c233";
const SOURCE_TEXT = "When you hold here, if you have 7+ units here, you win the game.";

const [ability] = program.abilities;
const [winInstruction] = ability.body;

/** A world with one Battlefield and N units of controller A at it. */
function plazaWorld(unitCount, { battlefieldId = "battlefield-1" } = {}) {
  const builder = world().battlefield("grand-plaza", {
    types: ["battlefield"],
    owner: "A",
    controller: "A",
    location: { type: "battlefield", id: battlefieldId }
  });
  for (let index = 0; index < unitCount; index += 1) {
    builder.unit("unit-" + index, { location: { type: "battlefield", id: battlefieldId } });
  }
  return builder.build();
}

test("The Grand Plaza program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.win/);
  assert.match(program.judgeReason, /testTrigger/);
  assert.ok(!/RIFT-357/.test(program.judgeReason));
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("The Grand Plaza structure: hold trigger with a 7-unit condition and a win instruction", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 383.4.d: "When you hold here" is a Hold Effect.
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, {
    event: "hold",
    here: true,
    player: "controller"
  });
  assert.equal(ability.trigger.once, undefined);

  // 383.4.d + 053.3: "if you have 7+ units here" guards the whole ability. It is
  // part of the hold Condition, not the instruction (135.2.b.6).
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 7 });
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(ability.trigger.condition.left.subject, "units");
  assert.deepEqual(ability.trigger.condition.left.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    sameLocationAs: "self"
  });

  // 195: one instruction that instructs the holding player to win.
  assert.equal(ability.body.length, 1);
  assert.equal(winInstruction.id, "grand-plaza.win");
  assert.equal(winInstruction.op, "effect.win");
  // No player argument: the winner is the ability controller, i.e. the player
  // who held the Battlefield (190.6.d); no opponent is ever declared the winner
  // as a stand-in for a loss effect.
  assert.deepEqual(winInstruction.args, {});
  assert.equal(winInstruction.targets, undefined);
  assert.equal(winInstruction.picks, undefined);
  assert.equal(winInstruction.linkedTo, undefined);
  assert.equal(winInstruction.condition, undefined);
});

test("The Grand Plaza golden: the win instruction makes the controller the winner (CR 195)", () => {
  const kernel = plazaWorld(7);

  const outcome = runAbilityBody(ability.body, kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // effect.win links the actual done-action result.
  assert.deepEqual(outcome.results[0].result.linkedValues, { winner: "A" });
  assert.deepEqual(kernel.events.map(event => event.action), ["win"]);
});

test("The Grand Plaza golden: a replaced win is negated without declaring anyone the winner (CR 359.3.e.14.b)", () => {
  const kernel = plazaWorld(7);
  kernel.addReplacement(action => action.type === "win" ? "replaced" : null);

  const outcome = runAbilityBody(ability.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "replaced");
  // The negation clears the linked winner (no player is declared the winner by
  // proxy) and the replacement's own event records the outcome.
  assert.equal(kernel.linkedSnapshot()["grand-plaza.win.winner"], null);
  assert.deepEqual(kernel.events.map(event => [event.action, event.outcome]), [["win", "replaced"]]);
});

test.todo(
  "The Grand Plaza condition scope: '7+ units here' needs the 053.3 'here' referent to " +
    "restrict the count to the held Battlefield through the trigger condition; the registration " +
    "path needs a host testTrigger adapter (events/pipeline.ts), and the interpreter's plain " +
    "query path must bind controller: 'controller' to the ability controller"
);

test.todo(
  "The Grand Plaza hold trigger: the Beginning scoring step now emits the hold event " +
    "(TurnFlow's Score wave), so the remaining gap is normalizing the 053.3 'here' referent " +
    "and resolving the Battlefield controller before registration"
);

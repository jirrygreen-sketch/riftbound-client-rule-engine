import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/vicious-snapjaws.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID =
  "card.hash-ed7bafa7ae8c55236bdb4f3b21b17843836fdd9a22879336da866ccc90523a6f";
const SOURCE_TEXT = "When another friendly unit dies, gain 1 XP.";

const [ability] = program.abilities;
const [gainXp] = ability.body;

test("unl-129-219 Vicious Snapjaws: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-129-219 Vicious Snapjaws: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /429\.1/);
  assert.match(program.judgeReason, /exclude/);
});

test("unl-129-219 Vicious Snapjaws: object-killed trigger with the other-friendly-unit death filter", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 429.1 / 429.1.a.1: dying is a permanent leaving the Board for its Trash.
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", controller: "self", exclude: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-129-219 Vicious Snapjaws: the trigger's friendly part is the controller selector (740.1.a)", () => {
  // "friendly" is the shared-controller reading; events/pipeline-match.ts resolves the "self" player
  // selector for an object filter against the ability controller, so this half of the filter is the
  // merged spelling. The "another" half (the exclude anchor) is the part still missing (judgeReason).
  assert.equal(ability.trigger.filter.object.controller, "self");
  assert.equal(ability.trigger.filter.object.type, "unit");
  assert.equal(ability.trigger.filter.event, "object-killed");
});

test("unl-129-219 Vicious Snapjaws: the effect is a plain gain 1 XP (730.1 / 190.6.d)", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(gainXp.id, "vicious-snapjaws.gain-xp");
  assert.equal(gainXp.op, "effect.xp");
  assert.deepEqual(gainXp.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(gainXp.targets, undefined);
  assert.equal(gainXp.picks, undefined);
  assert.equal(gainXp.linkedTo, undefined);
});

test("unl-129-219 Vicious Snapjaws golden: the effect really gains 1 XP for the ability controller", () => {
  const kernel = world().build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["vicious-snapjaws.gain-xp", "executed"]
  ]);
  assert.equal(kernel.player("A").xp, 1);
  assert.equal(kernel.player("B").xp, 0);
  assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
  assert.equal(kernel.history({ action: "gain-xp", player: "A" }), 1);
});

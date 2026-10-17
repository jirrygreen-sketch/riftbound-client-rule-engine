import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/trapping-grounds.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL_ID =
  "card.hash-7a01ecd3aa462214de6a41d9b27507498954ccd6e7095b6e731dbe742c275f90";
const SOURCE_TEXT =
  "When you conquer here, if you assigned 3 or more excess damage, play a 1 :rb_might: Bird unit token with [Deflect].";

const [ability] = program.abilities;
const [playBird] = ability.body;

test("unl-217-219 Trapping Grounds: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-217-219 Trapping Grounds: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The reason must name the real gaps with rule and task ids, not a generic
  // "not implemented" (cards README §2).
  assert.match(program.judgeReason, /187\.7/);
  assert.match(program.judgeReason, /target\.location/);
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /467\.2\.c/);
  assert.match(program.judgeReason, /RIFT-9/);
  assert.match(program.judgeReason, /source\/Battlefield/);
  assert.match(program.judgeReason, /attachLifecycle/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-217-219 Trapping Grounds: conquer trigger with the excess-damage clause as trigger condition", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.c / 383.4.c.1: a Conquer Effect; the card-side filter uses the
  // closed-vocabulary event name "conquered" (the conquer timing point itself is
  // emitted by turn/flow.ts) and "you" is the Battlefield's controller (190.6.d).
  assert.equal(ability.trigger.at, "conquer");
  assert.deepEqual(ability.trigger.filter, {
    event: "conquered",
    filter: { source: "self" },
    player: "self"
  });
  // 383.2.a.1: the clause follows the trigger condition directly, so it belongs
  // to that condition; the "assigned excess damage" total is a combat-damage
  // assignment statistic (467.2.c.1 assigning vs dealing, 467.2.c.4).
  assert.equal(ability.trigger.condition.kind, "compare");
  assert.equal(ability.trigger.condition.operator, "gte");
  assert.equal(ability.trigger.condition.left.kind, "count");
  assert.equal(
    ability.trigger.condition.left.subject,
    "excess-damage-assigned-this-combat"
  );
  assert.deepEqual(ability.trigger.condition.left.filter, { player: "controller" });
  assert.deepEqual(ability.trigger.condition.right, { kind: "constant", value: 3 });
  // No "may" in the printed text: the trigger is mandatory.
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("unl-217-219 Trapping Grounds: one Bird token play with no fixed destination", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(playBird.id, "trapping-grounds.play-bird");
  assert.equal(playBird.op, "effect.token");
  // 187.7: the 1 [M] Bird is a domainless unit token with the Bird tag and
  // Deflect. 440.2.c / 185.2.a: "play a ... token" is chain creation + play.
  assert.deepEqual(playBird.args.token, { kind: "constant", value: "bird" });
  assert.deepEqual(playBird.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playBird.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playBird.args.linkKey, { kind: "constant", value: "birdToken" });
  // The printed text names no location, so the destination is the 355.2/355.2.a
  // default valid-location choice made at the played token's Finalize. No
  // destination argument is authored here (a fixed Base or Battlefield would
  // delete the printed options) and no TargetSpec/PickSpec is invented.
  assert.equal(playBird.args.location, undefined);
  assert.equal(playBird.args.target, undefined);
  assert.equal(playBird.args.pick, undefined);
  assert.equal(playBird.args.locations, undefined);
  assert.equal(playBird.targets, undefined);
  assert.equal(playBird.picks, undefined);
  assert.equal(playBird.linkedTo, undefined);
  assert.equal(playBird.condition, undefined);
});


test("unl-217-219 Trapping Grounds golden: the conquered pattern retains the source Battlefield anchor", async () => {
  // The event name is closed vocabulary, while the nested source:self filter
  // preserves CR 053.3 "here" for the registration layer.
  const pattern = ability.trigger.filter;
  assert.equal(pattern.event, "conquered");
  assert.deepEqual(pattern.filter, { source: "self" });
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  const translated = translateTriggerFilter(pattern, "trapping-grounds-source");
  assert.equal(translated.event, "conquered");
  assert.equal(translated.player, "self");
  assert.deepEqual(translated.object, { objectId: "trapping-grounds-source" });
});

test.todo(
  "unl-217-219 Trapping Grounds: expose the conquer event's assigned excess-damage total " +
    "(467.2.c.1 assigning is not dealing, 467.2.c.4 excess above lethal) on the scoring payload " +
    "or through ResolveContext — the closed history query only counts actions (engine batch 4)"
);

test.todo(
  "unl-217-219 Trapping Grounds: bind the conquer trigger to the source Battlefield in production " +
    "(conquer is emitted by turn/flow.ts and createProgramBinding.attachLifecycle registers supplied " +
    "programs, but the scoring emission carries only battlefieldId/player and lacks the source/object " +
    "snapshot needed for the retained 053.3 here anchor; the default room does not inject this program)"
);

test.todo(
  "unl-217-219 Trapping Grounds: add the CR 187.7 Bird token (1 Might, Bird tag, Deflect) to the " +
    "frozen effect.token definition table, with its Deflect expansion (809) — definitions carrying " +
    "their own abilities or keywords are blocked there today (RIFT-83)"
);

test.todo(
  "unl-217-219 Trapping Grounds: resolve the 355.2/355.2.a default valid-location choice for the " +
    "played token at its Finalize (controller's Base or a Battlefield the controller controls) " +
    "instead of hard-coding one location (target.location, RIFT-9)"
);

import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/sprite-queen.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { assertTriggerSpec, validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";

const CANONICAL_ID =
  "card.hash-a97b1d53f5a78ced95c65e0fe9618e56618fed2e7c141b9fd84485c40632768f";
const SOURCE_TEXT =
  "When you play me or at the start of your Beginning Phase, play a ready 3 :rb_might: Sprite unit token with [Temporary] " +
  "to your base. (Kill them at the start of their controller's next Beginning Phase, before scoring.)";

const [onPlay, atBeginning] = program.abilities;
const [playOnPlay] = onPlay.body;
const [playAtBeginning] = atBeginning.body;

test("unl-084-219 Sprite Queen: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-084-219 Sprite Queen: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Sprite/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /EventPattern/);
  assert.match(program.judgeReason, /beginning-start/);
  assert.match(program.judgeReason, /controller-relative/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-084-219 Sprite Queen: 'When you play me or at the start of your Beginning Phase' is one ability per condition", () => {
  assert.equal(program.abilities.length, 2);
  // 383.4.a: "When you play me" is the card-played Play Effect.
  assert.equal(onPlay.kind, "triggered");
  assert.equal(onPlay.trigger.at, "card-played");
  assert.deepEqual(onPlay.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(onPlay.optional, false);
  // 315.2.a.1: "at the start of your Beginning Phase" is beginning-start for
  // the ability controller (190.6.d).
  assert.equal(atBeginning.kind, "triggered");
  assert.equal(atBeginning.trigger.at, "beginning-start");
  assert.deepEqual(atBeginning.trigger.filter, { event: "beginning-start", player: "self" });
  assert.equal(atBeginning.optional, false);
  // The two conditions are mutually exclusive; neither ability is linked.
  assert.equal(playOnPlay.linkedTo, undefined);
  assert.equal(playAtBeginning.linkedTo, undefined);
});

test("unl-084-219 Sprite Queen: both branches play the printed CR 187.2 Sprite to the controller's base", () => {
  for (const instruction of [playOnPlay, playAtBeginning]) {
    assert.equal(instruction.op, "effect.token");
    // 187.2: a 3 Might domainless Sprite token with the Fae tag and Temporary.
    assert.deepEqual(instruction.args.token, { kind: "constant", value: "sprite" });
    assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
    // 440.2.c / 185.2.a: the played token is created on the Chain first.
    assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
    // "to your base" — the controller's base; the frozen IR has no
    // controller-relative LocationRef spelling for effect.token, and the merged
    // primitive negates this placeholder instead of creating the token in a
    // guessed base (see judgeReason; the same spelling as ogn/altar-to-unity).
    assert.deepEqual(instruction.args.location, {
      kind: "constant",
      value: { type: "base", player: "controller" }
    });
    assert.equal(instruction.args.entersReady, undefined);
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
  }
  assert.equal(playOnPlay.id, "sprite-queen.play-sprite-on-play");
  assert.equal(playAtBeginning.id, "sprite-queen.play-sprite-at-beginning");
});

test("unl-084-219 Sprite Queen: beginning-start is accepted by the production trigger vocabulary", () => {
  const filter = translateTriggerFilter(atBeginning.trigger.filter, "sprite-queen");
  assert.equal(filter.event, "beginning-start");
  assert.doesNotThrow(() => assertTriggerSpec({ at: atBeginning.trigger.at, filter }));
  assert.equal(validateTriggerSpec({ at: atBeginning.trigger.at, filter }).ok, true);
});

test.todo(
  "unl-084-219 Sprite Queen: execute the Sprite play end-to-end (CR 187.2 / 440.2.c) once the definition and a " +
    "controller-relative base location are available — no execution scenario is claimed here"
);

test.todo(
  "unl-084-219 Sprite Queen: register the 3 Might Sprite definition (CR 187.2) in the effect.token table"
);
test.todo(
  "unl-084-219 Sprite Queen: 'ready' as an entry-state override for the played token (CR 143.4 / 184.1 / 185.2.d) — " +
    "never create-then-ready, which would add a spurious 'becomes ready' event"
);
test.todo(
  "unl-084-219 Sprite Queen: name 'to your base' as a controller-relative LocationRef for effect.token — " +
    "contract change request (effect.move already accepts \"controller-base\", effect.token does not)"
);

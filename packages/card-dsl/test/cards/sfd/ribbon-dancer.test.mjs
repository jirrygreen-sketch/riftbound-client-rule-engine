import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/ribbon-dancer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CARD_ID = "card.hash-1d9968343e4ab4ff83ad67e03bc124632358c3526c2bbddcc0667b4849c03538";
const TARGET_ID = "ribbon-dancer.other-friendly-unit";

const [ability] = program.abilities;
const [mightInstruction] = ability.body;
const [targetSpec] = mightInstruction.targets;

test("sfd-038-221 Ribbon Dancer: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-038-221 Ribbon Dancer: identity, ruleset, status and verbatim text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "When I move to a battlefield, give another friendly unit +1 :rb_might: this turn."
  );
});

test("sfd-038-221 Ribbon Dancer: judgeReason names the temporary-Might and move-payload gaps", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /临时 Might/);
  assert.match(program.judgeReason, /effect\.buff/);
  assert.match(program.judgeReason, /object-moved/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("sfd-038-221 Ribbon Dancer: 'When I move to a battlefield' subscribes to object-moved", () => {
  // 421.1 / 449.1 / 449.2: a Move is a permanent changing locations on the
  // Board; 458 / 458.1: a Recall is not a Move and does not trigger Move
  // abilities. The battlefield destination is expressed with the toZone
  // payload match, matching merged sfd/corinna-veraza.
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);
});

test("sfd-038-221 Ribbon Dancer: the effect is a one-turn Might grant targeted at another friendly unit", () => {
  // CR 703 / effect.buff.ts header: a temporary Might modification belongs to
  // the continuous.might layer, never to the Buff counter primitive.
  assert.equal(ability.body.length, 1);
  assert.equal(mightInstruction.id, "ribbon-dancer.give-plus-1");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(mightInstruction.linkedTo, undefined);

  // 355.7 / 355.9.b: "another friendly unit" is chosen, so it is a target;
  // "another" excludes the source through the symbolic exclude selector.
  assert.equal(mightInstruction.targets.length, 1);
  assert.equal(targetSpec.id, TARGET_ID);
  assert.deepEqual(targetSpec.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    exclude: "source"
  });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
  assert.equal(mightInstruction.picks, undefined);
});

test.todo(
  "sfd-038-221 Ribbon Dancer: '+1 Might this turn' needs a merged continuous.might instruction that " +
    "registers the arithmetic-layer effect through ResolveContext.addContinuous with an end-of-turn " +
    "duration (CR 703 keeps buffs and temporary Might changes distinct; the layers engine itself can " +
    "evaluate the effect, but effects/instructions/ has no primitive that registers one) — RIFT-9"
);

test.todo(
  "sfd-038-221 Ribbon Dancer: the object-moved event must carry to/toKind so that toZone: \"battlefield\" " +
    "matches only genuine Moves onto a battlefield (449.1/449.2, with 458/458.1 excluding Recalls) and " +
    "must expose the moved object's identity to the card registration (RIFT-120)"
);

test.todo(
  "sfd-038-221 Ribbon Dancer: Finalize legalizes 'another friendly unit' (controller + exclude source) " +
    "and re-checks it at resolution (355.8, 355.9, 359.3.e) — RIFT-90"
);
